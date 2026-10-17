/**
 * Interest-rate benchmark registry (docs/rates/v1/benchmark-registry-v1.0.md).
 *
 * Code refers to benchmarks only by these canonical IDs. A benchmark is usable in
 * production only when `enabled` is true, which requires licensing CLEARED and tests;
 * `testnet` allows it on the testnet deployment while licensing is being confirmed.
 */

export type BenchmarkId =
  | "SOFR" | "SONIA" | "EURIBOR_1M" | "EURIBOR_3M" | "EURIBOR_6M" | "KESONIA" | "NOFR"
  | "GHS_REFERENCE_RATE" | "GHS_TBILL_91D" | "ZARONIA" | "KES_CBR" | "GHS_MPR" | "NGN_MPR" | "ZAR_REPO";

export type BenchmarkType = "DAILY_OVERNIGHT" | "TERM" | "MONTHLY_REFERENCE" | "AUCTION" | "POLICY";
export type ObservationConvention = "SAME_DAY" | "PREVIOUS_BUSINESS_DAY" | "EFFECTIVE_DATE" | "AUCTION_DATE" | "IN_FORCE_ON_DATE";
export type LicensingStatus = "CLEARED" | "NEEDS_LICENCE" | "UNCONFIRMED" | "BLOCKED" | "PUBLIC_ANNOUNCEMENT";
export type CalendarId = "US_FED" | "UK_LONDON" | "TARGET2" | "KE_CBK" | "NG_CBN" | "GH" | "ZA_SARB";

export interface Benchmark {
  id: BenchmarkId;
  name: string;
  currency: string;
  administrator: string;
  type: BenchmarkType;
  tenor?: string;
  frequency: "BUSINESS_DAILY" | "MONTHLY" | "WEEKLY_AUCTION" | "ON_DECISION";
  /** Primary official source, by adapter key. */
  source: string;
  fallbackSource?: string;
  /** Third-party source for anomaly checks only; never the value. */
  validationSource?: string;
  /** Decimal places the administrator publishes (in percent). */
  decimals: number;
  /** Expected publication, local time "HH:MM" in `timeZone`. */
  publicationTime?: string;
  timeZone: string;
  observationConvention: ObservationConvention;
  calendar: CalendarId;
  /** After this, a published value is locked: local "HH:MM" on the publication day, or a rule. */
  revisionCutoff: { kind: "SAME_DAY"; time: string } | { kind: "NEXT_BUSINESS_DAY"; time: string } | { kind: "NONE" };
  /** Hours after expected publication before a missing value is DELAYED. */
  graceHours: number;
  /** Plausible range in percent; values outside are malformed, not clipped. */
  plausibleRange: [number, number];
  allowsNegative: boolean;
  allowsZero: boolean;
  dayCountBasis: 360 | 365;
  licensing: LicensingStatus;
  /** Production use (licensing cleared and tested). */
  enabled: boolean;
  /** Testnet use while licensing is being confirmed. */
  testnet: boolean;
}

const daily = (b: Omit<Benchmark, "type" | "frequency" | "observationConvention">): Benchmark => ({
  type: "DAILY_OVERNIGHT", frequency: "BUSINESS_DAILY", observationConvention: "PREVIOUS_BUSINESS_DAY", ...b,
});

