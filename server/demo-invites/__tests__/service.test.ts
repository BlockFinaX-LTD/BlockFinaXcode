import test from "node:test";
import assert from "node:assert/strict";
import { demoInvitesEnabled, hashToken, newToken, parseInvite, stateOf, stillOpen, demoAccessAllowed } from "../service";

test("invitations exist only on a testnet deployment", () => {
  assert.equal(demoInvitesEnabled({ BLOCKFINAX_ENV: "testnet", NETWORK_MODE: "testnet" }), true);
  assert.equal(demoInvitesEnabled({ BLOCKFINAX_ENV: "mainnet", NETWORK_MODE: "mainnet" }), false);
  assert.equal(demoInvitesEnabled({ BLOCKFINAX_ENV: "testnet", NETWORK_MODE: "mainnet" }), false);
  assert.equal(demoInvitesEnabled({}), false);
});

test("a link's secret is long and random, and only its fingerprint is kept", () => {
  const a = newToken(), b = newToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
  assert.equal(hashToken(a).length, 64);
  assert.notEqual(hashToken(a), a);
});

test("admin input is checked", () => {
  assert.deepEqual(parseInvite({ label: "TradingView", days: 30, maxAccounts: 5, fundUsdc: 10000, country: "us" }),
    { label: "TradingView", days: 30, maxAccounts: 5, fundUsdc: 10000, country: "US", note: null });
  assert.throws(() => parseInvite({ label: "x" }));
  assert.throws(() => parseInvite({ label: "Partner", days: 400 }));
  assert.throws(() => parseInvite({ label: "Partner", maxAccounts: 0 }));
  assert.throws(() => parseInvite({ label: "Partner", fundUsdc: 1_000_000 }));
  assert.throws(() => parseInvite({ label: "Partner", country: "USA" }));
});

test("an invitation's state: revoked, then expired, then full, else active", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  const base = { expires_at: "2026-12-26T12:00:00Z", revoked_at: null, max_accounts: 2, used: 0 };
  assert.equal(stateOf(base, now), "active");
  assert.equal(stateOf({ ...base, used: 2 }, now), "full");
  assert.equal(stateOf({ ...base, expires_at: "2026-11-01T00:00:00Z" }, now), "expired");
  assert.equal(stateOf({ ...base, revoked_at: "2026-11-20T00:00:00Z" }, now), "revoked");
  assert.equal(stillOpen("full"), true);
  assert.equal(stillOpen("expired"), false);
});

test("sign-in is never narrowed outside testnet", async () => {
  const saved = { ...process.env };
  process.env.BLOCKFINAX_ENV = "mainnet";
  process.env.NETWORK_MODE = "mainnet";
  const db = { query: async () => { throw new Error("must not be read"); } };
  assert.equal(await demoAccessAllowed(db, 1), true);
  process.env = saved;
});

test("on testnet, a demo account whose invitation ended cannot sign in; others can", async () => {
  const saved = { ...process.env };
  process.env.BLOCKFINAX_ENV = "testnet";
  process.env.NETWORK_MODE = "testnet";
  const rows: Record<number, any[]> = {
    1: [],
    2: [{ expires_at: "2099-01-01T00:00:00Z", revoked_at: null }],
    3: [{ expires_at: "2000-01-01T00:00:00Z", revoked_at: null }],
    4: [{ expires_at: "2099-01-01T00:00:00Z", revoked_at: "2026-11-01T00:00:00Z" }],
  };
  const db = { query: async (sql: string, p?: unknown[]) => ({ rows: /FROM demo_accounts a JOIN/.test(sql) ? rows[Number(p?.[0])] : [] }) };
  assert.equal(await demoAccessAllowed(db, 1), true);
  assert.equal(await demoAccessAllowed(db, 2), true);
  assert.equal(await demoAccessAllowed(db, 3), false);
  assert.equal(await demoAccessAllowed(db, 4), false);
  process.env = saved;
});
