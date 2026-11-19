/**
 * Position maths shared by the perps engine (margin mirror) and the realized PnL replay.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFill } from "../perps";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test("opening and adding average the entry and realise nothing", () => {
  const a = applyFill({ size: 0, entry: 0 }, 10, 100);
  assert.deepEqual(a, { size: 10, entry: 100, realized: 0, flipped: false, opened: 10 });
  const b = applyFill(a, 10, 110);
  close(b.entry, 105);
  assert.equal(b.size, 20);
  assert.equal(b.realized, 0);
  assert.equal(b.opened, 10);
});

test("a partial close realises profit on the closed part and keeps the entry", () => {
  const r = applyFill({ size: 10, entry: 100 }, -4, 110);
  assert.equal(r.size, 6);
  assert.equal(r.entry, 100);
  close(r.realized, 40);
  assert.equal(r.flipped, false);
  assert.equal(r.opened, 0);
});

test("a short profits when the price falls", () => {
  const r = applyFill({ size: -5, entry: 200 }, 5, 180);
  assert.equal(r.size, 0);
  assert.equal(r.entry, 0);
  close(r.realized, 100);
});

test("crossing zero closes the old side and opens the rest at the fill price", () => {
  const r = applyFill({ size: 10, entry: 100 }, -15, 90);
  close(r.realized, -100);
  assert.equal(r.size, -5);
  assert.equal(r.entry, 90);
  assert.equal(r.flipped, true);
  assert.equal(r.opened, 5);
});

test("tiny remainders round to a closed position", () => {
  const r = applyFill({ size: 1, entry: 50 }, -1 + 1e-13, 50);
  assert.equal(r.size, 0);
});
