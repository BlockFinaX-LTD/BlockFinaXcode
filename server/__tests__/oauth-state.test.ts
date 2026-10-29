import { test } from "node:test";
import assert from "node:assert/strict";

process.env.GOOGLE_CLIENT_SECRET ||= "test-secret";
const { signOAuthState, readOAuthState } = await import("../auth-routes");

test("a sign-in remembers the site it started on without server memory", () => {
  const s = signOAuthState({ origin: "https://connector.blockfinax.com", popup: false });
  assert.deepEqual(readOAuthState(s), { origin: "https://connector.blockfinax.com", popup: false });
  assert.equal(readOAuthState(signOAuthState({ origin: "https://testnet.blockfinax.com", popup: true }))?.popup, true);
});

test("a changed, forged or expired state is refused", () => {
  const s = signOAuthState({ origin: "https://connector.blockfinax.com", popup: false });
  const [body, sig] = s.split(".");
  const evil = Buffer.from(JSON.stringify({ n: "x", e: Date.now() + 60_000, o: "https://evil.example", p: 0 })).toString("base64url");
  assert.equal(readOAuthState(`${evil}.${sig}`), null);
  assert.equal(readOAuthState(`${body}.AAAA`), null);
  assert.equal(readOAuthState("plain-old-token"), null);
  assert.equal(readOAuthState(s, Date.now() + 11 * 60_000), null);
});
