/**
 * dailyRefresh.ts — daily cron that pulls yesterday's close per pair.
 *
 * Wired into the server's startup in server/index.ts. Runs every 24h with a
 * jitter on first launch so multiple instances don't hammer TwelveData
 * simultaneously. ~5 API calls per day per pair (one per day per pair).
 *
 * Idempotent: if today's close is already in the DB, refreshLatestClose()
 * just returns false without inserting.
 */

import { listAllClassifications } from "./data/classification";
import { refreshLatestClose } from "./data/historical";

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;     // every 24h
const INITIAL_DELAY_MS    = 60_000 + Math.floor(Math.random() * 60_000); // 1-2 min jitter

let timer: NodeJS.Timeout | null = null;

/** Run one refresh cycle: pull latest close for every classified pair. */
export async function runRefreshCycle(): Promise<{ refreshed: string[]; alreadyCurrent: string[]; errors: string[] }> {
  const refreshed: string[] = [];
  const alreadyCurrent: string[] = [];
  const errors: string[] = [];

  let pairs;
  try {
    pairs = await listAllClassifications();
  } catch (err) {
    errors.push(`listAllClassifications failed: ${err instanceof Error ? err.message : err}`);
    return { refreshed, alreadyCurrent, errors };
  }

  for (const c of pairs) {
    try {
      const inserted = await refreshLatestClose(c.pair);
      if (inserted) refreshed.push(c.pair);
      else alreadyCurrent.push(c.pair);
    } catch (err) {
      errors.push(`${c.pair}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { refreshed, alreadyCurrent, errors };
}

/**
 * Start the daily refresh loop. Safe to call once at startup.
 * Subsequent calls are no-ops.
 *
 * Disabled if TWELVEDATA_API_KEY is missing — pricing will still serve from
 * existing DB data but won't get fresh closes.
 */
export function startDailyRefresh(): void {
  if (timer) return;
  if (!process.env.TWELVEDATA_API_KEY) {
    console.log("[Pricing] daily refresh disabled — TWELVEDATA_API_KEY not set");
    return;
  }

  console.log(`[Pricing] daily refresh starting in ${(INITIAL_DELAY_MS / 1000).toFixed(0)}s, then every 24h`);
  timer = setTimeout(async function tick() {
    try {
      const result = await runRefreshCycle();
      if (result.refreshed.length > 0) {
        console.log(`[Pricing] refreshed: ${result.refreshed.join(", ")}`);
      }
      if (result.errors.length > 0) {
        console.warn(`[Pricing] refresh errors: ${result.errors.join(" | ")}`);
      }
    } catch (err) {
      console.error("[Pricing] refresh cycle threw:", err);
    } finally {
      timer = setTimeout(tick, REFRESH_INTERVAL_MS);
    }
  }, INITIAL_DELAY_MS);
}

/** Stop the loop (mainly for tests). */
export function stopDailyRefresh(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
