/**
 * Testnet pricing data, loaded on start (APP_ENV=testnet only).
 *
 * The pricing engine reads daily FX closes and pair classifications from the
 * database. Testnet has its own empty database, so it seeds the classifications
 * and backfills about five years of Yahoo closes for the pairs it trades. Pairs
 * that already have history get only the last 30 days topped up, so restarts are
 * quick. Testnet has no TwelveData key, so the daily refresh is off there; instead this
 * runs again every 12 hours, or quotes stop once the newest close is 8 days old.
 * Production is never touched by this.
 */
import { seedDefaultClassifications } from "./data/classification";
import { backfillPairWithRange, getCloseCount } from "./data/historical";
import { WATCHLIST } from "../domain/rates";

// The watchlist, minus GBP/GHS which Yahoo covers too sparsely to backfill.
const DEFAULT_PAIRS = WATCHLIST.filter((p) => p !== "GBP/GHS").join(",");
const ENOUGH_CLOSES = 250;
const TOP_UP_DAYS = 30;
const REFRESH_MS = 12 * 60 * 60 * 1000;

export async function bootstrapTestnetPricing() {
  const pairs = (process.env.TESTNET_PRICING_PAIRS || DEFAULT_PAIRS).split(",").map((p) => p.trim()).filter(Boolean);
  try {
    const seeded = await seedDefaultClassifications();
    if (seeded) console.log(`[testnet-pricing] seeded ${seeded} pair classifications`);
  } catch (err) {
    console.warn("[testnet-pricing] classification seed failed:", (err as Error).message);
  }
  const now = Math.floor(Date.now() / 1000);
  const fiveYearsAgo = now - 5 * 365 * 86_400;
  for (const pair of pairs) {
    try {
      const full = (await getCloseCount(pair)) < ENOUGH_CLOSES;
      const r = await backfillPairWithRange(pair, full ? fiveYearsAgo : now - TOP_UP_DAYS * 86_400, now);
      if (full || r.inserted) console.log(`[testnet-pricing] ${pair}: ${full ? "backfilled" : "topped up"}`, JSON.stringify(r).slice(0, 120));
    } catch (err) {
      console.warn(`[testnet-pricing] ${pair}: backfill failed: ${(err as Error).message}`);
    }
  }
}

/** Load now, then keep the closes current every 12 hours. */
export function startTestnetPricing() {
  const run = () => bootstrapTestnetPricing().catch((err) => console.warn("[testnet-pricing] refresh failed:", (err as Error).message));
  void run();
  setInterval(run, REFRESH_MS).unref();
}
