/**
 * chain-sync.ts
 *
 * Reads hedge events directly from each configured blockchain Diamond contract
 * and imports any that are missing from the application database.
 * 
 * Called automatically at server startup and via POST /api/admin/sync-chain-events.
 *
 * Status mapping (from LibAppStorage.HedgeEventStatus):
 *   0 = Open, 1 = Settled, 2 = Expired
 */

import { ethers } from "ethers";
import { storage } from "./storage";

// Diamond ABI — full return type including underlying, initialRate, strikeAbove
const HEDGE_READ_ABI_EXPANDED = [
  "function getTotalHedgeEvents() view returns (uint256)",
  "function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, uint8 status, bool poolOpen, bool allowExternalLp, uint256 initialRate, bool strikeAbove)",
  "function getHedgeEventStats(uint256) view returns (uint256 settlementPrice, bool triggered, uint256 settledAt, uint256 creatorEarnings, uint256 totalLiquidity, uint256 totalExposure, uint256 totalPremiums, uint256 lpCount, uint256 hedgerCount, uint256 totalMaxPayout)",
];

// Base / BSC Diamond ABI — compact format, no underlying/initialRate/strikeAbove fields.
// status enum on Base: 1 = Active/Open, 2 = Settled, 3 = Expired
const HEDGE_READ_ABI_COMPACT = [
  "function getTotalHedgeEvents() view returns (uint256)",
  "function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, uint256 premiumRate, uint256 payoutPercent, uint256 strikePrice, uint256 expiryDate, bool poolOpen, bool allowExternalLp, uint8 status)",
  "function getHedgeEventStats(uint256) view returns (uint256 settlementPrice, bool triggered, uint256 settledAt, uint256 creatorEarnings, uint256 totalLiquidity, uint256 totalExposure, uint256 totalPremiums, uint256 lpCount, uint256 hedgerCount, uint256 totalMaxPayout)",
];

// Base/BSC status map (deployed Diamond): 0=Open, 1=Settled, 2=Expired.
// (Lisk used the same enum but Lisk support has been removed.)
const STATUS_MAP_BASE: Record<number, string> = { 0: "open", 1: "settled", 2: "expired" };

function formatUnits6(val: bigint): string {
  return parseFloat(ethers.formatUnits(val, 6)).toFixed(6);
}

/** Same address on every chain that has it. One call instead of hundreds. */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])",
];

interface ChainConfig {
  label: string;
  chainId: number;
  diamond: string;
  rpc: string;
  abi: string[];
  statusMap: Record<number, string>;
  // Whether the chain supports buyProtection — used to skip upsert of events where
  // the buy function doesn't exist (prevents showing unbuyable events as open).
  supportsBuy: boolean;
  // field name in the compact ABI for the underlying/pair (differs between expanded/compact)
  underlyingField: "underlying" | "name";
}

function getChains(): ChainConfig[] {
  const chains: ChainConfig[] = [
    {
      label: "Base",
      chainId: 8453,
      diamond: process.env.BASE_DIAMOND_ADDRESS || "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
      rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      abi: HEDGE_READ_ABI_EXPANDED,
      statusMap: STATUS_MAP_BASE,
      supportsBuy: true,
      underlyingField: "underlying",
    },
    {
      label: "BSC",
      chainId: 56,
      diamond: process.env.BSC_DIAMOND_ADDRESS || "0xaC939C0897981Abc0711ec4e37527F13106180fc",
      rpc: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
      abi: HEDGE_READ_ABI_EXPANDED,
      statusMap: STATUS_MAP_BASE,
      supportsBuy: true,
      underlyingField: "underlying",
    },
  ];
  return chains.filter(c => !!c.diamond);
}

export interface SyncChainResult {
  chain: string;
  chainId: number;
  totalOnChain: number;
  created: number;
  updated: number;
  errors: string[];
}

