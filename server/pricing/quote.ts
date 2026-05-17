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
import { getRecentCloses } from "./data/historical";
import { mertonCallSpread, mertonPutSpread, premiumInBaseCurrency } from "./kernel";
import { signQuote, rateToFixed6, type SignedQuote } from "./signer";
import { getPairJumpParams } from "./data/jump-params";
import {
  integratedVariance,
  longRunVolFromCloses,
  persistenceForTier,
  getPairGarchParams,
} from "./data/garch";
import type { PairTier } from "./data/pairs";

// Safety cap on max_payout/premium ratio. Quotes above this are rejected
// because they indicate the option is essentially free, which is always a
// pricing-model failure (σ stuck at floor on a tier with real jump risk).
// See the leverage check below for the rationale.
export const MAX_LEVERAGE_RATIO = 100;

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
    /**
     * % of underlying FX loss that the hedge would offset at the cap.
     *
     * For an upward hedge (strikeAbove=true) on FX-denominated exposure:
     *   coverage = max_payout / underlying_loss_at_cap
     *            = (notional × (cap−strike)/spot) / (notional × (1 − spot/cap))
     *            = cap × (cap−strike) / (spot × (cap−spot))
     *
     * Range: 0 to slightly above 1 (slightly above when strike < spot, which
     * makes the hedge "over-cover" the cap-reaching loss).
     *
     * UI should surface this prominently. < 0.5 = partial hedge ("with deductible"),
     * > 0.95 = full coverage (strike at/near spot).
     */
    coveragePercent: number;
    inputs: {
      r: number;            // USD risk-free rate (decimal)
      q: number | null;     // local rate if applicable (null when using empirical drift)
      mu: number | null;    // empirical drift (null when using rate differential)
      qEffective: number;   // what actually went into the kernel
      sigma: number;        // vol that actually fed the kernel (post-GARCH integration)
      sigmaRealizedRaw: number; // EWMA realized vol BEFORE tier-floor + markup
      volMarkup: number;    // markup fraction (e.g. 0.75 for frontierEM)
      /**
       * GARCH(1,1) integrated-variance forecast block.
       * Tells you how spot vol was blended toward long-run vol over [0,T]:
       *   sigma = sqrt( V_L + ((1 - p^N) / (N(1-p))) * (sigma0² - V_L) )
       * where p = persistence, N = T_days. Hull §23.3.
       */
      garch?: {
        sigma0: number;            // spot vol (post-EWMA, before integration)
        sigmaLongRun: number;      // 5y equally-weighted sample stdev anchor
        persistence: number;       // α+β for the tier (mean-reversion knob)
        sigmaIntegrated: number;   // = sigma field above; duplicated here for clarity
      };
      /**
       * Merton (1976) jump-diffusion parameters that fed the kernel. λ=0
       * means the engine fell back to plain GK (no jumps modelled for this
       * tier). Otherwise the option premium includes the Poisson-weighted
       * jump component — Hull Ch 27.
       */
      jump?: {
        lambda: number;        // jumps per year
        jumpMean: number;      // mean log-jump
        jumpStd: number;       // std-dev of log-jump
      };
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
  // We need TWO vol measurements now:
  //   sigma0      — current vol (EWMA, sensitive to recent moves)
  //   sigmaLongRun — long-run anchor (sample stdev over the full 5y window)
  // GARCH(1,1) integrated variance blends these by mean-reverting σ_0 toward σ_LR.
  const [spotRow, rUsd, classification, volResult, longRunCloses, jump] =
    await Promise.all([
      getRate(req.pair),
      fetchUsdRate(),
      getPairClassification(req.pair),
      getPricingVol(req.pair),
      getRecentCloses(req.pair, 252 * 5),     // 5y for the long-run anchor
      getPairJumpParams(req.pair),
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

  // ── GARCH(1,1) integrated variance ───────────────────────────────────────
  // σ_0 is the EWMA estimate from vol.ts (already has tier-floor + risk-premium
  // markup applied — the conservative diffusion-vol assumption).
  // σ_longRun is the equally-weighted 5-year sample stdev — anchors mean reversion.
  // For T > a few weeks, the integrated variance pulls σ_0 toward σ_longRun,
  // matching Hull §23 expected-average-variance.
  const sigma0 = volResult.sigma;
  let sigmaLongRun = sigma0;  // fallback if we can't compute it
  try {
    if (longRunCloses.length >= 60) {
      sigmaLongRun = longRunVolFromCloses(longRunCloses.map(c => Number(c.close)));
    }
  } catch {
    // bad closes — keep fallback
  }
  // Prefer the per-pair MLE-fitted persistence (written to pair_classification.notes
  // by `pricing:calibrate-garch`); fall back to the tier default if no calibration
  // has been written yet. Either way, sigma0 → sigma_longRun mean-reversion is
  // governed by α+β, with the integral over [0,T] feeding the kernel.
  let persistence = persistenceForTier(classification.tier as PairTier);
  try {
    const garchParams = await getPairGarchParams(req.pair);
    persistence = garchParams.persistence;
  } catch {
    // No per-pair fit yet — tier default is already set
  }
  const integ = integratedVariance({
    sigma0,
    sigmaLongRun,
    TYears: T_years,
    persistence,
  });
  const sigma = integ.sigmaIntegrated;   // <-- this is what feeds the kernel

  // ── Run the kernel (Merton jump-diffusion spread) ────────────────────────
  // λ=0 for g10 collapses this to plain GK; for frontier-EM the jump component
  // is what actually fixes the smile/fat-tail under-pricing.
  const direction: "upward" | "downward" = req.strikeAbove ? "upward" : "downward";

  let perUnit: number;
  if (req.strikeAbove) {
    perUnit = mertonCallSpread({
      S,
      K_lower: req.strike,
      K_upper: req.payoutCap,
      T: T_years,
      r: rUsd,
      q: qEffective,
      sigma,
      lambda: jump.lambda,
      jumpMean: jump.jumpMean,
      jumpStd: jump.jumpStd,
    });
  } else {
    perUnit = mertonPutSpread({
      S,
      K_lower: req.payoutCap,
      K_upper: req.strike,
      T: T_years,
      r: rUsd,
      q: qEffective,
      sigma,
      lambda: jump.lambda,
      jumpMean: jump.jumpMean,
      jumpStd: jump.jumpStd,
    });
  }

  const premiumUsd = premiumInBaseCurrency(perUnit, req.notional, S);
  const premiumRate = premiumUsd / req.notional;

  // Max payout when settlement reaches the cap end of the range.
  const rangeWidth = Math.abs(req.payoutCap - req.strike);
  const maxPayoutUsd = (req.notional * rangeWidth) / S;

  // Coverage at the cap: what fraction of underlying FX loss does the hedge offset?
  // Upward hedge: underlying loss at cap = notional × (1 − spot/cap)
  // Downward: underlying loss at cap = notional × (1 − cap/spot)  (cap < strike < spot)
  const underlyingLossAtCap = req.strikeAbove
    ? req.notional * (1 - S / req.payoutCap)
    : req.notional * (1 - req.payoutCap / S);
  const coveragePercent = underlyingLossAtCap > 0
    ? maxPayoutUsd / underlyingLossAtCap
    : 0;

  // Sanity check: leverage = max_payout / premium. A premium <$0.01 with a
  // max_payout > $1 means the engine thinks the option is essentially free —
  // signals a model mispricing (usually σ stuck at floor for a pair that
  // actually has hidden jump risk). Refuse to issue an attestation in that
  // regime; LPs would never write the contract and shipping a signed quote
  // would just generate orphan events on-chain.
  //
  // Threshold 100× was chosen because it sits well above any realistic option:
  //   - ATM 30d call typically prices ~10–30× the premium when discounted
  //   - Even cheap deep-OTM lottery tickets rarely exceed ~50×
  //   - Anything beyond 100× indicates the model is undervaluing the leg
  if (premiumUsd > 0) {
    const leverage = maxPayoutUsd / premiumUsd;
    if (leverage > MAX_LEVERAGE_RATIO) {
      throw new Error(
        `Quote rejected: max_payout/premium = ${leverage.toFixed(0)}× exceeds ` +
        `safety cap of ${MAX_LEVERAGE_RATIO}×. This usually means σ for ${req.pair} ` +
        `is at the engine floor and the option is mispriced. Move the strike closer ` +
        `to spot, narrow the cap, or wait for the volatility floor for this tier ` +
        `to be recalibrated.`,
      );
    }
  }

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
      coveragePercent,
      inputs: {
        r: rUsd,
        q,
        mu,
        qEffective,
        sigma,
        sigmaRealizedRaw: volResult.realizedAnnualized,
        volMarkup: volResult.markup,
        garch: {
          sigma0,
          sigmaLongRun,
          persistence,
          sigmaIntegrated: integ.sigmaIntegrated,
        },
        jump: {
          lambda: jump.lambda,
          jumpMean: jump.jumpMean,
          jumpStd: jump.jumpStd,
        },
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
