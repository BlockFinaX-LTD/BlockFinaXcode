import { test } from "node:test";
import assert from "node:assert/strict";
import { dropSpikes } from "../fx-series";

const at = (d: string, close: number) => ({ date: d, close });

/**
 * The exact rows that shipped a wrong number. 14.50 sits between 12.45 and
 * 12.50, and alone produced a "worst 60 day move" of 30.9% for USD/GHS.
 */
test("the real USD/GHS bad tick is removed", () => {
  const { clean, dropped } = dropSpikes([
    at("2025-09-29", 12.33), at("2025-09-30", 12.45),
    at("2025-10-01", 14.50),
    at("2025-10-02", 12.50), at("2025-10-03", 12.55),
  ]);
  assert.equal(dropped.length, 1, `dropped ${JSON.stringify(dropped)}`);
  assert.equal(dropped[0].date, "2025-10-01");
  assert.equal(clean.length, 4);
});

/**
 * The rule that keeps this honest. A real devaluation persists, so the day
 * after does NOT come back, and the point must survive. Deleting genuine
 * crisis moves would understate risk on a product that sells protection from
 * exactly those moves.
 */
test("a genuine step that persists is kept", () => {
  const { clean, dropped } = dropSpikes([
    at("d1", 12.45), at("d2", 14.50), at("d3", 14.60), at("d4", 14.55),
  ]);
  assert.equal(dropped.length, 0, `wrongly dropped ${JSON.stringify(dropped)}`);
  assert.equal(clean.length, 4);
});

/** A sustained climb is the ordinary case and must pass untouched. */
test("a steady trend is untouched", () => {
  const rows = Array.from({ length: 40 }, (_, i) => at(`d${i}`, 11 + i * 0.05));
  assert.equal(dropSpikes(rows).dropped.length, 0);
});

/** Ordinary daily noise sits well under the threshold. */
test("normal volatility is not treated as error", () => {
  const rows = [11.0, 11.05, 10.98, 11.02, 11.07, 10.99, 11.03].map((c, i) => at(`d${i}`, c));
  assert.equal(dropSpikes(rows).dropped.length, 0);
});

/** A spike down reverts the same way a spike up does. */
test("downward spikes are caught too", () => {
  const { dropped } = dropSpikes([at("a", 12.4), at("b", 10.1), at("c", 12.45)]);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].date, "b");
});

/**
 * Endpoints are never judged: a spike on the first or last day cannot be told
 * apart from the series simply beginning or ending there.
 */
test("first and last points are never dropped", () => {
  const { dropped } = dropSpikes([at("a", 99), at("b", 12.4), at("c", 12.45), at("d", 99)]);
  assert.deepEqual(dropped.map((d) => d.date), []);
});

/** Degenerate input must not throw or invent points. */
test("short series are safe", () => {
  assert.equal(dropSpikes([]).clean.length, 0);
  assert.equal(dropSpikes([at("a", 11)]).clean.length, 1);
  assert.equal(dropSpikes([at("a", 11), at("b", 12)]).clean.length, 2);
});

/**
 * A zero close is a feed error of the most obvious kind, and it reverts like
 * any other, so it goes. Asserted explicitly because the first version of this
 * test expected it to be kept, which would have left a divide-by-zero waiting
 * in every percentage computed downstream.
 */
test("a zero close is dropped, not carried through", () => {
  const { clean, dropped } = dropSpikes([at("a", 11), at("b", 0), at("c", 11)]);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].date, "b");
  assert.deepEqual(clean.map((c) => c.close), [11, 11]);
});
