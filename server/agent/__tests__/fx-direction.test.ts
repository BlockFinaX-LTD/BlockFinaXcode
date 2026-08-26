import { test } from "node:test";
import assert from "node:assert/strict";
import { describeMove } from "../fx-direction";

/**
 * This exact case shipped and was reported backwards.
 *
 * USD/GHS closed at 11.60 thirty days before 25 Aug 2026 and at 11.08 on the
 * day, a fall of 4.5%. Fewer cedis per dollar means the cedi got STRONGER, and
 * a Ghanaian importer was told it was weakening. The bare percentage was the
 * cause: a minus sign on a currency pair does not mean what it looks like.
 */
test("a falling pair means the local currency strengthened", () => {
  const s = describeMove("USD/GHS", -4.5);
  assert.match(s, /GHS stronger/, s);
  assert.doesNotMatch(s, /weaker/, s);
  assert.match(s, /cost less/, s);
});

test("a rising pair means the local currency weakened", () => {
  const s = describeMove("USD/GHS", 4.5);
  assert.match(s, /GHS weaker/, s);
  assert.doesNotMatch(s, /stronger/, s);
  assert.match(s, /cost more/, s);
});

/** The wording must never carry the sign, or the reader sees "-4.5%" twice. */
test("the percentage is stated without its sign", () => {
  assert.doesNotMatch(describeMove("USD/NGN", -12.34), /-/);
  assert.match(describeMove("USD/NGN", -12.3), /12\.3%/);
});

/** Noise around zero should not be narrated as a direction at all. */
test("a flat market is called flat", () => {
  for (const p of [0, 0.01, -0.04]) {
    assert.match(describeMove("USD/KES", p), /flat/, `${p}`);
  }
  assert.doesNotMatch(describeMove("USD/KES", 0), /stronger|weaker/);
});

/** Whatever arrives, it must not produce a confident wrong direction. */
test("bad input does not become a direction", () => {
  assert.match(describeMove("USD/GHS", NaN), /flat/);
  assert.match(describeMove("GHS", 5), /weaker/); // no slash: still names something
});

/** Every pair names its own local currency, not a hardcoded one. */
test("the local currency comes from the pair", () => {
  assert.match(describeMove("EUR/GHS", 3), /GHS/);
  assert.match(describeMove("USD/NGN", 3), /NGN/);
  assert.match(describeMove("USD/KES", -3), /KES/);
});
