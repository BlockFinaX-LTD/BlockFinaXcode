/**
 * backfill-30y.ts — pull 30 years of daily closes for every Yahoo-sourced pair.
 *
 * Yahoo's free chart API accepts arbitrary period1/period2 in UNIX seconds, so
 * we ask for everything from 1996-01-01 to today. Yahoo silently clamps to its
 * earliest available date per ticker — for most FX pairs that's ~2003, for
 * commodities ~2000, for crypto from listing date.
 *
 * Run:
 *   npx tsx --env-file=.env server/pricing/scripts/backfill-30y.ts
 *   npx tsx --env-file=.env server/pricing/scripts/backfill-30y.ts --only USD/KES,USD/BRL
 *   npx tsx --env-file=.env server/pricing/scripts/backfill-30y.ts --tier majorEM
 *   npx tsx --env-file=.env server/pricing/scripts/backfill-30y.ts --asset-class commodity
 *
 * Idempotent — uses ON CONFLICT (pair, date) DO NOTHING, so safe to re-run.
 * Existing rows are kept; new rows fill gaps.
 *
 * Concurrency:
 *   - Yahoo's anonymous free tier tolerates ~5 parallel requests fine.
 *   - We chunk at 5 with a 250ms inter-batch pause to be polite.
 *
 * After this runs, the pricing engine has real σ_LR (long-run vol) and μ
 * (empirical drift) for every pair, replacing the tier defaults. The CLI
 * (`pricing:price`) reads σ from your local --sigma flag; the production
 * `quote()` orchestrator pulls σ_LR and μ from the DB automatically.
 */

import { seedDefaultClassifications, listAllClassifications } from "../data/classification";
import { backfillPairWithRange, getCloseCount } from "../data/historical";
import { SUPPORTED_PAIRS, getPairSpec, type PairTier, type AssetClass } from "../data/pairs";

// 1996-01-01 UTC. Yahoo will clamp to whatever's earlier available.
const PERIOD1_1996_01_01 = 820454400;
const NOW_UNIX = Math.floor(Date.now() / 1000);

interface BackfillResult {
  pair: string;
  oldestDate: string | null;
  newestDate: string | null;
  inserted: number;
  totalSeries: number;
  totalInDb: number;
  yearsCovered: number;
  error?: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const only = args.find(a => a.startsWith("--only="))?.split("=")[1]?.split(",").map(s => s.trim());
  const tier = args.find(a => a.startsWith("--tier="))?.split("=")[1] as PairTier | undefined;
  const assetClass = args.find(a => a.startsWith("--asset-class="))?.split("=")[1] as AssetClass | undefined;
  return { only, tier, assetClass };
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const { only, tier, assetClass } = parseArgs();
  console.log("\n=== BlockFinaX 30-year history backfill ===\n");

  // Filter to Yahoo-sourced pairs (only Yahoo supports period-range fetches)
  let pairs = SUPPORTED_PAIRS.filter(p => p.source === "yahoo");
  if (only) pairs = pairs.filter(p => only.includes(p.displayPair));
  if (tier) pairs = pairs.filter(p => p.tier === tier);
  if (assetClass) pairs = pairs.filter(p => p.assetClass === assetClass);

  if (pairs.length === 0) {
    console.log("No pairs match the filters. Available filters:");
    console.log("  --only=USD/KES,USD/BRL,...");
    console.log("  --tier=g10|majorEM|lessLiquidEM|frontierEM|pegged|commodityMetal|commodityEnergy|commodityAgri|cryptoMajor|cryptoOther");
    console.log("  --asset-class=fx|commodity|crypto");
    return;
  }

  console.log(`Pulling 30y (1996-01-01 → today) for ${pairs.length} pair(s).\n`);

  // First make sure classifications exist (so subsequent reads from `quote()` work)
  const newClass = await seedDefaultClassifications();
  if (newClass > 0) console.log(`Seeded ${newClass} new classification(s).\n`);

  // Run in batches of 5 parallel requests with a 250ms pause between batches
  const BATCH = 5;
  const PAUSE_MS = 250;
  const results: BackfillResult[] = [];

  for (let i = 0; i < pairs.length; i += BATCH) {
    const batch = pairs.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(async p => {
      try {
        const before = await getCloseCount(p.displayPair);
        const r = await backfillPairWithRange(p.displayPair, PERIOD1_1996_01_01, NOW_UNIX);
        const after = await getCloseCount(p.displayPair);
        const years = r.oldestDate && r.newestDate
          ? (Date.parse(r.newestDate) - Date.parse(r.oldestDate)) / (365.25 * 86_400_000)
          : 0;
        const result: BackfillResult = {
          pair: p.displayPair,
          oldestDate: r.oldestDate,
          newestDate: r.newestDate,
          inserted: r.inserted,
          totalSeries: r.totalSeries,
          totalInDb: after,
          yearsCovered: years,
        };
        const flag = years >= 20 ? "✓✓" : years >= 10 ? " ✓" : years >= 5 ? "  " : " !";
        console.log(
          ` ${flag} ${p.displayPair.padEnd(11)} ${p.tier.padEnd(15)} ` +
          `${r.oldestDate ?? "—".padEnd(10)} → ${r.newestDate ?? "—"} ` +
          `${years.toFixed(1).padStart(5)}y  ` +
          `(${r.totalSeries} closes from Yahoo, +${r.inserted} new, ${after} in DB before existed=${before})`,
        );
        return result;
      } catch (err: any) {
        const message = err?.message ?? String(err);
        console.log(` ✗  ${p.displayPair.padEnd(11)} ${p.tier.padEnd(15)} FAILED — ${message}`);
        return {
          pair: p.displayPair,
          oldestDate: null,
          newestDate: null,
          inserted: 0,
          totalSeries: 0,
          totalInDb: 0,
          yearsCovered: 0,
          error: message,
        };
      }
    }));
    results.push(...batchResults);
    if (i + BATCH < pairs.length) await sleep(PAUSE_MS);
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n=== Summary ===`);
  console.log(`  Pairs processed     : ${results.length}`);
  console.log(`  Succeeded           : ${results.filter(r => !r.error).length}`);
  console.log(`  Failed              : ${results.filter(r => r.error).length}`);
  console.log(`  ≥20 years coverage  : ${results.filter(r => r.yearsCovered >= 20).length}`);
  console.log(`  10–20 years         : ${results.filter(r => r.yearsCovered >= 10 && r.yearsCovered < 20).length}`);
  console.log(`  5–10 years          : ${results.filter(r => r.yearsCovered >= 5 && r.yearsCovered < 10).length}`);
  console.log(`  < 5 years           : ${results.filter(r => r.yearsCovered < 5 && !r.error).length}`);

  const failed = results.filter(r => r.error);
  if (failed.length > 0) {
    console.log(`\n  Failed pairs:`);
    for (const f of failed) console.log(`    - ${f.pair}: ${f.error}`);
  }

  const sparse = results.filter(r => !r.error && r.yearsCovered < 5);
  if (sparse.length > 0) {
    console.log(`\n  Sparse pairs (< 5 yrs — Yahoo may not have deep history for these):`);
    for (const s of sparse) console.log(`    - ${s.pair} (${s.totalSeries} closes, oldest ${s.oldestDate})`);
  }

  console.log();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
