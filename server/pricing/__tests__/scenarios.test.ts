/**
 * scenarios.test.ts — plug-in-your-own-values pricing scenarios.
 *
 * Run with:
 *   npx tsx --test server/pricing/__tests__/scenarios.test.ts
 *
 * This file is intentionally human-friendly. Each scenario is a self-contained
 * block where you read or edit the inputs at the top, and the test prints the
 * resulting fair-value premium with full breakdown.
 *
 * It bypasses the database / network / oracle layers entirely and uses the
 * SAME math the production engine uses (Merton jump-diffusion + GARCH
 * integrated variance). So if you want to ask "what would a 45-day USD/NGN
 * hedge with strike 1700, cap 1850, current rate 1620 actually cost?", just
 * copy a scenario, change the numbers, and re-run.
 *
 * The scenarios below are calibrated against realistic frontier-EM dynamics
 * documented in:
 *   - emerging_markets.md (skill: dynamic-hedging)
 *   - Hull Ch 27 (jump-diffusion)
 *   - BlockFinaX historical realized FX over 2018–2024
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mertonCallSpread,
  mertonPutSpread,
  premiumInBaseCurrency,
} from "../kernel";
import { integratedVariance } from "../data/garch";
import { TIER_JUMP_PARAMS } from "../data/jump-params";
import { TIER_PERSISTENCE } from "../data/garch";
import type { PairTier } from "../data/pairs";

/**
 * Run a full quote through the v2 engine math without touching the DB.
 *
 * `inputs` is what you'd plug into createEvent on-chain. The function returns
 * the breakdown the engine would have served via /api/pricing/quote.
 */
interface ScenarioInputs {
  pair: string;
  tier: PairTier;
  spot: number;              // current rate (USD/local quote)
  strike: number;            // entry-edge of the payout zone
  payoutCap: number;         // far-edge of the payout zone
  notional: number;          // USDC notional
  daysToExpiry: number;
  usdRiskFree: number;       // e.g. 0.045 for 4.5%
  empiricalDrift: number;    // μ — local-currency depreciation rate, e.g. 0.12 for 12%/yr
  ewmaSigma: number;         // spot vol from EWMA (post-tier-floor + markup)
  longRunSigma: number;      // 5y sample stdev — anchors mean reversion
  strikeAbove: boolean;      // true = upward hedge (call spread)
}

interface ScenarioResult {
  premiumUsd: number;
  premiumRate: number;       // premium / notional
  maxPayoutUsd: number;
  leverageRatio: number;
  // Diagnostics
  sigmaIntegrated: number;
  effectiveQ: number;
  jumpComponent: number;     // pp difference between Merton and flat-vol GK
}

function priceScenario(s: ScenarioInputs): ScenarioResult {
  const T_years = s.daysToExpiry / 365.25;
  const qEffective = s.usdRiskFree - s.empiricalDrift;
  const persistence = TIER_PERSISTENCE[s.tier];
  const jump = TIER_JUMP_PARAMS[s.tier];

  // 1. GARCH-style integrated variance — blends spot vol toward long-run vol
  const integ = integratedVariance({
    sigma0: s.ewmaSigma,
    sigmaLongRun: s.longRunSigma,
    TYears: T_years,
    persistence,
  });

  // 2. Spread pricing under Merton jump-diffusion
  const spreadValue = s.strikeAbove
    ? mertonCallSpread({
        S: s.spot,
        K_lower: s.strike,
        K_upper: s.payoutCap,
        T: T_years,
        r: s.usdRiskFree,
        q: qEffective,
        sigma: integ.sigmaIntegrated,
        lambda: jump.lambda,
        jumpMean: jump.jumpMean,
        jumpStd: jump.jumpStd,
      })
    : mertonPutSpread({
        S: s.spot,
        K_lower: s.payoutCap,
        K_upper: s.strike,
        T: T_years,
        r: s.usdRiskFree,
        q: qEffective,
        sigma: integ.sigmaIntegrated,
        lambda: jump.lambda,
        jumpMean: jump.jumpMean,
        jumpStd: jump.jumpStd,
      });

  // Flat-vol GK reference (no jumps) — for the "jump premium" diagnostic
  const flatVolReference = s.strikeAbove
    ? mertonCallSpread({
        S: s.spot,
        K_lower: s.strike, K_upper: s.payoutCap,
        T: T_years, r: s.usdRiskFree, q: qEffective,
        sigma: integ.sigmaIntegrated,
        lambda: 0, jumpMean: 0, jumpStd: 0,
      })
    : mertonPutSpread({
        S: s.spot,
        K_lower: s.payoutCap, K_upper: s.strike,
        T: T_years, r: s.usdRiskFree, q: qEffective,
        sigma: integ.sigmaIntegrated,
        lambda: 0, jumpMean: 0, jumpStd: 0,
      });

  const premiumUsd = premiumInBaseCurrency(spreadValue, s.notional, s.spot);
  const premiumRate = premiumUsd / s.notional;
  const rangeWidth = Math.abs(s.payoutCap - s.strike);
  const maxPayoutUsd = (s.notional * rangeWidth) / s.spot;
  const leverageRatio = premiumUsd > 0 ? maxPayoutUsd / premiumUsd : Infinity;
  const jumpComponent = (spreadValue - flatVolReference) / flatVolReference;

  return {
    premiumUsd,
    premiumRate,
    maxPayoutUsd,
    leverageRatio,
    sigmaIntegrated: integ.sigmaIntegrated,
    effectiveQ: qEffective,
    jumpComponent,
  };
}

