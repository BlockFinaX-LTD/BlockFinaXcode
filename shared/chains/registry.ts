/**
 * Chain registry (Architecture v2.0).
 *
 * The one place that knows which chains BlockFinaX supports, where their contracts and
 * assets are, and what each chain is currently allowed to do. Product code asks the
 * registry; it never compares chain names or chain ids itself.
 *
 * Exactly one chain is the Liquidity Hub: where canonical underwriting TVL lives and
 * where hedges execute by default. Every other chain is a Funding and Withdrawal Network
 * whose assets are routed to and from the hub. Moving the hub is a controlled migration
 * through chain states, never a runtime flip (docs/architecture/v2/liquidity-hub-v2.0.md).
 */
import { ApplicationError, type Asset, type ChainFamily, type ChainKey } from "../domain/types";

/**
 *   ACTIVE       full product: new pools, hedges, LP deposits, settlement, funding, withdrawals
 *   DRAINING     no new pools, hedges or LP deposits; existing hedges settle, claims and LP
 *                withdrawals continue; users can still fund from and withdraw to it
 *   ACCESS_ONLY  funding and withdrawals only; no execution
 *   DISABLED     nothing
 */
export type ChainState = "ACTIVE" | "DRAINING" | "ACCESS_ONLY" | "DISABLED";

export interface ChainConfig {
  key: ChainKey;
  family: ChainFamily;
  name: string;
  /** EVM chain id, or Stellar network passphrase. */
  networkId: string;
  rpcUrls: string[];
  explorer: string;
  state: ChainState;
  contracts: {
    /** Base: the Diamond. Stellar: the currency-pool contract. */
    currencyPool?: string;
    /** Stellar only: the oracle-consensus instance reserved for pools. */
    poolOracle?: string;
    /**
     * Earlier pool contracts on this chain that still hold hedges or underwriter money.
     * They sell nothing new; their hedges still show, settle and pay, and underwriters can
     * withdraw.
     */
    legacy?: { currencyPool: string; poolOracle?: string }[];
  };
  /** Settlement assets on this chain, by symbol. */
  assets: Record<string, Omit<Asset, "chain" | "symbol">>;
  /** Hedges may execute here although it is not the hub. Off by default to keep TVL in one place. */
  allowSecondaryExecution?: boolean;
  /** Accounts are created on this chain at signup; others are created when first needed. */
  provisionAtSignup?: boolean;
}

export interface ChainRegistryConfig {
  environment: string;
  activeLiquidityHub: ChainKey;
  chains: ChainConfig[];
}

export interface ChainCapabilities {
  newPools: boolean;
  newHedges: boolean;
  lpDeposits: boolean;
  settlement: boolean;
  claims: boolean;
  lpWithdrawals: boolean;
  funding: boolean;
  withdrawals: boolean;
}

const CAPABILITIES: Record<ChainState, ChainCapabilities> = {
  ACTIVE: { newPools: true, newHedges: true, lpDeposits: true, settlement: true, claims: true, lpWithdrawals: true, funding: true, withdrawals: true },
  DRAINING: { newPools: false, newHedges: false, lpDeposits: false, settlement: true, claims: true, lpWithdrawals: true, funding: true, withdrawals: true },
  ACCESS_ONLY: { newPools: false, newHedges: false, lpDeposits: false, settlement: false, claims: false, lpWithdrawals: false, funding: true, withdrawals: true },
  DISABLED: { newPools: false, newHedges: false, lpDeposits: false, settlement: false, claims: false, lpWithdrawals: false, funding: false, withdrawals: false },
};

export class ChainRegistry {
  private readonly byKey: Map<ChainKey, ChainConfig>;

  constructor(public readonly config: ChainRegistryConfig) {
    validateRegistry(config);
    this.byKey = new Map(config.chains.map((c) => [c.key, c]));
  }

  get hub(): ChainConfig {
    return this.get(this.config.activeLiquidityHub);
  }

  get(key: ChainKey): ChainConfig {
    const chain = this.byKey.get(key);
    if (!chain) throw new ApplicationError("CHAIN_NOT_ENABLED", `Unknown chain ${key}`);
    return chain;
  }

  all(): ChainConfig[] {
    return Array.from(this.byKey.values());
  }

  capabilities(key: ChainKey): ChainCapabilities {
    return CAPABILITIES[this.get(key).state];
  }

  fundingNetworks(): ChainConfig[] {
    return this.all().filter((c) => CAPABILITIES[c.state].funding);
  }

  withdrawalNetworks(): ChainConfig[] {
    return this.all().filter((c) => CAPABILITIES[c.state].withdrawals);
  }

  /** Chains that still need settlement work: the hub and anything draining. */
  settlementNetworks(): ChainConfig[] {
    return this.all().filter((c) => CAPABILITIES[c.state].settlement);
  }

