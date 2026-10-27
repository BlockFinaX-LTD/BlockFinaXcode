import { test } from "node:test";
import assert from "node:assert/strict";
import { ChainRegistry, type ChainRegistryConfig } from "@shared/chains/registry";
import { AdapterRegistry } from "../../chain";
import { ORACLE_POLICY, newOracleState, runOracleEngine } from "../../domain/oracle-engine";

/**
 * Security audit, 27 October 2026. A real move beyond the 7% deviation guard used to stop
 * every settlement on the pair until the process restarted. Now the move is held back once
 * and accepted when a later poll sees it again; a single bad reading is never used.
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

function harness() {
  const registry = new ChainRegistry(config);
  const clock = { t: 10_000 };
  const price = { v: 1500 };
  const state = newOracleState();
  const run = (adapter: any) => runOracleEngine({
    chains: registry, adapters: new AdapterRegistry(registry, { stellar: adapter }), signerFor: () => ({ secret: "s" }),
    fetchPrices: async (pairs) => Object.fromEntries(pairs.map((p) => [p, price.v])), now: () => clock.t, log: () => {},
  }, state);
  return { clock, price, run };
}

test("audit: a real devaluation beyond 7% settles once a later poll confirms it", async () => {
  const { clock, price, run } = harness();
  await run(chain([5_000])); // reference price 1500
  price.v = 1650; // +10%: the event the cover exists for
  const later = chain([20_000, 30_000, 40_000]);
  clock.t += 86_400;
  const first = await run(later);
  assert.equal(first.submitted.length, 0, "held back on first sight");
  assert.ok(first.skipped.every((s) => s.reason === "deviation guard"));
  clock.t += ORACLE_POLICY.pollSeconds;
  price.v = 1655; // the market is still there, within 1%
  const second = await run(later);
  assert.equal(second.submitted.length, 3, "confirmed move settles every hedge on the pair");
});

test("audit: a single bad reading beyond 7% is never submitted", async () => {
  const { clock, price, run } = harness();
  await run(chain([5_000]));
  const later = chain([20_000]);
  clock.t += 86_400;
  price.v = 3000; // one corrupt response
  assert.equal((await run(later)).submitted.length, 0);
  clock.t += ORACLE_POLICY.pollSeconds;
  price.v = 1510; // back to normal: inside the guard, submitted at the true rate
  const r = await run(later);
  assert.equal(r.submitted.length, 1);
  assert.equal(later.submitted.length, 1);
});
