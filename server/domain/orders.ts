/**
 * One protection bought across several pools is several hedges on chain, one per pool,
 * tied by an order id. The hedger bought one thing, so lists show one: amounts summed,
 * the first leg's reference standing for the whole (claiming it claims every leg).
 */
import type { ProtectionPosition, SettlementResult } from "@shared/domain/types";
import { fromUnits, toUnits } from "@shared/domain/pool-economics";

export interface HedgeRow {
  position: ProtectionPosition & { legs?: number };
  pair: string;
  settlement: SettlementResult;
}

const STATUS_ORDER: SettlementResult["status"][] = ["pending", "settled_claimable", "claimed", "settled_no_payout"];

export function mergeOrderLegs(rows: HedgeRow[], decimals: number): HedgeRow[] {
  const out: HedgeRow[] = [];
  const groups = new Map<string, HedgeRow[]>();
  for (const row of rows) {
    const id = row.position.orderId;
    if (!id) { out.push(row); continue; }
    const key = `${row.position.ref.chain}:${row.position.ref.contract}:${id}`;
    if (!groups.has(key)) { groups.set(key, []); out.push(row); } // keeps the list's order
    groups.get(key)!.push(row);
  }
  return out.map((row) => {
    const legs = row.position.orderId ? groups.get(`${row.position.ref.chain}:${row.position.ref.contract}:${row.position.orderId}`)! : [row];
    if (legs.length === 1) return row;
    const sum = (pick: (r: HedgeRow) => string) => fromUnits(legs.reduce((a, r) => a + toUnits(pick(r), decimals), BigInt(0)), decimals);
    const notional = legs.reduce((a, r) => a + Number(r.position.notional), 0);
    const weighted = (pick: (r: HedgeRow) => number) => Math.round(legs.reduce((a, r) => a + pick(r) * Number(r.position.notional), 0) / notional);
    const statuses = legs.map((r) => r.settlement.status);
    const status = STATUS_ORDER.find((s) => statuses.includes(s))!;
    const positionStatus: ProtectionPosition["status"] = legs.some((r) => r.position.status === "active") ? "active"
      : legs.some((r) => r.position.status === "settled") ? "settled" : "claimed";
    return {
      pair: row.pair,
      position: {
        ...row.position, status: positionStatus, legs: legs.length,
        notional: sum((r) => r.position.notional), premium: sum((r) => r.position.premium), fee: sum((r) => r.position.fee),
        maxPayout: sum((r) => r.position.maxPayout), payout: sum((r) => r.position.payout),
        fairRateE6: weighted((r) => r.position.fairRateE6), premiumRateE6: weighted((r) => r.position.premiumRateE6),
      },
      settlement: {
        ...row.settlement, status,
        grossPayout: sum((r) => r.settlement.grossPayout), fee: sum((r) => r.settlement.fee), netPayout: sum((r) => r.settlement.netPayout),
      },
    };
  });
}
