/**
 * Validation and freshness for interest-rate observations (oracle architecture sections 5, 6 and 9).
 *
 * Pure functions: the observation store and the scheduler call these, and so do the tests.
 */
import { getBenchmark, microToPercent, percentToMicro, type Benchmark, type BenchmarkId } from "@shared/rates/benchmarks";
import { addDays, isBusinessDay, isValidIsoDate, localParts, nextBusinessDay, previousBusinessDay, zonedInstant } from "./calendar";

/** One value as an adapter read it from the official source, before validation. */
export interface RawObservation {
  benchmark: BenchmarkId;
  /** The business day the rate represents (YYYY-MM-DD). */
  observationDate: string;
  /** Exactly as published, in percent ("3.89", "8.7504"). */
  ratePercent: string;
  source: string;
  sourceReference: string;
  /** Administrator's own revision flag, if the source has one. */
  revisionIndicator?: string;
  /** Tenor printed by the source, for term benchmarks. */
  tenor?: string;
}

export interface Observation {
  benchmark: BenchmarkId;
  currency: string;
  observationDate: string;
  ratePercent: string;
  rateMicroPercent: number;
  source: string;
  sourceReference: string;
  revised: boolean;
}

export class RateValidationError extends Error {
  constructor(readonly code: RateRejection, message: string) {
    super(message);
    this.name = "RateValidationError";
  }
}

export type RateRejection =
  | "UNKNOWN_SOURCE" | "BAD_DATE" | "NOT_BUSINESS_DAY" | "FUTURE_DATE" | "MALFORMED"
  | "OUT_OF_RANGE" | "ZERO_NOT_ALLOWED" | "NEGATIVE_NOT_ALLOWED" | "TOO_PRECISE" | "WRONG_TENOR";

/**
 * Checks one raw value against the registry. Rejects, never repairs: an implausible scale
 * (for example 0.0389 or 389 for SOFR) is malformed, not divided or multiplied into range.
 */
export function validateObservation(raw: RawObservation, now = new Date()): Observation {
  const b = getBenchmark(raw.benchmark);
  const fail = (code: RateRejection, msg: string) => { throw new RateValidationError(code, `${b.id} ${raw.observationDate}: ${msg}`); };

  if (raw.source !== b.source && raw.source !== b.fallbackSource) fail("UNKNOWN_SOURCE", `source ${raw.source} is not registered`);
  if (b.tenor && raw.tenor !== b.tenor) fail("WRONG_TENOR", `tenor ${raw.tenor ?? "missing"} is not ${b.tenor}`);
  if (!b.tenor && raw.tenor) fail("WRONG_TENOR", `unexpected tenor ${raw.tenor}`);
  if (!isValidIsoDate(raw.observationDate)) fail("BAD_DATE", "observation date is not a valid date");
  if (raw.observationDate > localParts(now, b.timeZone).date) fail("FUTURE_DATE", "observation date is in the future");
  if (b.frequency === "BUSINESS_DAILY" && !isBusinessDay(b.calendar, raw.observationDate)) {
    fail("NOT_BUSINESS_DAY", `${raw.observationDate} is not a ${b.calendar} business day`);
  }

  const text = String(raw.ratePercent).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) fail("MALFORMED", `rate "${raw.ratePercent}" is not a decimal number`);
  const places = (text.split(".")[1] ?? "").length;
  if (places > b.decimals) fail("TOO_PRECISE", `rate "${text}" has ${places} decimals; ${b.id} publishes ${b.decimals}`);
  const micro = percentToMicro(text);
  if (micro === 0 && !b.allowsZero) fail("ZERO_NOT_ALLOWED", "zero is not a legitimate value");
  if (micro < 0 && !b.allowsNegative) fail("NEGATIVE_NOT_ALLOWED", "negative values are not allowed");
  const [lo, hi] = b.plausibleRange;
  if (micro < lo * 1_000_000 || micro > hi * 1_000_000) fail("OUT_OF_RANGE", `rate ${text}% is outside ${lo}% to ${hi}%`);

  return {
    benchmark: b.id, currency: b.currency, observationDate: raw.observationDate,
    ratePercent: microToPercent(micro), rateMicroPercent: micro,
    source: raw.source, sourceReference: raw.sourceReference,
    revised: Boolean(raw.revisionIndicator && raw.revisionIndicator.trim() !== ""),
  };
}

