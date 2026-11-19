/**
 * Perps endpoints.
 *
 * Public
 *   GET  /api/perps/config                     contract, vault, insurance fund, engine state
 *   GET  /api/perps/markets                    every market with mark, index, funding, open interest
 *   GET  /api/perps/markets/:id/book           order book levels and recent trades
 *   GET  /api/perps/markets/:id/candles?i=1    candles (minutes per candle: 1, 5, 15, 60, 240, 1440)
 * Signed in (personal accounts)
 *   GET  /api/perps/account?key=<hex>          margin, positions, orders, fills, funding, key status
 *   POST /api/perps/orders                     { order, sig, tif }  order signed by the trading key
 *   POST /api/perps/orders/cancel              { hash } or { all: true, market? }
 *   POST /api/perps/prepare/deposit            { amount }
 *   POST /api/perps/prepare/withdraw           { amount }
 *   POST /api/perps/prepare/approve-key        { key, days }
 *   POST /api/perps/prepare/revoke-key         { key }
 *   POST /api/perps/prepare/emergency-close
 *   POST /api/perps/sync                       after a transaction lands
 */
import type { Express, Request, Response } from "express";
import { ApplicationError } from "@shared/domain/types";
import { PRICE_SCALE, SIZE_SCALE, USDC_SCALE, orderFromJson, type TimeInForce } from "@shared/perps";
import { chainRegistry } from "../chain/config";
import { PerpChain } from "./chain";
import { PerpEngine } from "./engine";

type Handler = (req: Request, res: Response) => Promise<void>;
interface Deps {
  getServices: () => Promise<any>;
  userId: (req: Request) => Promise<number>;
  ownerOn: (s: any, uid: number, chain: string) => Promise<string>;
  wrap: (h: Handler) => any;
}

let engine: PerpEngine | null | undefined;
let starting: Promise<PerpEngine | null> | null = null;

