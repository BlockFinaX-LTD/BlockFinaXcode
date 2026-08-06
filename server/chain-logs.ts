/**
 * Historical on-chain log backfill.
 *
 * The traction feed in the data room has to show *every* transaction the
 * protocol has ever processed, each linked to its block-explorer record. Two
 * things make that harder than it sounds:
 *
 *   1. Etherscan's free tier does not cover Base, so the explorer log API is
 *      unavailable — we read logs from the RPC directly.
 *   2. Public Base RPCs cap eth_getLogs at a 10,000-block range, and the
 *      Diamond has ~5.3M blocks of history. That is ~530 requests, far too
 *      slow to run on page load, and the free endpoints rate-limit hard.
 *
 * So the scan runs once in the background and writes into hedge_activity.
 * A cursor row per chain records how far we got, so restarts resume rather
 * than rescan. The API then serves the table, which is instant.
 *
 * Event signatures were recovered by matching keccak hashes against the topic
 * constants used by the client, and the data layouts verified against known
 * pool aggregates (event 1: $10 liquidity / $1 premium; event 5: $50 notional).
 */

import { ethers } from "ethers";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { hedgeActivity } from "@shared/schema";

interface ChainCfg {
  id: number;
  name: string;
  diamond: string;
  rpcs: string[];
  decimals: number;
  /** Max block span this chain's RPCs accept for eth_getLogs. */
  chunk: number;
}

const CHAINS: ChainCfg[] = [
  {
    id: 8453,
    name: "Base",
    diamond: process.env.BASE_DIAMOND_ADDRESS || "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
    rpcs: ["https://mainnet.base.org", "https://base.drpc.org"],
    decimals: 6,
    chunk: 10_000,
  },
  {
    id: 56,
    name: "BSC",
    diamond: process.env.BSC_DIAMOND_ADDRESS || "0xaC939C0897981Abc0711ec4e37527F13106180fc",
    rpcs: ["https://bsc-dataseed.binance.org", "https://bsc.drpc.org"],
    decimals: 18,
    chunk: 5_000,
  },
];

const EVENT_CREATED        = "0x971a52d02f8b95a7a75a0f42d1fb5ab027b59b71c15f1f6095e5323ddd308736";
const LIQUIDITY_DEPOSITED  = "0xbff736a88c4d6fc1bc430cb94a5d36706a0d4b369de04ea80fc121296def3cb2";
const PROTECTION_PURCHASED = "0x4481909ec72817de979b2b76609a83284e6faacdfa26174543ad38431274eed5";

const ALL_TOPICS = [EVENT_CREATED, LIQUIDITY_DEPOSITED, PROTECTION_PURCHASED];

const CONCURRENCY = 6;
const CHUNK_RETRIES = 3;

let running = false;

function topicToAddress(t: string): string {
  return ethers.getAddress("0x" + t.slice(26));
}

function dataWords(data: string): bigint[] {
  const out: bigint[] = [];
  for (let i = 2; i < data.length; i += 64) out.push(BigInt("0x" + data.slice(i, i + 64)));
  return out;
}

async function getProvider(rpcs: string[]): Promise<ethers.JsonRpcProvider> {
  let lastErr: unknown;
  for (const url of rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await p.getBlockNumber();
      return p;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("no working RPC");
}

/** Binary search for the first block at which the Diamond has code. ~26 calls. */
async function findDeploymentBlock(p: ethers.JsonRpcProvider, address: string, latest: number): Promise<number> {
  let lo = 0, hi = latest;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    let code = "0x";
    try {
      code = await p.getCode(address, mid);
    } catch {
      // Node may not serve very old state; treat as "not deployed yet".
    }
    if (code && code !== "0x") hi = mid; else lo = mid + 1;
  }
  return lo;
}