export async function syncChainEvents(chainId?: number): Promise<SyncChainResult[]> {
  const chains = getChains().filter(c => chainId === undefined || c.chainId === chainId);
  const results: SyncChainResult[] = [];

  for (const chain of chains) {
    const tag = `[ChainSync:${chain.label}]`;
    const result: SyncChainResult = { chain: chain.label, chainId: chain.chainId, totalOnChain: 0, created: 0, updated: 0, errors: [] };

    try {
      const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
      const contract = new ethers.Contract(chain.diamond, chain.abi, provider);

      let total: number;
      try {
        total = Number(await contract.getTotalHedgeEvents());
      } catch (e: any) {
        result.errors.push(`getTotalHedgeEvents failed: ${e?.message}`);
        console.warn(`${tag} getTotalHedgeEvents unavailable:`, e?.message);
        results.push(result);
        continue;
      }

      result.totalOnChain = total;
      console.log(`${tag} ${total} on-chain event(s) found`);

      /**
       * Read the whole book in one call.
       *
       * This loop used to make two eth_calls per event in sequence. Public RPCs
       * rate limit that, and the throttling lands on the calls made last, which
       * are the highest ids and therefore the newest events. The oracle had the
       * identical bug and it left an expired event unsettled for four days
       * while every cycle reported success.
       *
       * Here the consequence is quieter and lasts longer: the mirror silently
       * stops updating exactly the events people are currently looking at, and
       * the app falls back to stale rows without anything looking wrong.
       */
      const iface = new ethers.Interface(chain.abi);
      const ids = Array.from({ length: total }, (_, k) => k + 1);
      const cores = new Map<number, any>();
      const stats = new Map<number, any>();

      const readAll = async (fn: string, into: Map<number, any>) => {
        try {
          const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider);
          const CHUNK = 100;
          for (let start = 0; start < ids.length; start += CHUNK) {
            const slice = ids.slice(start, start + CHUNK);
            const res: Array<{ success: boolean; returnData: string }> = await mc.aggregate3(
              slice.map(id => ({
                target: chain.diamond,
                allowFailure: true,
                callData: iface.encodeFunctionData(fn, [id]),
              })),
            );
            res.forEach((r, k) => {
              if (!r.success) return;
              try { into.set(slice[k], iface.decodeFunctionResult(fn, r.returnData)); } catch { /* skip */ }
            });
          }
        } catch {
          // No Multicall3 on this chain, or it refused. Spaced reads instead:
          // slow, but not throttled, which is the property that matters.
          for (const id of ids) {
            try { into.set(id, await (contract as any)[fn](id)); } catch { /* skip */ }
            await new Promise(r => setTimeout(r, 200));
          }
        }
      };

      await readAll("getHedgeEventCore", cores);
      // Stats carry the settlement price and time. Never read before, which is
      // why every settled row in the mirror has a null price: the app could say
      // an event had settled but not at what rate, and the rate is the entire
      // basis of what a hedger was paid.
      if (chain.abi.some((f: string) => f.includes("getHedgeEventStats"))) {
        await readAll("getHedgeEventStats", stats);
      }

      const missing = ids.filter(id => !cores.has(id));
      if (missing.length) {
        const msg = `Could not read event(s) ${missing.join(", ")}`;
        result.errors.push(msg);
        console.warn(`${tag} ${msg}`);
      }

      for (const [i, core] of Array.from(cores.entries())) {
        try {
          const onChainId = Number(core.id);
          const status = chain.statusMap[Number(core.status)] ?? "open";
          const expiryDate = new Date(Number(core.expiryDate) * 1000);
          // Compact ABI has strikePrice, expanded has strike
          const strikeRaw: bigint = core.strike ?? core.strikePrice ?? BigInt(0);
          const strike = formatUnits6(strikeRaw);
          const premiumRate = formatUnits6(core.premiumRate);
          // Compact ABI has no separate 'underlying' field — use 'name' as the underlying pair
          const underlying: string = chain.underlyingField === "underlying"
            ? (core.underlying || core.name || `Event #${onChainId}`)
            : (core.name || `Event #${onChainId}`);
          // If this chain doesn't support buyProtection, force poolOpen=false so
          // the UI never shows a "Buy Protection" button for these events.
          const poolOpen = chain.supportsBuy ? Boolean(core.poolOpen) : false;

          const st = stats.get(i);
          const settledSecs = st ? Number(st.settledAt ?? 0) : 0;

          const { created } = await storage.upsertHedgeEventFromChain(chain.chainId, onChainId, {
            name: core.name || `Event #${onChainId}`,
            description: null,
            underlying,
            strike,
            premiumRate,
            payoutRate: "0.100000",
            safetyFactor: "0.80",
            expiryDate,
            status,
            poolOpen,
            allowExternalLp: Boolean(core.allowExternalLp),
            createdBy: core.creator,
            settlementPrice: st && Number(st.settlementPrice ?? 0) > 0
              ? formatUnits6(st.settlementPrice) : null,
            settledAt: settledSecs > 0 ? new Date(settledSecs * 1000) : null,
            triggered: st ? Boolean(st.triggered) : null,
          });

          if (created) {
            result.created++;
            console.log(`${tag} Imported event #${onChainId}: ${core.name} [${status}]`);
          } else {
            result.updated++;
          }
        } catch (e: any) {
          const msg = `Event #${i}: ${e?.message ?? String(e)}`;
          result.errors.push(msg);
          console.error(`${tag} ${msg}`);
        }
      }
    } catch (e: any) {
      const msg = `Chain connection failed: ${e?.message ?? String(e)}`;
      result.errors.push(msg);
      console.error(`${tag} ${msg}`);
    }

    results.push(result);
    console.log(`${tag} Done — created: ${result.created}, updated: ${result.updated}, errors: ${result.errors.length}`);
  }

  return results;
}

export async function startupChainSync(): Promise<void> {
  console.log("[ChainSync] Running startup chain sync...");
  try {
    const results = await syncChainEvents();
    for (const r of results) {
      console.log(`[ChainSync] ${r.chain}: ${r.totalOnChain} on-chain, ${r.created} imported, ${r.updated} updated, ${r.errors.length} error(s)`);
    }
  } catch (e: any) {
    console.error("[ChainSync] Startup sync failed:", e?.message ?? String(e));
  }
}
