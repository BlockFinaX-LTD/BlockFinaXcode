/**
 * What a cover position pays at any settlement rate.
 *
 * Extracted so the price chart and the outcome cards cannot drift. They
 * describe the same contract from two angles, and a discrepancy between them
 * would be a discrepancy about money.
 *
 * The shape is a capped spread. Nothing pays until the rate passes the strike,
 * then the payout ramps linearly, then it stops at the cap. The cap is not
 * stored anywhere: it is recovered from the maximum payout the pool reserved,
 * which is the figure the contract actually committed to.
 */

export interface PayoutInputs {
  /** Size of the exposure being protected, in USD. */
  notional: number;
  /** The rate when the pool was created, which the payout is scaled against. */
  initialRate: number;
  /** Maximum payout reserved for this position, in USD. */
  maxPayout: number;
  strike: number;
  /** True when the cover pays as the rate RISES past the strike. */
  strikeAbove: boolean;
  /** Premium plus platform fee. What the buyer actually paid to open. */
  totalCost: number;
  /** Taken from the payout on claim. */
  payoutFeeRate?: number;
}

export interface PayoutModel {
  valid: boolean;
  /** The rate at which the payout stops growing. */
  cap: number;
  /** Distance between strike and cap, always positive. */
  width: number;
  /** Gross payout if the pair settles at this rate. */
  payoutAt: (rate: number) => number;
  /** Payout after the claim fee, minus what they paid to open. */
  netAt: (rate: number) => number;
  /** The rate at which the position breaks even, or null if it never does. */
  breakEven: number | null;
}

export function buildPayoutModel(i: PayoutInputs): PayoutModel {
  const feeRate = i.payoutFeeRate ?? 0.01;
  const valid = i.notional > 0 && i.initialRate > 0 && i.maxPayout > 0 && i.strike > 0;

  const maxPriceMove = valid ? (i.maxPayout * i.initialRate) / i.notional : 0;
  const cap = i.strikeAbove ? i.strike + maxPriceMove : i.strike - maxPriceMove;
  const width = Math.abs(cap - i.strike) || i.strike * 0.05 || 1;

  const payoutAt = (S: number): number => {
    if (!valid || !Number.isFinite(S)) return 0;
    if (i.strikeAbove) {
      if (S <= i.strike) return 0;
      return (i.notional * (Math.min(S, cap) - i.strike)) / i.initialRate;
    }
    if (S >= i.strike) return 0;
    return (i.notional * (i.strike - Math.max(S, cap))) / i.initialRate;
  };

  const netAt = (S: number): number => payoutAt(S) * (1 - feeRate) - i.totalCost;

  /**
   * Where the position stops losing money.
   *
   * Solved rather than searched: the payout is linear between strike and cap,
   * so the break-even rate follows directly. Returns null when even the
   * maximum payout does not cover what was paid, which is a real case worth
   * showing plainly rather than hiding behind a number that does not exist.
   */
  let breakEven: number | null = null;
  if (valid) {
    const maxNet = netAt(cap);
    if (maxNet >= 0) {
      // payout needed, before the claim fee, to get back to zero
      const needed = i.totalCost / (1 - feeRate);
      const move = (needed * i.initialRate) / i.notional;
      breakEven = i.strikeAbove ? i.strike + move : i.strike - move;
    }
  }

  return { valid, cap, width, payoutAt, netAt, breakEven };
}
