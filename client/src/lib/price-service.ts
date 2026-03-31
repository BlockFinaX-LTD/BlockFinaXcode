/**
 * Price Service - Crypto price fetching via server endpoint
 *
 * Fetches ETH/USDC prices from the server, which tries CoinGecko then
 * falls back to Binance public API. Avoids browser-side rate limits.
 * Exports: fetchCryptoPrices, getCachedPrices, getEthPrice, getUsdcPrice
 */

interface PriceData {
  eth: number;
  usdc: number;
  lastUpdated: number;
}

let cachedPrices: PriceData | null = null;
const CACHE_DURATION = 60000;

export async function fetchCryptoPrices(): Promise<PriceData> {
  if (cachedPrices && Date.now() - cachedPrices.lastUpdated < CACHE_DURATION) {
    return cachedPrices;
  }

  try {
    const res = await fetch("/api/prices");
    if (!res.ok) throw new Error("price fetch failed");
    const data = await res.json() as PriceData;
    cachedPrices = { ...data, lastUpdated: Date.now() };
    return cachedPrices;
  } catch {
    return cachedPrices ?? { eth: 3200, usdc: 1, lastUpdated: Date.now() };
  }
}

export function getCachedPrices(): PriceData {
  return cachedPrices || { eth: 3200, usdc: 1, lastUpdated: 0 };
}

export function getEthPrice(): number {
  return cachedPrices?.eth || 3200;
}

export function getUsdcPrice(): number {
  return cachedPrices?.usdc || 1;
}
