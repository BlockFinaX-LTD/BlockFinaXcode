/**
 * implied-vol.ts — recover the volatility implied by an LP's chosen premium.
 *
 * ## Why
 *
 * An LP sets one premium when they create a pool, and today that number governs
 * every purchase until expiry: a hedger arriving on day 25 of a 30-day pool pays
 * what a day-1 buyer paid, for a fifth of the protection. The premium is the one
 * term that should move and it is the one that does not.
 *
 * The fix is not to discount the stored rate by elapsed time — that ignores
 * moneyness, and would underprice exactly the pools most likely to pay. It is to
 * re-price. But re-pricing from live market volatility alone would discard the
 * LP's judgement entirely, and they are the one with capital at risk.
 *
 * So treat the LP's price as what it actually is: **a volatility view**. Invert
 * the pricing kernel at creation to find the σ that reproduces their premium,
 * keep it, and quote against it for the life of the pool. The premium then moves
 * with time and with spot — which is what was asked for — while the LP's own risk
 * appetite stays fixed in it. This is how a market maker's book works: the model
 * supplies the shape, the trader supplies the level.
 *
 * ## Why not bisection alone
 *
 * The obvious solver assumes value rises with σ. For a single option it does.
 * For a **spread** it does not: long the strike, short the cap, so the vegas
 * subtract. Below the range more volatility helps the long leg and the value
 * rises; above the range the position is already near its maximum and more
 * volatility only threatens it, so the value falls. Vega changes sign somewhere
 * in the middle.
 *
 * A bisection that assumes monotonicity will happily return a confident wrong
 * answer on the falling side. This scans a coarse grid first, finds an interval
 * that genuinely brackets the target, and only then bisects inside it — and says
 * so when no interval does.
 */

import { mertonCallSpread, mertonPutSpread } from "./kernel";

/** σ search bounds. Below 1% nothing prices; above 300% matches VOL_CEILING. */
export const SIGMA_MIN = 0.01;
export const SIGMA_MAX = 3.0;

/** Grid resolution for the bracketing scan. 60 steps over [0.01, 3.0]. */
const SCAN_STEPS = 60;
/** Bisection iterations. 60 halvings of a ≤0.05-wide bracket is far past float precision. */
const MAX_ITERATIONS = 60;
/** Stop when the premium rate is within this of the target (1e-9 = 0.0000001%). */
const RATE_TOLERANCE = 1e-9;

export interface ImpliedVolInputs {
  /** The LP's premium as a fraction of notional, e.g. 0.03 for 3%. */
  targetRate: number;
  /** Spot at the moment being inverted — creation, for an anchor. */
  S: number;
  strike: number;
  payoutCap: number;
  /** Years to expiry at that moment. */
  T: number;
  strikeAbove: boolean;
  lambda: number;
  jumpMean: number;
  jumpStd: number;
  r?: number;
  q?: number;
}

export type ImpliedVolResult =
  | {
      ok: true;
      /** The σ that reproduces targetRate. */
      sigma: number;
      /** What that σ actually prices to — within RATE_TOLERANCE of the target. */
      achievedRate: number;
      iterations: number;
      /**
       * True when a second σ elsewhere in the range prices to the same rate.
       *
       * Real for a spread, and not a defect: a premium reachable on the rising
       * side is often reachable again on the falling side. The lower root is
       * returned, being the conventional reading of an implied vol, but the
       * caller should know the level was ambiguous.
       */
      multipleRoots: boolean;
    }
  | {
      ok: false;
      reason: string;
      /** What the range can actually produce, for a usable error message. */
      minRate: number;
      maxRate: number;
    };

/** Premium rate at a given σ — the same expression quote.ts prices with. */
function rateAt(i: ImpliedVolInputs, sigma: number): number {
  const common = {
    S: i.S,
    T: i.T,
    r: i.r ?? 0,
    q: i.q ?? 0,
    sigma,
    lambda: i.lambda,
    jumpMean: i.jumpMean,
    jumpStd: i.jumpStd,
  };
  const perUnit = i.strikeAbove
    ? mertonCallSpread({ ...common, K_lower: i.strike, K_upper: i.payoutCap })
    : mertonPutSpread({ ...common, K_lower: i.payoutCap, K_upper: i.strike });
  // premiumUsd / notional collapses to perUnit / S — notional cancels.
  return perUnit / i.S;
}

/**
 * The σ implied by a premium rate, or a reason there isn't one.
 *
 * Deterministic: same inputs, same σ, on any machine. That matters because a
 * quote signed against this value has to be reproducible by whoever verifies it.
 */
