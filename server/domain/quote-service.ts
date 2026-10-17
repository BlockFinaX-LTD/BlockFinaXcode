/**
 * Protection quotes, once, for every chain (Architecture v2.0).
 *
 *   ProtectionRequest -> Execution Network (registry) -> candidate pools (adapter reads)
 *     -> fair price (shared pricing engine) -> EconomicQuote (shared pool economics)
 *     -> executable, signed quote (adapter, in its own signature scheme)
 *
 * The hedger never names a chain or a pool. This replaces the two copies of pool
 * selection that lived in server/pricing/pool-quote.ts and the Stellar wallet server.
 */
import type { ChainRegistry } from "@shared/chains/registry";
import {
  checkTerms,
  costBreakdown,
  fromRate,
  fromUnits,
  maxPayout,
  offerRate,
  openCap,
  toRate,
  toUnits,
} from "@shared/domain/pool-economics";
import {
  ApplicationError,
  type ChainKey,
  type CurrencyPool,
  type EconomicQuote,
  type ProtectionQuote,
  type ProtectionRequest,
} from "@shared/domain/types";
import type { AdapterRegistry } from "../chain";

/** The shared pricing engine, behind a seam so it can be replaced or stubbed. */
export interface FairPricer {
  /** Fair premium rate (1e6 scale) for exact terms, and the spot it was priced at. */
  fair(a: { pair: string; strike: string; cap: string; tenorDays: number; notional: string; direction: "up" | "down" }): Promise<{ fairRateE6: number; spot: string }>;
  spot(pair: string): Promise<string>;
}

export class QuoteService {
  constructor(
    private readonly chains: ChainRegistry,
    private readonly adapters: AdapterRegistry,
    private readonly pricer: FairPricer,
  ) {}

  /** Which tenors and structures are on sale for a pair, on the Execution Network. */
  /** Today's spot rate for a pair, from the shared FX source. */
  spot(pair: string): Promise<string> {
    return this.pricer.spot(pair);
  }

  /** Tenors and structures on sale for a pair, optionally for one direction only. */
  async options(pair: string, direction?: "up" | "down") {
    const chain = this.chains.executionNetworkFor();
    const pools = (await this.adapters.adapterFor(chain.key).listPools())
      .filter((p) => p.pair === pair && p.acceptingHedges && (!direction || p.direction === "both" || p.direction === direction));
    const rows = new Map<number, { open: boolean; capped: boolean; capacity: number }>();
    for (const p of pools) {
      for (const t of p.tenors.filter((x) => x.active)) {
        const r = rows.get(t.tenorDays) ?? { open: false, capped: false, capacity: 0 };
        r.open ||= p.structures.open;
        r.capped ||= p.structures.capped;
        r.capacity = Math.max(r.capacity, Number(p.liquidity.capacity));
        rows.set(t.tenorDays, r);
      }
    }
    return {
      pair,
      tenors: Array.from(rows.entries()).sort(([a], [b]) => a - b)
        .map(([tenorDays, r]) => ({ tenorDays, open: r.open, capped: r.capped, maxPayoutAvailable: String(r.capacity) })),
    };
  }

  /**
   * Price and sign a hedge. `accounts` are the buyer's addresses by chain; the quote is
   * bound to the account on whichever chain executes it.
   */
  async quote(req: ProtectionRequest, accounts: Record<ChainKey, string>): Promise<ProtectionQuote> {
    if (req.structure === "capped" && !req.cap) throw new ApplicationError("INVALID_CAP", "Choose a cap level for Capped protection");
    const chain = this.chains.require(this.chains.executionNetworkFor().key, "newHedges");
    const buyer = accounts[chain.key];
    if (!buyer) throw new ApplicationError("INVALID_REQUEST", `No ${chain.name} account yet; create one before buying protection`);
    const adapter = this.adapters.adapterFor(chain.key);

    const candidates = (await adapter.listPools())
      .map((pool) => ({ pool, tenor: pool.tenors.find((t) => t.tenorDays === req.tenorDays && t.active) }))
      .filter(({ pool, tenor }) => pool.pair === req.pair && pool.acceptingHedges && (pool.direction === "both" || pool.direction === req.direction)
        && tenor && (req.structure === "open" ? pool.structures.open : pool.structures.capped))
      .sort((a, b) => a.tenor!.markupBps - b.tenor!.markupBps);
    if (candidates.length === 0) throw new ApplicationError("TENOR_DISABLED", `No pool is offering ${req.tenorDays}-day ${req.structure} ${req.direction === "up" ? "rising-rate" : "falling-rate"} protection on ${req.pair}`);

    let last: ApplicationError = new ApplicationError("INSUFFICIENT_LIQUIDITY", "Not enough free liquidity for that amount");
    for (const { pool, tenor } of candidates) {
      const economic = await this.economic(req, pool, tenor!.markupBps, chain.key);
      if (economic instanceof ApplicationError) { last = economic; continue; }
      return adapter.signQuote(economic, buyer, pool.poolId);
    }
    throw last;
  }

