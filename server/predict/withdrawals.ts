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
 * Sending requires a key that can move every deposit held. That is a hot wallet
 * and it is the largest new risk this feature introduces, so it is opt in: with
 * no `PREDICT_TREASURY_PRIVATE_KEY` configured, requests still queue correctly
 * and an operator settles them, rather than the deployment silently gaining the
 * ability to drain itself.
 */

import { ethers } from "ethers";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { predictionWithdrawals } from "@shared/schema";
import { credit, spend } from "./ledger";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
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
  const key = process.env.PREDICT_TREASURY_PRIVATE_KEY;
  if (!key) {
    return { ok: false, reason: "No treasury key is configured, so withdrawals must be sent by hand." };
  }

  const [w] = await db.select().from(predictionWithdrawals).where(eq(predictionWithdrawals.id, id)).limit(1);
  if (!w) return { ok: false, reason: "No such withdrawal." };
  if (w.status !== "pending") return { ok: false, reason: `That withdrawal is already ${w.status}.` };

  const amount = Number(w.amount);
  try {
    const provider = new ethers.JsonRpcProvider("https://mainnet.base.org", 8453, {
      staticNetwork: ethers.Network.from(8453),
    });
    const wallet = new ethers.Wallet(key, provider);
    const usdc = new ethers.Contract(USDC_BASE, ERC20, wallet);

    const held = await usdc.balanceOf(wallet.address);
    const wei = ethers.parseUnits(amount.toFixed(6), 6);
    if (held < wei) {
      // Not the user's fault and not a permanent failure. Leave it pending.
      return { ok: false, reason: "The treasury does not currently hold enough to pay this out." };
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
