/**
 * Currency-pool economics, once, for every chain.
 *
 * Integer arithmetic that reproduces the contracts exactly (Base pool facets and the
 * Stellar currency-pool contract round the same way in the same order). The shared
 * parity vectors (parity/vectors/currency-pool.v1.json) pin the result on both chains;
 * server/domain tests pin this module against the same numbers.
 *
 * Units: token amounts are integers in the asset's own decimals; FX rates are 6-decimal
 * integers; rates use 1e6 = 100%; bps use 1e4 = 100%. Nothing here depends on which
 * decimals the asset has.
 */
import { type ApplicationErrorCode, type PoolStructures, type ProtectionStructure } from "./types";

export const RATE_SCALE = BigInt(1_000_000);
export const BPS = BigInt(10_000);
export const STRUCTURE_CODE: Record<ProtectionStructure, 0 | 1> = { open: 0, capped: 1 };

export const TENOR_LIMITS = { minDays: 1, maxDays: 365, maxPerPool: 16 } as const;
export const MARKUP_LIMITS = { minBps: 9_000, maxBps: 50_000 } as const;
export const DEFAULT_TENOR_DAYS = [3, 7, 14, 30, 45] as const;

const TWO = BigInt(2);
const ZERO = BigInt(0);

/** The cap an Open hedge is priced and reserved against. */
export function openCap(maxPayoutBps: bigint, strikeAbove: boolean, spot: bigint, strike: bigint): bigint {
  const move = (spot * maxPayoutBps) / BPS;
  if (strikeAbove) {
    const cap = strike + move;
    return cap > spot * TWO ? spot * TWO : cap;
  }
  const floor = spot / TWO;
  return strike > floor + move ? strike - move : floor;
}

export function maxPayout(notional: bigint, strike: bigint, cap: bigint, spot: bigint): bigint {
  const width = cap > strike ? cap - strike : strike - cap;
  return (notional * width) / spot;
}

/** Offer rate = fair x markup, rounded down. */
export function offerRate(fairRate: bigint, markupBps: bigint): bigint {
  return (fairRate * markupBps) / BPS;
}

export function costBreakdown(a: { notional: bigint; fairRate: bigint; markupBps: bigint; hedgerFeeRate: bigint }) {
  const premiumRate = offerRate(a.fairRate, a.markupBps);
  const premium = (a.notional * premiumRate) / RATE_SCALE;
  const platformFee = (premium * a.hedgerFeeRate) / RATE_SCALE;
  return { premiumRate, premium, platformFee, totalCost: premium + platformFee };
}

/** Payout at a settlement price, before the payout fee. */
export function settlementPayout(a: {
  notional: bigint; spot: bigint; strike: bigint; cap: bigint; strikeAbove: boolean; price: bigint; maxPayout: bigint;
}): bigint {
  let payout = ZERO;
  if (a.strikeAbove && a.price > a.strike) {
    payout = (a.notional * ((a.price > a.cap ? a.cap : a.price) - a.strike)) / a.spot;
  } else if (!a.strikeAbove && a.price < a.strike) {
    payout = (a.notional * (a.strike - (a.price < a.cap ? a.cap : a.price))) / a.spot;
  }
  return payout > a.maxPayout ? a.maxPayout : payout;
}

/** Fee taken from a gross payout at claim, and the hedger's net. */
export function payoutAfterFee(gross: bigint, payoutFeeRate: bigint) {
  const fee = (gross * payoutFeeRate) / RATE_SCALE;
  return { fee, net: gross - fee };
}

export interface TermsProblem {
  code: ApplicationErrorCode;
  /** The same wording the contracts use, for display and logs. */
  message: string;
}

