/**
 * Market-rate aggregator: reads every source on its own schedule, works out one rate per pair,
 * and records every source and every rate. Recording only: nothing prices or settles on this
 * until it has a stable record (docs: oracles-and-settlement/market-rates).
 */
import { aggregate, DEFAULT_RULES, type CompositeRate, type SourceQuote } from "./aggregate";
import { CURRENCIES, SOURCES } from "./sources";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS market_rate_quotes (
    id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
    source text NOT NULL, kind text NOT NULL, pair text NOT NULL,
    bid double precision, ask double precision, mid double precision NOT NULL,
    volume_usd double precision, ads integer, quoted_at timestamptz NOT NULL,
    weight double precision NOT NULL DEFAULT 0, included boolean NOT NULL DEFAULT false, reason text
  );
  CREATE INDEX IF NOT EXISTS market_rate_quotes_pair_at ON market_rate_quotes (pair, at DESC);
  CREATE TABLE IF NOT EXISTS market_rates (
    id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
    pair text NOT NULL, rate double precision NOT NULL, sources integer NOT NULL, rules jsonb NOT NULL
  );
  CREATE INDEX IF NOT EXISTS market_rates_pair_at ON market_rates (pair, at DESC);
`;

interface Db { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

const latest = new Map<string, SourceQuote[]>();      // source id -> its last quotes
const lastRate = new Map<string, CompositeRate>();     // pair -> last good composite
const errors = new Map<string, { at: number; message: string }>();
let started = false;

export function marketRates() {
  const now = Date.now();
  return CURRENCIES.map((c) => {
    const pair = `USD/${c}`;
    const live = aggregate(pair, [...latest.values()].flat(), now);
    const good = live ?? lastRate.get(pair) ?? null;
    return { pair, rate: good?.rate ?? null, sources: good?.sources ?? 0, held: !live && !!good, at: good?.at ?? null, quotes: (live ?? good)?.quotes ?? [] };
  });
}
/**
 * The market rate for one pair, for pricing and settlement: the live composite, or the last
 * good one if it is under `maxHoldMs` old. Null means no usable market rate.
 */
export function marketRateFor(pair: string, maxHoldMs = 6 * 3600_000): { rate: number; sources: number; at: number; held: boolean } | null {
  const live = aggregate(pair, [...latest.values()].flat(), Date.now());
  if (live) { lastRate.set(pair, live); return { rate: live.rate, sources: live.sources, at: live.at, held: false }; }
  const last = lastRate.get(pair);
  if (last && Date.now() - last.at <= maxHoldMs) return { rate: last.rate, sources: last.sources, at: last.at, held: true };
  return null;
}

export const marketRateErrors = () => [...errors.entries()].map(([source, e]) => ({ source, ...e }));

export async function startMarketRates(): Promise<void> {
  if (started || process.env.MARKET_RATE === "off") return;
  started = true;
  const { pool } = await import("../db");
  const db = pool as unknown as Db | null;
  if (db) await db.query(SCHEMA).catch((e) => console.warn("[market-rate] schema:", e.message));
  // Start from the last recorded rate per pair, so prices do not fall back while sources connect.
  if (db) {
    const prior = await db.query(`SELECT DISTINCT ON (pair) pair, rate, sources, extract(epoch from at) * 1000 AS at FROM market_rates WHERE at > now() - interval '6 hours' ORDER BY pair, at DESC`).catch(() => ({ rows: [] as any[] }));
    for (const r of prior.rows) lastRate.set(r.pair, { pair: r.pair, rate: Number(r.rate), sources: Number(r.sources), quotes: [], at: Number(r.at) });
  }

  for (const s of SOURCES) {
    const run = async () => {
      try {
        latest.set(s.id, await s.read());
        errors.delete(s.id);
      } catch (e) {
        errors.set(s.id, { at: Date.now(), message: (e as Error).message.slice(0, 200) });
      }
    };
    void run();
    setInterval(run, s.everyMs).unref();
  }

  // Once a minute: work out each pair and record it with every source behind it.
  const record = async () => {
    const now = Date.now();
    const all = [...latest.values()].flat();
    for (const c of CURRENCIES) {
      const pair = `USD/${c}`;
      const r = aggregate(pair, all, now);
      if (r) lastRate.set(pair, r);
      if (!db) continue;
      try {
        const quotes = r?.quotes ?? all.filter((q) => q.pair === pair).map((q) => ({ ...q, weight: 0, included: false, reason: undefined }));
        for (const q of quotes) {
          await db.query(`INSERT INTO market_rate_quotes (source, kind, pair, bid, ask, mid, volume_usd, ads, quoted_at, weight, included, reason)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9 / 1000.0),$10,$11,$12)`,
            [q.source, q.kind, q.pair, q.bid, q.ask, q.mid, q.volumeUsd ?? null, q.ads ?? null, q.at, q.weight, q.included, q.reason ?? null]);
        }
        if (r) await db.query(`INSERT INTO market_rates (pair, rate, sources, rules) VALUES ($1,$2,$3,$4)`, [pair, r.rate, r.sources, DEFAULT_RULES]);
      } catch (e) {
        console.warn("[market-rate] record:", (e as Error).message);
      }
    }
  };
  setTimeout(() => void record(), 20_000).unref();
  setInterval(() => void record(), 60_000).unref();

  // Keep 30 days.
  setInterval(() => {
    if (!db) return;
    void db.query(`DELETE FROM market_rate_quotes WHERE at < now() - interval '30 days'`).catch(() => {});
    void db.query(`DELETE FROM market_rates WHERE at < now() - interval '30 days'`).catch(() => {});
  }, 6 * 3600_000).unref();
  console.log("[market-rate] recording started:", SOURCES.map((s) => s.id).join(", "));
}