// ── Freshness ────────────────────────────────────────────────────────────────

export type FreshnessState = "PUBLISHED" | "PENDING" | "DELAYED";

export interface Expectation {
  /** The observation date the latest publication should carry. */
  observationDate: string;
  /** Local publication day of that observation. */
  publicationDate: string;
  expectedAt: Date;
  delayedAfter: Date;
  /** Instant after which this value can no longer be revised (settlement lock). */
  lockedAfter: Date | null;
}

/** For daily benchmarks published the business day after the observation. */
export function publicationDayFor(b: Benchmark, observationDate: string): string {
  return b.observationConvention === "PREVIOUS_BUSINESS_DAY" ? nextBusinessDay(b.calendar, observationDate) : observationDate;
}

function lockInstant(b: Benchmark, publicationDate: string): Date | null {
  const rule = b.revisionCutoff;
  if (rule.kind === "NONE") return null;
  const day = rule.kind === "SAME_DAY" ? publicationDate : nextBusinessDay(b.calendar, publicationDate);
  return zonedInstant(day, rule.time, b.timeZone);
}

export function expectationFor(b: Benchmark, observationDate: string): Expectation {
  if (!b.publicationTime) throw new Error(`${b.id} has no scheduled publication time`);
  const publicationDate = publicationDayFor(b, observationDate);
  const expectedAt = zonedInstant(publicationDate, b.publicationTime, b.timeZone);
  return {
    observationDate, publicationDate, expectedAt,
    delayedAfter: new Date(expectedAt.getTime() + b.graceHours * 3_600_000),
    lockedAfter: lockInstant(b, publicationDate),
  };
}

/**
 * The most recent observation that should have been published by `now`, for business-daily
 * benchmarks. Before today's publication time, that is the observation published on the
 * previous business day. Weekends and holidays roll back to the last publication.
 */
export function latestExpected(b: Benchmark, now = new Date()): Expectation {
  if (b.frequency !== "BUSINESS_DAILY") throw new Error(`${b.id} is not business-daily`);
  const local = localParts(now, b.timeZone);
  let pub = local.date;
  if (!isBusinessDay(b.calendar, pub) || local.time < (b.publicationTime ?? "00:00")) pub = previousBusinessDay(b.calendar, pub);
  // Observation is the business day before the publication day (or the same day for SAME_DAY benchmarks).
  const obs = b.observationConvention === "PREVIOUS_BUSINESS_DAY" ? previousBusinessDay(b.calendar, pub) : pub;
  return expectationFor(b, obs);
}

/** State of an expected observation given whether we hold it. */
export function freshness(exp: Expectation, have: boolean, now = new Date()): FreshnessState {
  if (have) return "PUBLISHED";
  return now.getTime() > exp.delayedAfter.getTime() ? "DELAYED" : "PENDING";
}

/** Whether a stored value is past its revision cutoff and may be submitted on chain for settlement. */
export function isLocked(b: Benchmark, observationDate: string, now = new Date()): boolean {
  const exp = expectationFor(b, observationDate);
  return exp.lockedAfter ? now.getTime() >= exp.lockedAfter.getTime() : now.getTime() >= exp.expectedAt.getTime();
}

/** Days since 1970-01-01, the on-chain form of an observation date. */
export function epochDay(date: string): number {
  return Math.round(new Date(`${date}T00:00:00Z`).getTime() / 86_400_000);
}

export function fromEpochDay(day: number): string {
  return addDays("1970-01-01", day);
}
