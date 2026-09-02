/**
 * ledger.ts — the money.
 *
 * Every movement is a row. Balance is the sum, never a stored column, so an
 * account's total can always be explained by the entries that produced it.
 *
 * Two rules run through everything here:
 *
 *   Idempotency. Each write derives a `ref` from something that already
 *   identifies the event exactly, and `ref` is unique in the database. Replaying
 *   a deposit, re-running settlement or double-clicking withdraw cannot pay
 *   twice, and the guarantee is enforced by the schema rather than by callers
 *   remembering to check.
 *
 *   Serialisation. Anything that spends money takes a row lock on the account
 *   first. Balance is derived, so without a row to lock two concurrent stakes
 *   both read the same balance, both pass the check, and the account spends
 *   money it does not have.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { predictionLedger, predictionAccounts } from "@shared/schema";

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/** Rounded to cents, the precision the ledger column actually stores. */
const money = (n: number): number => Math.round(n * 1e6) / 1e6;

export async function balanceOf(account: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${predictionLedger.amount}), 0)` })
    .from(predictionLedger)
    .where(eq(predictionLedger.account, account.toLowerCase()));
  return money(num(row?.total));
}

export async function entriesFor(account: string) {
  return db.select().from(predictionLedger)
    .where(eq(predictionLedger.account, account.toLowerCase()));
}

/**
 * Credit an account, at most once for a given ref.
 *
 * Returns `false` when the ref already exists, which is the normal path for a
 * retry rather than an error. Callers that care can compare.
 */
export async function credit(args: {
  account: string; kind: string; amount: number; ref: string;
  marketId?: number; positionId?: number; txHash?: string;
}): Promise<boolean> {
  if (!(args.amount > 0)) return false;
  try {
    await db.insert(predictionLedger).values({
      account: args.account.toLowerCase(),
      kind: args.kind,
      amount: String(money(args.amount)),
      ref: args.ref,
      marketId: args.marketId ?? null,
      positionId: args.positionId ?? null,
      txHash: args.txHash ?? null,
    });
    return true;
  } catch (e: any) {
    // Unique violation on ref: already applied. Any other error is real.
    if (String(e?.code) === "23505" || /duplicate key|unique/i.test(String(e?.message))) return false;
    throw e;
  }
}

/**
 * Spend from an account, inside a transaction that holds the account lock.
 *
 * `apply` runs with the balance already checked and the account locked, so
 * anything it does is serialised against other spends by the same account. It
 * returns the ledger rows to write; returning an empty array aborts the spend
 * without an error, which is how a caller declines after seeing the balance.
 */
export async function spend<T>(args: {
  account: string;
  amount: number;
  apply: (tx: any, balance: number) => Promise<{ entries: Array<{ kind: string; amount: number; ref: string; marketId?: number; positionId?: number }>; result: T }>;
}): Promise<{ ok: true; result: T } | { ok: false; reason: string; balance: number }> {
  const account = args.account.toLowerCase();

  return db.transaction(async (tx: any) => {
    // The row exists only to be locked. Created on first touch.
    await tx.insert(predictionAccounts).values({ account }).onConflictDoNothing();
    await tx.execute(sql`select 1 from prediction_accounts where account = ${account} for update`);

    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${predictionLedger.amount}), 0)` })
      .from(predictionLedger)
      .where(eq(predictionLedger.account, account));
    const balance = money(num(row?.total));

    if (balance < args.amount) {
      return { ok: false as const, reason: "Not enough balance.", balance };
    }

    const { entries, result } = await args.apply(tx, balance);
    if (!entries.length) {
      return { ok: false as const, reason: "Nothing to apply.", balance };
    }
    for (const e of entries) {
      await tx.insert(predictionLedger).values({
        account,
        kind: e.kind,
        amount: String(money(e.amount)),
        ref: e.ref,
        marketId: e.marketId ?? null,
        positionId: e.positionId ?? null,
      });
    }
    return { ok: true as const, result };
  });
}
