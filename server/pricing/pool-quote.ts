/**
 * pool-quote.ts: prices hedges sold from a currency pool.
 *
 * Two jobs:
 *
 *   quotePoolBuy       a hedger's exact terms, priced, checked against the pool, and
 *                      signed so they can be bought on-chain.
 *   tenorFairPrices    the fair and offer price of every tenor at a reference strike,
 *                      for the underwriter's pricing table.
 *
 * The fair price comes from quote(), the same engine that prices createEvent: live
 * spot, USD rates, empirical drift, GARCH-blended volatility and Merton jumps, valued
 * as a call or put spread between strike and cap. Open cover is valued the same way
 * with its cap at the pool's max payout, because that is exactly what the contract
 * pays and reserves. Swapping the model later means changing quote(), not this file.
 *
 *   final premium = fair value x tenor markup        (applied on-chain)
 *                 + hedger fee on that premium       (applied on-chain)
 */

import { ethers } from "ethers";
import { getRate } from "../fx-oracle";
import { quote } from "./quote";
import { provider } from "./quote-purchase";
import { signPoolBuyQuote } from "./signer";
import {
  CURRENCY_POOL_ABI,
  STRUCTURE,
  checkTerms,
  costBreakdown,
  fromFixed6,
  maxPayout,
  normalizeBasePool,
  normalizeBasePosition,
  offerRate,
  openCap,
  toFixed6,
  type PoolStructures,
  type StructureName,
} from "@shared/currency-pool";

const DAY_SECONDS = 86_400;

interface ChainPool {
  diamond: string;
  underlying: string;
  acceptingHedges: boolean;
  hedgerFeeRate: bigint;
  structures: PoolStructures;
  tenors: { tenorDays: number; active: boolean; markupBps: number }[];
  capacity: bigint;
  /** Payment-token decimals: 6 for USDC on Base, 18 for the BSC token. */
  decimals: number;
}

async function readPool(chainId: number, poolId: number): Promise<ChainPool> {
  const { p, diamond } = await provider(chainId);
  const c = new ethers.Contract(diamond, CURRENCY_POOL_ABI, p);
  const [pool, tenors, liq] = await Promise.all([
    c.getCurrencyPool(poolId),
    c.getPoolTenors(poolId),
    c.getPoolLiquidity(poolId),
  ]);
  if (pool.id === BigInt(0)) throw new Error(`Pool ${poolId} not found on chain ${chainId}`);
  const token = new ethers.Contract(pool.paymentToken, ["function decimals() view returns (uint8)"], p);
  const decimals = Number(await token.decimals());
  return {
    diamond,
    underlying: pool.underlying,
    acceptingHedges: pool.acceptingHedges,
    hedgerFeeRate: pool.hedgerFeeRate,
    structures: {
      openEnabled: pool.openEnabled,
      cappedEnabled: pool.cappedEnabled,
      minCapDistanceBps: Number(pool.minCapDistanceBps),
      maxCapDistanceBps: Number(pool.maxCapDistanceBps),
      openMaxPayoutBps: Number(pool.openMaxPayoutBps),
    },
    tenors: tenors.map((t: { tenorDays: bigint; active: boolean; markupBps: bigint }) => ({
      tenorDays: Number(t.tenorDays),
      active: t.active,
      markupBps: Number(t.markupBps),
    })),
    capacity: liq.capacity,
    decimals,
  };
}

/**
 * Fair rate for exact terms, plus the spot it was priced at.
 *
 * Open cover's cap depends on spot, and quote() reads spot itself. If spot ticked
 * between our read and quote()'s, the cap is recomputed and priced once more, so the
 * spot, cap and price that get signed always belong together.
 */
async function fairFor(a: {
  pair: string;
  structure: StructureName;
  strikeAbove: boolean;
  strike: bigint;
  cap?: bigint;
  openMaxPayoutBps: number;
  tenorDays: number;
  notional: number;
}): Promise<{ fairRate: bigint; spot: bigint; cap: bigint }> {
  const expiry = Math.floor(Date.now() / 1000) + a.tenorDays * DAY_SECONDS;
  const capFor = (spot: bigint) =>
    a.structure === "open"
      ? openCap(BigInt(a.openMaxPayoutBps), a.strikeAbove, spot, a.strike)
      : (a.cap as bigint);

  const live = await getRate(a.pair);
  if (!live) throw new Error(`No live spot for ${a.pair}`);
  let cap = capFor(toFixed6(live.rate));

  for (let attempt = 0; attempt < 2; attempt++) {
    const q = await quote({
      pair: a.pair,
      strike: fromFixed6(a.strike),
      payoutCap: fromFixed6(cap),
      expiryUnixSeconds: expiry,
      notional: a.notional,
      strikeAbove: a.strikeAbove,
    });
    const spot = toFixed6(q.breakdown.spot);
    const expectedCap = capFor(spot);
    if (expectedCap === cap) {
      return { fairRate: BigInt(Math.round(q.premiumRate * 1e6)), spot, cap };
    }
    cap = expectedCap;
  }
  throw new Error("Spot moved while pricing; please request the quote again");
}

