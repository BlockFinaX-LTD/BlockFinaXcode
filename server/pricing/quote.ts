/**
 * quote.ts — orchestrator that turns event params into a fair premium.
 *
 * Pulls every input live (no hardcoding):
 *   - spot         from existing fx-oracle.ts
 *   - r (USD)      from Treasury Direct (cached 6h)
 *   - μ (drift)    computed from 5y of historical closes (cached briefly)
 *   - σ (vol)      computed from EWMA over 60d closes
 *   - q_effective  picked per pair classification (r − μ for EM, else q)
 *
 * Then runs the pricing kernel and returns a structured response with full
 * breakdown so the caller (frontend, admin) can see why the number is what it is.
 */

import { getRate } from "../fx-oracle";
import { fetchUsdRate } from "./data/usdRate";
import { computeEmpiricalDrift } from "./data/drift";
import { getPricingVol } from "./data/vol";
import { getPairClassification } from "./data/classification";
import { callSpreadValue, putSpreadValue, premiumInBaseCurrency } from "./kernel";
import { signQuote, rateToFixed6, type SignedQuote } from "./signer";

export interface QuoteRequest {
  pair: string;            // e.g. "USD/GHS"
  strike: number;          // entry-edge of the payout zone
  payoutCap: number;       // far-edge of the payout zone
  expiryUnixSeconds: number;
  notional: number;        // size of the hedge in payment-token units (USDC)
  strikeAbove: boolean;    // true = upward hedge (call spread), false = downward (put spread)

  // ── v8: required for signed-quote attestation ────────────────────────
  // The signature is bound to the chain + diamond + creator so it can't be
  // replayed across contexts. If any of these are missing the response will
  // still include a fair-value premium but no signature.
  chainId?: number;
  diamondAddress?: string;
  creator?: string;
}

export interface QuoteResponse {
  premiumRate: number;     // premium / notional, e.g. 0.023 = 2.3%
  premiumUsd: number;      // dollar amount the hedger pays
  maxPayoutUsd: number;    // worst-case payout if settlement reaches the cap

  /**
   * Fixed-point representation of premiumRate matching the on-chain PRECISION = 1e6
   * convention (e.g. 0.023 → 23000n). This is the value that gets passed into
   * createEvent and is what the signature commits to. Returned as a string so
   * JSON-roundtripping doesn't lose bigint precision.
   */
  premiumRateFixed6: string;

  /**
   * v8 attestation. Present when the server has PRICING_ENGINE_PRIVATE_KEY set AND
   * the request included chainId + diamondAddress + creator. Pass these fields
   * directly into the contract's CreateEventParams.signature / quoteTimestamp /
   * quoteNonce slots. Null otherwise.
   */
  attestation: {
    signature: string;        // 0x-prefixed 65-byte hex
    quoteTimestamp: string;   // unix-seconds, as string for JSON safety
    quoteNonce: string;       // 0x-prefixed 32-byte hex
    signerAddress: string;    // public address of the signer
    expiresAt: string;        // unix-seconds when the on-chain freshness check would reject this
  } | null;

  breakdown: {
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
      r: number;            // USD risk-free rate (decimal)
      q: number | null;     // local rate if applicable (null when using empirical drift)
      mu: number | null;    // empirical drift (null when using rate differential)
      qEffective: number;   // what actually went into the kernel
      sigma: number;        // vol with risk-premium markup applied
      sigmaRealizedRaw: number; // vol BEFORE markup, for transparency
      volMarkup: number;    // markup fraction (e.g. 0.75 for frontierEM)
    };
    method: "garman-kohlhagen-with-rate-differential" | "garman-kohlhagen-with-empirical-drift";
    pairClassification: {
      tier: string;
      useEmpiricalDrift: boolean;
      notes: string | null;
    };
  };
}

