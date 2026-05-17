/**
 * kernel.ts — option pricing math. Pure functions, no I/O, no DB.
 *
 * Two pricing methods live here:
 *
 *   1. Garman-Kohlhagen (GK)              — flat-vol diffusion. Hull Ch 17.
 *   2. Merton (1976) jump-diffusion       — GBM + Poisson jumps. Hull Ch 27.
 *
 * The engine uses the jump-diffusion variant for frontier-EM corridors (where
 * devaluation gaps are the norm, not the exception — see Taleb's *Dynamic
 * Hedging* discussion of fat tails) and the GK variant as the limiting case
 * when λ=0 (no jumps).
 *
 * Critical convention:
 *   q is "the cost of carry on the underlying" — for an FX rate quoted base/quote:
 *     - Textbook GK: q = q_base (the BASE currency's risk-free rate)
 *     - EM correction (§3.5): q_effective = r − μ, where μ is the empirical drift of S
 *
 *   The caller is responsible for choosing which q to pass in. The kernel doesn't
 *   know or care — it just consumes (S, K, T, r, q, σ).
 *
 * All option values are returned in QUOTE-currency units per 1 unit of base
 * currency. Conversion to a fiat notional happens in quote.ts.
 */

/** Standard normal CDF using the Abramowitz & Stegun 7.1.26 approximation (max abs error ~7.5e-8). */
export function normalCDF(x: number): number {
  // erf via A&S 7.1.26
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;

  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * y);
}

export interface GKInputs {
  S: number;       // spot (quote/base)
  K: number;       // strike (quote/base)
  T: number;       // years to expiry
  r: number;       // quote-currency risk-free rate (decimal, e.g. 0.045)
  q: number;       // base-currency cost of carry — see file header
  sigma: number;   // annualized volatility (decimal, e.g. 0.18)
}

function dValues({ S, K, T, r, q, sigma }: GKInputs): { d1: number; d2: number } {
  if (T <= 0) throw new Error("T must be > 0");
  if (sigma <= 0) throw new Error("sigma must be > 0");
  if (S <= 0 || K <= 0) throw new Error("S and K must be > 0");

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { d1, d2 };
}

/** Garman-Kohlhagen call value, in quote-currency units per 1 unit of base. */
export function garmanKohlhagenCall(input: GKInputs): number {
  const { S, K, T, r, q } = input;
  const { d1, d2 } = dValues(input);
  return S * Math.exp(-q * T) * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
}

/** Garman-Kohlhagen put value, in quote-currency units per 1 unit of base. */
export function garmanKohlhagenPut(input: GKInputs): number {
  const { S, K, T, r, q } = input;
  const { d1, d2 } = dValues(input);
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * Math.exp(-q * T) * normalCDF(-d1);
}

export interface SpreadInputs {
  S: number;
  K_lower: number;
  K_upper: number;
  T: number;
  r: number;
  q: number;       // pass q_effective for EM pairs (see §3.5)
  sigma: number;
}

/**
 * Call-spread value (long call at K_lower, short call at K_upper).
 * Used for upward FX hedges: hedger gains when the rate rises into the range.
 *
 * Returned in quote-currency units per 1 unit of base.
 */
export function callSpreadValue(input: SpreadInputs): number {
  if (input.K_upper <= input.K_lower) {
    throw new Error("K_upper must be > K_lower");
  }
  const lower = garmanKohlhagenCall({ ...input, K: input.K_lower });
  const upper = garmanKohlhagenCall({ ...input, K: input.K_upper });
  return Math.max(0, lower - upper);
}

/**
 * Put-spread value (long put at K_upper, short put at K_lower).
 * Used for downward FX hedges: hedger gains when the rate falls into the range.
 *
 * Returned in quote-currency units per 1 unit of base.
 */
export function putSpreadValue(input: SpreadInputs): number {
  if (input.K_upper <= input.K_lower) {
    throw new Error("K_upper must be > K_lower");
  }
  const upper = garmanKohlhagenPut({ ...input, K: input.K_upper });
  const lower = garmanKohlhagenPut({ ...input, K: input.K_lower });
  return Math.max(0, upper - lower);
}

