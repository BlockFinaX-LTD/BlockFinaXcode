/**
 * twelvedata.ts — TwelveData time_series client.
 *
 * Free tier: 800 API credits/day, 8 calls/min.
 *   - Backfill: 1 call per pair (timeseries returns up to 5000 points)
 *   - Daily refresh: 1 call per pair per day
 *   With 5 pairs that's 5 + 5*30 = 155 credits/month — well under the daily 800 cap.
 *
 * Docs: https://twelvedata.com/docs#time-series
 *
 * Reads TWELVEDATA_API_KEY from env (loaded by dotenv at server startup).
 */

const TWELVEDATA_BASE = "https://api.twelvedata.com";

interface TimeSeriesValue {
  datetime: string;   // "YYYY-MM-DD"
  open: string;
  high: string;
  low: string;
  close: string;
}

interface TimeSeriesResponse {
  meta?: {
    symbol: string;
    interval: string;
    currency_base?: string;
    currency_quote?: string;
    type?: string;
  };
  values?: TimeSeriesValue[];
  status?: string;     // "ok" | "error"
  message?: string;    // present on error
  code?: number;
}

export interface DailyClose {
  date: string;        // ISO YYYY-MM-DD
  close: number;
}

function apiKey(): string {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) {
    throw new Error("TWELVEDATA_API_KEY is not set. Add it to .env or Railway env vars.");
  }
  return key;
}

/**
 * Fetch up to `outputsize` daily closes for a pair, ending today.
 * outputsize max is 5000 on the free tier — enough for ~13.5 years of business days.
 *
 * Returns oldest-first.
 */
export async function fetchDailyTimeSeries(
  pair: string,
  outputsize: number = 1300,        // ~5 years of business days
): Promise<DailyClose[]> {
  const url = new URL(`${TWELVEDATA_BASE}/time_series`);
  url.searchParams.set("symbol", pair);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", String(outputsize));
  url.searchParams.set("order", "asc");
  url.searchParams.set("apikey", apiKey());

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`TwelveData HTTP ${res.status} for ${pair}: ${await res.text()}`);
  }
  const body = (await res.json()) as TimeSeriesResponse;

  if (body.status === "error") {
    throw new Error(`TwelveData error for ${pair}: ${body.message ?? "unknown"} (code ${body.code ?? "?"})`);
  }
  if (!body.values || body.values.length === 0) {
    throw new Error(`TwelveData returned no values for ${pair}`);
  }

  return body.values.map(v => ({
    date: v.datetime,
    close: Number(v.close),
  }));
}

/**
 * Fetch the single most recent daily close for a pair.
 * Used by the daily refresh cron.
 */
export async function fetchLatestClose(pair: string): Promise<DailyClose> {
  const series = await fetchDailyTimeSeries(pair, 1);
  return series[series.length - 1];
}

/**
 * Probe whether a pair is supported on TwelveData.
 * Returns true if a 1-day fetch succeeds, false on any error.
 * Used by the bootstrap script before adding a pair.
 */
export async function isPairSupported(pair: string): Promise<boolean> {
  try {
    await fetchLatestClose(pair);
    return true;
  } catch {
    return false;
  }
}
