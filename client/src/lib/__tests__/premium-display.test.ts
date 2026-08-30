import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtRate } from "../format-rate";
import { chargedRateFor } from "../purchase-quote";

/**
 * The two roundings that hid dynamic pricing from the people using it.
 *
 * Position 16 on Base was charged 0.4997% against a pool listing 0.5010%: the
 * first purchase in this protocol's history not paying the creation-time rate.
 * Both rendered as "0.5%", so the one thing the feature does was invisible.
 */
test("two rates that differ never render as the same string", () => {
  const stored = 0.005010;
  const charged = 0.004997;
  assert.notEqual(fmtRate(stored), fmtRate(charged));
  assert.equal(fmtRate(stored), "0.501%");
  assert.equal(fmtRate(charged), "0.4997%");
});

/**
 * My first fix used three decimals below 1% and reintroduced the same bug:
 * 0.4997% rounded to 0.500%, then the trailing-zero trim made it "0.5%".
 */
test("three decimals would not have been enough", () => {
  const collapsedAtThreeDp = (0.004997 * 100).toFixed(3).replace(/\.?0+$/, "") + "%";
  assert.equal(collapsedAtThreeDp, "0.5%", "confirms the trap this guards against");
  assert.notEqual(fmtRate(0.004997), collapsedAtThreeDp);
});

test("a rate above 1% is not padded with meaningless digits", () => {
  assert.equal(fmtRate(0.025), "2.5%");
  assert.equal(fmtRate(0.02), "2%");
  assert.equal(fmtRate(0.0725), "7.25%");
});

test("degenerate rates do not render as a number", () => {
  assert.equal(fmtRate(NaN), "—");
  assert.equal(fmtRate(Infinity), "—");
  assert.equal(fmtRate(0), "0%");
});

/**
 * The charge basis. A fixed pool is billed its stored rate whatever the engine
 * thinks; a dynamic pool is billed the quote, because buyProtectionQuoted
 * ignores the stored rate entirely.
 */
test("a fixed pool is charged its stored rate even when a quote disagrees", () => {
  const quote = { premiumRate: 0.007 };
  assert.equal(chargedRateFor(false, 0.02, quote), 0.02);
});

test("a dynamic pool is charged the quote, not the rate it opened at", () => {
  const quote = { premiumRate: 0.0115 };
  assert.equal(chargedRateFor(true, 0.02, quote), 0.0115);
});

/**
 * Without a quote there is nothing to charge but the stored rate, and the sheet
 * must still show a number. Showing zero would make cover look free.
 */
test("a dynamic pool with no quote yet falls back to the stored rate", () => {
  assert.equal(chargedRateFor(true, 0.02, null), 0.02);
  assert.equal(chargedRateFor(true, 0.02, undefined), 0.02);
});

test("a broken quote never prices cover at zero", () => {
  assert.equal(chargedRateFor(true, 0.02, { premiumRate: 0 }), 0.02);
  assert.equal(chargedRateFor(true, 0.02, { premiumRate: NaN }), 0.02);
  assert.equal(chargedRateFor(true, 0.02, { premiumRate: -0.01 }), 0.02);
});

/**
 * The explainer fetches its own quote at a nominal notional when opened from a
 * market detail, where no amount has been typed. That is only sound because the
 * premium rate does not depend on size.
 *
 * pricePurchase derives the rate as perUnit/S times a utilisation multiplier
 * read off pool totals; notional enters only when the rate becomes dollars.
 * This pins the property, because if it ever stopped holding the panel would
 * quietly show a rate nobody is charged.
 */
test("the premium rate does not depend on the notional", async () => {
  const { pricePurchase } = await import("../../../../server/pricing/purchase-math");
  const base = {
    S: 12.3, S0: 12.0, strike: 12.6, payoutCap: 13.2, strikeAbove: true,
    T: 20 / 365.25, daysRemaining: 20, sigmaStar: 0.5684,
    sigmaStarSource: "stored" as const,
    jump: { lambda: 2, jumpMean: 0.08, jumpStd: 0.12 },
    totalLiquidity: 50000, totalMaxPayout: 20000, minPremiumRate: 0, storedRate: 0.015,
  };
  const rates = [100, 1000, 25000, 1_000_000].map((notional) => {
    const q = pricePurchase({ ...base, notional });
    assert.ok(q.ok, "every size should quote");
    return q.ok ? q.premiumRate : NaN;
  });
  rates.forEach((r) => assert.equal(r, rates[0], "rate must not move with size"));

  // The dollar amounts, by contrast, must scale exactly.
  const small = pricePurchase({ ...base, notional: 1000 });
  const large = pricePurchase({ ...base, notional: 10000 });
  assert.ok(small.ok && large.ok);
  if (small.ok && large.ok) {
    assert.ok(Math.abs(large.premiumUsd - small.premiumUsd * 10) < 1e-9);
  }
});
