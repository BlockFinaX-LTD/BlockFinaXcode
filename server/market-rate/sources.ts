/**
 * Market-rate sources: public prices from trading platforms, read as USDT (or USDC) per local
 * currency, which is the dollar's market rate. Each reader returns quotes or throws; the
 * service keeps going when one source fails.
 */
import { advertsMid, midOf, type SourceQuote } from "./aggregate";

const TIMEOUT = 10_000;
const json = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${url.split("?")[0]} answered ${r.status}`);
  return r.json() as Promise<any>;
};
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

export const CURRENCIES = ["NGN", "GHS", "KES"] as const;
export type Ccy = (typeof CURRENCIES)[number];
const pairOf = (c: string) => `USD/${c}`;

/** Luno exchange: USDT/NGN order book top and 24h volume. */
export async function luno(): Promise<SourceQuote[]> {
  const out: SourceQuote[] = [];
  for (const [code, ccy] of [["USDTNGN", "NGN"]] as const) {
    const t = await json(`https://api.luno.com/api/1/ticker?pair=${code}`);
    const mid = midOf(n(t.bid), n(t.ask));
    if (mid) out.push({ source: "luno", kind: "exchange", pair: pairOf(ccy), bid: n(t.bid), ask: n(t.ask), mid, volumeUsd: n(t.rolling_24_hour_volume), at: Number(t.timestamp) || Date.now() });
  }
  return out;
}

/** Quidax exchange: USDT/NGN and USDT/GHS book top and 24h volume. */
export async function quidax(): Promise<SourceQuote[]> {
  const out: SourceQuote[] = [];
  for (const [code, ccy] of [["usdtngn", "NGN"], ["usdtghs", "GHS"]] as const) {
    const d = (await json(`https://app.quidax.io/api/v1/markets/tickers/${code}`)).data;
    const t = d?.ticker ?? {};
    const mid = midOf(n(t.buy), n(t.sell));
    if (mid) out.push({ source: "quidax", kind: "exchange", pair: pairOf(ccy), bid: n(t.buy), ask: n(t.sell), mid, volumeUsd: n(t.vol), at: (Number(d?.at) || Date.now() / 1000) * 1000 });
  }
  return out;
}

/** Bybit P2P: leading USDT adverts on each side. side "1" lists buyers (bid), "0" sellers (ask). */
export async function bybitP2p(): Promise<SourceQuote[]> {
  const out: SourceQuote[] = [];
  for (const ccy of CURRENCIES) {
    const side = async (s: "0" | "1") => {
      const r = (await json("https://api2.bybit.com/fiat/otc/item/online", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId: "USDT", currencyId: ccy, payment: [], side: s, size: "10", page: "1", amount: "" }),
      })).result ?? {};
      return { mid: advertsMid((r.items ?? []).map((i: any) => Number(i.price))), count: Number(r.count) || 0 };
    };
    const [bid, ask] = await Promise.all([side("1"), side("0")]);
    const mid = bid.mid && ask.mid ? midOf(Math.min(bid.mid, ask.mid), Math.max(bid.mid, ask.mid)) : (bid.mid ?? ask.mid);
    if (mid) out.push({ source: "bybit_p2p", kind: "p2p", pair: pairOf(ccy), bid: bid.mid, ask: ask.mid, mid, ads: bid.count + ask.count, at: Date.now() });
  }
  return out;
}

/** Binance P2P: leading USDT adverts. tradeType BUY lists sellers (ask), SELL lists buyers (bid). */
export async function binanceP2p(): Promise<SourceQuote[]> {
  const out: SourceQuote[] = [];
  for (const ccy of CURRENCIES) {
    const side = async (t: "BUY" | "SELL") => {
      const r = await json("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset: "USDT", fiat: ccy, tradeType: t, page: 1, rows: 10, payTypes: [], publisherType: null }),
      });
      const ads = (r.data ?? []) as any[];
      return { mid: advertsMid(ads.map((a) => Number(a.adv?.price))), count: Number(r.total) || ads.length };
    };
    const [ask, bid] = await Promise.all([side("BUY"), side("SELL")]);
    if (!ask.mid && !bid.mid) continue; // no market for this currency
    const mid = bid.mid && ask.mid ? midOf(Math.min(bid.mid, ask.mid), Math.max(bid.mid, ask.mid)) : (bid.mid ?? ask.mid);
    if (mid) out.push({ source: "binance_p2p", kind: "p2p", pair: pairOf(ccy), bid: bid.mid, ask: ask.mid, mid, ads: bid.count + ask.count, at: Date.now() });
  }
  return out;
}

/** Monierate composite index (trimmed mean of many providers). Needs the Rate_API key. */
export async function monierate(): Promise<SourceQuote[]> {
  const key = process.env.Rate_API || process.env.MONIERATE_API_KEY;
  if (!key) return [];
  const d = await json("https://api.monierate.com/core/index/snapshot", { headers: { api_key: key } });
  const snaps = (d?.data?.snapshots ?? []) as any[];
  // The index lists both USD and USDT versions of a pair: one source, so average them.
  const byCcy = new Map<string, { sum: number; k: number; at: number }>();
  for (const sn of snaps) {
    const code = String(sn.pair ?? "").toLowerCase();
    const ccy = CURRENCIES.find((c) => code === `usd${c.toLowerCase()}` || code === `usdt${c.toLowerCase()}`);
    const rate = n(sn.composite_rate);
    if (!ccy || !rate || !(rate > 0)) continue;
    const at = sn.timestamp ? Date.parse(sn.timestamp) : Date.now();
    const cur = byCcy.get(ccy) ?? { sum: 0, k: 0, at: 0 };
    byCcy.set(ccy, { sum: cur.sum + rate, k: cur.k + 1, at: Math.max(cur.at, at) });
  }
  return [...byCcy.entries()].map(([ccy, v]) => ({ source: "monierate", kind: "composite" as const, pair: pairOf(ccy), bid: null, ask: null, mid: v.sum / v.k, at: v.at }));
}

/** Every source with how often it is read. Monierate is paid per call, so it is read less often. */
export const SOURCES: { id: string; everyMs: number; read: () => Promise<SourceQuote[]> }[] = [
  { id: "luno", everyMs: 10_000, read: luno },
  { id: "quidax", everyMs: 10_000, read: quidax },
  { id: "bybit_p2p", everyMs: 15_000, read: bybitP2p },
  { id: "binance_p2p", everyMs: 30_000, read: binanceP2p },
  { id: "monierate", everyMs: Number(process.env.MONIERATE_EVERY_MS) || 15 * 60_000, read: monierate },
];
