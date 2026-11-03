/**
 * ADVERSARIAL SECURITY TEST — pool solvency / unbacked-liability hunt.
 * Local, pure, no chain. Tries to find terms a pool would accept where the
 * reserved maxPayout does NOT cover the actual settlement payout at some price.
 * If any case is found, the protocol could owe more than it reserved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BPS,
  checkTerms,
  maxPayout,
  openCap,
  settlementPayout,
  type ProtectionStructure,
} from "../pool-economics";
import type { PoolStructures } from "../types";

// A deterministic PRNG so a failure is reproducible from the printed seed.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const E6 = 1_000_000;
const toE6 = (x: number) => BigInt(Math.round(x * E6));

// A pool that offers both structures with a generous cap window, so checkTerms
// is the only gate on the terms we throw at it.
const structures: PoolStructures = {
  openEnabled: true,
  cappedEnabled: true,
  minCapDistanceBps: 1,
  maxCapDistanceBps: 10_000,
  openMaxPayoutBps: 2_000,
};

test("SOLVENCY: reserved maxPayout always covers the settlement payout, every direction, every price", () => {
  const rand = rng(0xB10C_F1A7);
  let checked = 0;
  for (let i = 0; i < 200_000; i++) {
    const rand = rng(i * 2654435761);
    const spotF = 0.5 + rand() * 3000; // spot from 0.5 to ~3000 (covers GHS, NGN, KES ranges)
    const spot = toE6(spotF);
    const strikeAbove = rand() < 0.5;
    const notional = BigInt(Math.floor(1 + rand() * 5_000_000)) * BigInt(E6); // up to $5M

    // Pick a strike inside the contract's allowed band.
    let strike: bigint;
    if (strikeAbove) {
      strike = spot + toE6(rand() * spotF * 0.99); // [spot, 2x spot)
      if (strike < spot) strike = spot;
      if (strike >= spot * 2n) strike = spot * 2n - 1n;
    } else {
      strike = spot - toE6(rand() * spotF * 0.49); // (0.5x spot, spot]
      if (strike > spot) strike = spot;
      if (strike <= spot / 2n) strike = spot / 2n + 1n;
    }

    // Two structures: open (cap derived) and capped (cap chosen in window).
    const structure: ProtectionStructure = rand() < 0.5 ? "open" : "capped";
    let cap: bigint;
    if (structure === "open") {
      cap = openCap(BigInt(structures.openMaxPayoutBps), strikeAbove, spot, strike);
    } else if (strikeAbove) {
      cap = strike + toE6(rand() * (spotF)); // above strike
      if (cap > spot * 2n) cap = spot * 2n;
      if (cap <= strike) cap = strike + 1n;
    } else {
      cap = strike - toE6(rand() * spotF * 0.5); // below strike
      if (cap < spot / 2n) cap = spot / 2n;
      if (cap >= strike) cap = strike - 1n;
    }

    // Only terms the protocol would actually accept.
    const problem = checkTerms({
      structures: {
        open: structures.openEnabled,
        capped: structures.cappedEnabled,
        minCapDistanceBps: structures.minCapDistanceBps,
        maxCapDistanceBps: structures.maxCapDistanceBps,
        openMaxPayoutBps: structures.openMaxPayoutBps,
      } as any,
      structure,
      strikeAbove,
      spot,
      strike,
      cap,
    });
    if (problem) continue;

    const reserve = maxPayout(notional, strike, cap, spot);
    checked++;

    // Sweep settlement prices across the whole plausible range, including far past the cap.
    for (let k = 0; k <= 24; k++) {
      const price = (spot * BigInt(k)) / 12n; // 0 .. 2x spot in 1/12 steps
      const payout = settlementPayout({ notional, spot, strike, cap, strikeAbove, price, maxPayout: reserve });
      assert.ok(
        payout <= reserve,
        `UNBACKED LIABILITY: payout ${payout} > reserve ${reserve} at case ${i} ` +
          `(strikeAbove=${strikeAbove} structure=${structure} spot=${spot} strike=${strike} cap=${cap} price=${price})`,
      );
    }
    // Also probe the exact cap and strike boundaries, where rounding is tightest.
    for (const price of [cap, strike, cap - 1n, cap + 1n, strike - 1n, strike + 1n]) {
      if (price <= 0n) continue;
      const payout = settlementPayout({ notional, spot, strike, cap, strikeAbove, price, maxPayout: reserve });
      assert.ok(payout <= reserve, `UNBACKED LIABILITY at boundary price=${price}, case ${i}`);
    }
  }
  assert.ok(checked > 10_000, `only ${checked} valid cases generated; widen the generator`);
});

/**
 * Is the solvency above load-bearing on the clamp? Pass an effectively infinite
 * maxPayout so the clamp never binds, and compare the RAW economic payout to the
 * reserve. If raw ever exceeds reserve, then on-chain settlement MUST apply the
 * clamp with the purchase-time maxPayout or the pool pays out more than it held.
 */
test("SOLVENCY: raw (unclamped) payout never exceeds reserve — clamp is defence-in-depth, not load-bearing", () => {
  const BIG = (1n << 200n); // clamp cannot bind
  let maxGap = 0n; // how close raw ever gets to exceeding reserve
  for (let i = 0; i < 100_000; i++) {
    const rand = rng(i * 40503 + 7);
    const spotF = 0.5 + rand() * 2000;
    const spot = toE6(spotF);
    const strikeAbove = rand() < 0.5;
    const notional = BigInt(Math.floor(1 + rand() * 2_000_000)) * BigInt(E6);
    let strike = strikeAbove
      ? spot + toE6(rand() * spotF * 0.99)
      : spot - toE6(rand() * spotF * 0.49);
    if (strikeAbove) { if (strike < spot) strike = spot; if (strike >= spot * 2n) strike = spot * 2n - 1n; }
    else { if (strike > spot) strike = spot; if (strike <= spot / 2n) strike = spot / 2n + 1n; }
    const structure: ProtectionStructure = rand() < 0.5 ? "open" : "capped";
    let cap: bigint;
    if (structure === "open") cap = openCap(BigInt(structures.openMaxPayoutBps), strikeAbove, spot, strike);
    else if (strikeAbove) { cap = strike + toE6(rand() * spotF); if (cap > spot * 2n) cap = spot * 2n; if (cap <= strike) cap = strike + 1n; }
    else { cap = strike - toE6(rand() * spotF * 0.5); if (cap < spot / 2n) cap = spot / 2n; if (cap >= strike) cap = strike - 1n; }

    const problem = checkTerms({
      structures: { open: true, capped: true, minCapDistanceBps: 1, maxCapDistanceBps: 10_000, openMaxPayoutBps: 2_000 } as any,
      structure, strikeAbove, spot, strike, cap,
    });
    if (problem) continue;

    const reserve = maxPayout(notional, strike, cap, spot);
    for (let k = 0; k <= 26; k++) {
      const price = (spot * BigInt(k)) / 12n;
      const raw = settlementPayout({ notional, spot, strike, cap, strikeAbove, price, maxPayout: BIG });
      assert.ok(raw <= reserve, `RAW payout ${raw} > reserve ${reserve} at case ${i}, price ${price}`);
      const gap = reserve - raw;
      if (gap > maxGap && raw > 0n) maxGap = gap;
    }
  }
  // If this passes, the economic model itself never under-reserves; the clamp is redundant.
});

