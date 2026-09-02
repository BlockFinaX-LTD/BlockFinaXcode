/**
 * parimutuel.ts — how a prediction market splits its pot.
 *
 * Everyone backing Yes shares the pot against everyone backing No, in
 * proportion to what they staked. There is no automated market maker, no curve
 * and no liquidity to seed: the two pools ARE the market, and the price is
 * whatever the split implies rather than a number anyone quotes.
 *
 * That choice is deliberate. A CPMM would give tradeable shares and a live
 * probability, but it needs someone to seed liquidity in every market and to
 * carry the maker's losses. Parimutuel cannot be drained, cannot run out of
 * liquidity, and cannot pay out more than it took in. For a first market on
 * currencies nobody else quotes, being unable to lose money you do not have
 * matters more than being able to sell before expiry.
 *
 * Pure functions, no I/O. Every rule that decides who gets paid lives here so
 * it can be tested without a database, a clock or an oracle.
 */

/** Platform's cut, taken only from the losing side. Winners never lose stake. */
export const FEE_RATE = 0.02;

export interface Pools {
  /** Total staked on Yes. */
  yes: number;
  /** Total staked on No. */
  no: number;
}

/**
 * The market's implied probability of Yes, from the split alone.
 *
 * Returns null when one side is empty. A market where nobody has taken the
 * other side has no price, and printing 100% or 0% would present the absence
 * of a counterparty as a certainty.
 */
export function impliedProbability(p: Pools): number | null {
  const total = p.yes + p.no;
  if (!(total > 0) || p.yes <= 0 || p.no <= 0) return null;
  return p.yes / total;
}

export type Outcome = "yes" | "no" | "void";

/**
 * Whether the market resolved, and which way.
 *
 * `void` when one side never attracted a stake. There is nothing to win from
 * an empty pool, so those markets refund rather than handing the only
 * participants a "win" against nobody.
 */
export function resolve(p: Pools, yesHappened: boolean): Outcome {
  if (p.yes <= 0 || p.no <= 0) return "void";
  return yesHappened ? "yes" : "no";
}

export interface Payout {
  /** Returned to the staker, total. Stake plus winnings, or stake on a void. */
  total: number;
  /** Their original stake, always returned in full when they win or void. */
  stake: number;
  /** Their share of the losing pool, after the fee. Zero on a loss or void. */
  winnings: number;
  /** Fee taken from this staker's share of the losing pool. */
  fee: number;
}

/**
 * What one staker receives once the market has resolved.
 *
 * A winner gets their stake back plus a pro-rata slice of the losing pool, less
 * the fee on that slice. A loser gets nothing. A void refunds the stake whole,
 * with no fee, because no risk was ever actually transferred.
 *
 * The fee is charged on winnings rather than on stake, so a winner can never
 * receive less than they put in. Charging it on stake would let a market with
 * a thin losing pool hand someone back $98 on a $100 winning bet, which reads
 * as a loss and would be one.
 */
export function payoutFor(args: {
  pools: Pools;
  side: "yes" | "no";
  stake: number;
  outcome: Outcome;
}): Payout {
  const { pools, side, stake, outcome } = args;
  const none: Payout = { total: 0, stake: 0, winnings: 0, fee: 0 };
  if (!(stake > 0)) return none;

  if (outcome === "void") {
    return { total: stake, stake, winnings: 0, fee: 0 };
  }
  if (outcome !== side) return none;

  const winningPool = side === "yes" ? pools.yes : pools.no;
  const losingPool = side === "yes" ? pools.no : pools.yes;
  // Cannot happen for a resolved market, since resolve() voids an empty side,
  // but a caller could pass mismatched pools and a stale outcome.
  if (!(winningPool > 0)) return none;

  const share = stake / winningPool;
  const gross = losingPool * share;
  const fee = gross * FEE_RATE;
  return { total: stake + gross - fee, stake, winnings: gross - fee, fee };
}

/**
 * What a stake would return if it were placed now and its side won.
 *
 * Shown before anyone commits, so the number has to include the stake's own
 * effect on the pool it is joining. Quoting the odds as they stand before the
 * stake lands overstates the return, and the more it would move the market the
 * worse the overstatement: on a thin pool it is not a rounding error, it is the
 * difference between 3x and 1.5x.
 */
export function quoteStake(args: {
  pools: Pools;
  side: "yes" | "no";
  stake: number;
}): { total: number; winnings: number; multiple: number; impliedOdds: number | null } {
  const { pools, side, stake } = args;
  if (!(stake > 0)) return { total: 0, winnings: 0, multiple: 0, impliedOdds: null };

  const after: Pools = side === "yes"
    ? { yes: pools.yes + stake, no: pools.no }
    : { yes: pools.yes, no: pools.no + stake };

  const p = payoutFor({ pools: after, side, stake, outcome: side });
  return {
    total: p.total,
    winnings: p.winnings,
    multiple: p.total / stake,
    impliedOdds: impliedProbability(after),
  };
}

/**
 * Did the thing happen?
 *
 * A market names a rate and a direction, and settles on where the rate actually
 * finished. Ties resolve to No: "above 1,700" means above, and a rate that
 * lands exactly on the line did not clear it.
 */
export function didHappen(args: {
  settlementRate: number;
  threshold: number;
  direction: "above" | "below";
}): boolean {
  const { settlementRate, threshold, direction } = args;
  return direction === "above" ? settlementRate > threshold : settlementRate < threshold;
}