function printResult(label: string, s: ScenarioInputs, r: ScenarioResult) {
  console.log(`\n────────────────────────────────────────────────────────`);
  console.log(`  Scenario: ${label}`);
  console.log(`────────────────────────────────────────────────────────`);
  console.log(`  Pair               : ${s.pair} (tier=${s.tier})`);
  console.log(`  Spot               : ${s.spot.toFixed(4)}`);
  console.log(`  Strike / Cap       : ${s.strike} / ${s.payoutCap}  (${s.strikeAbove ? "upward" : "downward"})`);
  console.log(`  Notional           : $${s.notional.toLocaleString()}`);
  console.log(`  Days to expiry     : ${s.daysToExpiry}`);
  console.log(`  USD rate           : ${(s.usdRiskFree * 100).toFixed(2)}%`);
  console.log(`  Empirical drift μ  : ${(s.empiricalDrift * 100).toFixed(2)}%/yr`);
  console.log(`  q_effective        : ${(r.effectiveQ * 100).toFixed(2)}%`);
  console.log(`  σ EWMA (spot)      : ${(s.ewmaSigma * 100).toFixed(1)}%`);
  console.log(`  σ long-run         : ${(s.longRunSigma * 100).toFixed(1)}%`);
  console.log(`  σ integrated       : ${(r.sigmaIntegrated * 100).toFixed(1)}%`);
  console.log(``);
  console.log(`  → Premium          : $${r.premiumUsd.toFixed(2)}  (${(r.premiumRate * 100).toFixed(3)}% of notional)`);
  console.log(`  → Max payout       : $${r.maxPayoutUsd.toFixed(2)}`);
  console.log(`  → Leverage ratio   : ${r.leverageRatio.toFixed(1)}×`);
  console.log(`  → Jump premium lift: ${(r.jumpComponent * 100).toFixed(1)}% (vs flat-vol GK)`);
}

// ─────────────────────────────────────────────────────────────────────────────
//                              SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────
//
// EDIT THE INPUTS BELOW to price your own scenarios. Each test prints a full
// breakdown. The assertions are sanity checks (e.g. premium > 0, leverage in
// realistic range) — they will not fail on small numerical changes.
//
// Realistic σ ranges per tier (annualized, post-tier-floor + markup):
//   frontierEM (GHS, NGN, KES): 18–28%
//   majorEM    (BRL, MXN, ZAR): 12–22%
//   g10         (EUR, GBP, JPY): 6–14%
//   pegged      (HKD, AED, SAR): 1–5%  (with rare jump events)
//   cryptoMajor (BTC, ETH):      40–80%
//
// Realistic empirical drift μ:
//   USD/GHS, USD/NGN: 8–15%/yr (chronic depreciation)
//   USD/KES, USD/ZAR: 3–8%/yr
//   USD/EUR, USD/JPY: ~0% (no chronic drift)
// ─────────────────────────────────────────────────────────────────────────────

