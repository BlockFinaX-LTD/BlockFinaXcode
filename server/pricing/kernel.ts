/**
 * kernel.ts — Garman-Kohlhagen pricing math. Pure functions, no I/O, no DB.
 *
 * The whole engine resolves to these primitives. Everything in the data layer
 * exists to feed real numbers into garmanKohlhagenCall / garmanKohlhagenPut.
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
