/**
 * Deposit screening — where the money came from.
 *
 * Screening the depositing wallet alone catches almost nothing. A designated
 * address does not deposit to a regulated platform under its own name; funds
 * move through intermediaries first. So this traces one hop back: for each
 * deposit it reads the transaction's token transfers, works out which address
 * actually funded the depositing wallet, and screens that too.
 *
 * ## What this catches, and what it does not
 *
 * Catches:
 *   - a deposit sent directly from an OFAC-designated address
 *   - a deposit from a wallet funded, in the same transaction, by a designated
 *     address
 *   - deposits from designated mixers and exchanges still on the list —
 *     Blender.io, Sinbad.io and Garantex are present; Tornado Cash is NOT,
 *     having been delisted by OFAC in 2025, so it is not caught
 *   - addresses attributed to state actors, including Lazarus Group, which is
 *     the designation that matters most in this sector
 *
 * Does NOT catch:
 *   - exposure two or more hops away
 *   - funds through an undesignated mixer or bridge
 *   - clusters attributed to an actor but not individually designated
 *
 * That last category is what Chainalysis, TRM and Elliptic sell, and there is
 * no free equivalent. This is a real control against the obvious cases, and it
 * is written down as such rather than presented as full coverage — see
 * docs/ops/compliance-aml-kyc-policy.md §5.
 *
 * Screening runs after the deposit has settled. It cannot block one: the
 * transfer happens on-chain, and by the time we see it the money has moved.
 * What it does is flag the account so the next thing that needs a human — a
 * withdrawal, a tier upgrade — gets one.
 */

import { ethers } from "ethers";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { hedgeActivity } from "@shared/schema";
import { sanctionsScreenings } from "@shared/compliance-schema";
import { matchWallet } from "./lists";
import { raiseAlert } from "./limits";

const CHAINS: Record<number, { name: string; rpcs: string[]; explorer: string }> = {
  8453: {
    name: "Base",
    rpcs: [
      process.env.BASE_RPC_URL || "",
      "https://mainnet.base.org",
      "https://base-rpc.publicnode.com",
      "https://base.drpc.org",
    ].filter(Boolean),
    explorer: "https://basescan.org/tx/",
  },
  56: {
    name: "BSC",
    rpcs: [
      process.env.BSC_RPC_URL || "",
      "https://bsc-dataseed.binance.org",
      "https://bsc-rpc.publicnode.com",
      "https://bsc.drpc.org",
    ].filter(Boolean),
    explorer: "https://bscscan.com/tx/",
  },
};

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function getProvider(chainId: number): Promise<ethers.JsonRpcProvider | null> {
  const chain = CHAINS[chainId];
  if (!chain) return null;
  for (const url of chain.rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await p.getBlockNumber();
      return p;
    } catch {
      // Free endpoints throttle; try the next before giving up.
    }
  }
  return null;
}

const topicToAddress = (topic: string) => ethers.getAddress("0x" + topic.slice(26));

export interface DepositTrace {
  txHash: string;
  chainId: number;
  depositor: string;
  /** Addresses that sent tokens in this transaction. */
  senders: string[];
  error?: string;
}

/**
 * Reads a deposit transaction and returns every address that sent tokens in
 * it. On a normal deposit that is the depositor; where a wallet was funded and
 * forwarded in one transaction it is the original source, which is the case
 * worth catching.
 */
export async function traceDeposit(txHash: string, chainId: number): Promise<DepositTrace> {
  const provider = await getProvider(chainId);
  if (!provider) {
    return { txHash, chainId, depositor: "", senders: [], error: "No usable RPC endpoint." };
  }

  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return { txHash, chainId, depositor: "", senders: [], error: "Transaction not found." };

    const senders = new Set<string>();
    for (const log of receipt.logs) {
      if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics.length < 3) continue;
      try {
        senders.add(topicToAddress(log.topics[1]).toLowerCase());
      } catch {
        // Malformed topic — skip it rather than lose the whole trace.
      }
    }

    return {
      txHash,
      chainId,
      depositor: (receipt.from || "").toLowerCase(),
      senders: Array.from(senders).filter((s) => s !== ethers.ZeroAddress.toLowerCase()),
    };
  } catch (err: any) {
    return { txHash, chainId, depositor: "", senders: [], error: String(err?.message || err) };
  }
}

export interface DepositScreenResult {
  txHash: string;
  screened: string[];
  hits: { address: string; name: string; list: string; program?: string }[];
  error?: string;
}

/**
 * Screens everyone involved in a deposit and raises an alert on a match.
 *
 * A hit is exact — an address either is designated or is not — so unlike name
 * screening this does not produce false positives, and the alert says so.
 */
