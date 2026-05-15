/**
 * Chain catalogue — every chain BlockFinaX supports, with its Diamond
 * address, USDC/USDT addresses, RPC, block explorer, and token decimals.
 *
 * The integrator API uses this for:
 *   - Building calldata (we tell the caller "send to {diamond}", "value is in USDC with these decimals")
 *   - Reading state via ethers.JsonRpcProvider
 *   - Validating that an inbound `chainId` is supported
 *
 * Add new chains here only — every other file in the package looks them up
 * by chainId via getChain().
 */

import { ethers } from "ethers";
import { errors } from "./errors";

export interface ChainConfig {
  chainId: number;
  name: string;            // human-readable
  symbol: string;          // "LISK" | "BASE" | "BSC"
  rpcUrl: string;
  explorerTxUrl: (hash: string) => string;
  diamond: string;
  usdc: string;
  usdt?: string;           // not all chains have USDT support
  /** Token decimals for the payment token. USDC is 6 on Lisk/Base, USDT on BSC is 18. */
  paymentDecimals: { USDC: number; USDT?: number };
}

const RAW: ChainConfig[] = [
  {
    chainId: 1135,
    name: "Lisk",
    symbol: "LISK",
    rpcUrl: process.env.LISK_RPC_URL || "https://rpc.api.lisk.com",
    explorerTxUrl: (h) => `https://blockscout.lisk.com/tx/${h}`,
    diamond: process.env.LISK_DIAMOND_ADDRESS || "0x69cB5BA093e44B345B617f72a148Ee43c4a18465",
    usdc:    process.env.LISK_USDC_ADDRESS    || "0xF242275d3a6527d877f2c927a82D9b057609cc71",
    paymentDecimals: { USDC: 6 },
  },
  {
    chainId: 8453,
    name: "Base",
    symbol: "BASE",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    explorerTxUrl: (h) => `https://basescan.org/tx/${h}`,
    diamond: process.env.BASE_DIAMOND_ADDRESS || "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
    usdc:    process.env.BASE_USDC_ADDRESS    || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    paymentDecimals: { USDC: 6 },
  },
  {
    chainId: 56,
    name: "BNB Smart Chain",
    symbol: "BSC",
    rpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
    explorerTxUrl: (h) => `https://bscscan.com/tx/${h}`,
    diamond: process.env.BSC_DIAMOND_ADDRESS || "0xaC939C0897981Abc0711ec4e37527F13106180fc",
    usdc:    process.env.BSC_USDC_ADDRESS    || "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    usdt:    process.env.BSC_USDT_ADDRESS    || "0x55d398326f99059fF775485246999027B3197955",
    paymentDecimals: { USDC: 18, USDT: 18 },
  },
];

const BY_ID = new Map(RAW.map((c) => [c.chainId, c]));

export function getChain(chainId: number): ChainConfig {
  const c = BY_ID.get(chainId);
  if (!c) throw errors.validation(`Unsupported chainId ${chainId}. Supported: ${RAW.map(r => r.chainId).join(", ")}`);
  return c;
}

export function listChains(): ChainConfig[] {
  return RAW;
}

// Cached read-only providers per chain. Lazy-built so a misconfigured RPC
// for one chain doesn't crash boot.
const _providers = new Map<number, ethers.JsonRpcProvider>();
export function providerFor(chainId: number): ethers.JsonRpcProvider {
  let p = _providers.get(chainId);
  if (!p) {
    p = new ethers.JsonRpcProvider(getChain(chainId).rpcUrl);
    _providers.set(chainId, p);
  }
  return p;
}
