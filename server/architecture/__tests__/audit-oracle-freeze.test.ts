import { test } from "node:test";
import assert from "node:assert/strict";
import { ChainRegistry, type ChainRegistryConfig } from "@shared/chains/registry";
import { AdapterRegistry } from "../../chain";
import { ORACLE_POLICY, newOracleState, runOracleEngine } from "../../domain/oracle-engine";

/**
 * Security audit, 27 October 2026. After a real move beyond the 7% deviation guard the
 * engine never updates its reference price, so every hedge on that pair stays unsettled
 * until the process restarts, and a restart removes the guard entirely.
 */

const config: ChainRegistryConfig = {
  environment: "test", activeLiquidityHub: "stellar",
  chains: [{ key: "stellar", family: "stellar", name: "stellar", networkId: "x", rpcUrls: ["https://rpc.invalid"], explorer: "", state: "ACTIVE",
    contracts: { currencyPool: "pool" }, assets: { USDC: { decimals: 7, addressOrContract: "usdc" } } }],
} as ChainRegistryConfig;

function chain(expiries: number[]) {
  const submitted: number[] = [];
  return {
    submitted,
    listPools: async () => [{ poolId: 1, pair: "USD/NGN", activePositions: expiries.length }],
    listActivePositions: async () => expiries.map((expiry, i) => ({ positionId: i + 1, expiry })),
    getOracleState: async () => ({ resolved: false, consensusPrice: null }),
    submitOraclePrice: async (id: number) => { submitted.push(id); return { state: "CONFIRMED" }; },
    settle: async () => ({ state: "CONFIRMED" }),
  };
}

test("audit: a real devaluation beyond 7% freezes settlement for the pair until restart", async () => {
  const registry = new ChainRegistry(config);
  const clock = { t: 10_000 };
  const price = { v: 1500 };
  const run = (adapter: any, state = engineState) => runOracleEngine({
    chains: registry, adapters: new AdapterRegistry(registry, { stellar: adapter }), signerFor: () => ({ secret: "s" }),
    fetchPrices: async (pairs) => Object.fromEntries(pairs.map((p) => [p, price.v])), now: () => clock.t, log: () => {},
  }, state);
  const engineState = newOracleState();

  await run(chain([5_000])); // reference price 1500 recorded
  price.v = 1650; // +10%: the event the cover exists for
  const later = chain([20_000, 30_000, 40_000]);
  for (let day = 0; day < 7; day++) {
    clock.t += 86_400;
    const r = await run(later);
    assert.equal(r.submitted.length, 0, `day ${day}: nothing is ever submitted`);
    assert.ok(r.skipped.every((s) => s.reason === "deviation guard"));
  }
  // A restart (fresh in-memory state) accepts any price at all: the guard is not a control.
  const afterRestart = await run(later, newOracleState());
  assert.equal(afterRestart.submitted.length, 3);
  assert.ok(ORACLE_POLICY.maxDeviation === 0.07);
});
