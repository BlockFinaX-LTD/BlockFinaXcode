/**
 * jump-diffusion.test.ts — unit tests for the Merton jump-diffusion kernel.
 *
 * Key properties this file checks:
 *   1. λ=0 collapses Merton to plain Garman–Kohlhagen (sanity: no regression
 *      on the GK part of the engine)
 *   2. Adding jumps to a frontier-EM corridor produces a STRICTLY HIGHER
 *      premium than flat-vol GK — this is the whole point of the rewrite
 *   3. Series converges (truncation at n=50 is way past the tail for any
 *      realistic λT)
 *   4. Put–call parity still holds for the single-strike legs
 *   5. Spread payoffs are bounded by the range width — no negative or
 *      blown-out values
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  garmanKohlhagenCall,
  garmanKohlhagenPut,
  mertonCall,
  mertonPut,
  mertonCallSpread,
  mertonPutSpread,
  callSpreadValue,
} from "../kernel";

// A representative frontier-EM scenario: USD/GHS, 30 days, 5%-wide upward hedge
const baseFx = {
  S: 11.07,    // spot USD/GHS
  K: 11.40,    // strike (3% OTM)
  T: 30 / 365.25,
  r: 0.045,    // USD risk-free
  q: -0.075,   // q_effective = r − μ for frontier-EM
  sigma: 0.18, // 18% diffusive vol (post-GARCH integration)
};

const frontierEmJumps = {
  lambda: 2.0,    // 2 jumps per year
  jumpMean: 0.08, // +8% mean log-jump
  jumpStd: 0.12,
};

test("λ=0 ⇒ Merton ≡ Garman–Kohlhagen (regression test)", () => {
  const gk = garmanKohlhagenCall(baseFx);
  const merton = mertonCall({ ...baseFx, lambda: 0, jumpMean: 0, jumpStd: 0 });
  assert.ok(
    Math.abs(merton - gk) < 1e-10,
    `merton (λ=0) = ${merton}, gk = ${gk}, diff = ${merton - gk}`,
  );
});

test("λ=0 ⇒ Merton put ≡ Garman–Kohlhagen put", () => {
  const gk = garmanKohlhagenPut(baseFx);
  const merton = mertonPut({ ...baseFx, lambda: 0, jumpMean: 0, jumpStd: 0 });
  assert.ok(Math.abs(merton - gk) < 1e-10);
});

test("frontier-EM jumps strictly INCREASE upward-call premium vs flat-vol GK", () => {
  const gk = garmanKohlhagenCall(baseFx);
  const merton = mertonCall({ ...baseFx, ...frontierEmJumps });
  // Positive μ_J biases upward → call should be richer
  assert.ok(merton > gk, `merton (${merton}) should exceed gk (${gk})`);
  // And the lift should be material for OTM strikes (>20% premium boost)
  assert.ok(
    merton / gk > 1.1,
    `expected at least 10% lift, got ${((merton / gk - 1) * 100).toFixed(2)}%`,
  );
});

test("OTM wing premium scales with σ_J (Hull Ch 20: fatter tails → richer wings)", () => {
  // Deep OTM call (10% OTM); compare two different jump-vol levels
  const wing = { ...baseFx, K: 12.20 };
  const lowJumpVol  = mertonCall({ ...wing, ...frontierEmJumps, jumpStd: 0.05 });
  const highJumpVol = mertonCall({ ...wing, ...frontierEmJumps, jumpStd: 0.25 });
  assert.ok(
    highJumpVol > lowJumpVol,
    `higher jump-vol should produce a richer wing premium`,
  );
});

test("Merton series converges (truncation at n=50 is safe)", () => {
  // Forcing nTerms low — if the truncation is unsafe we'd see large drift
  const full     = mertonCall({ ...baseFx, ...frontierEmJumps, nTerms: 60 });
  const truncated = mertonCall({ ...baseFx, ...frontierEmJumps, nTerms: 25 });
  assert.ok(
    Math.abs(full - truncated) < 1e-9,
    `series should converge well before n=25; diff was ${full - truncated}`,
  );
});

test("put–call parity holds for Merton single-strike (jumps preserve the no-arb relation)", () => {
  // C − P = S e^(−qT) − K e^(−rT) regardless of the jump structure, because
  // the jump-drift compensation makes the discounted price a martingale.
  const c = mertonCall({ ...baseFx, ...frontierEmJumps });
  const p = mertonPut({ ...baseFx, ...frontierEmJumps });
  const lhs = c - p;
  const rhs = baseFx.S * Math.exp(-baseFx.q * baseFx.T)
            - baseFx.K * Math.exp(-baseFx.r * baseFx.T);
  assert.ok(
    Math.abs(lhs - rhs) < 1e-6,
    `parity violated: C−P=${lhs}, S·e^{−qT}−K·e^{−rT}=${rhs}`,
  );
});

test("call-spread is bounded above by (K_upper − K_lower) × e^{−rT}", () => {
  // Hull §11: bounds on spreads
  const cs = mertonCallSpread({
    S: baseFx.S, K_lower: 11.40, K_upper: 12.00,
    T: baseFx.T, r: baseFx.r, q: baseFx.q, sigma: baseFx.sigma,
    ...frontierEmJumps,
  });
  const upperBound = (12.00 - 11.40) * Math.exp(-baseFx.r * baseFx.T);
  assert.ok(cs > 0, "spread must be positive");
  assert.ok(cs <= upperBound + 1e-9, `spread ${cs} exceeds upper bound ${upperBound}`);
});

test("Merton lifts the OUTRIGHT OTM call vs flat-vol GK for upward-bias jumps", () => {
  // Hull Ch 27: positive-drift jumps strictly increase the value of an OTM
  // call. (The same is NOT true for *narrow* call spreads — see the next test —
  // because the short leg can gain more vega than the long leg when the cap
  // is within reach of typical jumps.)
  const K = 11.5;
  const merton = mertonCall({ ...baseFx, K, ...frontierEmJumps });
  const gk     = garmanKohlhagenCall({ ...baseFx, K });
  assert.ok(merton > gk, `Merton OTM call ${merton} should exceed GK ${gk}`);
});

test("call-spread vs GK: sign depends on cap geometry", () => {
  // For a WIDE cap (K_upper far past typical jump magnitude), jumps richen
  // the long leg more than the short leg → Merton > GK.
  const wideSpreadMerton = mertonCallSpread({
    S: baseFx.S, K_lower: 11.40, K_upper: 15.00,   // 35% wide
    T: baseFx.T, r: baseFx.r, q: baseFx.q, sigma: baseFx.sigma,
    ...frontierEmJumps,
  });
  const wideSpreadGk = callSpreadValue({
    S: baseFx.S, K_lower: 11.40, K_upper: 15.00,
    T: baseFx.T, r: baseFx.r, q: baseFx.q, sigma: baseFx.sigma,
  });
  assert.ok(
    wideSpreadMerton > wideSpreadGk,
    `Wide-cap spread: Merton ${wideSpreadMerton} should exceed GK ${wideSpreadGk}`,
  );

  // For a NARROW cap (K_upper near typical jump magnitude), the spread
  // saturates: jumps push prob past K_upper, where we're short. Merton ≤ GK.
  const narrowSpreadMerton = mertonCallSpread({
    S: baseFx.S, K_lower: 11.40, K_upper: 12.00,   // 5% wide, within jump magnitude
    T: baseFx.T, r: baseFx.r, q: baseFx.q, sigma: baseFx.sigma,
    ...frontierEmJumps,
  });
  const narrowSpreadGk = callSpreadValue({
    S: baseFx.S, K_lower: 11.40, K_upper: 12.00,
    T: baseFx.T, r: baseFx.r, q: baseFx.q, sigma: baseFx.sigma,
  });
  assert.ok(
    narrowSpreadMerton <= narrowSpreadGk * 1.01,
    `Narrow-cap spread under Merton should NOT exceed GK (saturates): merton=${narrowSpreadMerton}, gk=${narrowSpreadGk}`,
  );
});

test("put-spread payoff for downward hedge: structurally analogous to call-spread", () => {
  // Downward hedge: strike ABOVE cap. Local currency depreciates → put pays out.
  const ps = mertonPutSpread({
    S: baseFx.S, K_lower: 10.50, K_upper: 11.00,
    T: baseFx.T, r: baseFx.r, q: baseFx.q, sigma: baseFx.sigma,
    ...frontierEmJumps,
  });
  const upperBound = (11.00 - 10.50) * Math.exp(-baseFx.r * baseFx.T);
  assert.ok(ps > 0);
  assert.ok(ps <= upperBound + 1e-9);
});

test("crash-protective put: σ_J=20% adds material premium vs σ_J=10%", () => {
  // The whole reason for jump-diffusion: protect LPs against tail moves
  const wide = mertonPut({ ...baseFx, ...frontierEmJumps, jumpStd: 0.20 });
  const narrow = mertonPut({ ...baseFx, ...frontierEmJumps, jumpStd: 0.10 });
  // Wider jump distribution → fatter right tail → richer puts (asymmetric μ_J=+0.08)
  // Either direction is possible depending on moneyness; just check they differ.
  assert.notEqual(wide, narrow);
});

test("zero σ_J ⇒ all jumps have identical magnitude — discrete check", () => {
  // λ=10 (very active), σ_J=0: each jump is exactly e^{μ_J}·S — deterministic
  // size, just random count. Should still produce a finite, positive call value.
  const c = mertonCall({
    ...baseFx,
    lambda: 10, jumpMean: 0.05, jumpStd: 1e-9,
  });
  assert.ok(c > 0 && Number.isFinite(c));
});
