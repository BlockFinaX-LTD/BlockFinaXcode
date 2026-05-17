/**
 * garch.ts — GARCH(1,1) volatility forecast with mean reversion.
 *
 * Replaces (or layers on top of) the pure-EWMA pipeline in vol.ts when pricing
 * options of meaningful tenor (> ~14 days).
 *
 * Why GARCH(1,1) here (Hull Ch 23.3):
 *
 *   σ²_n = ω + α·u²_{n−1} + β·σ²_{n−1}     with γ = 1 − α − β  and  V_L = ω/γ
 *
 *   EWMA is the special case where ω=0 and α+β=1 — no mean reversion. For
 *   pricing options that mature 30–90 days out, a spike in TODAY's vol shouldn't
 *   drive the whole option's premium up: the variance is expected to mean-revert
 *   over the option's life. GARCH gives us that decay; EWMA does not.
 *
 *   For BlockFinaX frontier-EM pairs we use **variance targeting**: V_L is fixed
 *   to the long-horizon sample variance (5y), and only the persistence (α+β) is
 *   set per-tier. This avoids the MLE-fitting complexity Hull warns about
 *   ("boundary issues, shallow likelihood surface") while still getting most of
 *   the benefit.
 *
 * Integrated variance over [0,T] (Hull §23, expected-average-variance formula):
 *
 *   V(T) = V_L + ((1 − persistence^T) / (T·(1 − persistence))) · (σ_0² − V_L)
 *
 * which is what we pass to the kernel: σ_engine = sqrt(V(T)).
 */

import { LAMBDA, computeRealizedVol } from "./vol-math";
import type { PairTier } from "./pairs";

/**
 * Per-tier GARCH(1,1) persistence (α+β). Higher = slower mean reversion.
 *
 * Defaults sourced from Hull §23.3 + skill's hull_garch.md (typical empirical
 * persistence by asset class):
 *   - equity index:   ~0.99 (very persistent — vol regimes last)
 *   - DM FX (G10):    ~0.97
 *   - EM FX:          ~0.93–0.95 (faster mean reversion under regime breaks)
 *   - Crypto:         ~0.92
 *   - Pegged FX:      ~0.85 (long calm periods between rare jumps)
 *
 * We pick conservative values per tier — biased slightly toward less persistence
 * so the engine doesn't lock in a high σ_0 forever after a single spike day.
 */
export const TIER_PERSISTENCE: Record<PairTier, number> = {
  g10:              0.97,
  majorEM:          0.95,
  lessLiquidEM:     0.94,
  frontierEM:       0.93,
  pegged:           0.85,
  commodityMetal:   0.95,
  commodityEnergy:  0.93,
  commodityAgri:    0.92,
  cryptoMajor:      0.92,
  cryptoOther:      0.90,
};

const TRADING_DAYS_PER_YEAR = 252;

export interface IntegratedVarianceInputs {
  /** Spot annualized volatility (the EWMA result we already compute). */
  sigma0: number;
  /** Long-run annualized volatility (sample stdev over the full history window). */
  sigmaLongRun: number;
  /** Time to expiry in years. */
  TYears: number;
  /** Persistence α+β. Defaults to 0.95 if absent. */
  persistence?: number;
}

export interface IntegratedVarianceResult {
  /**
   * The expected average variance over [0,T], annualized. This is the variance
   * the pricing kernel should consume.
   */
  varianceIntegrated: number;
  /** sqrt(varianceIntegrated) — the σ to feed the kernel. */
  sigmaIntegrated: number;
  /**
   * "Speed of mean reversion" in our units — 1 − persistence. Closer to 1
   * means σ_engine collapses to σ_longRun faster as T grows.
   */
  decay: number;
}

/**
 * Compute GARCH(1,1)-style expected average variance from now to T.
 *
 * The closed-form Hull gives in §23 (mean-reverting variance forecast):
 *
 *   E[V(T)] = V_L + ((1 − persistence^N) / (N · (1 − persistence))) · (σ_0² − V_L)
 *
 * where N is the number of forecast steps. We work in annualized units, so the
 * "step" is one trading day and N = T·252.
 *
 * Edge cases:
 *   - persistence=1 (EWMA limit): V(T) → σ_0² (no mean reversion). We special-
 *     case the geometric-sum denominator-zero.
 *   - T → 0: V(T) → σ_0² as the integral collapses to the spot variance.
 *   - σ_longRun = 0 or missing: fall back to σ_0² (no reversion target).
 */
