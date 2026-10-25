import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { sandboxQuote } from "./quote";

const wallet = ethers.Wallet.createRandom();
const config = { diamond: "0x1111111111111111111111111111111111111111", signerKey: wallet.privateKey };
const now = 1800000000;
const body = { pair: "USD/GHS", strike: 11, payoutCap: 12, notional: 100, expiryUnixSeconds: now + 86400 * 30, strikeAbove: true, chainId: 84532, diamondAddress: config.diamond, creator: "0x2222222222222222222222222222222222222222" };

test("test quotes are labelled synthetic and recover the protocol signer", async () => {
  const quote = await sandboxQuote(body, config, now);
  assert.equal(quote.synthetic, true);
  assert.equal(quote.breakdown.spot, 10);
  assert.ok(quote.premiumRate > 0 && quote.premiumRate < 0.1);
  const att = quote.attestation!;
  const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "address", "string", "uint256", "uint256", "uint256", "uint256", "uint256", "bool", "uint256", "bytes32"],
    [84532, config.diamond, body.creator, body.pair, 11000000, 12000000, quote.premiumRateFixed6, body.expiryUnixSeconds, 10000000, true, now, att.quoteNonce],
  ));
  assert.equal(ethers.verifyMessage(ethers.getBytes(hash), att.signature), wallet.address);
});
test("rejects mainnet context, mismatched contracts, expired quotes, and wrong range direction", async () => {
  for (const change of [{ chainId: 8453 }, { diamondAddress: body.creator }, { expiryUnixSeconds: now - 1 }, { payoutCap: 9 }, { notional: Infinity }, { dynamicPricing: true }]) {
    await assert.rejects(sandboxQuote({ ...body, ...change }, config, now));
  }
});
test("supports advisory quotes and downward protection", async () => {
  const quote = await sandboxQuote({ pair: "USD/GHS", strike: 9, payoutCap: 8, notional: 100, expiryUnixSeconds: now + 86400 * 30, strikeAbove: false }, config, now);
  assert.equal(quote.attestation, null);
  assert.equal(quote.breakdown.direction, "downward");
});
