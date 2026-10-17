import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPoolBuyHash } from "../signer";
import {
  checkTerms,
  costBreakdown,
  maxPayout,
  offerRate,
  openCap,
  toFixed6,
  type PoolStructures,
} from "@shared/currency-pool";

/**
 * The shared maths must agree with BlockFinaXPoolTradeFacet to the last unit, and
 * the signed payload must be byte-for-byte what the contract recovers against. The
 * expected numbers below are the ones asserted in
 * v1protocol/test/unit/currencyPool.test.js.
 */

const structures: PoolStructures = {
  openEnabled: true,
  cappedEnabled: true,
  minCapDistanceBps: 300,
  maxCapDistanceBps: 2000,
  openMaxPayoutBps: 3000,
};
const spot = toFixed6(11.2);
const strike = toFixed6(11.6);

test("payload hash matches the contract test's golden vector", () => {
  const hash = buildPoolBuyHash(
    {
      chainId: 8453,
      diamondAddress: "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
      buyer: "0x1111111111111111111111111111111111111111",
      poolId: 1,
      notional: BigInt(100_000_000_000),
      tenorDays: 7,
      structure: 1,
      strikeAbove: true,
      spot,
      strike,
      cap: toFixed6(12.5),
      fairRate: BigInt(17_500),
    },
    BigInt(1_700_000_000),
    "0x" + "00".repeat(31) + "01",
  );
  assert.equal(hash, "0x3655bb693893f5557789c77c801e04ef04fd6302491f662db6bbee6253f8b9f5");
});

test("offer = fair x markup, fee on premium, rounded down like the contract", () => {
  const c = costBreakdown({ notional: BigInt(100_000_000_000), fairRate: BigInt(17_500), markupBps: BigInt(11_600), hedgerFeeRate: BigInt(5_000) });
  assert.equal(c.premiumRate, BigInt(20_300)); // 1.75% x 1.16 = 2.03%
  assert.equal(c.premium, BigInt(2_030_000_000)); // $2,030
  assert.equal(c.platformFee, BigInt(10_150_000)); // 0.5% of premium
  assert.equal(offerRate(BigInt(15_500), BigInt(11_613)), BigInt(18_000)); // the brief's 1.55% to 1.80%
});

test("Open cap sits at the pool's max payout and never past the settlement band", () => {
  assert.equal(openCap(BigInt(3000), true, spot, strike), strike + (spot * BigInt(3000)) / BigInt(10_000));
  assert.equal(maxPayout(BigInt(100_000_000_000), strike, openCap(BigInt(3000), true, spot, strike), spot), BigInt(30_000_000_000));
  assert.equal(openCap(BigInt(10_000), true, spot, toFixed6(20)), spot * BigInt(2));
  assert.equal(openCap(BigInt(10_000), false, spot, toFixed6(10)), spot / BigInt(2));
});

test("checkTerms returns the contract's own revert reasons", () => {
  const base = { structures, structure: "capped" as const, strikeAbove: true, spot, strike };
  assert.equal(checkTerms({ ...base, cap: toFixed6(12.5) }), null);
  assert.equal(checkTerms({ ...base, cap: toFixed6(11.7) }), "Cap outside the pool's boundaries");
  assert.equal(checkTerms({ ...base, strike: toFixed6(11), cap: toFixed6(12) }), "Strike must be at or above spot, below 2x");
  assert.equal(checkTerms({ ...base, structure: "open", cap: toFixed6(12.5) }), "Open cap mismatch");
  assert.equal(
    checkTerms({ ...base, structures: { ...structures, cappedEnabled: false }, cap: toFixed6(12.5) }),
    "Capped protection not offered",
  );
});

test("toFixed6 truncates like the contract's rate() helper", () => {
  assert.equal(toFixed6(11.2), BigInt(11_200_000));
  assert.equal(toFixed6(11.7315499), BigInt(11_731_549));
});
