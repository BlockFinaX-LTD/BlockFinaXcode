import { test } from "node:test";
import assert from "node:assert/strict";
import { durationsOffered, expiryAt, markupForDays, type DurationRule } from "../durations";

const DAY = 86_400;
// Monday 11 January 2027, 14:00 UTC (the contract tests use the same moment).
const MONDAY_1400 = 1_799_676_000;
const tenors = [
  { tenorDays: 7, active: true, markupBps: 12_000 },
  { tenorDays: 30, active: true, markupBps: 11_000 },
  { tenorDays: 14, active: false, markupBps: 50_000 },
];
const any: DurationRule = { mode: "any", minDays: 1, maxDays: 90 };

test("cover ends at 14:00 UTC on its date; weekends move to Monday", () => {
  assert.equal(expiryAt(MONDAY_1400, 3), MONDAY_1400 + 3 * DAY);
  assert.equal(expiryAt(MONDAY_1400, 5), MONDAY_1400 + 7 * DAY);
  assert.equal(expiryAt(MONDAY_1400, 6), MONDAY_1400 + 7 * DAY);
  assert.equal(expiryAt(MONDAY_1400 - 5 * 3600, 1), MONDAY_1400 + DAY);
  assert.equal(expiryAt(MONDAY_1400 + 8 * 3600, 1), MONDAY_1400 + DAY);
});

test("specific pools sell only their active listed durations", () => {
  assert.equal(markupForDays({ tenors }, 7), 12_000);
  assert.equal(markupForDays({ tenors }, 9), null);
  assert.equal(markupForDays({ tenors }, 14), null, "inactive");
});

test("open pools interpolate between price points and clamp outside them", () => {
  const pool = { tenors, durations: any };
  assert.equal(markupForDays(pool, 1), 12_000);
  assert.equal(markupForDays(pool, 7), 12_000);
  // 9 days: 12,000 + (11,000 - 12,000) * 2 / 23, truncated toward zero.
  assert.equal(markupForDays(pool, 9), 12_000 + Math.trunc((-1_000 * 2) / 23));
  assert.equal(markupForDays(pool, 90), 11_000);
  assert.equal(markupForDays(pool, 91), null);
  assert.equal(markupForDays({ tenors, durations: { mode: "up-to", minDays: 2, maxDays: 20 } }, 1), null);
  assert.equal(markupForDays({ tenors, durations: { mode: "up-to", minDays: 2, maxDays: 20 } }, 21), null);
});

test("offered durations: a range for open pools, a list for specific ones", () => {
  assert.deepEqual(durationsOffered({ tenors }), { range: null, days: [7, 30] });
  assert.deepEqual(durationsOffered({ tenors, durations: any }), { range: { minDays: 1, maxDays: 90 }, days: [7, 30] });
});
