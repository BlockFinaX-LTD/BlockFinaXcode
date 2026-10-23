/**
 * MoonPay on-ramp: buy USDC with a card or bank transfer, delivered to the user's own
 * deposit address on Base. From there the deposit watcher forwards it to their Stellar
 * wallet through Circle CCTP, exactly like any other Base deposit. MoonPay never sees the
 * Stellar wallet, which is a contract (C) address it cannot pay.
 *
 * The widget URL carries the wallet address, so MoonPay requires it to be signed on the
 * server: HMAC-SHA256 over the URL's query string (leading "?" included) with the secret
 * key, base64, appended as `signature` (as @moonpay/moonpay-node does).
 *
 *   MOONPAY_PUBLIC_KEY      pk_test_... or pk_live_...
 *   MOONPAY_SECRET_KEY      sk_test_... or sk_live_...; must match the public key's mode
 *   MOONPAY_CURRENCY_CODE   optional override. Default usdc_base; MoonPay's test mode
 *                           does not support usdc_base, so test keys default to usdc.
 */
import { createHmac, randomUUID } from "node:crypto";

export interface MoonPayConfig {
  publicKey: string;
  secretKey: string;
  sandbox: boolean;
  currencyCode: string;
}

/** The configured MoonPay keys, or null when the on-ramp is switched off. */
export function moonpayConfig(env: NodeJS.ProcessEnv = process.env): MoonPayConfig | null {
  const publicKey = env.MOONPAY_PUBLIC_KEY?.trim();
  const secretKey = env.MOONPAY_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) return null;
  const sandbox = publicKey.startsWith("pk_test_");
  if (sandbox !== secretKey.startsWith("sk_test_")) throw new Error("MOONPAY_PUBLIC_KEY and MOONPAY_SECRET_KEY must both be test keys or both be live keys");
  return { publicKey, secretKey, sandbox, currencyCode: env.MOONPAY_CURRENCY_CODE?.trim() || (sandbox ? "usdc" : "usdc_base") };
}

export function signUrl(url: URL, secretKey: string): string {
  url.searchParams.delete("signature");
  url.searchParams.set("signature", createHmac("sha256", secretKey).update(url.search).digest("base64"));
  return url.toString();
}

export interface BuyRequest {
  userId: string;
  walletAddress: string;
  email?: string | null;
  amountUsd?: number;
  redirectUrl?: string;
}

/** A signed MoonPay buy URL that sends the purchase to `walletAddress`. */
export function buyUrl(config: MoonPayConfig, request: BuyRequest): { url: string; externalTransactionId: string } {
  if (!/^0x[0-9a-fA-F]{40}$/.test(request.walletAddress)) throw new Error("A Base deposit address is required");
  const url = new URL(config.sandbox ? "https://buy-sandbox.moonpay.com" : "https://buy.moonpay.com");
  const externalTransactionId = randomUUID();
  const params: Record<string, string | undefined> = {
    apiKey: config.publicKey,
    currencyCode: config.currencyCode,
    walletAddress: request.walletAddress,
    baseCurrencyCode: "usd",
    baseCurrencyAmount: request.amountUsd ? String(request.amountUsd) : undefined,
    email: request.email || undefined,
    externalCustomerId: request.userId,
    externalTransactionId,
    redirectURL: request.redirectUrl,
    showWalletAddressForm: "false",
    colorCode: "#1a4480",
  };
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.append(k, v);
  return { url: signUrl(url, config.secretKey), externalTransactionId };
}
