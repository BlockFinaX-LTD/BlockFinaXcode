/**
 * ADVERSARIAL SECURITY TEST — requireSignature middleware.
 * Pure, no DB, no chain. Two claims:
 *   1. On testnet (the live deployment) requireSignature does NO signature check
 *      and trusts the client's X-Wallet-Address header, so any endpoint behind it
 *      runs as any wallet the caller names.
 *   2. On mainnet a valid signed request has no replay protection beyond a 5-minute
 *      window, so the same captured request verifies again and again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { requireSignature, type AuthenticatedRequest } from "../middleware/signature-auth";

function fakeReqRes(init: { method: string; path: string; headers: Record<string, string>; body?: any }) {
  const req = {
    method: init.method,
    path: init.path,
    headers: init.headers,
    body: init.body ?? {},
  } as unknown as AuthenticatedRequest;
  let statusCode = 0;
  let jsonBody: any = null;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(b: any) { jsonBody = b; return this; },
  } as any;
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, get: () => ({ statusCode, jsonBody, nextCalled }) };
}

const VICTIM = "0x1111111111111111111111111111111111111111";

test("ATTACK: on testnet, requireSignature authenticates ANY wallet from a header, no signature", () => {
  const prev = process.env.NETWORK_MODE;
  process.env.NETWORK_MODE = "testnet";
  try {
    const f = fakeReqRes({
      method: "POST",
      path: "/api/predict/withdraw",
      headers: { "x-wallet-address": VICTIM }, // no x-signature, no x-timestamp
      body: { amount: 1000 },
    });
    requireSignature(f.req, f.res, f.next);
    const o = f.get();
    // Secure behaviour would be a 401. This asserts the CURRENT behaviour to prove the hole.
    assert.equal(o.nextCalled, true, "request was allowed through with no signature");
    assert.equal(f.req.walletAddress, VICTIM.toLowerCase(), "caller is authenticated as the victim's wallet via a forged header");
  } finally {
    process.env.NETWORK_MODE = prev;
  }
});

test("CONTROL: on mainnet, a forged header with no signature is rejected (401)", () => {
  const prev = process.env.NETWORK_MODE;
  process.env.NETWORK_MODE = "mainnet";
  try {
    const f = fakeReqRes({
      method: "POST", path: "/api/predict/withdraw",
      headers: { "x-wallet-address": VICTIM }, body: { amount: 1000 },
    });
    requireSignature(f.req, f.res, f.next);
    const o = f.get();
    assert.equal(o.nextCalled, false);
    assert.equal(o.statusCode, 401);
  } finally {
    process.env.NETWORK_MODE = prev;
  }
});

test("ATTACK: on mainnet, a valid signed withdraw request can be REPLAYED within the 5-min window", async () => {
  const prev = process.env.NETWORK_MODE;
  process.env.NETWORK_MODE = "mainnet";
  try {
    const wallet = ethers.Wallet.createRandom();
    const method = "POST";
    const path = "/api/predict/withdraw";
    const timestamp = String(Date.now());
    const body = { amount: 1000 };
    const bodyString = JSON.stringify(body);
    const bodyHash = ethers.keccak256(ethers.toUtf8Bytes(bodyString));
    const message = `${method}:${path}:${timestamp}:${bodyHash}`;
    const signature = await wallet.signMessage(message);
    const headers = {
      "x-wallet-address": wallet.address,
      "x-signature": signature,
      "x-timestamp": timestamp,
    };

    // First use: legitimate.
    const first = fakeReqRes({ method, path, headers, body });
    requireSignature(first.req, first.res, first.next);
    assert.equal(first.get().nextCalled, true, "the genuine request should pass");
    assert.equal(first.req.walletAddress, wallet.address.toLowerCase());

    // Replay: identical captured headers and body, still inside the window.
    const replay = fakeReqRes({ method, path, headers, body });
    requireSignature(replay.req, replay.res, replay.next);
    assert.equal(
      replay.get().nextCalled,
      true,
      "REPLAY ACCEPTED: the same signed request verifies a second time — no nonce or used-signature cache",
    );
  } finally {
    process.env.NETWORK_MODE = prev;
  }
});
