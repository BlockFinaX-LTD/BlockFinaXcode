/**
 * yahoo.ts — Yahoo Finance historical client.
 *
 * Used for assets TwelveData free tier doesn't cover:
 *   - Silver, platinum, palladium (SI=F, PL=F, PA=F)
 *   - Crude oil WTI/Brent (CL=F, BZ=F)
 *   - Natural gas (NG=F)
 *   - Soft commodities (CC=F, KC=F, ZW=F, SB=F — cocoa, coffee, wheat, sugar)
 *
 * Endpoint: query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=5y&interval=1d
 * No API key. Public, generally reliable.
 *
 * Limitations:
 *   - Yahoo can rate-limit anonymous heavy use; we set a User-Agent header.
 *   - Some days have null closes (holidays / illiquid) — we filter those out.
 *   - Futures front-month rolls cause occasional ~1-3% gaps; acceptable for
 *     vol/drift purposes since the magnitude is small relative to noise.
 */

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

interface YahooChartResult {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

export interface DailyClose {
  date: string;        // ISO YYYY-MM-DD
  close: number;
}

/** Convert a Unix-second timestamp to YYYY-MM-DD in UTC. */
function isoDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch up to ~5 years of daily closes for a Yahoo ticker.
 *
 * @param yahooTicker  e.g. "CL=F" for WTI crude, "SI=F" for silver
 * @param range        "1y" | "2y" | "5y" | "10y" — defaults to 5y
 */
export async function fetchYahooDailyTimeSeries(
  yahooTicker: string,
  range: "1y" | "2y" | "5y" | "10y" = "5y",
): Promise<DailyClose[]> {
  const url = `${YAHOO_BASE}/${encodeURIComponent(yahooTicker)}?interval=1d&range=${range}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Yahoo HTTP ${res.status} for ${yahooTicker}`);
  }

  const body = (await res.json()) as YahooChartResult;
  if (body.chart?.error) {
    throw new Error(`Yahoo error for ${yahooTicker}: ${body.chart.error.description}`);
  }

  const r = body.chart?.result?.[0];
  const timestamps = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];

  if (timestamps.length === 0 || closes.length === 0) {
    throw new Error(`Yahoo returned no data for ${yahooTicker}`);
  }
  if (timestamps.length !== closes.length) {
    throw new Error(`Yahoo length mismatch for ${yahooTicker}: ts=${timestamps.length} closes=${closes.length}`);
  }

  // Filter out null closes (holidays / illiquid days). Keep oldest-first ordering.
  const out: DailyClose[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c !== null && c !== undefined && Number.isFinite(c) && c > 0) {
      out.push({ date: isoDate(timestamps[i]), close: c });
    }
  }
  return out;
}

/** Fetch the most recent daily close for a Yahoo ticker. Used by the daily refresh. */
export async function fetchYahooLatestClose(yahooTicker: string): Promise<DailyClose> {
  const series = await fetchYahooDailyTimeSeries(yahooTicker, "1y");
  if (series.length === 0) {
    throw new Error(`Yahoo returned no recent close for ${yahooTicker}`);
  }
  return series[series.length - 1];
}

/**
 * Fetch daily closes over an explicit UNIX-seconds period range.
 *
 * This is the longest-history fetch — `range=10y` caps Yahoo at 10y, but the
 * period1/period2 parameter is unbounded. For FX, Yahoo typically returns from
 * the early 2000s onwards (KES=X starts ~2003-12, BRL=X ~2003-12, INR=X ~2003-12).
 * For commodities, mid-2000s. For crypto, from listing date.
 *
 * If period1 is older than Yahoo's earliest data, Yahoo silently returns from
 * its earliest available date — no error. So calling with period1 = Jan 1 1996
 * for "give me everything you have up to 30 years" works correctly.
 *
 * Matches exactly the URL format the user pointed to:
 *   https://query1.finance.yahoo.com/v8/finance/chart/KES=X?period1=...&period2=...&interval=1d
 *
 * @param yahooTicker  e.g. "KES=X" for USD/KES, "GC=F" for gold front-month
 * @param period1      UNIX-seconds inclusive start
 * @param period2      UNIX-seconds inclusive end (typically Math.floor(Date.now()/1000))
 */
export async function fetchYahooDailyTimeSeriesPeriod(
  yahooTicker: string,
  period1: number,
  period2: number,
): Promise<DailyClose[]> {
  if (period1 <= 0 || period2 <= 0 || period1 >= period2) {
    throw new Error(`Invalid period range for ${yahooTicker}: ${period1} → ${period2}`);
  }
  const url = `${YAHOO_BASE}/${encodeURIComponent(yahooTicker)}?interval=1d&period1=${period1}&period2=${period2}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    signal: AbortSignal.timeout(60_000),   // longer timeout — 25y of daily closes is ~6500 rows
  });

  if (!res.ok) {
    throw new Error(`Yahoo HTTP ${res.status} for ${yahooTicker}`);
  }

  const body = (await res.json()) as YahooChartResult;
  if (body.chart?.error) {
    throw new Error(`Yahoo error for ${yahooTicker}: ${body.chart.error.description}`);
  }

  const r = body.chart?.result?.[0];
  const timestamps = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];

  if (timestamps.length === 0 || closes.length === 0) {
    throw new Error(`Yahoo returned no data for ${yahooTicker} in [${period1}, ${period2}]`);
  }
  if (timestamps.length !== closes.length) {
    throw new Error(`Yahoo length mismatch for ${yahooTicker}: ts=${timestamps.length} closes=${closes.length}`);
  }

  const out: DailyClose[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c !== null && c !== undefined && Number.isFinite(c) && c > 0) {
      out.push({ date: isoDate(timestamps[i]), close: c });
    }
  }
  return out;
}
