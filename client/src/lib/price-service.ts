/**
 * Price Service - Crypto price fetching from CoinGecko
 *
 * Fetches and caches ETH/USDC prices with automatic fallback to defaults.
 * Exports: fetchCryptoPrices, getCachedPrices, getEthPrice, getUsdcPrice
 */
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

interface PriceData {
  eth: number;
  usdc: number;
  lastUpdated: number;
}

let cachedPrices: PriceData | null = null;
const CACHE_DURATION = 60000; // 1 minute cache

export async function fetchCryptoPrices(): Promise<PriceData> {
  // Return cached prices if still valid
  if (cachedPrices && Date.now() - cachedPrices.lastUpdated < CACHE_DURATION) {
    return cachedPrices;
  }

  try {
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=ethereum,usd-coin&vs_currencies=usd`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch prices');
    }
    
    const data = await response.json();
    
    cachedPrices = {
      eth: data.ethereum?.usd || 3200,
      usdc: data['usd-coin']?.usd || 1,
      lastUpdated: Date.now()
    };
    
    return cachedPrices;
  } catch (error) {
    // Return reasonable defaults if API fails
    return {
      eth: 3200,
      usdc: 1,
      lastUpdated: Date.now()
    };
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