/** The contracts' strike, cap and structure rules. Null when the terms are acceptable. */
export function checkTerms(a: {
  structures: PoolStructures;
  structure: ProtectionStructure;
  strikeAbove: boolean;
  spot: bigint;
  strike: bigint;
  cap: bigint;
}): TermsProblem | null {
  const { spot, strike, cap, strikeAbove } = a;
  if (spot <= ZERO || strike <= ZERO || cap <= ZERO) return { code: "INVALID_REQUEST", message: "Spot, strike and cap required" };
  if (strikeAbove) {
    if (!(strike >= spot && strike < spot * TWO)) return { code: "INVALID_STRIKE", message: "Strike must be at or above spot, below 2x" };
    if (!(cap > strike && cap <= spot * TWO)) return { code: "INVALID_CAP", message: "Cap must be above strike, at most 2x spot" };
  } else {
    if (!(strike <= spot && strike > spot / TWO)) return { code: "INVALID_STRIKE", message: "Strike must be at or below spot, above 0.5x" };
    if (!(cap < strike && cap >= spot / TWO)) return { code: "INVALID_CAP", message: "Cap must be below strike, at least 0.5x spot" };
  }
  if (a.structure === "capped") {
    if (!a.structures.capped) return { code: "STRUCTURE_NOT_OFFERED", message: "Capped protection not offered" };
    const maxBps = BigInt(a.structures.maxCapDistanceBps);
    if (maxBps > ZERO) {
      const distance = strikeAbove ? cap - strike : strike - cap;
      const distanceBps = (distance * BPS) / strike;
      if (distanceBps < BigInt(a.structures.minCapDistanceBps) || distanceBps > maxBps) {
        return { code: "INVALID_CAP", message: "Cap outside the pool's boundaries" };
      }
    }
  } else {
    if (!a.structures.open) return { code: "STRUCTURE_NOT_OFFERED", message: "Open protection not offered" };
    if (cap !== openCap(BigInt(a.structures.openMaxPayoutBps), strikeAbove, spot, strike)) {
      return { code: "INVALID_CAP", message: "Open cap mismatch" };
    }
  }
  return null;
}

export function validateTenor(t: { tenorDays: number; markupBps: number }): TermsProblem | null {
  if (!Number.isInteger(t.tenorDays) || t.tenorDays < TENOR_LIMITS.minDays || t.tenorDays > TENOR_LIMITS.maxDays) {
    return { code: "INVALID_TENOR", message: "Tenor must be 1 to 365 days" };
  }
  if (t.markupBps < MARKUP_LIMITS.minBps) return { code: "INVALID_TENOR", message: "Offer below 90% of fair price" };
  if (t.markupBps > MARKUP_LIMITS.maxBps) return { code: "INVALID_TENOR", message: "Offer above 5x fair price" };
  return null;
}

// ── Units ─────────────────────────────────────────────────────────────────────

function pow10(n: number): bigint {
  let v = BigInt(1);
  for (let i = 0; i < n; i++) v *= BigInt(10);
  return v;
}

/** "1800.5" with 6 decimals -> 1800500000n. Truncates extra digits, as the contracts do. */
export function toUnits(value: string | number, decimals: number): bigint {
  const s = typeof value === "number" ? value.toFixed(Math.max(decimals, 9)) : value.trim();
  const neg = s.startsWith("-");
  const [w, f = ""] = (neg ? s.slice(1) : s).split(".");
  const v = BigInt(w || "0") * pow10(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  return neg ? -v : v;
}

/** 1800500000n with 6 decimals -> "1800.5". Exact, trailing zeros trimmed. */
export function fromUnits(value: bigint, decimals: number): string {
  const neg = value < ZERO;
  const abs = neg ? -value : value;
  const unit = pow10(decimals);
  const s = `${abs / unit}.${(abs % unit).toString().padStart(decimals, "0")}`.replace(/0+$/, "").replace(/\.$/, "");
  return (neg ? "-" : "") + s;
}

export const toRate = (value: string | number) => toUnits(value, 6);
export const fromRate = (value: bigint) => fromUnits(value, 6);
