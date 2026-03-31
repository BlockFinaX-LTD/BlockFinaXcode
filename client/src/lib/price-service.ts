/**
 * Price Service - Crypto price fetching via server endpoint
 *
 * Fetches ETH/USDC prices from the server, which tries Binance → Kraken → CoinGecko.
 * Avoids browser-side rate limits. Cache matches server's 5-minute window.
 * Exports: fetchCryptoPrices, getCachedPrices, getEthPrice, getUsdcPrice
 */

interface PriceData {
  eth: number;
  usdc: number;
  lastUpdated: number;
}

let cachedPrices: PriceData | null = null;
const CACHE_DURATION = 5 * 60_000; // match server cache (5 min)

export async function fetchCryptoPrices(): Promise<PriceData | null> {
  if (cachedPrices && Date.now() - cachedPrices.lastUpdated < CACHE_DURATION) {
    return cachedPrices;
  }

  try {
    const res = await fetch("/api/prices");
    if (!res.ok) return cachedPrices; // return last known good price, not a fake
    const data = await res.json() as PriceData;
    if (!data?.eth || !isFinite(data.eth)) return cachedPrices;
    cachedPrices = { ...data, lastUpdated: Date.now() };
    return cachedPrices;
  } catch {
    return cachedPrices; // return last known good, or null — never fabricate
  }
}

export function getCachedPrices(): PriceData | null {
  return cachedPrices;
}

export function getEthPrice(): number | null {
  return cachedPrices?.eth ?? null;
}

export function getUsdcPrice(): number {
  return cachedPrices?.usdc ?? 1;
}
