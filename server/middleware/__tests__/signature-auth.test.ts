import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { requireSignature } from "../signature-auth";

/** Security audit, 27 October 2026: the wallet header alone must never authenticate. */

function call(headers: Record<string, string>, body: unknown = { amount: 5 }) {
  let status = 200;
  let passed = false;
  const req: any = { headers, body, method: "POST", path: "/api/predict/withdraw" };
  const res: any = { status(s: number) { status = s; return this; }, json() { return this; } };
  requireSignature(req, res, () => { passed = true; });
  return { status, passed, req };
}

test("audit: a wallet header without a signature is refused on testnet", () => {
  const before = process.env.NETWORK_MODE;
  process.env.NETWORK_MODE = "testnet";
  try {
    const r = call({ "x-wallet-address": "0x000000000000000000000000000000000000dEaD" });
    assert.equal(r.passed, false);
    assert.equal(r.status, 401);
  } finally {
    process.env.NETWORK_MODE = before;
  }
});

test("audit: a valid signature from that wallet still passes", async () => {
  const wallet = ethers.Wallet.createRandom();
  const ts = String(Date.now());
  const body = { amount: 5 };
  const message = `POST:/api/predict/withdraw:${ts}:${ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(body)))}`;
  const r = call({ "x-wallet-address": wallet.address, "x-signature": await wallet.signMessage(message), "x-timestamp": ts }, body);
  assert.equal(r.passed, true);
  assert.equal(r.req.walletAddress, wallet.address.toLowerCase());
});
