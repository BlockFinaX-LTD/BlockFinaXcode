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

export const CURRENCIES = ["NGN", "GHS", "KES", "ZAR"] as const;
/** Peer-to-peer markets only matter where exchanges are thin; for the rand they trade at a premium. */
const P2P_CURRENCIES = ["NGN", "GHS", "KES"] as const;
export type Ccy = (typeof CURRENCIES)[number];
const pairOf = (c: string) => `USD/${c}`;

/**
 * An advert counts only if its advertiser was active recently: someone last seen hours or a
 * day ago may have left a price that no longer reflects the market.
 */
export const P2P_ACTIVE_MS = Number(process.env.P2P_ACTIVE_MS) || 60 * 60_000;
const recent = (ms: number | null | undefined) => ms != null && Number.isFinite(ms) && ms > 0 && Date.now() - ms <= P2P_ACTIVE_MS;

/** Weight basis for a P2P side: the platform's total adverts, scaled by the share of active ones we saw. */
const activeCount = (total: number, seen: number, active: number) => (seen > 0 ? Math.round(total * (active / seen)) : 0);

/** Luno exchange: USDT order book top and 24h volume, for the naira, shilling and rand. */
export async function luno(): Promise<SourceQuote[]> {
  const out: SourceQuote[] = [];
  const all = ((await json("https://api.luno.com/api/1/tickers")).tickers ?? []) as any[];
  for (const [code, ccy] of [["USDTNGN", "NGN"], ["USDTKES", "KES"], ["USDTZAR", "ZAR"]] as const) {
    const t = all.find((x) => x.pair === code);
    if (!t) continue;
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
  for (const ccy of P2P_CURRENCIES) {
    const side = async (s: "0" | "1") => {
      const r = (await json("https://api2.bybit.com/fiat/otc/item/online", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId: "USDT", currencyId: ccy, payment: [], side: s, size: "10", page: "1", amount: "" }),
      })).result ?? {};
      const items = (r.items ?? []) as any[];
      const live = items.filter((i) => i.isOnline === true || recent(Number(i.lastLogoutTime) * 1000));
      return { mid: advertsMid(live.map((i) => Number(i.price)), 5, s === "1" ? "bid" : "ask"), count: activeCount(Number(r.count) || items.length, items.length, live.length) };
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
  for (const ccy of P2P_CURRENCIES) {
    const side = async (t: "BUY" | "SELL") => {
      const r = await json("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset: "USDT", fiat: ccy, tradeType: t, page: 1, rows: 10, payTypes: [], publisherType: null }),
      });
      const ads = (r.data ?? []) as any[];
      const since = (a: any) => Number(a.advertiser?.activeTimeInSecond);
      const live = ads.filter((a) => Number.isFinite(since(a)) && since(a) * 1000 <= P2P_ACTIVE_MS);
      return { mid: advertsMid(live.map((a) => Number(a.adv?.price)), 5, t === "SELL" ? "bid" : "ask"), count: activeCount(Number(r.total) || ads.length, ads.length, live.length) };
    };
    const [ask, bid] = await Promise.all([side("BUY"), side("SELL")]);
    if (!ask.mid && !bid.mid) continue; // no market for this currency
    const mid = bid.mid && ask.mid ? midOf(Math.min(bid.mid, ask.mid), Math.max(bid.mid, ask.mid)) : (bid.mid ?? ask.mid);
    if (mid) out.push({ source: "binance_p2p", kind: "p2p", pair: pairOf(ccy), bid: bid.mid, ask: ask.mid, mid, ads: bid.count + ask.count, at: Date.now() });
  }
  return out;
}

/** VALR exchange (South Africa): USDT/ZAR book top and 24h volume. */
export async function valr(): Promise<SourceQuote[]> {
  const t = await json("https://api.valr.com/v1/public/USDTZAR/marketsummary");
  const mid = midOf(n(t.bidPrice), n(t.askPrice));
  return mid ? [{ source: "valr", kind: "exchange", pair: pairOf("ZAR"), bid: n(t.bidPrice), ask: n(t.askPrice), mid, volumeUsd: n(t.baseVolume), at: Date.parse(t.created) || Date.now() }] : [];
}

/** Busha: the buy and sell prices it quotes its own customers for USDT, naira and shilling. */
export async function busha(): Promise<SourceQuote[]> {
  const pairs = ((await json("https://api.busha.co/v1/pairs")).data ?? []) as any[];
  const out: SourceQuote[] = [];
  for (const ccy of ["NGN", "KES"] as const) {
    const p = pairs.find((x) => x.base === "USDT" && x.counter === ccy);
    if (!p) continue;
    const bid = n(p.sell_price?.amount), ask = n(p.buy_price?.amount); // what Busha pays, and what it charges
    const mid = midOf(bid, ask);
    if (mid) out.push({ source: "busha", kind: "dealer", pair: pairOf(ccy), bid, ask, mid, at: Date.now() });
  }
  return out;
}

/**
 * OKX P2P: leading USDT adverts. side=sell lists sellers (ask), side=buy lists buyers (bid), best
 * first. OKX gives no advertiser activity time, so every listed advert counts.
 */
