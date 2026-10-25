/**
 * Resolves the adapter for a registered chain. The only place that branches on chain
 * family; product code asks for `adapterFor(key)` and never checks which chain it got.
 */
import type { ChainRegistry } from "@shared/chains/registry";
import { ApplicationError, type ChainKey } from "@shared/domain/types";
import type { ChainAdapter } from "./adapter";
import { EvmAdapter } from "./evm-adapter";
import { StellarAdapter } from "./stellar-adapter";

const FAMILIES = {
  evm: (c: ConstructorParameters<typeof EvmAdapter>[0]) => new EvmAdapter(c),
  stellar: (c: ConstructorParameters<typeof StellarAdapter>[0]) => new StellarAdapter(c),
} as const;

export class AdapterRegistry {
  private cache = new Map<ChainKey, ChainAdapter>();

  constructor(readonly chains: ChainRegistry, private readonly overrides: Partial<Record<ChainKey, ChainAdapter>> = {}) {}

  private legacyCache = new Map<string, ChainAdapter>();

  /** The adapter for a contract on a chain: the current one, or a legacy contract's. */
  adapterForContract(key: ChainKey, contract?: string): ChainAdapter {
    const chain = this.chains.get(key);
    if (!contract || contract === chain.contracts.currencyPool || chain.family !== "stellar") return this.adapterFor(key);
    const old = chain.contracts.legacy?.find((l) => l.currencyPool === contract);
    if (!old) throw new ApplicationError("POOL_NOT_FOUND", `Unknown pool contract ${contract} on ${chain.name}`);
    const cacheKey = `${key}:${contract}`;
    const hit = this.legacyCache.get(cacheKey);
    if (hit) return hit;
    const adapter = new StellarAdapter({ ...chain, contracts: { currencyPool: old.currencyPool, poolOracle: old.poolOracle } }, process.env, true);
    this.legacyCache.set(cacheKey, adapter);
    return adapter;
  }

  /** The current adapter first, then one per legacy contract. */
  adaptersFor(key: ChainKey): ChainAdapter[] {
    const chain = this.chains.get(key);
    return [this.adapterFor(key), ...(chain.contracts.legacy ?? []).map((l) => this.adapterForContract(key, l.currencyPool))];
  }

  adapterFor(key: ChainKey): ChainAdapter {
    const override = this.overrides[key];
    if (override) return override;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const chain = this.chains.get(key);
    if (chain.state === "DISABLED") throw new ApplicationError("CHAIN_NOT_ENABLED", `${chain.name} is disabled`);
    const adapter = FAMILIES[chain.family](chain);
    this.cache.set(key, adapter);
    return adapter;
  }
}

export type { ChainAdapter, PreparedTransaction } from "./adapter";
