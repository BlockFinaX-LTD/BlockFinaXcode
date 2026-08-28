/**
 * Leverage bounds, in a module that touches nothing.
 *
 * These lived in quote.ts, which reaches the FX oracle and therefore the
 * database at import time. Anything wanting the bounds had to drag a database
 * connection along with them, which put the purchase pricing maths out of
 * reach of a test. They are two numbers and a rationale; they need no
 * dependencies at all.
 */

/**
 * Safety cap on max_payout/premium.
 *
 * Above this the option is essentially free, which is always a model failure
 * rather than a bargain: sigma stuck at its floor on a tier with real jump
 * risk. Quoting it would sell protection the pool cannot afford to have sold.
 */
export const MAX_LEVERAGE_RATIO = 100;

/**
 * Floor on max_payout/premium, the point past which cover stops being worth
 * buying.
 *
 * 1.0714 is the hard break-even under the deployed Base fees, 5% on the premium
 * in and 2% off the payout out: below it the hedger loses money even when the
 * rate finishes at the cap. 1.5 leaves a real margin, and at the floor the
 * buyer is already paying two thirds of the most they could ever receive.
 */
export const MIN_LEVERAGE_RATIO = 1.5;