export const BENCHMARKS: Record<BenchmarkId, Benchmark> = {
  SOFR: daily({
    id: "SOFR", name: "Secured Overnight Financing Rate", currency: "USD", administrator: "FEDERAL_RESERVE_BANK_OF_NEW_YORK",
    source: "NEW_YORK_FED_API", fallbackSource: "NEW_YORK_FED_SEARCH", decimals: 2, publicationTime: "08:00", timeZone: "America/New_York",
    calendar: "US_FED", revisionCutoff: { kind: "SAME_DAY", time: "14:30" }, graceHours: 4, plausibleRange: [-2, 25],
    allowsNegative: true, allowsZero: true, dayCountBasis: 360, licensing: "CLEARED", enabled: false, testnet: true,
  }),
  SONIA: daily({
    id: "SONIA", name: "Sterling Overnight Index Average", currency: "GBP", administrator: "BANK_OF_ENGLAND",
    source: "BOE_IADB", decimals: 4, publicationTime: "09:00", timeZone: "Europe/London", calendar: "UK_LONDON",
    revisionCutoff: { kind: "SAME_DAY", time: "12:00" }, graceHours: 4, plausibleRange: [-2, 25], allowsNegative: true, allowsZero: true,
    dayCountBasis: 365, licensing: "NEEDS_LICENCE", enabled: false, testnet: false,
  }),
  EURIBOR_1M: { id: "EURIBOR_1M", name: "Euro Interbank Offered Rate 1M", currency: "EUR", administrator: "EMMI", type: "TERM", tenor: "1M", frequency: "BUSINESS_DAILY", source: "EMMI", decimals: 3, publicationTime: "11:00", timeZone: "Europe/Brussels", observationConvention: "SAME_DAY", calendar: "TARGET2", revisionCutoff: { kind: "NONE" }, graceHours: 4, plausibleRange: [-2, 25], allowsNegative: true, allowsZero: true, dayCountBasis: 360, licensing: "BLOCKED", enabled: false, testnet: false },
  EURIBOR_3M: { id: "EURIBOR_3M", name: "Euro Interbank Offered Rate 3M", currency: "EUR", administrator: "EMMI", type: "TERM", tenor: "3M", frequency: "BUSINESS_DAILY", source: "EMMI", decimals: 3, publicationTime: "11:00", timeZone: "Europe/Brussels", observationConvention: "SAME_DAY", calendar: "TARGET2", revisionCutoff: { kind: "NONE" }, graceHours: 4, plausibleRange: [-2, 25], allowsNegative: true, allowsZero: true, dayCountBasis: 360, licensing: "BLOCKED", enabled: false, testnet: false },
  EURIBOR_6M: { id: "EURIBOR_6M", name: "Euro Interbank Offered Rate 6M", currency: "EUR", administrator: "EMMI", type: "TERM", tenor: "6M", frequency: "BUSINESS_DAILY", source: "EMMI", decimals: 3, publicationTime: "11:00", timeZone: "Europe/Brussels", observationConvention: "SAME_DAY", calendar: "TARGET2", revisionCutoff: { kind: "NONE" }, graceHours: 4, plausibleRange: [-2, 25], allowsNegative: true, allowsZero: true, dayCountBasis: 360, licensing: "BLOCKED", enabled: false, testnet: false },
  KESONIA: daily({
    id: "KESONIA", name: "Kenya Shilling Overnight Interbank Average", currency: "KES", administrator: "CENTRAL_BANK_OF_KENYA",
    source: "CBK_KESONIA_TABLE", decimals: 4, publicationTime: "09:00", timeZone: "Africa/Nairobi",
    // CBK publishes no correction policy; lock at 12:00 on the business day after publication (settlement rules section 3).
    calendar: "KE_CBK", revisionCutoff: { kind: "NEXT_BUSINESS_DAY", time: "12:00" }, graceHours: 4, plausibleRange: [0, 40],
    allowsNegative: false, allowsZero: false, dayCountBasis: 365, licensing: "UNCONFIRMED", enabled: false, testnet: true,
  }),
  NOFR: daily({
    id: "NOFR", name: "Nigerian Overnight Financing Rate", currency: "NGN", administrator: "CENTRAL_BANK_OF_NIGERIA",
    source: "CBN_NOFR", decimals: 2, publicationTime: "10:00", timeZone: "Africa/Lagos", calendar: "NG_CBN",
    revisionCutoff: { kind: "NEXT_BUSINESS_DAY", time: "12:00" }, graceHours: 4, plausibleRange: [0, 60], allowsNegative: false, allowsZero: false,
    dayCountBasis: 360, licensing: "UNCONFIRMED", enabled: false, testnet: false,
  }),
  GHS_REFERENCE_RATE: { id: "GHS_REFERENCE_RATE", name: "Ghana Reference Rate", currency: "GHS", administrator: "GHANA_ASSOCIATION_OF_BANKS", type: "MONTHLY_REFERENCE", frequency: "MONTHLY", source: "GAB_NOTICE", decimals: 2, timeZone: "Africa/Accra", observationConvention: "EFFECTIVE_DATE", calendar: "GH", revisionCutoff: { kind: "NONE" }, graceHours: 240, plausibleRange: [0, 60], allowsNegative: false, allowsZero: false, dayCountBasis: 365, licensing: "UNCONFIRMED", enabled: false, testnet: false },
  GHS_TBILL_91D: { id: "GHS_TBILL_91D", name: "Government of Ghana 91-day Treasury bill", currency: "GHS", administrator: "BANK_OF_GHANA", type: "AUCTION", tenor: "91D", frequency: "WEEKLY_AUCTION", source: "BOG_AUCTION_RESULTS", decimals: 4, timeZone: "Africa/Accra", observationConvention: "AUCTION_DATE", calendar: "GH", revisionCutoff: { kind: "NONE" }, graceHours: 72, plausibleRange: [0, 60], allowsNegative: false, allowsZero: false, dayCountBasis: 365, licensing: "UNCONFIRMED", enabled: false, testnet: false },
  ZARONIA: daily({
    id: "ZARONIA", name: "South African Rand Overnight Index Average", currency: "ZAR", administrator: "SOUTH_AFRICAN_RESERVE_BANK",
    source: "SARB_ZARONIA", decimals: 3, publicationTime: "10:00", timeZone: "Africa/Johannesburg", calendar: "ZA_SARB",
    revisionCutoff: { kind: "SAME_DAY", time: "12:00" }, graceHours: 4, plausibleRange: [0, 30], allowsNegative: false, allowsZero: false,
    dayCountBasis: 365, licensing: "UNCONFIRMED", enabled: false, testnet: false,
  }),
  KES_CBR: { id: "KES_CBR", name: "Central Bank Rate (Kenya)", currency: "KES", administrator: "CENTRAL_BANK_OF_KENYA", type: "POLICY", frequency: "ON_DECISION", source: "CBK_MPC_STATEMENT", decimals: 2, timeZone: "Africa/Nairobi", observationConvention: "IN_FORCE_ON_DATE", calendar: "KE_CBK", revisionCutoff: { kind: "NONE" }, graceHours: 0, plausibleRange: [0, 40], allowsNegative: false, allowsZero: false, dayCountBasis: 365, licensing: "PUBLIC_ANNOUNCEMENT", enabled: false, testnet: false },
  GHS_MPR: { id: "GHS_MPR", name: "Monetary Policy Rate (Ghana)", currency: "GHS", administrator: "BANK_OF_GHANA", type: "POLICY", frequency: "ON_DECISION", source: "BOG_MPC_STATEMENT", decimals: 2, timeZone: "Africa/Accra", observationConvention: "IN_FORCE_ON_DATE", calendar: "GH", revisionCutoff: { kind: "NONE" }, graceHours: 0, plausibleRange: [0, 60], allowsNegative: false, allowsZero: false, dayCountBasis: 365, licensing: "PUBLIC_ANNOUNCEMENT", enabled: false, testnet: false },
  NGN_MPR: { id: "NGN_MPR", name: "Monetary Policy Rate (Nigeria)", currency: "NGN", administrator: "CENTRAL_BANK_OF_NIGERIA", type: "POLICY", frequency: "ON_DECISION", source: "CBN_MPC_COMMUNIQUE", decimals: 2, timeZone: "Africa/Lagos", observationConvention: "IN_FORCE_ON_DATE", calendar: "NG_CBN", revisionCutoff: { kind: "NONE" }, graceHours: 0, plausibleRange: [0, 60], allowsNegative: false, allowsZero: false, dayCountBasis: 360, licensing: "PUBLIC_ANNOUNCEMENT", enabled: false, testnet: false },
  ZAR_REPO: { id: "ZAR_REPO", name: "Repurchase rate (South Africa)", currency: "ZAR", administrator: "SOUTH_AFRICAN_RESERVE_BANK", type: "POLICY", frequency: "ON_DECISION", source: "SARB_MPC_STATEMENT", decimals: 2, timeZone: "Africa/Johannesburg", observationConvention: "IN_FORCE_ON_DATE", calendar: "ZA_SARB", revisionCutoff: { kind: "NONE" }, graceHours: 0, plausibleRange: [0, 30], allowsNegative: false, allowsZero: false, dayCountBasis: 365, licensing: "PUBLIC_ANNOUNCEMENT", enabled: false, testnet: false },
};

