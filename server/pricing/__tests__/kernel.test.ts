/**
 * kernel.test.ts — verifies the Garman-Kohlhagen pricing math.
 *
 * Run with: npx tsx --test server/pricing/__tests__/kernel.test.ts
 *
 * Coverage:
 *   - Standard normal CDF accuracy at known points
 *   - Worked example from docs/pricing-engine.md §3.6 — both naïve GK and
 *     empirical-drift-corrected variants
 *   - Call-put parity (sanity check on the kernel)
 *   - Monotonicity: call value falls as strike rises
 *   - Range cap: spread value ≤ (K_upper − K_lower) × discount
 *   - Vol sensitivity: doubling σ on a wide range increases premium
 *   - Drift sensitivity: switching from naïve (r−q) to empirical-drift on USD/GHS
 *     produces the ~15× ratio described in §3.6
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalCDF,
  garmanKohlhagenCall,
  garmanKohlhagenPut,
  callSpreadValue,
  putSpreadValue,
  premiumInBaseCurrency,
} from "../kernel";

/** Assert a is within `tol` of b, with a helpful diff message. */
function near(actual: number, expected: number, tol: number, label = ""): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tol,
    `${label}: expected ~${expected}, got ${actual} (diff ${diff} > tol ${tol})`,
  );
}

describe("normalCDF — known reference points", () => {
  it("N(0) = 0.5", () => near(normalCDF(0), 0.5, 1e-7));
  it("N(1) ≈ 0.8413", () => near(normalCDF(1), 0.8413447, 1e-5));
  it("N(-1) ≈ 0.1587", () => near(normalCDF(-1), 0.1586553, 1e-5));
  it("N(1.96) ≈ 0.975", () => near(normalCDF(1.96), 0.975, 1e-3));
  it("N(-2.395) ≈ 0.0083 (the §3.6 d1 lookup)", () => near(normalCDF(-2.395), 0.0083, 5e-4));
  it("N(-2.485) ≈ 0.0065 (the §3.6 d2 lookup)", () => near(normalCDF(-2.485), 0.0065, 5e-4));
  it("symmetry: N(x) + N(-x) = 1", () => {
    for (const x of [0.3, 1.1, 2.5, 3.7]) {
      near(normalCDF(x) + normalCDF(-x), 1, 1e-7, `symmetry @ x=${x}`);
    }
  });
});

describe("Garman-Kohlhagen — the §3.6 worked example", () => {
  // Inputs: USD/GHS, S=11, T=0.25y, r=0.05, σ=0.18
  const baseInputs = { S: 11, T: 0.25, r: 0.05, sigma: 0.18 } as const;

  describe("Naïve GK (q = 0.26 — the broken case)", () => {
    const q = 0.26;

    it("call value at K=13 ≈ 0.0022 GHS per USD", () => {
      const c = garmanKohlhagenCall({ ...baseInputs, K: 13, q });
      near(c, 0.0022, 5e-4, "C(K=13)");
    });

    it("call value at K=14 is essentially zero (≤ 0.001 GHS per USD)", () => {
      const c = garmanKohlhagenCall({ ...baseInputs, K: 14, q });
      assert.ok(c >= 0, "C(K=14) must be non-negative");
      assert.ok(c < 0.001, `C(K=14) should be near zero, got ${c}`);
    });

    it("$10K notional call-spread premium ≈ $1.91 (the broken price)", () => {
      const perUnit = callSpreadValue({ ...baseInputs, K_lower: 13, K_upper: 14, q });
      const premium = premiumInBaseCurrency(perUnit, 10_000, baseInputs.S);
      near(premium, 1.91, 0.5, "naive premium per $10K");
    });
  });

  describe("Empirical-drift correction (μ=0.15 → q_eff = 0.05−0.15 = −0.10)", () => {
    const mu = 0.15;
    const qEff = baseInputs.r - mu;     // -0.10

    it("call value at K=13 ≈ 0.0370 GHS per USD (≈$33.6 per $10K)", () => {
      const c = garmanKohlhagenCall({ ...baseInputs, K: 13, q: qEff });
      near(c, 0.0370, 0.005, "C(K=13) corrected");
      const premium = premiumInBaseCurrency(c, 10_000, baseInputs.S);
      near(premium, 33.6, 5, "$10K USD-equivalent");
    });

    it("call value at K=14 ≈ 0.0048 GHS per USD (≈$4.4 per $10K)", () => {
      const c = garmanKohlhagenCall({ ...baseInputs, K: 14, q: qEff });
      near(c, 0.0048, 0.005, "C(K=14) corrected");
      const premium = premiumInBaseCurrency(c, 10_000, baseInputs.S);
      near(premium, 4.4, 3, "$10K USD-equivalent");
    });

    it("$10K notional call-spread premium ≈ $29 (the corrected price)", () => {
      const perUnit = callSpreadValue({ ...baseInputs, K_lower: 13, K_upper: 14, q: qEff });
      const premium = premiumInBaseCurrency(perUnit, 10_000, baseInputs.S);
      near(premium, 29, 4, "corrected premium per $10K");
    });
  });

  it("the empirical-drift correction multiplies the premium by ~15×", () => {
    const naive = callSpreadValue({ ...baseInputs, K_lower: 13, K_upper: 14, q: 0.26 });
    const corrected = callSpreadValue({ ...baseInputs, K_lower: 13, K_upper: 14, q: -0.10 });
    const ratio = corrected / naive;
    assert.ok(
      ratio > 10 && ratio < 25,
      `Expected ratio ~15×, got ${ratio.toFixed(1)}× (naive=${naive}, corrected=${corrected})`,
    );
  });
});

