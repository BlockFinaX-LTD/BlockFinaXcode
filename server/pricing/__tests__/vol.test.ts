/**
 * vol.test.ts — exercises the pure pieces of the realized-vol pipeline.
 *
 * Run with: npx tsx --test server/pricing/__tests__/vol.test.ts
 *
 * Coverage:
 *   - computeRealizedVol on canned series
 *   - EWMA seed: result is stable when first return is an outlier (regression
 *     for the old single-squared-return seed which over-weighted day 0)
 *   - applyPeggedFloor floors pegged but not other tiers
 *   - checkFreshness rejects stale (gap at the end) and sparse (gap in the
 *     middle) histories, accepts clean ones
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeRealizedVol,
  applyRiskPremium,
  applyPeggedFloor,
  applyTierFloor,
  checkFreshness,
  PEGGED_VOL_FLOOR,
  FRONTIER_EM_VOL_FLOOR,
} from "../data/vol-math";

/** Helper: ISO-date strings for the last `n` calendar days, oldest-first. */
function lastNDays(n: number, end: Date = new Date("2026-05-06T00:00:00Z")): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

describe("computeRealizedVol", () => {
  it("rejects too-short series", () => {
    assert.throws(() => computeRealizedVol([1, 2, 3]));
  });

  it("constant series → zero vol", () => {
    const closes = Array.from({ length: 61 }, () => 100);
    assert.equal(computeRealizedVol(closes), 0);
  });

  it("alternating up/down 1% → finite, sane vol", () => {
    // Returns alternate sign but same magnitude → variance ≈ (0.01)^2
    // → annualized ≈ 0.01 × √252 ≈ 0.158
    const closes: number[] = [100];
    for (let i = 1; i < 61; i++) closes.push(closes[i - 1] * (i % 2 === 0 ? 0.99 : 1.01));
    const vol = computeRealizedVol(closes);
    assert.ok(vol > 0.10 && vol < 0.20, `expected ~0.16, got ${vol}`);
  });

  it("seed bias regression: a single huge day-0 spike does NOT dominate σ", () => {
    // 60 quiet days (0.1% moves) preceded by ONE 10% spike on day 0.
    // Old seed (variance = first-return²) would carry that spike with weight
    // λ^59 ≈ 0.026 — still a 50%+ inflation of σ. New unweighted-seed-of-20
    // reduces the spike's weight to 1/20 then fades over EWMA.
    const closes: number[] = [100, 110]; // +10% spike day 0→1
    for (let i = 2; i < 62; i++) closes.push(closes[i - 1] * (i % 2 === 0 ? 1.001 : 0.999));
    const vol = computeRealizedVol(closes);
    // With fixed seed: σ should be ~0.10 (mostly quiet) — well below the
    // old buggy result of ~0.30+. Loose bound to avoid brittleness.
    assert.ok(vol < 0.15, `seed bias not fixed, got σ=${vol}`);
  });
});

describe("applyRiskPremium", () => {
  it("frontierEM gets +75%", () => {
    assert.equal(applyRiskPremium(0.20, "frontierEM"), 0.20 * 1.75);
  });
  it("g10 gets +12.5%", () => {
    assert.equal(applyRiskPremium(0.10, "g10"), 0.10 * 1.125);
  });
});

describe("applyPeggedFloor (legacy shim)", () => {
  it("floors pegged tier at 30% when realized × markup is below", () => {
    const r = applyPeggedFloor(0.05, "pegged");
    assert.equal(r.vol, PEGGED_VOL_FLOOR);
    assert.equal(r.floorHit, true);
  });

  it("does NOT floor pegged when realized × markup is already above 30%", () => {
    const r = applyPeggedFloor(0.50, "pegged");
    assert.equal(r.vol, 0.50);
    assert.equal(r.floorHit, false);
  });

  it("does NOT touch g10 (no floor configured)", () => {
    const r = applyPeggedFloor(0.08, "g10");
    assert.equal(r.vol, 0.08);
    assert.equal(r.floorHit, false);
  });
});

