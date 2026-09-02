/**
 * withdrawals.ts — paying money back out.
 *
 * Two steps on purpose, and they are separated because they fail differently.
 *
 * `requestWithdrawal` debits the balance and records a pending row, inside the
 * account lock. From that moment the money cannot be staked, which is the whole
 * reason to debit before sending rather than after: a balance that is still
 * spendable while a transfer is in flight can be spent twice.
 *
 * `executeWithdrawal` sends the transfer. It can fail, be retried, or be run by
 * hand, and none of that touches the balance again. A failure marks the row and
 * refunds, rather than leaving money that exists in neither place.
 *
 * ## On the treasury key
 *
 * Sending uses TREASURY_POOL_PRIVATE_KEY, the wallet the platform already
 * operates. That key can move everything the treasury holds, which makes it the
 * most valuable secret in the deployment; nothing here reduces that, it only
 * declines to add a second one.
 *
 * Where the key is absent, as it is in the development environment, requests
 * still queue correctly and an operator settles them. That is the honest
 * behaviour for a debited balance: the user is owed the money either way.
 */

import { ethers } from "ethers";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { predictionWithdrawals } from "@shared/schema";
import { credit, spend } from "./ledger";
import { USDC_BASE, baseProvider, treasurySigner } from "./treasury";

const ERC20 = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];

/** Below this the gas costs more than the withdrawal is worth. */
export const MIN_WITHDRAWAL = 5;

export async function requestWithdrawal(args: {
  account: string; amount: number;
}): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
  const { account } = args;
  const amount = Math.round(args.amount * 1e6) / 1e6;

  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "Amount must be greater than zero." };
  if (amount < MIN_WITHDRAWAL) {
    return { ok: false, reason: `The smallest withdrawal is $${MIN_WITHDRAWAL}.` };
  }

  const res = await spend({
    account,
    amount,
    apply: async (tx: any) => {
      const [row] = await tx
        .insert(predictionWithdrawals)
        .values({ account: account.toLowerCase(), amount: String(amount), status: "pending" })
        .returning({ id: predictionWithdrawals.id });
      return {
        entries: [{ kind: "withdrawal", amount: -amount, ref: `withdraw:${row.id}` }],
        result: row.id as number,
      };
    },
  });

  if (!res.ok) {
    return {
      ok: false,
      reason: res.reason === "Not enough balance."
        ? `Not enough balance. You have $${res.balance.toFixed(2)}.`
        : res.reason,
    };
  }
  return { ok: true, id: res.result };
}

/**
 * Send a pending withdrawal on chain.
 *
 * Refuses anything not still `pending`, so a retry after a successful send
 * cannot pay twice. On failure the row is marked and the balance is refunded
 * under a ref derived from the withdrawal id, which makes the refund itself
 * idempotent too.
 */
export async function executeWithdrawal(id: number): Promise<
  { ok: true; txHash: string } | { ok: false; reason: string }
> {
  const [w] = await db.select().from(predictionWithdrawals).where(eq(predictionWithdrawals.id, id)).limit(1);
  if (!w) return { ok: false, reason: "No such withdrawal." };
  if (w.status !== "pending") return { ok: false, reason: `That withdrawal is already ${w.status}.` };

  const amount = Number(w.amount);
  try {
    const provider = await baseProvider();
    if (!provider) return { ok: false, reason: "Could not reach the chain. This will be retried." };
    const wallet = treasurySigner(provider);
    if (!wallet) {
      return { ok: false, reason: "No treasury key is configured here, so this will be sent by hand." };
    }
    const usdc = new ethers.Contract(USDC_BASE, ERC20, wallet);

    const [held, gas] = await Promise.all([
      usdc.balanceOf(wallet.address),
      provider.getBalance(wallet.address),
    ]);
    const wei = ethers.parseUnits(amount.toFixed(6), 6);
    if (held < wei) {
      // Not the user's fault and not permanent. Leave it pending and retry.
      return { ok: false, reason: "The treasury does not currently hold enough to pay this out." };
    }
    /**
     * Gas, checked before the balance is committed to a transaction.
     *
     * A treasury full of USDC and empty of ETH cannot pay anyone, and without
     * this the attempt burns into the catch below, marks the withdrawal failed
     * and refunds, making an operations problem look to the user like their
     * withdrawal was rejected. Leaving it pending is the truthful state.
     */
    if (gas < ethers.parseEther("0.00002")) {
      return { ok: false, reason: "The treasury is low on gas. This will be sent shortly." };
    }

    const tx = await usdc.transfer(w.account, wei);
    await tx.wait();

    await db.update(predictionWithdrawals)
      .set({ status: "sent", txHash: tx.hash, sentAt: new Date() })
      .where(eq(predictionWithdrawals.id, id));
    return { ok: true, txHash: tx.hash };
  } catch (e: any) {
    const msg = e?.shortMessage || e?.message || "transfer failed";
    await db.update(predictionWithdrawals)
      .set({ status: "failed", error: String(msg).slice(0, 400) })
      .where(eq(predictionWithdrawals.id, id));
    // Give the money back. Keyed on the id, so retrying this path refunds once.
    await credit({
      account: w.account, kind: "refund", amount,
      ref: `withdraw-refund:${id}`,
    });
    return { ok: false, reason: `Transfer failed, and your balance has been restored. ${msg}` };
  }
}

export async function withdrawalsFor(account: string) {
  return db.select().from(predictionWithdrawals)
    .where(eq(predictionWithdrawals.account, account.toLowerCase()));
}
