/**
 * pricing-quote.ts — client wrapper for POST /api/pricing/quote.
 *
 * The server-side pricing engine returns:
 *   - the fair-value premium (rate + USD)
 *   - max payout for the configured range
 *   - a full breakdown of inputs (so the UI can show "based on vol X, drift Y, T=Z days")
 *   - an ECDSA attestation when chainId/diamondAddress/creator are provided AND
 *     the server has PRICING_ENGINE_PRIVATE_KEY set.
 *
 * Use the attestation directly in createEvent's signature/quoteTimestamp/quoteNonce
 * fields; the on-chain contract verifies the signer matches the registered
 * pricingEngineSigner.
 */

export interface QuoteAttestation {
  signature: string;       // 0x-prefixed 65-byte hex
  quoteTimestamp: string;  // unix-seconds (string for bigint safety)
  quoteNonce: string;      // 0x-prefixed 32-byte hex
  signerAddress: string;   // public address of the engine signer
  expiresAt: string;       // unix-seconds when the on-chain freshness check would reject
}

export interface QuoteBreakdown {
  pair: string;
  spot: number;
  strike: number;
  payoutCap: number;
  rangeWidth: number;
  T_years: number;
  T_days: number;
  notional: number;
  direction: "upward" | "downward";
  inputs: {
    r: number;                // USD risk-free rate
    q: number | null;
    mu: number | null;        // empirical drift (when EM correction active)
    qEffective: number;
    sigma: number;            // pricing vol (post-markup)
    sigmaRealizedRaw: number; // pre-markup
    volMarkup: number;
  };
  method: "garman-kohlhagen-with-rate-differential" | "garman-kohlhagen-with-empirical-drift";
  pairClassification: {
    tier: string;
    useEmpiricalDrift: boolean;
    notes: string | null;
  };
}

export interface QuoteResponse {
  premiumRate: number;
  premiumUsd: number;
  maxPayoutUsd: number;
  premiumRateFixed6: string;
  attestation: QuoteAttestation | null;
  breakdown: QuoteBreakdown;
}

export interface QuoteRequest {
  pair: string;
  strike: number;
  payoutCap: number;
  expiryUnixSeconds: number;
  notional: number;
  strikeAbove: boolean;

  // v8 attestation context — provide all three to receive a signature.
  chainId?: number;
  diamondAddress?: string;
  creator?: string;
}

/**
 * Fetch a fair-value quote from the pricing engine.
 * Throws on HTTP error or 4xx response.
 */
export async function fetchPricingQuote(req: QuoteRequest): Promise<QuoteResponse> {
  const res = await fetch("/api/pricing/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `Pricing quote failed: HTTP ${res.status}`);
  }
  return await res.json() as QuoteResponse;
}

/** Returns true if the attestation is still within the on-chain freshness window. */
export function isAttestationFresh(att: QuoteAttestation): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now < parseInt(att.expiresAt, 10);
}
