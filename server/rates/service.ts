/**
 * Rate observation service: fetch, validate, store, and report freshness.
 *
 * Storage sits behind `RateRepository` so tests run in memory and production uses Postgres.
 * Settlement selects by observation date, never by "latest fetched".
 */
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { activeBenchmarks, getBenchmark, microToPercent, type Benchmark, type BenchmarkId } from "@shared/rates/benchmarks";
import { rateFetches, rateObservations } from "@shared/schema";
import { addDays } from "./calendar";
import { ADAPTERS, type FetchResult, type RateAdapter } from "./adapters";
import { epochDay, freshness, isLocked, latestExpected, RateValidationError, validateObservation, type FreshnessState } from "./validate";

export interface StoredObservation {
  benchmark: BenchmarkId;
  observationDate: string;
  rateMicroPercent: number;
  source: string;
  sourceReference: string;
  status: "PUBLISHED" | "REVISED";
  /** Values not in force: superseded before the cutoff, or ignored after it (`afterLock`). */
  revisions: Array<{ rateMicroPercent: number; source: string; seenAt: string; afterLock: boolean }>;
  firstSeenAt: Date;
  lastSeenAt: Date;
  onChainRound: number | null;
  onChainTx: string | null;
}

export interface FetchLog {
  benchmark: BenchmarkId;
  source: string;
  url: string;
  ok: boolean;
  error?: string;
  payload?: string;
  accepted: number;
  rejected: Array<{ observationDate: string; ratePercent: string; code: string; message: string }>;
}

export interface RateRepository {
  get(benchmark: BenchmarkId, observationDate: string): Promise<StoredObservation | null>;
  upsert(o: StoredObservation): Promise<void>;
  range(benchmark: BenchmarkId, from: string, to: string): Promise<StoredObservation[]>;
  latest(benchmark: BenchmarkId): Promise<StoredObservation | null>;
  logFetch(f: FetchLog): Promise<void>;
  markOnChain(benchmark: BenchmarkId, observationDate: string, round: number, tx: string): Promise<void>;
}

export interface IngestSummary {
  benchmark: BenchmarkId;
  source: string;
  accepted: number;
  unchanged: number;
  revised: number;
  rejected: FetchLog["rejected"];
}

/** Validate and store one fetch. Duplicates are no-ops; changed values follow the revision rules. */
export async function ingest(repo: RateRepository, result: FetchResult, now = new Date()): Promise<IngestSummary> {
  const benchmark = result.observations[0]?.benchmark;
  const summary: IngestSummary = { benchmark: benchmark ?? ("UNKNOWN" as BenchmarkId), source: result.source, accepted: 0, unchanged: 0, revised: 0, rejected: [] };
  const seenThisFetch = new Map<string, number>();

  for (const raw of result.observations) {
    let obs;
    try {
      obs = validateObservation(raw, now);
    } catch (err) {
      const code = err instanceof RateValidationError ? err.code : "MALFORMED";
      summary.rejected.push({ observationDate: raw.observationDate, ratePercent: raw.ratePercent, code, message: (err as Error).message });
      continue;
    }
    // One source should never print two values for the same day in one response.
    const dup = seenThisFetch.get(obs.observationDate);
    if (dup !== undefined) {
      if (dup !== obs.rateMicroPercent) {
        summary.rejected.push({ observationDate: raw.observationDate, ratePercent: raw.ratePercent, code: "CONFLICTING_DUPLICATE", message: "two different values for one date in one response" });
      }
      continue;
    }
    seenThisFetch.set(obs.observationDate, obs.rateMicroPercent);

    const existing = await repo.get(obs.benchmark, obs.observationDate);
    if (!existing) {
      await repo.upsert({
        benchmark: obs.benchmark, observationDate: obs.observationDate, rateMicroPercent: obs.rateMicroPercent,
        source: obs.source, sourceReference: obs.sourceReference, status: obs.revised ? "REVISED" : "PUBLISHED",
        revisions: [], firstSeenAt: now, lastSeenAt: now, onChainRound: null, onChainTx: null,
      });
      summary.accepted++;
      continue;
    }
    if (existing.rateMicroPercent === obs.rateMicroPercent) {
      await repo.upsert({ ...existing, lastSeenAt: now });
      summary.unchanged++;
      continue;
    }
    // The administrator changed a value we already hold. Before the revision cutoff the
    // correction replaces it. After the cutoff, or once on chain, the locked value stands
    // (settlement depends on it) and the late change is kept for audit only.
    const locked = existing.onChainRound !== null || isLocked(getBenchmark(obs.benchmark), obs.observationDate, now);
    const entry = locked
      ? { rateMicroPercent: obs.rateMicroPercent, source: obs.source, seenAt: now.toISOString(), afterLock: true }
      : { rateMicroPercent: existing.rateMicroPercent, source: existing.source, seenAt: now.toISOString(), afterLock: false };
    await repo.upsert({
      ...existing,
      ...(locked ? {} : { rateMicroPercent: obs.rateMicroPercent, source: obs.source, sourceReference: obs.sourceReference }),
      status: "REVISED",
      revisions: [...existing.revisions, entry],
      lastSeenAt: now,
    });
    summary.revised++;
  }
  return summary;
}

