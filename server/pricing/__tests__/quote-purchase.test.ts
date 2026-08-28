import { test } from "node:test";
import assert from "node:assert/strict";
import { pricePurchase, UTILISATION_K } from "../purchase-math";
import { impliedVolFromPremiumRate } from "../implied-vol";

/**
 * Event 9's real terms: USD/GHS struck at 11.90 with a 12.30 cap, opened at a
 * spot of 11.731549 for seven days at a 1% premium.
 *
 * The properties asserted here are the ones that made dynamic pricing worth
 * building. A pool's premium is fixed at creation today, so a buyer with three
 * days left pays for seven; and the naive fix, pro-rating by time, is wrong in
 * the case that matters most, which is the one where spot has moved through the
 * strike and the cover became MORE likely to pay, not less.
 */
const JUMP = { lambda: 2.0, jumpMean: 0.08, jumpStd: 0.12 };

const base = (over: Partial<Parameters<typeof pricePurchase>[0]> = {}) =>
  pricePurchase({
    notional: 10_000,
    S: 11.731549,
    S0: 11.731549,
    strike: 11.90,
    payoutCap: 12.30,
    strikeAbove: true,
    T: 7 / 365.25,
    daysRemaining: 7,
    sigmaStar: 0.4445,
    sigmaStarSource: "stored",
    jump: JUMP,
    totalLiquidity: 10_000,
    totalMaxPayout: 0,
    minPremiumRate: 0,
    storedRate: 0.01,
    ...over,
  });

const rate = (q: ReturnType<typeof pricePurchase>) => {
  assert.ok(q.ok, q.ok ? "" : q.reason);
  return q.ok ? q.premiumRate : 0;
};

/* ── time ────────────────────────────────────────────────────────────────── */

test("out of the money, the premium falls as the tenor shortens", () => {
  const d7 = rate(base({ T: 7 / 365.25, daysRemaining: 7 }));
  const d3 = rate(base({ T: 3 / 365.25, daysRemaining: 3 }));
  const d1 = rate(base({ T: 1 / 365.25, daysRemaining: 1 }));
  assert.ok(d7 > d3 && d3 > d1, `${d7} ${d3} ${d1}`);
});

/**
 * The reason a time-based discount was never the right shape.
 *
 * Deep in the money, near the cap, more time means more chance of falling back
 * OUT of the money, so the cover is worth more with three days left than with
 * seven. A pro-rate would have charged roughly half for the more valuable
 * contract.
 *
 * The crossover is asserted rather than a single point, because it is the
 * crossover that makes the rule wrong. Just past the strike more time still
 * helps and the ordinary intuition holds; the inversion only appears as spot
 * approaches the cap. The first version of this test picked 12.05, a third of
 * the way through the band, and failed: the code was right and the spot was
 * badly chosen.
 */
test("time cuts both ways, depending on how deep in the money spot is", () => {
  const price = (S: number, days: number) =>
    rate(base({ S, T: days / 365.25, daysRemaining: days }));

  // Just past the strike (11.90): the ordinary direction, more time is dearer.
  assert.ok(price(12.05, 7) > price(12.05, 3), "near the strike, 7d should exceed 3d");

  // Approaching the cap (12.30): inverted, because the remaining risk is that
  // it falls back out rather than that it climbs further.
  assert.ok(price(12.20, 3) > price(12.20, 7), "near the cap, 3d should exceed 7d");
});

/* ── moneyness ───────────────────────────────────────────────────────────── */

test("the premium rises as spot approaches and passes the strike", () => {
  const rates = [11.50, 11.73, 11.90, 12.10].map((S) => rate(base({ S })));
  for (let i = 1; i < rates.length; i++) {
    assert.ok(rates[i] > rates[i - 1], `not monotonic at ${i}: ${rates.join(" ")}`);
  }
});

/* ── utilisation skew ────────────────────────────────────────────────────── */

test("the skew is monotonic in utilisation and reaches +50% when full", () => {
  const at = (used: number) => {
    const q = base({ totalLiquidity: 10_000, totalMaxPayout: 10_000 * used });
    assert.ok(q.ok);
    return q.ok ? q.breakdown.utilisationMultiplier : 0;
  };
  assert.equal(at(0), 1);
  assert.ok(Math.abs(at(0.5) - 1.125) < 1e-9, `${at(0.5)}`);
  assert.ok(Math.abs(at(1) - (1 + UTILISATION_K)) < 1e-9, `${at(1)}`);
  assert.ok(at(0) < at(0.5) && at(0.5) < at(0.9) && at(0.9) < at(1));
});