export function impliedVolFromPremiumRate(i: ImpliedVolInputs): ImpliedVolResult {
  if (!(i.targetRate > 0)) {
    return { ok: false, reason: "targetRate must be > 0", minRate: 0, maxRate: 0 };
  }
  if (!(i.T > 0)) {
    return { ok: false, reason: "T must be > 0", minRate: 0, maxRate: 0 };
  }
  if (!(i.S > 0) || !(i.strike > 0) || !(i.payoutCap > 0)) {
    return { ok: false, reason: "S, strike and payoutCap must be > 0", minRate: 0, maxRate: 0 };
  }
  if (i.strikeAbove && i.payoutCap <= i.strike) {
    return { ok: false, reason: "Upward pool: payoutCap must be > strike", minRate: 0, maxRate: 0 };
  }
  if (!i.strikeAbove && i.payoutCap >= i.strike) {
    return { ok: false, reason: "Downward pool: payoutCap must be < strike", minRate: 0, maxRate: 0 };
  }

  // Scan first. This is what makes the result trustworthy on a spread: it finds
  // where the curve actually crosses the target rather than assuming it rises.
  const grid: Array<{ sigma: number; rate: number }> = [];
  for (let n = 0; n <= SCAN_STEPS; n++) {
    const sigma = SIGMA_MIN + ((SIGMA_MAX - SIGMA_MIN) * n) / SCAN_STEPS;
    grid.push({ sigma, rate: rateAt(i, sigma) });
  }
  const rates = grid.map(g => g.rate);
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);

  // Every interval whose endpoints straddle the target.
  const brackets: Array<[number, number]> = [];
  for (let n = 0; n < grid.length - 1; n++) {
    const a = grid[n];
    const b = grid[n + 1];
    if ((a.rate - i.targetRate) * (b.rate - i.targetRate) <= 0) brackets.push([a.sigma, b.sigma]);
  }

  if (brackets.length === 0) {
    return {
      ok: false,
      reason:
        `No σ in [${SIGMA_MIN}, ${SIGMA_MAX}] prices this pool at ${(i.targetRate * 100).toFixed(4)}%. ` +
        `The range produces ${(minRate * 100).toFixed(4)}% to ${(maxRate * 100).toFixed(4)}% — ` +
        (i.targetRate > maxRate
          ? `the premium is above anything this strike and cap can justify at any volatility.`
          : `the premium is below the floor of what this geometry is worth.`),
      minRate,
      maxRate,
    };
  }

  // Lower root by convention. Ambiguity is reported, not hidden.
  const [lo0, hi0] = brackets[0];
  let lo = lo0;
  let hi = hi0;
  let iterations = 0;
  let sigma = (lo + hi) / 2;
  let achieved = rateAt(i, sigma);

  const rising = rateAt(i, hi0) >= rateAt(i, lo0);
  for (; iterations < MAX_ITERATIONS; iterations++) {
    sigma = (lo + hi) / 2;
    achieved = rateAt(i, sigma);
    if (Math.abs(achieved - i.targetRate) <= RATE_TOLERANCE) break;
    const tooLow = rising ? achieved < i.targetRate : achieved > i.targetRate;
    if (tooLow) lo = sigma;
    else hi = sigma;
  }

  return {
    ok: true,
    sigma,
    achievedRate: achieved,
    iterations,
    multipleRoots: brackets.length > 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validating an LP's chosen premium at pool creation
// ─────────────────────────────────────────────────────────────────────────────

/** How far σ* may sit from the market's view before the pool is refused. */
export const SIGMA_BAND_LOW = 0.4;
export const SIGMA_BAND_HIGH = 2.5;
/**
 * Minimum max_payout/premium a pool may be created at.
 *
 * Mirrors MIN_LEVERAGE_RATIO in quote.ts. That guard protects buyers at the
 * moment of purchase; this one protects them from a pool that should never
 * have been written, which is a gap createEvent currently has — it accepts any
 * hand-typed rate with no economic check whatsoever.
 */
export const MIN_CREATION_LEVERAGE = 1.5;

export interface PremiumValidation {
  ok: boolean;
  /** Present when ok — the volatility the LP's price implies. */
  sigma?: number;
  /** maxPayout/premium at creation. Below 1 the buyer cannot win at all. */
  leverage: number;
  maxPayoutRate: number;
  reason?: string;
  /** Set when the premium is survivable but worth querying. */
  warning?: string;
}

/**
 * Is this a pool anyone should be allowed to sell?
 *
 * Three ways a premium fails, in the order they matter:
 *
 *   1. It exceeds the maximum the pool can ever pay. Event 10 on Base was
 *      created at 3% against a cap worth 2.68%, so its two hedgers were down
 *      $55.76 the moment they bought and no market move could recover it.
 *      Nothing about volatility enters into this — it is arithmetic.
 *   2. It leaves too little upside to be worth buying. Above 1x the buyer can
 *      win, but after the 5% entry and 2% payout fees they need roughly 1.07x
 *      to break even, and a pool at 1.2x is a fee-shaped way of losing slowly.
 *   3. It implies a volatility the market cannot support. This is the softest
 *      of the three and the easiest to get wrong honestly — an LP with a real
 *      view may sit well above market and be right.
 *
 * marketSigma is supplied by the caller rather than fetched, so this stays pure
 * and testable; pass undefined to skip the band and keep checks 1 and 2.
 */
export function validateLpPremium(args: {
  premiumRate: number;
  S: number;
  strike: number;
  payoutCap: number;
  T: number;
  strikeAbove: boolean;
  lambda: number;
  jumpMean: number;
  jumpStd: number;
  marketSigma?: number;
}): PremiumValidation {
  const maxPayoutRate = Math.abs(args.payoutCap - args.strike) / args.S;
  const leverage = args.premiumRate > 0 ? maxPayoutRate / args.premiumRate : Infinity;
  const base = { leverage, maxPayoutRate };

  if (!(args.premiumRate > 0)) {
    return { ...base, ok: false, reason: "Premium must be greater than zero." };
  }

  // 1. Guaranteed loss.
  if (leverage <= 1) {
    return {
      ...base,
      ok: false,
      reason:
        `A premium of ${(args.premiumRate * 100).toFixed(3)}% is more than this pool can ever pay. ` +
        `The strike and cap are ${args.strike} and ${args.payoutCap}, so the most a hedger can receive ` +
        `is ${(maxPayoutRate * 100).toFixed(3)}% of their notional. Every buyer would lose money whatever ` +
        `the rate does. Widen the gap between strike and cap, or lower the premium below ` +
        `${(maxPayoutRate * 100).toFixed(3)}%.`,
    };
  }

  // 2. Not worth buying once fees are paid.
  if (leverage < MIN_CREATION_LEVERAGE) {
    return {
      ...base,
      ok: false,
      reason:
        `At ${(args.premiumRate * 100).toFixed(3)}% a hedger pays ${(1 / leverage * 100).toFixed(0)}% of the ` +
        `most they could ever win (${(maxPayoutRate * 100).toFixed(3)}%). After the 5% entry and 2% payout ` +
        `fees they break even at about 1.07x and this pool offers ${leverage.toFixed(2)}x. ` +
        `Lower the premium below ${((maxPayoutRate / MIN_CREATION_LEVERAGE) * 100).toFixed(3)}% or widen the range.`,
    };
  }

  // 3. Does any volatility justify it, and is that volatility sane?
  const inv = impliedVolFromPremiumRate({
    targetRate: args.premiumRate,
    S: args.S,
    strike: args.strike,
    payoutCap: args.payoutCap,
    T: args.T,
    strikeAbove: args.strikeAbove,
    lambda: args.lambda,
    jumpMean: args.jumpMean,
    jumpStd: args.jumpStd,
  });
  if (!inv.ok) {
    return { ...base, ok: false, reason: inv.reason };
  }

  if (args.marketSigma && args.marketSigma > 0) {
    const ratio = inv.sigma / args.marketSigma;
    if (ratio < SIGMA_BAND_LOW || ratio > SIGMA_BAND_HIGH) {
      return {
        ...base,
        ok: false,
        sigma: inv.sigma,
        reason:
          `This premium implies ${(inv.sigma * 100).toFixed(1)}% volatility, against ${(args.marketSigma * 100).toFixed(1)}% ` +
          `in the market — ${ratio.toFixed(2)}x. Pools are accepted between ${SIGMA_BAND_LOW}x and ${SIGMA_BAND_HIGH}x, ` +
          (ratio > SIGMA_BAND_HIGH
            ? `so this is priced too dear to attract a buyer.`
            : `so this gives away protection below what the risk is worth.`),
      };
    }
    // Wide but permissible — an LP with a genuine view may sit well off market.
    if (ratio > 1.8 || ratio < 0.6) {
      return {
        ...base,
        ok: true,
        sigma: inv.sigma,
        warning:
          `This implies ${(inv.sigma * 100).toFixed(1)}% volatility against ${(args.marketSigma * 100).toFixed(1)}% ` +
          `in the market (${ratio.toFixed(2)}x). Allowed, but worth confirming it is deliberate.`,
      };
    }
  }

  return { ...base, ok: true, sigma: inv.sigma };
}
