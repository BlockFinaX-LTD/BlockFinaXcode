/**
 * markets.ts — reading and settling prediction markets.
 *
 * The arithmetic lives in parimutuel.ts and is tested without a database. This
 * file is the part that needs one: loading pools, recording stakes, and turning
 * a rate at expiry into payouts.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { predictionMarkets, predictionPositions } from "@shared/schema";
import { getRate } from "../fx-oracle";
import { credit, spend } from "./ledger";
import {
  impliedProbability, resolve, payoutFor, didHappen, type Pools, type Outcome,
} from "./parimutuel";

const num = (v: unknown): number => (v == null ? 0 : Number(v));

export interface MarketView {
  id: number;
  pair: string;
  question: string;
  threshold: number;
  direction: "above" | "below";
  closesAt: Date;
  settlesAt: Date;
  status: string;
  pools: Pools;
  /** Null when one side is empty, which is a market with no price rather than a certainty. */
  impliedYes: number | null;
  settlementRate: number | null;
  outcome: Outcome | null;
}

/** The two pools for one market, summed from its positions. */
export async function poolsFor(marketId: number): Promise<Pools> {
  const rows = await db
    .select({
      side: predictionPositions.side,
      total: sql<string>`coalesce(sum(${predictionPositions.stake}), 0)`,
    })
    .from(predictionPositions)
    .where(eq(predictionPositions.marketId, marketId))
    .groupBy(predictionPositions.side);

  let yes = 0, no = 0;
  rows.forEach((r) => {
    if (r.side === "yes") yes = num(r.total);
    else if (r.side === "no") no = num(r.total);
  });
  return { yes, no };
}

export async function listMarkets(): Promise<MarketView[]> {
  const rows = await db.select().from(predictionMarkets);
  const out: MarketView[] = [];
  for (const m of rows) {
    const pools = await poolsFor(m.id);
    out.push({
      id: m.id,
      pair: m.pair,
      question: m.question,
      threshold: num(m.threshold),
      direction: m.direction === "below" ? "below" : "above",
      closesAt: m.closesAt,
      settlesAt: m.settlesAt,
      status: m.status,
      pools,
      impliedYes: impliedProbability(pools),
      settlementRate: m.settlementRate == null ? null : num(m.settlementRate),
      outcome: (m.outcome as Outcome | null) ?? null,
    });
  }
  // Open markets first, then by the soonest to close.
  return out.sort((a, b) => {
    const rank = (s: string) => (s === "open" ? 0 : s === "closed" ? 1 : 2);
    return rank(a.status) - rank(b.status) || a.closesAt.getTime() - b.closesAt.getTime();
  });
}

/**
 * Record a stake.
 *
 * Refuses after `closesAt` rather than at `settlesAt`. Staking right up to
 * settlement would let someone bet on a rate they can already see, which is not
 * a prediction.
 */
export async function placeStake(args: {
  marketId: number;
  account: string;
  side: "yes" | "no";
  stake: number;
}): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
  const { marketId, account, side, stake } = args;
  if (side !== "yes" && side !== "no") return { ok: false, reason: "Side must be yes or no." };
  if (!Number.isFinite(stake) || stake <= 0) return { ok: false, reason: "Stake must be greater than zero." };
  if (stake < 1) return { ok: false, reason: "The smallest stake is $1." };

  const [m] = await db.select().from(predictionMarkets).where(eq(predictionMarkets.id, marketId)).limit(1);
  if (!m) return { ok: false, reason: "No such market." };
  if (m.status !== "open") return { ok: false, reason: "This market is closed to new stakes." };
  if (m.closesAt.getTime() <= Date.now()) {
    return { ok: false, reason: "Staking on this market has closed." };
  }

  /**
   * The stake and its debit are written together, inside the account lock.
   *
   * Recording the position first and debiting after would leave a window where
   * a position exists that nobody paid for, and a crash in that window makes it
   * permanent. Debiting first leaves the mirror image. Both go in one
   * transaction, or neither does.
   */
  const res = await spend({
    account,
    amount: stake,
    apply: async (tx: any) => {
      const [row] = await tx
        .insert(predictionPositions)
        .values({ marketId, account: account.toLowerCase(), side, stake: String(stake) })
        .returning({ id: predictionPositions.id });
      return {
        entries: [{
          kind: "stake",
          amount: -stake,
          ref: `stake:${row.id}`,
          marketId,
          positionId: row.id,
        }],
        result: row.id as number,
      };
    },
  });

  if (!res.ok) {
    return {
      ok: false,
      reason: res.reason === "Not enough balance."
        ? `Not enough balance. You have $${res.balance.toFixed(2)} and this stake is $${stake.toFixed(2)}.`
        : res.reason,
    };
  }
  return { ok: true, id: res.result };
}

