import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeBasePool, normalizeBasePosition } from "@shared/currency-pool";

/**
 * The Base mapping must produce exactly the normalized views in
 * parity/vectors/normalized.v1.json. The Stellar wallet server checks its own mapping
 * against the same file, so the app sees one shape from both chains.
 */
const F = JSON.parse(readFileSync(new URL("../../../parity/vectors/normalized.v1.json", import.meta.url), "utf8"));
const units = (s: string, dec: number) => {
  const [w, f = ""] = s.split(".");
  let u = BigInt(1);
  for (let i = 0; i < dec; i++) u *= BigInt(10);
  return BigInt(w) * u + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0");
};
const usd = (s: string) => units(s, 6);
const withoutChain = ({ chain, ...rest }: { chain: string }) => (assert.equal(chain, "base"), rest);

test("Base pool normalizes to the shared view", () => {
  const p = F.pool;
  const pool = {
    id: BigInt(p.id), creator: p.creator, underlying: p.pair, acceptingHedges: p.accepting_hedges, allowExternalLp: p.allow_external_lp,
    openEnabled: p.open_enabled, cappedEnabled: p.capped_enabled, minCapDistanceBps: BigInt(p.min_cap_distance_bps),
    maxCapDistanceBps: BigInt(p.max_cap_distance_bps), openMaxPayoutBps: BigInt(p.open_max_payout_bps),
    hedgerFeeRate: BigInt(p.hedger_fee_rate), payoutFeeRate: BigInt(p.payout_fee_rate), lpProfitFeeRate: BigInt(p.lp_profit_fee_rate),
    creatorLoyaltyRate: BigInt(p.creator_share), creatorEarnings: usd(p.creator_earnings),
    activePositions: BigInt(p.active_positions), latestExpiry: BigInt(p.latest_expiry),
  };
  const tenors = p.tenors.map(([d, a, m]: [number, boolean, number]) => ({ tenorDays: BigInt(d), active: a, markupBps: BigInt(m) }));
  const liq = {
    cash: usd(p.cash), reserved: usd(p.reserved), deferredPremium: usd(p.deferred_premium), nav: usd(p.nav),
    free: usd(p.free), holdback: usd(p.holdback), capacity: usd(p.capacity),
  };
  assert.deepEqual(withoutChain(normalizeBasePool("base", pool, tenors, liq, 6)), F.expect_pool);
});

test("Base hedge normalizes to the shared view", () => {
  const p = F.position;
  const pos = {
    id: BigInt(p.id), poolId: BigInt(p.pool_id), hedger: p.hedger, structure: BigInt(p.structure), strikeAbove: p.strike_above,
    status: BigInt(["active", "settled", "claimed"].indexOf(p.status)), tenorDays: BigInt(p.tenor_days),
    createdAt: BigInt(p.created_at), expiry: BigInt(p.expiry), notional: usd(p.notional),
    spot: units(p.spot, 6), strike: units(p.strike, 6), cap: units(p.cap, 6),
    fairRate: BigInt(p.fair_rate), premiumRate: BigInt(p.premium_rate), premium: usd(p.premium), platformFee: usd(p.fee),
    maxPayout: usd(p.max_payout), settlementPrice: units(p.settlement_price, 6), payout: usd(p.payout),
  };
  assert.deepEqual(withoutChain(normalizeBasePosition("base", pos, 6)), F.expect_position);
});
