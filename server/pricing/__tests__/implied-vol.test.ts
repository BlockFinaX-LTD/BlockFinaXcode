import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  impliedVolFromPremiumRate,
  validateLpPremium,
  MIN_CREATION_LEVERAGE,
  SIGMA_BAND_LOW,
  SIGMA_BAND_HIGH,
} from "../implied-vol";
import { mertonCallSpread } from "../kernel";

// frontierEM tier defaults (jump-params.ts) — the values the engine prices USD/GHS with.
const JUMP = { lambda: 2.0, jumpMean: 0.08, jumpStd: 0.12 };

/** Event 9 on Base, as deployed. LP set 1.0%; max payout is 3.41%. */
const EVENT_9 = {
  S: 11.731549,
  strike: 11.9,
  payoutCap: 12.3,
  T: 7 / 365.25,
  strikeAbove: true,
  ...JUMP,
};

/** Event 10 on Base. Created at 3.0% against a cap worth 2.68% — unbuyable. */
const EVENT_10 = {
  S: 11.188125,
  strike: 11.3,
  payoutCap: 11.6,
  T: 6.2 / 365.25,
  strikeAbove: true,
  ...JUMP,
};

/** Live USD/GHS σ from the engine at the time these were calibrated. */
const MARKET_SIGMA = 0.32;

describe("impliedVolFromPremiumRate", () => {
  it("round-trips a known σ back out of the premium it produces", () => {
    for (const trueSigma of [0.08, 0.15, 0.32, 0.6, 1.2]) {
      const rate =
        mertonCallSpread({
          S: EVENT_9.S,
          K_lower: EVENT_9.strike,
          K_upper: EVENT_9.payoutCap,
          T: EVENT_9.T,
          r: 0,
          q: 0,
          sigma: trueSigma,
          ...JUMP,
        }) / EVENT_9.S;

      const r = impliedVolFromPremiumRate({ ...EVENT_9, targetRate: rate });
      assert.ok(r.ok, `σ=${trueSigma} should invert`);
      if (r.ok) {
        assert.ok(
          Math.abs(r.sigma - trueSigma) < 1e-4,
          `recovered ${r.sigma} from σ=${trueSigma}`,
        );
      }
    }
  });

  it("is deterministic — a signed quote must be reproducible", () => {
    const a = impliedVolFromPremiumRate({ ...EVENT_9, targetRate: 0.01 });
    const b = impliedVolFromPremiumRate({ ...EVENT_9, targetRate: 0.01 });
    assert.ok(a.ok && b.ok);
    if (a.ok && b.ok) assert.equal(a.sigma, b.sigma);
  });

  it("survives the spread's non-monotonicity in σ", () => {
    // Deep in the money the position is already near its maximum, so more
    // volatility only threatens it: value FALLS as σ rises. A bisection that
    // assumes otherwise returns a confident wrong answer here.
    const itm = { ...EVENT_9, S: 12.5 };
    const at = (sigma: number) =>
      mertonCallSpread({
        S: itm.S, K_lower: itm.strike, K_upper: itm.payoutCap,
        T: itm.T, r: 0, q: 0, sigma, ...JUMP,
      }) / itm.S;

    const low = at(0.05);
    const high = at(1.5);
    assert.ok(high < low, "deep ITM: value must fall as σ rises");

    const target = (low + high) / 2;
    const r = impliedVolFromPremiumRate({ ...itm, targetRate: target });
    assert.ok(r.ok, "a target on the falling side must still solve");
    if (r.ok) assert.ok(Math.abs(r.achievedRate - target) < 1e-8, "and reprice to it");
  });

  it("refuses instead of fitting a σ to an impossible premium", () => {
    // Above everything the geometry can be worth at any volatility.
    const tooHigh = impliedVolFromPremiumRate({ ...EVENT_9, targetRate: 0.9 });
    assert.equal(tooHigh.ok, false);
    if (!tooHigh.ok) assert.match(tooHigh.reason, /above anything this strike and cap/);

    // Below the floor of what it is worth even at σ = 1%.
    const tooLow = impliedVolFromPremiumRate({ ...EVENT_9, targetRate: 1e-9 });
    assert.equal(tooLow.ok, false);
  });

  it("rejects malformed geometry rather than returning a number", () => {
    assert.equal(impliedVolFromPremiumRate({ ...EVENT_9, targetRate: 0.01, T: 0 }).ok, false);
    assert.equal(impliedVolFromPremiumRate({ ...EVENT_9, targetRate: 0 }).ok, false);
    // Upward pool with the cap below the strike.
    assert.equal(
      impliedVolFromPremiumRate({ ...EVENT_9, targetRate: 0.01, payoutCap: 11.0 }).ok,
      false,
    );
  });

  it("premium saturates as it approaches the maximum payout", () => {
    // Worth pinning because it is unintuitive and it is what makes the σ band
    // narrow in premium terms: the spread cannot exceed (C−K)/S, so as the
    // premium climbs toward that bound the σ required runs away. On event 9,
    // 1.00% implies ~44% but 1.35% implies ~131% — a third more premium costs
    // three times the volatility.
    const a = impliedVolFromPremiumRate({ ...EVENT_9, targetRate: 0.01 });
    const b = impliedVolFromPremiumRate({ ...EVENT_9, targetRate: 0.0135 });
    assert.ok(a.ok && b.ok);
    if (a.ok && b.ok) {
      assert.ok(b.sigma > a.sigma * 2.5, `σ must run away: ${a.sigma} -> ${b.sigma}`);
    }
  });
});

