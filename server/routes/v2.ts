/**
 * BlockFinaX API v2 (Architecture v2.0): one product API for every chain.
 *
 * The chain is data, never part of the path's product meaning. Pools and hedges are
 * addressed by resource id (`chain:contract:pool/1`, URL-encoded). Hedgers never name a
 * chain: quotes execute on the Liquidity Hub chosen by the registry. Errors are always
 * `{ error: { code, message } }` with a shared ApplicationError code.
 *
 *   GET  /api/v2/chains
 *   GET  /api/v2/pools                     ?chain= (default: every chain that still settles)
 *   GET  /api/v2/pools/:ref
 *   GET  /api/v2/options                   ?pair=USD/GHS
 *   POST /api/v2/quotes                    ProtectionRequest -> ProtectionQuote
 *   POST /api/v2/hedges/prepare            { quote } -> unsigned transactions for the wallet
 *   GET  /api/v2/hedges                    the user's hedges on every chain, with settlement
 *   GET  /api/v2/hedges/:ref
 *   POST /api/v2/hedges/:ref/claim/prepare
 *   POST /api/v2/pools/prepare             create a pool on the hub
 *   POST /api/v2/pools/:ref/tenors/prepare
 *   POST /api/v2/pools/:ref/deposits/prepare
 *   GET  /api/v2/accounts                  POST /api/v2/accounts
 *   GET  /api/v2/balances
 *   POST /api/v2/routing/quote             POST /api/v2/routing/execute   GET /api/v2/routing/:id
 *   GET  /api/v2/transactions/:chain/:hash     POST /api/v2/transactions/relay (Stellar sponsored calls)
 */
import type { Express, NextFunction, Request, Response } from "express";
import { hedgePairs } from "@shared/domain/hedge-pairs";
import { ApplicationError, parseResourceId, type ApplicationErrorCode, type ChainKey, type CurrencyPool, type ProtectionPosition, type ProtectionQuote, type ProtectionRequest } from "@shared/domain/types";
import { AdapterRegistry } from "../chain";
import { chainRegistry, registryLoadError } from "../chain/config";
import { AccountService, drizzleAccountRepository } from "../accounts/service";
import { QuoteService, enginePricer } from "../domain/quote-service";
import { settlementResult } from "../domain/settlement";
import { mergeOrderLegs } from "../domain/orders";
import { routeView, routingService, type RoutingService } from "../routing/service";
import { getSession } from "../auth-routes";
import { registerRfqRoutes } from "../rfq/routes";
import { registerOnboardingRoutes } from "../onboarding/routes";
import { registerConnectorRoutes } from "../connectors/routes";
import { isOffered, NOT_OFFERED_MESSAGE } from "@shared/domain/offered-directions";
import { checkProtectionLimits, verificationRequired, verifiedTier } from "../compliance/protection-limits";
import { RATE_POOL_CHAIN, RatePoolService, type RatePoolView } from "../rates/pools";
import { organisationService } from "../organisations/routes";
import { organisationChainConfig } from "../organisations/gateway";

const STATUS: Partial<Record<ApplicationErrorCode, number>> = {
  UNAUTHORIZED: 401, VERIFICATION_REQUIRED: 403, POOL_NOT_FOUND: 404, CHAIN_NOT_ENABLED: 503, CHAIN_DRAINING: 409,
  INSUFFICIENT_LIQUIDITY: 409, QUOTE_EXPIRED: 409, QUOTE_USED: 409, UNKNOWN: 500,
};

interface Services {
  adapters: AdapterRegistry;
  quotes: QuoteService;
  accounts: AccountService;
  routing: RoutingService;
}

let services: Promise<Services> | null = null;

