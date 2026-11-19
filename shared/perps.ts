/**
 * Perpetual futures: units, markets and the order message a trading key signs.
 *
 * The clearinghouse contract (blockfinax-stellar/contracts/perp-clearinghouse) is linear:
 * one unit of size gains one USDC when the price rises by one. So
 *   notional (USDC) = |size| × price      profit (USDC) = size × (exit − entry)
 * Prices are at 1e6, sizes at 1e7, USDC at 1e7 (stroops).
 *
 * Used by both the browser (to sign orders) and the server (to check and settle them), so it
 * imports nothing that only runs in Node.
 */
import { Address, hash } from "@stellar/stellar-sdk";

export const PRICE_SCALE = 1_000_000;
export const SIZE_SCALE = 10_000_000;
export const USDC_SCALE = 10_000_000;
export const ORDER_TAG = "BFX_PERP_ORDER_V1";

export const STATUS_NAMES = ["Post-only", "Open", "Reduce-only", "Delisted"] as const;

/** Methods a personal wallet may send to the clearinghouse through the sponsored relay. */
export const PERP_USER_METHODS = ["deposit", "withdraw", "approve_key", "revoke_key", "emergency_close"] as const;
/** Which argument names the wallet, so the relay can check it is the caller's own. */
export const PERP_WALLET_ARG: Record<string, number> = { deposit: 0, withdraw: 0, approve_key: 0, revoke_key: 0, emergency_close: 0 };

/** What the app shows for each contract symbol. New markets only need a line here to look right. */
export const PERP_MARKET_INFO: Record<string, { pair: string; name: string; base: string; quote: string; decimals: number; country: string }> = {
  USDNGN: { pair: "USD/NGN", name: "Nigerian Naira", base: "USD", quote: "NGN", decimals: 2, country: "NG" },
  USDGHS: { pair: "USD/GHS", name: "Ghanaian Cedi", base: "USD", quote: "GHS", decimals: 4, country: "GH" },
  USDKES: { pair: "USD/KES", name: "Kenyan Shilling", base: "USD", quote: "KES", decimals: 3, country: "KE" },
  USDZAR: { pair: "USD/ZAR", name: "South African Rand", base: "USD", quote: "ZAR", decimals: 4, country: "ZA" },
  USDEGP: { pair: "USD/EGP", name: "Egyptian Pound", base: "USD", quote: "EGP", decimals: 4, country: "EG" },
  USDMAD: { pair: "USD/MAD", name: "Moroccan Dirham", base: "USD", quote: "MAD", decimals: 4, country: "MA" },
  USDUGX: { pair: "USD/UGX", name: "Ugandan Shilling", base: "USD", quote: "UGX", decimals: 1, country: "UG" },
  USDTZS: { pair: "USD/TZS", name: "Tanzanian Shilling", base: "USD", quote: "TZS", decimals: 1, country: "TZ" },
};
export const marketInfo = (symbol: string) =>
  PERP_MARKET_INFO[symbol] ?? { pair: symbol, name: symbol, base: symbol.slice(0, 3), quote: symbol.slice(3), decimals: 4, country: "" };

export interface PerpOrder {
  account: string;
  /** Raw Ed25519 public key of the trading key, hex. */
  key: string;
  market: number;
  isBuy: boolean;
  /** Limit price at 1e6. */
  price: bigint;
  /** Size in units at 1e7. */
  size: bigint;
  nonce: bigint;
  expiry: bigint;
  reduceOnly: boolean;
}

const be = (value: bigint, bytes: number): Uint8Array => {
  const hex = BigInt.asUintN(bytes * 8, value).toString(16).padStart(bytes * 2, "0");
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const hexBytes = (h: string) => {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};
export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The 32 bytes a trading key signs: the same layout as the contract's `order_digest`. */
export function orderDigest(contractId: string, o: PerpOrder): Uint8Array {
  const parts: Uint8Array[] = [
    new TextEncoder().encode(ORDER_TAG),
    new Uint8Array(Address.fromString(contractId).toScVal().toXDR()),
    new Uint8Array(Address.fromString(o.account).toScVal().toXDR()),
    hexBytes(o.key),
    be(BigInt(o.market), 4),
    new Uint8Array([o.isBuy ? 1 : 0]),
    be(o.price, 16),
    be(o.size, 16),
    be(o.nonce, 8),
    be(o.expiry, 8),
    new Uint8Array([o.reduceOnly ? 1 : 0]),
  ];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return new Uint8Array(hash(all as any));
}

/** Order as JSON (bigints as strings), the way it travels over the API. */
export interface PerpOrderJson { account: string; key: string; market: number; isBuy: boolean; price: string; size: string; nonce: string; expiry: string; reduceOnly: boolean }
export const orderToJson = (o: PerpOrder): PerpOrderJson => ({ ...o, price: String(o.price), size: String(o.size), nonce: String(o.nonce), expiry: String(o.expiry) });
export const orderFromJson = (o: PerpOrderJson): PerpOrder => ({
  account: String(o.account), key: String(o.key).toLowerCase(), market: Number(o.market), isBuy: Boolean(o.isBuy),
  price: BigInt(o.price), size: BigInt(o.size), nonce: BigInt(o.nonce), expiry: BigInt(o.expiry), reduceOnly: Boolean(o.reduceOnly),
});

export type TimeInForce = "gtc" | "ioc" | "alo";

/** Display helpers. */
export const priceToNumber = (p: bigint | string) => Number(p) / PRICE_SCALE;
export const sizeToNumber = (s: bigint | string) => Number(s) / SIZE_SCALE;
export const usdcToNumber = (u: bigint | string) => Number(u) / USDC_SCALE;
export const priceFromNumber = (n: number) => BigInt(Math.round(n * PRICE_SCALE));
export const sizeFromNumber = (n: number) => BigInt(Math.round(n * SIZE_SCALE));
/** Units of size for a USD notional at a price. */
export const unitsForNotional = (usd: number, price: number) => (price > 0 ? usd / price : 0);

/** Auto-deleveraging rank shown as five lights: 5 means first in the queue. */
export function adlLights(scorePercentile: number) {
  return Math.max(1, Math.min(5, Math.ceil(scorePercentile * 5)));
}
