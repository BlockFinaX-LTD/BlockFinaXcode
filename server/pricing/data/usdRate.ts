/**
 * usdRate.ts — USD risk-free rate from US Treasury Direct (no API key).
 *
 * Endpoint: average interest rate on outstanding Treasury Bills, reported monthly.
 * https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates
 *
 * We use Treasury Bills as the risk-free proxy because:
 *   - Updates monthly (slow-moving, predictable)
 *   - Closely tracks SOFR for short tenors (which is what most of our hedges are)
 *   - Free, no API key, no rate limits
 *
 * Returned as decimal fraction (3.702% → 0.03702).
 *
 * Cached in memory for 6 hours since the underlying source updates monthly.
 */

const TREASURY_DIRECT_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates" +
  "?sort=-record_date" +
  "&page%5Bsize%5D=1" +
  "&filter=security_desc:eq:Treasury%20Bills";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache: { rate: number; recordDate: string; fetchedAt: number } | null = null;

interface TreasuryResponse {
  data?: Array<{
    record_date: string;
    avg_interest_rate_amt: string;   // e.g. "3.702" — percent, as a string
    security_desc: string;
  }>;
}

/**
 * Fetch the most recent USD risk-free rate.
 * Returns a decimal fraction (NOT percent): 3.702% → 0.03702.
 */
export async function fetchUsdRate(): Promise<number> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rate;
  }

  const res = await fetch(TREASURY_DIRECT_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    if (cache) return cache.rate;       // fall back to stale cache on transient failure
    throw new Error(`Treasury Direct HTTP ${res.status}`);
  }

  const body = (await res.json()) as TreasuryResponse;
  const row = body.data?.[0];
  if (!row || !row.avg_interest_rate_amt) {
    if (cache) return cache.rate;
    throw new Error("Treasury Direct returned no data rows");
  }

  const ratePercent = Number(row.avg_interest_rate_amt);
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 25) {
    // Sanity bound: a T-bill rate outside [0, 25%] is almost certainly bad data.
    if (cache) return cache.rate;
    throw new Error(`Treasury Direct returned implausible rate: ${ratePercent}`);
  }

  const rate = ratePercent / 100;
  cache = { rate, recordDate: row.record_date, fetchedAt: now };
  return rate;
}

/** For diagnostics: current cache state (or null if never fetched). */
export function getUsdRateCache(): { rate: number; recordDate: string; fetchedAt: number } | null {
  return cache;
}
