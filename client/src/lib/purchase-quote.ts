/**
 * purchase-quote.ts — what an existing pool is actually worth to a buyer now.
 *
 * A pool's premium is fixed when it is created and every buyer pays it for the
 * pool's whole life, so someone with ten days left of a thirty day pool pays
 * for thirty. This asks the engine what the same cover is worth today, priced
 * against the volatility the underwriter implied when they set their opening
 * premium.
 *
 * What this is FOR depends on the pool. On a fixed pool it is advisory: the
 * contract charges the stored rate and this only makes the gap visible. On a
 * dynamic pool it is the price itself, because buyProtectionQuoted charges the
 * signed rate and ignores the stored one.
 *
 * That distinction is the whole reason `chargedRateFor` below exists rather
 * than each caller picking a rate. When this fails the purchase must carry on
 * regardless, which is why every error resolves rather than throws.
 */

interface PurchaseQuote {
  ok: true;
  premiumRate: number;
  premiumUsd: number;
  maxPayoutUsd: number;
  /**
   * The rate the pool was opened at. On a fixed pool this is what the buyer is
   * billed; on a dynamic pool it is only the anchor the live rate is derived
   * from. Use `chargedRateFor` rather than reading this directly.
   */
  storedRate: number;
  storedPremiumUsd: number;
  breakdown: {
    spot: number;
    strike: number;
    payoutCap: number;
    daysRemaining: number;
    sigmaStar: number;
    sigmaStarSource: "stored" | "inverted";
    baseRate: number;
    utilisation: number;
    utilisationMultiplier: number;
    floorApplied: boolean;
    leverage: number;
  };
}


/**
 * The rate a purchase will actually be charged at.
 *
 * The buy sheet read the stored rate unconditionally, which was true of every
 * pool until dynamic pricing shipped and is now false for half of them. A
 * dynamic pool goes through buyProtectionQuoted and is charged the signed
 * rate, so late in a pool's life the sheet could show a premium of $200 while
 * the chain took $70. The direction happened to be generous, but the same
 * figure also drives the balance check, the buy button's disabled state and the
 * mainnet confirmation text, so none of those were describing the transaction
 * being signed.
 *
 * Falls back to the stored rate whenever no quote is in hand, which is both the
 * safe default and exactly what a fixed pool always uses.
 */
export function chargedRateFor(
  dynamic: boolean,
  storedRate: number,
  quote: Pick<PurchaseQuote, "premiumRate"> | null | undefined,
): number {
  if (dynamic && quote && Number.isFinite(quote.premiumRate) && quote.premiumRate > 0) {
    return quote.premiumRate;
  }
  return storedRate;
}
