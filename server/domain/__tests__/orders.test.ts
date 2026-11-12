import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeOrderLegs, type HedgeRow } from "../orders";

function row(id: number, orderId: number | undefined, notional: string, status: "active" | "settled" | "claimed", payout = "0"): HedgeRow {
  return {
    pair: "USD/NGN",
    position: {
      ref: { chain: "stellar", contract: "C", id: `position/${id}` }, chain: "stellar", positionId: id, poolId: id, hedger: "G", structure: "capped",
      direction: "up", status, tenorDays: 30, createdAt: 0, expiry: 0, notional, spot: "1500", strike: "1530", cap: "1680",
      fairRateE6: 20_000, premiumRateE6: id === 1 ? 22_000 : 24_000, premium: String(Number(notional) * 0.02), fee: "1", maxPayout: "100", settlementPrice: null, payout,
      ...(orderId ? { orderId } : {}),
    },
    settlement: { position: `stellar:C:position/${id}`, settlementPrice: null, grossPayout: payout, fee: "0", netPayout: payout,
      status: status === "active" ? "pending" : status === "claimed" ? "claimed" : payout === "0" ? "settled_no_payout" : "settled_claimable" },
  };
}

test("an order's legs show as one protection with summed amounts", () => {
  const merged = mergeOrderLegs([row(1, 7, "40000", "active"), row(5, undefined, "1000", "active"), row(2, 7, "60000", "active")], 7);
  assert.equal(merged.length, 2);
  const one = merged[0];
  assert.equal(one.position.legs, 2);
  assert.equal(one.position.notional, "100000");
  assert.equal(one.position.premium, "2000");
  assert.equal(one.position.maxPayout, "200");
  assert.equal(one.position.premiumRateE6, 23_200);
  assert.equal(one.settlement.position, "stellar:C:position/1");
  assert.equal(merged[1].position.positionId, 5);
});

test("an order still running on any leg is running; one with a claimable leg is claimable", () => {
  assert.equal(mergeOrderLegs([row(1, 7, "1", "settled", "5"), row(2, 7, "1", "active")], 7)[0].settlement.status, "pending");
  const m = mergeOrderLegs([row(1, 7, "1", "settled", "5"), row(2, 7, "1", "settled", "3")], 7)[0];
  assert.equal(m.settlement.status, "settled_claimable");
  assert.equal(m.settlement.netPayout, "8");
});