  /** The economic quote for one pool, or the reason it cannot take the hedge. */
  async economic(req: ProtectionRequest, pool: CurrencyPool, markupBps: number, chain: ChainKey): Promise<EconomicQuote | ApplicationError> {
    const d = pool.asset.decimals;
    const up = req.direction === "up";
    const strike = toRate(req.strike);
    const capFor = (spot: bigint) => req.structure === "open"
      ? openCap(BigInt(pool.structures.openMaxPayoutBps), up, spot, strike)
      : toRate(req.cap!);

    // Open cover's cap depends on spot: re-price until the cap matches the spot priced at.
    let cap = capFor(toRate(await this.pricer.spot(req.pair)));
    let priced: { fairRateE6: number; spot: string } | null = null;
    for (let i = 0; i < 3 && !priced; i++) {
      const r = await this.pricer.fair({ pair: req.pair, strike: req.strike, cap: fromRate(cap), tenorDays: req.tenorDays, notional: req.notional, direction: req.direction });
      const exact = capFor(toRate(r.spot));
      if (exact === cap) priced = r; else cap = exact;
    }
    if (!priced) return new ApplicationError("QUOTE_EXPIRED", "Spot moved while pricing; request the quote again");

    const spot = toRate(priced.spot);
    const problem = checkTerms({ structures: pool.structures, structure: req.structure, strikeAbove: up, spot, strike, cap });
    if (problem) return new ApplicationError(problem.code, problem.message);

    const notional = toUnits(req.notional, d);
    const reserve = maxPayout(notional, strike, cap, spot);
    if (reserve > toUnits(pool.liquidity.capacity, d)) return new ApplicationError("INSUFFICIENT_LIQUIDITY", "Not enough free liquidity for that amount");

    const fair = BigInt(priced.fairRateE6);
    const cost = costBreakdown({ notional, fairRate: fair, markupBps: BigInt(markupBps), hedgerFeeRate: BigInt(pool.fees.hedgerFeeRateE6) });
    return {
      pair: req.pair, notional: req.notional, tenorDays: req.tenorDays, structure: req.structure, direction: req.direction,
      spot: priced.spot, strike: fromRate(strike), cap: fromRate(cap), fairRateE6: priced.fairRateE6, markupBps,
      offerRateE6: Number(offerRate(fair, BigInt(markupBps))), premium: fromUnits(cost.premium, d), hedgerFee: fromUnits(cost.platformFee, d),
      totalCost: fromUnits(cost.totalCost, d), maxPayout: fromUnits(reserve, d), pool: pool.ref, executionChain: chain,
    };
  }
}

/** The shared pricing engine (server/pricing/quote.ts) and FX oracle behind FairPricer. */
export async function enginePricer(): Promise<FairPricer> {
  const { quote } = await import("../pricing/quote");
  const { getRate } = await import("../fx-oracle");
  return {
    async spot(pair) {
      const r = await getRate(pair);
      if (!r) throw new ApplicationError("ORACLE_NOT_READY", `No live spot for ${pair}`);
      return String(r.rate);
    },
    async fair(a) {
      const q = await quote({
        pair: a.pair, strike: Number(a.strike), payoutCap: Number(a.cap),
        expiryUnixSeconds: Math.floor(Date.now() / 1000) + a.tenorDays * 86_400,
        notional: Number(a.notional), strikeAbove: a.direction === "up",
      });
      return { fairRateE6: Math.round(q.premiumRate * 1e6), spot: String(q.breakdown.spot) };
    },
  };
}
