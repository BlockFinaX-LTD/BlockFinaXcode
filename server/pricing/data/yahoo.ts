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