export function integratedVariance(input: IntegratedVarianceInputs): IntegratedVarianceResult {
  const { sigma0, sigmaLongRun, TYears } = input;
  const persistence = input.persistence ?? 0.95;

  if (sigma0 <= 0) throw new Error("sigma0 must be > 0");
  if (TYears <= 0) throw new Error("TYears must be > 0");
  if (persistence < 0 || persistence >= 1) throw new Error("persistence must be in [0, 1)");

  const V0 = sigma0 * sigma0;
  const VL = sigmaLongRun > 0 ? sigmaLongRun * sigmaLongRun : V0;

  // Number of forecast steps (trading days)
  const N = Math.max(1, Math.round(TYears * TRADING_DAYS_PER_YEAR));
  const oneMinusPersistence = 1 - persistence;

  // Decay weight in the closed form
  //   weight = (1 − persistence^N) / (N · (1 − persistence))
  // → as N → ∞, weight → 0 and V(T) → V_L (full reversion)
  // → as N → 0 or persistence → 1, weight → 1 and V(T) → V_0
  const weight = (1 - Math.pow(persistence, N)) / (N * oneMinusPersistence);
  const varianceIntegrated = VL + weight * (V0 - VL);

  return {
    varianceIntegrated,
    sigmaIntegrated: Math.sqrt(Math.max(varianceIntegrated, 0)),
    decay: oneMinusPersistence,
  };
}

/**
 * Convenience: compute long-run vol from a series of daily closes using the
 * un-weighted sample variance over the entire window. This is the V_L target
 * for the GARCH forecaster.
 *
 * Note: we deliberately do NOT use the same EWMA-based estimate that vol-math.ts
 * uses for σ_0 — V_L should be a longer-horizon, equally-weighted figure so it
 * provides a meaningful anchor.
 */
export function longRunVolFromCloses(closes: number[]): number {
  if (closes.length < 30) {
    throw new Error(`Need at least 30 closes for long-run vol, got ${closes.length}`);
  }
  // Log returns
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(cur) || cur <= 0) {
      throw new Error(`Bad close at index ${i}: prev=${prev}, cur=${cur}`);
    }
    returns.push(Math.log(cur / prev));
  }
  let sumSq = 0;
  for (const r of returns) sumSq += r * r;
  // Assume zero mean (standard convention for daily vol estimation — see Hull §23.1)
  const dailyVar = sumSq / returns.length;
  return Math.sqrt(dailyVar * TRADING_DAYS_PER_YEAR);
}

/**
 * Persistence lookup. Falls back to 0.95 (a sensible default for most assets)
 * when the tier isn't recognized.
 */
export function persistenceForTier(tier: PairTier): number {
  return TIER_PERSISTENCE[tier] ?? 0.95;
}

/**
 * Per-pair GARCH parameters. Same notes-JSON convention as jump-params:
 * pair_classification.notes can carry { "garch": { "alpha": ..., "beta": ... } }
 * which `calibrate-garch.ts` writes after fitting MLE on the pair's history.
 *
 * Falls back to the tier default if no per-pair override is set.
 */
export interface GarchParams {
  /** α: weight on the most recent squared return */
  alpha: number;
  /** β: weight on the previous variance estimate */
  beta: number;
  /** persistence = α + β; convenience precomputed */
  persistence: number;
}

export async function getPairGarchParams(pair: string): Promise<GarchParams> {
  // Lazy DB import — keeps this module test-friendly
  const { getPairClassification } = await import("./classification");
  const cls = await getPairClassification(pair);
  const tierPersistence = persistenceForTier(cls.tier as PairTier);

  // Default: split tier persistence into a typical α≈0.08, β = persistence − α
  let alpha = 0.08;
  let beta = tierPersistence - alpha;

  if (cls.notes && cls.notes.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(cls.notes);
      if (parsed.garch && Number.isFinite(parsed.garch.alpha) && Number.isFinite(parsed.garch.beta)) {
        alpha = Number(parsed.garch.alpha);
        beta = Number(parsed.garch.beta);
      }
    } catch {
      // notes isn't JSON — keep tier defaults
    }
  }

  // Stationarity guard — α + β must be strictly < 1
  const persistence = Math.min(alpha + beta, 0.999);
  return { alpha, beta, persistence };
}

// Re-export LAMBDA so callers can still get the EWMA decay rate from one place.
export { LAMBDA, computeRealizedVol };