/** Every pool on the chain that sells cover on this pair. */
async function readPoolsForPair(chainId: number, pair: string): Promise<(ChainPool & { poolId: number })[]> {
  const { p, diamond } = await provider(chainId);
  const c = new ethers.Contract(diamond, CURRENCY_POOL_ABI, p);
  const count = Number(await c.getCurrencyPoolCount());
  const ids: number[] = [];
  for (let id = 1; id <= count; id++) {
    const pool = await c.getCurrencyPool(id);
    if (pool.underlying === pair) ids.push(id);
  }
  return Promise.all(ids.map(async (poolId) => ({ ...(await readPool(chainId, poolId)), poolId })));
}

export interface PoolBuyRequest {
  chainId: number;
  /** A specific pool. Omit it and pass `pair` to let the engine pick one. */
  poolId?: number;
  pair?: string;
  buyer: string;
  /** Payment-token amount, e.g. 100000 for $100,000. */
  notional: number;
  tenorDays: number;
  structure: StructureName;
  strikeAbove: boolean;
  strike: number;
  /** Required for Capped. Ignored for Open, whose cap comes from the pool. */
  cap?: number;
}

type Refusal = { ok: false; reason: string };

/**
 * Quote a hedge. With a pair and no pool, the hedger never sees pools: every pool on
 * that pair offering the tenor and structure is tried, cheapest markup first, and the
 * first one with room for the hedge is quoted. The fair price is the same in all of
 * them for the same terms, so the markup alone decides which is cheapest.
 */
export async function quotePoolBuy(req: PoolBuyRequest) {
  if (req.structure === "capped" && req.cap === undefined) {
    return { ok: false as const, reason: "Choose a cap level for Capped protection" };
  }
  let candidates: (ChainPool & { poolId: number })[];
  if (req.poolId) {
    candidates = [{ ...(await readPool(req.chainId, req.poolId)), poolId: req.poolId }];
  } else if (req.pair) {
    candidates = await readPoolsForPair(req.chainId, req.pair);
  } else {
    return { ok: false as const, reason: "Pass a poolId or a currency pair" };
  }

  const eligible = candidates
    .map((pool) => ({ pool, tenor: pool.tenors.find((t) => t.tenorDays === req.tenorDays && t.active) }))
    .filter(({ pool, tenor }) =>
      pool.acceptingHedges && tenor &&
      (req.structure === "open" ? pool.structures.openEnabled : pool.structures.cappedEnabled))
    .sort((a, b) => a.tenor!.markupBps - b.tenor!.markupBps);

  if (eligible.length === 0) {
    return { ok: false as const, reason: `No pool is offering ${req.tenorDays}-day ${req.structure} protection right now` };
  }

  let last: Refusal = { ok: false, reason: "Not enough free liquidity for that amount" };
  for (const { pool, tenor } of eligible) {
    const result = await quoteFromPool(req, pool, tenor!.markupBps);
    if (result.ok) return result;
    last = result;
  }
  return last;
}

