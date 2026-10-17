/**
 * Polls official sources for the benchmarks this deployment uses.
 *
 * Interest-rate benchmarks publish once a business day, so a 30-minute poll finds each
 * value well within its 4-hour grace. Startup reads the last 30 observations to fill gaps.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { drizzleRateRepository, oracleBenchmarks, refreshBenchmark } from "./service";
import { RateOracleSubmitter, submitterConfigFromEnv } from "./submitter";

const POLL_MS = 30 * 60_000;

/**
 * Creates the observation store if the startup schema push did not (it can stop early on
 * unrelated drift). Matches shared/rate-oracle-schema.ts; every statement is idempotent.
 */
async function ensureTables(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS rate_observations (
    id serial PRIMARY KEY, benchmark text NOT NULL, observation_date text NOT NULL,
    rate_micro_percent bigint NOT NULL, source text NOT NULL, source_reference text NOT NULL,
    status text NOT NULL DEFAULT 'PUBLISHED', revisions jsonb NOT NULL DEFAULT '[]'::jsonb,
    first_seen_at timestamp NOT NULL DEFAULT now(), last_seen_at timestamp NOT NULL DEFAULT now(),
    fetch_id integer, on_chain_round integer, on_chain_tx text)`);
  await db.execute(sql`ALTER TABLE rate_observations ADD COLUMN IF NOT EXISTS on_chain_contract text`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS rate_observations_identity ON rate_observations (benchmark, observation_date)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS rate_fetches (
    id serial PRIMARY KEY, benchmark text NOT NULL, source text NOT NULL, url text NOT NULL,
    fetched_at timestamp NOT NULL DEFAULT now(), ok boolean NOT NULL, error text, payload text,
    accepted integer NOT NULL DEFAULT 0, rejected jsonb NOT NULL DEFAULT '[]'::jsonb)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rate_fetches_benchmark ON rate_fetches (benchmark, fetched_at)`);
}

export function startRateOracleScheduler(): void {
  const benchmarks = oracleBenchmarks();
  if (benchmarks.length === 0) return;
  const repo = drizzleRateRepository(db);
  const cfg = submitterConfigFromEnv();
  const submitter = cfg ? new RateOracleSubmitter(cfg) : null;

  const run = async (count: number) => {
    for (const b of benchmarks) {
      try {
        const s = await refreshBenchmark(repo, b.id, undefined, count);
        if (s.accepted || s.revised || s.rejected.length) {
          console.log(`[RateOracle] ${b.id} via ${s.source}: ${s.accepted} new, ${s.revised} revised, ${s.rejected.length} rejected`);
        }
        for (const r of s.rejected) console.warn(`[RateOracle] ${b.id} rejected ${r.observationDate} ${r.ratePercent}: ${r.code}`);
      } catch (err) {
        console.warn(`[RateOracle] ${b.id} fetch failed: ${(err as Error).message}`);
      }
      if (!submitter) continue;
      // Locked values go on chain; values still inside their revision window wait.
      const r = await submitter.sync(repo, b.id);
      if (r.submitted || r.recorded) console.log(`[RateOracle] ${b.id} on chain: ${r.submitted} submitted, ${r.recorded} already final`);
      for (const e of r.errors) console.warn(`[RateOracle] ${e}`);
    }
  };

  console.log(`[RateOracle] Watching ${benchmarks.map((b) => b.id).join(", ")}${submitter ? `; submitting to ${cfg!.contractId} with ${cfg!.nodes.length} nodes` : "; on-chain submission off"}`);
  setTimeout(async () => {
    try {
      await ensureTables();
    } catch (err) {
      console.warn(`[RateOracle] could not prepare tables: ${(err as Error).message}`);
    }
    void run(260); // about a year of business days, for the benchmark charts
    setInterval(() => void run(5), POLL_MS);
  }, 30_000);
}