async function getLogsWithRetry(
  p: ethers.JsonRpcProvider, address: string, from: number, to: number
): Promise<ethers.Log[] | null> {
  for (let attempt = 0; attempt < CHUNK_RETRIES; attempt++) {
    try {
      return await p.getLogs({ address, topics: [ALL_TOPICS], fromBlock: from, toBlock: to });
    } catch {
      // Free endpoints rate-limit aggressively; back off and try again.
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return null;
}

/** Decode one log into a hedge_activity row, or null if it isn't one we track. */
function decodeLog(log: ethers.Log, chain: ChainCfg): Record<string, unknown> | null {
  const unit = (v: bigint) => ethers.formatUnits(v, chain.decimals);
  const w = dataWords(log.data);
  const t = log.topics;

  switch (t[0]) {
    case EVENT_CREATED:
      return {
        walletAddress: topicToAddress(t[2]),
        chainId: chain.id,
        txHash: log.transactionHash,
        actionType: "create_event",
        onChainEventId: Number(BigInt(t[1])),
        amount: w[4] !== undefined ? unit(w[4]) : null, // initial liquidity seeded by creator
        token: chain.decimals === 6 ? "USDC" : "USDT",
        blockNumber: log.blockNumber,
        status: "confirmed",
      };

    case LIQUIDITY_DEPOSITED:
      return {
        walletAddress: topicToAddress(t[3]),
        chainId: chain.id,
        txHash: log.transactionHash,
        actionType: "deposit",
        onChainEventId: Number(BigInt(t[1])),
        depositId: Number(BigInt(t[2])),
        amount: w[0] !== undefined ? unit(w[0]) : null,
        token: chain.decimals === 6 ? "USDC" : "USDT",
        blockNumber: log.blockNumber,
        status: "confirmed",
      };

    case PROTECTION_PURCHASED:
      return {
        walletAddress: topicToAddress(t[3]),
        chainId: chain.id,
        txHash: log.transactionHash,
        actionType: "buy_protection",
        onChainEventId: Number(BigInt(t[1])),
        positionId: Number(BigInt(t[2])),
        amount: w[0] !== undefined ? unit(w[0]) : null, // notional covered
        token: chain.decimals === 6 ? "USDC" : "USDT",
        blockNumber: log.blockNumber,
        // premium / platform fee / total cost, kept for the detail view
        metadata: JSON.stringify({
          premium: w[1] !== undefined ? unit(w[1]) : null,
          platformFee: w[2] !== undefined ? unit(w[2]) : null,
          totalCost: w[3] !== undefined ? unit(w[3]) : null,
        }),
        status: "confirmed",
      };

    default:
      return null;
  }
}

async function readCursor(chainId: number): Promise<number | null> {
  const r = await db.execute(
    sql`SELECT last_scanned_block FROM chain_log_cursors WHERE chain_id = ${chainId}`
  );
  const rows = (r as any).rows ?? r;
  return rows?.[0]?.last_scanned_block != null ? Number(rows[0].last_scanned_block) : null;
}

async function writeCursor(chainId: number, block: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO chain_log_cursors (chain_id, last_scanned_block, updated_at)
    VALUES (${chainId}, ${block}, NOW())
    ON CONFLICT (chain_id) DO UPDATE
      SET last_scanned_block = ${block}, updated_at = NOW()
  `);
}

async function scanChain(chain: ChainCfg): Promise<{ chain: string; logs: number; upto: number; complete: boolean }> {
  const p = await getProvider(chain.rpcs);
  const latest = await p.getBlockNumber();

  let from = await readCursor(chain.id);
  if (from == null) {
    from = await findDeploymentBlock(p, chain.diamond, latest);
    console.log(`[ChainLogs:${chain.name}] diamond deployed at block ${from}`);
  } else {
    from = from + 1;
  }

  if (from > latest) return { chain: chain.name, logs: 0, upto: latest, complete: true };

  const ranges: Array<[number, number]> = [];
  for (let b = from; b <= latest; b += chain.chunk) {
    ranges.push([b, Math.min(b + chain.chunk - 1, latest)]);
  }
  console.log(`[ChainLogs:${chain.name}] scanning ${ranges.length} chunk(s) from ${from} to ${latest}`);

  const collected: ethers.Log[] = [];
  // Contiguity matters: the cursor may only advance past a prefix of chunks
  // that all succeeded, otherwise a rate-limited chunk becomes a silent gap.
  let contiguousTo = from - 1;
  let complete = true;

  outer:
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = ranges.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(([f, t]) => getLogsWithRetry(p, chain.diamond, f, t))
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r === null) {
        complete = false;
        console.warn(`[ChainLogs:${chain.name}] chunk ${batch[j][0]}-${batch[j][1]} failed after retries — stopping here, will resume next run`);
        break outer;
      }
      collected.push(...r);
      contiguousTo = batch[j][1];
    }
  }

  if (collected.length > 0) {
    // Block timestamps, one lookup per distinct block rather than per log.
    const blocks = Array.from(new Set(collected.map(l => l.blockNumber)));
    const times = new Map<number, Date>();
    for (let i = 0; i < blocks.length; i += CONCURRENCY) {
      const slice = blocks.slice(i, i + CONCURRENCY);
      const got = await Promise.allSettled(slice.map(b => p.getBlock(b)));
      got.forEach((g, k) => {
        if (g.status === "fulfilled" && g.value) times.set(slice[k], new Date(g.value.timestamp * 1000));
      });
    }

    const rows = collected
      .map(l => {
        const row = decodeLog(l, chain);
        if (!row) return null;
        const ts = times.get(l.blockNumber);
        return ts ? { ...row, createdAt: ts } : row;
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    for (const row of rows) {
      try {
        await db.insert(hedgeActivity).values(row as any).onConflictDoNothing();
      } catch (e) {
        console.warn(`[ChainLogs:${chain.name}] insert failed for ${row.txHash}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  if (contiguousTo >= from) await writeCursor(chain.id, contiguousTo);

  return { chain: chain.name, logs: collected.length, upto: contiguousTo, complete };
}

/**
 * Backfill every configured chain. Safe to call repeatedly — the cursor makes
 * subsequent runs cheap, and inserts are conflict-tolerant.
 */
export async function backfillChainLogs(): Promise<void> {
  if (running) {
    console.log("[ChainLogs] backfill already in progress — skipping");
    return;
  }
  running = true;
  const started = Date.now();
  try {
    for (const chain of CHAINS) {
      try {
        const r = await scanChain(chain);
        console.log(
          `[ChainLogs:${r.chain}] ${r.logs} log(s) written, scanned to block ${r.upto}` +
          (r.complete ? "" : " (incomplete — resumes next run)")
        );
      } catch (e) {
        console.warn(`[ChainLogs:${chain.name}] scan failed:`, e instanceof Error ? e.message : e);
      }
    }
    console.log(`[ChainLogs] backfill finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    running = false;
  }
}

/** True while a backfill is walking the chain — surfaced in the traction API. */
export function isBackfillRunning(): boolean {
  return running;
}