async function quoteFromPool(req: PoolBuyRequest, pool: ChainPool & { poolId: number }, markupBps: number) {
  // Token units, not 6-decimal fixed: BSC's payment token has 18 decimals.
  const notional = ethers.parseUnits(String(req.notional), pool.decimals);
  const strike = toFixed6(req.strike);
  const { fairRate, spot, cap } = await fairFor({
    pair: pool.underlying,
    structure: req.structure,
    strikeAbove: req.strikeAbove,
    strike,
    cap: req.cap === undefined ? undefined : toFixed6(req.cap),
    openMaxPayoutBps: pool.structures.openMaxPayoutBps,
    tenorDays: req.tenorDays,
    notional: req.notional,
  });

  const problem = checkTerms({
    structures: pool.structures,
    structure: req.structure,
    strikeAbove: req.strikeAbove,
    spot, strike, cap,
  });
  if (problem) return { ok: false as const, reason: problem };

  const reserve = maxPayout(notional, strike, cap, spot);
  if (reserve > pool.capacity) {
    return { ok: false as const, reason: "Not enough free liquidity for that amount" };
  }

  const cost = costBreakdown({
    notional, fairRate, markupBps: BigInt(markupBps), hedgerFeeRate: pool.hedgerFeeRate,
  });

  const params = {
    poolId: BigInt(pool.poolId),
    notional,
    tenorDays: req.tenorDays,
    structure: STRUCTURE[req.structure],
    strikeAbove: req.strikeAbove,
    spot, strike, cap, fairRate,
  };
  const attestation = await signPoolBuyQuote({
    ...params,
    chainId: req.chainId,
    diamondAddress: pool.diamond,
    buyer: req.buyer,
  });
  if (!attestation) return { ok: false as const, reason: "Pricing engine signing key is not configured" };

  const s = (v: bigint) => v.toString();
  return {
    ok: true as const,
    /** Pass straight into buyPoolProtection, adding maxCost and deadline. */
    buyParams: {
      poolId: s(params.poolId),
      notional: s(notional),
      tenorDays: req.tenorDays,
      structure: params.structure,
      strikeAbove: req.strikeAbove,
      spot: s(spot), strike: s(strike), cap: s(cap), fairRate: s(fairRate),
      quoteTimestamp: s(attestation.quoteTimestamp),
      quoteNonce: attestation.quoteNonce,
      signature: attestation.signature,
    },
    display: {
      spot: fromFixed6(spot),
      strike: fromFixed6(strike),
      cap: fromFixed6(cap),
      fairRatePct: Number(fairRate) / 1e4,
      offerRatePct: Number(cost.premiumRate) / 1e4,
      differencePct: (Number(cost.premiumRate) - Number(fairRate)) / 1e4,
      premium: Number(ethers.formatUnits(cost.premium, pool.decimals)),
      platformFee: Number(ethers.formatUnits(cost.platformFee, pool.decimals)),
      totalCost: Number(ethers.formatUnits(cost.totalCost, pool.decimals)),
      maxPayout: Number(ethers.formatUnits(reserve, pool.decimals)),
      expiresAt: Math.floor(Date.now() / 1000) + req.tenorDays * DAY_SECONDS,
    },
    totalCost: s(cost.totalCost),
    quoteExpiresAt: s(attestation.quoteTimestamp + BigInt(120)),
  };
}

/**
 * What a hedger can choose on a pair right now: each tenor some pool offers, which
 * structures it comes in, and the largest maximum payout any single pool has room
 * for. The app builds its duration and structure pickers from this, so a hedger is
 * never shown an option nobody is selling.
 */
export async function poolOptions(chainId: number, pair: string) {
  const pools = (await readPoolsForPair(chainId, pair)).filter((p) => p.acceptingHedges);
  const byTenor = new Map<number, { open: boolean; capped: boolean; maxCapacity: bigint; decimals: number }>();
  for (const pool of pools) {
    for (const t of pool.tenors.filter((x) => x.active)) {
      const row = byTenor.get(t.tenorDays) ?? { open: false, capped: false, maxCapacity: BigInt(0), decimals: pool.decimals };
      row.open = row.open || pool.structures.openEnabled;
      row.capped = row.capped || pool.structures.cappedEnabled;
      if (pool.capacity > row.maxCapacity) row.maxCapacity = pool.capacity;
      byTenor.set(t.tenorDays, row);
    }
  }
  return {
    pair,
    tenors: Array.from(byTenor.entries())
      .sort(([a], [b]) => a - b)
      .map(([tenorDays, r]) => ({
        tenorDays,
        open: r.open,
        capped: r.capped,
        maxPayoutAvailable: Number(ethers.formatUnits(r.maxCapacity, r.decimals)),
      })),
  };
}

export interface TenorPriceRequest {
  pair: string;
  tenors: { tenorDays: number; active: boolean; markupBps: number }[];
  structure: StructureName;
  strikeAbove: boolean;
  /** Reference strike distance from spot, in bps. Default 200 (2%). */
  refStrikeBps?: number;
  /** Reference cap distance from strike for Capped, in bps. Default 1000 (10%). */
  refCapBps?: number;
  openMaxPayoutBps?: number;
}

