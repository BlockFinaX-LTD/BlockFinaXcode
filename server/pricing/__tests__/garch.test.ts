/**
 * garch.test.ts — unit tests for the GARCH(1,1) integrated-variance forecaster.
 *
 * The integrated variance V(T) is what gets passed to the kernel. Hull §23 gives
 * the closed form for expected average variance under GARCH(1,1):
 *
 *   V(T) = V_L + ((1 − ρ^N) / (N·(1 − ρ))) · (σ_0² − V_L)
 *
 * with ρ = α + β = persistence and N = T·252. Properties we verify:
 *
 *   1. σ_0 = σ_LR ⇒ V(T) = σ_0² for any T (no reversion happening)
 *   2. T → 0 ⇒ V(T) → σ_0² (the integral collapses to the spot variance)
 *   3. T → ∞ ⇒ V(T) → σ_LR² (full mean reversion)
 *   4. σ_0 > σ_LR ⇒ V(T) sits BETWEEN them (we're decaying down)
 *   5. σ_0 < σ_LR ⇒ V(T) sits BETWEEN them (we're decaying up)
 *   6. Higher persistence ⇒ slower decay toward V_L
 *   7. The output σ_integrated is monotonic in T (decays toward V_L)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  integratedVariance,
  longRunVolFromCloses,
  persistenceForTier,
} from "../data/garch";

test("σ_0 = σ_LR ⇒ V(T) = σ_0² (no mean reversion needed)", () => {
  const r = integratedVariance({
    sigma0: 0.20, sigmaLongRun: 0.20, TYears: 0.25, persistence: 0.95,
  });
  assert.ok(Math.abs(r.sigmaIntegrated - 0.20) < 1e-12);
});

test("very short T ⇒ V(T) ≈ σ_0² (no time to mean-revert)", () => {
  const r = integratedVariance({
    sigma0: 0.30, sigmaLongRun: 0.15, TYears: 1 / 365.25, persistence: 0.95,
  });
  assert.ok(Math.abs(r.sigmaIntegrated - 0.30) < 0.01);
});

test("very long T ⇒ V(T) → σ_LR² (full mean reversion)", () => {
  const r = integratedVariance({
    sigma0: 0.30, sigmaLongRun: 0.15, TYears: 10, persistence: 0.90,
  });
  // With ρ=0.90 and 10 years (2520 trading days), most of the mass is at V_L
  assert.ok(
    Math.abs(r.sigmaIntegrated - 0.15) < 0.03,
    `expected near σ_LR=0.15, got ${r.sigmaIntegrated}`,
  );
});

test("σ_0 > σ_LR ⇒ σ_integrated sits BETWEEN them (decaying down)", () => {
  const r = integratedVariance({
    sigma0: 0.40, sigmaLongRun: 0.20, TYears: 0.5, persistence: 0.93,
  });
  assert.ok(r.sigmaIntegrated > 0.20 && r.sigmaIntegrated < 0.40);
});

test("σ_0 < σ_LR ⇒ σ_integrated sits BETWEEN them (decaying up)", () => {
  const r = integratedVariance({
    sigma0: 0.10, sigmaLongRun: 0.25, TYears: 0.5, persistence: 0.93,
  });
  assert.ok(r.sigmaIntegrated > 0.10 && r.sigmaIntegrated < 0.25);
});

test("higher persistence ⇒ slower decay toward σ_LR", () => {
  const slow = integratedVariance({
    sigma0: 0.40, sigmaLongRun: 0.20, TYears: 0.5, persistence: 0.99,
  });
  const fast = integratedVariance({
    sigma0: 0.40, sigmaLongRun: 0.20, TYears: 0.5, persistence: 0.85,
  });
  // Slow-decay engine should still be closer to σ_0=0.40
  assert.ok(slow.sigmaIntegrated > fast.sigmaIntegrated);
});

test("σ_integrated is monotonic in T when σ_0 > σ_LR (decay is monotone)", () => {
  const vols: number[] = [];
  for (const days of [7, 30, 60, 120, 240]) {
    const r = integratedVariance({
      sigma0: 0.30, sigmaLongRun: 0.15, TYears: days / 365.25, persistence: 0.93,
    });
    vols.push(r.sigmaIntegrated);
  }
  // Each step should be ≤ the previous (decaying toward 0.15)
  for (let i = 1; i < vols.length; i++) {
    assert.ok(
      vols[i] <= vols[i - 1] + 1e-9,
      `non-monotonic decay at step ${i}: ${vols[i - 1]} → ${vols[i]}`,
    );
  }
});

test("persistence in [0,1) — rejects ρ=1 (would be EWMA, divides by zero)", () => {
  assert.throws(() => integratedVariance({
    sigma0: 0.2, sigmaLongRun: 0.2, TYears: 0.5, persistence: 1.0,
  }));
});

test("σ_0 ≤ 0 — rejected", () => {
  assert.throws(() => integratedVariance({
    sigma0: 0, sigmaLongRun: 0.2, TYears: 0.5,
  }));
});

test("longRunVolFromCloses: flat series ⇒ near-zero vol", () => {
  const closes = Array(100).fill(10.0);
  const vol = longRunVolFromCloses(closes);
  assert.ok(vol < 1e-9);
});

test("longRunVolFromCloses: known constant log-return ⇒ matches expected", () => {
  // Series that grows by exactly 1% per day → daily log-return = ln(1.01)
  // Daily variance = (ln 1.01)² (because all returns identical so zero-mean
  // assumption forces the formula to that). Annualized vol = ln(1.01) × √252.
  const dailyReturn = Math.log(1.01);
  const expectedAnnualVol = Math.abs(dailyReturn) * Math.sqrt(252);

  const closes: number[] = [10];
  for (let i = 1; i < 100; i++) closes.push(closes[i - 1] * 1.01);

  const vol = longRunVolFromCloses(closes);
  assert.ok(
    Math.abs(vol - expectedAnnualVol) < 1e-9,
    `expected ${expectedAnnualVol}, got ${vol}`,
  );
});

test("longRunVolFromCloses: rejects sparse data (< 30 closes)", () => {
  assert.throws(() => longRunVolFromCloses([10, 11, 12]));
});

test("persistenceForTier: every defined tier maps to a value in [0.85, 1)", () => {
  const tiers = [
    "g10", "majorEM", "lessLiquidEM", "frontierEM", "pegged",
    "commodityMetal", "commodityEnergy", "commodityAgri",
    "cryptoMajor", "cryptoOther",
  ] as const;
  for (const t of tiers) {
    const p = persistenceForTier(t);
    assert.ok(p >= 0.85 && p < 1, `${t}: persistence ${p} out of range`);
  }
});
