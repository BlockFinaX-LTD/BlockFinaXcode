import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { OracleNode } from "../oracle-node";

/**
 * The oracle node's currency-pool settlement loop, against a fake Diamond. Contract-side
 * rules (consensus, cooldown, stale window) are tested in v1protocol; these check that the
 * node finds the right hedges and submits the right things.
 */

interface FakePosition { id: bigint; status: number; expiry: bigint }

function nodeWith(positions: FakePosition[], opts: { failSubmit?: bigint[]; pair?: string } = {}) {
  const node = new OracleNode({
    nodeLabel: "test",
    privateKey: ethers.Wallet.createRandom().privateKey,
    rpcUrl: "http://127.0.0.1:1",
    diamondAddress: ethers.ZeroAddress,
    fetchPrices: async () => ({}),
  });
  const submitted: [bigint, bigint][] = [];
  const read = {
    getCurrencyPoolCount: async () => 1n,
    getCurrencyPool: async () => ({
      underlying: opts.pair ?? "USD/GHS",
      activePositions: BigInt(positions.filter((p) => p.status === 0).length),
    }),
    getPoolPositionCount: async () => BigInt(positions.length),
    getPoolPositions: async (_pool: number, offset: number, limit: number) => positions.slice(offset, offset + limit),
  };
  const write = {
    submitPositionRate: async (id: bigint, price: bigint) => {
      if (opts.failSubmit?.includes(id)) throw Error("Resubmit cooldown");
      submitted.push([id, price]);
      return { wait: async () => undefined };
    },
  };
  (node as any).readContract = read;
  (node as any).writeContract = write;
  (node as any).log = () => {};
  const cycle = (prices: Record<string, number>, now: number) => (node as any).settlePoolPositions(prices, now);
  return { node, submitted, cycle };
}

const NOW = 2_000_000_000;

test("submits for expired active hedges only, with the position id and the pool's pair price", async () => {
  const { submitted, cycle } = nodeWith([
    { id: 1n, status: 0, expiry: BigInt(NOW - 10) },
    { id: 2n, status: 0, expiry: BigInt(NOW + 3600) },
    { id: 3n, status: 1, expiry: BigInt(NOW - 10) },
  ]);
  await cycle({ "USD/GHS": 11.234567 }, NOW);
  assert.deepEqual(submitted, [[1n, 11_234_567n]]);
});

test("does not resubmit inside the 5 minute cooldown, and does after it", async () => {
  const { submitted, cycle } = nodeWith([{ id: 1n, status: 0, expiry: BigInt(NOW - 10) }]);
  await cycle({ "USD/GHS": 11.2 }, NOW);
  await cycle({ "USD/GHS": 11.2 }, NOW + 299);
  assert.equal(submitted.length, 1);
  await cycle({ "USD/GHS": 11.2 }, NOW + 300);
  assert.equal(submitted.length, 2);
});

test("never submits for a settled hedge, so nothing settles twice", async () => {
  const positions = [{ id: 1n, status: 0, expiry: BigInt(NOW - 10) }];
  const { submitted, cycle } = nodeWith(positions);
  await cycle({ "USD/GHS": 11.2 }, NOW);
  positions[0].status = 1;
  await cycle({ "USD/GHS": 11.2 }, NOW + 600);
  assert.equal(submitted.length, 1);
});

test("does not skip eligible hedges behind a failure or across pages", async () => {
  const positions = Array.from({ length: 120 }, (_, i) => ({ id: BigInt(i + 1), status: 0, expiry: BigInt(NOW - 10) }));
  const { submitted, cycle } = nodeWith(positions, { failSubmit: [5n] });
  await cycle({ "USD/GHS": 11.2 }, NOW);
  assert.equal(submitted.length, 119);
});

test("a missing price for the pair submits nothing", async () => {
  const { submitted, cycle } = nodeWith([{ id: 1n, status: 0, expiry: BigInt(NOW - 10) }]);
  await cycle({}, NOW);
  await cycle({ "USD/NGN": 1500 }, NOW);
  assert.equal(submitted.length, 0);
});