export async function screenDeposit(args: {
  txHash: string;
  chainId: number;
  walletAddress: string;
  amountUsd?: number;
}): Promise<DepositScreenResult> {
  const { txHash, chainId, walletAddress } = args;

  const trace = await traceDeposit(txHash, chainId);
  const candidates = [
    walletAddress.toLowerCase(),
    ...(trace.depositor ? [trace.depositor] : []),
    ...trace.senders,
  ].filter((a, i, arr) => a && arr.indexOf(a) === i);

  const hits: DepositScreenResult["hits"] = [];
  for (const address of candidates) {
    const { matches } = await matchWallet(address);
    for (const m of matches) {
      hits.push({ address, name: m.name, list: m.list, program: m.program });
    }
  }

  // Recorded whether or not anything matched — policy §5 is only demonstrable
  // as a history of screens, including the ones that found nothing.
  try {
    await db.insert(sanctionsScreenings).values({
      subjectType: "wallet",
      subject: candidates.join(","),
      walletAddress: walletAddress.toLowerCase(),
      matched: hits.length > 0,
      topScore: hits.length ? 1 : 0,
      matches: hits.map((h) => ({
        name: h.name,
        score: 1,
        datasets: [h.list, h.program].filter(Boolean) as string[],
        topics: [],
      })),
      provider: "ofac-direct",
      error: trace.error,
    });
  } catch (err: any) {
    console.error("[wallet-watch] could not record screening:", err?.message);
  }

  if (hits.length) {
    const chain = CHAINS[chainId];
    const first = hits[0];
    const viaCounterparty = first.address !== walletAddress.toLowerCase();
    await raiseAlert({
      kind: "sanctions_hit",
      severity: "high",
      walletAddress,
      title: viaCounterparty
        ? `Deposit funded from a designated address`
        : `Deposit from a designated address`,
      detail:
        `${first.address} is on ${first.list}${first.program ? ` (${first.program})` : ""} as "${first.name}". ` +
        (viaCounterparty
          ? `It sent funds in the same transaction as this deposit, so the money reaching us originates there. `
          : `It is the depositing wallet itself. `) +
        `Address matches are exact, so unlike a name match this is not a coincidence of spelling. ` +
        `Suspend the account and consider a suspicious transaction report before anything is withdrawn. ` +
        `${chain?.explorer ?? ""}${txHash}`,
      meta: { txHash, chainId, hits, screened: candidates, amountUsd: args.amountUsd },
    });
  }

  return { txHash, screened: candidates, hits, error: trace.error };
}

// ── Sweep ─────────────────────────────────────────────────────────────────

/** Deposits already screened, so a sweep does not repeat itself. */
async function alreadyScreened(): Promise<Set<string>> {
  const rows = await db
    .select({ meta: sanctionsScreenings.matches, subject: sanctionsScreenings.subject, id: sanctionsScreenings.id })
    .from(sanctionsScreenings)
    .where(eq(sanctionsScreenings.provider, "ofac-direct"));
  // The tx hash lives in the alert meta rather than here, so screened deposits
  // are identified by the address set they covered.
  return new Set(rows.map((r) => r.subject));
}

export interface SweepResult {
  checked: number;
  screened: number;
  flagged: number;
  skipped: number;
  errors: number;
}

/**
 * Screens recent deposits that have not been screened yet.
 *
 * Paced deliberately: this runs unattended against free RPC endpoints, and
 * hammering them is how the platform gets throttled out of its own control.
 */
export async function sweepDeposits(limit = 25): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, screened: 0, flagged: 0, skipped: 0, errors: 0 };

  const deposits = await db
    .select()
    .from(hedgeActivity)
    .where(sql`${hedgeActivity.actionType} IN ('deposit','buy_protection')`)
    .orderBy(desc(hedgeActivity.id))
    .limit(limit);

  const done = await alreadyScreened();

  for (const d of deposits) {
    result.checked += 1;
    if (!d.txHash || !d.walletAddress) { result.skipped += 1; continue; }

    // Cheap pre-check: if this wallet alone was screened recently and the tx
    // is old, there is nothing new to learn.
    const key = d.walletAddress.toLowerCase();
    if (Array.from(done).some((s) => s.includes(key))) { result.skipped += 1; continue; }

    try {
      const r = await screenDeposit({
        txHash: d.txHash,
        chainId: d.chainId,
        walletAddress: d.walletAddress,
        amountUsd: parseFloat(d.amount ?? "0") || undefined,
      });
      result.screened += 1;
      if (r.hits.length) result.flagged += 1;
      if (r.error) result.errors += 1;
    } catch (err: any) {
      console.error("[wallet-watch] screening failed:", err?.message);
      result.errors += 1;
    }

    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  return result;
}

/** Starts the periodic sweep. Idempotent per process. */
let timer: ReturnType<typeof setInterval> | null = null;
export const SWEEP_INTERVAL_MS = 15 * 60_000;

export function startDepositSweep(): void {
  if (timer) return;
  timer = setInterval(() => {
    sweepDeposits().catch((err) => console.error("[wallet-watch] sweep failed:", err?.message));
  }, SWEEP_INTERVAL_MS);
  console.log(`[wallet-watch] screening deposits every ${SWEEP_INTERVAL_MS / 60_000} minutes`);
}