export async function okxP2p(): Promise<SourceQuote[]> {
  const out: SourceQuote[] = [];
  for (const ccy of P2P_CURRENCIES) {
    const side = async (s: "buy" | "sell") => {
      const d = (await json(`https://www.okx.com/v3/c2c/tradingOrders/books?quoteCurrency=${ccy.toLowerCase()}&baseCurrency=usdt&side=${s}&paymentMethod=all&userType=all&receivingAds=false`, { headers: { "User-Agent": "Mozilla/5.0" } })).data ?? {};
      const ads = ((s === "buy" ? d.buy : d.sell) ?? []) as any[];
      return { mid: advertsMid(ads.slice(0, 10).map((a) => Number(a.price)), 5, s === "buy" ? "bid" : "ask"), count: ads.length };
    };
    const [bid, ask] = await Promise.all([side("buy"), side("sell")]);
    const mid = bid.mid && ask.mid ? midOf(Math.min(bid.mid, ask.mid), Math.max(bid.mid, ask.mid)) : (bid.mid ?? ask.mid);
    if (mid) out.push({ source: "okx_p2p", kind: "p2p", pair: pairOf(ccy), bid: bid.mid, ask: ask.mid, mid, ads: bid.count + ask.count, at: Date.now() });
  }
  return out;
}

/** Bitget P2P: leading USDT adverts. side 1 lists sellers (ask), side 2 buyers (bid). */
export async function bitgetP2p(): Promise<SourceQuote[]> {
  const out: SourceQuote[] = [];
  for (const ccy of P2P_CURRENCIES) {
    const side = async (sd: 1 | 2) => {
      const d = (await json("https://www.bitget.com/v1/p2p/pub/adv/queryAdvList", {
        method: "POST", headers: { "content-type": "application/json", "User-Agent": "Mozilla/5.0" },
        body: JSON.stringify({ side: sd, pageNo: 1, pageSize: 10, coinCode: "USDT", fiatCode: ccy, languageType: 0 }),
      })).data ?? {};
      const ads = (d.dataList ?? []) as any[];
      const live = ads.filter((a) => a.showOnline === true || recent(Number(a.adEditorTime)));
      return { mid: advertsMid(live.map((a) => Number(a.price)), 5, sd === 2 ? "bid" : "ask"), count: activeCount(Number(d.totalCount ?? d.total) || ads.length, ads.length, live.length) };
    };
    // One request at a time, with a pause: Bitget limits how often its pages can be read.
    const ask = await side(1);
    await new Promise((ok) => setTimeout(ok, 1500));
    const bid = await side(2);
    await new Promise((ok) => setTimeout(ok, 1500));
    const mid = bid.mid && ask.mid ? midOf(Math.min(bid.mid, ask.mid), Math.max(bid.mid, ask.mid)) : (bid.mid ?? ask.mid);
    if (mid) out.push({ source: "bitget_p2p", kind: "p2p", pair: pairOf(ccy), bid: bid.mid, ask: ask.mid, mid, ads: bid.count + ask.count, at: Date.now() });
  }
  return out;
}

/** KuCoin P2P: leading USDT adverts for the cedi and shilling. SELL lists sellers (ask), BUY buyers (bid). */
export async function kucoinP2p(): Promise<SourceQuote[]> {
  const out: SourceQuote[] = [];
  for (const ccy of ["GHS", "KES"] as const) {
    const side = async (sd: "SELL" | "BUY") => {
      const d = await json(`https://www.kucoin.com/_api/otc/ad/list?currency=USDT&side=${sd}&legal=${ccy}&page=1&pageSize=10&status=PUTUP&lang=en_US`, { headers: { "User-Agent": "Mozilla/5.0" } });
      const ads = (d.items ?? []) as any[];
      const live = ads.filter((a) => a.online === true || recent(Number(a.lastActiveTime)));
      return { mid: advertsMid(live.map((a) => Number(a.floatPrice ?? a.price)), 5, sd === "BUY" ? "bid" : "ask"), count: activeCount(Number(d.totalNum) || ads.length, ads.length, live.length) };
    };
    const [ask, bid] = await Promise.all([side("SELL"), side("BUY")]);
    const mid = bid.mid && ask.mid ? midOf(Math.min(bid.mid, ask.mid), Math.max(bid.mid, ask.mid)) : (bid.mid ?? ask.mid);
    if (mid) out.push({ source: "kucoin_p2p", kind: "p2p", pair: pairOf(ccy), bid: bid.mid, ask: ask.mid, mid, ads: bid.count + ask.count, at: Date.now() });
  }
  return out;
}

/** Monierate composite index (trimmed mean of many providers). Needs the Rate_API key. */
export async function monierate(): Promise<SourceQuote[]> {
  const key = process.env.Rate_API || process.env.MONIERATE_API_KEY;
  // Paid per call: MONIERATE=off keeps copies of the app (local runs) from spending the balance.
  if (!key || process.env.MONIERATE === "off") return [];
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
  { id: "valr", everyMs: 10_000, read: valr },
  { id: "busha", everyMs: 30_000, read: busha },
  { id: "okx_p2p", everyMs: 30_000, read: okxP2p },
  { id: "bitget_p2p", everyMs: 60_000, read: bitgetP2p },
  { id: "kucoin_p2p", everyMs: 30_000, read: kucoinP2p },
  { id: "monierate", everyMs: Number(process.env.MONIERATE_EVERY_MS) || 15 * 60_000, read: monierate },
];