  asset(key: ChainKey, symbol: string): Asset {
    const a = this.get(key).assets[symbol];
    if (!a) throw new ApplicationError("INVALID_REQUEST", `${symbol} is not configured on ${key}`);
    return { ...a, symbol, chain: key };
  }

  /**
   * Where a new hedge or pool executes. The hub, unless the caller's own network is
   * explicitly allowed to execute and is ACTIVE.
   */
  executionNetworkFor(preferred?: ChainKey): ChainConfig {
    if (preferred && preferred !== this.hub.key) {
      const c = this.get(preferred);
      if (c.allowSecondaryExecution && c.state === "ACTIVE") return c;
    }
    return this.hub;
  }

  /** Throws the shared error a user should see when an action is not allowed on a chain. */
  require(key: ChainKey, capability: keyof ChainCapabilities): ChainConfig {
    const c = this.get(key);
    if (!CAPABILITIES[c.state][capability]) {
      throw new ApplicationError(c.state === "DRAINING" ? "CHAIN_DRAINING" : "CHAIN_NOT_ENABLED", `${capability} is not available on ${c.name} (${c.state})`);
    }
    return c;
  }

  /** The public part, safe to send to the browser. */
  publicView() {
    return {
      environment: this.config.environment,
      activeLiquidityHub: this.config.activeLiquidityHub,
      chains: this.all().map((c) => ({
        key: c.key, family: c.family, name: c.name, explorer: c.explorer, state: c.state,
        capabilities: CAPABILITIES[c.state],
        assets: Object.entries(c.assets).map(([symbol, a]) => ({ symbol, decimals: a.decimals })),
      })),
    };
  }
}

export function validateRegistry(config: ChainRegistryConfig): void {
  const keys = new Set<string>();
  for (const c of config.chains) {
    if (keys.has(c.key)) throw new Error(`Chain ${c.key} is registered twice`);
    keys.add(c.key);
    if (c.state === "ACTIVE" && c.key !== config.activeLiquidityHub && !c.allowSecondaryExecution) {
      throw new Error(`${c.key} is ACTIVE but is not the liquidity hub; set allowSecondaryExecution or make it ACCESS_ONLY`);
    }
    if ((c.state === "ACTIVE" || c.state === "DRAINING") && !c.contracts.currencyPool) {
      throw new Error(`${c.key} is ${c.state} but has no currency-pool contract configured`);
    }
  }
  const hub = config.chains.find((c) => c.key === config.activeLiquidityHub);
  if (!hub) throw new Error(`Liquidity hub ${config.activeLiquidityHub} is not a registered chain`);
  if (hub.state !== "ACTIVE") throw new Error(`Liquidity hub ${hub.key} must be ACTIVE, is ${hub.state}`);
}

// ── Liquidity hub migration ───────────────────────────────────────────────────

/**
 * Step 1 of moving the hub: the new chain becomes ACTIVE and the hub, the old hub starts
 * DRAINING. Existing hedges stay where they are and settle there. Returns a new config;
 * deploy it like any other configuration change.
 */
export function beginHubMigration(config: ChainRegistryConfig, to: ChainKey): ChainRegistryConfig {
  const from = config.activeLiquidityHub;
  if (from === to) throw new Error(`${to} is already the liquidity hub`);
  const target = config.chains.find((c) => c.key === to);
  if (!target) throw new Error(`${to} is not registered`);
  if (!target.contracts.currencyPool) throw new Error(`${to} has no currency-pool contract deployed`);
  if (target.state === "DISABLED") throw new Error(`${to} is DISABLED; enable it as ACCESS_ONLY first`);
  const next: ChainRegistryConfig = {
    ...config,
    activeLiquidityHub: to,
    chains: config.chains.map((c) =>
      c.key === to ? { ...c, state: "ACTIVE" } : c.key === from ? { ...c, state: "DRAINING" } : c),
  };
  validateRegistry(next);
  return next;
}

/**
 * Step 2: once a draining chain has no active hedges and its free liquidity has been
 * routed to the new hub, it becomes ACCESS_ONLY (still a funding and withdrawal network).
 */
export function completeDrain(
  config: ChainRegistryConfig,
  chain: ChainKey,
  state: { activePositions: number; remainingLiquidity: string },
): ChainRegistryConfig {
  const c = config.chains.find((x) => x.key === chain);
  if (!c || c.state !== "DRAINING") throw new Error(`${chain} is not DRAINING`);
  if (state.activePositions > 0) throw new Error(`${chain} still has ${state.activePositions} active hedges`);
  if (Number(state.remainingLiquidity) > 0) throw new Error(`${chain} still holds ${state.remainingLiquidity} of pool liquidity`);
  const next = { ...config, chains: config.chains.map((x) => (x.key === chain ? { ...x, state: "ACCESS_ONLY" as const } : x)) };
  validateRegistry(next);
  return next;
}
