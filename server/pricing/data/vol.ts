/**
 * vol.ts — realized volatility (EWMA) plus risk-premium markup per pair tier.
 *
 * Pipeline (matches docs/pricing-engine.md §6):
 *   1. Pull last 61 daily closes for the pair
 *   2. Compute 60 daily log returns
 *   3. EWMA variance with λ = 0.94 (RiskMetrics standard)
 *   4. Annualize: σ_realized = sqrt(variance) × sqrt(252)
 *   5. Apply pair-tier markup (frontierEM gets +75%)
 *   6. Floor / ceiling: 5% to 200% — anything outside is bad data
 *
 * Returns the σ that the pricing kernel uses.
 */

import { getRecentCloses } from "./historical";
import { getPairClassification } from "./classification";
import type { PairTier } from "./pairs";

const LAMBDA = 0.94;
const TRADING_DAYS_PER_YEAR = 252;
const WINDOW_CLOSES = 61;        // 61 closes → 60 returns
const MIN_CLOSES   = 30;         // refuse to compute below this
const VOL_FLOOR = 0.05;          // 5% annualized
const VOL_CEILING = 3.00;        // 300% annualized — raised because crypto can spike here

// Risk-premium markup applied on top of EWMA realized vol.
// Higher tier = thinner market / fatter tails / more regime risk → larger buffer.
const RISK_PREMIUM_MARKUP: Record<PairTier, number> = {
  // FX
  g10:              0.125,   // EUR/USD etc. — mature liquid market
  majorEM:          0.25,    // BRL, MXN, ZAR, INR
  lessLiquidEM:     0.40,    // PHP, COP, IDR
  frontierEM:       0.75,    // GHS, NGN, KES, UGX
  pegged:           1.50,    // pegged/managed — devaluation tail dominates
  // Commodities
  commodityMetal:   0.15,    // XAU/XAG/XPT/XPD — deep liquid metals market
  commodityEnergy:  0.30,    // WTI/Brent/NatGas — geopolitical regime risk
  commodityAgri:    0.35,    // sugar/coffee/cocoa/wheat — weather-driven shocks
  // Crypto
  cryptoMajor:      0.20,    // BTC/ETH — already very volatile, smaller buffer needed
  cryptoOther:      0.50,    // BNB/SOL/XRP/ADA — idiosyncratic and platform risk
};

export interface VolResult {
  /** σ that the pricing kernel uses — realized × (1 + markup), bounded. */
  sigma: number;
  /** Realized vol BEFORE markup, annualized — for diagnostics. */
  realizedAnnualized: number;
  /** Risk-premium markup applied (e.g. 0.75 for frontierEM). */
  markup: number;
  /** Pair tier from classification table. */
  tier: PairTier;
  /** Number of returns used in the EWMA window. */
  returnsUsed: number;
}

/** Compute annualized realized volatility from a series of closing prices, oldest-first. */
export function computeRealizedVol(closes: number[]): number {
  if (closes.length < MIN_CLOSES) {
    throw new Error(`Need at least ${MIN_CLOSES} closes for vol, got ${closes.length}`);
  }

  // Step 2: log returns
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(cur) || cur <= 0) {
      throw new Error(`Bad close at index ${i}: prev=${prev}, cur=${cur}`);
    }
    returns.push(Math.log(cur / prev));
  }

  // Step 3: EWMA variance, seeded with the first squared return
  let variance = returns[0] * returns[0];
  for (let i = 1; i < returns.length; i++) {
    variance = LAMBDA * variance + (1 - LAMBDA) * returns[i] * returns[i];
  }

  // Step 4: annualize
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/** Apply the per-tier risk-premium markup. */
export function applyRiskPremium(realizedVol: number, tier: PairTier): number {
  const markup = RISK_PREMIUM_MARKUP[tier];
  if (markup === undefined) throw new Error(`Unknown pair tier: ${tier}`);
  return realizedVol * (1 + markup);
}

/** Full pipeline: DB → closes → EWMA → markup → bounds. */
export async function getPricingVol(pair: string): Promise<VolResult> {
  const rows = await getRecentCloses(pair, WINDOW_CLOSES);
  if (rows.length < MIN_CLOSES) {
    throw new Error(`Insufficient history for ${pair}: ${rows.length} closes`);
  }

  const closeValues = rows.map(r => Number(r.close));
  const realizedAnnualized = computeRealizedVol(closeValues);

  const cls = await getPairClassification(pair);
  const tier = cls.tier as PairTier;
  const markup = RISK_PREMIUM_MARKUP[tier];
  const withMarkup = applyRiskPremium(realizedAnnualized, tier);

  const sigma = Math.max(VOL_FLOOR, Math.min(VOL_CEILING, withMarkup));

  return {
    sigma,
    realizedAnnualized,
    markup,
    tier,
    returnsUsed: closeValues.length - 1,
  };
}
