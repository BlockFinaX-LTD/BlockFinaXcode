/**
 * The off-chain half of perps: one order book per market, matching, settlement batches, the
 * index and mark price, funding, the liquidity vault's quotes and liquidations.
 *
 * The engine is fast and the contract is final. The engine keeps a copy of each account's
 * margin so it can refuse orders that would fail on chain, but every fill is checked again by
 * the clearinghouse before money moves. Everything here runs in the app server process.
 *
 * Loops
 *   prices    every 5 s   index from the rate service, mark from the book; posted on chain every 20 s
 *   funding   every 5 s   one premium reading per market; once an hour the rate goes on chain
 *   vault     every 4 s   the vault re-quotes a ladder around mark, on published rules
 *   batcher   every 3 s   pending fills settle on chain, a few per transaction
 *   keeper    every 10 s  accounts below maintenance are liquidated
 */
import { createHash, randomBytes } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  PRICE_SCALE, SIZE_SCALE, USDC_SCALE, marketInfo, orderDigest, toHex,
  type PerpOrder, type TimeInForce, applyFill,
} from "@shared/perps";
import { ApplicationError } from "@shared/domain/types";
import type { ChainAccount, ChainFill, ChainMarket, PerpChain } from "./chain";

interface Db { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> }

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS perp_orders (
    hash text PRIMARY KEY,
    market integer NOT NULL,
    account text NOT NULL,
    user_id integer,
    is_buy boolean NOT NULL,
    price numeric NOT NULL,
    size numeric NOT NULL,
    remaining numeric NOT NULL,
    tif text NOT NULL,
    reduce_only boolean NOT NULL DEFAULT false,
    order_json jsonb NOT NULL,
    sig text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS perp_orders_account ON perp_orders (account, status);
  CREATE TABLE IF NOT EXISTS perp_fills (
    id serial PRIMARY KEY,
    market integer NOT NULL,
    maker text NOT NULL,
    taker text NOT NULL,
    maker_hash text NOT NULL,
    taker_hash text NOT NULL,
    price numeric NOT NULL,
    size numeric NOT NULL,
    taker_buy boolean NOT NULL,
    maker_order jsonb NOT NULL,
    taker_order jsonb NOT NULL,
    fee numeric NOT NULL DEFAULT 0,
    liquidation boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'pending',
    tx text,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz
  );
  CREATE INDEX IF NOT EXISTS perp_fills_maker ON perp_fills (maker);
  CREATE INDEX IF NOT EXISTS perp_fills_taker ON perp_fills (taker);
  CREATE INDEX IF NOT EXISTS perp_fills_market ON perp_fills (market, id);
  CREATE TABLE IF NOT EXISTS perp_funding (
    id serial PRIMARY KEY,
    market integer NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    rate_ppm bigint NOT NULL,
    premium double precision NOT NULL,
    readings integer NOT NULL,
    weekend boolean NOT NULL,
    commitment text NOT NULL,
    tx text
  );
  ALTER TABLE perp_funding ADD COLUMN IF NOT EXISTS index_price double precision;
  CREATE TABLE IF NOT EXISTS perp_candles (
    market integer NOT NULL,
    t bigint NOT NULL,
    o double precision NOT NULL, h double precision NOT NULL, l double precision NOT NULL, c double precision NOT NULL,
    v double precision NOT NULL DEFAULT 0,
    PRIMARY KEY (market, t)
  );
  CREATE TABLE IF NOT EXISTS perp_index_hold (
    market integer PRIMARY KEY,
    index_price double precision NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS perp_liquidations (
    id serial PRIMARY KEY,
    account text NOT NULL,
    notional double precision,
    tx text,
    at timestamptz NOT NULL DEFAULT now()
  );
`;

/** Vault quoting rules, published in the design: half-spread and step per level, in basis points. */
const VAULT_RULES: Record<string, { halfSpreadBps: number; stepBps: number; levelUsd: number; levels: number }> = {
  USDNGN: { halfSpreadBps: 12, stepBps: 8, levelUsd: 25_000, levels: 8 },
  USDGHS: { halfSpreadBps: 12, stepBps: 8, levelUsd: 20_000, levels: 8 },
  USDKES: { halfSpreadBps: 6, stepBps: 4, levelUsd: 25_000, levels: 8 },
  USDZAR: { halfSpreadBps: 3, stepBps: 2, levelUsd: 40_000, levels: 8 },
};
const DEFAULT_RULE = { halfSpreadBps: 15, stepBps: 10, levelUsd: 15_000, levels: 6 };
/** Funding settings (Hyperliquid's): 0.01% interest per 8 hours, premium clamp ±0.05%. */
const INTEREST_8H = 0.0001;
const CLAMP_8H = 0.0005;
const IMPACT_USD = 10_000;
const EMA_WINDOW_S = 150;
const MAX_FILLS_PER_TX = 6;

interface Resting {
  hash: string;
  order: PerpOrder;
  sig: string;
  remaining: bigint;
  tif: TimeInForce;
  isVault: boolean;
  seq: number;
  userId: number | null;
}
interface Book { bids: Resting[]; asks: Resting[] }
interface Trade { price: number; size: number; takerBuy: boolean; t: number }
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

interface MarketState {
  chain: ChainMarket;
  symbol: string;
  pair: string;
  index: number;
  mark: number;
  heldIndex: number | null;
  basisEma: number;
  weekend: boolean;
  lastTrade: number | null;
  readings: number[];
  lastPushed: number;
  trades: Trade[];
  candles: Candle[];
  fundingRatePpm: number; // last applied
}

/** The engine's copy of an account: enough to refuse orders that would fail on chain. */
interface Mirror {
  collateral: number; // USDC
  positions: Map<number, { size: number; entry: number }>; // units, price
  syncedAt: number;
  /** The on-chain collateral this copy was built from, to notice deposits and withdrawals. */
  chainCollateral: bigint;
}

const num = (b: bigint, scale: number) => Number(b) / scale;
const median3 = (a: number, b: number, c: number) => [a, b, c].sort((x, y) => x - y)[1];
const isWeekend = (d = new Date()) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

export class PerpEngine {
  readonly markets = new Map<number, MarketState>();
  private books = new Map<number, Book>();
  private mirrors = new Map<string, Mirror>();
  private seq = 0;
  private vaultAddr = "";
  private vaultKey: Keypair | null = null;
  private vaultKeyHex = "";
  private settling = false;
  private timers: NodeJS.Timeout[] = [];
  private keyCache = new Map<string, { expiry: number; at: number }>();
  private chainAccounts = new Map<string, { at: number; value: ChainAccount }>();
  started = false;
  lastError: string | null = null;

  constructor(readonly chain: PerpChain, private readonly db: Db, private readonly getRate: (pair: string) => Promise<number | null>, private readonly env: NodeJS.ProcessEnv = process.env) {}

  // ── start-up ────────────────────────────────────────────────────────────

  async start() {
    if (this.started) return;
    await this.db.query(SCHEMA);
    this.vaultAddr = await this.chain.vaultAddress();
    const vk = this.env.PERP_VAULT_KEY_SECRET;
    if (vk) {
      this.vaultKey = Keypair.fromSecret(vk);
      this.vaultKeyHex = toHex(this.vaultKey.rawPublicKey());
    }
    await this.refreshMarkets();
    for (const m of this.markets.values()) {
      const held = await this.db.query(`SELECT index_price FROM perp_index_hold WHERE market = $1`, [m.chain.id]);
      m.heldIndex = held.rows[0] ? Number(held.rows[0].index_price) : null;
      const c = await this.db.query(`SELECT t, o, h, l, c, v FROM perp_candles WHERE market = $1 AND t > $2 ORDER BY t`, [m.chain.id, Date.now() - 7 * 86_400_000]);
      m.candles = c.rows.map((r) => ({ t: Number(r.t), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
      const tr = await this.db.query(`SELECT price, size, taker_buy, created_at FROM perp_fills WHERE market = $1 AND status <> 'failed' ORDER BY id DESC LIMIT 50`, [m.chain.id]);
      m.trades = tr.rows.map((r) => ({ price: num(BigInt(r.price), PRICE_SCALE), size: num(BigInt(r.size), SIZE_SCALE), takerBuy: r.taker_buy, t: new Date(r.created_at).getTime() })).reverse();
      m.lastTrade = m.trades.length ? m.trades[m.trades.length - 1].price : null;
      const f = await this.db.query(`SELECT rate_ppm FROM perp_funding WHERE market = $1 ORDER BY id DESC LIMIT 1`, [m.chain.id]);
      m.fundingRatePpm = f.rows[0] ? Number(f.rows[0].rate_ppm) : 0;
    }
    // Resting user orders come back; the vault re-quotes on its own.
    const open = await this.db.query(`SELECT * FROM perp_orders WHERE status = 'open' AND remaining > 0`);
    const now = Math.floor(Date.now() / 1000);
    for (const r of open.rows) {
      const o = this.parseStored(r.order_json);
      if (Number(o.expiry) < now) { await this.setStatus(r.hash, "expired"); continue; }
      this.rest({ hash: r.hash, order: o, sig: r.sig, remaining: BigInt(r.remaining), tif: r.tif, isVault: false, seq: ++this.seq, userId: r.user_id });
    }
    this.started = true;
    await this.pricesTick(true).catch((e) => this.note("prices", e));
    const every = (ms: number, fn: () => Promise<unknown>, name: string) => {
      let busy = false;
      this.timers.push(setInterval(async () => {
        if (busy) return;
        busy = true;
        try { await fn(); } catch (e) { this.note(name, e); } finally { busy = false; }
      }, ms));
    };
    every(5_000, () => this.pricesTick(false), "prices");
    every(5_000, () => this.fundingTick(), "funding");
    every(4_000, () => this.vaultTick(), "vault");
    every(3_000, () => this.settleTick(), "batcher");
    every(10_000, () => this.keeperTick(), "keeper");
    every(60_000, () => this.refreshMarkets(), "markets");
    console.log(`[perps] engine started: ${this.markets.size} markets, vault ${this.vaultAddr}${this.vaultKey ? "" : " (no vault key: vault will not quote)"}`);
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.started = false;
  }

  private note(where: string, e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    this.lastError = `${where}: ${msg.slice(0, 300)}`;
    console.warn(`[perps] ${where}: ${msg.slice(0, 300)}`);
  }

  private parseStored(j: any): PerpOrder {
    return { account: j.account, key: j.key, market: Number(j.market), isBuy: Boolean(j.isBuy), price: BigInt(j.price), size: BigInt(j.size), nonce: BigInt(j.nonce), expiry: BigInt(j.expiry), reduceOnly: Boolean(j.reduceOnly) };
  }
  private storeOrder(o: PerpOrder) {
    return { ...o, price: String(o.price), size: String(o.size), nonce: String(o.nonce), expiry: String(o.expiry) };
  }

  async refreshMarkets() {
    const list = await this.chain.markets();
    for (const c of list) {
      const existing = this.markets.get(c.id);
      if (existing) { existing.chain = c; continue; }
      const info = marketInfo(c.symbol);
      this.markets.set(c.id, {
        chain: c, symbol: c.symbol, pair: info.pair, index: num(c.index, PRICE_SCALE), mark: num(c.mark, PRICE_SCALE), heldIndex: null,
        basisEma: 0, weekend: c.weekend, lastTrade: null, readings: [], lastPushed: c.priceAt * 1000, trades: [], candles: [], fundingRatePpm: 0,
      });
      this.books.set(c.id, { bids: [], asks: [] });
    }
  }

  // ── book helpers ────────────────────────────────────────────────────────

  book(market: number): Book {
    const b = this.books.get(market);
    if (!b) throw new ApplicationError("INVALID_REQUEST", "That market does not exist");
    return b;
  }
  private rest(r: Resting) {
    const b = this.book(r.order.market);
    const side = r.order.isBuy ? b.bids : b.asks;
    side.push(r);
    side.sort((x, y) => {
      const d = r.order.isBuy ? Number(y.order.price - x.order.price) : Number(x.order.price - y.order.price);
      return d !== 0 ? d : x.seq - y.seq;
    });
  }
  private removeResting(market: number, hash: string) {
    const b = this.book(market);
    b.bids = b.bids.filter((r) => r.hash !== hash);
    b.asks = b.asks.filter((r) => r.hash !== hash);
  }
  bestBid(market: number, excludeVault = false) {
    return this.book(market).bids.find((r) => !excludeVault || !r.isVault);
  }
  bestAsk(market: number, excludeVault = false) {
    return this.book(market).asks.find((r) => !excludeVault || !r.isVault);
  }

  /** Average price to trade `usd` of notional into one side of the book. */
  private impact(levels: Resting[], usd: number): number | null {
    let left = usd, units = 0, cost = 0;
    for (const r of levels) {
      const p = num(r.order.price, PRICE_SCALE);
      const avail = num(r.remaining, SIZE_SCALE) * p;
      const take = Math.min(avail, left);
      units += take / p;
      cost += take;
      left -= take;
      if (left <= 1e-9) return cost / units;
    }
    return null;
  }

  depth(market: number, levels = 20) {
    const agg = (side: Resting[]) => {
      const out: { price: number; size: number; count: number; vault: number }[] = [];
      for (const r of side) {
        const p = num(r.order.price, PRICE_SCALE);
        const s = num(r.remaining, SIZE_SCALE);
        const last = out[out.length - 1];
        if (last && last.price === p) { last.size += s; last.count++; if (r.isVault) last.vault += s; } else { if (out.length >= levels) break; out.push({ price: p, size: s, count: 1, vault: r.isVault ? s : 0 }); }
      }
      return out;
    };
    const b = this.book(market);
    return { bids: agg(b.bids), asks: agg(b.asks) };
  }

  openOrders(account: string) {
    const out: Resting[] = [];
    for (const b of this.books.values()) for (const r of [...b.bids, ...b.asks]) if (r.order.account === account && !r.isVault) out.push(r);
    return out;
  }

  // ── accounts ────────────────────────────────────────────────────────────

  async chainAccount(who: string, maxAgeMs = 4000): Promise<ChainAccount> {
    const c = this.chainAccounts.get(who);
    if (c && Date.now() - c.at < maxAgeMs) return c.value;
    const value = await this.chain.account(who);
    this.chainAccounts.set(who, { at: Date.now(), value });
    return value;
  }

  /** Re-read an account from chain, then re-apply fills that have not settled yet. */
  async sync(who: string) {
    const a = await this.chainAccount(who, 0);
    const m: Mirror = { collateral: num(a.collateral, USDC_SCALE), positions: new Map(), syncedAt: Date.now(), chainCollateral: a.collateral };
    for (const p of a.positions) m.positions.set(p.market, { size: num(p.size, SIZE_SCALE), entry: num(p.entry, PRICE_SCALE) });
    m.collateral -= a.positions.reduce((s, p) => s + num(p.fundingOwed, USDC_SCALE), 0);
    const pending = await this.db.query(`SELECT market, maker, taker, price, size, taker_buy FROM perp_fills WHERE status = 'pending' AND (maker = $1 OR taker = $1) ORDER BY id`, [who]);
    for (const f of pending.rows) {
      const buy = (f.taker === who) === f.taker_buy;
      this.applyToMirror(m, Number(f.market), buy ? num(BigInt(f.size), SIZE_SCALE) : -num(BigInt(f.size), SIZE_SCALE), num(BigInt(f.price), PRICE_SCALE), 0);
    }
    this.mirrors.set(who, m);
    return m;
  }

  private async mirror(who: string): Promise<Mirror> {
    const m = this.mirrors.get(who);
    if (m && Date.now() - m.syncedAt < 30_000) return m;
    return this.sync(who);
  }

  private applyToMirror(m: Mirror, market: number, delta: number, price: number, fee: number) {
    const r = applyFill(m.positions.get(market) ?? { size: 0, entry: 0 }, delta, price);
    m.collateral += r.realized - fee;
    if (r.size === 0) m.positions.delete(market); else m.positions.set(market, { size: r.size, entry: r.entry });
  }

  /** The contract's trading fee rates: re-read every 10 minutes, or after a minute if a read failed. */
  private fees = { takerBps: 5, makerBps: 0 };
  private feesAt = 0;
  private feesOk = false;
  async feeRates() {
    if (Date.now() - this.feesAt > (this.feesOk ? 10 * 60_000 : 60_000)) {
      this.feesAt = Date.now();
      try { this.fees = await this.chain.feeRates(); this.feesOk = true; } catch { this.feesOk = false; }
    }
    return this.fees;
  }

  /** Value, initial and maintenance margin of a mirror at current marks. */
  health(m: Mirror) {
    let value = m.collateral, initial = 0, maintenance = 0, notional = 0;
    for (const [id, p] of m.positions) {
      const s = this.markets.get(id);
      if (!s) continue;
      value += p.size * (s.mark - p.entry);
      const n = Math.abs(p.size) * s.mark;
      notional += n;
      initial += n / s.chain.maxLeverage;
      maintenance += (n * s.chain.maintBps) / 10_000;
    }
    return { value, initial, maintenance, notional };
  }

  /** Margin held back by resting orders that would add risk. */
  private restingMargin(account: string, excludeHash?: string) {
    let total = 0;
    for (const r of this.openOrders(account)) {
      if (r.hash === excludeHash || r.order.reduceOnly) continue;
      const s = this.markets.get(r.order.market);
      if (!s) continue;
      total += (num(r.remaining, SIZE_SCALE) * num(r.order.price, PRICE_SCALE)) / s.chain.maxLeverage;
    }
    return total;
  }

  private async keyApproved(account: string, keyHex: string) {
    const k = `${account}:${keyHex}`;
    const c = this.keyCache.get(k);
    if (c && Date.now() - c.at < 60_000) return c.expiry > Date.now() / 1000;
    const expiry = await this.chain.keyExpiry(account, keyHex);
    this.keyCache.set(k, { expiry, at: Date.now() });
    return expiry > Date.now() / 1000;
  }
  forgetKey(account: string, keyHex: string) {
    this.keyCache.delete(`${account}:${keyHex}`);
  }

  // ── orders ──────────────────────────────────────────────────────────────

  verify(order: PerpOrder, sigHex: string): string {
    const digest = orderDigest(this.chain.contractId, order);
    const kp = Keypair.fromPublicKey(StrKey.encodeEd25519PublicKey(Buffer.from(order.key, "hex")));
    if (!/^[0-9a-f]{128}$/.test(sigHex) || !kp.verify(Buffer.from(digest), Buffer.from(sigHex, "hex"))) {
      throw new ApplicationError("INVALID_REQUEST", "The order signature does not match. Enable trading again on this device.");
    }
    return toHex(digest);
  }

  async place(order: PerpOrder, sig: string, tif: TimeInForce, userId: number | null) {
    const s = this.markets.get(order.market);
    if (!s) throw new ApplicationError("INVALID_REQUEST", "That market does not exist");
    const now = Math.floor(Date.now() / 1000);
    if (s.chain.status === 3) throw new ApplicationError("INVALID_REQUEST", "This market is delisted");
    if (s.chain.status === 0) throw new ApplicationError("INVALID_REQUEST", "This market is not open yet");
    if (s.chain.status === 2 && !order.reduceOnly) throw new ApplicationError("INVALID_REQUEST", "This market is reduce-only: you can only close positions");
    if (order.size <= 0n || order.price <= 0n) throw new ApplicationError("INVALID_REQUEST", "Enter a size and price above zero");
    if (Number(order.expiry) < now + 5 || Number(order.expiry) > now + 29 * 86_400) throw new ApplicationError("INVALID_REQUEST", "The order expiry is out of range");
    const hash = this.verify(order, sig);
    if (!(await this.keyApproved(order.account, order.key))) throw new ApplicationError("INVALID_REQUEST", "Your trading key is not approved. Enable trading first.");
    const dup = await this.db.query(`SELECT 1 FROM perp_orders WHERE hash = $1`, [hash]);
    if (dup.rowCount) throw new ApplicationError("INVALID_REQUEST", "This order was already sent");

    let m = await this.mirror(order.account);
    const pos = m.positions.get(order.market)?.size ?? 0;
    const sizeN = num(order.size, SIZE_SCALE);
    const priceN = num(order.price, PRICE_SCALE);
    const delta = order.isBuy ? sizeN : -sizeN;
    if (order.reduceOnly && (pos === 0 || Math.sign(pos) === Math.sign(delta))) throw new ApplicationError("INVALID_REQUEST", "Reduce-only: there is no position to reduce on this side");

    // Margin: the position after a full fill, plus margin held by other resting orders.
    const after = Math.abs(pos + delta);
    if (!order.reduceOnly && after > Math.abs(pos)) {
      const extra = (after - Math.abs(pos)) * Math.max(priceN, s.mark) / s.chain.maxLeverage;
      const short = () => { const h = this.health(m); return h.value * 0.995 < h.initial + extra + this.restingMargin(order.account); };
      // A deposit may have landed since the copy was made: read the chain again before refusing.
      if (short()) m = await this.sync(order.account);
      if (short()) {
        throw new ApplicationError("INVALID_REQUEST", "Not enough margin for this order. Deposit more USDC or lower the size or leverage.");
      }
    }

    const b = this.book(order.market);
    const opposite = order.isBuy ? b.asks : b.bids;
    const crosses = (r: Resting) => (order.isBuy ? r.order.price <= order.price : r.order.price >= order.price);
    if (tif === "alo" && opposite[0] && crosses(opposite[0])) throw new ApplicationError("INVALID_REQUEST", "Post-only: this price would trade at once");

    await this.db.query(
      `INSERT INTO perp_orders (hash, market, account, user_id, is_buy, price, size, remaining, tif, reduce_only, order_json, sig, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,'open')`,
      [hash, order.market, order.account, userId, order.isBuy, String(order.price), String(order.size), tif, order.reduceOnly, this.storeOrder(order), sig],
    );

    let remaining = order.size;
    const fills: { price: number; size: number }[] = [];
    const rest: Resting = { hash, order, sig, remaining, tif, isVault: false, seq: ++this.seq, userId };
    while (remaining > 0n && opposite.length && crosses(opposite[0])) {
      const maker = opposite[0];
      if (maker.order.account === order.account) { // never trade with yourself: the older order goes
        opposite.shift();
        await this.setStatus(maker.hash, "cancelled");
        continue;
      }
      if (Number(maker.order.expiry) <= now + 2) { opposite.shift(); if (!maker.isVault) await this.setStatus(maker.hash, "expired"); continue; }
      let size = remaining < maker.remaining ? remaining : maker.remaining;
      // Reduce-only can never flip the position.
      if (order.reduceOnly) {
        const cur = Math.abs((await this.mirror(order.account)).positions.get(order.market)?.size ?? 0);
        const cap = BigInt(Math.floor(cur * SIZE_SCALE));
        if (cap <= 0n) break;
        if (size > cap) size = cap;
      }
      // Check the maker still has margin; if not, its order goes.
      if (!maker.isVault && !maker.order.reduceOnly) {
        const mm = await this.mirror(maker.order.account);
        const mpos = mm.positions.get(order.market)?.size ?? 0;
        const md = maker.order.isBuy ? num(size, SIZE_SCALE) : -num(size, SIZE_SCALE);
        if (Math.abs(mpos + md) > Math.abs(mpos)) {
          const mh = this.health(mm);
          const add = (Math.abs(mpos + md) - Math.abs(mpos)) * num(maker.order.price, PRICE_SCALE) / s.chain.maxLeverage;
          if (mh.value * 0.995 < mh.initial + add) { opposite.shift(); await this.setStatus(maker.hash, "cancelled"); continue; }
        }
      }
      await this.recordFill(s, maker, rest, maker.order.price, size);
      fills.push({ price: num(maker.order.price, PRICE_SCALE), size: num(size, SIZE_SCALE) });
      remaining -= size;
      maker.remaining -= size;
      if (maker.remaining <= 0n) { opposite.shift(); if (!maker.isVault) await this.setStatus(maker.hash, "filled"); }
      else if (!maker.isVault) await this.db.query(`UPDATE perp_orders SET remaining = $2, updated_at = now() WHERE hash = $1`, [maker.hash, String(maker.remaining)]);
    }

    rest.remaining = remaining;
    let status: string;
    if (remaining === 0n) status = "filled";
    else if (tif === "ioc") status = fills.length ? "filled" : "cancelled";
    else { status = "open"; this.rest(rest); }
    await this.db.query(`UPDATE perp_orders SET remaining = $2, status = $3, updated_at = now() WHERE hash = $1`, [hash, String(remaining), status]);
    return { hash, status, filled: num(order.size - remaining, SIZE_SCALE), fills };
  }

  private async recordFill(s: MarketState, maker: Resting, taker: Resting, price: bigint, size: bigint) {
    const p = num(price, PRICE_SCALE), z = num(size, SIZE_SCALE);
    const takerBuy = taker.order.isBuy;
    await this.db.query(
      `INSERT INTO perp_fills (market, maker, taker, maker_hash, taker_hash, price, size, taker_buy, maker_order, taker_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [s.chain.id, maker.order.account, taker.order.account, maker.hash, taker.hash, String(price), String(size), takerBuy,
        { order: this.storeOrder(maker.order), sig: maker.sig }, { order: this.storeOrder(taker.order), sig: taker.sig }],
    );
    const notional = p * z;
    const mm = await this.mirror(maker.order.account);
    const tm = await this.mirror(taker.order.account);
    this.applyToMirror(mm, s.chain.id, maker.order.isBuy ? z : -z, p, notional * (this.fees.makerBps / 10_000));
    this.applyToMirror(tm, s.chain.id, takerBuy ? z : -z, p, notional * (this.fees.takerBps / 10_000));
    s.lastTrade = p;
    s.trades.push({ price: p, size: z, takerBuy, t: Date.now() });
    if (s.trades.length > 100) s.trades.splice(0, s.trades.length - 100);
    this.candle(s, s.mark, notional); // candles follow mark; trades add volume
  }

  async cancel(account: string, hash: string) {
    const r = await this.db.query(`SELECT market, account, status FROM perp_orders WHERE hash = $1`, [hash]);
    const row = r.rows[0];
    if (!row || row.account !== account) throw new ApplicationError("INVALID_REQUEST", "Order not found");
    if (row.status !== "open") return { hash, status: row.status };
    this.removeResting(Number(row.market), hash);
    await this.setStatus(hash, "cancelled");
    return { hash, status: "cancelled" };
  }

  async cancelAll(account: string, market?: number) {
    let n = 0;
    for (const r of this.openOrders(account)) {
      if (market && r.order.market !== market) continue;
      this.removeResting(r.order.market, r.hash);
      await this.setStatus(r.hash, "cancelled");
      n++;
    }
    return n;
  }

  private async setStatus(hash: string, status: string) {
    await this.db.query(`UPDATE perp_orders SET status = $2, updated_at = now() WHERE hash = $1`, [hash, status]);
  }

  // ── prices ──────────────────────────────────────────────────────────────

  private async pricesTick(force: boolean) {
    const weekend = isWeekend();
    const updates: { market: number; index: bigint; mark: bigint; weekend: boolean }[] = [];
    for (const s of this.markets.values()) {
      const live = await this.getRate(s.pair).catch(() => null);
      let index: number;
      if (weekend) {
        // Weekend mode: the index stays at the last business-day value.
        if (s.heldIndex == null && live) { s.heldIndex = live; await this.holdIndex(s.chain.id, live); }
        index = s.heldIndex ?? live ?? s.index;
      } else {
        index = live ?? s.index;
        if (live && s.heldIndex !== live) { s.heldIndex = live; await this.holdIndex(s.chain.id, live); }
      }
      if (!index || !Number.isFinite(index)) continue;
      s.index = index;
      s.weekend = weekend;
      const bid = this.bestBid(s.chain.id), ask = this.bestAsk(s.chain.id);
      const bidP = bid ? num(bid.order.price, PRICE_SCALE) : null, askP = ask ? num(ask.order.price, PRICE_SCALE) : null;
      if (bidP && askP) {
        const basis = ((bidP + askP) / 2 - index) / index;
        const alpha = 5 / EMA_WINDOW_S;
        s.basisEma = s.basisEma + alpha * (basis - s.basisEma);
      }
      const bookMid = median3(bidP ?? index, askP ?? index, s.lastTrade ?? index);
      let mark = median3(index * (1 + s.basisEma), bookMid, index);
      const band = ((weekend ? s.chain.weekendBandBps : s.chain.markBandBps) / 10_000) * 0.9;
      mark = Math.min(index * (1 + band), Math.max(index * (1 - band), mark));
      s.mark = mark;
      this.candle(s, mark, 0);
      updates.push({ market: s.chain.id, index: BigInt(Math.round(index * PRICE_SCALE)), mark: BigInt(Math.round(mark * PRICE_SCALE)), weekend });
    }
    const oldest = Math.min(...[...this.markets.values()].map((s) => s.lastPushed));
    if (updates.length && (force || Date.now() - oldest > 20_000)) {
      await this.chain.pushPrices(updates);
      for (const s of this.markets.values()) s.lastPushed = Date.now();
    }
  }

  private async holdIndex(market: number, price: number) {
    await this.db.query(`INSERT INTO perp_index_hold (market, index_price, at) VALUES ($1,$2,now()) ON CONFLICT (market) DO UPDATE SET index_price = $2, at = now()`, [market, price]);
  }

  private candle(s: MarketState, price: number, volume: number) {
    const t = Math.floor(Date.now() / 60_000) * 60_000;
    let c = s.candles[s.candles.length - 1];
    if (!c || c.t !== t) {
      if (c) void this.db.query(`INSERT INTO perp_candles (market, t, o, h, l, c, v) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (market, t) DO UPDATE SET h = $4, l = $5, c = $6, v = $7`, [s.chain.id, c.t, c.o, c.h, c.l, c.c, c.v]).catch(() => undefined);
      c = { t, o: c?.c ?? price, h: Math.max(c?.c ?? price, price), l: Math.min(c?.c ?? price, price), c: price, v: 0 };
      s.candles.push(c);
      if (s.candles.length > 7 * 1440) s.candles.splice(0, s.candles.length - 7 * 1440);
    }
    c.h = Math.max(c.h, price);
    c.l = Math.min(c.l, price);
    c.c = price;
    c.v += volume;
  }

  candles(market: number, intervalMin: number) {
    const s = this.markets.get(market);
    if (!s) return [];
    const ms = intervalMin * 60_000;
    const out: Candle[] = [];
    for (const c of s.candles) {
      const t = Math.floor(c.t / ms) * ms;
      const last = out[out.length - 1];
      if (last && last.t === t) { last.h = Math.max(last.h, c.h); last.l = Math.min(last.l, c.l); last.c = c.c; last.v += c.v; }
      else out.push({ ...c, t });
    }
    return out.slice(-300);
  }

  // ── funding ─────────────────────────────────────────────────────────────

  /** One premium reading per market, from other traders' orders only (never the vault's). */
  private async fundingTick() {
    for (const s of this.markets.values()) {
      const b = this.book(s.chain.id);
      const ib = this.impact(b.bids.filter((r) => !r.isVault), IMPACT_USD);
      const ia = this.impact(b.asks.filter((r) => !r.isVault), IMPACT_USD);
      const premium = ib != null && ia != null ? (Math.max(0, ib - s.index) - Math.max(0, s.index - ia)) / s.index : 0;
      s.readings.push(premium);
      if (s.readings.length > 800) s.readings.shift();
      if (Date.now() / 1000 - s.chain.fundingAt >= 3600 && Date.now() - s.lastPushed < 60_000) await this.applyFunding(s);
    }
  }

  predictedRate(s: MarketState) {
    const P = s.readings.length ? s.readings.reduce((a, b) => a + b, 0) / s.readings.length : 0;
    const premium = s.weekend ? 0 : P; // weekend mode: interest only
    const f8 = premium + Math.max(-CLAMP_8H, Math.min(CLAMP_8H, INTEREST_8H - premium));
    const cap = Number(s.chain.fundingCapPpm) / 1e6;
    return { hourly: Math.max(-cap, Math.min(cap, f8 / 8)), premium: P };
  }

  private async applyFunding(s: MarketState) {
    const { hourly, premium } = this.predictedRate(s);
    const ratePpm = BigInt(Math.round(hourly * 1e6));
    const readings = s.readings.splice(0, s.readings.length);
    const commitment = createHash("sha256").update(JSON.stringify({ market: s.chain.id, readings, weekend: s.weekend, at: Math.floor(Date.now() / 1000) })).digest("hex");
    const tx = await this.chain.applyFunding(s.chain.id, ratePpm, commitment);
    s.chain.fundingAt = Math.floor(Date.now() / 1000);
    s.fundingRatePpm = Number(ratePpm);
    await this.db.query(`INSERT INTO perp_funding (market, rate_ppm, premium, readings, weekend, commitment, tx, index_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [s.chain.id, String(ratePpm), premium, readings.length, s.weekend, commitment, tx, s.index]);
    this.chainAccounts.clear();
    for (const k of this.mirrors.keys()) this.mirrors.get(k)!.syncedAt = 0;
  }

  // ── the liquidity vault ─────────────────────────────────────────────────

  /** Re-quote a ladder around mark: published spread and step, leaning against the vault's position. */
  private async vaultTick() {
    if (!this.vaultKey) return;
    const vm = await this.mirror(this.vaultAddr);
    const now = Math.floor(Date.now() / 1000);
    for (const s of this.markets.values()) {
      if (s.chain.status !== 1 && s.chain.status !== 2) continue;
      if (!s.mark) continue;
      const rule = VAULT_RULES[s.symbol] ?? DEFAULT_RULE;
      const b = this.book(s.chain.id);
      b.bids = b.bids.filter((r) => !r.isVault);
      b.asks = b.asks.filter((r) => !r.isVault);
      const pos = vm.positions.get(s.chain.id)?.size ?? 0;
      const capUsd = Number(s.chain.vaultOiCap) / USDC_SCALE;
      const usage = capUsd > 0 ? (pos * s.mark) / capUsd : 0; // −1 to 1
      const widen = s.weekend ? 2 : 1;
      const lean = -usage * 25 / 10_000; // shift the ladder against the vault's own position
      const mid = s.mark * (1 + lean);
      const info = marketInfo(s.symbol);
      const round = (p: number) => Math.round(p * 10 ** info.decimals) / 10 ** info.decimals;
      for (let i = 0; i < rule.levels; i++) {
        const off = ((rule.halfSpreadBps + i * rule.stepBps) * widen) / 10_000;
        for (const isBuy of [true, false]) {
          // At the cap, quote only the side that reduces the vault's position.
          if (usage >= 0.98 && isBuy) continue;
          if (usage <= -0.98 && !isBuy) continue;
          const price = round(isBuy ? mid * (1 - off) : mid * (1 + off));
          const units = rule.levelUsd * (1 + i * 0.25) / price;
          const order: PerpOrder = {
            account: this.vaultAddr, key: this.vaultKeyHex, market: s.chain.id, isBuy,
            price: BigInt(Math.round(price * PRICE_SCALE)), size: BigInt(Math.round(units * SIZE_SCALE)),
            nonce: BigInt(Date.now()) * 1000n + BigInt(randomBytes(2).readUInt16BE() % 1000), expiry: BigInt(now + 300), reduceOnly: false,
          };
          const digest = orderDigest(this.chain.contractId, order);
          const sig = toHex(this.vaultKey.sign(Buffer.from(digest)));
          // Never leave a crossed book: skip a quote that would trade with a resting user order.
          const opp = isBuy ? this.bestAsk(s.chain.id, true) : this.bestBid(s.chain.id, true);
          if (opp && (isBuy ? opp.order.price <= order.price : opp.order.price >= order.price)) continue;
          this.rest({ hash: toHex(digest), order, sig, remaining: order.size, tif: "alo", isVault: true, seq: ++this.seq, userId: null });
        }
      }
    }
  }

  vaultAddress() { return this.vaultAddr; }

  // ── settlement ──────────────────────────────────────────────────────────

  private async settleTick() {
    if (this.settling) return;
    const pending = await this.db.query(`SELECT * FROM perp_fills WHERE status = 'pending' ORDER BY id LIMIT $1`, [MAX_FILLS_PER_TX]);
    if (!pending.rowCount) return;
    this.settling = true;
    try {
      await this.settleRows(pending.rows);
    } finally {
      this.settling = false;
    }
  }

  private toChainFill(r: any): ChainFill {
    return {
      maker: { order: this.parseStored(r.maker_order.order), sig: r.maker_order.sig },
      taker: { order: this.parseStored(r.taker_order.order), sig: r.taker_order.sig },
      price: BigInt(r.price), size: BigInt(r.size),
    };
  }

  private async settleRows(rows: any[]): Promise<void> {
    try {
      const tx = await this.chain.settleFills(rows.map((r) => this.toChainFill(r)));
      await this.db.query(`UPDATE perp_fills SET status = 'settled', tx = $2, settled_at = now() WHERE id = ANY($1::int[])`, [rows.map((r) => r.id), tx]);
      const who = new Set(rows.flatMap((r) => [r.maker, r.taker]));
      for (const w of who) { this.chainAccounts.delete(w); await this.sync(w).catch(() => undefined); }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Error\(Contract, #8\)/.test(msg)) { await this.pricesTick(true).catch(() => undefined); return; } // stale price: push, retry next tick
      if (rows.length > 1) {
        for (const r of rows) await this.settleRows([r]);
        return;
      }
      const r = rows[0];
      await this.db.query(`UPDATE perp_fills SET status = 'failed', error = $2 WHERE id = $1`, [r.id, msg.slice(0, 500)]);
      for (const h of [r.maker_hash, r.taker_hash]) {
        this.removeResting(Number(r.market), h);
        await this.setStatus(h, "rejected").catch(() => undefined);
      }
      for (const w of [r.maker, r.taker]) { this.chainAccounts.delete(w); await this.sync(w).catch(() => undefined); }
      this.note("settle", e);
    }
  }

  // ── liquidations ────────────────────────────────────────────────────────

  private async keeperTick() {
    for (const [who, m] of this.mirrors) {
      if (who === this.vaultAddr || m.positions.size === 0) continue;
      const h = this.health(m);
      if (h.notional === 0 || h.value >= h.maintenance) continue;
      // Confirm on chain before acting: the contract decides.
      const a = await this.chainAccount(who, 0);
      if (a.positions.length === 0 || a.value >= a.maintenance) { await this.sync(who); continue; }
      await this.cancelAll(who);
      const tx = await this.chain.liquidate(who);
      await this.db.query(`INSERT INTO perp_liquidations (account, notional, tx) VALUES ($1,$2,$3)`, [who, h.notional, tx]);
      this.chainAccounts.delete(who);
      this.chainAccounts.delete(this.vaultAddr);
      await this.sync(who);
      await this.sync(this.vaultAddr);
      console.log(`[perps] liquidated ${who} (${h.notional.toFixed(0)} USDC notional) ${tx}`);
    }
  }

  // ── views ───────────────────────────────────────────────────────────────

  marketView(s: MarketState) {
    const day = Date.now() - 86_400_000;
    const dayCandles = s.candles.filter((c) => c.t >= day);
    const open24 = dayCandles[0]?.o ?? s.mark;
    const info = marketInfo(s.symbol);
    const pred = this.predictedRate(s);
    return {
      id: s.chain.id, symbol: s.symbol, pair: info.pair, name: info.name, base: info.base, quote: info.quote, decimals: info.decimals,
      status: s.chain.status, index: s.index, mark: s.mark, weekend: s.weekend,
      change24h: open24 ? (s.mark - open24) / open24 : 0,
      volume24h: dayCandles.reduce((a, c) => a + c.v, 0),
      high24h: dayCandles.length ? Math.max(...dayCandles.map((c) => c.h)) : s.mark,
      low24h: dayCandles.length ? Math.min(...dayCandles.map((c) => c.l)) : s.mark,
      openInterest: (num(s.chain.longOi, SIZE_SCALE) + num(s.chain.shortOi, SIZE_SCALE)) / 2 * s.mark,
      longOi: num(s.chain.longOi, SIZE_SCALE) * s.mark,
      shortOi: num(s.chain.shortOi, SIZE_SCALE) * s.mark,
      oiCap: Number(s.chain.oiCap) / USDC_SCALE,
      maxLeverage: s.chain.maxLeverage, maintBps: s.chain.maintBps,
      fundingLast: s.fundingRatePpm / 1e6,
      fundingPredicted: pred.hourly,
      nextFundingAt: (s.chain.fundingAt + 3600) * 1000,
      lastTrade: s.lastTrade,
    };
  }

  /** Auto-deleveraging queue position for a position: 5 lights means first in line. */
  adlLights(market: number, size: number, entry: number, value: number) {
    const s = this.markets.get(market);
    if (!s || size === 0) return 0;
    const score = (who: number, e: number, val: number) => {
      const pnl = who * (s.mark - e);
      const notional = Math.abs(who) * s.mark;
      const pct = e ? pnl / (Math.abs(who) * e) : 0;
      return pct * (val > 0 ? notional / val : 0);
    };
    const mine = score(size, entry, value);
    const peers: number[] = [];
    for (const [w, m] of this.mirrors) {
      if (w === this.vaultAddr) continue;
      const p = m.positions.get(market);
      if (!p || Math.sign(p.size) !== Math.sign(size)) continue;
      peers.push(score(p.size, p.entry, this.health(m).value));
    }
    if (peers.length <= 1) return mine > 0 ? 3 : 1;
    const below = peers.filter((x) => x < mine).length;
    return Math.max(1, Math.min(5, Math.ceil(((below + 1) / peers.length) * 5)));
  }

  liquidationPrice(m: Mirror, market: number) {
    const s = this.markets.get(market);
    const p = m.positions.get(market);
    if (!s || !p || p.size === 0) return null;
    const h = this.health(m);
    // Price move in this market alone that brings value down to maintenance.
    const mmRate = s.chain.maintBps / 10_000;
    const others = h.maintenance - Math.abs(p.size) * s.mark * mmRate;
    const valueExMark = h.value - p.size * s.mark;
    // value(P) = valueExMark + size·P equals maintenance(P) = others + |size|·P·rate.
    const price = (others - valueExMark) / (p.size - Math.abs(p.size) * mmRate);
    return price > 0 && Number.isFinite(price) ? price : null;
  }

  /** The engine's copy, rebuilt when the chain shows a deposit or withdrawal it has not seen. */
  async mirrorOf(who: string, chainCollateral?: bigint) {
    const m = await this.mirror(who);
    if (chainCollateral !== undefined && m.chainCollateral !== chainCollateral) return this.sync(who);
    return m;
  }
}
