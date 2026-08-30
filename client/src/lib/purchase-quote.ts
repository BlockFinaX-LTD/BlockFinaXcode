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

export interface PurchaseQuote {
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

export interface PurchaseQuoteError {
  ok: false;
  reason: string;
}

/**
 * The signed half, present only when a buyer was named on the request.
 *
 * Bound on chain to that address, this pool, this size and this price, and
 * valid for 120 seconds. It cannot be lifted from the mempool and spent by
 * somebody else, nor stretched to a larger notional.
 */
export interface QuoteAttestation {
  signature: string;
  quoteTimestamp: string | number | bigint;
  quoteNonce: string;
  signerAddress: string;
}

export async function fetchPurchaseQuote(
  args: { chainId: number; eventId: number; notional: number; buyer?: string },
  signal?: AbortSignal,
): Promise<(PurchaseQuote & { attestation?: QuoteAttestation | null }) | PurchaseQuoteError> {
  try {
    const res = await fetch("/api/pricing/quote-purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal,
    });
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return { ok: false, reason: "The pricing engine returned nothing." };
    }
    return body as (PurchaseQuote & { attestation?: QuoteAttestation | null }) | PurchaseQuoteError;
  } catch (e) {
    // Aborts are the caller changing the amount, not a failure worth showing.
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return { ok: false, reason: aborted ? "cancelled" : "Could not reach the pricing engine." };
  }
}

/**
 * The difference, in words.
 *
 * A percentage on its own invites the wrong conclusion. Someone seeing "worth
 * 0.7%, charged 2%" needs to know it is because two thirds of the pool's life
 * has gone, not because the pool is overpriced or the engine is broken.
 */
export function explainGap(q: PurchaseQuote): string | null {
  const { premiumRate, storedRate, breakdown } = q;
  if (!(storedRate > 0)) return null;
  const days = breakdown.daysRemaining;
  const left = days >= 1.5 ? `${Math.round(days)} days` : days >= 1 ? "a day" : "hours";
  const gap = (premiumRate - storedRate) / storedRate;

  // Under a tenth apart is noise on a rate quoted to one decimal place.
  if (Math.abs(gap) < 0.1) {
    return `With ${left} left, today's price is about what this pool charges.`;
  }
  if (gap < 0) {
    return (
      `With ${left} left, this cover is worth less than the pool's opening rate. ` +
      `You are still charged the pool rate.`
    );
  }
  return (
    `With ${left} left and the rate nearer the strike, this cover is worth more ` +
    `than the pool's opening rate. You are still charged the pool rate.`
  );
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
