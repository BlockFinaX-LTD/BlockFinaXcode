/**
 * bootstrap.ts — one-time pricing-engine setup, expanded for full asset coverage.
 *
 * Run AFTER `npm run db:push -- --force`:
 *
 *   npx tsx server/pricing/scripts/bootstrap.ts                  # all pairs
 *   npx tsx server/pricing/scripts/bootstrap.ts --only USD/GHS,XAU/USD,BTC/USD  # specific
 *   npx tsx server/pricing/scripts/bootstrap.ts --skip-backfill  # only seed classifications
 *
 * Flow:
 *   1. Insert default classification rows from server/pricing/data/pairs.ts
 *      (50+ assets across FX / commodities / crypto).
 *   2. Backfill ~5y of daily closes per pair, source-aware:
 *        - TwelveData (free tier): FX, gold, crypto. Rate-limited to 8 calls/min.
 *        - Yahoo: silver/platinum/palladium, oil/gas, soft commodities.
 *      Spaced 8 seconds between TwelveData calls so we never trip the rate limit.
 *   3. Smoke-test pricing on USD/GHS, XAU/USD, BTC/USD if all three got backfilled.
 *
 * Idempotent — re-runs are safe; existing rows are not overwritten.
 */

// Env vars loaded via Node's --env-file flag at the call site:
//   npx tsx --env-file=.env server/pricing/scripts/bootstrap.ts
import { seedDefaultClassifications, listAllClassifications } from "../data/classification";
import { backfillPair, getCloseCount } from "../data/historical";
import { fetchUsdRate } from "../data/usdRate";
import { quote } from "../quote";
import { SUPPORTED_PAIRS, getPairSpec } from "../data/pairs";

const TWELVEDATA_INTER_CALL_MS = 8500;   // 8s + 0.5s buffer; free tier is 8 calls/min

function parseArgs() {
  const args = process.argv.slice(2);
  const only = args.find(a => a.startsWith("--only="))?.split("=")[1];
  const onlyPairs = only ? only.split(",").map(s => s.trim()) : null;
  const skipBackfill = args.includes("--skip-backfill");
  return { onlyPairs, skipBackfill };
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const { onlyPairs, skipBackfill } = parseArgs();
  console.log("\n=== BlockFinaX pricing-engine bootstrap ===\n");

  // ── 1. Seed pair classifications ────────────────────────────────────────
  console.log("1. Seeding pair classifications from registry...");
  const newClassifications = await seedDefaultClassifications();
  console.log(`   inserted ${newClassifications} new classification(s).`);
  const all = await listAllClassifications();
  console.log(`   ${all.length} pairs total in DB.`);

  if (skipBackfill) {
    console.log("\n--skip-backfill set, exiting.\n");
    return;
  }

  // ── 2. Backfill historical closes per pair ──────────────────────────────
  const pairsToProcess = onlyPairs
    ? all.filter(c => onlyPairs.includes(c.pair))
    : all;
  console.log(`\n2. Backfilling ~5y of historical closes for ${pairsToProcess.length} pair(s)...`);

  // Order: Yahoo first (no rate limit), TwelveData last (rate-limited).
  // Yahoo can run concurrently; TwelveData must space.
  const yahooPairs = pairsToProcess.filter(c => getPairSpec(c.pair)?.source === "yahoo");
  const twelveDataPairs = pairsToProcess.filter(c => getPairSpec(c.pair)?.source === "twelvedata");

  console.log(`   ${yahooPairs.length} via Yahoo (parallel), ${twelveDataPairs.length} via TwelveData (8s spacing).`);

  // Yahoo — run with limited concurrency (5 at a time) to be polite.
  const YAHOO_CONCURRENCY = 5;
  let yahooSuccess = 0, yahooFail = 0;
  for (let i = 0; i < yahooPairs.length; i += YAHOO_CONCURRENCY) {
    const batch = yahooPairs.slice(i, i + YAHOO_CONCURRENCY);
    await Promise.all(batch.map(async c => {
      try {
        const before = await getCloseCount(c.pair);
        const inserted = await backfillPair(c.pair);
        const after = await getCloseCount(c.pair);
        console.log(`   [yahoo] ${c.pair.padEnd(11)} +${inserted} (had ${before}, now ${after})`);
        yahooSuccess++;
      } catch (err) {
        console.log(`   [yahoo] ${c.pair.padEnd(11)} FAILED — ${err instanceof Error ? err.message : err}`);
        yahooFail++;
      }
    }));
  }

  // TwelveData — must sleep between calls.
  let tdSuccess = 0, tdFail = 0;
  for (const c of twelveDataPairs) {
    try {
      const before = await getCloseCount(c.pair);
      const inserted = await backfillPair(c.pair);
      const after = await getCloseCount(c.pair);
      console.log(`   [td]    ${c.pair.padEnd(11)} +${inserted} (had ${before}, now ${after})`);
      tdSuccess++;
    } catch (err) {
      console.log(`   [td]    ${c.pair.padEnd(11)} FAILED — ${err instanceof Error ? err.message : err}`);
      tdFail++;
    }
    if (twelveDataPairs.indexOf(c) < twelveDataPairs.length - 1) {
      await sleep(TWELVEDATA_INTER_CALL_MS);
    }
  }

  console.log(`\n   Yahoo:      ${yahooSuccess} ok, ${yahooFail} failed`);
  console.log(`   TwelveData: ${tdSuccess} ok, ${tdFail} failed`);

  // ── 3. Smoke-test the pricing pipeline on a few representative pairs ────
  console.log("\n3. Smoke-test: quoting 30-day hedges across asset classes...");
  try {
    const rUsd = await fetchUsdRate();
    console.log(`   live USD risk-free rate: ${(rUsd * 100).toFixed(3)}%`);
  } catch (err) {
    console.log(`   USD rate fetch FAILED — ${err instanceof Error ? err.message : err}`);
  }

  const samples: Array<{ label: string; pair: string; strike: number; payoutCap: number; strikeAbove: boolean }> = [
    { label: "USD/GHS upward",  pair: "USD/GHS",  strike: 13,    payoutCap: 14,    strikeAbove: true  },
    { label: "XAU/USD upward",  pair: "XAU/USD",  strike: 4500,  payoutCap: 5000,  strikeAbove: true  },
    { label: "BTC/USD upward",  pair: "BTC/USD",  strike: 120000, payoutCap: 150000, strikeAbove: true },
  ];
  const expirySeconds = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  for (const s of samples) {
    try {
      const r = await quote({
        pair: s.pair,
        strike: s.strike,
        payoutCap: s.payoutCap,
        expiryUnixSeconds: expirySeconds,
        notional: 10_000,
        strikeAbove: s.strikeAbove,
      });
      console.log(
        `   ${s.label.padEnd(20)} premium $${r.premiumUsd.toFixed(2)} (${(r.premiumRate * 100).toFixed(3)}%)  ` +
        `σ=${(r.breakdown.inputs.sigma * 100).toFixed(1)}%  ` +
        `μ=${r.breakdown.inputs.mu === null ? "n/a" : (r.breakdown.inputs.mu * 100).toFixed(2) + "%"}  ` +
        `tier=${r.breakdown.pairClassification.tier}`,
      );
    } catch (err) {
      console.log(`   ${s.label.padEnd(20)} FAILED — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("\nDone.\n");
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Bootstrap failed:", err);
    process.exit(1);
  });
