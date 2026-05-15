/**
 * Read helpers — typed contract views via ethers, one cached Contract
 * instance per (chainId, abi) combination. All read endpoints in
 * routes/*.ts call into here so the response shapes are consistent.
 */

import { ethers } from "ethers";
import { providerFor, getChain } from "./chains";
import { HEDGE_FACET_ABI, ORACLE_FACET_ABI, OWNERSHIP_FACET_ABI, LOUPE_FACET_ABI, TIMELOCK_FACET_ABI, ERC20_ABI } from "./abi";

type ContractKey = string;
const _cache = new Map<ContractKey, ethers.Contract>();

function get(chainId: number, address: string, abi: readonly string[], tag: string): ethers.Contract {
  const key = `${chainId}:${address.toLowerCase()}:${tag}`;
  let c = _cache.get(key);
  if (!c) {
    c = new ethers.Contract(address, abi as string[], providerFor(chainId));
    _cache.set(key, c);
  }
  return c;
}

export function hedgeFacet(chainId: number): ethers.Contract {
  return get(chainId, getChain(chainId).diamond, HEDGE_FACET_ABI, "hedge");
}
export function oracleFacet(chainId: number): ethers.Contract {
  return get(chainId, getChain(chainId).diamond, ORACLE_FACET_ABI, "oracle");
}
export function ownershipFacet(chainId: number): ethers.Contract {
  return get(chainId, getChain(chainId).diamond, OWNERSHIP_FACET_ABI, "ownership");
}
export function loupeFacet(chainId: number): ethers.Contract {
  return get(chainId, getChain(chainId).diamond, LOUPE_FACET_ABI, "loupe");
}
export function timelockFacet(chainId: number): ethers.Contract {
  return get(chainId, getChain(chainId).diamond, TIMELOCK_FACET_ABI, "timelock");
}
export function erc20(chainId: number, token: string): ethers.Contract {
  return get(chainId, token, ERC20_ABI, "erc20");
}

/** Serialize any BigInt-bearing object into a JSON-safe one (numbers → decimal strings). */
export function serialize<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialize(v);
    return out;
  }
  return value;
}
