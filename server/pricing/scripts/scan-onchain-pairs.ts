/**
 * scan-onchain-pairs.ts — connect to all deployed Diamonds and report which
 * `underlying` strings are actually used by on-chain hedge events.
 *
 * Output:
 *   - The union of all underlyings across Lisk + Base + BSC
 *   - For each: how many events exist on each chain
 *   - Which are SUPPORTED by the pricing engine registry vs MISSING
 *
 * Use this to discover when a creator opens an event on a pair that the
 * pricing engine doesn't yet know about — that's a signal to add the pair
 * to server/pricing/data/pairs.ts and run the bootstrap.
 *
 * Usage:
 *   npx tsx server/pricing/scripts/scan-onchain-pairs.ts
 */

import "dotenv/config";

import { ethers } from "ethers";
import { SUPPORTED_PAIRS } from "../data/pairs";

const HEDGE_ABI = [
  "function getTotalHedgeEvents() view returns (uint256)",
  "function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, uint8 status, bool poolOpen, bool allowExternalLp, uint256 initialRate, bool strikeAbove)",
];

interface ChainConfig {
  label: string;
  chainId: number;
  diamondAddress: string;
  rpcUrls: string[];
}

const CHAINS: ChainConfig[] = [
  {
    label: "Base",
    chainId: 8453,
    diamondAddress: process.env.BASE_DIAMOND_ADDRESS || "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
    rpcUrls: [process.env.BASE_RPC_URL || "https://mainnet.base.org", "https://base.llamarpc.com"],
  },
  {
    label: "BSC",
    chainId: 56,
    diamondAddress: process.env.BSC_DIAMOND_ADDRESS || "0xaC939C0897981Abc0711ec4e37527F13106180fc",
    rpcUrls: [process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org", "https://bsc.drpc.org"],
  },
];

async function getProvider(rpcUrls: string[]): Promise<ethers.JsonRpcProvider | null> {
  for (const url of rpcUrls) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await p.getBlockNumber();
      return p;
    } catch { continue; }
  }
  return null;
}

interface ChainScanResult {
  chain: string;
  totalEvents: number;
  underlyings: Map<string, number>;   // underlying → event count
  errors: string[];
}

async function scanChain(chain: ChainConfig): Promise<ChainScanResult> {
  const result: ChainScanResult = { chain: chain.label, totalEvents: 0, underlyings: new Map(), errors: [] };

  const provider = await getProvider(chain.rpcUrls);
  if (!provider) {
    result.errors.push("No reachable RPC");
    return result;
  }

  const contract = new ethers.Contract(chain.diamondAddress, HEDGE_ABI, provider);

  // Older deployments may not have getTotalHedgeEvents — scan upward in that case.
  let knownTotal: number | null = null;
  try {
    knownTotal = Number(await contract.getTotalHedgeEvents());
  } catch {
    // fall through to scan mode
  }

  const MAX_SCAN = knownTotal ?? 1000;
  for (let i = 1; i <= MAX_SCAN; i++) {
    try {
      const core = await contract.getHedgeEventCore(i);
      const underlying: string = core.underlying;
      result.totalEvents++;
      result.underlyings.set(underlying, (result.underlyings.get(underlying) ?? 0) + 1);
    } catch {
      if (knownTotal === null) break;   // scan mode: first revert means we're done
      // known-total mode: skip and continue
    }
  }

  return result;
}

async function main() {
  console.log("\n=== On-chain underlying scan ===\n");

  const results = await Promise.all(CHAINS.map(scanChain));

  const allUnderlyings = new Map<string, Map<string, number>>();   // underlying → chain → count

  for (const r of results) {
    console.log(`${r.chain}: ${r.totalEvents} event(s), ${r.underlyings.size} unique underlying(s)`);
    if (r.errors.length > 0) console.log(`   errors: ${r.errors.join(", ")}`);
    Array.from(r.underlyings.entries()).forEach(([u, c]) => {
      if (!allUnderlyings.has(u)) allUnderlyings.set(u, new Map());
      allUnderlyings.get(u)!.set(r.chain, c);
    });
  }

  if (allUnderlyings.size === 0) {
    console.log("\nNo events found on any chain. (Expected if no markets are live yet.)\n");
    return;
  }

  const supportedSet = new Set(SUPPORTED_PAIRS.map(p => p.displayPair));
  console.log("\n── Underlyings in use ──\n");
  console.log("PAIR            CHAINS                  REGISTRY?");
  console.log("─".repeat(60));

  const sorted = Array.from(allUnderlyings.entries()).sort();
  for (const [pair, chainMap] of sorted) {
    const chainStr = Array.from(chainMap.entries()).map(([c, n]) => `${c}(${n})`).join(",");
    const supported = supportedSet.has(pair) ? "OK supported" : "MISSING from pairs.ts";
    console.log(`${pair.padEnd(15)} ${chainStr.padEnd(23)} ${supported}`);
  }

  const missing = sorted.filter(([p]) => !supportedSet.has(p)).map(([p]) => p);
  if (missing.length > 0) {
    console.log(`\n${missing.length} pair(s) need to be added to pairs.ts:`);
    missing.forEach(p => console.log(`   - ${p}`));
  } else {
    console.log("\nAll on-chain underlyings are supported by the pricing engine. ✓");
  }
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Scan failed:", err);
    process.exit(1);
  });
