/**
 * Admin dashboard figures from what the app actually runs on: sign-ups from `user_accounts`,
 * pools and positions read from the Stellar currency pool contracts (current and earlier
 * ones). Replaces the v1 Base reader for the Dashboard and Hedge tabs.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { requireAdmin } from "../middleware/admin-auth";
import { chainRegistry } from "../chain/config";
import type { AdapterRegistry } from "../chain";
import type { CurrencyPool, ProtectionPosition } from "@shared/domain/types";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
async function getDb(): Promise<Db> {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  return pool as unknown as Db;
}

interface Book { pools: CurrencyPool[]; positions: (ProtectionPosition & { pair: string; legacy: boolean })[]; errors: string[]; at: number }

/**
 * Reading every pool and position takes many network calls. The last result is served while
 * a fresh read runs in the background once it is over 30 seconds old; only the first read waits.
 */
let cached: Book | null = null;
let reading: Promise<Book> | null = null;

async function readBook(adapters: AdapterRegistry): Promise<Book> {
  if (cached && Date.now() - cached.at < 30_000) return cached;
  if (!reading) {
    reading = readEverything(adapters)
      .then((book) => { cached = book; return book; })
      .finally(() => { reading = null; });
  }
  if (cached) { reading.catch(() => undefined); return cached; }
  return reading;
}

async function readEverything(adapters: AdapterRegistry): Promise<Book> {
  const pools: CurrencyPool[] = [];
  const positions: Book["positions"] = [];
  const errors: string[] = [];
  const contracts = chainRegistry()!.settlementNetworks().flatMap((chain) => adapters.adaptersFor(chain.key).map((adapter) => ({ chain, adapter })));
  await Promise.all(contracts.map(async ({ chain, adapter }) => {
    let list: CurrencyPool[] = [];
    try { list = await adapter.listPools(); } catch (e) { errors.push(`${chain.key} pools: ${(e as Error).message}`); return; }
    pools.push(...list);
    if (!adapter.listPoolPositions) return;
    // Six pools at a time, so the RPC is not flooded.
    for (let i = 0; i < list.length; i += 6) {
      await Promise.all(list.slice(i, i + 6).map(async (pool) => {
        try {
          for (const p of await adapter.listPoolPositions!(pool.poolId)) positions.push({ ...p, pair: pool.pair, legacy: Boolean(pool.legacy) });
        } catch (e) { errors.push(`${chain.key} pool ${pool.poolId} positions: ${(e as Error).message}`); }
      }));
    }
  }));
  pools.sort((a, b) => Number(Boolean(a.legacy)) - Number(Boolean(b.legacy)) || b.createdAt - a.createdAt);
  positions.sort((a, b) => b.createdAt - a.createdAt);
  return { pools, positions, errors, at: Date.now() };
}
const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

/** Wallet address to the person who owns it, for naming hedgers. */
async function owners(db: Db, addresses: string[]): Promise<Map<string, { id: number; email: string | null; name: string | null }>> {
  if (!addresses.length) return new Map();
  const { rows } = await db.query(
    `SELECT w.address, u.id, u.email, u.name FROM chain_wallet_accounts w JOIN user_accounts u ON u.id = w.user_id WHERE w.address = ANY($1)`,
    [addresses],
  );
  return new Map(rows.map((r) => [r.address, { id: r.id, email: r.email, name: r.name }]));
}

export function registerAdminV2Routes(app: Express, getAdapters: () => Promise<AdapterRegistry>) {
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

  /** Market (parallel) rate: the live composite per pair, every source behind it, and the official rate beside it. */
  app.get("/api/admin/v2/market-rates", requireAdmin, wrap(async (_req, res) => {
    const { marketRates, marketRateErrors, usdcPerUsdt } = await import("../market-rate/service");
    const { officialRate } = await import("../fx-oracle");
    const rates = await Promise.all(marketRates().map(async (r) => {
      const official = await officialRate(r.pair).catch(() => null);
      const off = official?.rate ?? null;
      return { ...r, official: off, gap: r.rate && off ? r.rate / off - 1 : null };
    }));
    res.json({ rates, errors: marketRateErrors(), usdcPerUsdt: usdcPerUsdt() });
  }));

  app.get("/api/admin/v2/overview", requireAdmin, wrap(async (_req, res) => {
    const db = await getDb();
    const [{ rows: [u] }, book] = await Promise.all([
      db.query(`SELECT count(*)::int AS total,
                       count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last7,
                       (SELECT count(DISTINCT user_id)::int FROM chain_wallet_accounts WHERE status = 'active') AS with_wallet
                FROM user_accounts`),
      readBook(await getAdapters()),
    ]);
    const now = Date.now() / 1000;
    const ps = book.positions;
    const active = ps.filter((p) => p.status === "active");
    const live = book.pools.filter((p) => !p.legacy);
    res.json({
      users: { total: u.total, last7: u.last7, withWallet: u.with_wallet },
      pools: {
        total: book.pools.length,
        selling: live.filter((p) => p.acceptingHedges).length,
        underwriters: new Set(book.pools.map((p) => p.creator)).size,
        liquidity: book.pools.reduce((s, p) => s + num(p.liquidity.nav), 0),
        available: live.filter((p) => p.acceptingHedges).reduce((s, p) => s + num(p.liquidity.capacity), 0),
        reserved: book.pools.reduce((s, p) => s + num(p.liquidity.reserved), 0),
      },
      positions: {
        total: ps.length,
        active: active.filter((p) => p.expiry > now).length,
        awaitingSettlement: active.filter((p) => p.expiry <= now).length,
        settled: ps.filter((p) => p.status === "settled").length,
        claimed: ps.filter((p) => p.status === "claimed").length,
        hedgers: new Set(ps.map((p) => p.hedger)).size,
        notional: ps.reduce((s, p) => s + num(p.notional), 0),
        premiums: ps.reduce((s, p) => s + num(p.premium), 0),
        fees: ps.reduce((s, p) => s + num(p.fee), 0),
        payouts: ps.reduce((s, p) => s + num(p.payout), 0),
      },
      errors: book.errors,
      readAt: book.at,
    });
  }));

  app.get("/api/admin/v2/book", requireAdmin, wrap(async (_req, res) => {
    const book = await readBook(await getAdapters());
    const who = await owners(await getDb(), Array.from(new Set(book.positions.map((p) => p.hedger))));
    res.json({
      pools: book.pools.map((p) => ({
        ref: p.ref, chain: p.chain, poolId: p.poolId, pair: p.pair, direction: p.direction, creator: p.creator,
        legacy: Boolean(p.legacy), acceptingHedges: p.acceptingHedges, activePositions: p.activePositions,
        nav: p.liquidity.nav, reserved: p.liquidity.reserved, capacity: p.liquidity.capacity, createdAt: p.createdAt,
      })),
      positions: book.positions.map((p) => ({
        ref: p.ref, positionId: p.positionId, poolId: p.poolId, pair: p.pair, direction: p.direction, structure: p.structure,
        status: p.status, hedger: p.hedger, owner: who.get(p.hedger) ?? null, legacy: p.legacy,
        notional: p.notional, strike: p.strike, cap: p.cap, premium: p.premium, fee: p.fee, maxPayout: p.maxPayout,
        payout: p.payout, settlementPrice: p.settlementPrice, createdAt: p.createdAt, expiry: p.expiry,
      })),
      errors: book.errors,
      readAt: book.at,
    });
  }));
}
