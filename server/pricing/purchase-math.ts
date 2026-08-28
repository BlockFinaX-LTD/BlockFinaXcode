/**
 * purchase-math.ts — the pricing step for a buyer entering an existing pool.
 *
 * Split from quote-purchase.ts, which reads three contract getters and a live
 * rate before it can price anything. That made the arithmetic unreachable from
 * a test without a chain and an oracle behind it, and the arithmetic is where
 * every property worth asserting lives: that the premium falls with tenor out
 * of the money and RISES through the strike, that the utilisation skew is
 * monotonic, that the floor binds, and that the leverage bounds refuse a quote
 * a buyer could not profit from.
 *
 * Imports only the option kernel and two constants, both dependency free. No
 * network, no database, no clock.
 */

import { mertonCallSpread, mertonPutSpread } from "./kernel";
import { MAX_LEVERAGE_RATIO, MIN_LEVERAGE_RATIO } from "./bounds";

/**
 * Utilisation markup. Quadratic, so early buyers are barely touched and the
 * last of the capacity is genuinely dear:
 *
 *   0% used   ->  x1.000        50% used  ->  x1.125
 *   90% used  ->  x1.405        100% used ->  x1.500
 *
 * An LP's marginal risk is not linear in how full their pool is. Nothing in the
 * engine priced this at all before: the same quote came out of an empty pool
 * and a pool with one slot left.
 */
export interface PurchaseQuote {
  ok: true;
  /** Premium as a fraction of notional, after skew and floor. */
  premiumRate: number;
  premiumUsd: number;
  maxPayoutUsd: number;
  /** What the pool would have charged flat — for comparison, not for charging. */
  storedRate: number;
  storedPremiumUsd: number;
  breakdown: {
    spot: number;
    strike: number;
    payoutCap: number;
    daysRemaining: number;
    /** The LP's implied volatility, the anchor this is priced against. */
    sigmaStar: number;
    sigmaStarSource: "stored" | "inverted";
    /** Before skew and floor. */
    baseRate: number;
    utilisation: number;
    utilisationMultiplier: number;
    floorApplied: boolean;
    leverage: number;
  };
}

export interface PurchaseQuoteError {
  ok: false;
  reason: string;
}

export const UTILISATION_K = 0.5;

/** Refuse to quote inside this window; the outcome is close to decided. */
export const MIN_TENOR_HOURS = 1;

/**
 * The pricing itself, with every input already resolved.
 *
 * Split out from `quotePurchase` so it can be tested. The function above reads
 * three contract getters and the live rate before it can price anything, which
 * makes the arithmetic unreachable from a test without a chain and an oracle
 * behind it. Every property worth asserting lives here: that the premium falls
 * with tenor out of the money and rises through the strike, that the skew is
 * monotonic in utilisation, that the floor binds, and that the leverage bounds
 * refuse a quote a buyer could not profit from.
 *
 * Pure and synchronous. No network, no clock.
 */
export function pricePurchase(a: {
  notional: number;
  /** Live spot. */
  S: number;
  /** The rate the pool was struck against, which payouts are scaled by. */
  S0: number;
  strike: number;
  payoutCap: number;
  strikeAbove: boolean;
  /** Years remaining. */
  T: number;
  daysRemaining: number;
  sigmaStar: number;
  sigmaStarSource: "stored" | "inverted";
  jump: { lambda: number; jumpMean: number; jumpStd: number };
  totalLiquidity: number;
  totalMaxPayout: number;
  minPremiumRate: number;
  storedRate: number;
}): PurchaseQuote | PurchaseQuoteError {
  const { S, S0, strike, payoutCap, strikeAbove, T, sigmaStar, jump } = a;

  const perUnit = strikeAbove
    ? mertonCallSpread({ S, K_lower: strike, K_upper: payoutCap, T, r: 0, q: 0, sigma: sigmaStar, ...jump })
    : mertonPutSpread({ S, K_lower: payoutCap, K_upper: strike, T, r: 0, q: 0, sigma: sigmaStar, ...jump });
  const baseRate = perUnit / S;

  const utilisation = a.totalLiquidity > 0 ? Math.min(1, a.totalMaxPayout / a.totalLiquidity) : 0;
  const utilisationMultiplier = 1 + UTILISATION_K * utilisation * utilisation;

  let premiumRate = baseRate * utilisationMultiplier;
  const floor = a.minPremiumRate ?? 0;
  const floorApplied = floor > 0 && premiumRate < floor;
  if (floorApplied) premiumRate = floor;

  const maxPayoutUsd = (a.notional * Math.abs(payoutCap - strike)) / S0;
  const premiumUsd = a.notional * premiumRate;

  if (!(premiumUsd > 0) || Math.round(premiumRate * 1e6) <= 0) {
    return {
      ok: false,
      reason:
        "The premium rounds to zero at the contract's precision — the strike is too far from spot " +
        "for the time remaining. This pool is not worth buying into right now.",
    };
  }
  const leverage = maxPayoutUsd / premiumUsd;
  if (leverage > MAX_LEVERAGE_RATIO) {
    return { ok: false, reason: `Quote rejected: ${leverage.toFixed(0)}× leverage exceeds the ${MAX_LEVERAGE_RATIO}× cap.` };
  }
  if (leverage < MIN_LEVERAGE_RATIO) {
    return {
      ok: false,
      reason:
        `Spot has moved so far through the strike that the premium is ${(100 / leverage).toFixed(0)}% of the ` +
        `most this position could pay. After fees a buyer cannot profit. This pool is no longer worth ` +
        `buying into.`,
    };
  }

  return {
    ok: true,
    premiumRate,
    premiumUsd,
    maxPayoutUsd,
    storedRate: a.storedRate,
    storedPremiumUsd: a.notional * a.storedRate,
    breakdown: {
      spot: S,
      strike,
      payoutCap,
      daysRemaining: a.daysRemaining,
      sigmaStar,
      sigmaStarSource: a.sigmaStarSource,
      baseRate,
      utilisation,
      utilisationMultiplier,
      floorApplied,
      leverage,
    },
  };
}
