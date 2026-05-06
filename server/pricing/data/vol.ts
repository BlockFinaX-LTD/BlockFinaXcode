/**
 * vol.ts — DB-bound full pipeline.
 *
 * Pipeline (matches docs/pricing/pricing-engine.md §6):
 *   1. Pull last 61 daily closes for the pair
 *   2. Reject if too few RECENT closes (catches stale + sparse history)
 *   3. Compute 60 daily log returns
 *   4. EWMA variance with λ = 0.94, seeded from unweighted variance of the
 *      first SEED_RETURNS returns (avoids single-squared-return seed bias)
 *   5. Annualize: σ_realized = sqrt(variance) × sqrt(252)
 *   6. Apply pair-tier risk-premium markup
 *   7. Per-tier σ floor (pegged 30%, frontierEM 10%) — sizes jump risk EWMA can't see
 *   8. Clamp [VOL_FLOOR, VOL_CEILING]
 *
 * Pure pieces live in vol-math.ts so they're unit-testable without the DB.
 */

import { getRecentCloses } from "./historical";
import { getPairClassification } from "./classification";
import type { PairTier } from "./pairs";
import {
  WINDOW_CLOSES, MIN_CLOSES, VOL_FLOOR, VOL_CEILING, RISK_PREMIUM_MARKUP,
  checkFreshness, computeRealizedVol, applyRiskPremium, applyTierFloor,
} from "./vol-math";

// Re-export pure helpers for callers that already import from vol.ts.
export {
  computeRealizedVol, applyRiskPremium, applyPeggedFloor, applyTierFloor, checkFreshness,
} from "./vol-math";

export interface VolResult {
  /** σ that the pricing kernel uses — realized × (1 + markup), tier-floored, clamped. */
  sigma: number;
  /** Realized vol BEFORE markup, annualized — for diagnostics. */
  realizedAnnualized: number;
  /** Risk-premium markup applied (e.g. 0.75 for frontierEM). */
  markup: number;
  /** Pair tier from classification table. */
  tier: PairTier;
  /** Number of returns used in the EWMA window. */
  returnsUsed: number;
  /** True if any per-tier floor (pegged 30%, frontierEM 10%) was hit. */
  tierFloorHit: boolean;
  /** The floor value that applied (or null if tier has no floor). */
  tierFloorValue: number | null;
  /** @deprecated kept for legacy callers; use tierFloorHit. Equals tierFloorHit when tier is pegged. */
  peggedFloorHit: boolean;
}

/** Full pipeline: DB → freshness check → closes → EWMA → markup → tier floor → bounds. */
export async function getPricingVol(pair: string): Promise<VolResult> {
  const rows = await getRecentCloses(pair, WINDOW_CLOSES);
  if (rows.length < MIN_CLOSES) {
    throw new Error(`Insufficient history for ${pair}: ${rows.length} closes`);
  }

  const staleReason = checkFreshness(rows);
  if (staleReason) throw new Error(`${pair}: ${staleReason}`);

  const closeValues = rows.map(r => Number(r.close));
  const realizedAnnualized = computeRealizedVol(closeValues);

  const cls = await getPairClassification(pair);
  const tier = cls.tier as PairTier;
  const markup = RISK_PREMIUM_MARKUP[tier];
  const withMarkup = applyRiskPremium(realizedAnnualized, tier);
  const { vol: afterFloor, floorHit, floorValue } = applyTierFloor(withMarkup, tier);

  const sigma = Math.max(VOL_FLOOR, Math.min(VOL_CEILING, afterFloor));

  return {
    sigma,
    realizedAnnualized,
    markup,
    tier,
    returnsUsed: closeValues.length - 1,
    tierFloorHit: floorHit,
    tierFloorValue: floorValue,
    peggedFloorHit: floorHit && tier === "pegged",
  };
}
