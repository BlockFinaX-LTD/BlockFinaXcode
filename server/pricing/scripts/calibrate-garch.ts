/**
 * calibrate-garch.ts — fit GARCH(1,1) (α, β) per pair via variance-targeted MLE.
 *
 * The full GARCH(1,1) variance recursion is:
 *
 *   σ²_t = ω + α·u²_{t-1} + β·σ²_{t-1}
 *
 * with ω, α, β > 0 and α + β < 1 for stationarity. We use **variance targeting**
 * (Engle-Mezrich 1996) — fix ω = V_LR·(1 − α − β) where V_LR is the sample
 * variance over the full window. That collapses the 3D optimization to 2D
 * over (α, β), which is much more stable than the full 3D MLE Hull warns
 * about ("shallow likelihood surface, boundary issues").
 *
 * Log-likelihood under Gaussian innovations:
 *   ℓ = -½ Σ [ ln(2π·σ²_t) + u²_t / σ²_t ]
 *
 * We do a coarse grid search over (α ∈ [0.01, 0.30], β ∈ [0.50, 0.98]) then a
 * refined grid around the best point. Pure stdlib, no scipy needed.
 *
 * Run:
 *   npm run pricing:calibrate-garch
 *   npm run pricing:calibrate-garch -- --only=USD/KES,USD/GHS
 *   npm run pricing:calibrate-garch -- --dry-run
 *
 * Idempotent — overwrites the existing `garch` key in notes JSON, preserves
 * other keys (`humanNote`, `jump`).
 */

import { db } from "../../db";
import { historicalFxCloses, pairClassification } from "../../../shared/schema";
import { eq, asc } from "drizzle-orm";
import { SUPPORTED_PAIRS, getPairSpec } from "../data/pairs";

const MIN_CLOSES = 252;
const TRADING_DAYS_PER_YEAR = 252;

interface GarchFit {
  pair: string;
  alpha: number;
  beta: number;
  persistence: number;        // α + β
  longRunVol: number;         // annualized, sqrt(V_LR · 252)
  logLikelihood: number;
  nReturns: number;
  yearsCovered: number;
}

/** Negative log-likelihood for GARCH(1,1) with variance targeting. Lower = better fit. */
function negLogLikelihood(returns: number[], alpha: number, beta: number, V_LR: number): number {
  const omega = V_LR * (1 - alpha - beta);
  if (omega <= 0) return Number.POSITIVE_INFINITY;   // breaks stationarity
  let sigmaSq = V_LR;                                 // initialise to long-run variance
  let nll = 0;
  for (let t = 0; t < returns.length; t++) {
    // log-likelihood contribution at time t: ½ [ ln(σ²_t) + u²_t / σ²_t ]
    nll += Math.log(sigmaSq) + (returns[t] * returns[t]) / sigmaSq;
    // Recursion (predict t+1)
    sigmaSq = omega + alpha * returns[t] * returns[t] + beta * sigmaSq;
    if (!Number.isFinite(sigmaSq) || sigmaSq <= 0) return Number.POSITIVE_INFINITY;
  }
  return 0.5 * nll;
}

function gridSearch(returns: number[], V_LR: number): { alpha: number; beta: number; nll: number } {
  let best = { alpha: 0.08, beta: 0.90, nll: Number.POSITIVE_INFINITY };

  // Coarse pass: α ∈ [0.01, 0.30] × 30 steps, β ∈ [0.50, 0.98] × 50 steps
  for (let i = 0; i <= 30; i++) {
    const alpha = 0.01 + (0.29 * i) / 30;
    for (let j = 0; j <= 50; j++) {
      const beta = 0.50 + (0.48 * j) / 50;
      if (alpha + beta >= 1.0) continue;
      const nll = negLogLikelihood(returns, alpha, beta, V_LR);
      if (nll < best.nll) best = { alpha, beta, nll };
    }
  }

  // Refined pass: ±0.02 around the coarse winner, 40 × 40 grid → 0.001 precision
  const cα = best.alpha, cβ = best.beta;
  for (let i = -20; i <= 20; i++) {
    const alpha = cα + 0.001 * i;
    if (alpha < 0.001 || alpha > 0.5) continue;
    for (let j = -20; j <= 20; j++) {
      const beta = cβ + 0.001 * j;
      if (beta < 0.5 || beta > 0.999) continue;
      if (alpha + beta >= 1.0) continue;
      const nll = negLogLikelihood(returns, alpha, beta, V_LR);
      if (nll < best.nll) best = { alpha, beta, nll };
    }
  }
  return best;
}

