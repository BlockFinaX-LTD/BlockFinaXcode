/**
 * Testnet pricing data, loaded on start (APP_ENV=testnet only).
 *
 * The pricing engine reads daily FX closes and pair classifications from the
 * database. Testnet has its own empty database, so it seeds the classifications
 * and backfills about five years of Yahoo closes for the pairs it trades. Pairs
 * that already have history are skipped, so restarts are quick; the daily refresh
 * keeps them current afterwards. Production is never touched by this.
 */
import { seedDefaultClassifications } from "./data/classification";
import { backfillPairWithRange, getCloseCount } from "./data/historical";

const DEFAULT_PAIRS = "USD/NGN,USD/GHS,USD/KES,USD/ZAR,USD/EGP";
const ENOUGH_CLOSES = 250;

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
      if ((await getCloseCount(pair)) >= ENOUGH_CLOSES) continue;
      const r = await backfillPairWithRange(pair, fiveYearsAgo, now);
      console.log(`[testnet-pricing] ${pair}: backfilled`, JSON.stringify(r).slice(0, 120));
    } catch (err) {
      console.warn(`[testnet-pricing] ${pair}: backfill failed: ${(err as Error).message}`);
    }
  }
}