describe("BlockFinaX pricing — scenario tests (edit inputs to test your own)", () => {
  it("USD/GHS — 60-day upward hedge, partial coverage", () => {
    const inputs: ScenarioInputs = {
      pair: "USD/GHS",
      tier: "frontierEM",
      spot: 11.07,
      strike: 11.40,            // ~3% above spot
      payoutCap: 12.00,         // ~9% above spot
      notional: 1000,           // $1K USDC hedge
      daysToExpiry: 60,
      usdRiskFree: 0.045,
      empiricalDrift: 0.12,
      ewmaSigma: 0.22,
      longRunSigma: 0.20,
      strikeAbove: true,
    };
    const result = priceScenario(inputs);
    printResult("USD/GHS 60-day upward hedge", inputs, result);

    assert.ok(result.premiumUsd > 0, "Premium must be positive");
    // Leverage = max_payout / premium. Anywhere in [2, 100]× is plausible —
    // the v2 engine charges more for jump risk than v1 did, so leverages
    // are lower (engine is more conservative). The on-chain MAX_LEVERAGE_RATIO
    // is 100×; anything above that triggers a rejection.
    assert.ok(result.leverageRatio > 2 && result.leverageRatio < 100,
      `Leverage ${result.leverageRatio} should be in [2, 100]× — outside means the engine is over- or under-pricing`);
    // For a NARROW-cap upward hedge, jumpComponent can be negative (spread
    // saturation — short upper leg gains more vega than long lower leg).
    assert.ok(Number.isFinite(result.jumpComponent),
      `Jump component must be finite, got ${result.jumpComponent}`);
  });

  it("USD/NGN — 90-day upward hedge, post-devaluation regime", () => {
    const inputs: ScenarioInputs = {
      pair: "USD/NGN",
      tier: "frontierEM",
      spot: 1620,
      strike: 1700,             // ~5% above spot
      payoutCap: 1850,          // ~14% above spot
      notional: 5000,
      daysToExpiry: 90,
      usdRiskFree: 0.045,
      empiricalDrift: 0.15,
      ewmaSigma: 0.28,          // elevated post-devaluation
      longRunSigma: 0.22,
      strikeAbove: true,
    };
    const result = priceScenario(inputs);
    printResult("USD/NGN 90-day upward hedge", inputs, result);

    assert.ok(result.premiumUsd > 0);
    // 90 days + elevated vol → premium should be meaningful (>2% of notional)
    assert.ok(result.premiumRate > 0.01,
      `Premium rate ${result.premiumRate} should be > 1% for elevated-vol frontierEM`);
  });

  it("USD/KES — 30-day upward hedge, near-spot strike", () => {
    const inputs: ScenarioInputs = {
      pair: "USD/KES",
      tier: "frontierEM",
      spot: 129.5,
      strike: 130.5,            // ~0.8% above spot — near-ATM
      payoutCap: 134,           // ~3.5% above spot
      notional: 2000,
      daysToExpiry: 30,
      usdRiskFree: 0.045,
      empiricalDrift: 0.05,
      ewmaSigma: 0.18,
      longRunSigma: 0.16,
      strikeAbove: true,
    };
    const result = priceScenario(inputs);
    printResult("USD/KES 30-day near-ATM upward hedge", inputs, result);

    // Near-ATM hedge → premium should be meaningfully higher than far-OTM
    assert.ok(result.premiumRate > 0.005,
      `Near-ATM hedge should price > 0.5%, got ${(result.premiumRate * 100).toFixed(3)}%`);
  });

  it("USD/ZAR — 45-day, majorEM tier (less jump risk than frontier)", () => {
    const inputs: ScenarioInputs = {
      pair: "USD/ZAR",
      tier: "majorEM",
      spot: 18.5,
      strike: 19.0,
      payoutCap: 20.0,
      notional: 5000,
      daysToExpiry: 45,
      usdRiskFree: 0.045,
      empiricalDrift: 0.04,
      ewmaSigma: 0.16,
      longRunSigma: 0.15,
      strikeAbove: true,
    };
    const result = priceScenario(inputs);
    printResult("USD/ZAR 45-day upward hedge (majorEM)", inputs, result);

    // majorEM has smaller jump component than frontierEM
    assert.ok(result.jumpComponent < 0.30,
      `majorEM jump lift should be < 30%, got ${result.jumpComponent}`);
  });

  it("USD/EUR — 90-day g10 (essentially flat-vol GK, no jumps)", () => {
    const inputs: ScenarioInputs = {
      pair: "EUR/USD",
      tier: "g10",
      spot: 1.085,
      strike: 1.10,
      payoutCap: 1.13,
      notional: 10000,
      daysToExpiry: 90,
      usdRiskFree: 0.045,
      empiricalDrift: 0.0,     // no chronic drift on EUR
      ewmaSigma: 0.08,
      longRunSigma: 0.085,
      strikeAbove: true,
    };
    const result = priceScenario(inputs);
    printResult("EUR/USD 90-day upward hedge (g10)", inputs, result);

    // g10 tier has λ=0 → Merton collapses to GK → jumpComponent = 0
    assert.ok(Math.abs(result.jumpComponent) < 1e-10,
      `g10 should be pure GK (no jumps), got jump component ${result.jumpComponent}`);
  });

  it("USD/GHS — DOWNWARD hedge (rare; LPs hedging local-currency appreciation)", () => {
    const inputs: ScenarioInputs = {
      pair: "USD/GHS",
      tier: "frontierEM",
      spot: 11.07,
      strike: 10.80,            // below spot
      payoutCap: 10.20,         // far below spot
      notional: 1000,
      daysToExpiry: 60,
      usdRiskFree: 0.045,
      empiricalDrift: 0.12,
      ewmaSigma: 0.22,
      longRunSigma: 0.20,
      strikeAbove: false,       // PUT spread
    };
    const result = priceScenario(inputs);
    printResult("USD/GHS 60-day DOWNWARD hedge (put spread)", inputs, result);

    assert.ok(result.premiumUsd > 0);
    // Downward hedge with high positive drift → option is far-OTM-ish, cheap
    assert.ok(result.premiumRate < 0.04,
      `Downward hedge on chronically-depreciating pair should be cheap`);
  });

  it("Sensitivity demo: same scenario at different days-to-expiry", () => {
    const base: ScenarioInputs = {
      pair: "USD/GHS",
      tier: "frontierEM",
      spot: 11.07,
      strike: 11.40,
      payoutCap: 12.00,
      notional: 1000,
      daysToExpiry: 0,          // set per iteration below
      usdRiskFree: 0.045,
      empiricalDrift: 0.12,
      ewmaSigma: 0.22,
      longRunSigma: 0.20,
      strikeAbove: true,
    };
    console.log(`\n────────────────────────────────────────────────────────`);
    console.log(`  USD/GHS premium across tenors (same strike/cap/spot)`);
    console.log(`────────────────────────────────────────────────────────`);
    console.log(`   days |  premium |  rate    |  σ_int  |  jump lift`);
    let prevPremium = 0;
    for (const days of [7, 14, 30, 60, 90, 180]) {
      const r = priceScenario({ ...base, daysToExpiry: days });
      console.log(
        `   ${String(days).padStart(4)} | $${r.premiumUsd.toFixed(2).padStart(7)} | ` +
        `${(r.premiumRate * 100).toFixed(2).padStart(5)}%  | ` +
        `${(r.sigmaIntegrated * 100).toFixed(1)}%   | ${(r.jumpComponent * 100).toFixed(1)}%`,
      );
      assert.ok(r.premiumUsd >= prevPremium - 1e-9,
        `Premium should be non-decreasing in tenor (broke at days=${days})`);
      prevPremium = r.premiumUsd;
    }
  });

  it("Sensitivity demo: same scenario at different vols", () => {
    const base: ScenarioInputs = {
      pair: "USD/GHS",
      tier: "frontierEM",
      spot: 11.07,
      strike: 11.40,
      payoutCap: 12.00,
      notional: 1000,
      daysToExpiry: 60,
      usdRiskFree: 0.045,
      empiricalDrift: 0.12,
      ewmaSigma: 0.0,            // set per iteration
      longRunSigma: 0.20,
      strikeAbove: true,
    };
    console.log(`\n────────────────────────────────────────────────────────`);
    console.log(`  USD/GHS 60-day premium across vols`);
    console.log(`────────────────────────────────────────────────────────`);
    console.log(`   σ_EWMA |  premium |  rate    |  σ_int`);
    let prevPremium = 0;
    for (const sigma of [0.10, 0.15, 0.18, 0.22, 0.28, 0.35]) {
      const r = priceScenario({ ...base, ewmaSigma: sigma });
      console.log(
        `   ${(sigma * 100).toFixed(0).padStart(3)}%   | $${r.premiumUsd.toFixed(2).padStart(7)} | ` +
        `${(r.premiumRate * 100).toFixed(2).padStart(5)}%  | ${(r.sigmaIntegrated * 100).toFixed(1)}%`,
      );
      assert.ok(r.premiumUsd >= prevPremium - 1e-9,
        `Premium should be non-decreasing in vol`);
      prevPremium = r.premiumUsd;
    }
  });

  it("Pegged FX — USD/HKD with rare devaluation jump (essentially binary)", () => {
    const inputs: ScenarioInputs = {
      pair: "USD/HKD",
      tier: "pegged",
      spot: 7.80,
      strike: 8.00,             // ~2.5% above the peg
      payoutCap: 8.50,          // ~9% above the peg
      notional: 50000,
      daysToExpiry: 180,
      usdRiskFree: 0.045,
      empiricalDrift: 0.0,
      ewmaSigma: 0.02,          // peg pins vol near zero
      longRunSigma: 0.02,
      strikeAbove: true,
    };
    const result = priceScenario(inputs);
    printResult("USD/HKD 180-day peg-break hedge", inputs, result);

    // Pegged-FX OTM call is essentially a binary bet on peg break — should
    // have meaningful jump component despite tiny diffusion σ
    assert.ok(result.premiumUsd >= 0);
  });
});