/**
 * Fair and offer price of each tenor at one reference strike and cap. The hedger's
 * real price depends on the strike and cap they pick; this gives the underwriter a
 * consistent yardstick for setting markups, as a rate per $1 of cover.
 */
export async function tenorFairPrices(req: TenorPriceRequest) {
  const live = await getRate(req.pair);
  if (!live) throw new Error(`No live spot for ${req.pair}`);
  const spot = toFixed6(live.rate);
  const strikeMove = (spot * BigInt(req.refStrikeBps ?? 200)) / BigInt(10_000);
  const strike = req.strikeAbove ? spot + strikeMove : spot - strikeMove;
  const capMove = (strike * BigInt(req.refCapBps ?? 1000)) / BigInt(10_000);
  const cap = req.strikeAbove ? strike + capMove : strike - capMove;

  const rows = await Promise.all(
    req.tenors.map(async (t) => {
      try {
        const { fairRate, cap: usedCap } = await fairFor({
          pair: req.pair,
          structure: req.structure,
          strikeAbove: req.strikeAbove,
          strike,
          cap,
          openMaxPayoutBps: req.openMaxPayoutBps ?? 0,
          tenorDays: t.tenorDays,
          notional: 10_000,
        });
        const offer = offerRate(fairRate, BigInt(t.markupBps));
        return {
          tenorDays: t.tenorDays,
          active: t.active,
          markupBps: t.markupBps,
          fairRatePct: Number(fairRate) / 1e4,
          offerRatePct: Number(offer) / 1e4,
          differencePct: (Number(offer) - Number(fairRate)) / 1e4,
          cap: fromFixed6(usedCap),
        };
      } catch (err) {
        return { tenorDays: t.tenorDays, active: t.active, markupBps: t.markupBps, error: (err as Error).message };
      }
    }),
  );

  return { pair: req.pair, spot: fromFixed6(spot), referenceStrike: fromFixed6(strike), structure: req.structure, rows };
}

/** Same table for a pool that already exists, using its own tenors and settings. */
export async function poolTenorFairPrices(a: {
  chainId: number;
  poolId: number;
  structure: StructureName;
  strikeAbove: boolean;
  refStrikeBps?: number;
  refCapBps?: number;
}) {
  const pool = await readPool(a.chainId, a.poolId);
  return tenorFairPrices({
    pair: pool.underlying,
    tenors: pool.tenors,
    structure: a.structure,
    strikeAbove: a.strikeAbove,
    refStrikeBps: a.refStrikeBps,
    refCapBps: a.refCapBps,
    openMaxPayoutBps: pool.structures.openMaxPayoutBps,
  });
}

// ── Normalized reads ──────────────────────────────────────────────────────────

const CHAIN_NAMES: Record<number, string> = { 8453: "base", 56: "bsc" };

async function poolReader(chainId: number) {
  const { p, diamond } = await provider(chainId);
  return { c: new ethers.Contract(diamond, CURRENCY_POOL_ABI, p), p, chain: CHAIN_NAMES[chainId] ?? String(chainId) };
}

async function tokenDecimals(p: ethers.Provider, token: string) {
  return Number(await new ethers.Contract(token, ["function decimals() view returns (uint8)"], p).decimals());
}

/** A pool in the chain-independent shape the app reads (see NormalizedPool). */
export async function readNormalizedPool(chainId: number, poolId: number) {
  const { c, p, chain } = await poolReader(chainId);
  const [pool, tenors, liq] = await Promise.all([c.getCurrencyPool(poolId), c.getPoolTenors(poolId), c.getPoolLiquidity(poolId)]);
  if (pool.id === BigInt(0)) throw new Error(`Pool ${poolId} not found`);
  return normalizeBasePool(chain, pool, tenors, liq, await tokenDecimals(p, pool.paymentToken));
}

/** A hedger's pool hedges, newest first, in the chain-independent shape. */
export async function readNormalizedPositions(chainId: number, hedger: string) {
  const { c, p, chain } = await poolReader(chainId);
  const ids: bigint[] = await c.getHedgerPoolPositionIds(hedger);
  const decimals = new Map<number, number>();
  const out = [];
  for (const id of [...ids].reverse().slice(0, 50)) {
    const pos = await c.getPoolPosition(id);
    const poolId = Number(pos.poolId);
    if (!decimals.has(poolId)) decimals.set(poolId, await tokenDecimals(p, (await c.getCurrencyPool(poolId)).paymentToken));
    out.push(normalizeBasePosition(chain, pos, decimals.get(poolId)!));
  }
  return out;
}
