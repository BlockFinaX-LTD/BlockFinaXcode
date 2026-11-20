/**
 * Market-rate history for the chart, and candles built from it.
 *
 * Before BlockFinaX recorded its own market rate, history comes from Monierate's composite
 * index (USD/NGN from May 2024, GHS and KES from September 2026). From the first own record
 * onwards, candles use the aggregated rate recorded every minute, and the current candle
 * follows the live rate, updated every few seconds.
 */
import { CURRENCIES } from "./sources";
import { marketTicks } from "./service";

interface Db { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

export const HISTORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS market_rate_history (
    pair text NOT NULL, at timestamptz NOT NULL, rate double precision NOT NULL, source text NOT NULL,
    PRIMARY KEY (pair, at)
  );
`;

const PAGE = 500;

const finished = new Set<string>(); // pairs whose oldest history is already stored

async function page(key: string, c: string, n: number): Promise<{ at: number; rate: number }[] & { full?: boolean }> {
  const r = await fetch(`https://api.monierate.com/core/index/history?pair=usd${c.toLowerCase()}&limit=${PAGE}&page=${n}`, { headers: { api_key: key, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Monierate history answered ${r.status}`); // 402: the Monierate balance is used up
  const entries = ((await r.json())?.data?.entries ?? []) as any[];
  const rows = entries.map((e) => ({ at: Date.parse(e.timestamp), rate: Number(e.composite_rate) })).filter((x) => x.at > 0 && x.rate > 0) as any;
  rows.full = entries.length === PAGE;
  return rows;
}
async function save(db: Db, pair: string, rows: { at: number; rate: number }[]) {
  if (!rows.length) return;
  await db.query(
    `INSERT INTO market_rate_history (pair, at, rate, source)
     SELECT $1, to_timestamp(a / 1000.0), r, 'monierate' FROM unnest($2::float8[], $3::float8[]) AS t(a, r)
     ON CONFLICT DO NOTHING`,
    [pair, rows.map((x) => x.at), rows.map((x) => x.rate)],
  );
}
const pause = () => new Promise((ok) => setTimeout(ok, 250));

/**
 * Download Monierate history (each call is paid): first anything newer than what is stored,
 * then, page by page, anything older, until the oldest record is reached. Stops on any error,
 * and carries on from where it stopped next time.
 */
export async function backfillHistory(db: Db): Promise<void> {
  const key = process.env.Rate_API || process.env.MONIERATE_API_KEY;
  if (!key || process.env.MARKET_HISTORY === "off") return;
  for (const c of CURRENCIES) {
    const pair = `USD/${c}`;
    const have = await db.query(`SELECT extract(epoch from max(at)) * 1000 AS at FROM market_rate_history WHERE pair = $1`, [pair]);
    const newest = Number(have.rows[0]?.at) || 0;
    let added = 0;
    // Newer first: pages run newest to oldest, so stop at the first record already stored.
    for (let n = 1; n < 2000; n++) {
      const rows = await page(key, c, n);
      const fresh = rows.filter((x) => x.at > newest);
      await save(db, pair, fresh); added += fresh.length;
      if (!rows.full || fresh.length < rows.length) break;
      await pause();
    }
    // Then older: stored records are one unbroken run from the newest, so the next page follows on.
    if (!finished.has(pair)) {
      const count = Number((await db.query(`SELECT count(*) AS n FROM market_rate_history WHERE pair = $1`, [pair])).rows[0]?.n) || 0;
      for (let n = Math.floor(count / PAGE) + 1; n < 2000; n++) {
        const rows = await page(key, c, n);
        await save(db, pair, rows); added += rows.length;
        if (!rows.full) { finished.add(pair); break; }
        await pause();
      }
    }
    if (added) console.log(`[market-rate] history: ${pair} +${added}`);
  }
}

/** Candle bucket in SQL: fixed minutes, or calendar week (Monday) or month, in UTC. */
function bucketSql(minutes: number): string {
  if (minutes === 10080) return `extract(epoch from date_trunc('week', at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') * 1000`;
  if (minutes === 43200 || minutes === 0) return `extract(epoch from date_trunc('month', at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') * 1000`;
  return `floor(extract(epoch from at) / ${minutes * 60}) * ${minutes * 60_000}`;
}
const bucketJs = (t: number, minutes: number) => {
  const d = new Date(t);
  if (minutes === 10080) return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * 86_400_000;
  if (minutes === 43200 || minutes === 0) return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return Math.floor(t / (minutes * 60_000)) * minutes * 60_000;
};

/** How far back each timeframe looks (about 600 candles, or everything for MAX). */
const lookbackMs = (minutes: number) => (minutes === 0 ? 50 * 365 * 86_400_000 : minutes === 43200 ? 30 * 365 * 86_400_000 : minutes * 60_000 * 600);

/**
 * Market-rate candles for a pair. `minutes` is minutes per candle; 10080 is weekly, 43200 monthly,
 * 0 all history by month. Empty when nothing is recorded.
 */
export async function marketCandles(pair: string, minutes: number): Promise<Candle[]> {
  const { pool } = await import("../db");
  const db = pool as unknown as Db | null;
  if (!db) return [];
  const from = new Date(Date.now() - lookbackMs(minutes));
  const b = bucketSql(minutes);
  const { rows } = await db.query(
    `WITH own AS (SELECT at, rate FROM market_rates WHERE pair = $1 AND at >= $2),
          first_own AS (SELECT coalesce(min(at), 'infinity'::timestamptz) AS at FROM market_rates WHERE pair = $1),
          pts AS (
            SELECT at, rate FROM market_rate_history WHERE pair = $1 AND at >= $2 AND at < (SELECT at FROM first_own)
            UNION ALL SELECT at, rate FROM own)
     SELECT ${b} AS t, (array_agg(rate ORDER BY at))[1] AS o, max(rate) AS h, min(rate) AS l,
            (array_agg(rate ORDER BY at DESC))[1] AS c, extract(epoch from max(at)) * 1000 AS last
     FROM pts GROUP BY 1 ORDER BY 1`,
    [pair, from],
  );
  const out: Candle[] = rows.map((r) => ({ t: Number(r.t), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: 0 }));
  // The live rate, every few seconds since the last recorded minute.
  const lastAt = rows.length ? Number(rows[rows.length - 1].last) : 0;
  for (const x of marketTicks(pair, lastAt + 1)) {
    const t = bucketJs(x.t, minutes);
    const last = out[out.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, x.rate); last.l = Math.min(last.l, x.rate); last.c = x.rate; }
    else if (!last || t > last.t) out.push({ t, o: last?.c ?? x.rate, h: Math.max(x.rate, last?.c ?? x.rate), l: Math.min(x.rate, last?.c ?? x.rate), c: x.rate, v: 0 });
  }
  // Each candle opens where the one before closed, so the chart has no gaps between candles.
  for (let i = 1; i < out.length; i++) {
    const p = out[i - 1].c, k = out[i];
    k.o = p; k.h = Math.max(k.h, p); k.l = Math.min(k.l, p);
  }
  return out.slice(-600);
}
