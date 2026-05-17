/**
 * calibrate-jumps.ts — fit Merton jump-diffusion parameters per pair from
 * historical_fx_closes.
 *
 * Method (Lee–Mykland-style threshold detection):
 *   1. Load all daily closes for the pair, compute log returns.
 *   2. For each return u_t, compute the local σ over the prior `WINDOW` days
 *      EXCLUDING t itself (so a jump-day doesn't inflate its own threshold).
 *   3. Flag u_t as a JUMP if |u_t| > K·σ_local. K=4 → ~6e-5 false-positive rate
 *      under normal returns, so we mostly catch real jumps.
 *   4. From the detected jump days, compute:
 *        λ̂  = N_jumps / yearsCovered      (intensity in events/year)
 *        μ̂_J = mean of jump returns        (signed — captures asymmetry)
 *        σ̂_J = stdev of jump returns
 *   5. Apply sanity floors so we never write nonsense params.
 *   6. Merge into pair_classification.notes as JSON:
 *        { "jump": { "lambda": ..., "jumpMean": ..., "jumpStd": ... }, "humanNote": ... }
 *      Engine reads this via getPairJumpParams() automatically.
 *
 * Run:
 *   npm run pricing:calibrate-jumps                       # all pairs
 *   npm run pricing:calibrate-jumps -- --only=USD/KES,USD/GHS
 *   npm run pricing:calibrate-jumps -- --threshold=3.5    # more sensitive (more false positives)
 *   npm run pricing:calibrate-jumps -- --dry-run          # print what would be written, don't write
 *
 * Idempotent — overwrites the existing `jump` key, preserves the `humanNote`
 * and `garch` keys if present.
 */

import { db } from "../../db";
import { historicalFxCloses, pairClassification } from "../../../shared/schema";
import { eq, asc } from "drizzle-orm";
import { SUPPORTED_PAIRS, getPairSpec, type PairTier } from "../data/pairs";
import { TIER_JUMP_PARAMS } from "../data/jump-params";

const DEFAULT_THRESHOLD_K = 4.0;
const LOCAL_WINDOW = 30;
const MIN_CLOSES = 252;
const TRADING_DAYS_PER_YEAR = 252;

// Sanity floors / ceilings — outside these, the calibration is suspicious
const MIN_LAMBDA = 0.05;     // at least one jump every 20 years (otherwise model collapses to GK)
const MAX_LAMBDA = 12;        // crypto-tier max
const MAX_JUMP_STD = 0.50;   // 50% — anything wider and we have multiple regimes mixed in
const MIN_JUMP_STD = 0.02;   // 2% — anything smaller isn't really a "jump"

interface JumpCalibration {
  pair: string;
  tier: PairTier;
  yearsCovered: number;
  nCloses: number;
  nJumps: number;
  lambda: number;
  jumpMean: number;
  jumpStd: number;
  tierDefault: { lambda: number; jumpMean: number; jumpStd: number };
  threshold: number;
}

function rollingStdev(returns: number[], windowEnd: number, window: number): number {
  // Use returns[windowEnd-window .. windowEnd-1] (excluding windowEnd itself)
  const start = Math.max(0, windowEnd - window);
  const end = windowEnd;
  if (end - start < 5) return 0;
  let sumSq = 0;
  for (let i = start; i < end; i++) sumSq += returns[i] * returns[i];
  return Math.sqrt(sumSq / (end - start));   // zero-mean variance
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sq = xs.reduce((s, x) => s + (x - mean) * (x - mean), 0);
  return Math.sqrt(sq / xs.length);
}

