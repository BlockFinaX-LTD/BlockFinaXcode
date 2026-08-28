/**
 * sigma-star.ts — recover and remember an underwriter's implied volatility.
 *
 * A pool's opening premium is a volatility view. Invert it once and every later
 * quote can be priced against the LP's own judgement rather than the market's.
 *
 * ## Why this module exists rather than a line in the route
 *
 * The inversion needs the pool's ORIGINAL tenor, and the obvious source for it
 * is wrong. `hedge_events.created_at` is `new Date()` at row insert, so it
 * records when chain-sync noticed the pool, not when the pool was created. On
 * Base event 13 that was 22:42:23 against a true 22:30:59, an eleven minute
 * gap on a one day pool.
 *
 * The consequence is worse than the gap suggests. Sigma is sensitive to tenor
 * on short-dated cover, and the same pool priced from a dev mirror and a
 * production mirror returned 43.41% and 29.21%: a 45% difference in the quoted
 * premium, decided by when a background job happened to run. A price that
 * depends on job timing is not a price.
 *
 * So the creation time comes from the chain, and the answer is written back to
 * `hedge_events.implied_vol` so the chain is read once per pool rather than
 * once per quote.
 */

import { ethers } from "ethers";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { hedgeEvents } from "@shared/schema";
import { impliedVolFromPremiumRate } from "./implied-vol";
import { getPairJumpParams } from "./data/jump-params";

/** keccak256("EventCreated(...)"), recovered in server/chain-logs.ts. */
const EVENT_CREATED_TOPIC =
  "0x971a52d02f8b95a7a75a0f42d1fb5ab027b59b71c15f1f6095e5323ddd308736";

const RPCS: Record<number, string[]> = {
  8453: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
  56: ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org"],
};

const DIAMONDS: Record<number, string> = {
  8453: process.env.BASE_DIAMOND_ADDRESS || "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
  56: process.env.BSC_DIAMOND_ADDRESS || "0xaC939C0897981Abc0711ec4e37527F13106180fc",
};

async function anyProvider(chainId: number): Promise<ethers.JsonRpcProvider | null> {
  for (const url of RPCS[chainId] ?? []) {
    try {
      const p = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: ethers.Network.from(chainId) });
      await p.getBlockNumber();
      return p;
    } catch { /* next */ }
  }
  return null;
}

/**
 * When the pool was created, from the chain.
 *
 * Scans back for the pool's own EventCreated log and reads its block time.
 * Bounded: a pool nobody can find within the window is not worth an unbounded
 * search, and the caller degrades to the mirror's timestamp rather than
 * failing. Returns unix seconds.
 */
export async function chainCreationTime(chainId: number, eventId: number): Promise<number | null> {
  const p = await anyProvider(chainId);
  const diamond = DIAMONDS[chainId];
  if (!p || !diamond) return null;

  try {
    const head = await p.getBlockNumber();
    const CHUNK = 9000;
    // Public RPCs cap eth_getLogs ranges, so this walks back in chunks. Twenty
    // covers roughly four days on Base at two second blocks, which is past the
    // longest tenor the product currently sells.
    let from = head;
    for (let i = 0; i < 20 && from > 0; i++) {
      const lo = Math.max(0, from - CHUNK);
      try {
        const logs = await p.getLogs({
          address: diamond,
          topics: [EVENT_CREATED_TOPIC],
          fromBlock: lo,
          toBlock: from,
        });
        for (const l of logs) {
          if (l.topics.length > 1 && Number(BigInt(l.topics[1])) === eventId) {
            const blk = await p.getBlock(l.blockNumber);
            return blk ? Number(blk.timestamp) : null;
          }
        }
      } catch { /* chunk rejected or throttled; keep walking */ }
      from = lo - 1;
    }
  } catch { /* fall through */ }
  return null;
}

export interface SigmaStar {
  sigma: number;
  /** How the tenor behind it was established. */
  tenorSource: "chain" | "mirror";
  originalTenorDays: number;
}

/**
 * The volatility implied by this pool's opening premium, computed once.
 *
 * Reads `implied_vol` first. On a miss it establishes the original tenor from
 * the chain, inverts, and writes the answer back so the next quote is a single
 * row read.
 *
 * Returns null when neither the chain nor the mirror can supply a tenor, which
 * the caller must treat as "no dynamic price for this pool" rather than
 * substituting a guess.
 */
export async function resolveSigmaStar(args: {
  chainId: number;
  eventId: number;
  /** The pool's opening premium, as a fraction. */
  storedRate: number;
  spotAtCreation: number;
  strike: number;
  payoutCap: number;
  strikeAbove: boolean;
  pair: string;
  expiryUnixSeconds: number;
  /** Fallback only, and known to be the row-insert time rather than creation. */
  mirrorCreatedAt?: Date | null;
}): Promise<SigmaStar | null> {
  const { chainId, eventId } = args;

  const [row] = await db
    .select({ impliedVol: hedgeEvents.impliedVol })
    .from(hedgeEvents)
    .where(and(eq(hedgeEvents.chainId, chainId), eq(hedgeEvents.onChainEventId, eventId)))
    .limit(1)
    .catch(() => [] as any);

  const stored = row?.impliedVol == null ? NaN : Number(row.impliedVol);
  if (Number.isFinite(stored) && stored > 0) {
    return { sigma: stored, tenorSource: "chain", originalTenorDays: 0 };
  }

  const createdUnix = await chainCreationTime(chainId, eventId);
  let tenorDays: number | null = null;
  let tenorSource: "chain" | "mirror" = "chain";

  if (createdUnix && args.expiryUnixSeconds > createdUnix) {
    tenorDays = (args.expiryUnixSeconds - createdUnix) / 86400;
  } else if (args.mirrorCreatedAt) {
    // Known to run late by however long chain-sync took to notice the pool.
    // Better than refusing, and flagged so the caller can say so.
    const ms = args.expiryUnixSeconds * 1000 - new Date(args.mirrorCreatedAt).getTime();
    if (ms > 0) { tenorDays = ms / 86_400_000; tenorSource = "mirror"; }
  }
  if (!tenorDays || !(tenorDays > 0)) return null;

  const jump = await getPairJumpParams(args.pair).catch(() => ({
    lambda: 2.0, jumpMean: 0.08, jumpStd: 0.12,
  }));

  const inv = impliedVolFromPremiumRate({
    targetRate: args.storedRate,
    S: args.spotAtCreation,
    strike: args.strike,
    payoutCap: args.payoutCap,
    T: tenorDays / 365.25,
    strikeAbove: args.strikeAbove,
    ...jump,
  });
  if (!inv.ok) return null;

  // Only a chain-derived tenor is worth remembering. Persisting one built on
  // the mirror's clock would freeze the very error this module exists to
  // remove, and it would then look authoritative forever.
  if (tenorSource === "chain") {
    try {
      await db
        .update(hedgeEvents)
        .set({ impliedVol: String(inv.sigma) })
        .where(and(eq(hedgeEvents.chainId, chainId), eq(hedgeEvents.onChainEventId, eventId)));
    } catch { /* the quote is already correct; caching is an optimisation */ }
  }

  return { sigma: inv.sigma, tenorSource, originalTenorDays: tenorDays };
}
