import { ethers } from 'ethers';
import { storage } from './storage';

export type AssetClass = 'fx' | 'commodity' | 'crypto';

const FX_PAIRS: Record<string, { base: string; quote: string }> = {
  "USD/GHS": { base: "USD", quote: "GHS" },
  "USD/NGN": { base: "USD", quote: "NGN" },
  "USD/KES": { base: "USD", quote: "KES" },
  "USD/ZAR": { base: "USD", quote: "ZAR" },
  "USD/XOF": { base: "USD", quote: "XOF" },
  "USD/XAF": { base: "USD", quote: "XAF" },
  "USD/TZS": { base: "USD", quote: "TZS" },
  "USD/UGX": { base: "USD", quote: "UGX" },
  "USD/RWF": { base: "USD", quote: "RWF" },
  "USD/ETB": { base: "USD", quote: "ETB" },
  "USD/EGP": { base: "USD", quote: "EGP" },
  "USD/MAD": { base: "USD", quote: "MAD" },
  "USD/TND": { base: "USD", quote: "TND" },
  "USD/MZN": { base: "USD", quote: "MZN" },
  "USD/ZMW": { base: "USD", quote: "ZMW" },
  "USD/MWK": { base: "USD", quote: "MWK" },
  "USD/AOA": { base: "USD", quote: "AOA" },
  "USD/CDF": { base: "USD", quote: "CDF" },
  "USD/SDG": { base: "USD", quote: "SDG" },
  "USD/GMD": { base: "USD", quote: "GMD" },
  "USD/SLL": { base: "USD", quote: "SLL" },
  "USD/LRD": { base: "USD", quote: "LRD" },
  "USD/BWP": { base: "USD", quote: "BWP" },
  "USD/NAD": { base: "USD", quote: "NAD" },
  "USD/SZL": { base: "USD", quote: "SZL" },
  "USD/LSL": { base: "USD", quote: "LSL" },
  "USD/SCR": { base: "USD", quote: "SCR" },
  "USD/MUR": { base: "USD", quote: "MUR" },
  "USD/DJF": { base: "USD", quote: "DJF" },
  "USD/ERN": { base: "USD", quote: "ERN" },
  "USD/SOS": { base: "USD", quote: "SOS" },
  "USD/BIF": { base: "USD", quote: "BIF" },
  "USD/CVE": { base: "USD", quote: "CVE" },
  "USD/KMF": { base: "USD", quote: "KMF" },
  "USD/MGA": { base: "USD", quote: "MGA" },
  "USD/STN": { base: "USD", quote: "STN" },
  "EUR/GHS": { base: "EUR", quote: "GHS" },
  "EUR/NGN": { base: "EUR", quote: "NGN" },
  "EUR/KES": { base: "EUR", quote: "KES" },
  "EUR/ZAR": { base: "EUR", quote: "ZAR" },
  "EUR/XOF": { base: "EUR", quote: "XOF" },
  "EUR/XAF": { base: "EUR", quote: "XAF" },
  "EUR/EGP": { base: "EUR", quote: "EGP" },
  "EUR/MAD": { base: "EUR", quote: "MAD" },
  "EUR/TND": { base: "EUR", quote: "TND" },
  "GBP/GHS": { base: "GBP", quote: "GHS" },
  "GBP/NGN": { base: "GBP", quote: "NGN" },
  "GBP/KES": { base: "GBP", quote: "KES" },
  "GBP/ZAR": { base: "GBP", quote: "ZAR" },
  "GBP/EGP": { base: "GBP", quote: "EGP" },
};

const COMMODITY_METAL_BASES = ["XAU", "XAG", "XPT", "XPD"];
const COMMODITY_PAIRS: Record<string, { base: string; quote: string }> = {
  "XAU/USD": { base: "XAU", quote: "USD" },
  "XAG/USD": { base: "XAG", quote: "USD" },
  "XPT/USD": { base: "XPT", quote: "USD" },
  "XPD/USD": { base: "XPD", quote: "USD" },
};

const YAHOO_COMMODITY_TICKERS: Record<string, string> = {
  "XTI/USD": "CL=F",
  "XBR/USD": "BZ=F",
  "XNG/USD": "NG=F",
  "XCO/USD": "CC=F",
  "XCF/USD": "KC=F",
  "XWH/USD": "ZW=F",
  "XSG/USD": "SB=F",
};