async function calibrateJumps(pair: string, thresholdK: number): Promise<JumpCalibration | null> {
  const spec = getPairSpec(pair);
  if (!spec) throw new Error(`Pair ${pair} not in registry`);

  const rows = await db
    .select({ date: historicalFxCloses.date, close: historicalFxCloses.close })
    .from(historicalFxCloses)
    .where(eq(historicalFxCloses.pair, pair))
    .orderBy(asc(historicalFxCloses.date));

  if (rows.length < MIN_CLOSES) {
    console.log(`  ${pair.padEnd(11)} skipped — only ${rows.length} closes (need ≥${MIN_CLOSES})`);
    return null;
  }

  // Compute log returns
  const returns: number[] = [];
  const dates: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = Number(rows[i - 1].close);
    const cur = Number(rows[i].close);
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(cur) || cur <= 0) continue;
    const r = Math.log(cur / prev);
    // Cap insane single-day moves (data errors); >100% daily probably isn't real
    if (Math.abs(r) > 1.0) continue;
    returns.push(r);
    dates.push(rows[i].date);
  }

  // Detect jumps
  const jumpReturns: number[] = [];
  for (let i = LOCAL_WINDOW; i < returns.length; i++) {
    const localSigma = rollingStdev(returns, i, LOCAL_WINDOW);
    if (localSigma <= 0) continue;
    const threshold = thresholdK * localSigma;
    if (Math.abs(returns[i]) > threshold) {
      jumpReturns.push(returns[i]);
    }
  }

  const yearsCovered = returns.length / TRADING_DAYS_PER_YEAR;
  let lambda = jumpReturns.length / yearsCovered;
  let jumpMean = jumpReturns.length > 0 ? jumpReturns.reduce((s, x) => s + x, 0) / jumpReturns.length : 0;
  let jumpStd = jumpReturns.length > 1 ? stdev(jumpReturns) : 0;

  // Sanity bounds
  lambda = Math.max(MIN_LAMBDA, Math.min(MAX_LAMBDA, lambda));
  jumpStd = Math.max(MIN_JUMP_STD, Math.min(MAX_JUMP_STD, jumpStd));

  return {
    pair,
    tier: spec.tier,
    yearsCovered,
    nCloses: rows.length,
    nJumps: jumpReturns.length,
    lambda,
    jumpMean,
    jumpStd,
    tierDefault: TIER_JUMP_PARAMS[spec.tier],
    threshold: thresholdK,
  };
}

function mergeNotes(existing: string | null, jump: { lambda: number; jumpMean: number; jumpStd: number }): string {
  let obj: any = {};
  if (existing && existing.trim().startsWith("{")) {
    try { obj = JSON.parse(existing); } catch { obj = { humanNote: existing }; }
  } else if (existing) {
    obj = { humanNote: existing };
  }
  obj.jump = {
    lambda: Number(jump.lambda.toFixed(4)),
    jumpMean: Number(jump.jumpMean.toFixed(5)),
    jumpStd: Number(jump.jumpStd.toFixed(4)),
  };
  return JSON.stringify(obj);
}

async function writeCalibration(pair: string, cal: JumpCalibration): Promise<void> {
  const existing = await db.select({ notes: pairClassification.notes })
    .from(pairClassification)
    .where(eq(pairClassification.pair, pair))
    .limit(1);
  const oldNotes = existing[0]?.notes ?? null;
  const newNotes = mergeNotes(oldNotes, cal);
  await db.update(pairClassification)
    .set({ notes: newNotes })
    .where(eq(pairClassification.pair, pair));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const only = args.find(a => a.startsWith("--only="))?.split("=")[1]?.split(",").map(s => s.trim());
  const threshold = Number(args.find(a => a.startsWith("--threshold="))?.split("=")[1] ?? DEFAULT_THRESHOLD_K);
  const dryRun = args.includes("--dry-run");
  return { only, threshold, dryRun };
}

async function main() {
  const { only, threshold, dryRun } = parseArgs();
  console.log(`\n=== Jump-parameter MLE calibration ===`);
  console.log(`Threshold K = ${threshold}σ${dryRun ? "  [DRY RUN — no DB writes]" : ""}\n`);

  let pairs = SUPPORTED_PAIRS;
  if (only) pairs = pairs.filter(p => only.includes(p.displayPair));

  const results: JumpCalibration[] = [];
  for (const p of pairs) {
    try {
      const cal = await calibrateJumps(p.displayPair, threshold);
      if (!cal) continue;
      results.push(cal);

      const dλ = cal.lambda - cal.tierDefault.lambda;
      const dλArrow = Math.abs(dλ) < 0.2 ? "  " : dλ > 0 ? "↑↑" : "↓↓";
      console.log(
        `  ${p.displayPair.padEnd(11)} ${cal.tier.padEnd(15)} ` +
        `${cal.nJumps.toString().padStart(3)} jumps in ${cal.yearsCovered.toFixed(1)}y → ` +
        `λ=${cal.lambda.toFixed(2).padStart(5)} ${dλArrow}  ` +
        `μ_J=${(cal.jumpMean * 100).toFixed(2).padStart(6)}%  ` +
        `σ_J=${(cal.jumpStd * 100).toFixed(1).padStart(5)}%   ` +
        `(tier default λ=${cal.tierDefault.lambda})`,
      );

      if (!dryRun) {
        await writeCalibration(p.displayPair, cal);
      }
    } catch (err: any) {
      console.log(`  ${p.displayPair.padEnd(11)} FAILED — ${err?.message ?? err}`);
    }
  }

  console.log(`\nCalibrated ${results.length} pairs. ${dryRun ? "[dry-run: no DB writes]" : "Notes updated."}\n`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error("Calibration failed:", err); process.exit(1); });
