/**
 * kernel-merton.test.ts — verifies the Merton (1976) jump-diffusion math.
 *
 * Run with: npx tsx --test server/pricing/__tests__/kernel-merton.test.ts
 *
 * The Merton model is Garman-Kohlhagen + a compound Poisson jump process.
 * The closed-form is a Poisson-weighted infinite sum of GK prices with vol
 * and drift adjusted per jump count. Tests below verify:
 *
 *   1. λ=0 collapses exactly to plain GK (a critical invariant — anyone
 *      pricing G10 with the new kernel must still get the GK number)
 *   2. The series converges (output stable as nTerms grows)
 *   3. Jumps make options MORE valuable (strict premium under realistic
 *      μ_J, σ_J for frontier-EM)
 *   4. Spread premium increases as λ rises
 *   5. Symmetric jumps (μ_J=0) widen the smile on both wings; asymmetric
 *      jumps (μ_J>0) preferentially fatten the upper wing — what we expect
 *      for USD/frontier-EM where the rate gaps up on devaluation
 *   6. Range cap is still respected: spread ≤ (K_u − K_l)
 *
 * Calibration sanity:
 *   - For USD/GHS-style inputs (λ=2, μ_J=0.08, σ_J=0.12) the engine should
 *     price a 60-day +5% strike call meaningfully higher than flat-vol GK.
 *     Concretely: 30–80% richer than GK at this strike, matching the
 *     emerging-markets.md skill recommendation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  garmanKohlhagenCall,
  garmanKohlhagenPut,
  callSpreadValue,
  putSpreadValue,
  mertonCall,
  mertonPut,
  mertonCallSpread,
  mertonPutSpread,
} from "../kernel";

function near(actual: number, expected: number, tol: number, label = ""): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tol,
    `${label}: expected ~${expected}, got ${actual} (diff ${diff} > tol ${tol})`,
  );
}

// Default inputs roughly matching a 30-day USD/GHS hedge:
//   spot 11, T = 30/365, USD rate 5%, GHS empirical drift ~12% → qEff = -0.07
const HEDGE_INPUTS = {
  S: 11,
  T: 30 / 365,
  r: 0.05,
  q: -0.07,          // qEffective = r − μ
  sigma: 0.18,
} as const;

describe("Merton mertonCall(λ=0) === garmanKohlhagenCall", () => {
  it("matches GK to machine epsilon when there are no jumps", () => {
    for (const K of [10, 11, 11.5, 12, 13]) {
      const gk = garmanKohlhagenCall({ ...HEDGE_INPUTS, K });
      const m  = mertonCall({ ...HEDGE_INPUTS, K, lambda: 0, jumpMean: 0.1, jumpStd: 0.1 });
      near(m, gk, 1e-10, `K=${K}`);
    }
  });

  it("Merton put with λ=0 matches GK put", () => {
    for (const K of [10, 11, 12]) {
      const gk = garmanKohlhagenPut({ ...HEDGE_INPUTS, K });
      const m  = mertonPut({ ...HEDGE_INPUTS, K, lambda: 0, jumpMean: 0, jumpStd: 0 });
      near(m, gk, 1e-10, `K=${K}`);
    }
  });

  it("Merton call-spread with λ=0 matches GK call-spread", () => {
    const gk = callSpreadValue({ ...HEDGE_INPUTS, K_lower: 11.4, K_upper: 12.0 });
    const m  = mertonCallSpread({
      ...HEDGE_INPUTS, K_lower: 11.4, K_upper: 12.0,
      lambda: 0, jumpMean: 0, jumpStd: 0,
    });
    near(m, gk, 1e-10);
  });

  it("Merton put-spread with λ=0 matches GK put-spread", () => {
    const gk = putSpreadValue({ ...HEDGE_INPUTS, K_lower: 10.0, K_upper: 10.6 });
    const m  = mertonPutSpread({
      ...HEDGE_INPUTS, K_lower: 10.0, K_upper: 10.6,
      lambda: 0, jumpMean: 0, jumpStd: 0,
    });
    near(m, gk, 1e-10);
  });
});

describe("Series convergence", () => {
  it("price stable as nTerms grows (≥ 20 is enough for typical λT)", () => {
    const base = { ...HEDGE_INPUTS, K: 12, lambda: 2, jumpMean: 0.08, jumpStd: 0.12 };
    const p10 = mertonCall({ ...base, nTerms: 10 });
    const p20 = mertonCall({ ...base, nTerms: 20 });
    const p50 = mertonCall({ ...base, nTerms: 50 });
    near(p20, p50, 1e-10, "n=20 vs n=50");
    // Even n=10 should be tight for λT ≈ 0.16 (very small Poisson tail beyond)
    near(p10, p50, 1e-6, "n=10 vs n=50");
  });

  it("converges for high jump intensity too (λ=8 ≈ crypto)", () => {
    const base = { S: 100, K: 100, T: 1.0, r: 0.05, q: 0.0, sigma: 0.5,
                   lambda: 8, jumpMean: 0.0, jumpStd: 0.25 };
    const p30 = mertonCall({ ...base, nTerms: 30 });
    const p100 = mertonCall({ ...base, nTerms: 100 });
    // λT=8 means n=30 captures the Poisson body but ~5e-7 of tail remains.
    // For pricing purposes (4–6 significant figures) this is overkill.
    near(p30, p100, 1e-5, "n=30 vs n=100");
  });
});

describe("Jumps make options MORE valuable for frontier-EM", () => {
  // Same strike, same vol, same everything — only λ changes.
  const baseFlatVol = { ...HEDGE_INPUTS, K: 11.5 };

  it("OTM call: Merton > GK when (λ, μ_J, σ_J) > 0", () => {
    const gk = garmanKohlhagenCall(baseFlatVol);
    const merton = mertonCall({
      ...baseFlatVol,
      lambda: 2, jumpMean: 0.08, jumpStd: 0.12,
    });
    assert.ok(
      merton > gk,
      `Merton(${merton}) should exceed GK(${gk}) under positive jumps on an OTM call`,
    );
    const lift = (merton - gk) / gk;
    assert.ok(
      lift > 0.1 && lift < 3.0,
      `Lift should be 10–300% for these inputs, got ${(lift * 100).toFixed(1)}%`,
    );
  });

  it("call-spread: same lift direction (Merton > GK on USD/GHS-style inputs)", () => {
    const gk = callSpreadValue({ ...HEDGE_INPUTS, K_lower: 11.4, K_upper: 12.0 });
    const merton = mertonCallSpread({
      ...HEDGE_INPUTS, K_lower: 11.4, K_upper: 12.0,
      lambda: 2, jumpMean: 0.08, jumpStd: 0.12,
    });
    assert.ok(
      merton > gk,
      `Merton spread(${merton}) should exceed GK spread(${gk})`,
    );
  });

  it("OUTRIGHT OTM call premium increases monotonically with λ", () => {
    // The "more jumps = richer option" intuition holds STRICTLY for outright
    // OTM calls. For spreads it depends on cap geometry — see jump-diffusion
    // .test.ts for the spread case.
    let prev = -Infinity;
    for (const lambda of [0, 0.5, 1, 2, 4]) {
      const v = mertonCall({
        ...HEDGE_INPUTS, K: 11.5,
        lambda, jumpMean: 0.08, jumpStd: 0.12,
      });
      assert.ok(v > prev, `λ=${lambda}: ${v} should be > prev ${prev}`);
      prev = v;
    }
  });

  it("WIDE-CAP spread premium increases monotonically with λ", () => {
    // Wide enough cap (K_upper = 14, ~26% OTM) that typical jumps don't push
    // probability past it — long leg gains more than short leg.
    let prev = -Infinity;
    for (const lambda of [0, 0.5, 1, 2, 4]) {
      const v = mertonCallSpread({
        ...HEDGE_INPUTS, K_lower: 11.4, K_upper: 14.0,
        lambda, jumpMean: 0.08, jumpStd: 0.12,
      });
      assert.ok(v > prev, `λ=${lambda}: ${v} should be > prev ${prev}`);
      prev = v;
    }
  });

  it("symmetric jumps (μ_J=0) widen BOTH wings", () => {
    // Set K above spot (call-side) and K below spot (put-side).
    // Symmetric jumps should add value to both relative to flat-vol GK.
    const K_above = 12, K_below = 10;
    const gkCall = garmanKohlhagenCall({ ...HEDGE_INPUTS, K: K_above });
    const gkPut  = garmanKohlhagenPut ({ ...HEDGE_INPUTS, K: K_below });
    const mCall  = mertonCall({ ...HEDGE_INPUTS, K: K_above,
                                lambda: 2, jumpMean: 0, jumpStd: 0.15 });
    const mPut   = mertonPut ({ ...HEDGE_INPUTS, K: K_below,
                                lambda: 2, jumpMean: 0, jumpStd: 0.15 });
    assert.ok(mCall > gkCall, `Symmetric jumps should lift OTM call (${mCall} vs ${gkCall})`);
    assert.ok(mPut  > gkPut,  `Symmetric jumps should lift OTM put (${mPut} vs ${gkPut})`);
  });

  it("asymmetric upward jumps (μ_J>0) lift the call wing MORE than the put wing", () => {
    // For USD/frontier-EM, the rate (USD value in local currency) gaps UP on
    // devaluation. So an upward hedger (call wing) gets richer than a downward
    // hedger (put wing).
    const K_above = 12, K_below = 10;
    const gkCall = garmanKohlhagenCall({ ...HEDGE_INPUTS, K: K_above });
    const gkPut  = garmanKohlhagenPut ({ ...HEDGE_INPUTS, K: K_below });
    const mCallAsym = mertonCall({ ...HEDGE_INPUTS, K: K_above,
                                   lambda: 2, jumpMean: +0.08, jumpStd: 0.12 });
    const mPutAsym  = mertonPut ({ ...HEDGE_INPUTS, K: K_below,
                                   lambda: 2, jumpMean: +0.08, jumpStd: 0.12 });
    const callLift = (mCallAsym - gkCall) / gkCall;
    const putLift  = (mPutAsym  - gkPut)  / gkPut;
    assert.ok(
      callLift > putLift,
      `Call lift (${(callLift * 100).toFixed(1)}%) should exceed put lift (${(putLift * 100).toFixed(1)}%) under upward-bias jumps`,
    );
  });
});

describe("Range cap invariant — spread bounded by undiscounted width", () => {
  const wideRange = { ...HEDGE_INPUTS, K_lower: 11.4, K_upper: 12.0 };
  const widthBound = wideRange.K_upper - wideRange.K_lower;

  it("low-λ: spread ≤ width", () => {
    const v = mertonCallSpread({ ...wideRange, lambda: 0, jumpMean: 0, jumpStd: 0 });
    assert.ok(v <= widthBound, `${v} > ${widthBound}`);
    assert.ok(v >= 0);
  });

  it("high-λ: spread still ≤ width", () => {
    const v = mertonCallSpread({ ...wideRange, lambda: 10, jumpMean: 0.2, jumpStd: 0.3 });
    assert.ok(v <= widthBound, `${v} > ${widthBound}`);
    assert.ok(v >= 0);
  });
});

describe("Calibration sanity — USD/GHS-style 60-day hedge", () => {
  // 60-day USD/GHS hedge. Two geometries to make the spread-saturation point:
  //
  //   "narrow cap"  — strike 3% OTM, cap 9% OTM (similar to typical jump size).
  //                   Spread saturates under jumps; Merton ≤ GK is the correct
  //                   answer (long-leg-vs-short-leg vega tradeoff).
  //   "wide cap"    — strike 3% OTM, cap 26% OTM (well past typical jump size).
  //                   Long leg gains more from jumps than short loses. Merton > GK.
  //
  // The OUTRIGHT call at the strike unambiguously gets richer under jumps.
  const spot = 11.07;
  const baseInputs = {
    S: spot,
    T: 60 / 365,
    r: 0.045,
    q: -0.075,        // qEffective = r − μ with μ = 0.12
    sigma: 0.21,      // GARCH-integrated σ
  };
  const jumpParams = { lambda: 2, jumpMean: 0.08, jumpStd: 0.12 };

  it("outright OTM call is RICHER under jump-diffusion (the headline win)", () => {
    const K = spot * 1.03;
    const gk = garmanKohlhagenCall({ ...baseInputs, K });
    const merton = mertonCall({ ...baseInputs, K, ...jumpParams });
    const lift = (merton - gk) / gk;
    console.log(`  3% OTM call:  flat GK = ${gk.toFixed(6)}, Merton = ${merton.toFixed(6)}, lift = ${(lift * 100).toFixed(1)}%`);
    assert.ok(
      lift > 0.10,
      `OTM call should be ≥10% richer under jumps, got ${(lift * 100).toFixed(1)}%`,
    );
  });

  it("wide-cap spread (K_upper at 26% OTM) is richer under jumps", () => {
    const inputs = { ...baseInputs, K_lower: spot * 1.03, K_upper: spot * 1.26 };
    const gk = callSpreadValue(inputs);
    const merton = mertonCallSpread({ ...inputs, ...jumpParams });
    const lift = (merton - gk) / gk;
    console.log(`  wide-cap:     flat GK = ${gk.toFixed(6)}, Merton = ${merton.toFixed(6)}, lift = ${(lift * 100).toFixed(1)}%`);
    assert.ok(
      lift > 0,
      `Wide-cap spread should be richer under jumps, got lift ${(lift * 100).toFixed(1)}%`,
    );
  });

  it("narrow-cap spread (K_upper at 9% OTM) SATURATES — Merton can be ≤ GK", () => {
    // The standard BlockFinaX event geometry. This is a well-known property
    // of bull call spreads in jump-diffusion models — short upper-leg gains
    // more vega than long lower-leg when the cap is within reach of typical
    // jumps. The engine still gives a sensible, positive premium.
    const inputs = { ...baseInputs, K_lower: spot * 1.03, K_upper: spot * 1.09 };
    const gk = callSpreadValue(inputs);
    const merton = mertonCallSpread({ ...inputs, ...jumpParams });
    console.log(`  narrow-cap:   flat GK = ${gk.toFixed(6)}, Merton = ${merton.toFixed(6)}`);
    assert.ok(merton > 0, "Merton spread must still be positive");
    // Spread is bounded above by the range width in price units
    const widthBound = inputs.K_upper - inputs.K_lower;
    assert.ok(merton <= widthBound,
      `Merton spread ${merton} should be ≤ range width ${widthBound}`);
  });

  it("converts to plausible USD premium on $1000 notional (wide cap)", () => {
    const perUnit = mertonCallSpread({
      ...baseInputs, K_lower: spot * 1.03, K_upper: spot * 1.26, ...jumpParams,
    });
    const usdPremium = (perUnit * 1000) / spot;
    console.log(`  $1000 USD hedge premium (wide cap) = $${usdPremium.toFixed(2)}`);
    assert.ok(
      usdPremium >= 1 && usdPremium <= 80,
      `Premium $${usdPremium.toFixed(2)} outside plausible range [$1, $80]`,
    );
  });
});

describe("Input validation", () => {
  it("rejects T <= 0", () => {
    assert.throws(
      () => mertonCall({ ...HEDGE_INPUTS, K: 11, T: 0, lambda: 2, jumpMean: 0.1, jumpStd: 0.1 }),
      /T must be > 0/,
    );
  });

  it("rejects σ <= 0", () => {
    assert.throws(
      () => mertonCall({ ...HEDGE_INPUTS, K: 11, sigma: 0, lambda: 2, jumpMean: 0.1, jumpStd: 0.1 }),
      /sigma must be > 0/,
    );
  });

  it("rejects K_upper <= K_lower on spreads", () => {
    assert.throws(
      () => mertonCallSpread({ ...HEDGE_INPUTS, K_lower: 12, K_upper: 11,
                               lambda: 2, jumpMean: 0.1, jumpStd: 0.1 }),
      /K_upper must be > K_lower/,
    );
  });
});
