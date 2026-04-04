/**
 * run-oracle-a.ts — Oracle Node A
 *
 * Data sources: ExchangeRate-API (open.er-api.com) for FX,
 *               CoinGecko for crypto,
 *               Yahoo Finance for commodities.
 *
 * Required env vars:
 *   ORACLE_KEY_A       — Private key for Oracle A wallet
 *   DIAMOND_ADDRESS    — Diamond contract address
 *
 * Optional:
 *   ORACLE_RPC_URL     — RPC endpoint (default: Lisk Sepolia)
 *   ORACLE_POLL_MS     — Poll interval in ms (default: 300000 = 5 min)
 *
 * Run:
 *   npx tsx server/multi-oracle/run-oracle-a.ts
 */

import { OracleNode, PriceMap } from "./oracle-node";

const RPC_URL =
  process.env.ORACLE_RPC_URL || "https://rpc.sepolia-api.lisk.com";

const DIAMOND_ADDRESS = process.env.DIAMOND_ADDRESS;
const ORACLE_KEY_A = process.env.ORACLE_KEY_A;
const POLL_MS = Number(process.env.ORACLE_POLL_MS) || 5 * 60 * 1000;
const START_DELAY_MS = Number(process.env.ORACLE_START_DELAY_MS) || 0;

if (!DIAMOND_ADDRESS) throw new Error("DIAMOND_ADDRESS env var required");
if (!ORACLE_KEY_A) throw new Error("ORACLE_KEY_A env var required");

// ============================================================
//                    FX — ExchangeRate-API v6
// ============================================================

const FX_PAIRS: Record<string, { base: string; quote: string }> = {
  "USD/GHS": { base: "USD", quote: "GHS" },
  "USD/NGN": { base: "USD", quote: "NGN" },
  "USD/KES": { base: "USD", quote: "KES" },
  "USD/ZAR": { base: "USD", quote: "ZAR" },
  "USD/XOF": { base: "USD", quote: "XOF" },
  "USD/XAF": { base: "USD", quote: "XAF" },
  "USD/TZS": { base: "USD", quote: "TZS" },
  "USD/UGX": { base: "USD", quote: "UGX" },
  "USD/EGP": { base: "USD", quote: "EGP" },
  "USD/MAD": { base: "USD", quote: "MAD" },
  "USD/ETB": { base: "USD", quote: "ETB" },
  "USD/RWF": { base: "USD", quote: "RWF" },
  "USD/MZN": { base: "USD", quote: "MZN" },
  "USD/ZMW": { base: "USD", quote: "ZMW" },
  "USD/MWK": { base: "USD", quote: "MWK" },
  "USD/AOA": { base: "USD", quote: "AOA" },
  "USD/BWP": { base: "USD", quote: "BWP" },
  "USD/NAD": { base: "USD", quote: "NAD" },
  "USD/GMD": { base: "USD", quote: "GMD" },
  "USD/TND": { base: "USD", quote: "TND" },
  "EUR/GHS": { base: "EUR", quote: "GHS" },
  "EUR/NGN": { base: "EUR", quote: "NGN" },
  "EUR/KES": { base: "EUR", quote: "KES" },
  "EUR/ZAR": { base: "EUR", quote: "ZAR" },
  "GBP/GHS": { base: "GBP", quote: "GHS" },
  "GBP/NGN": { base: "GBP", quote: "NGN" },
  "GBP/KES": { base: "GBP", quote: "KES" },
};

const CRYPTO_IDS: Record<string, string> = {
  "BTC/USD": "bitcoin",
  "ETH/USD": "ethereum",
  "BNB/USD": "binancecoin",
  "SOL/USD": "solana",
  "XRP/USD": "ripple",
  "ADA/USD": "cardano",
};

const YAHOO_TICKERS: Record<string, string> = {
  "XTI/USD": "CL=F",
  "XBR/USD": "BZ=F",
  "XNG/USD": "NG=F",
  "XCO/USD": "CC=F",
  "XCF/USD": "KC=F",
  "XWH/USD": "ZW=F",
};

async function fetchFxRates(base: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.result !== "success") throw new Error("API error");
    return data.rates ?? {};
  } catch {
    return {};
  }
}

async function fetchCryptoPrices(): Promise<Record<string, number>> {
  try {
    const ids = Object.values(CRYPTO_IDS).join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result: Record<string, number> = {};
    for (const [pair, coinId] of Object.entries(CRYPTO_IDS)) {
      if (data[coinId]?.usd) result[pair] = data[coinId].usd;
    }
    return result;
  } catch {
    return {};
  }
}

async function fetchYahooPrice(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}

async function fetchPrices(): Promise<PriceMap> {
  const prices: PriceMap = {};

  const bases = [...new Set(Object.values(FX_PAIRS).map((p) => p.base))];
  const fxResults = await Promise.all(bases.map((b) => fetchFxRates(b)));
  const fxByBase: Record<string, Record<string, number>> = {};
  bases.forEach((b, i) => { fxByBase[b] = fxResults[i]; });

  for (const [pair, { base, quote }] of Object.entries(FX_PAIRS)) {
    const rate = fxByBase[base]?.[quote];
    if (rate && rate > 0) prices[pair] = rate;
  }

  const [crypto, ...yahooResults] = await Promise.all([
    fetchCryptoPrices(),
    ...Object.entries(YAHOO_TICKERS).map(([, ticker]) => fetchYahooPrice(ticker)),
  ]);

  Object.assign(prices, crypto);

  const yahooPairs = Object.keys(YAHOO_TICKERS);
  yahooPairs.forEach((pair, i) => {
    const p = yahooResults[i];
    if (p !== null) prices[pair] = p;
  });

  return prices;
}

// ============================================================
//                          START
// ============================================================

const node = new OracleNode({
  privateKey: ORACLE_KEY_A,
  nodeLabel: "Oracle-A",
  rpcUrl: RPC_URL,
  diamondAddress: DIAMOND_ADDRESS,
  fetchPrices,
  pollIntervalMs: POLL_MS,
  startDelayMs: START_DELAY_MS,
});

process.on("SIGTERM", () => { node.stop(); process.exit(0); });
process.on("SIGINT",  () => { node.stop(); process.exit(0); });

node.start().catch((err) => {
  console.error("[Oracle-A] Fatal:", err);
  process.exit(1);
});
