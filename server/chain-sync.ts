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

const HEDGE_READ_ABI = [
  "function getTotalHedgeEvents() view returns (uint256)",
  "function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, uint8 status, bool poolOpen, bool allowExternalLp, uint256 initialRate, bool strikeAbove)",
  "function getHedgeEventStats(uint256) view returns (uint256 settlementPrice, bool triggered, uint256 settledAt, uint256 creatorEarnings, uint256 totalLiquidity, uint256 totalExposure, uint256 totalPremiums, uint256 hedgerCount, uint256 lpCount, uint256 totalMaxPayout)",
];

const STATUS_MAP: Record<number, string> = { 0: "open", 1: "settled", 2: "expired" };

function formatUnits6(val: bigint): string {
  return parseFloat(ethers.formatUnits(val, 6)).toFixed(6);
}

interface ChainConfig {
  label: string;
  chainId: number;
  diamond: string;
  rpc: string;
}

function getChains(): ChainConfig[] {
  return [
    {
      label: "Lisk",
      chainId: 1135,
      diamond: process.env.DIAMOND_ADDRESS || "0x885E663645173a0791b82f0e6608921D31E3D700",
      rpc: process.env.LISK_RPC_URL || "https://rpc.api.lisk.com",
    },
    {
      label: "Base",
      chainId: 8453,
      diamond: process.env.BASE_DIAMOND_ADDRESS || "0xcC594031d1c059Eb1d6bCb0c7b1c82D31115E6E6",
      rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    },
    {
      label: "BSC",
      chainId: 56,
      diamond: process.env.BSC_DIAMOND_ADDRESS || "0xcC594031d1c059Eb1d6bCb0c7b1c82D31115E6E6",
      rpc: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
    },
  ].filter(c => !!c.diamond);
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
      const contract = new ethers.Contract(chain.diamond, HEDGE_READ_ABI, provider);

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

      for (let i = 1; i <= total; i++) {
        try {
          const core = await contract.getHedgeEventCore(i);
          const onChainId = Number(core.id);
          const status = STATUS_MAP[Number(core.status)] ?? "open";
          const expiryDate = new Date(Number(core.expiryDate) * 1000);
          const strike = formatUnits6(core.strike);
          const premiumRate = formatUnits6(core.premiumRate);

          const { created } = await storage.upsertHedgeEventFromChain(chain.chainId, onChainId, {
            name: core.name || `Event #${onChainId}`,
            description: null,
            underlying: core.underlying,
            strike,
            premiumRate,
            payoutRate: "0.100000",
            safetyFactor: "0.80",
            expiryDate,
            status,
            poolOpen: core.poolOpen,
            allowExternalLp: core.allowExternalLp,
            createdBy: core.creator,
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
