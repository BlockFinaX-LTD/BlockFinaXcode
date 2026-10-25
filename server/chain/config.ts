/**
 * Loads the chain registry for this deployment.
 *
 *   BLOCKFINAX_ENV               mainnet (default) or testnet: picks config/chains/<env>.json
 *   BLOCKFINAX_CHAIN_CONFIG      path to a registry file, overriding the above
 *   BLOCKFINAX_LIQUIDITY_HUB     overrides activeLiquidityHub
 *   <KEY>_RPC_URL                comma-separated RPC URLs, e.g. BASE_RPC_URL, STELLAR_TESTNET_RPC_URL
 *   <KEY>_CURRENCY_POOL          currency-pool contract (Diamond on EVM)
 *   <KEY>_POOL_ORACLE            pool oracle contract (Stellar)
 *   <KEY>_STATE                  ACTIVE | DRAINING | ACCESS_ONLY | DISABLED
 *
 * <KEY> is the chain key upper-cased with dashes as underscores. The same build runs
 * any environment; only configuration differs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChainRegistry, type ChainRegistryConfig, type ChainState } from "@shared/chains/registry";

let cached: ChainRegistry | null = null;
let loadError: string | null = null;

const envKey = (key: string) => key.toUpperCase().replace(/-/g, "_");

export function loadRegistryConfig(env: NodeJS.ProcessEnv = process.env): ChainRegistryConfig {
  const path = env.BLOCKFINAX_CHAIN_CONFIG
    || join(process.cwd(), "config", "chains", `${env.BLOCKFINAX_ENV === "testnet" ? "testnet" : "mainnet"}.json`);
  const config = JSON.parse(readFileSync(path, "utf8")) as ChainRegistryConfig;
  if (env.BLOCKFINAX_LIQUIDITY_HUB) config.activeLiquidityHub = env.BLOCKFINAX_LIQUIDITY_HUB;
  for (const chain of config.chains) {
    const k = envKey(chain.key);
    if (env[`${k}_RPC_URL`]) chain.rpcUrls = env[`${k}_RPC_URL`]!.split(",").map((s) => s.trim()).filter(Boolean);
    if (env[`${k}_CURRENCY_POOL`]) chain.contracts.currencyPool = env[`${k}_CURRENCY_POOL`];
    if (env[`${k}_POOL_ORACLE`]) chain.contracts.poolOracle = env[`${k}_POOL_ORACLE`];
    if (env[`${k}_STATE`]) chain.state = env[`${k}_STATE`] as ChainState;
  }
  return config;
}

/** The registry, or null with a reason when this deployment's configuration is incomplete. */
export function chainRegistry(): ChainRegistry | null {
  if (cached || loadError) return cached;
  try {
    cached = new ChainRegistry(loadRegistryConfig());
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    console.warn(`[chains] registry not loaded: ${loadError}. /api/v2 routes will answer 503.`);
  }
  return cached;
}

export function registryLoadError(): string | null {
  return loadError;
}

/** For tests. */
export function setChainRegistry(registry: ChainRegistry | null): void {
  cached = registry;
  loadError = null;
}