function getServices(): Promise<Services> {
  if (!services) {
    services = (async () => {
      const chains = chainRegistry();
      if (!chains) throw new ApplicationError("CHAIN_NOT_ENABLED", `Chain registry not configured: ${registryLoadError()}`);
      const adapters = new AdapterRegistry(chains);
      const accounts = new AccountService(chains, await drizzleAccountRepository(chains));
      // Routes and the ledger are stored in the database; Circle CCTP connects chains that have it.
      const routing = await routingService(chains, adapters);
      return { adapters, quotes: new QuoteService(chains, adapters, await enginePricer()), accounts, routing };
    })();
    services.catch(() => { services = null; });
  }
  return services;
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

async function userId(req: Request): Promise<number> {
  const session = await getSession(req);
  if (!session?.userId) throw new ApplicationError("UNAUTHORIZED", "Sign in first");
  return session.userId;
}

function idOf(ref: string, kind: "pool" | "position") {
  const r = parseResourceId(ref);
  const [k, n] = r.id.split("/");
  if (k !== kind || !Number.isInteger(Number(n))) throw new ApplicationError("INVALID_REQUEST", `Not a ${kind} id: ${ref}`);
  return { chain: r.chain, id: Number(n), contract: r.contract };
}

/**
 * Mainnet: refuse a purchase or deposit the user's verification tier does not cover.
 * Tiers are recorded against the user's EVM smart account; activity is read from their
 * contracts on every settling network.
 */
async function enforceVerification(s: Services, uid: number, adds: { cashUsd: number; exposureUsd: number }) {
  const registry = chainRegistry()!;
  if (!verificationRequired(process.env, registry.config.environment)) return;
  const book = await s.accounts.addressBook(uid);
  const evm = registry.all().find((c) => c.family === "evm" && book[c.key]);
  const tier = evm ? await verifiedTier(book[evm.key]) : 0;
  const positions = [];
  for (const chain of registry.settlementNetworks()) {
    if (!book[chain.key]) continue;
    for (const adapter of s.adapters.adaptersFor(chain.key)) positions.push(...(await adapter.listPositions(book[chain.key])));
  }
  const d = checkProtectionLimits({ tier, positions, addsCashUsd: adds.cashUsd, addsExposureUsd: adds.exposureUsd });
  if (!d.allowed) throw new ApplicationError("VERIFICATION_REQUIRED", d.reason, `requiredTier=${d.requiredTier} tier=${d.tier}`);
}

/**
 * The organisation a request acts for, from the X-BFX-Organisation header. Only an active
 * member resolves; their role travels with it so the relay can decide what they may send.
 * Absent header: the request acts for the user's own account, as before.
 */
async function actingOrganisation(req: Request | undefined, uid: number, chain: ChainKey) {
  const raw = req?.header("x-bfx-organisation");
  if (!raw) return null;
  const orgs = await organisationService();
  if (!orgs) throw new ApplicationError("INVALID_REQUEST", "Business accounts are not available on this deployment");
  if (organisationChainConfig()?.key !== chain) throw new ApplicationError("INVALID_REQUEST", "Business accounts run on Stellar");
  try {
    return await orgs.acting(uid, Number(raw));
  } catch (e) {
    throw new ApplicationError("UNAUTHORIZED", e instanceof Error ? e.message : "Not a member of this organisation");
  }
}

/**
 * The address book a request reads: the user's own, or, when acting for an organisation,
 * only the organisation's account (so a business never sees a member's personal funds).
 */
async function bookFor(s: Services, uid: number, req: Request): Promise<Record<ChainKey, string>> {
  if (!req.header("x-bfx-organisation")) return s.accounts.addressBook(uid);
  const chain = organisationChainConfig()?.key as ChainKey | undefined;
  const org = chain ? await actingOrganisation(req, uid, chain) : null;
  if (!org || !chain) throw new ApplicationError("INVALID_REQUEST", "Business accounts are not available on this deployment");
  return { [chain]: org.account } as Record<ChainKey, string>;
}

/** Features organisation accounts do not have yet refuse plainly instead of acting on a personal account. */
function personalOnly(req: Request, what: string) {
  if (req.header("x-bfx-organisation")) throw new ApplicationError("INVALID_REQUEST", `${what} is available for personal accounts only, for now`);
}

/** The address a request acts for on a chain: the user's own, or their organisation's when the request says so. */
async function ownerOn(s: Services, uid: number, chain: ChainKey, req?: Request) {
  const org = await actingOrganisation(req, uid, chain);
  if (org) return org.account;
  const book = await s.accounts.addressBook(uid);
  if (!book[chain]) throw new ApplicationError("INVALID_REQUEST", `No ${chain} account yet; link one first`);
  return book[chain];
}

/** Pool pair, payout fee and decimals for listing cover; cached briefly per contract and pool. */
const POOL_META_TTL_MS = 5 * 60_000;
const poolMetaCache = new Map<string, { at: number; value: Promise<{ pair: string; payoutFeeRateE6: number; decimals: number }> }>();
function poolMeta(chain: string, adapter: { getPool(id: number): Promise<CurrencyPool> }, poolId: number) {
  const key = `${chain}:${(adapter as { poolId?: string }).poolId ?? "main"}:${poolId}`;
  const hit = poolMetaCache.get(key);
  if (hit && Date.now() - hit.at < POOL_META_TTL_MS) return hit.value;
  const value = adapter.getPool(poolId).then((p) => ({ pair: p.pair, payoutFeeRateE6: p.fees.payoutFeeRateE6, decimals: p.asset.decimals }));
  value.catch(() => poolMetaCache.delete(key)); // never cache a failure
  poolMetaCache.set(key, { at: Date.now(), value });
  return value;
}

export function registerV2Routes(app: Express) {
  // Request a quote acts on personal accounts only, for now: refuse rather than quietly use one.
  app.use("/api/v2/rfq", (req, res, next) =>
    req.header("x-bfx-organisation")
      ? res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Request a quote is available for personal accounts only, for now" } })
      : next());
  registerRfqRoutes(app, { getServices, userId, ownerOn, wrap });
  registerOnboardingRoutes(app, { userId, wrap });
  registerConnectorRoutes(app, { getServices, userId, wrap });
  app.get("/api/v2/chains", wrap(async (_req, res) => {
    const chains = chainRegistry();
    if (!chains) throw new ApplicationError("CHAIN_NOT_ENABLED", `Chain registry not configured: ${registryLoadError()}`);
    res.json(chains.publicView());
  }));

  app.get("/api/v2/pools", wrap(async (req, res) => {
    const s = await getServices();
    const keys = req.query.chain ? [String(req.query.chain)] : chainRegistry()!.settlementNetworks().map((c) => c.key);
    const pools = (await Promise.all(keys.flatMap((k) => s.adapters.adaptersFor(k).map((a) => a.listPools())))).flat();
    res.json({ pools });
  }));

  /** What creating a pool on the hub involves: the pairs on offer and the creation fee. */
  app.get("/api/v2/pools/setup", wrap(async (_req, res) => {
    const s = await getServices();
    const hub = chainRegistry()!.hub;
    const pairs = hedgePairs();
    res.json({ chain: hub.key, pairs, creationFee: await s.adapters.adapterFor(hub.key).getPoolCreationFee() });
  }));

  /** Fair price per tenor for a pair and direction (underwriter offer setting). */
  app.get("/api/v2/fair", wrap(async (req, res) => {
    const direction = req.query.direction === "down" ? "down" : "up";
    const tenors = String(req.query.tenors ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 365).slice(0, 16);
    const distance = Math.min(Math.max(Number(req.query.distance ?? 200) || 0, 0), 5000);
    const pair = String(req.query.pair ?? "");
    const s = await getServices();
    // An underwriter's volatility view (annual %, 1 to 300): the markups that would charge it.
    const volPct = Number(req.query.vol);
    let view: { vol: number; ceilingBps: number } | undefined;
    if (req.query.vol !== undefined) {
      if (!Number.isFinite(volPct) || volPct < 1 || volPct > 300) throw new ApplicationError("INVALID_REQUEST", "Volatility must be between 1% and 300% a year");
      const pools = await s.adapters.adapterFor(chainRegistry()!.hub.key).listPools().catch(() => []);
      view = { vol: volPct / 100, ceilingBps: pools.find((p) => p.pair === pair && p.markupCeilingBps)?.markupCeilingBps ?? 20_000 };
    }
    // The limit beyond the strike, in bps (1% to 100%); 10% unless asked.
    const limit = Math.min(Math.max(Math.round(Number(req.query.limit ?? 1000)) || 1000, 100), 10_000);
    res.json(await s.quotes.fairTable(pair, direction, tenors, distance, view, limit));
  }));

  /** Active cover sold by a pool, for the underwriter's risk view. */
  app.get("/api/v2/pools/:ref/positions", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    res.json({ positions: await s.adapters.adapterForContract(chain, contract).listActivePositions(id) });
  }));

  /** Change a pool's protection types and limits. */
  app.post("/api/v2/pools/:ref/structures/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    if (s.adapters.adapterForContract(chain, contract) !== s.adapters.adapterFor(chain)) {
      throw new ApplicationError("INVALID_REQUEST", "This pool is on an earlier contract and is closed to new money. Withdraw from it, then use a current pool.");
    }
    const owner = await ownerOn(s, await userId(req), chain, req);
    res.json({ transactions: await s.adapters.adapterForContract(chain, contract).prepareSetStructures(owner, id, req.body) });
  }));

  /** Give notice to withdraw shares from a pool. */
  app.post("/api/v2/pools/:ref/withdrawals/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    const owner = await ownerOn(s, await userId(req), chain, req);
    res.json({ transactions: await s.adapters.adapterForContract(chain, contract).prepareWithdrawalRequest(owner, id, String(req.body?.shares ?? "")) });
  }));

  /** Underwriter preferences on per-hedge pools: back new sales or not, and the longest tenor. */
  app.post("/api/v2/pools/:ref/preferences/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    const owner = await ownerOn(s, await userId(req), chain, req);
    const adapter = s.adapters.adapterForContract(chain, contract) as unknown as { prepareLpPreferences?: (o: string, p: number, b: boolean, max: number, min?: number) => Promise<unknown> };
    if (!adapter.prepareLpPreferences) throw new ApplicationError("INVALID_REQUEST", "This pool does not support underwriter preferences");
    const max = Number(req.body?.maxTenorDays ?? 0) || 0;
    const min = Number(req.body?.minTenorDays ?? 0) || 0;
    if (max > 0 && min > max) throw new ApplicationError("INVALID_REQUEST", "The shortest duration must not be longer than the longest");
    res.json({ transactions: await adapter.prepareLpPreferences(owner, id, req.body?.backing !== false, max, min) });
  }));

  /** Whether the signed-in underwriter may take over a pool whose creator has left it. */
  app.get("/api/v2/pools/:ref/takeover", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    const owner = await ownerOn(s, await userId(req), chain, req);
    const adapter = s.adapters.adapterForContract(chain, contract) as unknown as { takeOverStatus?: (p: number, o: string) => Promise<unknown> };
    res.json(adapter.takeOverStatus ? await adapter.takeOverStatus(id, owner) : { supported: false, eligible: false, reason: null });
  }));

  app.post("/api/v2/pools/:ref/takeover/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    const owner = await ownerOn(s, await userId(req), chain, req);
    const adapter = s.adapters.adapterForContract(chain, contract) as unknown as { prepareTakeOver?: (o: string, p: number) => Promise<unknown> };
    if (!adapter.prepareTakeOver) throw new ApplicationError("INVALID_REQUEST", "This pool cannot be taken over");
    res.json({ transactions: await adapter.prepareTakeOver(owner, id) });
  }));

  /** The user's withdrawal requests on every settling chain. */
  app.get("/api/v2/withdrawals", wrap(async (req, res) => {
    const s = await getServices();
    const book = await bookFor(s, await userId(req), req);
    const out = [];
    for (const chain of chainRegistry()!.settlementNetworks()) {
      if (!book[chain.key]) continue;
      for (const adapter of s.adapters.adaptersFor(chain.key)) {
        const contract = (adapter as unknown as { chain?: { contracts?: { currencyPool?: string } } }).chain?.contracts?.currencyPool;
        for (const w of await adapter.listWithdrawals(book[chain.key])) out.push({ chain: chain.key, contract, ...w });
      }
    }
    res.json({ withdrawals: out });
  }));

  /** Complete a withdrawal whose notice has ended. */
  app.post("/api/v2/withdrawals/:chain/:id/execute/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const owner = await ownerOn(s, await userId(req), req.params.chain, req);
    const contract = typeof req.query.contract === "string" ? req.query.contract : (req.body?.contract as string | undefined);
    res.json({ transactions: await s.adapters.adapterForContract(req.params.chain, contract).prepareWithdrawalExecute(owner, Number(req.params.id)) });
  }));

  /** The signed-in user's stake in a pool. */
  app.get("/api/v2/pools/:ref/lp", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    const owner = await ownerOn(s, await userId(req), chain, req);
    res.json(await s.adapters.adapterForContract(chain, contract).getLpPosition(id, owner));
  }));

  app.get("/api/v2/pools/:ref", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    res.json(await s.adapters.adapterForContract(chain, contract).getPool(id));
  }));

  app.get("/api/v2/options", wrap(async (req, res) => {
    const direction = req.query.direction === "up" || req.query.direction === "down" ? req.query.direction : undefined;
    res.json(await (await getServices()).quotes.options(String(req.query.pair ?? ""), direction));
  }));

  /** Live rates for the watchlist, with the change since the last daily close. */
  app.get("/api/v2/rates", wrap(async (_req, res) => {
    const s = await getServices();
    const { watchlistRates } = await import("../domain/rates");
    res.json({ rates: await watchlistRates((pair) => s.quotes.spot(pair)) });
  }));

  /** Daily closes for a pair, oldest first (for rate charts). */
  app.get("/api/v2/history", wrap(async (req, res) => {
    const pair = String(req.query.pair ?? "");
    const days = Math.min(Math.max(Number(req.query.days) || 30, 5), 400);
    const { getRecentCloses } = await import("../pricing/data/historical");
    const rows = await getRecentCloses(pair, days);
    res.json({ pair, closes: rows.map((r: any) => ({ date: String(r.date).slice(0, 10), close: Number(r.close) })) });
  }));

  /**
   * Chart points for a pair over a range. 1H, 6H and 24H use the FX oracle's own
   * snapshots of the live rate (kept about 26 hours); longer ranges use stored daily
   * closes. Long series are thinned to about 300 points.
   */
  app.get("/api/v2/chart", wrap(async (req, res) => {
    const pair = String(req.query.pair ?? "");
    const range = String(req.query.range ?? "1M").toUpperCase();
    const HOURS: Record<string, number> = { "1H": 1, "6H": 6, "24H": 24 };
    const DAYS: Record<string, number> = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "5Y": 1827, "MAX": 20_000 };
    let points: { t: string; v: number }[] = [];
    if (HOURS[range]) {
      const { db } = await import("../db");
      const { rateSnapshots } = await import("@shared/schema");
      const { and, asc, eq, gte } = await import("drizzle-orm");
      const since = new Date(Date.now() - HOURS[range] * 3_600_000);
      const rows = await db.select().from(rateSnapshots)
        .where(and(eq(rateSnapshots.pair, pair), gte(rateSnapshots.recordedAt, since)))
        .orderBy(asc(rateSnapshots.recordedAt));
      points = rows.map((r) => ({ t: new Date(r.recordedAt).toISOString(), v: Number(r.rate) }));
    } else {
      const now = new Date();
      const days = range === "YTD"
        ? Math.ceil((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86_400_000) + 1
        : DAYS[range] ?? 31;
      const { getRecentCloses } = await import("../pricing/data/historical");
      const rows = await getRecentCloses(pair, days);
      const from = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
      points = rows.filter((r: any) => range === "MAX" || String(r.date) >= from)
        .map((r: any) => ({ t: String(r.date).slice(0, 10), v: Number(r.close) }));
      // Today has no close yet, and the history provider's partial figure can differ from the
      // live rate quotes and strikes use. End the line on that live rate instead.
      const today = now.toISOString().slice(0, 10);
      const spot = Number(await (await getServices()).quotes.spot(pair).catch(() => NaN));
      if (Number.isFinite(spot) && spot > 0) {
        points = points.filter((p) => p.t < today);
        points.push({ t: today, v: spot });
      }
    }
    const step = Math.ceil(points.length / 300);
    if (step > 1) points = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    res.json({ pair, range, intraday: Boolean(HOURS[range]), points });
  }));

  app.get("/api/v2/spot", wrap(async (req, res) => {
    const pair = String(req.query.pair ?? "");
    res.json({ pair, spot: await (await getServices()).quotes.spot(pair) });
  }));

  app.post("/api/v2/quotes", wrap(async (req, res) => {
    const s = await getServices();
    const uid = await userId(req);
    const body = req.body as ProtectionRequest;
    if (!body?.pair || !body.notional || !body.tenorDays || !body.structure || !body.direction || !body.strike) {
      throw new ApplicationError("INVALID_REQUEST", "pair, notional, tenorDays, structure, direction and strike are required");
    }
    try {
      res.json(await s.quotes.quote(body, await bookFor(s, uid, req)));
    } catch (err) {
      // The pricing engine refusing a quote is an answer, not a server fault: say why, plainly.
      const message = err instanceof Error ? err.message : String(err);
      if (/max_payout\/premium/.test(message)) throw new ApplicationError("INVALID_REQUEST", "This protection is too cheap for what it could pay. Move the strike closer to today's rate or choose a lower maximum.", message);
      if (/premium rounds to zero/.test(message)) throw new ApplicationError("INVALID_REQUEST", "This strike is too far from today's rate to price. Move it closer or choose a longer duration.", message);
      if (/Stale history|Sparse history/.test(message)) throw new ApplicationError("INVALID_REQUEST", "Pricing for this currency is updating. Please try again in a few minutes.", message);
      throw err;
    }
  }));

  /**
   * Would this purchase or deposit be allowed by the user's verification tier? Called before
   * reviewing, so the verification form appears before any money is moved. Mainnet only;
   * answers ok wherever verification is not enforced.
   */
  app.post("/api/v2/verification/check", wrap(async (req, res) => {
    const s = await getServices();
    const cashUsd = Math.max(0, Number(req.body?.cashUsd) || 0);
    const exposureUsd = Math.max(0, Number(req.body?.exposureUsd) || 0);
    await enforceVerification(s, await userId(req), { cashUsd, exposureUsd });
    res.json({ ok: true });
  }));

  app.post("/api/v2/hedges/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const uid = await userId(req);
    const quote = req.body?.quote as ProtectionQuote;
    if (!quote?.economic) throw new ApplicationError("INVALID_REQUEST", "quote is required");
    if (!isOffered(quote.economic.direction)) throw new ApplicationError("INVALID_REQUEST", NOT_OFFERED_MESSAGE);
    const chain = quote.economic.executionChain;
    if ((await ownerOn(s, uid, chain, req)) !== quote.buyer) throw new ApplicationError("UNAUTHORIZED", "Quote was issued to a different account");
    chainRegistry()!.require(chain, "newHedges");
    await enforceVerification(s, uid, { cashUsd: Number(quote.economic.totalCost), exposureUsd: Number(quote.economic.maxPayout) });
    const transactions = await s.adapters.adapterFor(chain).prepareHedge(quote.buyer, quote);
    // The quote and the key facts the customer saw, recorded before they sign (records/log.ts).
    const { record } = await import("../records/log");
    const { keyFacts } = await import("../records/key-facts");
    await record({
      actor: { type: "user", id: String(uid) },
      action: "cover.quote_accepted",
      subject: { type: "account", id: quote.buyer },
      data: { pair: quote.economic.pair, quote, keyFacts: keyFacts(quote.economic, quote.expiresAt), organisationId: Number(req.header("x-bfx-organisation")) || null },
    });
    res.json({ transactions });
  }));

  /**
   * A customer's cover across every settling chain and pool contract (current and earlier).
   * Contracts are read in parallel, and each pool's pair and payout fee once, from a short
   * cache: they change rarely, and reading them per cover made this the slowest page.
   */
  app.get("/api/v2/hedges", wrap(async (req, res) => {
    const s = await getServices();
    const book = await bookFor(s, await userId(req), req);
    const jobs: Promise<{ position: ProtectionPosition; pair: string; settlement: ReturnType<typeof settlementResult> }[]>[] = [];
    for (const chain of chainRegistry()!.settlementNetworks()) {
      const owner = book[chain.key];
      if (!owner) continue;
      for (const adapter of s.adapters.adaptersFor(chain.key)) {
        jobs.push((async () => {
          const positions = await adapter.listPositions(owner);
          const ids = Array.from(new Set(positions.map((p) => p.poolId)));
          const meta = new Map(await Promise.all(ids.map(async (id) => [id, await poolMeta(chain.key, adapter, id)] as const)));
          const rows = positions.map((p) => {
            const m = meta.get(p.poolId)!;
            return { position: p, pair: m.pair, settlement: settlementResult(p, m.payoutFeeRateE6, m.decimals) };
          });
          // One protection bought across pools shows as one.
          const decimals = rows.length ? meta.get(rows[0].position.poolId)!.decimals : 7;
          return mergeOrderLegs(rows, decimals);
        })());
      }
    }
    res.json({ hedges: (await Promise.all(jobs)).flat() });
  }));

  app.get("/api/v2/hedges/:ref", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "position");
    const adapter = s.adapters.adapterForContract(chain, contract);
    const p = await adapter.getPosition(id);
    const pool = await adapter.getPool(p.poolId);
    res.json({ position: p, settlement: settlementResult(p, pool.fees.payoutFeeRateE6, pool.asset.decimals) });
  }));

  app.post("/api/v2/hedges/:ref/claim/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "position");
    const owner = await ownerOn(s, await userId(req), chain, req);
    res.json({ transactions: await s.adapters.adapterForContract(chain, contract).prepareClaim(owner, id) });
  }));

  app.post("/api/v2/pools/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const chain = chainRegistry()!.require(chainRegistry()!.hub.key, "newPools");
    const dir = req.body?.direction;
    if (dir === "both" ? !(isOffered("up") && isOffered("down")) : !isOffered(dir === "down" ? "down" : "up")) throw new ApplicationError("INVALID_REQUEST", NOT_OFFERED_MESSAGE);
    const uid = await userId(req);
    await enforceVerification(s, uid, { cashUsd: Number(req.body?.initialLiquidity ?? 0) || 0, exposureUsd: 0 });
    const owner = await ownerOn(s, uid, chain.key, req);
    res.json({ chain: chain.key, transactions: await s.adapters.adapterFor(chain.key).prepareCreatePool(owner, req.body) });
  }));

  app.post("/api/v2/pools/:ref/tenors/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    if (s.adapters.adapterForContract(chain, contract) !== s.adapters.adapterFor(chain)) {
      throw new ApplicationError("INVALID_REQUEST", "This pool is on an earlier contract and is closed to new money. Withdraw from it, then use a current pool.");
    }
    const owner = await ownerOn(s, await userId(req), chain, req);
    res.json({ transactions: await s.adapters.adapterForContract(chain, contract).prepareSetTenor(owner, id, req.body) });
  }));

  /** A pool's per-side limits and prices (creator only, checked on chain). */
  app.post("/api/v2/pools/:ref/sides/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    const adapter = s.adapters.adapterForContract(chain, contract) as any;
    if (adapter !== s.adapters.adapterFor(chain) || typeof adapter.prepareSetSideTerms !== "function") {
      throw new ApplicationError("INVALID_REQUEST", "This pool cannot set terms for each side.");
    }
    const b = req.body ?? {};
    const money = (v: unknown) => typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? v : typeof v === "number" && v >= 0 ? String(v) : null;
    const markup = (v: unknown) => Number.isInteger(v) && (v as number) >= 9_000 && (v as number) <= 30_000 ? (v as number) : null;
    const terms = { upMaxReserve: money(b.upMaxReserve), downMaxReserve: money(b.downMaxReserve), upMarkupBps: markup(b.upMarkupBps), downMarkupBps: markup(b.downMarkupBps) };
    if (Object.values(terms).some((v) => v === null)) {
      throw new ApplicationError("INVALID_REQUEST", "Set a limit of 0 or more for each side, and a price for each side between 0.9x and 3x.");
    }
    const owner = await ownerOn(s, await userId(req), chain, req);
    res.json({ transactions: await adapter.prepareSetSideTerms(owner, id, terms) });
  }));

  app.post("/api/v2/pools/:ref/durations/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    const adapter = s.adapters.adapterForContract(chain, contract);
    if (adapter !== s.adapters.adapterFor(chain) || !adapter.prepareSetDurationRule) {
      throw new ApplicationError("INVALID_REQUEST", "This pool cannot change its durations.");
    }
    const { mode, minDays, maxDays } = req.body ?? {};
    if (!["specific", "any", "up-to"].includes(mode) || !Number.isInteger(minDays) || minDays < 1 || (mode === "up-to" && (!Number.isInteger(maxDays) || maxDays < minDays))) {
      throw new ApplicationError("INVALID_REQUEST", "Choose which durations to sell, with a minimum of at least 1 day and a maximum no lower than the minimum.");
    }
    const owner = await ownerOn(s, await userId(req), chain, req);
    res.json({ transactions: await adapter.prepareSetDurationRule(owner, id, { mode, minDays, maxDays: Number(maxDays) || 0 }) });
  }));

  app.post("/api/v2/pools/:ref/deposits/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id, contract } = idOf(req.params.ref, "pool");
    chainRegistry()!.require(chain, "lpDeposits");
    if (s.adapters.adapterForContract(chain, contract) !== s.adapters.adapterFor(chain)) {
      throw new ApplicationError("INVALID_REQUEST", "This pool is on an earlier contract and is closed to new money. Withdraw from it, then use a current pool.");
    }
    const uid = await userId(req);
    await enforceVerification(s, uid, { cashUsd: Number(req.body?.amount ?? 0) || 0, exposureUsd: 0 });
    const owner = await ownerOn(s, uid, chain, req);
    res.json({ transactions: await s.adapters.adapterForContract(chain, contract).prepareDeposit(owner, id, String(req.body?.amount)) });
  }));

  app.get("/api/v2/accounts", wrap(async (req, res) => {
    const s = await getServices();
    const uid = await userId(req);
    res.json({ accounts: await s.accounts.accounts(uid), provisioning: await s.accounts.provisioningPlan(uid) });
  }));

  app.post("/api/v2/accounts", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, address, walletProvider, accountType } = req.body ?? {};
    res.json(await s.accounts.link(await userId(req), { chain, address, walletProvider, accountType }));
  }));

  app.get("/api/v2/balances", wrap(async (req, res) => {
    const s = await getServices();
    const book = await bookFor(s, await userId(req), req);
    const rows = [];
    for (const chain of chainRegistry()!.all()) {
      if (!book[chain.key] || chain.state === "DISABLED") continue;
      for (const symbol of Object.keys(chain.assets)) {
        // One chain failing must not hide balances on the others.
        const amount = await Promise.resolve().then(() => s.adapters.adapterFor(chain.key).getBalance(book[chain.key], symbol)).catch(() => null);
        rows.push({ chain: chain.key, symbol, amount });
      }
    }
    res.json({ balances: rows });
  }));

  /**
   * A transfer between a funding or withdrawal network and the hub.
   *   kind "fund":     network -> hub, to the user's own hub account
   *   kind "withdraw": hub -> network, to `recipient` (default: the user's own account there)
   */
  async function routeRequest(s: Services, uid: number, body: any) {
    const chains = chainRegistry()!;
    const { kind, network, amount, recipient, symbol = "USDC" } = body ?? {};
    if (kind !== "fund" && kind !== "withdraw") throw new ApplicationError("INVALID_REQUEST", "kind must be fund or withdraw");
    if (typeof network !== "string" || !(Number(amount) > 0)) throw new ApplicationError("INVALID_REQUEST", "network and a positive amount are required");
    const hub = s.routing.engine.destinationFor(network);
    if (hub === network) throw new ApplicationError("INVALID_REQUEST", "That network is the hub; send or receive there directly");
    const [source, destination] = kind === "fund" ? [network, hub] : [hub, network];
    const book = await s.accounts.addressBook(uid);
    if (!book[source]) throw new ApplicationError("INVALID_REQUEST", `No ${source} account yet`);
    const to = kind === "withdraw" && typeof recipient === "string" && recipient.trim() ? recipient.trim() : book[destination];
    if (!to) throw new ApplicationError("INVALID_REQUEST", `No ${destination} account yet`);
    return {
      userId: String(uid), kind, sourceChain: source, destinationChain: destination,
      asset: chains.asset(source, symbol), destinationAsset: chains.asset(destination, symbol), amount: String(amount),
      sender: book[source], recipient: to, action: { type: "credit" as const },
    };
  }

  app.post("/api/v2/routing/quote", wrap(async (req, res) => {
    const s = await getServices();
    personalOnly(req, "Moving money between networks");
    const quotes = await s.routing.engine.quote(await routeRequest(s, await userId(req), req.body));
    if (quotes.length === 0) throw new ApplicationError("NO_ROUTE", "No route between these networks right now");
    res.json({ quotes: quotes.map((q) => q.quote) });
  }));

  /** Start the best route; returns the source-chain transactions for the user to sign. */
  app.post("/api/v2/routing/execute", wrap(async (req, res) => {
    const s = await getServices();
    if (!s.routing.cctpEnabled) throw new ApplicationError("CHAIN_NOT_ENABLED", "Cross-network transfers are not enabled on this deployment");
    personalOnly(req, "Moving money between networks");
    const uid = await userId(req);
    const request = await routeRequest(s, uid, req.body);
    const quotes = await s.routing.engine.quote(request);
    const best = quotes.find((q) => q.quote.provider !== "direct") ?? quotes[0];
    if (!best) throw new ApplicationError("NO_ROUTE", "No route between these networks right now");
    const { route, sourceTransactions } = await s.routing.engine.start(request, best.quote);
    res.json({ route: routeView(route), transactions: sourceTransactions });
  }));

  /** The next step of a transfer whose previous step said `continues`. */
  app.post("/api/v2/routing/:id/continue", wrap(async (req, res) => {
    const s = await getServices();
    const { route, sourceTransactions } = await s.routing.engine.continueRoute(req.params.id, String(await userId(req)));
    res.json({ route: routeView(route), transactions: sourceTransactions });
  }));

  /** The user reports the hash of the source transaction they signed and submitted. */
  app.post("/api/v2/routing/:id/source", wrap(async (req, res) => {
    const s = await getServices();
    const hash = String(req.body?.txHash ?? "");
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(hash)) throw new ApplicationError("INVALID_REQUEST", "txHash is required");
    const route = await s.routing.engine.attachSource(req.params.id, String(await userId(req)), hash);
    res.json({ route: routeView(route) });
  }));

  /**
   * The user's personal deposit addresses on funding networks. USDC sent there is moved to
   * their hub wallet automatically; nothing to sign. Only the canonical USDC is ever moved.
   */
  app.get("/api/v2/deposit-addresses", wrap(async (req, res) => {
    personalOnly(req, "Funding from other networks");
    const s = await getServices();
    const book = await bookFor(s, await userId(req), req);
    const hub = chainRegistry()!.hub;
    const wallet = book[hub.key];
    if (!wallet) throw new ApplicationError("INVALID_REQUEST", `No ${hub.name} account yet`);
    const { depositAddressesFor } = await import("../routing/deposit-addresses");
    res.json({ hub: { chain: hub.key, name: hub.name, address: wallet }, deposits: depositAddressesFor(chainRegistry()!, wallet) });
  }));

  /** USDC in and out of the acting wallet on the hub, newest first (server/wallet/activity.ts). */
  app.get("/api/v2/wallet/activity", wrap(async (req, res) => {
    const s = await getServices();
    const hub = chainRegistry()!.hub;
    const owner = await ownerOn(s, await userId(req), hub.key, req);
    const { walletActivity } = await import("../wallet/activity");
    res.json({ chain: hub.key, activity: await walletActivity(hub.key, owner) });
  }));

  app.get("/api/v2/routing", wrap(async (req, res) => {
    const s = await getServices();
    res.json({ routes: (await s.routing.store.listByUser(String(await userId(req)))).map(routeView) });
  }));

  app.get("/api/v2/routing/:id", wrap(async (req, res) => {
    const s = await getServices();
    const route = await s.routing.store.get(req.params.id);
    if (!route || route.request.userId !== String(await userId(req))) throw new ApplicationError("INVALID_REQUEST", "Transfer not found");
    res.json({ route: routeView(route) });
  }));

  /** Stellar: the user's passkey authorized the call; the platform pays the fee. */
  /** Send a listed asset to another address on the same chain (the wallet's Send). */
  app.post("/api/v2/transfers/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, symbol, to, amount } = req.body ?? {};
    if (typeof chain !== "string" || typeof to !== "string" || typeof amount !== "string") throw new ApplicationError("INVALID_REQUEST", "chain, to and amount are required");
    const uid = await userId(req);
    const owner = await ownerOn(s, uid, chain, req);
    res.json({ chain, transactions: await s.adapters.adapterFor(chain).prepareTransfer(owner, to.trim(), String(symbol ?? "USDC"), amount) });
  }));

  app.post("/api/v2/transactions/relay", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, xdr } = req.body ?? {};
    const adapter = s.adapters.adapterFor(String(chain)) as unknown as {
      relayUserTransaction?: (x: string, w: string, acting?: { organisationRole: "admin" | "operator" | "viewer" }) => Promise<unknown>;
      forgetPools?: () => void;
    };
    if (!adapter.relayUserTransaction) throw new ApplicationError("INVALID_REQUEST", `${chain} transactions are sent by the wallet directly`);
    if (typeof xdr !== "string" || xdr.length < 10 || xdr.length > 100_000) throw new ApplicationError("INVALID_REQUEST", "xdr is required");
    const uid = await userId(req);
    // Acting for an organisation: its account, with the member's role deciding what may be sent.
    const org = await actingOrganisation(req, uid, String(chain) as ChainKey);
    try {
      const account = org ? org.account : await ownerOn(s, uid, String(chain), req);
      const result = org
        ? await adapter.relayUserTransaction(xdr, org.account, { organisationRole: org.role })
        : await adapter.relayUserTransaction(xdr, account);
      const { recordSoon } = await import("../records/log");
      const { describeCall } = await import("../records/key-facts");
      const r = result as { hash?: string; state?: string };
      recordSoon({
        actor: { type: "user", id: String(uid) },
        action: "transaction.relayed",
        subject: { type: "account", id: account },
        data: { chain, ...describeCall(xdr, chainRegistry()!.get(String(chain) as ChainKey).networkId), hash: r?.hash ?? null, state: r?.state ?? null, organisationId: org ? Number(req.header("x-bfx-organisation")) || null : null, role: org?.role ?? null },
      });
      res.json(result);
    } finally {
      adapter.forgetPools?.(); // pools read while it was landing may be out of date
    }
  }));

  app.get("/api/v2/transactions/:chain/:hash", wrap(async (req, res) => {
    const s = await getServices();
    res.json(await s.adapters.adapterFor(req.params.chain).getTransactionStatus(req.params.hash));
  }));

  // ── Interest-rate protection pools (Stellar testnet) ──────────────────────
  //   GET  /api/v2/rate-pools                       POST /api/v2/rate-pools/quote
  //   POST /api/v2/rate-pools/:id/buy/prepare       POST /api/v2/rate-pools/:id/deposits/prepare
  //   GET  /api/v2/rate-protections                 POST /api/v2/rate-protections/:id/settle/prepare
  let ratePoolCache: { at: number; pools: RatePoolView[] } | null = null;
  const ratePools = () => {
    const svc = RatePoolService.fromEnv();
    if (!svc) throw new ApplicationError("CHAIN_NOT_ENABLED", "Interest-rate pools are not configured here");
    return svc;
  };
  const listRatePools = async (fresh = false) => {
    if (!fresh && ratePoolCache && Date.now() - ratePoolCache.at < 20_000) return ratePoolCache.pools;
    ratePoolCache = { at: Date.now(), pools: await ratePools().listPools() };
    return ratePoolCache.pools;
  };
  const ratePoolOr404 = async (id: number) => {
    const pool = (await listRatePools()).find((p) => p.id === id);
    if (!pool) throw new ApplicationError("POOL_NOT_FOUND", `No rate pool ${id}`);
    return pool;
  };
  const intParam = (v: unknown, name: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new ApplicationError("INVALID_REQUEST", `${name} must be a positive whole number`);
    return n;
  };

  app.get("/api/v2/rate-pools", wrap(async (_req, res) => {
    res.json({ pools: await listRatePools() });
  }));

  app.post("/api/v2/rate-pools/quote", wrap(async (req, res) => {
    const pool = await ratePoolOr404(intParam(req.body?.poolId, "poolId"));
    res.json(ratePools().quote(pool, intParam(req.body?.days, "days"), String(req.body?.notional ?? "")));
  }));

  app.post("/api/v2/rate-pools/:id/buy/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const wallet = await ownerOn(s, await userId(req), RATE_POOL_CHAIN as ChainKey, req);
    const pool = await ratePoolOr404(intParam(req.params.id, "pool"));
    const days = intParam(req.body?.days, "days");
    const notional = String(req.body?.notional ?? "");
    const q = ratePools().quote(pool, days, notional);
    if (!q.enoughLiquidity) throw new ApplicationError("INSUFFICIENT_LIQUIDITY", "Not enough liquidity in this pool for that amount");
    const transactions = await ratePools().prepareBuy(wallet, pool.id, days, notional);
    ratePoolCache = null;
    res.json({ transactions, quote: q });
  }));

  app.post("/api/v2/rate-pools/:id/deposits/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const wallet = await ownerOn(s, await userId(req), RATE_POOL_CHAIN as ChainKey, req);
    const pool = await ratePoolOr404(intParam(req.params.id, "pool"));
    ratePoolCache = null;
    res.json({ transactions: await ratePools().prepareDeposit(wallet, pool.id, String(req.body?.amount ?? "")) });
  }));

  app.get("/api/v2/rate-protections", wrap(async (req, res) => {
    const s = await getServices();
    const uid = await userId(req);
    const book = await bookFor(s, uid, req);
    const wallet = book[RATE_POOL_CHAIN as ChainKey];
    res.json({ protections: wallet ? await ratePools().positionsOf(wallet) : [] });
  }));

  app.post("/api/v2/rate-protections/:id/settle/prepare", wrap(async (req, res) => {
    await userId(req);
    res.json({ transactions: await ratePools().prepareSettle(intParam(req.params.id, "protection")) });
  }));

  // Every /api/v2 failure leaves as a shared error code; raw chain messages stay in logs.
  app.use("/api/v2", (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err instanceof ApplicationError ? err : new ApplicationError("UNKNOWN", "Request failed", String((err as Error)?.message ?? err));
    if (e.detail) console.warn(`[api/v2] ${e.code}: ${e.detail}`);
    // Raw details stay server-side, except the tier a verification needs (no chain data in it).
    const detail = e.code === "VERIFICATION_REQUIRED" ? { detail: e.detail } : {};
    res.status(STATUS[e.code] ?? 400).json({ error: { code: e.code, message: e.message, ...detail } });
  });
}