describe("Sanity properties (no specific worked-example dependence)", () => {
  const inputs = { S: 100, T: 0.5, r: 0.05, q: 0.02, sigma: 0.20 } as const;

  it("call-put parity: C − P = S·e^(−qT) − K·e^(−rT)", () => {
    const K = 105;
    const c = garmanKohlhagenCall({ ...inputs, K });
    const p = garmanKohlhagenPut({ ...inputs, K });
    const lhs = c - p;
    const rhs = inputs.S * Math.exp(-inputs.q * inputs.T) - K * Math.exp(-inputs.r * inputs.T);
    near(lhs, rhs, 1e-6, "parity");
  });

  it("call value is monotonically decreasing in strike", () => {
    let prev = Infinity;
    for (const K of [80, 90, 100, 110, 120, 130]) {
      const c = garmanKohlhagenCall({ ...inputs, K });
      assert.ok(c < prev, `Expected C(${K}) < C(prev), got ${c} >= ${prev}`);
      assert.ok(c >= 0, `Expected C(${K}) >= 0, got ${c}`);
      prev = c;
    }
  });

  it("put value is monotonically INcreasing in strike", () => {
    let prev = -Infinity;
    for (const K of [80, 90, 100, 110, 120, 130]) {
      const p = garmanKohlhagenPut({ ...inputs, K });
      assert.ok(p > prev, `Expected P(${K}) > P(prev), got ${p} <= ${prev}`);
      assert.ok(p >= 0, `Expected P(${K}) >= 0, got ${p}`);
      prev = p;
    }
  });

  it("call-spread value ≤ undiscounted range width (worst-case payoff bound)", () => {
    const value = callSpreadValue({ ...inputs, K_lower: 100, K_upper: 110 });
    const widthBound = (110 - 100); // undiscounted upper bound
    assert.ok(value <= widthBound, `Spread ${value} should be ≤ width ${widthBound}`);
    assert.ok(value > 0, `Spread should be positive, got ${value}`);
  });

  it("put-spread value ≤ undiscounted range width", () => {
    const value = putSpreadValue({ ...inputs, K_lower: 90, K_upper: 100 });
    const widthBound = (100 - 90);
    assert.ok(value <= widthBound, `Put spread ${value} should be ≤ width ${widthBound}`);
    assert.ok(value > 0, `Put spread should be positive, got ${value}`);
  });

  it("doubling σ increases ATM call value", () => {
    const lowVol  = garmanKohlhagenCall({ ...inputs, K: inputs.S, sigma: 0.10 });
    const highVol = garmanKohlhagenCall({ ...inputs, K: inputs.S, sigma: 0.20 });
    assert.ok(highVol > lowVol, `Expected highVol(${highVol}) > lowVol(${lowVol})`);
  });

  it("call-spread degenerates to ~zero when K_lower is very far OTM", () => {
    const v = callSpreadValue({ ...inputs, K_lower: 1000, K_upper: 1010 });
    assert.ok(v < 1e-6, `Expected near-zero for far-OTM spread, got ${v}`);
  });

  it("rejects K_upper <= K_lower for spreads", () => {
    assert.throws(
      () => callSpreadValue({ ...inputs, K_lower: 100, K_upper: 90 }),
      /K_upper must be > K_lower/,
    );
  });

  it("rejects T <= 0 for any single-strike option", () => {
    assert.throws(
      () => garmanKohlhagenCall({ ...inputs, K: 100, T: 0 }),
      /T must be > 0/,
    );
  });

  it("rejects σ <= 0", () => {
    assert.throws(
      () => garmanKohlhagenCall({ ...inputs, K: 100, sigma: 0 }),
      /sigma must be > 0/,
    );
  });
});

describe("premiumInBaseCurrency conversion", () => {
  it("converts per-unit value × notional / S correctly", () => {
    // 0.05 GHS-per-USD value × $10K notional / 11 spot = 45.45 USD
    const premium = premiumInBaseCurrency(0.05, 10_000, 11);
    near(premium, 45.4545, 1e-3);
  });

  it("rejects zero or negative notional / spot", () => {
    assert.throws(() => premiumInBaseCurrency(0.01, 0, 11), /notional must be > 0/);
    assert.throws(() => premiumInBaseCurrency(0.01, 1000, 0), /S must be > 0/);
  });
});
