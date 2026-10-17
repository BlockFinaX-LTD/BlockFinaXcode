import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { OAuth2Client } from "google-auth-library";
import { registerGoogleAuth, type GoogleClient } from "../server/google-auth.js";

async function fixture(payload: unknown = {
  sub: "google-user", email: "Director@company.example", email_verified: true,
}, exchangeFails = false) {
  const app = express();
  const identities: string[] = [];
  let exchanges = 0;
  const real = new OAuth2Client("test-client", "test-secret",
    "https://wallet.example/api/auth/google/callback");
  const client = {
    generateAuthUrl: real.generateAuthUrl.bind(real),
    getToken: async (code: string) => {
      exchanges++;
      assert.equal(code, "provider-code");
      if (exchangeFails) throw Error("sensitive-provider-response");
      return { tokens: { id_token: "test-id-token" } };
    },
    verifyIdToken: async (input: { idToken: string; audience: string }) => {
      assert.deepEqual(input, { idToken: "test-id-token", audience: "test-client" });
      return { getPayload: () => payload };
    },
  } as unknown as GoogleClient;
  registerGoogleAuth(app, {
    origin: "https://wallet.example", clientId: "test-client", client: () => client,
    limit: (_req, _res, next) => next(),
    findUser: (email) => { identities.push(email); return "platform-user"; },
    login: async (res, id) => { res.cookie("test_session", id); },
  });
  app.use((err: Error, _req: express.Request, res: express.Response,
    _next: express.NextFunction) => { res.status(400).json({ error: err.message }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const start = await fetch(`${base}/api/auth/google`, { redirect: "manual" });
  const url = new URL(start.headers.get("location")!);
  const cookie = start.headers.get("set-cookie")!;
  const state = url.searchParams.get("state")!;
  return {
    identities, start, url, cookie, state, exchanges: () => exchanges,
    callback: (query = `state=${state}&code=provider-code`, suppliedCookie = `bfx_oauth=${state}`) =>
      fetch(`${base}/api/auth/google/callback?${query}`, {
        redirect: "manual", headers: { cookie: suppliedCookie },
      }),
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
      server.closeAllConnections();
    }),
  };
}

test("Google redirect uses the configured client, callback, scopes and secure state cookie", async () => {
  const f = await fixture();
  try {
    assert.equal(f.start.status, 302);
    assert.equal(f.url.hostname, "accounts.google.com");
    assert.equal(f.url.searchParams.get("client_id"), "test-client");
    assert.equal(f.url.searchParams.get("redirect_uri"), "https://wallet.example/api/auth/google/callback");
    assert.equal(f.url.searchParams.get("scope"), "openid email profile");
    assert.ok(f.state.length >= 32);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/api/auth/google"])
      assert.ok(f.cookie.includes(flag));
    assert.ok(!f.url.toString().includes("test-secret"));
  } finally { await f.close(); }
});

test("verified corporate Google email signs in; a callback cannot be replayed", async () => {
  const f = await fixture();
  try {
    const result = await f.callback();
    assert.equal(result.status, 302);
    assert.equal(result.headers.get("location"), "/");
    assert.match(result.headers.get("set-cookie")!, /test_session=platform-user/);
    assert.deepEqual(f.identities, ["director@company.example"]);
    assert.equal((await f.callback()).status, 400);
    assert.equal(f.exchanges(), 1);
  } finally { await f.close(); }
});

test("missing, mismatched and unknown OAuth state cannot exchange a code", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.callback(`state=${f.state}&code=provider-code`, "")).status, 400);
    assert.equal((await f.callback(`state=${"x".repeat(43)}&code=provider-code`)).status, 400);
    assert.equal((await f.callback(`state=${"x".repeat(43)}&code=provider-code`, `bfx_oauth=${"x".repeat(43)}`)).status, 400);
    assert.equal(f.exchanges(), 0);
    assert.deepEqual(f.identities, []);
  } finally { await f.close(); }
});

test("cancelled Google sign-in returns to the wallet and consumes its state", async () => {
  const f = await fixture();
  try {
    const result = await f.callback(`state=${f.state}&error=access_denied`);
    assert.equal(result.headers.get("location"), "/?auth_error=google_cancelled");
    assert.equal((await f.callback()).status, 400);
    assert.equal(f.exchanges(), 0);
    assert.deepEqual(f.identities, []);
  } finally { await f.close(); }
});

test("expired OAuth state cannot exchange a code even with a matching cookie", async () => {
  const f = await fixture();
  const now = Date.now;
  try {
    const started = now();
    Date.now = () => started + 300_001;
    assert.equal((await f.callback()).status, 400);
    assert.equal(f.exchanges(), 0);
    assert.deepEqual(f.identities, []);
  } finally {
    Date.now = now;
    await f.close();
  }
});

test("unverified Google emails and token-exchange failures never create sessions", async () => {
  for (const [payload, fails] of [
    [{ sub: "user", email: "director@company.example", email_verified: false }, false],
    [{ sub: "user", email_verified: true }, false],
    [undefined, true],
  ] as const) {
    const f = await fixture(payload, fails);
    try {
      const result = await f.callback();
      assert.equal(result.headers.get("location"), "/?auth_error=google_failed");
      assert.ok(!result.headers.get("set-cookie")?.includes("test_session"));
      assert.deepEqual(f.identities, []);
      assert.ok(!(await result.text()).includes("sensitive-provider-response"));
    } finally { await f.close(); }
  }
});