describe("applyTierFloor (per-tier floors)", () => {
  it("frontierEM floored at 10% when below — closes the GHS lottery-ticket bug", () => {
    // Without this floor: σ=5% on USD/GHS produced premium ~$1 on $4,453 max payout
    // (4,453× leverage). With floor: premium becomes realistic and the leverage cap stops blocking.
    const r = applyTierFloor(0.05, "frontierEM");
    assert.equal(r.vol, FRONTIER_EM_VOL_FLOOR);
    assert.equal(r.floorHit, true);
    assert.equal(r.floorValue, FRONTIER_EM_VOL_FLOOR);
  });

  it("frontierEM NOT floored when realized × markup is already above 10%", () => {
    const r = applyTierFloor(0.18, "frontierEM");
    assert.equal(r.vol, 0.18);
    assert.equal(r.floorHit, false);
    assert.equal(r.floorValue, FRONTIER_EM_VOL_FLOOR);   // floor still reported for diagnostics
  });

  it("pegged floor (30%) still applies under the generalised function", () => {
    const r = applyTierFloor(0.05, "pegged");
    assert.equal(r.vol, PEGGED_VOL_FLOOR);
    assert.equal(r.floorHit, true);
    assert.equal(r.floorValue, PEGGED_VOL_FLOOR);
  });

  it("tiers without a floor (g10, majorEM, commodities, crypto) are passthrough", () => {
    for (const tier of ["g10", "majorEM", "lessLiquidEM", "commodityMetal", "commodityEnergy", "commodityAgri", "cryptoMajor", "cryptoOther"] as const) {
      const r = applyTierFloor(0.02, tier);
      assert.equal(r.vol, 0.02, `tier ${tier} should be passthrough`);
      assert.equal(r.floorHit, false);
      assert.equal(r.floorValue, null);
    }
  });

  it("frontier floor is set to 10% — regression for the value", () => {
    assert.equal(FRONTIER_EM_VOL_FLOOR, 0.10);
  });
});

describe("checkFreshness", () => {
  const today = new Date("2026-05-06T12:00:00Z");

  it("accepts a clean 90-day window with daily closes", () => {
    const rows = lastNDays(90, today).map(date => ({ date }));
    assert.equal(checkFreshness(rows, today), null);
  });

  it("accepts 60 closes spread across the last 90 days", () => {
    // Take every other day in the last 90 → 45 closes — should fail
    // Take 60 of the last 90 → should pass. We'll take the most recent 60.
    const rows = lastNDays(60, today).map(date => ({ date }));
    assert.equal(checkFreshness(rows, today), null);
  });

  it("rejects stale data: 90 closes, but newest is 100 days old", () => {
    const oldEnd = new Date(today.getTime() - 100 * 86_400_000);
    const rows = lastNDays(90, oldEnd).map(date => ({ date }));
    const reason = checkFreshness(rows, today);
    assert.match(reason ?? "", /Stale or sparse history/);
  });

  it("rejects sparse data: only 30 closes in last 90 days", () => {
    // 30 consecutive days inside the window — count is below 60
    const rows = lastNDays(30, today).map(date => ({ date }));
    const reason = checkFreshness(rows, today);
    assert.match(reason ?? "", /30 closes/);
  });

  it("ignores rows older than the freshness window", () => {
    // 200 historical rows but only 30 recent — should still reject
    const recent = lastNDays(30, today);
    const old = lastNDays(170, new Date(today.getTime() - 100 * 86_400_000));
    const rows = [...old, ...recent].map(date => ({ date }));
    const reason = checkFreshness(rows, today);
    assert.match(reason ?? "", /30 closes/);
  });

  it("tolerates malformed dates (skips them, doesn't throw)", () => {
    const goodRows = lastNDays(70, today).map(date => ({ date }));
    const rows = [{ date: "not-a-date" }, ...goodRows];
    assert.equal(checkFreshness(rows, today), null);
  });
});