async function getEngine(): Promise<PerpEngine | null> {
  if (engine !== undefined) return engine;
  if (starting) return starting;
  starting = (async () => {
    const chain = chainRegistry()?.all().find((c) => c.family === "stellar" && c.contracts.perpClearinghouse);
    const { pool } = await import("../db");
    if (!chain || !pool || process.env.PERPS_ENGINE === "off") return (engine = null);
    const { getRate } = await import("../fx-oracle");
    const rate = async (pair: string) => {
      const r = await getRate(pair);
      const v = r ? Number(r.rate) : NaN;
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    const e = new PerpEngine(new PerpChain(chain), pool as never, rate);
    if (!process.env.PERP_OPERATOR_SECRET) {
      console.warn("[perps] PERP_OPERATOR_SECRET is not set: perps are read-only on this server");
      return (engine = e);
    }
    try {
      await e.start();
    } catch (err) {
      console.warn(`[perps] engine did not start: ${err instanceof Error ? err.message : err}`);
    }
    return (engine = e);
  })();
  return starting;
}

/** Start the engine with the server, so prices, funding and the vault run without a visitor. */
export function startPerpsInBackground() {
  setTimeout(() => void getEngine(), 5_000);
}

const usd = (b: bigint) => Number(b) / USDC_SCALE;

export function registerPerpsRoutes(app: Express, d: Deps) {
  // The contract's trading fee rates, read once (they change only by owner action).
  let feeCache: { takerBps: number; makerBps: number } | null = null;
  const feeRatesOnce = async (e: { chain: { feeRates(): Promise<{ takerBps: number; makerBps: number }> } }) => {
    if (feeCache) return feeCache;
    try { feeCache = await e.chain.feeRates(); return feeCache; } catch { return { takerBps: 5, makerBps: 0 }; }
  };

  const need = async () => {
    const e = await getEngine();
    if (!e) throw new ApplicationError("CHAIN_NOT_ENABLED", "Perps are not available on this network yet");
    return e;
  };
  const live = async () => {
    const e = await need();
    if (!e.started) throw new ApplicationError("CHAIN_NOT_ENABLED", "The perps engine is not running on this server");
    return e;
  };
  const me = async (req: Request) => {
    if (req.header("x-bfx-organisation")) throw new ApplicationError("INVALID_REQUEST", "Perps are available for personal accounts only, for now");
    const e = await need();
    const uid = await d.userId(req);
    const wallet = await d.ownerOn(await d.getServices(), uid, e.chain.chainKey);
    return { e, uid, wallet };
  };
  const market = (e: PerpEngine, v: unknown) => {
    const s = e.markets.get(Number(v));
    if (!s) throw new ApplicationError("INVALID_REQUEST", "That market does not exist");
    return s;
  };

  app.get("/api/perps/config", d.wrap(async (_req, res) => {
    const e = await getEngine();
    if (!e) { res.json({ enabled: false }); return; }
    const insurance = await e.chain.insurance().catch(() => 0n);
    const vault = e.vaultAddress() || (await e.chain.vaultAddress().catch(() => ""));
    const va = vault ? await e.chainAccount(vault, 15_000).catch(() => null) : null;
    res.json({
      enabled: true, running: e.started, contractId: e.chain.contractId, explorer: e.chain.explorer,
      insurance: usd(insurance), vault: { address: vault, equity: va ? usd(va.value) : null },
      lastError: e.started ? null : e.lastError,
    });
  }));

  app.get("/api/perps/markets", d.wrap(async (_req, res) => {
    const e = await need();
    if (!e.markets.size) await e.refreshMarkets();
    res.json({ markets: [...e.markets.values()].map((s) => e.marketView(s)) });
  }));

  app.get("/api/perps/markets/:id/book", d.wrap(async (req, res) => {
    const e = await need();
    const s = market(e, req.params.id);
    const depth = e.depth(s.chain.id, 20);
    res.json({ ...depth, trades: s.trades.slice(-40).reverse(), mark: s.mark, index: s.index });
  }));

  app.get("/api/perps/markets/:id/candles", d.wrap(async (req, res) => {
    const e = await need();
    const s = market(e, req.params.id);
    // Minutes per candle. 43200 = monthly; 0 = MAX (all history, monthly).
    const i = [0, 1, 5, 15, 30, 60, 120, 240, 1440, 10080, 43200].includes(Number(req.query.i)) ? Number(req.query.i) : 5;
    const live = e.candles(s.chain.id, i > 0 && i < 1440 ? i : 1440);
    if (i > 0 && i < 1440) {
      // Short timeframes: delayed market quotes, since the official rate fixes about once a day.
      const { intradayCandles } = await import("./intraday");
      const market = await intradayCandles(s.pair, i).catch(() => []);
      res.json({ candles: market.length ? market : live, source: market.length ? "market" : "mark" });
      return;
    }
    // Daily candles: the official rate's own history, then today's live candle.
    const { getRecentCloses } = await import("../pricing/data/historical");
    const lookback = i === 0 ? 20_000 : i === 43200 ? 3_700 : i === 10080 ? 1_500 : 400;
    const rows = (await getRecentCloses(s.pair, lookback).catch(() => [])) as any[];
    const today = new Date().toISOString().slice(0, 10);
    const daily = rows.filter((r) => String(r.date).slice(0, 10) < today).map((r, k, all) => {
      const c = Number(r.close), o = k > 0 ? Number(all[k - 1].close) : c;
      return { t: Date.parse(`${String(r.date).slice(0, 10)}T00:00:00Z`), o, h: Math.max(o, c), l: Math.min(o, c), c, v: 0 };
    });
    const t0 = Date.parse(`${today}T00:00:00Z`);
    const cur = live.filter((c) => c.t >= t0);
    const prev = daily[daily.length - 1]?.c ?? s.mark;
    const todayCandle = cur.length
      ? { t: t0, o: prev, h: Math.max(prev, ...cur.map((c) => c.h)), l: Math.min(prev, ...cur.map((c) => c.l)), c: s.mark, v: cur.reduce((a, c) => a + c.v, 0) }
      : { t: t0, o: prev, h: Math.max(prev, s.mark), l: Math.min(prev, s.mark), c: s.mark, v: 0 };
    const days = [...daily, todayCandle];
    if (i === 1440) { res.json({ candles: days.slice(-400), source: "official" }); return; }
    // Weekly (from Monday) or monthly (1M and MAX): daily candles grouped together.
    const bucketOf = (t: number) => {
      const dt = new Date(t);
      return i === 10080 ? t - ((dt.getUTCDay() + 6) % 7) * 86_400_000 : Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1);
    };
    const grouped: typeof days = [];
    for (const d of days) {
      const t = bucketOf(d.t);
      const g = grouped[grouped.length - 1];
      if (g && g.t === t) { g.h = Math.max(g.h, d.h); g.l = Math.min(g.l, d.l); g.c = d.c; g.v += d.v; }
      else grouped.push({ ...d, t });
    }
    res.json({ candles: i === 0 ? grouped : grouped.slice(-300), source: "official" });
  }));

  app.get("/api/perps/account", d.wrap(async (req, res) => {
    const { e, wallet } = await me(req);
    const a = await e.chainAccount(wallet, 3000);
    const m = await e.mirrorOf(wallet, a.collateral);
    const h = e.health(m);
    const key = typeof req.query.key === "string" && /^[0-9a-f]{64}$/.test(req.query.key) ? req.query.key : null;
    const keyExpiry = key ? await e.chain.keyExpiry(wallet, key).catch(() => 0) : 0;
    const positions = [...m.positions.entries()].map(([id, p]) => {
      const s = e.markets.get(id)!;
      const onChain = a.positions.find((x) => x.market === id);
      return {
        market: id, pair: s.pair, symbol: s.symbol, size: p.size, entry: p.entry, mark: s.mark,
        notional: Math.abs(p.size) * s.mark, upnl: p.size * (s.mark - p.entry),
        roe: p.entry ? (p.size * (s.mark - p.entry)) / ((Math.abs(p.size) * p.entry) / s.chain.maxLeverage) : 0,
        liquidationPrice: e.liquidationPrice(m, id),
        margin: (Math.abs(p.size) * s.mark) / s.chain.maxLeverage,
        fundingOwed: onChain ? usd(onChain.fundingOwed) : 0,
        adl: e.adlLights(id, p.size, p.entry, h.value),
        settled: Boolean(onChain && Number(onChain.size) / SIZE_SCALE === p.size),
        realized: null as null | { total: number; closing: number; fees: number; funding: number },
      };
    });
    const { pool } = await import("../db");
    // Realized PnL for each open position, Binance style: closing PnL from partial closes,
    // trading fees and funding paid since the position opened. Rebuilt from this account's
    // fills and the hourly funding events, in time order.
    const fees = await feeRatesOnce(e);
    const realized = new Map<number, { closing: number; fees: number; funding: number }>();
    if (m.positions.size) {
      const ids = [...m.positions.keys()];
      const fl = await pool!.query(
        `SELECT market, maker, taker, price, size, taker_buy, created_at FROM perp_fills WHERE (maker = $1 OR taker = $1) AND market = ANY($2::int[]) AND status <> 'failed' ORDER BY id`, [wallet, ids]);
      const fe = await pool!.query(`SELECT market, rate_ppm, applied_at FROM perp_funding WHERE market = ANY($1::int[]) ORDER BY id`, [ids]);
      type Ev = { at: number; kind: "fill"; f: any } | { at: number; kind: "fund"; f: any };
      const events: Ev[] = [
        ...fl.rows.map((f: any) => ({ at: new Date(f.created_at).getTime(), kind: "fill" as const, f })),
        ...fe.rows.map((f: any) => ({ at: new Date(f.applied_at).getTime(), kind: "fund" as const, f })),
      ].sort((a, b) => a.at - b.at);
      for (const id of ids) {
        let size = 0, entry = 0, r = { closing: 0, fees: 0, funding: 0 };
        for (const ev of events) {
          if (Number(ev.f.market) !== id) continue;
          if (ev.kind === "fund") { if (size) r.funding -= size * entry * (Number(ev.f.rate_ppm) / 1e6); continue; }
          const f = ev.f;
          const isTaker = f.taker === wallet;
          const buy = isTaker === f.taker_buy;
          const q = Number(f.size) / SIZE_SCALE, price = Number(f.price) / PRICE_SCALE;
          const delta = buy ? q : -q;
          r.fees -= q * price * ((isTaker ? fees.takerBps : fees.makerBps) / 10_000);
          if (size === 0 || Math.sign(size) === Math.sign(delta)) {
            entry = (Math.abs(size) * entry + q * price) / (Math.abs(size) + q);
            size += delta;
          } else {
            const closed = Math.min(Math.abs(delta), Math.abs(size)) * Math.sign(size);
            r.closing += closed * (price - entry);
            const next = size + delta;
            if (Math.abs(next) < 1e-12) { size = 0; entry = 0; r = { closing: 0, fees: 0, funding: 0 }; }
            else if (Math.sign(next) !== Math.sign(size)) { size = next; entry = price; r = { closing: 0, fees: r.fees, funding: 0 }; }
            else size = next;
          }
        }
        realized.set(id, r);
      }
    }
    const fills = await pool!.query(
      `SELECT id, market, maker, taker, price, size, taker_buy, status, tx, created_at FROM perp_fills WHERE maker = $1 OR taker = $1 ORDER BY id DESC LIMIT 60`, [wallet]);
    for (const p of positions) {
      const r = realized.get(p.market);
      if (r) p.realized = { total: r.closing + r.fees + r.funding, closing: r.closing, fees: r.fees, funding: r.funding };
    }
    const orders = await pool!.query(
      `SELECT hash, market, is_buy, price, size, remaining, tif, reduce_only, status, created_at FROM perp_orders WHERE account = $1 ORDER BY created_at DESC LIMIT 60`, [wallet]);
    const funding = await pool!.query(`SELECT market, rate_ppm, applied_at, tx FROM perp_funding WHERE market = ANY($1::int[]) ORDER BY id DESC LIMIT 48`, [[...m.positions.keys()]]);
    res.json({
      wallet,
      key: key ? { approved: keyExpiry > Date.now() / 1000, expiry: keyExpiry } : null,
      onChain: { collateral: usd(a.collateral), value: usd(a.value), initial: usd(a.initial), maintenance: usd(a.maintenance), withdrawable: usd(a.withdrawable) },
      equity: h.value, initial: h.initial, maintenance: h.maintenance, notional: h.notional,
      available: Math.max(0, h.value - h.initial),
      positions,
      openOrders: e.openOrders(wallet).map((r) => ({
        hash: r.hash, market: r.order.market, pair: e.markets.get(r.order.market)?.pair, isBuy: r.order.isBuy, price: Number(r.order.price) / PRICE_SCALE,
        size: Number(r.order.size) / SIZE_SCALE, remaining: Number(r.remaining) / SIZE_SCALE, tif: r.tif, reduceOnly: r.order.reduceOnly,
      })),
      fills: fills.rows.map((f: any) => ({
        id: f.id, market: f.market, pair: e.markets.get(f.market)?.pair, side: (f.taker === wallet) === f.taker_buy ? "buy" : "sell", role: f.taker === wallet ? "taker" : "maker",
        price: Number(f.price) / PRICE_SCALE, size: Number(f.size) / SIZE_SCALE, status: f.status, tx: f.tx, at: f.created_at,
      })),
      orderHistory: orders.rows.map((o: any) => ({
        hash: o.hash, market: o.market, pair: e.markets.get(o.market)?.pair, isBuy: o.is_buy, price: Number(o.price) / PRICE_SCALE,
        size: Number(o.size) / SIZE_SCALE, filled: (Number(o.size) - Number(o.remaining)) / SIZE_SCALE, tif: o.tif, status: o.status, at: o.created_at,
      })),
      funding: funding.rows.map((f: any) => ({ market: f.market, pair: e.markets.get(f.market)?.pair, rate: Number(f.rate_ppm) / 1e6, at: f.applied_at, tx: f.tx })),
    });
  }));

  app.post("/api/perps/orders", d.wrap(async (req, res) => {
    const { uid, wallet } = await me(req);
    const e = await live();
    const order = orderFromJson(req.body?.order);
    if (order.account !== wallet) throw new ApplicationError("UNAUTHORIZED", "Orders must come from your own account");
    const tif = (["gtc", "ioc", "alo"].includes(req.body?.tif) ? req.body.tif : "gtc") as TimeInForce;
    res.json(await e.place(order, String(req.body?.sig ?? "").toLowerCase(), tif, uid));
  }));

  app.post("/api/perps/orders/cancel", d.wrap(async (req, res) => {
    const { wallet } = await me(req);
    const e = await live();
    if (req.body?.all) { res.json({ cancelled: await e.cancelAll(wallet, req.body.market ? Number(req.body.market) : undefined) }); return; }
    res.json(await e.cancel(wallet, String(req.body?.hash ?? "")));
  }));

  const amountOf = (v: unknown) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) throw new ApplicationError("INVALID_REQUEST", "Enter an amount above zero");
    return BigInt(Math.round(n * USDC_SCALE));
  };

  app.post("/api/perps/prepare/deposit", d.wrap(async (req, res) => {
    const { e, wallet } = await me(req);
    res.json({ transactions: await e.chain.prepare("Deposit to perps", "deposit", { user: wallet, amount: amountOf(req.body?.amount) }) });
  }));
  app.post("/api/perps/prepare/withdraw", d.wrap(async (req, res) => {
    const { e, wallet } = await me(req);
    res.json({ transactions: await e.chain.prepare("Withdraw from perps", "withdraw", { user: wallet, amount: amountOf(req.body?.amount) }) });
  }));
  app.post("/api/perps/prepare/approve-key", d.wrap(async (req, res) => {
    const { e, wallet } = await me(req);
    const key = String(req.body?.key ?? "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) throw new ApplicationError("INVALID_REQUEST", "Not a valid trading key");
    const days = Math.min(179, Math.max(1, Number(req.body?.days) || 90));
    const expiry = BigInt(Math.floor(Date.now() / 1000) + days * 86_400);
    e.forgetKey(wallet, key);
    res.json({ transactions: await e.chain.prepare("Enable trading", "approve_key", { user: wallet, key: Buffer.from(key, "hex"), expiry }) });
  }));
  app.post("/api/perps/prepare/revoke-key", d.wrap(async (req, res) => {
    const { e, wallet } = await me(req);
    const key = String(req.body?.key ?? "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) throw new ApplicationError("INVALID_REQUEST", "Not a valid trading key");
    e.forgetKey(wallet, key);
    res.json({ transactions: await e.chain.prepare("Disable trading key", "revoke_key", { user: wallet, key: Buffer.from(key, "hex") }) });
  }));
  app.post("/api/perps/prepare/emergency-close", d.wrap(async (req, res) => {
    const { e, wallet } = await me(req);
    res.json({ transactions: await e.chain.prepare("Close all positions", "emergency_close", { user: wallet }) });
  }));
  app.post("/api/perps/sync", d.wrap(async (req, res) => {
    const { e, wallet } = await me(req);
    await e.sync(wallet);
    res.json({ ok: true });
  }));
}