const CRYPTO_IDS: Record<string, string> = {
  "BTC/USD": "bitcoin",
  "ETH/USD": "ethereum",
  "BNB/USD": "binancecoin",
  "SOL/USD": "solana",
  "XRP/USD": "ripple",
  "ADA/USD": "cardano",
};

const SUPPORTED_PAIRS = { ...FX_PAIRS };

interface FXRate {
  pair: string;
  rate: number;
  source: string;
  timestamp: number;
  lastUpdated: string;
  change24h?: number;
  assetClass: AssetClass;
}

export function getAssetClass(pair: string): AssetClass {
  if (pair in CRYPTO_IDS) return 'crypto';
  if (pair in COMMODITY_PAIRS || pair in YAHOO_COMMODITY_TICKERS) return 'commodity';
  return 'fx';
}

interface OracleCache {
  rates: Record<string, FXRate>;
  lastFetch: number;
}

interface RateSnapshot {
  rate: number;
  timestamp: number;
}

const cache: OracleCache = {
  rates: {},
  lastFetch: 0,
};

async function get24hChangeFromDB(pair: string, currentRate: number): Promise<number | undefined> {
  try {
    const now = Date.now();
    const target24h = now - 24 * 60 * 60 * 1000;
    const snap = await storage.getRateSnapshotBefore(pair, target24h + 15 * 60 * 1000);
    if (!snap) return undefined;
    const oldRate = parseFloat(snap.rate as string);
    if (!oldRate || oldRate === 0) return undefined;
    return ((currentRate - oldRate) / oldRate) * 100;
  } catch {
    return undefined;
  }
}

const CACHE_TTL = 5 * 60 * 1000;
const API_URL = "https://open.er-api.com/v6/latest";
const BACKUP_API_URL = "https://api.exchangerate-api.com/v4/latest";

async function fetchRatesFromBackupSource(base: string): Promise<Record<string, number>> {
  try {
    const response = await fetch(`${BACKUP_API_URL}/${base}`);
    if (!response.ok) throw new Error(`Backup API returned ${response.status}`);
    const data = await response.json();
    return data.rates ?? {};
  } catch {
    return {};
  }
}

const DIAMOND_ADDRESS = '0x885E663645173a0791b82f0e6608921D31E3D700';
const LISK_SEPOLIA_RPC = 'https://rpc.sepolia-api.lisk.com';

const HEDGE_ABI = [
  'function settleEvent(uint256 _eventId, uint256 _settlementPrice)',
  'function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, uint8 status, bool poolOpen, bool allowExternalLp, uint256 initialRate, bool strikeAbove)',
  'function getTotalHedgeEvents() view returns (uint256)',
];

async function fetchRatesForBase(base: string): Promise<Record<string, number>> {
  try {
    const response = await fetch(`${API_URL}/${base}`);
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const data = await response.json();
    if (data.result !== "success") throw new Error("API returned error");
    return data.rates;
  } catch (error) {
    return {};
  }
}

interface PriceWithChange {
  price: number;
  change24h?: number;
}

async function fetchCryptoPrices(): Promise<Record<string, PriceWithChange>> {
  try {
    const ids = Object.values(CRYPTO_IDS).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
    const data = await response.json();
    const result: Record<string, PriceWithChange> = {};
    for (const [pair, coinId] of Object.entries(CRYPTO_IDS)) {
      const entry = data[coinId as string];
      if (entry?.usd) {
        result[pair] = {
          price: entry.usd,
          change24h: typeof entry.usd_24h_change === 'number' ? entry.usd_24h_change : undefined,
        };
      }
    }
    return result;
  } catch (error) {
    console.error('[Oracle] Crypto price fetch failed:', error instanceof Error ? error.message : error);
    return {};
  }
}

