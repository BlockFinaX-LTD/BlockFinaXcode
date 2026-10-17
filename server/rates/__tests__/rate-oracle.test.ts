/**
 * Rate oracle tests (oracle architecture section 10), for SOFR and KESONIA.
 * Payloads are shaped exactly like the official responses recorded on 2026-10-17.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeBenchmarks, getBenchmark, microToPercent, percentToMicro } from "@shared/rates/benchmarks";
import { parseKesonia, parseSofr, SourceError, type FetchResult, type RateAdapter } from "../adapters";
import { businessDaysBetween, isBusinessDay, previousBusinessDay, zonedInstant } from "../calendar";
import { InMemoryRateRepository, benchmarkStatus, ingest, refreshBenchmark } from "../service";
import { epochDay, expectationFor, fromEpochDay, isLocked, latestExpected, RateValidationError, validateObservation, type RawObservation } from "../validate";

const SOFR = getBenchmark("SOFR");
const KESONIA = getBenchmark("KESONIA");
const NOW = new Date("2026-10-17T12:00:00Z"); // a Saturday

const sofrBody = (rows: Array<Record<string, unknown>>) => JSON.stringify({ refRates: rows });
const sofrRow = (effectiveDate: string, percentRate: unknown, extra: Record<string, unknown> = {}) =>
  ({ effectiveDate, type: "SOFR", percentRate, percentPercentile1: 3.85, volumeInBillions: 2900, revisionIndicator: "", ...extra });
const kesBody = (rows: string[][], total = rows.length) => JSON.stringify({ draw: 1, recordsTotal: String(total), recordsFiltered: String(total), data: rows });
const raw = (b: "SOFR" | "KESONIA", observationDate: string, ratePercent: string, extra: Partial<RawObservation> = {}): RawObservation => ({
  benchmark: b, observationDate, ratePercent, source: getBenchmark(b).source, sourceReference: "test", ...extra,
});
const rejects = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof RateValidationError && e.code === code);

// ── Canonical format ─────────────────────────────────────────────────────────

test("percent strings convert exactly to micro-percent and back", () => {
  assert.equal(percentToMicro("3.87"), 3_870_000);
  assert.equal(percentToMicro("27.50"), 27_500_000);
  assert.equal(percentToMicro("8.7504"), 8_750_400);
  assert.equal(percentToMicro("-0.05"), -50_000);
  assert.equal(percentToMicro("0"), 0);
  assert.equal(microToPercent(3_890_000), "3.890000");
  assert.equal(microToPercent(-50_000), "-0.050000");
  // No floating point drift: 0.1 + 0.2 style values stay exact.
  assert.equal(percentToMicro("4.33"), 4_330_000);
  assert.throws(() => percentToMicro("3.1234567"));
  assert.throws(() => percentToMicro("3.8%"));
  assert.throws(() => percentToMicro("1e2"));
});

test("only SOFR and KESONIA run on testnet; nothing is enabled for production", () => {
  assert.deepEqual(activeBenchmarks(true).map((b) => b.id).sort(), ["KESONIA", "SOFR"]);
  assert.deepEqual(activeBenchmarks(false), []);
});

// ── Calendars ────────────────────────────────────────────────────────────────

test("weekends and holidays are not business days", () => {
  assert.equal(isBusinessDay("US_FED", "2026-10-17"), false); // Saturday
  assert.equal(isBusinessDay("US_FED", "2026-10-12"), false); // Columbus Day, bond market closed
  assert.equal(isBusinessDay("US_FED", "2026-04-03"), false); // Good Friday
  assert.equal(isBusinessDay("KE_CBK", "2026-10-12"), true); // not a Kenyan holiday
  assert.equal(isBusinessDay("KE_CBK", "2025-10-17"), false); // one-off gazetted holiday
  assert.equal(isBusinessDay("KE_CBK", "2026-10-20"), false); // Mashujaa Day
  assert.equal(previousBusinessDay("US_FED", "2026-10-13"), "2026-10-09");
  assert.equal(previousBusinessDay("KE_CBK", "2026-04-07"), "2026-04-02"); // over Easter
});

test("calendar matches the gaps in the recorded source history", () => {
  // SOFR had a value on every one of these days and no others (Sept to Oct 2026).
  const sofrDays = businessDaysBetween("US_FED", "2026-09-01", "2026-10-15");
  assert.equal(sofrDays.includes("2026-09-07"), false);
  assert.equal(sofrDays.includes("2026-10-12"), false);
  assert.equal(sofrDays.length, 31);
});

test("local publication time converts across daylight saving", () => {
  assert.equal(zonedInstant("2026-10-16", "08:00", "America/New_York").toISOString(), "2026-10-16T12:00:00.000Z"); // EDT
  assert.equal(zonedInstant("2026-12-16", "08:00", "America/New_York").toISOString(), "2026-12-16T13:00:00.000Z"); // EST
  assert.equal(zonedInstant("2026-10-16", "09:00", "Africa/Nairobi").toISOString(), "2026-10-16T06:00:00.000Z");
});

// ── Expected observation date and freshness ──────────────────────────────────

test("the expected observation is the previous business day of the latest publication", () => {
  // Saturday: the last publication was Friday 16th, carrying Thursday 15th.
  assert.equal(latestExpected(SOFR, NOW).observationDate, "2026-10-15");
  assert.equal(latestExpected(KESONIA, NOW).observationDate, "2026-10-15");
  // Friday 07:00 New York, before publication: still Wednesday's value from Thursday.
  assert.equal(latestExpected(SOFR, new Date("2026-10-16T11:00:00Z")).observationDate, "2026-10-14");
  // Tuesday after Columbus Day: Friday 9th is published on Tuesday 13th.
  assert.equal(latestExpected(SOFR, new Date("2026-10-13T13:00:00Z")).observationDate, "2026-10-09");
  // Kenya worked on Columbus Day, so Monday 12th carried Friday 9th and Tuesday 13th carries Monday 12th.
  assert.equal(latestExpected(KESONIA, new Date("2026-10-13T07:00:00Z")).observationDate, "2026-10-12");
});

test("a weekend never makes a value stale; a missed publication becomes DELAYED after grace", async () => {
  const repo = new InMemoryRateRepository();
  await ingest(repo, fetchResult("SOFR", [raw("SOFR", "2026-10-15", "3.89")]), NOW);
  assert.equal((await benchmarkStatus(repo, SOFR, NOW)).state, "PUBLISHED");
  assert.equal((await benchmarkStatus(repo, SOFR, new Date("2026-10-18T20:00:00Z"))).state, "PUBLISHED"); // Sunday
  // Monday 19th 10:00 ET: Friday's value is due at 08:00, grace runs to 12:00.
  assert.equal((await benchmarkStatus(repo, SOFR, new Date("2026-10-19T14:00:00Z"))).state, "PENDING");
  assert.equal((await benchmarkStatus(repo, SOFR, new Date("2026-10-19T16:30:00Z"))).state, "DELAYED");
});

test("revision cutoffs: SOFR same day 14:30 ET, KESONIA next business day 12:00", () => {
  const sofr = expectationFor(SOFR, "2026-10-15");
  assert.equal(sofr.publicationDate, "2026-10-16");
  assert.equal(sofr.lockedAfter?.toISOString(), "2026-10-16T18:30:00.000Z");
  const kes = expectationFor(KESONIA, "2026-10-15");
  assert.equal(kes.publicationDate, "2026-10-16");
  assert.equal(kes.lockedAfter?.toISOString(), "2026-10-19T09:00:00.000Z"); // Monday 12:00 Nairobi
  assert.equal(isLocked(KESONIA, "2026-10-15", NOW), false);
  assert.equal(isLocked(SOFR, "2026-10-15", NOW), true);
});

test("observation dates map to epoch days for the chain", () => {
  assert.equal(epochDay("1970-01-02"), 1);
  assert.equal(fromEpochDay(epochDay("2026-10-15")), "2026-10-15");
});

// ── Parsing official payloads ────────────────────────────────────────────────

test("SOFR: parses the New York Fed response, observation date from effectiveDate", () => {
  const rows = parseSofr(sofrBody([sofrRow("2026-10-15", 3.89), sofrRow("2026-10-14", 3.8)]), "NEW_YORK_FED_API", "u");
  assert.equal(rows[0].observationDate, "2026-10-15");
  assert.equal(rows[0].ratePercent, "3.89");
  assert.equal(validateObservation(rows[1], NOW).rateMicroPercent, 3_800_000);
});

test("KESONIA: parses the CBK table, DD/MM/YYYY observation dates", () => {
  const { total, rows } = parseKesonia(kesBody([["14\/10\/2026", "8.7480"], ["15\/10\/2026", "8.7504"]], 281), "CBK_KESONIA_TABLE", "u");
  assert.equal(total, 281);
  assert.equal(rows[1].observationDate, "2026-10-15");
  assert.equal(validateObservation(rows[1], NOW).ratePercent, "8.750400");
});

test("malformed responses are source errors, not values", () => {
  assert.throws(() => parseSofr("<html>maintenance</html>", "NEW_YORK_FED_API", "u"), SourceError);
  assert.throws(() => parseSofr(JSON.stringify({ refRates: [{ type: "EFFR", effectiveDate: "2026-10-15", percentRate: 4 }] }), "NEW_YORK_FED_API", "u"), SourceError);
  assert.throws(() => parseSofr(sofrBody([{ type: "SOFR", effectiveDate: "2026-10-15" }]), "NEW_YORK_FED_API", "u"), SourceError);
  assert.throws(() => parseKesonia(JSON.stringify({ data: "x" }), "CBK_KESONIA_TABLE", "u"), SourceError);
  assert.throws(() => parseKesonia(kesBody([["2026-10-15", "8.75"]]), "CBK_KESONIA_TABLE", "u"), SourceError);
});

// ── Validation ───────────────────────────────────────────────────────────────

test("rejects wrong scale, zero, negatives, extra precision and non-numbers", () => {
  rejects(() => validateObservation(raw("SOFR", "2026-10-15", "389"), NOW), "OUT_OF_RANGE"); // basis points as percent
  rejects(() => validateObservation(raw("KESONIA", "2026-10-15", "0.087504"), NOW), "TOO_PRECISE"); // a fraction, not percent
  rejects(() => validateObservation(raw("KESONIA", "2026-10-15", "87.504"), NOW), "OUT_OF_RANGE");
  rejects(() => validateObservation(raw("KESONIA", "2026-10-15", "0"), NOW), "ZERO_NOT_ALLOWED");
  rejects(() => validateObservation(raw("KESONIA", "2026-10-15", "-0.5"), NOW), "NEGATIVE_NOT_ALLOWED");
  rejects(() => validateObservation(raw("SOFR", "2026-10-15", "3.891"), NOW), "TOO_PRECISE");
  rejects(() => validateObservation(raw("SOFR", "2026-10-15", "N/A"), NOW), "MALFORMED");
});

test("SOFR may be zero or negative; KESONIA may not", () => {
  assert.equal(validateObservation(raw("SOFR", "2026-10-15", "0.00"), NOW).rateMicroPercent, 0);
  assert.equal(validateObservation(raw("SOFR", "2026-10-15", "-0.01"), NOW).rateMicroPercent, -10_000);
});

test("rejects weekend, holiday, future and impossible observation dates", () => {
  rejects(() => validateObservation(raw("SOFR", "2026-10-17", "3.89"), NOW), "NOT_BUSINESS_DAY");
  rejects(() => validateObservation(raw("SOFR", "2026-10-12", "3.89"), NOW), "NOT_BUSINESS_DAY");
  rejects(() => validateObservation(raw("SOFR", "2026-10-20", "3.89"), NOW), "FUTURE_DATE");
  rejects(() => validateObservation(raw("SOFR", "2026-02-30", "3.89"), NOW), "BAD_DATE");
});

test("rejects an unregistered source and a tenor on an overnight benchmark", () => {
  rejects(() => validateObservation(raw("SOFR", "2026-10-15", "3.89", { source: "SOME_AGGREGATOR" }), NOW), "UNKNOWN_SOURCE");
  rejects(() => validateObservation(raw("SOFR", "2026-10-15", "3.89", { tenor: "3M" }), NOW), "WRONG_TENOR");
  assert.equal(validateObservation(raw("SOFR", "2026-10-15", "3.89", { source: "NEW_YORK_FED_SEARCH" }), NOW).source, "NEW_YORK_FED_SEARCH");
});

// ── Store: duplicates, revisions, old dates ──────────────────────────────────

function fetchResult(b: "SOFR" | "KESONIA", observations: RawObservation[]): FetchResult {
  return { source: getBenchmark(b).source, url: "u", body: "{}", observations };
}

test("a duplicate fetch stores nothing new", async () => {
  const repo = new InMemoryRateRepository();
  const r = fetchResult("KESONIA", [raw("KESONIA", "2026-10-15", "8.7504"), raw("KESONIA", "2026-10-14", "8.7480")]);
  assert.equal((await ingest(repo, r, NOW)).accepted, 2);
  const again = await ingest(repo, r, NOW);
  assert.equal(again.accepted, 0);
  assert.equal(again.unchanged, 2);
  assert.equal(repo.rows.size, 2);
});

test("two values for one date in one response are rejected", async () => {
  const repo = new InMemoryRateRepository();
  const s = await ingest(repo, fetchResult("KESONIA", [raw("KESONIA", "2026-10-15", "8.7504"), raw("KESONIA", "2026-10-15", "8.9000")]), NOW);
  assert.equal(s.accepted, 1);
  assert.equal(s.rejected[0].code, "CONFLICTING_DUPLICATE");
});

test("a correction before the cutoff replaces the value and keeps the old one", async () => {
  const repo = new InMemoryRateRepository();
  await ingest(repo, fetchResult("KESONIA", [raw("KESONIA", "2026-10-15", "8.7504")]), NOW);
  const s = await ingest(repo, fetchResult("KESONIA", [raw("KESONIA", "2026-10-15", "8.7604")]), new Date("2026-10-19T08:00:00Z"));
  assert.equal(s.revised, 1);
  const o = await repo.get("KESONIA", "2026-10-15");
  assert.equal(o?.rateMicroPercent, 8_760_400);
  assert.equal(o?.status, "REVISED");
  assert.deepEqual(o?.revisions.map((r) => [r.rateMicroPercent, r.afterLock]), [[8_750_400, false]]);
});

test("a change after the cutoff is recorded but does not replace the locked value", async () => {
  const repo = new InMemoryRateRepository();
  await ingest(repo, fetchResult("SOFR", [raw("SOFR", "2026-10-15", "3.89")]), new Date("2026-10-16T12:30:00Z"));
  await ingest(repo, fetchResult("SOFR", [raw("SOFR", "2026-10-15", "3.90", { revisionIndicator: "R" })]), NOW);
  const o = await repo.get("SOFR", "2026-10-15");
  assert.equal(o?.rateMicroPercent, 3_890_000);
  assert.deepEqual(o?.revisions.map((r) => [r.rateMicroPercent, r.afterLock]), [[3_900_000, true]]);
});

test("an old observation date is stored under its own date and is not the latest", async () => {
  const repo = new InMemoryRateRepository();
  await ingest(repo, fetchResult("SOFR", [raw("SOFR", "2026-10-15", "3.89")]), NOW);
  await ingest(repo, fetchResult("SOFR", [raw("SOFR", "2026-09-01", "4.36")]), NOW);
  assert.equal((await repo.latest("SOFR"))?.observationDate, "2026-10-15");
  assert.equal((await repo.get("SOFR", "2026-09-01"))?.rateMicroPercent, 4_360_000);
});

test("a stale latest value still shows DELAYED, not a fresh state", async () => {
  const repo = new InMemoryRateRepository();
  await ingest(repo, fetchResult("SOFR", [raw("SOFR", "2026-10-08", "3.92")]), NOW);
  const s = await benchmarkStatus(repo, SOFR, NOW);
  assert.equal(s.state, "DELAYED");
  assert.equal(s.latest?.observationDate, "2026-10-08");
});

// ── Outage and fallback ──────────────────────────────────────────────────────

test("a source outage is logged and stores nothing", async () => {
  const repo = new InMemoryRateRepository();
  const down: RateAdapter = { benchmark: "KESONIA", fetchLatest: async () => { throw new SourceError("CBK_KESONIA_TABLE", "HTTP 503"); } };
  await assert.rejects(refreshBenchmark(repo, "KESONIA", down), SourceError);
  assert.equal(repo.rows.size, 0);
  assert.equal(repo.fetches[0].ok, false);
});

test("values from the official fallback are accepted and attributed to it", async () => {
  const repo = new InMemoryRateRepository();
  const viaFallback: RateAdapter = {
    benchmark: "SOFR",
    fetchLatest: async () => ({ source: "NEW_YORK_FED_SEARCH", url: "u", body: "{}", observations: [raw("SOFR", "2026-10-15", "3.89", { source: "NEW_YORK_FED_SEARCH" })] }),
  };
  const s = await refreshBenchmark(repo, "SOFR", viaFallback);
  assert.equal(s.accepted, 1);
  assert.equal((await repo.get("SOFR", "2026-10-15"))?.source, "NEW_YORK_FED_SEARCH");
});
