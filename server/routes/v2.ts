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
import { ApplicationError, parseResourceId, type ApplicationErrorCode, type ChainKey, type ProtectionQuote, type ProtectionRequest } from "@shared/domain/types";
import { AdapterRegistry } from "../chain";
import { chainRegistry, registryLoadError } from "../chain/config";
import { AccountService, drizzleAccountRepository } from "../accounts/service";
import { QuoteService, enginePricer } from "../domain/quote-service";
import { settlementResult } from "../domain/settlement";
import { BalanceLedger } from "../domain/ledger";
import { RoutingEngine } from "../routing/engine";
import { DirectProvider } from "../routing/providers";
import { InMemoryRouteStore } from "../routing/types";
import { getSession } from "../auth-routes";

const STATUS: Partial<Record<ApplicationErrorCode, number>> = {
  UNAUTHORIZED: 401, POOL_NOT_FOUND: 404, CHAIN_NOT_ENABLED: 503, CHAIN_DRAINING: 409,
  INSUFFICIENT_LIQUIDITY: 409, QUOTE_EXPIRED: 409, QUOTE_USED: 409, UNKNOWN: 500,
};

interface Services {
  adapters: AdapterRegistry;
  quotes: QuoteService;
  accounts: AccountService;
  routing: RoutingEngine;
}

let services: Promise<Services> | null = null;