async function calibrateGarch(pair: string): Promise<GarchFit | null> {
  const spec = getPairSpec(pair);
  if (!spec) throw new Error(`Pair ${pair} not in registry`);

  const rows = await db
    .select({ date: historicalFxCloses.date, close: historicalFxCloses.close })
    .from(historicalFxCloses)
    .where(eq(historicalFxCloses.pair, pair))
    .orderBy(asc(historicalFxCloses.date));

  if (rows.length < MIN_CLOSES) {
    console.log(`  ${pair.padEnd(11)} skipped — only ${rows.length} closes`);
    return null;
  }

  const returns: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = Number(rows[i - 1].close);
    const cur = Number(rows[i].close);
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(cur) || cur <= 0) continue;
    const r = Math.log(cur / prev);
    if (Math.abs(r) > 1.0) continue;
    returns.push(r);
  }

  // Long-run variance — equally-weighted sample over full window
  let sumSq = 0;
  for (const r of returns) sumSq += r * r;
  const V_LR = sumSq / returns.length;

  const fit = gridSearch(returns, V_LR);
  return {
    pair,
    alpha: fit.alpha,
    beta: fit.beta,
    persistence: fit.alpha + fit.beta,
    longRunVol: Math.sqrt(V_LR * TRADING_DAYS_PER_YEAR),
    logLikelihood: -fit.nll,
    nReturns: returns.length,
    yearsCovered: returns.length / TRADING_DAYS_PER_YEAR,
  };
}

function mergeNotes(existing: string | null, garch: { alpha: number; beta: number }): string {
  let obj: any = {};
  if (existing && existing.trim().startsWith("{")) {
    try { obj = JSON.parse(existing); } catch { obj = { humanNote: existing }; }
  } else if (existing) {
    obj = { humanNote: existing };
  }
  obj.garch = {
    alpha: Number(garch.alpha.toFixed(4)),
    beta: Number(garch.beta.toFixed(4)),
  };
  return JSON.stringify(obj);
}

async function writeFit(pair: string, fit: GarchFit): Promise<void> {
  const existing = await db.select({ notes: pairClassification.notes })
    .from(pairClassification)
    .where(eq(pairClassification.pair, pair))
    .limit(1);
  const oldNotes = existing[0]?.notes ?? null;
  const newNotes = mergeNotes(oldNotes, fit);
  await db.update(pairClassification)
    .set({ notes: newNotes })
    .where(eq(pairClassification.pair, pair));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const only = args.find(a => a.startsWith("--only="))?.split("=")[1]?.split(",").map(s => s.trim());
  const dryRun = args.includes("--dry-run");
  return { only, dryRun };
}

async function main() {
  const { only, dryRun } = parseArgs();
  console.log(`\n=== GARCH(1,1) MLE calibration (variance-targeted) ===${dryRun ? "  [DRY RUN]" : ""}\n`);

  let pairs = SUPPORTED_PAIRS;
  if (only) pairs = pairs.filter(p => only.includes(p.displayPair));

  for (const p of pairs) {
    try {
      const fit = await calibrateGarch(p.displayPair);
      if (!fit) continue;

      console.log(
        `  ${p.displayPair.padEnd(11)} ${p.tier.padEnd(15)} ` +
        `α=${fit.alpha.toFixed(3)}  β=${fit.beta.toFixed(3)}  ρ=${fit.persistence.toFixed(3)}  ` +
        `σ_LR=${(fit.longRunVol * 100).toFixed(1).padStart(5)}%  ` +
        `(${fit.yearsCovered.toFixed(1)}y, ${fit.nReturns} returns)`,
      );

      if (!dryRun) {
        await writeFit(p.displayPair, fit);
      }
    } catch (err: any) {
      console.log(`  ${p.displayPair.padEnd(11)} FAILED — ${err?.message ?? err}`);
    }
  }
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error("Calibration failed:", err); process.exit(1); });
