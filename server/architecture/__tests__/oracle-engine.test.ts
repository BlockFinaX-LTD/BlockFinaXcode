import { test } from "node:test";
import assert from "node:assert/strict";
import { ChainRegistry, beginHubMigration, type ChainRegistryConfig } from "@shared/chains/registry";
import { AdapterRegistry } from "../../chain";
import { ORACLE_POLICY, newOracleState, runOracleEngine } from "../../domain/oracle-engine";

/**
 * One oracle engine serves every settling chain. During a hub migration it keeps
 * settling hedges on the draining chain while it also serves the new hub.
 */

function config(): ChainRegistryConfig {
  const chain = (key: string, family: "evm" | "stellar", state: "ACTIVE" | "ACCESS_ONLY") => ({
    key, family, name: key, networkId: key, rpcUrls: ["https://rpc.invalid"], explorer: "", state,
    contracts: { currencyPool: `${key}-pool` }, assets: { USDC: { decimals: family === "evm" ? 6 : 7, addressOrContract: "usdc" } },
  });
  return { environment: "test", activeLiquidityHub: "base", chains: [chain("base", "evm", "ACTIVE"), chain("stellar", "stellar", "ACCESS_ONLY")] };
}

function fakeChain(expiries: number[]) {
  const calls: string[] = [];
  const resolved = new Set<number>();
  const adapter = {
    calls,
    listPools: async () => [{ poolId: 1, pair: "USD/GHS", activePositions: expiries.length }],
    listActivePositions: async () => expiries.map((expiry, i) => ({ positionId: i + 1, expiry })),
    getOracleState: async (id: number) => ({ resolved: resolved.has(id), consensusPrice: null }),
    submitOraclePrice: async (id: number, price: string) => { calls.push(`submit ${id} ${price}`); resolved.add(id); return { state: "CONFIRMED" }; },
    settle: async (id: number) => { calls.push(`settle ${id}`); return { state: "CONFIRMED" }; },
  };
  return adapter;
}

function deps(registry: ChainRegistry, adapters: Record<string, any>, price: { v: number }, clock: { t: number }) {
  return {
    chains: registry,
    adapters: new AdapterRegistry(registry, adapters),
    signerFor: () => ({ secret: "test" }),
    fetchPrices: async (pairs: string[]) => Object.fromEntries(pairs.map((p) => [p, price.v])),
    now: () => clock.t,
    log: () => {},
  };
}

test("the engine settles expired hedges on the hub and on a draining chain in one poll", async () => {
  const registry = new ChainRegistry(beginHubMigration(config(), "stellar"));
  const base = fakeChain([900, 5000]);
  const stellar = fakeChain([950]);
  const report = await runOracleEngine(deps(registry, { base, stellar }, { v: 12 }, { t: 1000 }), newOracleState());
  assert.deepEqual(report.submitted.sort(), ["base:1", "stellar:1"]);
  assert.deepEqual(report.settled.sort(), ["base:1", "stellar:1"]);
  assert.deepEqual(base.calls, ["submit 1 12.000000", "settle 1"]);
});

test("a chain that no longer settles is not polled", async () => {
  const registry = new ChainRegistry(config());
  const stellar = fakeChain([10]);
  await runOracleEngine(deps(registry, { base: fakeChain([]), stellar }, { v: 12 }, { t: 1000 }), newOracleState());
  assert.deepEqual(stellar.calls, []);
});

test("cooldown and the deviation guard apply the same on every chain", async () => {
  const registry = new ChainRegistry(config());
  const state = newOracleState();
  const clock = { t: 1000 };
  const price = { v: 12 };
  const base = fakeChain([10, 20]);
  base.getOracleState = async () => ({ resolved: false, consensusPrice: null });
  await runOracleEngine(deps(registry, { base }, price, clock), state);

  clock.t += ORACLE_POLICY.cooldownSeconds - 1;
  const cooling = await runOracleEngine(deps(registry, { base }, price, clock), state);
  assert.deepEqual(cooling.skipped.map((s) => s.reason), ["cooldown", "cooldown"]);

  clock.t += ORACLE_POLICY.staleSeconds;
  price.v = 13; // +8.3%, beyond the 7% guard
  const jumped = await runOracleEngine(deps(registry, { base }, price, clock), state);
  assert.deepEqual(jumped.skipped.map((s) => s.reason), ["deviation guard", "deviation guard"]);
  assert.equal(jumped.submitted.length, 0);
});
