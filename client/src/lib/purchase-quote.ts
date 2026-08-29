/**
 * purchase-quote.ts — what an existing pool is actually worth to a buyer now.
 *
 * A pool's premium is fixed when it is created and every buyer pays it for the
 * pool's whole life, so someone with ten days left of a thirty day pool pays
 * for thirty. This asks the engine what the same cover is worth today, priced
 * against the volatility the underwriter implied when they set their opening
 * premium.
 *
 * Advisory only. The contract still charges the pool's stored rate, and nothing
 * here changes that; both figures come back so the sheet can show them
 * together. When this fails the purchase must carry on regardless, which is why
 * every error resolves rather than throws.
 */

export interface PurchaseQuote {
  ok: true;
  premiumRate: number;
  premiumUsd: number;
  maxPayoutUsd: number;
  /** What the pool charges flat, which is what the buyer is actually billed. */
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
