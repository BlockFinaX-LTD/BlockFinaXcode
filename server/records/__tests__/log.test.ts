/**
 * The compliance log's hash chain: stable hashing, chaining, and that any edit to an entry
 * or to the order of entries is detectable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, entryHash, hashId } from "../log";
import { keyFacts } from "../key-facts";
import { RETENTION, retentionSummary } from "@shared/records/retention";

const GENESIS = "0".repeat(64);
const a = { at: "2026-11-08T10:00:00.000Z", actor: { type: "user" as const, id: "7" }, action: "complaint.received", subject: { type: "complaint", id: "1" }, data: { category: "pricing" } };
const b = { at: "2026-11-08T10:05:00.000Z", actor: { type: "staff" as const, id: "ops@blockfinax.com" }, action: "complaint.resolved", subject: { type: "complaint", id: "1" }, data: { outcome: "Refunded" } };

/** The same check verifyLog runs over the table. */
function verify(entries: { at: string; actor: any; action: string; subject?: any; data?: unknown; prevHash: string; hash: string }[]) {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.prevHash !== prev || entryHash(prev, e) !== e.hash) return { ok: false, brokenAt: i };
    prev = e.hash;
  }
  return { ok: true };
}
function chain() {
  const h1 = entryHash(GENESIS, a);
  const h2 = entryHash(h1, b);
  return [{ ...a, prevHash: GENESIS, hash: h1 }, { ...b, prevHash: h1, hash: h2 }];
}

test("canonical JSON ignores key order and undefined fields", () => {
  assert.equal(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } }), canonical({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }));
});

test("hashes are stable and depend on the previous entry", () => {
  assert.equal(entryHash(GENESIS, a), entryHash(GENESIS, { ...a, data: { category: "pricing" } }));
  assert.notEqual(entryHash(GENESIS, a), entryHash("1".repeat(64), a));
  assert.match(entryHash(GENESIS, a), /^[0-9a-f]{64}$/);
});

test("an intact chain verifies", () => {
  assert.deepEqual(verify(chain()), { ok: true });
});

test("editing an entry's content is detected at that entry", () => {
  const c = chain();
  c[0] = { ...c[0], data: { category: "service" } };
  assert.deepEqual(verify(c), { ok: false, brokenAt: 0 });
});

test("deleting or reordering entries is detected", () => {
  assert.equal(verify([chain()[1]]).ok, false);
  assert.equal(verify(chain().reverse()).ok, false);
});

test("re-hashing an edited entry still breaks the next link", () => {
  const c = chain();
  const edited = { ...c[0], data: { category: "service" } };
  c[0] = { ...edited, hash: entryHash(GENESIS, edited) };
  assert.deepEqual(verify(c), { ok: false, brokenAt: 1 });
});

test("emails are stored as a stable hash, case and spaces ignored", () => {
  assert.equal(hashId(" Ama@Example.com "), hashId("ama@example.com"));
  assert.equal(hashId("ama@example.com").length, 32);
});

test("key facts state the cost, the most you can lose and the most you can receive", () => {
  const facts = keyFacts({
    pair: "USD/NGN", notional: "10000", tenorDays: 30, structure: "capped", direction: "up", spot: "1348.11",
    strike: "1400", cap: "1500", markupBps: 0, premium: "90", hedgerFee: "4.50", totalCost: "94.50", maxPayout: "666.67",
    pool: { chain: "stellar-testnet", contract: "C", id: "1" }, executionChain: "stellar-testnet",
  } as any, 1_800_000_000).join(" ");
  assert.match(facts, /\$10,000\.00/);
  assert.match(facts, /You pay \$94\.50 now/);
  assert.match(facts, /most you can lose/);
  assert.match(facts, /most you can receive is \$666\.67/);
  assert.match(facts, /rises above 1400/);
  assert.doesNotMatch(facts, /[–—]/, "no dashes in customer text");
});

test("regulated records are kept on a deletion request; profile data is not", () => {
  assert.equal(RETENTION.identity.onRequest, "keep");
  assert.equal(RETENTION.transactions.onRequest, "keep");
  assert.equal(RETENTION.profile.onRequest, "anonymise");
  assert.ok(RETENTION.identity.years >= 5);
  assert.equal(retentionSummary().length, Object.keys(RETENTION).length);
});
