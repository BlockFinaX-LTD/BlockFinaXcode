import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { buyUrl, moonpayConfig } from "../moonpay";

const WALLET = "0x71595cb952580a257F7B9af52676467198bd425A";

test("on with a public key; test and live keys cannot be mixed", () => {
  assert.equal(moonpayConfig({}), null);
  assert.equal(moonpayConfig({ MOONPAY_PUBLIC_KEY: "pk_test_x" })!.secretKey, null);
  assert.throws(() => moonpayConfig({ MOONPAY_PUBLIC_KEY: "pk_test_x", MOONPAY_SECRET_KEY: "sk_live_y" }));
  const sandbox = moonpayConfig({ MOONPAY_PUBLIC_KEY: "pk_test_x", MOONPAY_SECRET_KEY: "sk_test_y" })!;
  assert.equal(sandbox.sandbox, true);
  assert.equal(sandbox.currencyCode, "usdc", "MoonPay test mode does not support usdc_base");
  const live = moonpayConfig({ MOONPAY_PUBLIC_KEY: "pk_live_x", MOONPAY_SECRET_KEY: "sk_live_y" })!;
  assert.equal(live.sandbox, false);
  assert.equal(live.currencyCode, "usdc_base");
});

test("the URL is signed over its query string, as MoonPay verifies it", () => {
  const config = moonpayConfig({ MOONPAY_PUBLIC_KEY: "pk_live_x", MOONPAY_SECRET_KEY: "sk_live_secret" })!;
  const { url, externalTransactionId } = buyUrl(config, { userId: "42", walletAddress: WALLET, amountUsd: 250, redirectUrl: "https://testnet.blockfinax.com/wallet" });
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://buy.moonpay.com");
  assert.equal(parsed.searchParams.get("walletAddress"), WALLET);
  assert.equal(parsed.searchParams.get("currencyCode"), "usdc_base");
  assert.equal(parsed.searchParams.get("externalCustomerId"), "42");
  assert.equal(parsed.searchParams.get("externalTransactionId"), externalTransactionId);
  // MoonPay's own check: remove the signature, HMAC the remaining query string.
  const signature = parsed.searchParams.get("signature")!;
  parsed.searchParams.delete("signature");
  assert.equal(signature, createHmac("sha256", "sk_live_secret").update(parsed.search).digest("base64"));
  // Changing the wallet invalidates it.
  parsed.searchParams.set("walletAddress", "0x0000000000000000000000000000000000000001");
  assert.notEqual(signature, createHmac("sha256", "sk_live_secret").update(parsed.search).digest("base64"));
});

test("only an EVM deposit address is accepted", () => {
  const config = moonpayConfig({ MOONPAY_PUBLIC_KEY: "pk_test_x", MOONPAY_SECRET_KEY: "sk_test_y" })!;
  assert.throws(() => buyUrl(config, { userId: "1", walletAddress: "CB4IWMDLPUPCFNMQH4KLEFWX6PEN5M2OGNY25E5YA7DUTPOYD4E2YWXU" }));
  assert.match(buyUrl(config, { userId: "1", walletAddress: WALLET }).url, /^https:\/\/buy-sandbox\.moonpay\.com\/\?/);
});

test("without a secret key the address is not prefilled, so MoonPay accepts the link unsigned", () => {
  const config = moonpayConfig({ MOONPAY_PUBLIC_KEY: "pk_test_x" })!;
  const r = buyUrl(config, { userId: "1", walletAddress: WALLET });
  const u = new URL(r.url);
  assert.equal(r.prefilled, false);
  assert.equal(u.searchParams.get("walletAddress"), null);
  assert.equal(u.searchParams.get("signature"), null);
  assert.equal(u.searchParams.get("currencyCode"), "usdc");
});