export async function refreshBenchmark(repo: RateRepository, id: BenchmarkId, adapter: RateAdapter | undefined = ADAPTERS[id], count = 10): Promise<IngestSummary> {
  if (!adapter) throw new Error(`No adapter for ${id}`);
  let result: FetchResult;
  try {
    result = await adapter.fetchLatest(count);
  } catch (err) {
    await repo.logFetch({ benchmark: id, source: getBenchmark(id).source, url: "", ok: false, error: (err as Error).message, accepted: 0, rejected: [] });
    throw err;
  }
  const summary = await ingest(repo, result);
  await repo.logFetch({
    benchmark: id, source: result.source, url: result.url, ok: true, payload: result.body.slice(0, 200_000),
    accepted: summary.accepted + summary.revised, rejected: summary.rejected,
  });
  return summary;
}

// ── Read model ───────────────────────────────────────────────────────────────

export interface ObservationView {
  benchmark: BenchmarkId;
  currency: string;
  observationDate: string;
  observationDay: number;
  ratePercent: string;
  rateMicroPercent: number;
  status: "PUBLISHED" | "REVISED";
  locked: boolean;
  source: string;
  sourceReference: string;
  firstSeenAt: string;
  onChain: { round: number; tx: string } | null;
}

export function toView(o: StoredObservation, now = new Date()): ObservationView {
  const b = getBenchmark(o.benchmark);
  return {
    benchmark: o.benchmark, currency: b.currency, observationDate: o.observationDate, observationDay: epochDay(o.observationDate),
    ratePercent: microToPercent(o.rateMicroPercent), rateMicroPercent: o.rateMicroPercent, status: o.status,
    locked: o.onChainRound !== null || isLocked(b, o.observationDate, now),
    source: o.source, sourceReference: o.sourceReference, firstSeenAt: o.firstSeenAt.toISOString(),
    onChain: o.onChainRound !== null && o.onChainTx ? { round: o.onChainRound, tx: o.onChainTx } : null,
  };
}

export interface BenchmarkStatus {
  id: BenchmarkId;
  name: string;
  currency: string;
  administrator: string;
  licensing: string;
  expected: { observationDate: string; expectedAt: string; delayedAfter: string };
  state: FreshnessState;
  latest: ObservationView | null;
  /** The observation before `latest`, for the daily change. */
  previous: ObservationView | null;
}

export async function benchmarkStatus(repo: RateRepository, b: Benchmark, now = new Date()): Promise<BenchmarkStatus> {
  const exp = latestExpected(b, now);
  const [have, latest] = await Promise.all([repo.get(b.id, exp.observationDate), repo.latest(b.id)]);
  const before = latest ? await repo.range(b.id, addDays(latest.observationDate, -14), addDays(latest.observationDate, -1)) : [];
  const previous = before[before.length - 1] ?? null;
  return {
    id: b.id, name: b.name, currency: b.currency, administrator: b.administrator, licensing: b.licensing,
    expected: { observationDate: exp.observationDate, expectedAt: exp.expectedAt.toISOString(), delayedAfter: exp.delayedAfter.toISOString() },
    state: freshness(exp, Boolean(have), now),
    latest: latest ? toView(latest, now) : null,
    previous: previous ? toView(previous, now) : null,
  };
}

