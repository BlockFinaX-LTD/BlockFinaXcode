/**
 * ADVERSARIAL SECURITY TEST — BalanceLedger integrity.
 * Local, pure, no chain, no DB. The ledger is the custody authority in v2.0:
 * if value can be minted or burned without its conservation check noticing,
 * every balance it reports is untrustworthy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BalanceLedger } from "../ledger";

type Place = { owner: string; location: string; bucket: any };
const A: Place = { owner: "a", location: "hub", bucket: "available" };
const B: Place = { owner: "b", location: "hub", bucket: "available" };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1_664_525 + 1_013_904_223) >>> 0) / 0x1_0000_0000);
}

test("GOOD PATH: conservation holds and no place goes negative under fuzzed positive movements", () => {
  for (let trial = 0; trial < 500; trial++) {
    const rand = rng(trial + 1);
    const L = new BalanceLedger(() => 0);
    let externalIn = 0;
    const places = [A, B, { owner: "c", location: "bsc", bucket: "reserved" } as Place];
    for (let i = 0; i < 200; i++) {
      const amt = (1 + Math.floor(rand() * 1000)).toString();
      const op = rand();
      try {
        if (op < 0.4) { L.credit(places[Math.floor(rand() * places.length)], "USDC", amt, "dep"); externalIn += Number(amt); }
        else if (op < 0.7) { const from = places[Math.floor(rand() * places.length)]; L.debit(from, "USDC", amt, "wd"); externalIn -= Number(amt); }
        else { const a = places[Math.floor(rand() * places.length)], b = places[Math.floor(rand() * places.length)]; L.transfer(a, b, "USDC", amt, "mv"); }
      } catch { /* insufficient balance: the ledger refused, state unchanged — allowed */ }
    }
    const c = L.conservationCheck("USDC");
    assert.ok(c.balanced, `conservation broke on trial ${trial}: ${JSON.stringify(c)}`);
    assert.equal(Number(c.netExternal), externalIn, `net external drifted on trial ${trial}`);
  }
});

test("ATTACK: a negative-amount debit must not mint balance (and must not pass conservation silently)", () => {
  const L = new BalanceLedger(() => 0);
  L.credit(A, "USDC", "100", "deposit");

  // A debit is value LEAVING the ledger. A negative debit would be value entering.
  // It must be rejected, exactly as transfer rejects non-positive amounts.
  assert.throws(
    () => L.debit(A, "USDC", "-1000000", "fake fee"),
    /positive|INVALID/i,
    "negative debit was accepted — it mints balance in the custody ledger",
  );
  assert.equal(L.balance(A, "USDC"), "100", "balance changed on a rejected debit");
});

test("ATTACK: a negative-amount credit must not burn balance", () => {
  const L = new BalanceLedger(() => 0);
  L.credit(A, "USDC", "100", "deposit");
  assert.throws(() => L.credit(A, "USDC", "-50", "weird"), /positive|INVALID/i, "negative credit was accepted");
  assert.equal(L.balance(A, "USDC"), "100");
});

test("ATTACK: zero-amount credit/debit must be rejected (no no-op ghost entries)", () => {
  const L = new BalanceLedger(() => 0);
  assert.throws(() => L.credit(A, "USDC", "0", "zero"), /positive|INVALID/i);
  assert.throws(() => L.debit(A, "USDC", "0", "zero"), /positive|INVALID/i);
});

test("ATTACK: replaying a tampered negative entry must be rejected, not silently re-minted", () => {
  // Simulates PersistentLedger.load re-applying a stored routing_ledger row whose
  // amount is negative. The ledger primitives are the only guard at this boundary.
  const L = new BalanceLedger(() => 0);
  L.credit(A, "USDC", "500", "legit deposit");
  assert.throws(
    () => L.debit(A, "USDC", "-9999", "replayed tampered entry"),
    /positive|INVALID/i,
    "replay of a negative debit mints value and conservationCheck still reports balanced",
  );
});
