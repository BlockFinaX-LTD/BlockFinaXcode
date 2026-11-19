/**
 * Intraday candles for the perps chart: market quotes from Yahoo Finance (5 to 15 minutes
 * delayed). The official rate the perp tracks fixes about once a day, so on short timeframes
 * the chart shows how the market moved in between. The mark line on the chart is still the
 * perp's own mark.
 */
import { getPairSpec } from "../pricing/data/pairs";

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

/** Minutes per candle -> Yahoo interval, range and how many Yahoo bars make one candle. */
const PLAN: Record<number, { interval: string; range: string; merge: number }> = {
  1: { interval: "1m", range: "1d", merge: 1 },
  5: { interval: "5m", range: "5d", merge: 1 },
  15: { interval: "15m", range: "1mo", merge: 1 },
  30: { interval: "30m", range: "1mo", merge: 1 },
  60: { interval: "60m", range: "3mo", merge: 1 },
  120: { interval: "60m", range: "6mo", merge: 2 },
  240: { interval: "60m", range: "6mo", merge: 4 },
};
const cache = new Map<string, { at: number; candles: Candle[] }>();

function tickerFor(pair: string): string {
  const spec = getPairSpec(pair) as any;
  if (spec?.source === "yahoo" && spec.sourceSymbol) return spec.sourceSymbol;
  const [base, quote] = pair.split("/");
  return base === "USD" ? `${quote}=X` : `${base}${quote}=X`;
}

export async function intradayCandles(pair: string, minutes: number): Promise<Candle[]> {
  const plan = PLAN[minutes];
  if (!plan) return [];
  const key = `${pair}:${minutes}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.candles;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tickerFor(pair))}?interval=${plan.interval}&range=${plan.range}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo intraday ${res.status}`);
  const r = (await res.json())?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const bars: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if ([o, h, l, c].some((x) => typeof x !== "number" || !Number.isFinite(x))) continue;
    bars.push({ t: ts[i] * 1000, o, h, l, c, v: 0 });
  }
  const ms = minutes * 60_000;
  const out: Candle[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / ms) * ms;
    const last = out[out.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; }
    else out.push({ ...b, t });
  }
  void plan.merge;
  const candles = out.slice(-600);
  cache.set(key, { at: Date.now(), candles });
  return candles;
}
