/**
 * deposits.ts — turning an on-chain transfer into balance.
 *
 * The client tells us a transaction hash and nothing else. Everything that
 * decides whether to credit, and how much, is read from the chain:
 *
 *   the transaction succeeded,
 *   it moved the payment token we accept,
 *   it moved it TO the treasury we control,
 *   it came FROM the account being credited,
 *   and the amount is whatever the log says, not whatever was claimed.
 *
 * A caller who could name their own amount could mint balance from a one dollar
 * transfer, so no amount is accepted from the request at all.
 *
 * Receiving needs only the treasury's public address. No private key is read
 * here, and none is needed to take deposits.
 */

import { ethers } from "ethers";
import { credit } from "./ledger";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDT_BASE = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2";

/** Minimum confirmations before a deposit is credited. */
const MIN_CONFIRMATIONS = 3;

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

const RPCS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
];

async function provider(): Promise<ethers.JsonRpcProvider | null> {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url, 8453, { staticNetwork: ethers.Network.from(8453) });
      await p.getBlockNumber();
      return p;
    } catch { /* next */ }
  }
  return null;
}

export function treasuryAddress(): string | null {
  const a = process.env.PREDICT_TREASURY_ADDRESS;
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null;
}

export type DepositResult =
  | { ok: true; amount: number; token: "USDC" | "USDT"; alreadyCredited: boolean }
  | { ok: false; reason: string };

/**
 * Verify a transfer and credit it, at most once.
 *
 * Idempotent through the ledger's unique ref, keyed on the transaction hash, so
 * a user who submits the same hash twice is credited once and told so rather
 * than being shown an error for something that worked.
 */
export async function creditDeposit(args: {
  account: string;
  txHash: string;
}): Promise<DepositResult> {
  const account = args.account.toLowerCase();
  const txHash = args.txHash.toLowerCase();

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, reason: "That is not a transaction hash." };
  const treasury = treasuryAddress();
  if (!treasury) return { ok: false, reason: "Deposits are not configured on this deployment." };

  const p = await provider();
  if (!p) return { ok: false, reason: "Could not reach the chain to check that transaction." };

  const receipt = await p.getTransactionReceipt(txHash).catch(() => null);
  if (!receipt) return { ok: false, reason: "That transaction has not been seen yet. Try again in a moment." };
  if (receipt.status !== 1) return { ok: false, reason: "That transaction failed on chain." };

  const head = await p.getBlockNumber();
  const confirmations = head - receipt.blockNumber + 1;
  if (confirmations < MIN_CONFIRMATIONS) {
    return { ok: false, reason: `Waiting for confirmations (${confirmations} of ${MIN_CONFIRMATIONS}).` };
  }

  // Find a Transfer from this account to the treasury, in an accepted token.
  // The amount comes from the log. Nothing the caller sent is trusted.
  let amount = 0;
  let token: "USDC" | "USDT" | null = null;

  for (const log of receipt.logs) {
    const addr = log.address.toLowerCase();
    const isUsdc = addr === USDC_BASE.toLowerCase();
    const isUsdt = addr === USDT_BASE.toLowerCase();
    if (!isUsdc && !isUsdt) continue;
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;

    const from = ("0x" + log.topics[1].slice(26)).toLowerCase();
    const to = ("0x" + log.topics[2].slice(26)).toLowerCase();
    if (to !== treasury) continue;
    if (from !== account) continue;

    // Both tokens are 6 decimals on Base.
    amount += Number(ethers.formatUnits(BigInt(log.data), 6));
    token = isUsdc ? "USDC" : "USDT";
  }

  if (!token || !(amount > 0)) {
    return {
      ok: false,
      reason: "That transaction did not send USDC or USDT from your wallet to the deposit address.",
    };
  }

  const applied = await credit({
    account, kind: "deposit", amount, ref: `deposit:${txHash}`, txHash,
  });
  return { ok: true, amount, token, alreadyCredited: !applied };
}
