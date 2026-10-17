/**
 * run-oracle-c.ts — Oracle Node C
 *
 * Data sources: ExchangeRate-API (one shared FX source across all oracle nodes),
 *               Kraken public API for crypto (free, no key, accessible from cloud IPs),
 *               Yahoo Finance for commodities.
 *
 * FX source limitation: all three signers currently rely on the same provider.
 * Quorum protects against signer/key failures, not a bad or unavailable provider.
 * Add independent providers as separately configured sources in a later change.
 *
 * Required env vars:
 *   ORACLE_KEY_C       — Private key for Oracle C wallet
 *   DIAMOND_ADDRESS    — Diamond contract address
 *
 * Optional:
 *   ORACLE_RPC_URL     — RPC endpoint (default: Base Mainnet)
 *   ORACLE_POLL_MS     — Poll interval in ms (default: 300000 = 5 min)
 *
 * Run:
 *   npx tsx server/multi-oracle/run-oracle-c.ts
 */

import { OracleNode, PriceMap } from "./oracle-node";
import { fetchExchangeRateApiFxPrices } from "./fx-source";

const RPC_URL =
  process.env.ORACLE_RPC_URL || "https://mainnet.base.org";

const DIAMOND_ADDRESS = process.env.DIAMOND_ADDRESS;
const ORACLE_KEY_C = process.env.ORACLE_KEY_C;
const POLL_MS = Number(process.env.ORACLE_POLL_MS) || 5 * 60 * 1000;
const START_DELAY_MS = Number(process.env.ORACLE_START_DELAY_MS) || 0;

if (!DIAMOND_ADDRESS) throw new Error("DIAMOND_ADDRESS env var required");
if (!ORACLE_KEY_C) throw new Error("ORACLE_KEY_C env var required");

// ============================================================
//               FX — ExchangeRate-API (single source)
// ============================================================

// This node uses the same initial FX source as Oracle A and B. Frankfurter is
// intentionally not counted as an independent source for settlement here.
const ERAPI_PAIRS: Record<string, { base: string; quote: string }> = {
  "USD/GHS": { base: "USD", quote: "GHS" },
  "USD/NGN": { base: "USD", quote: "NGN" },
  "USD/KES": { base: "USD", quote: "KES" },
  "USD/ZAR": { base: "USD", quote: "ZAR" },
  "USD/ETB": { base: "USD", quote: "ETB" },
  "USD/UGX": { base: "USD", quote: "UGX" },
  "USD/EGP": { base: "USD", quote: "EGP" },
  "USD/MAD": { base: "USD", quote: "MAD" },
  "USD/TND": { base: "USD", quote: "TND" },
};

// Additional configured pairs queried from the same ExchangeRate-API source.
const FRANKFURTER_PAIRS: Record<string, { from: string; to: string }> = {
  "EUR/USD": { from: "EUR", to: "USD" },
  "GBP/USD": { from: "GBP", to: "USD" },
  "USD/ZAR": { from: "USD", to: "ZAR" },
  "EUR/ZAR": { from: "EUR", to: "ZAR" },
  "GBP/ZAR": { from: "GBP", to: "ZAR" },
  "USD/EGP": { from: "USD", to: "EGP" },
  "EUR/EGP": { from: "EUR", to: "EGP" },
  "USD/MAD": { from: "USD", to: "MAD" },
  "EUR/MAD": { from: "EUR", to: "MAD" },
  "USD/TND": { from: "USD", to: "TND" },
  "EUR/TND": { from: "EUR", to: "TND" },
};

// Kraken pair codes — accessible from cloud IPs, no geo-restriction
// Binance was geo-blocking server IPs; Kraken is the replacement.
// BNB/USD is not listed on Kraken (Binance's native token).
const KRAKEN_PAIRS: Record<string, string> = {
  "BTC/USD": "XBTUSD",
  "ETH/USD": "ETHUSD",
  "SOL/USD": "SOLUSD",
  "XRP/USD": "XRPUSD",
  "ADA/USD": "ADAUSD",
};
// Kraken returns non-standard aliases in response keys (XXBTZUSD, XETHZUSD, XXRPZUSD).
// Map them back to our standard query codes.
const KRAKEN_ALIASES: Record<string, string> = {
  "XXBTZUSD": "XBTUSD",
  "XETHZUSD": "ETHUSD",
  "XXRPZUSD": "XRPUSD",
};

const YAHOO_TICKERS: Record<string, string> = {
  "XTI/USD": "CL=F",
  "XBR/USD": "BZ=F",
  "XNG/USD": "NG=F",
  "XCO/USD": "CC=F",
  "XCF/USD": "KC=F",
  "XWH/USD": "ZW=F",
};

async function fetchKrakenPrices(): Promise<Record<string, number>> {
  try {
    const queryCodes = Object.values(KRAKEN_PAIRS).join(",");
    const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${queryCodes}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error?.length > 0) throw new Error(data.error.join(", "));

    // Build reverse map: Kraken response key → standard pair name
    const reverseMap: Record<string, string> = {};
    for (const [pairName, code] of Object.entries(KRAKEN_PAIRS)) {
      reverseMap[code] = pairName;
    }
    for (const [alias, code] of Object.entries(KRAKEN_ALIASES)) {
      if (reverseMap[code]) reverseMap[alias] = reverseMap[code];
    }

    const result: Record<string, number> = {};
    for (const [key, val] of Object.entries(data.result as Record<string, any>)) {
      const pairName = reverseMap[key];
      if (!pairName) continue;
      const price = parseFloat((val as any).c?.[0]);
      if (price > 0) result[pairName] = price;
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

  const FX_SOURCE_PAIRS = {
    ...ERAPI_PAIRS,
    ...Object.fromEntries(Object.entries(FRANKFURTER_PAIRS).map(([pair, p]) => [pair, { base: p.from, quote: p.to }])),
  };

  const [fxRates, cryptoPrices, ...yahooResults] = await Promise.all([
    fetchExchangeRateApiFxPrices(FX_SOURCE_PAIRS),
    fetchKrakenPrices(),
    ...Object.entries(YAHOO_TICKERS).map(([, ticker]) => fetchYahooPrice(ticker)),
  ]);

  Object.assign(prices, fxRates);
  Object.assign(prices, cryptoPrices);

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
  privateKey: ORACLE_KEY_C,
  nodeLabel: "Oracle-C",
  rpcUrl: RPC_URL,
  diamondAddress: DIAMOND_ADDRESS,
  fetchPrices,
  pollIntervalMs: POLL_MS,
  startDelayMs: START_DELAY_MS,
});

process.on("SIGTERM", () => { node.stop(); process.exit(0); });
process.on("SIGINT",  () => { node.stop(); process.exit(0); });

node.start().catch((err) => {
  console.error("[Oracle-C] Fatal:", err);
  process.exit(1);
});
