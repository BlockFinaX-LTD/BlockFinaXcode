import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayoutModel } from "../payout-model";

/**
 * The live position from a real screenshot: $65,000 notional on USD/GHS.
 *
 * The first version of this test read the strike off the chart's axis labels
 * and got 11.28, which is the plot range rather than the strike. The figures
 * below are recovered from the table's own rows, which step by a quarter of
 * the strike-to-cap width, and they reproduce every published payout to the
 * cent.
 */
const live = () => buildPayoutModel({
  notional: 65000,
  initialRate: 11.1975,
  maxPayout: 1451.22,
  strike: 11.25,
  strikeAbove: true,
  totalCost: 261.40,
  payoutFeeRate: 0.01,
});

test("the cap is recovered from the reserved maximum payout", () => {
  assert.ok(Math.abs(live().cap - 11.50) < 0.001, `cap was ${live().cap}`);
});

/** Every payout the old card published, reproduced exactly. */
test("it reproduces the published figures to the cent", () => {
  const m = live();
  for (const [rate, want] of [[11.3125, 362.80], [11.375, 725.61], [11.4375, 1088.41], [11.5, 1451.22]] as const) {
    assert.ok(Math.abs(m.payoutAt(rate) - want) < 0.01, `${rate} gave ${m.payoutAt(rate)}, wanted ${want}`);
  }
});

test("nothing pays at or below the strike", () => {
  const m = live();
  assert.equal(m.payoutAt(11.25), 0);
  assert.equal(m.payoutAt(11.20), 0);
  assert.equal(m.payoutAt(10.00), 0);
});

test("the payout ramps linearly between strike and cap", () => {
  const m = live();
  const a = m.payoutAt(11.30), b = m.payoutAt(11.40);
  assert.ok(a > 0 && b > a, `${a} then ${b}`);
  // Twice the distance past the strike is twice the payout.
  const one = m.payoutAt(11.3), two = m.payoutAt(11.35);
  assert.ok(Math.abs(two - one * 2) < 0.01, `${one} vs ${two}`);
});

/** The cap is the whole point of a capped spread: past it, nothing more. */
test("the payout stops at the cap and never exceeds the maximum", () => {
  const m = live();
  const atCap = m.payoutAt(m.cap);
  assert.ok(Math.abs(atCap - 1451.22) < 1, `at cap ${atCap}`);
  assert.equal(m.payoutAt(m.cap + 1), atCap);
  assert.equal(m.payoutAt(99), atCap);
});

/** Losing the premium is the worst case, and it must be exactly the premium. */
test("the most that can be lost is what was paid", () => {
  const m = live();
  assert.ok(Math.abs(m.netAt(11.00) + 261.40) < 0.01, `${m.netAt(11.00)}`);
});

test("break-even sits between strike and cap and nets to zero there", () => {
  const m = live();
  assert.ok(m.breakEven !== null);
  assert.ok(m.breakEven! > 11.25 && m.breakEven! < m.cap, `${m.breakEven}`);
  assert.ok(Math.abs(m.netAt(m.breakEven!)) < 0.01, `net ${m.netAt(m.breakEven!)}`);
});

/**
 * A position whose best case does not cover its cost has no break-even, and
 * saying so beats printing a rate that cannot be reached.
 */
test("no break-even when the maximum payout cannot cover the cost", () => {
  const m = buildPayoutModel({
    notional: 1000, initialRate: 11, maxPayout: 50, strike: 11.2,
    strikeAbove: true, totalCost: 200, payoutFeeRate: 0.01,
  });
  assert.equal(m.breakEven, null);
});

/** Cover that pays when the local currency STRENGTHENS mirrors exactly. */
test("a downside cover mirrors the upside one", () => {
  const m = buildPayoutModel({
    notional: 65000, initialRate: 11.1975, maxPayout: 1451.22, strike: 11.00,
    strikeAbove: false, totalCost: 261.40, payoutFeeRate: 0.01,
  });
  assert.ok(m.cap < 11.00, `cap ${m.cap}`);
  assert.equal(m.payoutAt(11.00), 0);
  assert.equal(m.payoutAt(11.50), 0);
  assert.ok(m.payoutAt(10.90) > 0);
  assert.ok(Math.abs(m.payoutAt(m.cap) - 1451.22) < 1);
  assert.equal(m.payoutAt(m.cap - 1), m.payoutAt(m.cap));
});

/** Degenerate input must return zeros, never NaN reaching a money figure. */
test("invalid input is inert, not NaN", () => {
  const m = buildPayoutModel({
    notional: 0, initialRate: 0, maxPayout: 0, strike: 0,
    strikeAbove: true, totalCost: 0,
  });
  assert.equal(m.valid, false);
  assert.equal(m.payoutAt(11), 0);
  assert.ok(Number.isFinite(m.netAt(11)));
});
