/**
 * historical.ts — DB layer for historical FX closes.
 *
 * Two operations:
 *   1. backfillPair(pair) — pull ~5y of daily closes from TwelveData and bulk-insert.
 *      One-time setup per pair. Idempotent — re-running upserts on (pair, date).
 *
 *   2. refreshLatestClose(pair) — pull just the most recent daily close and insert
 *      if not already present. Called by the daily cron.
 *
 * Reads:
 *   3. getRecentCloses(pair, n) — pull last n closes from DB, oldest-first.
 *      Used by drift and vol modules.
 */

import { db } from "../../db";
import { historicalFxCloses, type HistoricalFxClose } from "../../../shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { fetchDailyTimeSeries as fetchTwelveDataSeries, fetchLatestClose as fetchTwelveDataLatest, type DailyClose } from "./twelvedata";
import { fetchYahooDailyTimeSeries, fetchYahooLatestClose } from "./yahoo";
import { requirePairSpec } from "./pairs";

/**
 * Source-aware time-series fetcher.
 * Dispatches to TwelveData or Yahoo based on the pair's registry entry.
 */
async function fetchSeriesForPair(displayPair: string, outputsize: number): Promise<DailyClose[]> {
  const spec = requirePairSpec(displayPair);
  if (spec.source === "twelvedata") {
    return fetchTwelveDataSeries(spec.sourceSymbol, outputsize);
  }
  // Yahoo: range is fixed; outputsize is informational.
  return fetchYahooDailyTimeSeries(spec.sourceSymbol, "5y");
}

async function fetchLatestForPair(displayPair: string): Promise<DailyClose> {
  const spec = requirePairSpec(displayPair);
  if (spec.source === "twelvedata") {
    return fetchTwelveDataLatest(spec.sourceSymbol);
  }
  return fetchYahooLatestClose(spec.sourceSymbol);
}

/**
 * Backfill 5 years of daily closes for a pair.
 * Safe to re-run — uses ON CONFLICT to upsert on (pair, date).
 *
 * @param pair        e.g. "USD/GHS" or "XAU/USD" — must be in pricing-engine registry
 * @param outputsize  Days to fetch. Default ~5 years of business days.
 *                    Ignored for Yahoo source (range is hardcoded to "5y").
 * @returns Number of rows inserted (excluding ones that already existed).
 */
export async function backfillPair(pair: string, outputsize: number = 1300): Promise<number> {
  const spec = requirePairSpec(pair);
  const series = await fetchSeriesForPair(pair, outputsize);
  if (series.length === 0) return 0;

  const rows = series.map(s => ({
    pair,                                  // store under the displayPair name
    date: s.date,
    close: String(s.close),
    source: spec.source,                   // 'twelvedata' or 'yahoo'
  }));

  // Bulk insert with onConflictDoNothing on (pair, date) — idempotent re-runs.
  const result = await db
    .insert(historicalFxCloses)
    .values(rows)
    .onConflictDoNothing({ target: [historicalFxCloses.pair, historicalFxCloses.date] })
    .returning({ id: historicalFxCloses.id });

  return result.length;
}

/**
 * Pull the most recent close for a pair and insert if new.
 * Called by the daily cron at ~00:30 UTC.
 *
 * @returns true if a new row was inserted, false if today's close was already in DB.
 */
export async function refreshLatestClose(pair: string): Promise<boolean> {
  const spec = requirePairSpec(pair);
  const latest = await fetchLatestForPair(pair);

  const existing = await db
    .select({ id: historicalFxCloses.id })
    .from(historicalFxCloses)
    .where(sql`${historicalFxCloses.pair} = ${pair} AND ${historicalFxCloses.date} = ${latest.date}`)
    .limit(1);

  if (existing.length > 0) return false;

  await db.insert(historicalFxCloses).values({
    pair,
    date: latest.date,
    close: String(latest.close),
    source: spec.source,
  });
  return true;
}

/**
 * Read the last n daily closes for a pair, oldest-first.
 *
 * Used by vol (n=61 → 60 returns) and drift (n=large → 5y).
 */
export async function getRecentCloses(pair: string, n: number): Promise<HistoricalFxClose[]> {
  const rows = await db
    .select()
    .from(historicalFxCloses)
    .where(eq(historicalFxCloses.pair, pair))
    .orderBy(desc(historicalFxCloses.date))
    .limit(n);

  return rows.reverse(); // return oldest-first for convenience
}

/**
 * Total close count for a pair — useful for "is this pair backfilled?" checks.
 */
export async function getCloseCount(pair: string): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(historicalFxCloses)
    .where(eq(historicalFxCloses.pair, pair));
  return rows[0]?.c ?? 0;
}
