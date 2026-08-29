import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";

/**
 * A signed quote has to survive res.json(), and once it did not.
 *
 * signPurchaseQuote returns quoteTimestamp as a bigint, which is what the
 * contract wants, and JSON.stringify throws on bigints. The route's catch then
 * turned that into a 400, so every attempt to buy into a dynamic pool failed
 * with "the price quote could not be obtained" and nothing said why.
 *
 * It shipped because the only pool available to test against had already
 * settled, so the request was refused long before it reached the signing step.
 * This asserts the boundary directly instead.
 */
test("a signed attestation survives JSON serialisation", async () => {
  process.env.PRICING_ENGINE_PRIVATE_KEY ||= ethers.Wallet.createRandom().privateKey;
  const { signPurchaseQuote } = await import("../signer");

  const att = await signPurchaseQuote({
    chainId: 8453,
    diamondAddress: "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
    buyer: "0xef5Bed7c221c85A2c88e3c0223ee45482d6F037d",
    eventId: 14,
    notional: 3000_000000n,
    premiumRate: 5000n,
  });
  assert.ok(att, "signer should be configured in this test");

  // The bigint is the trap. Confirm it is really there, so this test still
  // means something if the return type ever changes.
  assert.equal(typeof att.quoteTimestamp, "bigint");
  assert.throws(() => JSON.stringify(att), /BigInt/);

  // What the route actually sends.
  const wire = { ...att, quoteTimestamp: att.quoteTimestamp.toString() };
  const json = JSON.stringify({ ok: true, attestation: wire });

  // And what the client rebuilds, which must reach the contract unchanged.
  const back = JSON.parse(json).attestation;
  assert.equal(BigInt(back.quoteTimestamp), att.quoteTimestamp);
  assert.equal(back.signature, att.signature);
  assert.equal(back.quoteNonce, att.quoteNonce);
  assert.equal(back.signature.length, 132, "65-byte signature, 0x + 130 hex");
});
