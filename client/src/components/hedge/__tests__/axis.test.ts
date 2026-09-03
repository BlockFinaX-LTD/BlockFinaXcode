import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * An axis label has one job: tell two ticks apart.
 *
 * The month view printed the month only, so 1M read "Aug Aug Aug Sep". Four
 * labels, one of them useful, and nothing to say which part of August anything
 * happened in. These pin the rule rather than the wording, so a later change to
 * the format fails only if it reintroduces the ambiguity.
 *
 * A copy of the shipped function, because rate-history.tsx is a React component
 * that cannot be imported into a node test.
 */
const fmtAxis = (iso: string, span: number, intraday: boolean, hours = 0) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (intraday) {
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return hours > 12
      ? `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time}`
      : time;
  }
  if (span > 1200) return String(d.getFullYear());
  if (span > 300) return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  if (span > 95) return d.toLocaleDateString("en-US", { month: "short" });
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
};

/** Four evenly spaced ticks across a window, the way the chart lays them out. */
const ticks = (days: number, n = 4) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(2026, 8, 3) - (days - (days / (n - 1)) * i) * 86400000).toISOString());

const RANGES: Array<[string, number]> = [
  ["1M", 30], ["3M", 90], ["6M", 182], ["YTD", 246], ["1Y", 365], ["5Y", 1825], ["MAX", 9200],
];

test("no range prints the same label twice", () => {
  for (const [label, days] of RANGES) {
    const row = ticks(days).map((t) => fmtAxis(t, days, false));
    assert.equal(new Set(row).size, row.length, `${label} repeats: ${row.join(" ")}`);
  }
});

test("a month view carries the day, which is the only thing separating its ticks", () => {
  const row = ticks(30).map((t) => fmtAxis(t, 30, false));
  row.forEach((l) => assert.match(l, /\d/, `"${l}" has no day number`));
});

test("a year or more drops the day, because the month is enough and shorter", () => {
  assert.equal(fmtAxis("2026-03-15T00:00:00Z", 182, false), "Mar");
  assert.match(fmtAxis("2026-03-15T00:00:00Z", 365, false), /Mar 26/);
});

test("beyond a few years only the year is left", () => {
  assert.equal(fmtAxis("2021-06-01T00:00:00Z", 1825, false), "2021");
});

/* ── hour ranges ─────────────────────────────────────────────────────────── */

test("short intraday windows show a bare clock time", () => {
  const l = fmtAxis("2026-09-03T14:30:00Z", 0, true, 6);
  assert.match(l, /\d{1,2}:\d{2}/);
  assert.ok(!/Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(l), "a six hour window never crosses a night");
});

/**
 * A 24H window does cross midnight, and there "2:00 AM" alone does not say
 * which night, so two ticks a day apart would read identically.
 */
test("a 24 hour window names the day, since it spans two of them", () => {
  const l = fmtAxis("2026-09-03T02:00:00Z", 0, true, 24);
  assert.match(l, /Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
});

test("a 24 hour window tells apart the same clock time on either side of midnight", () => {
  const a = fmtAxis("2026-09-02T14:00:00Z", 0, true, 24);
  const b = fmtAxis("2026-09-03T14:00:00Z", 0, true, 24);
  assert.notEqual(a, b, "same time on consecutive days must not read identically");
});