/** Quote a fair premium for a hedge event. */
export async function quote(req: QuoteRequest): Promise<QuoteResponse> {
  // ── Validate inputs ──────────────────────────────────────────────────────
  if (!req.pair) throw new Error("pair is required");
  if (req.strike <= 0) throw new Error("strike must be > 0");
  if (req.payoutCap <= 0) throw new Error("payoutCap must be > 0");
  if (req.notional <= 0) throw new Error("notional must be > 0");

  const nowSeconds = Math.floor(Date.now() / 1000);
  const T_seconds = req.expiryUnixSeconds - nowSeconds;
  if (T_seconds <= 0) throw new Error("expiryUnixSeconds must be in the future");

  const T_years = T_seconds / (365.25 * 24 * 60 * 60);
  const T_days = T_seconds / (24 * 60 * 60);

  // Direction sanity matches the v7 contract validation.
  if (req.strikeAbove) {
    if (req.payoutCap <= req.strike) {
      throw new Error("Upward hedge: payoutCap must be > strike");
    }
  } else {
    if (req.payoutCap >= req.strike) {
      throw new Error("Downward hedge: payoutCap must be < strike");
    }
  }

  // ── Pull every input in parallel ─────────────────────────────────────────
  const [spotRow, rUsd, classification, volResult] = await Promise.all([
    getRate(req.pair),
    fetchUsdRate(),
    getPairClassification(req.pair),
    getPricingVol(req.pair),
  ]);

  if (!spotRow) {
    throw new Error(`No live spot for pair ${req.pair}`);
  }
  const S = spotRow.rate;

  // Drift only needed when we're using the empirical correction.
  let mu: number | null = null;
  let qEffective: number;
  let q: number | null = null;
  let method: QuoteResponse["breakdown"]["method"];

  if (classification.useEmpiricalDrift) {
    const drift = await computeEmpiricalDrift(req.pair);
    mu = drift.mu;
    qEffective = rUsd - mu;
    method = "garman-kohlhagen-with-empirical-drift";
  } else {
    // For IRP-holding pairs we'd ideally pull the local rate from a curve.
    // For now we don't have that wired (no NDF data source), so error out
    // explicitly rather than silently falling back to a wrong number.
    throw new Error(
      `Pair ${req.pair} is classified IRP-holding (useEmpiricalDrift=false) but ` +
      `no local-rate source is wired yet. Either flip useEmpiricalDrift to true ` +
      `or wire an NDF/rate-curve source for this pair.`,
    );
  }

  // ── Run the kernel ───────────────────────────────────────────────────────
  const sigma = volResult.sigma;
  const direction: "upward" | "downward" = req.strikeAbove ? "upward" : "downward";

  let perUnit: number;
  if (req.strikeAbove) {
    perUnit = callSpreadValue({
      S,
      K_lower: req.strike,
      K_upper: req.payoutCap,
      T: T_years,
      r: rUsd,
      q: qEffective,
      sigma,
    });
  } else {
    perUnit = putSpreadValue({
      S,
      K_lower: req.payoutCap,
      K_upper: req.strike,
      T: T_years,
      r: rUsd,
      q: qEffective,
      sigma,
    });
  }

  const premiumUsd = premiumInBaseCurrency(perUnit, req.notional, S);
  const premiumRate = premiumUsd / req.notional;

  // Max payout when settlement reaches the cap end of the range.
  const rangeWidth = Math.abs(req.payoutCap - req.strike);
  const maxPayoutUsd = (req.notional * rangeWidth) / S;

  // ── v8: convert quote inputs to the fixed-6 representation the contract verifies ──
  // The on-chain signature commits to fixed-point integers, not floats.
  const strikeFixed6 = rateToFixed6(req.strike);
  const payoutCapFixed6 = rateToFixed6(req.payoutCap);
  const initialRateFixed6 = rateToFixed6(S);
  const premiumRateFixed6 = BigInt(Math.round(premiumRate * 1_000_000));   // PRECISION = 1e6
  const expiryDateBigint = BigInt(req.expiryUnixSeconds);

  // Sign the quote if we have the binding context (chainId + diamond + creator) AND
  // a configured signing key. Otherwise return advisory-only response.
  let attestation: QuoteResponse["attestation"] = null;
  if (req.chainId && req.diamondAddress && req.creator) {
    const signed: SignedQuote | null = await signQuote({
      chainId: req.chainId,
      diamondAddress: req.diamondAddress,
      creator: req.creator,
      underlying: req.pair,
      strike: strikeFixed6,
      payoutCap: payoutCapFixed6,
      premiumRate: premiumRateFixed6,
      expiryDate: expiryDateBigint,
      initialRate: initialRateFixed6,
      strikeAbove: req.strikeAbove,
    });
    if (signed) {
      // QUOTE_MAX_AGE_SECONDS in the contract is 120s; bake the matching expiry into the response.
      const expiresAt = signed.quoteTimestamp + BigInt(120);
      attestation = {
        signature: signed.signature,
        quoteTimestamp: signed.quoteTimestamp.toString(),
        quoteNonce: signed.quoteNonce,
        signerAddress: signed.signerAddress,
        expiresAt: expiresAt.toString(),
      };
    }
  }

  return {
    premiumRate,
    premiumUsd,
    maxPayoutUsd,
    premiumRateFixed6: premiumRateFixed6.toString(),
    attestation,
    breakdown: {
      pair: req.pair,
      spot: S,
      strike: req.strike,
      payoutCap: req.payoutCap,
      rangeWidth,
      T_years,
      T_days,
      notional: req.notional,
      direction,
      inputs: {
        r: rUsd,
        q,
        mu,
        qEffective,
        sigma,
        sigmaRealizedRaw: volResult.realizedAnnualized,
        volMarkup: volResult.markup,
      },
      method,
      pairClassification: {
        tier: classification.tier,
        useEmpiricalDrift: classification.useEmpiricalDrift,
        notes: classification.notes,
      },
    },
  };
}