/**
 * Convert a per-unit option value to a notional-denominated premium in BASE currency.
 *
 * The contract's payout formula is `notional × (settlement_move) / initialRate`,
 * with notional in payment-token units (e.g. USDC). For USD/GHS this means USD
 * notional, USD payout, but the option value comes back in GHS-per-USD. So we
 * convert: notional (USD) × value (GHS/USD) / S (GHS/USD) = USD premium.
 */
export function premiumInBaseCurrency(perUnitValue: number, notional: number, S: number): number {
  if (notional <= 0) throw new Error("notional must be > 0");
  if (S <= 0) throw new Error("S must be > 0");
  return (notional * perUnitValue) / S;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merton (1976) jump-diffusion
// ─────────────────────────────────────────────────────────────────────────────
//
// The underlying follows GBM with diffusion vol σ AND a compound Poisson jump
// process: dS/S = (r − q − λk) dt + σ dW + dJ
//
// where:
//   λ    — jump intensity (mean jumps per year)
//   J    — jump size, ln(1+J) ~ N(μ_J, σ_J²)
//   k    — E[J] = exp(μ_J + σ_J²/2) − 1, the mean fractional jump size
//
// Closed-form: price = Σ_{n=0..∞} P(n jumps) × BS(σ_n, r_n)  where
//   P(n jumps) = e^(−λT) · (λT)^n / n!           (Poisson weight)
//   σ_n²       = σ² + n·σ_J²/T                   (per-leg variance)
//   r_n        = r − λk + n·(μ_J + σ_J²/2)/T     (per-leg drift)
//
// The series converges geometrically once n > λT; truncate at n=50 or when
// the Poisson weight drops below 1e-15.
//
// Pricing intuition:
//   - λ=0  → collapses to plain GK
//   - For frontier-EM with λ=2/yr and μ_J=+8%, σ_J=12%, the jump component
//     adds ~30–80% to a 30-day OTM call's premium vs flat-vol GK. This is the
//     correct fix for the "1% premium on a 4.5% range" problem the old engine
//     had (see vol-math.ts comments).

export interface MertonInputs extends GKInputs {
  /** Jump intensity (events per year). λ=0 collapses to plain GK. */
  lambda: number;
  /** Mean log-jump size. For frontier-EM USD/local-currency, ~+0.05 to +0.10. */
  jumpMean: number;
  /** Std-dev of log-jump. Typically 0.08–0.20 depending on event severity. */
  jumpStd: number;
  /** Max Poisson terms before truncating the series. Default 50. */
  nTerms?: number;
}

function logFactorial(n: number): number {
  // Σ ln(k) for k=1..n; used in computing log of Poisson weight to avoid
  // numerical underflow at large n (n! overflows float64 around n=170).
  let acc = 0;
  for (let k = 2; k <= n; k++) acc += Math.log(k);
  return acc;
}

/**
 * Merton jump-diffusion call value, in quote-currency units per 1 unit of base.
 *
 * Reduces to garmanKohlhagenCall when lambda = 0.
 */
export function mertonCall(input: MertonInputs): number {
  return mertonPrice(input, "call");
}

/**
 * Merton jump-diffusion put value, in quote-currency units per 1 unit of base.
 */
export function mertonPut(input: MertonInputs): number {
  return mertonPrice(input, "put");
}

function mertonPrice(input: MertonInputs, type: "call" | "put"): number {
  const { S, K, T, r, q, sigma, lambda, jumpMean, jumpStd } = input;
  const nTerms = input.nTerms ?? 50;

  if (lambda <= 0) {
    return type === "call"
      ? garmanKohlhagenCall({ S, K, T, r, q, sigma })
      : garmanKohlhagenPut({ S, K, T, r, q, sigma });
  }
  if (T <= 0) throw new Error("T must be > 0");
  if (sigma <= 0) throw new Error("sigma must be > 0");

  // k = E[J] = e^{μ_J + σ_J²/2} − 1
  const k = Math.exp(jumpMean + 0.5 * jumpStd * jumpStd) - 1;
  // drift compensation so the risk-neutral expectation of S_T stays = S·e^{(r−q)T}
  const rAdjBase = r - lambda * k;

  // Hull §27.1 forward-measure variant: use λ' = λ(1+k) in the Poisson
  // weight (NOT λ). This is mathematically equivalent for pricing but makes
  // put-call parity hold EXACTLY across the truncated sum:
  //   Σ w_n · e^{−r_n·T} = e^{−r·T}   ⇔   λ' = λ(1+k)
  // (proof: a few lines of algebra against the geometric-sum identity).
  // The naive form with λ in the weight has a small bias proportional to
  // k²·λT/(1+k) — invisible for pricing but breaks strict parity tests.
  const lambdaPrime = lambda * (1 + k);
  const lamT = lambdaPrime * T;
  const logLamT = Math.log(lamT);

  let price = 0;
  for (let n = 0; n < nTerms; n++) {
    // Per-leg vol picks up n × σ_J² / T extra variance from n jumps
    const sigmaN = Math.sqrt(sigma * sigma + (n * jumpStd * jumpStd) / T);
    // Per-leg drift picks up the n-jump expected log return scaled to 1/T
    const rN = rAdjBase + (n * (jumpMean + 0.5 * jumpStd * jumpStd)) / T;

    const bs = type === "call"
      ? garmanKohlhagenCall({ S, K, T, r: rN, q, sigma: sigmaN })
      : garmanKohlhagenPut({ S, K, T, r: rN, q, sigma: sigmaN });

    // Poisson weight = e^{−λ'T} · (λ'T)^n / n!   computed in log space
    const logWeight = -lamT + n * logLamT - logFactorial(n);
    const weight = Math.exp(logWeight);
    price += weight * bs;

    if (weight < 1e-15 && n > 10) break;  // Series has converged
  }
  return Math.max(0, price);
}

/**
 * Call-spread value under Merton jump-diffusion.
 *
 * Long call at K_lower, short call at K_upper. The bounded payoff is what makes
 * the BlockFinaX pool insurable — the LP's worst-case loss per hedger is
 * (K_upper − K_lower) per unit, by construction.
 */
export function mertonCallSpread(input: SpreadInputs & {
  lambda: number; jumpMean: number; jumpStd: number; nTerms?: number;
}): number {
  if (input.K_upper <= input.K_lower) throw new Error("K_upper must be > K_lower");
  const lower = mertonCall({
    S: input.S, K: input.K_lower, T: input.T, r: input.r, q: input.q, sigma: input.sigma,
    lambda: input.lambda, jumpMean: input.jumpMean, jumpStd: input.jumpStd, nTerms: input.nTerms,
  });
  const upper = mertonCall({
    S: input.S, K: input.K_upper, T: input.T, r: input.r, q: input.q, sigma: input.sigma,
    lambda: input.lambda, jumpMean: input.jumpMean, jumpStd: input.jumpStd, nTerms: input.nTerms,
  });
  return Math.max(0, lower - upper);
}

/**
 * Put-spread value under Merton jump-diffusion.
 *
 * Long put at K_upper, short put at K_lower. Used for downward hedges
 * (strikeAbove=false): hedger gains when the rate falls into the range.
 */
export function mertonPutSpread(input: SpreadInputs & {
  lambda: number; jumpMean: number; jumpStd: number; nTerms?: number;
}): number {
  if (input.K_upper <= input.K_lower) throw new Error("K_upper must be > K_lower");
  const upper = mertonPut({
    S: input.S, K: input.K_upper, T: input.T, r: input.r, q: input.q, sigma: input.sigma,
    lambda: input.lambda, jumpMean: input.jumpMean, jumpStd: input.jumpStd, nTerms: input.nTerms,
  });
  const lower = mertonPut({
    S: input.S, K: input.K_lower, T: input.T, r: input.r, q: input.q, sigma: input.sigma,
    lambda: input.lambda, jumpMean: input.jumpMean, jumpStd: input.jumpStd, nTerms: input.nTerms,
  });
  return Math.max(0, upper - lower);
}