export function getBenchmark(id: string): Benchmark {
  const b = (BENCHMARKS as Record<string, Benchmark>)[id];
  if (!b) throw new Error(`Unknown benchmark ${id}`);
  return b;
}

/** Benchmarks this deployment may use. */
export function activeBenchmarks(testnet: boolean): Benchmark[] {
  return Object.values(BENCHMARKS).filter((b) => b.enabled || (testnet && b.testnet));
}

// ── Canonical rate format ────────────────────────────────────────────────────
// Integer millionths of a percent: 3.87% = 3_870_000. Signed. Never a fraction like 0.0387.

const MICRO_DIGITS = 6;

/** Exact conversion of a percent string ("3.87", "-0.05", "9.5922") to micro-percent. */
export function percentToMicro(percent: string): number {
  const s = String(percent).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Malformed rate "${percent}"`);
  const neg = s.startsWith("-");
  const [whole, frac = ""] = (neg ? s.slice(1) : s).split(".");
  if (frac.length > MICRO_DIGITS) throw new Error(`Rate "${percent}" has more than ${MICRO_DIGITS} decimal places`);
  const micro = Number(whole) * 1_000_000 + Number((frac + "000000").slice(0, MICRO_DIGITS));
  if (!Number.isSafeInteger(micro)) throw new Error(`Rate "${percent}" is out of range`);
  return neg ? -micro : micro;
}

/** Micro-percent to a 6-decimal percent string: 3870000 -> "3.870000". */
export function microToPercent(micro: number): string {
  const neg = micro < 0;
  const abs = Math.abs(micro);
  return `${neg ? "-" : ""}${Math.floor(abs / 1_000_000)}.${String(abs % 1_000_000).padStart(MICRO_DIGITS, "0")}`;
}
