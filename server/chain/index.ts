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