/**
 * Settle every market whose time has come.
 *
 * Reads the rate once per market from the same oracle Cover settles on, so a
 * prediction and a hedge on the same pair can never disagree about where the
 * rate finished.
 *
 * Payouts are written onto the positions here rather than computed on read. The
 * pools move until staking closes, so a payout recomputed later against
 * different totals would not be the one the holder was actually owed.
 */
export async function settleDueMarkets(now = new Date()): Promise<{ settled: number; voided: number }> {
  const due = (await db.select().from(predictionMarkets))
    .filter((m) => m.status !== "settled" && m.status !== "void" && m.settlesAt.getTime() <= now.getTime());

  let settled = 0, voided = 0;
  for (const m of due) {
    const rateRow = await getRate(m.pair).catch(() => null);
    if (!rateRow) continue;  // No rate, no settlement. Try again next run.

    const pools = await poolsFor(m.id);
    const happened = didHappen({
      settlementRate: rateRow.rate,
      threshold: num(m.threshold),
      direction: m.direction === "below" ? "below" : "above",
    });
    const outcome = resolve(pools, happened);

    const positions = await db.select().from(predictionPositions)
      .where(eq(predictionPositions.marketId, m.id));
    for (const p of positions) {
      const pay = payoutFor({
        pools,
        side: p.side === "yes" ? "yes" : "no",
        stake: num(p.stake),
        outcome,
      });
      await db.update(predictionPositions)
        .set({ payout: String(pay.total) })
        .where(eq(predictionPositions.id, p.id));

      /**
       * The money, not just the record.
       *
       * Keyed on the position id, so re-running settlement credits nothing a
       * second time. A losing position pays zero and `credit` ignores it, which
       * keeps the ledger to entries that actually moved something.
       */
      if (pay.total > 0) {
        await credit({
          account: p.account,
          kind: outcome === "void" ? "refund" : "payout",
          amount: pay.total,
          ref: `payout:${p.id}`,
          marketId: m.id,
          positionId: p.id,
        });
      }
    }

    await db.update(predictionMarkets)
      .set({
        status: outcome === "void" ? "void" : "settled",
        settlementRate: String(rateRow.rate),
        outcome,
        settledAt: now,
      })
      .where(eq(predictionMarkets.id, m.id));

    if (outcome === "void") voided++; else settled++;
  }
  return { settled, voided };
}

/** Close markets past their staking deadline but not yet due to settle. */
export async function closeExpiredStaking(now = new Date()): Promise<number> {
  const rows = await db.select().from(predictionMarkets).where(eq(predictionMarkets.status, "open"));
  let n = 0;
  for (const m of rows) {
    if (m.closesAt.getTime() <= now.getTime()) {
      await db.update(predictionMarkets).set({ status: "closed" }).where(eq(predictionMarkets.id, m.id));
      n++;
    }
  }
  return n;
}

export async function positionsFor(account: string) {
  return db.select().from(predictionPositions)
    .where(eq(predictionPositions.account, account.toLowerCase()));
}
