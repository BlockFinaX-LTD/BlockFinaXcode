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
import { durationsOffered, expiryAt, markupForDays, saleMarkup } from "@shared/domain/durations";
import { isOffered, NOT_OFFERED_MESSAGE, poolForSale } from "@shared/domain/offered-directions";
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
  formatResourceId,
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
  fair(a: { pair: string; strike: string; cap: string; tenorDays: number; notional: string; direction: "up" | "down"; vol?: number }): Promise<{ fairRateE6: number; spot: string; vol?: number; warning?: string }>;
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

  /**
   * BlockFinaX's fair price per tenor, for underwriters setting their offer. Priced on
   * a reference cover (protection `strikeDistanceBps` from today, default 2%, capped 10%
   * beyond, 1,000 notional) so tenors compare on the same terms. Returned as a fraction of notional.
   */
  async fairTable(pair: string, direction: "up" | "down", tenors: number[], strikeDistanceBps = 200, view?: { vol: number; ceilingBps: number }, limitBps = 1_000) {
    const spot = Number(await this.pricer.spot(pair));
    const sign = direction === "up" ? 1 : -1;
    const strike = spot * (1 + (sign * strikeDistanceBps) / 10_000);
    const cap = strike * (1 + (sign * limitBps) / 10_000);
    const rows = [];
    for (const tenorDays of tenors) {
      try {
        const terms = { pair, notional: "1000", tenorDays, structure: "capped", direction, strike: strike.toFixed(6), cap: cap.toFixed(6) } as any;
        const f = await this.pricer.fair(terms);
        if (!view) { rows.push({ tenorDays, fairRateE6: f.fairRateE6 }); continue; }
        // An underwriter's volatility view, as the markup that charges it: their price over ours.
        const mine = await this.pricer.fair({ ...terms, vol: view.vol });
        const raw = f.fairRateE6 > 0 ? Math.round((mine.fairRateE6 / f.fairRateE6) * 10_000) : null;
        rows.push({ tenorDays, fairRateE6: f.fairRateE6, marketVol: f.vol ?? null, viewRateE6: mine.fairRateE6,
          markupBps: raw === null ? null : Math.min(Math.max(raw, 9_000), view.ceilingBps), capped: raw !== null && raw > view.ceilingBps });
      } catch {
        rows.push({ tenorDays, fairRateE6: null });
      }
    }
    return { pair, direction, spot: String(spot), reference: { strike: strike.toFixed(6), cap: cap.toFixed(6) }, rows };
  }

  /** Tenors and structures on sale for a pair, optionally for one direction only. */
  async options(pair: string, direction?: "up" | "down") {
    const chain = this.chains.executionNetworkFor();
    const pools = (await this.adapters.adapterFor(chain.key).listPools())
      .filter((p) => p.pair === pair && p.acceptingHedges && poolForSale(p.direction)
        && (!direction || (isOffered(direction) && (p.direction === "both" || p.direction === direction))));
    const rows = new Map<number, { open: boolean; capped: boolean; capacity: number }>();
    // Pools that sell any day in a range: the widest range on sale.
    let range: { minDays: number; maxDays: number } | null = null;
    for (const p of pools) {
      const offered = durationsOffered(p);
      if (offered.range) range = range ? { minDays: Math.min(range.minDays, offered.range.minDays), maxDays: Math.max(range.maxDays, offered.range.maxDays) } : offered.range;
      for (const t of p.tenors.filter((x) => x.active && offered.days.includes(x.tenorDays))) {
        const r = rows.get(t.tenorDays) ?? { open: false, capped: false, capacity: 0 };
        r.open ||= p.structures.open;
        r.capped ||= p.structures.capped;
        r.capacity = Math.max(r.capacity, Number((await this.capacityFor(p, t.tenorDays)) ?? p.liquidity.capacity));
        rows.set(t.tenorDays, r);
      }
    }
    return {
      pair,
      anyDay: range,
      tenors: Array.from(rows.entries()).sort(([a], [b]) => a - b)
        .map(([tenorDays, r]) => ({ tenorDays, open: r.open, capped: r.capped, maxPayoutAvailable: String(r.capacity) })),
    };
  }

  /**
   * Price and sign a hedge. `accounts` are the buyer's addresses by chain; the quote is
   * bound to the account on whichever chain executes it.
   */
  async quote(req: ProtectionRequest, accounts: Record<ChainKey, string>): Promise<ProtectionQuote> {
    if (!isOffered(req.direction)) throw new ApplicationError("INVALID_REQUEST", NOT_OFFERED_MESSAGE);
    if (req.strikeDistanceBps !== undefined) {
      const d = req.strikeDistanceBps;
      if (typeof d !== "number" || !Number.isFinite(d) || d < 0 || d > 5_000) {
        throw new ApplicationError("INVALID_STRIKE", "The strike must be between 0% and 50% from today's rate");
      }
      // Hundredths of a basis point (0.0001%) is the finest step a strike can be set in.
      if (Math.abs(d * 100 - Math.round(d * 100)) > 1e-6) {
        throw new ApplicationError("INVALID_STRIKE", "Set the strike to at most 4 decimal places of a percent");
      }
    }
    if (req.capDistanceBps !== undefined && !(Number.isInteger(req.capDistanceBps) && req.capDistanceBps > 0 && req.capDistanceBps <= 10_000)) {
      throw new ApplicationError("INVALID_CAP", "The limit must be between 0% and 100% beyond the strike");
    }
    if (req.structure === "capped" && !req.cap && req.capDistanceBps === undefined) throw new ApplicationError("INVALID_CAP", "Choose a limit for Limited protection");
    const chain = this.chains.require(this.chains.executionNetworkFor().key, "newHedges");
    const buyer = accounts[chain.key];
    if (!buyer) throw new ApplicationError("INVALID_REQUEST", `No ${chain.name} account yet; create one before buying protection`);
    const adapter = this.adapters.adapterFor(chain.key);
    const spotNow = Number(await this.pricer.spot(req.pair));
    const pools = await adapter.listPools();
    const requestedDistanceBps = req.strikeDistanceBps ?? strikeDistanceBps(req, spotNow);

    const candidates = pools
      .map((pool) => ({ pool, markupBps: saleMarkup(pool, req.tenorDays, req.direction) }))
      .filter(({ pool, markupBps }) => pool.pair === req.pair && pool.acceptingHedges && (pool.direction === "both" || pool.direction === req.direction)
        && (!req.pool || formatResourceId(pool.ref) === req.pool)
        && requestedDistanceBps >= (pool.structures.minStrikeDistanceBps ?? 0)
        && markupBps !== null && (req.structure === "open" ? pool.structures.open : pool.structures.capped))
      .sort((a, b) => a.markupBps! - b.markupBps!);
    if (candidates.length === 0) {
      // Say so plainly when the only reason is that the strike is too close to today's rate.
      // Only when every pool that otherwise fits is ruled out by its closest strike.
      const closest = pools
        .filter((p) => p.pair === req.pair && p.acceptingHedges && (p.direction === "both" || p.direction === req.direction)
          && (!req.pool || formatResourceId(p.ref) === req.pool) && markupForDays(p, req.tenorDays) !== null
          && (req.structure === "open" ? p.structures.open : p.structures.capped))
        .map((p) => p.structures.minStrikeDistanceBps ?? 0);
      if (closest.length && closest.every((min) => requestedDistanceBps < min)) {
        throw new ApplicationError("STRIKE_TOO_CLOSE", `Protection must start at least ${Math.min(...closest) / 100}% from today's rate for this cover`);
      }
    }
    if (candidates.length === 0) throw new ApplicationError("TENOR_DISABLED", `No pool is offering a ${req.tenorDays}-day ${req.structure === "open" ? "open" : "limited"} ${req.pair} ${req.direction === "up" ? "Up cover" : "Down cover"}. Request a quote instead.`);

    // Fill from the cheapest pools first, across up to six pools when one cannot take it all.
    const routed = await this.route(req, candidates as { pool: CurrencyPool; markupBps: number }[], chain.key);
    if (routed && !(routed instanceof ApplicationError)) {
      if (routed.length === 1) return adapter.signQuote(routed[0].economic, buyer, routed[0].pool.poolId);
      const legs = [];
      for (const leg of routed) legs.push(await adapter.signQuote(leg.economic, buyer, leg.pool.poolId));
      return { economic: combine(legs.map((l) => l.economic), routed[0].pool.asset.decimals), buyer, expiresAt: Math.min(...legs.map((l) => l.expiresAt)), executable: legs[0].executable, legs: legs.map((l) => ({ economic: l.economic, executable: l.executable })) };
    }
    if (routed instanceof ApplicationError && routed.code === "INSUFFICIENT_LIQUIDITY") throw routed;

    let last: ApplicationError = new ApplicationError("INSUFFICIENT_LIQUIDITY", "Not enough free liquidity for that amount");
    for (const { pool, markupBps } of candidates) {
      const economic = await this.economic(req, pool, markupBps!, chain.key);
      if (economic instanceof ApplicationError) { last = economic; continue; }
      return adapter.signQuote(economic, buyer, pool.poolId);
    }
    throw last;
  }

  /** Money able to back `days`-day cover in this pool, from the contract when it reports it. */
  private async capacityFor(pool: CurrencyPool, days: number): Promise<string | null> {
    let a: { capacityFor?: (id: number, d: number) => Promise<string | null> };
    try {
      a = this.adapters.adapterForContract(pool.ref.chain, pool.ref.contract) as unknown as typeof a;
    } catch {
      return null; // a contract this server does not manage: use the pool's total
    }
    return a.capacityFor ? a.capacityFor(pool.poolId, days).catch(() => null) : null;
  }

  /**
   * The legs of one protection: the cheapest pools first, pools at the same price sharing
   * in proportion to the room each has, at most six pools. Every leg shares the spot,
   * strike, cap and fair rate priced once, as the contract requires. Null when the
   * cheapest pool cannot be priced (the caller falls back to pricing pool by pool).
   */
  private async route(req: ProtectionRequest, candidates: { pool: CurrencyPool; markupBps: number }[], chain: ChainKey) {
    if (!candidates.length) return null;
    const first = candidates[0].pool;
    const terms = await this.terms(req, first);
    if (terms instanceof ApplicationError) return null;
    const { spot, strike, cap } = terms;
    const up = req.direction === "up";
    const d = first.asset.decimals;
    const width = up ? cap - strike : strike - cap;
    const total = toUnits(req.notional, d);
    const minLeg = BigInt(10) * BigInt(10) ** BigInt(d);

    // Pools that can sell these exact terms, and how much notional each can back now.
    const usable: { pool: CurrencyPool; markupBps: number; room: bigint }[] = [];
    for (const c of candidates) {
      const p = c.pool;
      if (p.asset.decimals !== d) continue;
      if (req.structure === "open" && p.structures.openMaxPayoutBps !== first.structures.openMaxPayoutBps) continue;
      const minBps = BigInt(p.structures.minStrikeDistanceBps ?? 0);
      if ((up ? strike - spot : spot - strike) * BigInt(10_000) < minBps * spot) continue;
      if (checkTerms({ structures: p.structures, structure: req.structure, strikeAbove: up, spot, strike, cap })) continue;
      let reserveRoom = toUnits((await this.capacityFor(p, req.tenorDays)) ?? p.liquidity.capacity, d);
      const sideMax = p.sideTerms ? toUnits(up ? p.sideTerms.upMaxReserve : p.sideTerms.downMaxReserve, d) : BigInt(0);
      if (sideMax > BigInt(0)) {
        const held = toUnits(p.sideReserved ? (up ? p.sideReserved.up : p.sideReserved.down) : "0", d);
        const left = sideMax - held;
        if (left < reserveRoom) reserveRoom = left;
      }
      const room = reserveRoom > BigInt(0) ? (reserveRoom * spot) / width : BigInt(0);
      if (room >= minLeg) usable.push({ ...c, room });
    }

    // Allocate, cheapest price first; a price shared by several pools is split by room.
    const legs: { pool: CurrencyPool; markupBps: number; notional: bigint }[] = [];
    let left = total;
    const prices = Array.from(new Set(usable.map((u) => u.markupBps))).sort((a, b) => a - b);
    for (const price of prices) {
      if (left === BigInt(0)) break;
      const group = usable.filter((u) => u.markupBps === price).slice(0, 6 - legs.length);
      if (!group.length) break;
      const room = group.reduce((sum, g) => sum + g.room, BigInt(0));
      const take = room < left ? room : left;
      const parts = group.map((g) => (take * g.room) / room);
      let rest = take - parts.reduce((a, b) => a + b, BigInt(0));
      for (let i = 0; i < group.length && rest > BigInt(0); i++) {
        const extra = group[i].room - parts[i] < rest ? group[i].room - parts[i] : rest;
        parts[i] += extra;
        rest -= extra;
      }
      group.forEach((g, i) => { if (parts[i] > BigInt(0)) legs.push({ pool: g.pool, markupBps: g.markupBps, notional: parts[i] }); });
      left -= take;
      if (legs.length >= 6) break;
    }
    if (left > BigInt(0)) return new ApplicationError("INSUFFICIENT_LIQUIDITY", "Not enough free liquidity across all pools for that amount and duration");
    // A sliver below the contract's minimum joins the largest leg in its price group when it fits, else the whole route fails.
    if (legs.some((l) => l.notional < minLeg)) {
      const small = legs.filter((l) => l.notional < minLeg);
      for (const s of small) {
        const home = legs.find((l) => l !== s && l.notional >= minLeg && usable.find((u) => u.pool === l.pool)!.room - l.notional >= s.notional);
        if (!home) return null;
        home.notional += s.notional;
        legs.splice(legs.indexOf(s), 1);
      }
    }
    return legs.map((l) => ({ pool: l.pool, economic: this.leg(req, l.pool, l.markupBps, chain, terms, l.notional) }));
  }

  /** Price the terms once against a pool's rules: spot, exact strike and cap, fair rate. */
  private async terms(req: ProtectionRequest, pool: CurrencyPool): Promise<{ priced: { fairRateE6: number; spot: string; warning?: string }; spot: bigint; strike: bigint; cap: bigint } | ApplicationError> {
    const up = req.direction === "up";
    // A strike or limit given as a distance is measured from the rate actually priced at.
    const strikeFor = (spot: bigint) => req.strikeDistanceBps === undefined ? toRate(req.strike) : awayFrom(spot, req.strikeDistanceBps, up);
    const capFor = (spot: bigint, strike: bigint) => req.structure === "open"
      ? openCap(BigInt(pool.structures.openMaxPayoutBps), up, spot, strike)
      : req.capDistanceBps === undefined ? toRate(req.cap!) : awayFrom(strike, req.capDistanceBps, up);

    // Re-price until the strike and cap match the spot priced at (Open cover's cap, and any
    // strike or limit given as a distance, depend on it).
    const first = toRate(await this.pricer.spot(req.pair));
    let strike = strikeFor(first);
    let cap = capFor(first, strike);
    let priced: { fairRateE6: number; spot: string; warning?: string } | null = null;
    for (let i = 0; i < 3 && !priced; i++) {
      const r = await this.pricer.fair({ pair: req.pair, strike: fromRate(strike), cap: fromRate(cap), tenorDays: req.tenorDays, notional: req.notional, direction: req.direction });
      const s = toRate(r.spot);
      const exactStrike = strikeFor(s);
      const exactCap = capFor(s, exactStrike);
      if (exactStrike === strike && exactCap === cap) priced = r; else { strike = exactStrike; cap = exactCap; }
    }
    if (!priced) return new ApplicationError("QUOTE_EXPIRED", "Spot moved while pricing; request the quote again");

    const spot = toRate(priced.spot);
    // A strike typed as a rate can be overtaken by today's rate before it is priced.
    if (req.strikeDistanceBps === undefined && (up ? strike < spot : strike > spot)) {
      return new ApplicationError("INVALID_STRIKE", `Today's rate has moved past this strike. Choose a strike ${up ? "above" : "below"} ${fromRate(spot)}, or set it as a percentage from today's rate.`);
    }
    // The contract's own rule, against the spot it will see.
    const minBps = BigInt(pool.structures.minStrikeDistanceBps ?? 0);
    if ((up ? strike - spot : spot - strike) * BigInt(10_000) < minBps * spot) {
      return new ApplicationError("STRIKE_TOO_CLOSE", `Protection must start at least ${Number(minBps) / 100}% from today's rate for this cover`);
    }
    const problem = checkTerms({ structures: pool.structures, structure: req.structure, strikeAbove: up, spot, strike, cap });
    if (problem) return new ApplicationError(problem.code, problem.message);
    return { priced, spot, strike, cap };
  }

  /** The economic quote for one pool, or the reason it cannot take the hedge. */
  async economic(req: ProtectionRequest, pool: CurrencyPool, markupBps: number, chain: ChainKey): Promise<EconomicQuote | ApplicationError> {
    const t = await this.terms(req, pool);
    if (t instanceof ApplicationError) return t;
    const d = pool.asset.decimals;
    const notional = toUnits(req.notional, d);
    const reserve = maxPayout(notional, t.strike, t.cap, t.spot);
    // Underwriters may back only some durations, so what is free for this one can be less than the pool's total.
    const capacity = (await this.capacityFor(pool, req.tenorDays)) ?? pool.liquidity.capacity;
    if (reserve > toUnits(capacity, d)) return new ApplicationError("INSUFFICIENT_LIQUIDITY", "Not enough free liquidity for that amount and duration");
    return this.leg(req, pool, markupBps, chain, t, notional);
  }

  /** One pool's share of a protection, at terms already priced. */
  private leg(req: ProtectionRequest, pool: CurrencyPool, markupBps: number, chain: ChainKey,
    t: { priced: { fairRateE6: number; spot: string; warning?: string }; spot: bigint; strike: bigint; cap: bigint }, notional: bigint): EconomicQuote {
    const d = pool.asset.decimals;
    const { priced, spot, strike, cap } = t;
    const reserve = maxPayout(notional, strike, cap, spot);
    const fair = BigInt(priced.fairRateE6);
    const cost = costBreakdown({ notional, fairRate: fair, markupBps: BigInt(markupBps), hedgerFeeRate: BigInt(pool.fees.hedgerFeeRateE6) });
    return {
      pair: req.pair, notional: fromUnits(notional, d), tenorDays: req.tenorDays, structure: req.structure, direction: req.direction,
      spot: priced.spot, strike: fromRate(strike), cap: fromRate(cap), fairRateE6: priced.fairRateE6, markupBps,
      offerRateE6: Number(offerRate(fair, BigInt(markupBps))), premium: fromUnits(cost.premium, d), hedgerFee: fromUnits(cost.platformFee, d),
      totalCost: fromUnits(cost.totalCost, d), maxPayout: fromUnits(reserve, d), pool: pool.ref, executionChain: chain,
      ...(priced.warning ? { warning: priced.warning } : {}),
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
        expiryUnixSeconds: expiryAt(Math.floor(Date.now() / 1000), a.tenorDays),
        notional: Number(a.notional), strikeAbove: a.direction === "up", sigmaOverride: a.vol, leverageWarningOnly: true,
      });
      return { fairRateE6: Math.round(q.premiumRate * 1e6), spot: String(q.breakdown.spot), vol: q.breakdown.inputs.sigma, warning: q.leverageWarning };
    },
  };
}

