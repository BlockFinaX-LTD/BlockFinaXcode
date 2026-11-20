/**
 * Market rate method: mids, staleness, activity weights, outliers, weighted median, quorum.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { advertsMid, aggregate, capWeights, midOf, type SourceQuote } from "../aggregate";

const now = 1_000_000_000;
const q = (o: Partial<SourceQuote>): SourceQuote => ({ source: "x", kind: "exchange", pair: "USD/NGN", bid: null, ask: null, mid: 0, volumeUsd: 100_000, ads: null, at: now, ...o });

test("mid of a book, and badly crossed books are refused", () => {
  assert.equal(midOf(1435.08, 1435.09), 1435.085);
  assert.equal(midOf(1500, 1300), null);
  assert.equal(midOf(null, 1300), null);
});

test("P2P mid ignores the far end of the adverts", () => {
  assert.equal(advertsMid([1429, 1430, 1430, 1431, 1500, 1700, 1800]), 1430);
});

test("a market with no trades and a stale quote carry no weight", () => {
  const r = aggregate("USD/NGN", [
    q({ source: "luno", mid: 1435, volumeUsd: 378_000 }),
    q({ source: "quidax", mid: 1441, volumeUsd: 23_000 }),
    q({ source: "dead", mid: 1300, volumeUsd: 0 }),
    q({ source: "old", mid: 1200, at: now - 10 * 60_000 }),
  ], now)!;
  assert.ok(r);
  assert.equal(r.sources, 2);
  assert.equal(r.quotes.find((x) => x.source === "dead")!.reason, "no_activity");
  assert.equal(r.quotes.find((x) => x.source === "old")!.reason, "stale");
  assert.ok(r.rate >= 1435 && r.rate <= 1441);
});

test("an outlier is dropped and cannot move the rate", () => {
  const r = aggregate("USD/NGN", [
    q({ source: "a", mid: 1435 }), q({ source: "b", mid: 1438 }), q({ source: "c", mid: 1440 }),
    q({ source: "bad", mid: 1600, volumeUsd: 10_000_000 }),
  ], now)!;
  assert.equal(r.quotes.find((x) => x.source === "bad")!.reason, "outlier");
  assert.equal(r.rate, 1438);
});

test("one source is enough", () => {
  assert.equal(aggregate("USD/NGN", [q({ source: "only", mid: 1435 })], now)?.rate, 1435);
});

test("no fresh source gives no live rate (the last good one is held instead)", () => {
  assert.equal(aggregate("USD/NGN", [q({ source: "old", mid: 1435, at: now - 60 * 60_000 })], now), null);
});

test("no source carries more than the cap", () => {
  const ws = capWeights([1000, 10, 10, 10], 0.5);
  const total = ws.reduce((t, w) => t + w, 0);
  assert.ok(ws[0] / total <= 0.5 + 1e-6);
});