async function fetchYahooCommodityPrice(ticker: string): Promise<PriceWithChange | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2d`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const prevClose = meta?.chartPreviousClose ?? meta?.previousClose;
    if (typeof price !== 'number') return null;
    const change24h = (typeof prevClose === 'number' && prevClose !== 0)
      ? ((price - prevClose) / prevClose) * 100
      : undefined;
    return { price, change24h };
  } catch {
    return null;
  }
}

async function fetchCommodityPrices(): Promise<Record<string, PriceWithChange>> {
  const result: Record<string, PriceWithChange> = {};

  await Promise.all([
    ...COMMODITY_METAL_BASES.map(async (base) => {
      const rates = await fetchRatesForBase(base);
      const pair = `${base}/USD`;
      if (rates['USD']) result[pair] = { price: rates['USD'] };
    }),
    ...Object.entries(YAHOO_COMMODITY_TICKERS).map(async ([pair, ticker]) => {
      const data = await fetchYahooCommodityPrice(ticker);
      if (data !== null) result[pair] = data;
    }),
  ]);

  return result;
}

export async function fetchAllRates(): Promise<Record<string, FXRate>> {
  const now = Date.now();
  if (now - cache.lastFetch < CACHE_TTL && Object.keys(cache.rates).length > 0) {
    return cache.rates;
  }

  const bases = [...new Set(Object.values(FX_PAIRS).map(p => p.base))];
  const allRates: Record<string, Record<string, number>> = {};

  const backupRates: Record<string, Record<string, number>> = {};

  const [cryptoPrices, commodityPrices] = await Promise.all([
    fetchCryptoPrices(),
    fetchCommodityPrices(),
    ...bases.map(async (base) => {
      allRates[base] = await fetchRatesForBase(base);
    }),
    ...bases.map(async (base) => {
      backupRates[base] = await fetchRatesFromBackupSource(base);
    }),
  ]);

  const result: Record<string, FXRate> = {};

  const fxEntries = Object.entries(FX_PAIRS)
    .map(([pair, { base, quote }]) => {
      const primary = allRates[base]?.[quote];
      const backup = backupRates[base]?.[quote];
      const available = [primary, backup].filter((v): v is number => !!v && v > 0);
      if (available.length === 0) return null;
      const rate = available.reduce((a, b) => a + b, 0) / available.length;
      const source = available.length === 2
        ? "open.er-api.com + exchangerate-api.com (avg)"
        : available[0] === primary ? "open.er-api.com" : "exchangerate-api.com";
      return { pair, rate, source };
    })
    .filter((e): e is { pair: string; rate: number; source: string } => e !== null && !!e.rate);

  const fxChanges = await Promise.all(fxEntries.map(e => get24hChangeFromDB(e.pair, e.rate)));

  for (let i = 0; i < fxEntries.length; i++) {
    const { pair, rate, source } = fxEntries[i];
    result[pair] = {
      pair, rate,
      source,
      timestamp: now,
      lastUpdated: new Date().toISOString(),
      change24h: fxChanges[i],
      assetClass: 'fx',
    };
  }

  for (const [pair, { price, change24h }] of Object.entries(commodityPrices)) {
    const isYahoo = pair in YAHOO_COMMODITY_TICKERS;
    const dbChange = change24h ?? await get24hChangeFromDB(pair, price);
    result[pair] = {
      pair, rate: price,
      source: isYahoo ? "yahoo-finance" : "exchangerate-api.com",
      timestamp: now,
      lastUpdated: new Date().toISOString(),
      change24h: dbChange,
      assetClass: 'commodity',
    };
  }

  for (const [pair, { price, change24h }] of Object.entries(cryptoPrices)) {
    const dbChange = change24h ?? await get24hChangeFromDB(pair, price);
    result[pair] = {
      pair, rate: price,
      source: "coingecko.com",
      timestamp: now,
      lastUpdated: new Date().toISOString(),
      change24h: dbChange,
      assetClass: 'crypto',
    };
  }

  cache.rates = result;
  cache.lastFetch = now;

  const snapshots = Object.values(result).map(r => ({
    pair: r.pair,
    rate: String(r.rate),
    assetClass: r.assetClass,
  }));
  storage.saveRateSnapshots(snapshots).catch(() => {});

  const PRUNE_OLDER_THAN = 26 * 60 * 60 * 1000;
  storage.pruneOldRateSnapshots(now - PRUNE_OLDER_THAN).catch(() => {});

  return result;
}

export async function getRate(pair: string): Promise<FXRate | null> {
  const rates = await fetchAllRates();
  return rates[pair] || null;
}

export function getSupportedPairsWithClass(): Array<{ pair: string; assetClass: AssetClass }> {
  return [
    ...Object.keys(FX_PAIRS).map(pair => ({ pair, assetClass: 'fx' as AssetClass })),
    ...Object.keys(COMMODITY_PAIRS).map(pair => ({ pair, assetClass: 'commodity' as AssetClass })),
    ...Object.keys(YAHOO_COMMODITY_TICKERS).map(pair => ({ pair, assetClass: 'commodity' as AssetClass })),
    ...Object.keys(CRYPTO_IDS).map(pair => ({ pair, assetClass: 'crypto' as AssetClass })),
  ];
}

export function getSupportedPairs(): string[] {
  return [
    ...Object.keys(FX_PAIRS),
    ...Object.keys(COMMODITY_PAIRS),
    ...Object.keys(YAHOO_COMMODITY_TICKERS),
    ...Object.keys(CRYPTO_IDS),
  ];
}

function getOracleSigner(): ethers.Wallet | null {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) return null;
  const provider = new ethers.JsonRpcProvider(LISK_SEPOLIA_RPC);
  return new ethers.Wallet(privateKey, provider);
}

export async function checkAndSettleEvents(): Promise<{ settled: number; oneTouchSettled: number; expirySettled: number; errors: string[] }> {
  let settled = 0;
  let oneTouchSettled = 0;
  let expirySettled = 0;
  const errors: string[] = [];

  const signer = getOracleSigner();
  if (!signer) {
    errors.push("DEPLOYER_PRIVATE_KEY not configured — cannot settle events on-chain");
    return { settled, oneTouchSettled, expirySettled, errors };
  }

  const provider = new ethers.JsonRpcProvider(LISK_SEPOLIA_RPC);
  const readContract = new ethers.Contract(DIAMOND_ADDRESS, HEDGE_ABI, provider);
  const writeContract = new ethers.Contract(DIAMOND_ADDRESS, HEDGE_ABI, signer);

  let totalEvents: number;
  try {
    totalEvents = Number(await readContract.getTotalHedgeEvents());
  } catch (error) {
    errors.push(`Failed to read total events: ${error instanceof Error ? error.message : "Unknown error"}`);
    return { settled, oneTouchSettled, expirySettled, errors };
  }

  const now = Math.floor(Date.now() / 1000);

  for (let i = 1; i <= totalEvents; i++) {
    try {
      const core = await readContract.getHedgeEventCore(i);
      const status = Number(core.status);
      if (status !== 0) continue;

      const underlying = core.underlying;
      const rate = await getRate(underlying);
      if (!rate) {
        errors.push(`No rate available for ${underlying} (event #${i})`);
        continue;
      }

      const strike = Number(ethers.formatUnits(core.strike, 6));
      const initialRate = Number(ethers.formatUnits(core.initialRate, 6));
      const strikeAbove = core.strikeAbove as boolean;
      // Legacy events (created before bidirectional support) have strikeAbove=false
      // but strike > initialRate — infer they are actually upward hedges
      const effectiveStrikeAbove = strikeAbove || (!strikeAbove && strike > initialRate);
      const expiryDate = Number(core.expiryDate);
      const isExpired = expiryDate <= now;
      const isTouched = effectiveStrikeAbove ? rate.rate >= strike : rate.rate <= strike;

      if (!isExpired && !isTouched) continue;

      const settlementPriceWei = ethers.parseUnits(rate.rate.toFixed(6), 6);
      const tx = await writeContract.settleEvent(i, settlementPriceWei);
      await tx.wait();
      settled++;

      if (isTouched && !isExpired) {
        oneTouchSettled++;
        console.log(`[Oracle] ONE-TOUCH: Event #${i} (${underlying}) settled early — rate ${rate.rate} touched strike ${strike}`);
      } else {
        expirySettled++;
        console.log(`[Oracle] EXPIRY: Event #${i} (${underlying}) settled at rate ${rate.rate} (strike: ${strike})`);
      }
    } catch (error) {
      errors.push(`Failed to settle event #${i}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return { settled, oneTouchSettled, expirySettled, errors };
}

export async function checkExpiredEvents(): Promise<{ settled: number; errors: string[] }> {
  const result = await checkAndSettleEvents();
  return { settled: result.settled, errors: result.errors };
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startOraclePoller(intervalMs: number = 5 * 60 * 1000) {
  fetchAllRates();

  console.log(`[Oracle] One-touch oracle started — polling every ${intervalMs / 1000}s`);

  intervalId = setInterval(async () => {
    try {
      await fetchAllRates();
      const result = await checkAndSettleEvents();
      if (result.settled > 0) {
        console.log(`[Oracle] Settlement cycle: ${result.oneTouchSettled} one-touch, ${result.expirySettled} expiry`);
      }
    } catch (error) {
    }
  }, intervalMs);
}

export function stopOraclePoller() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