describe("validateLpPremium", () => {
  it("refuses a pool that charges more than it can ever pay", () => {
    // Event 10, live on Base with two hedgers down $55.76 between them from the
    // moment they bought. This is the check that was missing at creation.
    const v = validateLpPremium({ ...EVENT_10, premiumRate: 0.03, marketSigma: MARKET_SIGMA });
    assert.equal(v.ok, false);
    assert.ok(v.leverage < 1, `leverage ${v.leverage} must be below 1`);
    assert.match(v.reason ?? "", /more than this pool can ever pay/);
    // The message must carry the number that fixes it.
    assert.match(v.reason ?? "", /2\.681/);
  });

  it("accepts the pool that was priced sanely", () => {
    const v = validateLpPremium({ ...EVENT_9, premiumRate: 0.01, marketSigma: MARKET_SIGMA });
    assert.equal(v.ok, true);
    assert.ok(v.sigma && Math.abs(v.sigma - 0.4445) < 0.01, `σ* ≈ 44.45%, got ${v.sigma}`);
    assert.ok(v.leverage > 3, "leverage should be comfortable");
    assert.equal(v.warning, undefined);
  });

  it("refuses a premium that leaves too little upside after fees", () => {
    // Above 1x so a buyer can technically win, but break-even after the 5%
    // entry and 2% payout fees is ~1.07x and this leaves 1.14x.
    const v = validateLpPremium({ ...EVENT_9, premiumRate: 0.03, marketSigma: MARKET_SIGMA });
    assert.equal(v.ok, false);
    assert.ok(v.leverage > 1 && v.leverage < MIN_CREATION_LEVERAGE);
    assert.match(v.reason ?? "", /break even/);
  });

  it("refuses a premium implying volatility far below the market", () => {
    // 0.20% implies ~12% σ against a 32% market — 0.38x, outside the band.
    const v = validateLpPremium({ ...EVENT_9, premiumRate: 0.002, marketSigma: MARKET_SIGMA });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /below what the risk is worth/);
  });

  it("refuses a premium implying volatility far above the market", () => {
    const v = validateLpPremium({ ...EVENT_9, premiumRate: 0.0135, marketSigma: MARKET_SIGMA });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /too dear to attract a buyer/);
  });

  it("allows a wide but deliberate view, with a warning", () => {
    // 0.50% implies ~21% σ — 0.65x market. Inside the refusal band, outside the
    // quiet band, so it should pass while saying something.
    const v = validateLpPremium({ ...EVENT_9, premiumRate: 0.005, marketSigma: MARKET_SIGMA });
    assert.equal(v.ok, true);
    assert.ok(v.sigma);
  });

  it("keeps the arithmetic checks when market σ is unavailable", () => {
    // The band is the only part that needs a market view; a pool that cannot
    // pay is refused with or without one.
    const bad = validateLpPremium({ ...EVENT_10, premiumRate: 0.03 });
    assert.equal(bad.ok, false);
    assert.match(bad.reason ?? "", /more than this pool can ever pay/);

    const good = validateLpPremium({ ...EVENT_9, premiumRate: 0.01 });
    assert.equal(good.ok, true);
  });

  it("band constants are the ones documented to LPs", () => {
    assert.equal(SIGMA_BAND_LOW, 0.4);
    assert.equal(SIGMA_BAND_HIGH, 2.5);
    assert.equal(MIN_CREATION_LEVERAGE, 1.5);
  });
});