/** Quadratic, so the first buyers into an empty pool are barely charged for it. */
test("early buyers are barely touched by the skew", () => {
  const q = base({ totalLiquidity: 10_000, totalMaxPayout: 1_000 });
  assert.ok(q.ok);
  assert.ok(q.ok && q.breakdown.utilisationMultiplier < 1.01, `${q.ok && q.breakdown.utilisationMultiplier}`);
});

/** A pool that reads back no liquidity must not divide into infinity. */
test("an empty pool does not divide by zero", () => {
  const q = base({ totalLiquidity: 0, totalMaxPayout: 0 });
  assert.ok(q.ok);
  assert.equal(q.ok && q.breakdown.utilisation, 0);
});

/* ── the floor ───────────────────────────────────────────────────────────── */

test("the minimum premium binds, and is reported when it does", () => {
  const without = base({ S: 11.40, minPremiumRate: 0 });
  assert.ok(without.ok);
  const floor = (without.ok ? without.premiumRate : 0) * 2;
  const with_ = base({ S: 11.40, minPremiumRate: floor });
  assert.ok(with_.ok);
  assert.ok(with_.ok && Math.abs(with_.premiumRate - floor) < 1e-12);
  assert.equal(with_.ok && with_.breakdown.floorApplied, true);
  assert.equal(without.ok && without.breakdown.floorApplied, false);
});

/* ── leverage bounds ─────────────────────────────────────────────────────── */

/**
 * Spot far through the cap: the premium approaches the maximum payout, so after
 * fees the buyer cannot profit even in the best case. Refusing is the point.
 */
test("a quote a buyer could not profit from is refused", () => {
  const q = base({ S: 13.50 });
  assert.equal(q.ok, false);
  assert.match(q.ok ? "" : q.reason, /cannot profit|no longer worth/);
});

/** Deep out of the money with almost no time: the premium rounds to nothing. */
test("a premium that rounds to zero is refused, not sold", () => {
  const q = base({ S: 9.50, T: 0.5 / 365.25, daysRemaining: 0.5 });
  assert.equal(q.ok, false);
  assert.match(q.ok ? "" : q.reason, /rounds to zero|leverage/);
});

/* ── the anchor ──────────────────────────────────────────────────────────── */

/**
 * The whole design in one assertion.
 *
 * Invert the LP's opening premium for the volatility that reproduces it, then
 * price the same terms at t=0 with that volatility. The answer must be the
 * premium the LP set. If this drifts, the pool's opening price is not being
 * honoured and the model has quietly replaced the underwriter's judgement.
 */
test("sigma-star round-trips to the underwriter's opening premium", () => {
  const opening = 0.01;
  const inv = impliedVolFromPremiumRate({
    targetRate: opening,
    S: 11.731549,
    strike: 11.90,
    payoutCap: 12.30,
    T: 7 / 365.25,
    strikeAbove: true,
    ...JUMP,
  });
  assert.ok(inv.ok, inv.ok ? "" : inv.reason);
  if (!inv.ok) return;

  const q = base({ sigmaStar: inv.sigma, totalLiquidity: 10_000, totalMaxPayout: 0 });
  assert.ok(q.ok);
  // Within a basis point of what the LP asked for.
  assert.ok(Math.abs((q.ok ? q.premiumRate : 0) - opening) < 1e-4,
    `got ${q.ok ? q.premiumRate : 0}, wanted ${opening}`);
});

/** Both sides of the book price, so a downside pool is not silently broken. */
test("downside cover prices as the mirror of upside", () => {
  const q = pricePurchase({
    notional: 10_000,
    S: 11.20, S0: 11.20,
    strike: 11.00, payoutCap: 10.60,
    strikeAbove: false,
    T: 7 / 365.25, daysRemaining: 7,
    sigmaStar: 0.4445, sigmaStarSource: "stored", jump: JUMP,
    totalLiquidity: 10_000, totalMaxPayout: 0,
    minPremiumRate: 0, storedRate: 0.01,
  });
  assert.ok(q.ok, q.ok ? "" : q.reason);
  assert.ok(q.ok && q.premiumRate > 0);
});

/** The flat rate must come back untouched, since the UI shows both. */
test("the pool's stored rate is passed through for comparison", () => {
  const q = base({ storedRate: 0.02, notional: 10_000 });
  assert.ok(q.ok);
  assert.equal(q.ok && q.storedRate, 0.02);
  assert.equal(q.ok && q.storedPremiumUsd, 200);
});
