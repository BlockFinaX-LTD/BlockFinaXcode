/**
 * vol-math.ts — pure pieces of the realized-vol pipeline.
 *
 * Split from vol.ts so unit tests can import these without dragging in the
 * DB layer (vol.ts imports historical.ts → db.ts → throws if DATABASE_URL
 * is unset).
 */

import type { PairTier } from "./pairs";
import type { HistoricalFxClose } from "@shared/schema";

export const LAMBDA = 0.94;
export const TRADING_DAYS_PER_YEAR = 252;
export const WINDOW_CLOSES = 61;        // 61 closes → 60 returns
export const MIN_CLOSES   = 30;         // need at least this many returns to compute anything
export const SEED_RETURNS = 20;         // first N returns seed EWMA via unweighted variance
export const VOL_FLOOR = 0.05;          // 5% annualized
export const VOL_CEILING = 3.00;        // 300% annualized — raised because crypto can spike here

// Freshness check: of the last FRESHNESS_WINDOW_DAYS calendar days, we must
// have at least MIN_RECENT_CLOSES closes.
export const FRESHNESS_WINDOW_DAYS = 90;
export const MIN_RECENT_CLOSES = 60;

// Pegged / heavily managed currencies (XOF, XAF, etc.) run ~0% realized vol
// for years, then a 25–50% jump on devaluation day. EWMA can't see jump risk
// in advance. Floor σ at 30% so the kernel always prices in *some* devaluation
// premium even if recent returns look flat.
export const PEGGED_VOL_FLOOR = 0.30;

// Risk-premium markup applied on top of EWMA realized vol.
// Higher tier = thinner market / fatter tails / more regime risk → larger buffer.
export const RISK_PREMIUM_MARKUP: Record<PairTier, number> = {
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

/**
 * Reject closes that are stale or too sparse to price against.
 * Pass `today` to get deterministic tests.
 *
 * @returns null if fresh enough, otherwise the reason for rejection
 */
export function checkFreshness(
  rows: Pick<HistoricalFxClose, "date">[],
  today: Date = new Date(),
): string | null {
  const cutoffMs = today.getTime() - FRESHNESS_WINDOW_DAYS * 86_400_000;
  const recent = rows.filter(r => {
    const d = Date.parse(r.date + "T00:00:00Z");
    return Number.isFinite(d) && d >= cutoffMs;
  });
  if (recent.length < MIN_RECENT_CLOSES) {
    return (
      `Stale or sparse history: only ${recent.length} closes in the last ` +
      `${FRESHNESS_WINDOW_DAYS} days (need ≥${MIN_RECENT_CLOSES})`
    );
  }
  return null;
}

/** Compute annualized realized volatility from a series of closing prices, oldest-first. */
export function computeRealizedVol(closes: number[]): number {
  if (closes.length < MIN_CLOSES) {
    throw new Error(`Need at least ${MIN_CLOSES} closes for vol, got ${closes.length}`);
  }

  // Step 1: log returns
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(cur) || cur <= 0) {
      throw new Error(`Bad close at index ${i}: prev=${prev}, cur=${cur}`);
    }
    returns.push(Math.log(cur / prev));
  }

  // Step 2: seed EWMA with the unweighted variance of the first SEED_RETURNS returns.
  // Falls back to all returns if there aren't SEED_RETURNS available.
  const seedN = Math.min(SEED_RETURNS, returns.length);
  let seedSumSq = 0;
  for (let i = 0; i < seedN; i++) seedSumSq += returns[i] * returns[i];
  let variance = seedSumSq / seedN;

  // Step 3: continue EWMA from index seedN onward
  for (let i = seedN; i < returns.length; i++) {
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

/** Apply pegged-tier vol floor (no-op for non-pegged tiers). */
export function applyPeggedFloor(vol: number, tier: PairTier): { vol: number; floorHit: boolean } {
  if (tier !== "pegged") return { vol, floorHit: false };
  if (vol >= PEGGED_VOL_FLOOR) return { vol, floorHit: false };
  return { vol: PEGGED_VOL_FLOOR, floorHit: true };
}
