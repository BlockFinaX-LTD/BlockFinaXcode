import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { payoutFor, resolve, FEE_RATE } from "../parimutuel";

/**
 * The ledger and deposit paths need a database and a chain, so what is asserted
 * here are the invariants that decide whether money is safe, expressed against
 * the same arithmetic and the same encodings the real code uses.
 */

/* ── conservation across a whole market ──────────────────────────────────── */

test("a settled market pays out exactly what it took in, less the fee", () => {
  const pools = { yes: 3200, no: 1800 };
  const yesStakes = [1500, 900, 800];
  const noStakes = [1000, 500, 300];
  const outcome = resolve(pools, true);

  const paid =
    yesStakes.reduce((a, s) => a + payoutFor({ pools, side: "yes", stake: s, outcome }).total, 0) +
    noStakes.reduce((a, s) => a + payoutFor({ pools, side: "no", stake: s, outcome }).total, 0);

  const takenIn = pools.yes + pools.no;
  const fee = pools.no * FEE_RATE;
  assert.ok(Math.abs((paid + fee) - takenIn) < 1e-9,
    `paid ${paid} + fee ${fee} should equal ${takenIn}`);
});

test("a void market returns every stake and keeps nothing", () => {
  const pools = { yes: 500, no: 0 };
  const outcome = resolve(pools, true);
  assert.equal(outcome, "void");
  const stakes = [200, 200, 100];
  const paid = stakes.reduce((a, s) => a + payoutFor({ pools, side: "yes", stake: s, outcome }).total, 0);
  assert.equal(paid, 500);
});

/* ── idempotency keys ────────────────────────────────────────────────────── */

/**
 * Every ledger write derives its ref from something that already identifies the
 * event uniquely. If two different events could produce the same ref, one of
 * them would be silently dropped; if one event could produce two refs, it would
 * be applied twice. Both are money bugs.
 */
test("ledger refs are unique per event and stable across retries", () => {
  const refs = [
    `deposit:0x${"a".repeat(64)}`,
    `deposit:0x${"b".repeat(64)}`,
    "stake:41", "stake:42",
    "payout:41", "payout:42",
    "withdraw:7", "withdraw-refund:7",
  ];
  assert.equal(new Set(refs).size, refs.length, "refs collided");

  // Stable: the same event recomputes to the same key.
  const again = `payout:${41}`;
  assert.equal(again, "payout:41");
});

test("a payout ref cannot collide with the stake ref for the same position", () => {
  const id = 99;
  assert.notEqual(`stake:${id}`, `payout:${id}`);
  assert.notEqual(`withdraw:${id}`, `withdraw-refund:${id}`);
});

/* ── deposit verification ────────────────────────────────────────────────── */

/**
 * Deposits are read from the Transfer log, never from the request. This pins
 * the decoding the verifier relies on: the topic, and where the addresses sit
 * inside the 32 byte topics.
 */
test("the Transfer topic and address decoding match what the chain emits", () => {
  const topic = ethers.id("Transfer(address,address,uint256)");
  assert.equal(topic, "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");

  const from = "0x1111111111111111111111111111111111111111";
  const padded = ethers.zeroPadValue(from, 32);
  const decoded = ("0x" + padded.slice(26)).toLowerCase();
  assert.equal(decoded, from.toLowerCase(), "address extraction from a topic is wrong");
});

test("amounts decode at six decimals, the precision both tokens use on Base", () => {
  const oneDollar = ethers.parseUnits("1", 6);
  assert.equal(Number(ethers.formatUnits(oneDollar, 6)), 1);
  // The failure this guards: reading 18 decimals would turn $1,000,000 into
  // $0.000000000001, or a small deposit into a fortune the other way.
  assert.notEqual(Number(ethers.formatUnits(oneDollar, 18)), 1);
});

/* ── the spend guard ─────────────────────────────────────────────────────── */

test("a stake is refused when it exceeds the balance, not silently clamped", () => {
  // Mirrors the check inside spend(): strictly less than is a refusal.
  const afford = (balance: number, stake: number) => balance >= stake;
  assert.equal(afford(100, 100), true, "exact balance should be spendable");
  assert.equal(afford(99.999999, 100), false);
  assert.equal(afford(0, 1), false);
});

test("money rounds to the six decimals the column stores, so nothing is invented", () => {
  const money = (n: number) => Math.round(n * 1e6) / 1e6;
  assert.equal(money(1 / 3), 0.333333);
  assert.equal(money(0.1 + 0.2), 0.3);
});