export function oracleBenchmarks(): Benchmark[] {
  const testnet = process.env.APP_ENV === "testnet" || process.env.NETWORK_MODE === "testnet";
  return activeBenchmarks(testnet).filter((b) => ADAPTERS[b.id]);
}

// ── Repositories ─────────────────────────────────────────────────────────────

export class InMemoryRateRepository implements RateRepository {
  rows = new Map<string, StoredObservation>();
  fetches: FetchLog[] = [];
  private key = (b: string, d: string) => `${b}|${d}`;
  async get(b: BenchmarkId, d: string) { return this.rows.get(this.key(b, d)) ?? null; }
  async upsert(o: StoredObservation) { this.rows.set(this.key(o.benchmark, o.observationDate), { ...o }); }
  async range(b: BenchmarkId, from: string, to: string) {
    return Array.from(this.rows.values()).filter((o) => o.benchmark === b && o.observationDate >= from && o.observationDate <= to)
      .sort((x, y) => x.observationDate.localeCompare(y.observationDate));
  }
  async latest(b: BenchmarkId) {
    return Array.from(this.rows.values()).filter((o) => o.benchmark === b).sort((x, y) => y.observationDate.localeCompare(x.observationDate))[0] ?? null;
  }
  async logFetch(f: FetchLog) { this.fetches.push(f); }
  async markOnChain(b: BenchmarkId, d: string, round: number, tx: string) {
    const o = this.rows.get(this.key(b, d));
    if (o) this.rows.set(this.key(b, d), { ...o, onChainRound: round, onChainTx: tx });
  }
}

function fromRow(r: typeof rateObservations.$inferSelect): StoredObservation {
  return {
    benchmark: r.benchmark as BenchmarkId, observationDate: r.observationDate, rateMicroPercent: Number(r.rateMicroPercent),
    source: r.source, sourceReference: r.sourceReference, status: r.status as StoredObservation["status"],
    revisions: (r.revisions as StoredObservation["revisions"]) ?? [], firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt,
    onChainRound: r.onChainRound, onChainTx: r.onChainTx,
  };
}

export function drizzleRateRepository(db: any): RateRepository {
  const where = (b: string, d: string) => and(eq(rateObservations.benchmark, b), eq(rateObservations.observationDate, d));
  return {
    async get(b, d) {
      const [r] = await db.select().from(rateObservations).where(where(b, d)).limit(1);
      return r ? fromRow(r) : null;
    },
    async upsert(o) {
      const values = {
        benchmark: o.benchmark, observationDate: o.observationDate, rateMicroPercent: o.rateMicroPercent, source: o.source,
        sourceReference: o.sourceReference, status: o.status, revisions: o.revisions, firstSeenAt: o.firstSeenAt,
        lastSeenAt: o.lastSeenAt, onChainRound: o.onChainRound, onChainTx: o.onChainTx,
      };
      await db.insert(rateObservations).values(values)
        .onConflictDoUpdate({ target: [rateObservations.benchmark, rateObservations.observationDate], set: values });
    },
    async range(b, from, to) {
      const rows = await db.select().from(rateObservations)
        .where(and(eq(rateObservations.benchmark, b), gte(rateObservations.observationDate, from), lte(rateObservations.observationDate, to)))
        .orderBy(rateObservations.observationDate);
      return rows.map(fromRow);
    },
    async latest(b) {
      const [r] = await db.select().from(rateObservations).where(eq(rateObservations.benchmark, b)).orderBy(desc(rateObservations.observationDate)).limit(1);
      return r ? fromRow(r) : null;
    },
    async logFetch(f) {
      await db.insert(rateFetches).values({
        benchmark: f.benchmark, source: f.source, url: f.url, ok: f.ok, error: f.error ?? null, payload: f.payload ?? null,
        accepted: f.accepted, rejected: f.rejected,
      });
    },
    async markOnChain(b, d, round, tx) {
      await db.update(rateObservations).set({ onChainRound: round, onChainTx: tx }).where(where(b, d));
    },
  };
}