/**
 * A rate `bps` beyond `base` in the protected direction, rounded away from it so the distance
 * is never short. `bps` may carry two decimals (hundredths of a basis point, 0.0001%).
 */
function awayFrom(base: bigint, bps: number, up: boolean): bigint {
  const hundredths = BigInt(Math.round(bps * 100));
  const move = (base * hundredths + BigInt(999_999)) / BigInt(1_000_000);
  return up ? base + move : base - move;
}

/** How far the requested strike is from today's rate, in bps of spot. */
function strikeDistanceBps(req: ProtectionRequest, spot: number) {
  return spot > 0 ? (Math.abs(Number(req.strike) - spot) / spot) * 10_000 : 0;
}

/** The whole of a protection split across pools: amounts summed, rates weighted by amount. */
function combine(legs: EconomicQuote[], decimals: number): EconomicQuote {
  const sum = (k: "notional" | "premium" | "hedgerFee" | "totalCost" | "maxPayout") =>
    fromUnits(legs.reduce((a, l) => a + toUnits(l[k], decimals), BigInt(0)), decimals);
  const notional = legs.reduce((a, l) => a + Number(l.notional), 0);
  const weighted = (k: "markupBps" | "offerRateE6") => Math.round(legs.reduce((a, l) => a + l[k] * Number(l.notional), 0) / notional);
  return { ...legs[0], notional: sum("notional"), premium: sum("premium"), hedgerFee: sum("hedgerFee"), totalCost: sum("totalCost"), maxPayout: sum("maxPayout"), markupBps: weighted("markupBps"), offerRateE6: weighted("offerRateE6") };
}
