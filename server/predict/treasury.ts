/**
 * treasury.ts — the one place the treasury is defined.
 *
 * The deposit address is DERIVED from the signing key rather than configured
 * beside it. Two separate settings can disagree, and the way they disagree is
 * the worst one available: deposits routed to an address whose key nobody
 * holds, which looks like it is working right up until the first withdrawal.
 * Deriving it makes that impossible to express.
 *
 * `PREDICT_TREASURY_ADDRESS` is still honoured as an override, for a deployment
 * that receives into a Safe and pays out from a hot wallet. When it is set and
 * disagrees with the key, that is a deliberate split rather than a mistake, so
 * it is allowed but reported.
 */

import { ethers } from "ethers";

const RPCS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
];

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDT_BASE = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2";

/** Normalises a key given with or without the 0x prefix. */
function normalisedKey(): string | null {
  const raw = process.env.TREASURY_POOL_PRIVATE_KEY;
  if (!raw || !raw.trim()) return null;
  const k = raw.trim();
  const withPrefix = k.startsWith("0x") ? k : "0x" + k;
  return /^0x[0-9a-fA-F]{64}$/.test(withPrefix) ? withPrefix : null;
}

/** The wallet that can send. Null when no usable key is configured. */
export function treasurySigner(provider: ethers.Provider): ethers.Wallet | null {
  const k = normalisedKey();
  if (!k) return null;
  try { return new ethers.Wallet(k, provider); } catch { return null; }
}

/**
 * Where deposits should be sent, lowercased.
 *
 * Prefers the explicit override; otherwise the address of the signing key.
 */
export function treasuryAddress(): string | null {
  const override = process.env.PREDICT_TREASURY_ADDRESS;
  if (override && /^0x[0-9a-fA-F]{40}$/.test(override)) return override.toLowerCase();
  const k = normalisedKey();
  if (!k) return null;
  try { return new ethers.Wallet(k).address.toLowerCase(); } catch { return null; }
}

export async function baseProvider(): Promise<ethers.JsonRpcProvider | null> {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url, 8453, { staticNetwork: ethers.Network.from(8453) });
      await p.getBlockNumber();
      return p;
    } catch { /* next */ }
  }
  return null;
}

/**
 * What the treasury can actually honour right now.
 *
 * Gas is included because a treasury holding plenty of USDC and no ETH cannot
 * pay anybody, and that failure is invisible until someone tries to withdraw.
 */
export async function treasuryStatus(): Promise<{
  address: string | null; canSend: boolean; usdc: number; eth: number; lowGas: boolean;
}> {
  const address = treasuryAddress();
  const p = await baseProvider();
  if (!address || !p) return { address, canSend: false, usdc: 0, eth: 0, lowGas: true };

  const usdcC = new ethers.Contract(USDC_BASE, ["function balanceOf(address) view returns (uint256)"], p);
  const [ethWei, usdcRaw] = await Promise.all([p.getBalance(address), usdcC.balanceOf(address)]);
  const eth = Number(ethers.formatEther(ethWei));
  return {
    address,
    canSend: normalisedKey() !== null,
    usdc: Number(ethers.formatUnits(usdcRaw, 6)),
    eth,
    // Roughly a few dozen ERC-20 transfers on Base. Below this, withdrawals
    // will start failing for gas rather than for anything the user did.
    lowGas: eth < 0.0005,
  };
}