function getServices(): Promise<Services> {
  if (!services) {
    services = (async () => {
      const chains = chainRegistry();
      if (!chains) throw new ApplicationError("CHAIN_NOT_ENABLED", `Chain registry not configured: ${registryLoadError()}`);
      const adapters = new AdapterRegistry(chains);
      const accounts = new AccountService(chains, await drizzleAccountRepository(chains));
      // Routing moves money; cross-chain providers are wired only once their ports and a
      // persistent ledger are configured (docs/architecture/v2/routing-v2.0.md).
      const routing = new RoutingEngine(chains, [new DirectProvider()], new InMemoryRouteStore(), new BalanceLedger(), async () => "completed");
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
  return { chain: r.chain, id: Number(n) };
}

/** The user's own address on a chain, or a clear error asking them to add one. */
async function ownerOn(s: Services, uid: number, chain: ChainKey) {
  const book = await s.accounts.addressBook(uid);
  if (!book[chain]) throw new ApplicationError("INVALID_REQUEST", `No ${chain} account yet; link one first`);
  return book[chain];
}

export function registerV2Routes(app: Express) {
  app.get("/api/v2/chains", wrap(async (_req, res) => {
    const chains = chainRegistry();
    if (!chains) throw new ApplicationError("CHAIN_NOT_ENABLED", `Chain registry not configured: ${registryLoadError()}`);
    res.json(chains.publicView());
  }));

  app.get("/api/v2/pools", wrap(async (req, res) => {
    const s = await getServices();
    const keys = req.query.chain ? [String(req.query.chain)] : chainRegistry()!.settlementNetworks().map((c) => c.key);
    const pools = (await Promise.all(keys.map((k) => s.adapters.adapterFor(k).listPools()))).flat();
    res.json({ pools });
  }));

  /** What creating a pool on the hub involves: the pairs on offer and the creation fee. */
  app.get("/api/v2/pools/setup", wrap(async (_req, res) => {
    const s = await getServices();
    const hub = chainRegistry()!.hub;
    const pairs = (process.env.POOL_PAIRS || "USD/NGN,USD/GHS,USD/KES,USD/ZAR,USD/EGP").split(",").map((p) => p.trim()).filter(Boolean);
    res.json({ chain: hub.key, pairs, creationFee: await s.adapters.adapterFor(hub.key).getPoolCreationFee() });
  }));

  /** Fair price per tenor for a pair and direction (underwriter offer setting). */
  app.get("/api/v2/fair", wrap(async (req, res) => {
    const direction = req.query.direction === "down" ? "down" : "up";
    const tenors = String(req.query.tenors ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 365).slice(0, 16);
    res.json(await (await getServices()).quotes.fairTable(String(req.query.pair ?? ""), direction, tenors));
  }));

  /** Active cover sold by a pool, for the underwriter's risk view. */
  app.get("/api/v2/pools/:ref/positions", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id } = idOf(req.params.ref, "pool");
    res.json({ positions: await s.adapters.adapterFor(chain).listActivePositions(id) });
  }));

  /** Change a pool's protection types and limits. */
  app.post("/api/v2/pools/:ref/structures/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id } = idOf(req.params.ref, "pool");
    const owner = await ownerOn(s, await userId(req), chain);
    res.json({ transactions: await s.adapters.adapterFor(chain).prepareSetStructures(owner, id, req.body) });
  }));

  /** Give notice to withdraw shares from a pool. */
  app.post("/api/v2/pools/:ref/withdrawals/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id } = idOf(req.params.ref, "pool");
    const owner = await ownerOn(s, await userId(req), chain);
    res.json({ transactions: await s.adapters.adapterFor(chain).prepareWithdrawalRequest(owner, id, String(req.body?.shares ?? "")) });
  }));

  /** The user's withdrawal requests on every settling chain. */
  app.get("/api/v2/withdrawals", wrap(async (req, res) => {
    const s = await getServices();
    const book = await s.accounts.addressBook(await userId(req));
    const out = [];
    for (const chain of chainRegistry()!.settlementNetworks()) {
      if (!book[chain.key]) continue;
      for (const w of await s.adapters.adapterFor(chain.key).listWithdrawals(book[chain.key])) out.push({ chain: chain.key, ...w });
    }
    res.json({ withdrawals: out });
  }));

  /** Complete a withdrawal whose notice has ended. */
  app.post("/api/v2/withdrawals/:chain/:id/execute/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const owner = await ownerOn(s, await userId(req), req.params.chain);
    res.json({ transactions: await s.adapters.adapterFor(req.params.chain).prepareWithdrawalExecute(owner, Number(req.params.id)) });
  }));

  /** The signed-in user's stake in a pool. */
  app.get("/api/v2/pools/:ref/lp", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id } = idOf(req.params.ref, "pool");
    const owner = await ownerOn(s, await userId(req), chain);
    res.json(await s.adapters.adapterFor(chain).getLpPosition(id, owner));
  }));

  app.get("/api/v2/pools/:ref", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id } = idOf(req.params.ref, "pool");
    res.json(await s.adapters.adapterFor(chain).getPool(id));
  }));

  app.get("/api/v2/options", wrap(async (req, res) => {
    const direction = req.query.direction === "up" || req.query.direction === "down" ? req.query.direction : undefined;
    res.json(await (await getServices()).quotes.options(String(req.query.pair ?? ""), direction));
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
    res.json(await s.quotes.quote(body, await s.accounts.addressBook(uid)));
  }));

  app.post("/api/v2/hedges/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const uid = await userId(req);
    const quote = req.body?.quote as ProtectionQuote;
    if (!quote?.economic) throw new ApplicationError("INVALID_REQUEST", "quote is required");
    const chain = quote.economic.executionChain;
    if ((await ownerOn(s, uid, chain)) !== quote.buyer) throw new ApplicationError("UNAUTHORIZED", "Quote was issued to a different account");
    chainRegistry()!.require(chain, "newHedges");
    res.json({ transactions: await s.adapters.adapterFor(chain).prepareHedge(quote.buyer, quote) });
  }));

  app.get("/api/v2/hedges", wrap(async (req, res) => {
    const s = await getServices();
    const book = await s.accounts.addressBook(await userId(req));
    const out = [];
    for (const chain of chainRegistry()!.settlementNetworks()) {
      if (!book[chain.key]) continue;
      const adapter = s.adapters.adapterFor(chain.key);
      for (const p of await adapter.listPositions(book[chain.key])) {
        const pool = await adapter.getPool(p.poolId);
        out.push({ position: p, pair: pool.pair, settlement: settlementResult(p, pool.fees.payoutFeeRateE6, pool.asset.decimals) });
      }
    }
    res.json({ hedges: out });
  }));

  app.get("/api/v2/hedges/:ref", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id } = idOf(req.params.ref, "position");
    const adapter = s.adapters.adapterFor(chain);
    const p = await adapter.getPosition(id);
    const pool = await adapter.getPool(p.poolId);
    res.json({ position: p, settlement: settlementResult(p, pool.fees.payoutFeeRateE6, pool.asset.decimals) });
  }));

  app.post("/api/v2/hedges/:ref/claim/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id } = idOf(req.params.ref, "position");
    const owner = await ownerOn(s, await userId(req), chain);
    res.json({ transactions: await s.adapters.adapterFor(chain).prepareClaim(owner, id) });
  }));

  app.post("/api/v2/pools/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const chain = chainRegistry()!.require(chainRegistry()!.hub.key, "newPools");
    const owner = await ownerOn(s, await userId(req), chain.key);
    res.json({ chain: chain.key, transactions: await s.adapters.adapterFor(chain.key).prepareCreatePool(owner, req.body) });
  }));

  app.post("/api/v2/pools/:ref/tenors/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id } = idOf(req.params.ref, "pool");
    const owner = await ownerOn(s, await userId(req), chain);
    res.json({ transactions: await s.adapters.adapterFor(chain).prepareSetTenor(owner, id, req.body) });
  }));

  app.post("/api/v2/pools/:ref/deposits/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, id } = idOf(req.params.ref, "pool");
    chainRegistry()!.require(chain, "lpDeposits");
    const owner = await ownerOn(s, await userId(req), chain);
    res.json({ transactions: await s.adapters.adapterFor(chain).prepareDeposit(owner, id, String(req.body?.amount)) });
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
    const book = await s.accounts.addressBook(await userId(req));
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

  app.post("/api/v2/routing/quote", wrap(async (req, res) => {
    const s = await getServices();
    const uid = await userId(req);
    const chains = chainRegistry()!;
    const { kind, network, amount, symbol = "USDC" } = req.body ?? {};
    if (kind !== "fund" && kind !== "withdraw") throw new ApplicationError("INVALID_REQUEST", "kind must be fund or withdraw");
    const hub = s.routing.destinationFor(network);
    const [source, destination] = kind === "fund" ? [network, hub] : [hub, network];
    const book = await s.accounts.addressBook(uid);
    const quotes = await s.routing.quote({
      userId: String(uid), kind, sourceChain: source, destinationChain: destination,
      asset: chains.asset(source, symbol), destinationAsset: chains.asset(destination, symbol), amount: String(amount),
      sender: book[source] ?? "", recipient: book[destination] ?? "", action: { type: "credit" },
    });
    if (quotes.length === 0) throw new ApplicationError("NO_ROUTE", `No route from ${source} to ${destination} right now`);
    res.json({ quotes });
  }));

  app.post("/api/v2/routing/execute", wrap(async () => {
    // Cross-network execution moves user funds and needs the persistent route store and
    // ledger. Until those are configured it is refused rather than run from memory.
    if (process.env.ROUTING_ENABLED !== "true") throw new ApplicationError("CHAIN_NOT_ENABLED", "Cross-network routing is not enabled on this deployment");
    throw new ApplicationError("CHAIN_NOT_ENABLED", "Persistent routing store not configured");
  }));

  /** Stellar: the user's passkey authorized the call; the platform pays the fee. */
  /** Send a listed asset to another address on the same chain (the wallet's Send). */
  app.post("/api/v2/transfers/prepare", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, symbol, to, amount } = req.body ?? {};
    if (typeof chain !== "string" || typeof to !== "string" || typeof amount !== "string") throw new ApplicationError("INVALID_REQUEST", "chain, to and amount are required");
    const owner = await ownerOn(s, await userId(req), chain);
    res.json({ chain, transactions: await s.adapters.adapterFor(chain).prepareTransfer(owner, to.trim(), String(symbol ?? "USDC"), amount) });
  }));

  app.post("/api/v2/transactions/relay", wrap(async (req, res) => {
    const s = await getServices();
    const { chain, xdr } = req.body ?? {};
    const adapter = s.adapters.adapterFor(String(chain)) as unknown as { relayUserTransaction?: (x: string, w: string) => Promise<unknown> };
    if (!adapter.relayUserTransaction) throw new ApplicationError("INVALID_REQUEST", `${chain} transactions are sent by the wallet directly`);
    if (typeof xdr !== "string" || xdr.length < 10 || xdr.length > 100_000) throw new ApplicationError("INVALID_REQUEST", "xdr is required");
    res.json(await adapter.relayUserTransaction(xdr, await ownerOn(s, await userId(req), String(chain))));
  }));

  app.get("/api/v2/transactions/:chain/:hash", wrap(async (req, res) => {
    const s = await getServices();
    res.json(await s.adapters.adapterFor(req.params.chain).getTransactionStatus(req.params.hash));
  }));

  // Every /api/v2 failure leaves as a shared error code; raw chain messages stay in logs.
  app.use("/api/v2", (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err instanceof ApplicationError ? err : new ApplicationError("UNKNOWN", "Request failed", String((err as Error)?.message ?? err));
    if (e.detail) console.warn(`[api/v2] ${e.code}: ${e.detail}`);
    res.status(STATUS[e.code] ?? 400).json({ error: { code: e.code, message: e.message } });
  });
}
