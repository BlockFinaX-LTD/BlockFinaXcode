/**
 * currency-pool.ts: the Base pool facets' ABI, Base-shaped config types and the Base
 * view normalizers. The pool arithmetic itself is in shared/domain/pool-economics.ts,
 * shared by every chain (Architecture v2.0).
 *
 * Units: amounts are payment-token units (6 decimals on Base, 18 on BSC), FX rates are
 * 6-decimal bigints, rates use PRECISION = 1e6 as 100%, and bps use 10_000 as 100%.
 */

export const PRECISION = BigInt(1_000_000);
export const BPS = BigInt(10_000);

export const STRUCTURE = { open: 0, capped: 1 } as const;
export type StructureName = keyof typeof STRUCTURE;

export const MIN_MARKUP_BPS = 9_000;
export const MAX_MARKUP_BPS = 50_000;
export const MIN_TENOR_DAYS = 1;
export const MAX_TENOR_DAYS = 365;
export const MAX_TENORS_PER_POOL = 16;

/** Common durations offered in the pool-creation form. Any 1 to 365 is accepted. */
export const DEFAULT_TENOR_DAYS = [3, 7, 14, 30, 45] as const;

export interface PoolTenor {
  tenorDays: number;
  active: boolean;
  markupBps: number;
}

export interface PoolStructures {
  openEnabled: boolean;
  cappedEnabled: boolean;
  minCapDistanceBps: number;
  maxCapDistanceBps: number;
  openMaxPayoutBps: number;
}

// The arithmetic lives once, in shared/domain/pool-economics.ts. These names are kept
// so existing callers (pricing server, client contract wrapper, tests) are unchanged.
export { openCap, maxPayout, offerRate, costBreakdown } from "./domain/pool-economics";
import { checkTerms as checkDomainTerms } from "./domain/pool-economics";

/**
 * The contract's strike and cap rules, returning the revert reason it would give, or
 * null when the terms are acceptable. A thin view over the domain check, which also
 * returns a shared error code.
 */
export function checkTerms(a: {
  structures: PoolStructures;
  structure: StructureName;
  strikeAbove: boolean;
  spot: bigint;
  strike: bigint;
  cap: bigint;
}): string | null {
  const problem = checkDomainTerms({
    ...a,
    structures: {
      open: a.structures.openEnabled,
      capped: a.structures.cappedEnabled,
      minCapDistanceBps: a.structures.minCapDistanceBps,
      maxCapDistanceBps: a.structures.maxCapDistanceBps,
      openMaxPayoutBps: a.structures.openMaxPayoutBps,
    },
  });
  return problem ? problem.message : null;
}

/** 6-decimal fixed from a JS number, truncating like the on-chain rate() helper. */
export function toFixed6(value: number): bigint {
  const [whole, frac = ""] = value.toFixed(9).split(".");
  return BigInt(whole) * PRECISION + BigInt((frac + "000000").slice(0, 6));
}

export function fromFixed6(value: bigint): number {
  return Number(value) / 1e6;
}

/** Human-readable ABI for the three currency-pool facets, as used by ethers. */
export const CURRENCY_POOL_ABI = [
  // Pool facet
  "function createCurrencyPool(tuple(string underlying, address paymentToken, bool allowExternalLp, tuple(bool openEnabled, bool cappedEnabled, uint32 minCapDistanceBps, uint32 maxCapDistanceBps, uint32 openMaxPayoutBps) structures, tuple(uint32 tenorDays, bool active, uint32 markupBps)[] tenors, uint256 initialLiquidity) p) returns (uint256)",
  "function setPoolTenor(uint256 poolId, tuple(uint32 tenorDays, bool active, uint32 markupBps) t)",
  "function setPoolStructures(uint256 poolId, tuple(bool openEnabled, bool cappedEnabled, uint32 minCapDistanceBps, uint32 maxCapDistanceBps, uint32 openMaxPayoutBps) st)",
  "function setCurrencyPoolSettings(uint256 poolId, bool acceptingHedges, bool allowExternalLp)",
  "function poolDeposit(uint256 poolId, uint256 amount) returns (uint256)",
  "function requestPoolWithdrawal(uint256 poolId, uint256 shares) returns (uint256)",
  "function cancelPoolWithdrawal(uint256 requestId)",
  "function executePoolWithdrawal(uint256 requestId) returns (uint256)",
  "function withdrawPoolCreatorEarnings(uint256 poolId)",
  // Trade facet
  "function buyPoolProtection(tuple(uint256 poolId, uint256 notional, uint32 tenorDays, uint8 structure, bool strikeAbove, uint256 spot, uint256 strike, uint256 cap, uint256 fairRate, uint256 maxCost, uint256 deadline, uint256 quoteTimestamp, bytes32 quoteNonce, bytes signature) b) returns (uint256)",
  "function claimPoolPayout(uint256 positionId)",
  "function openCap(uint32 maxPayoutBps, bool strikeAbove, uint256 spot, uint256 strike) pure returns (uint256)",
  "function advancePoolSettlementCursor(uint256 poolId, uint256 maxSteps) returns (uint256)",
  // View facet
  "function getCurrencyPoolCount() view returns (uint256)",
  "function getCurrencyPool(uint256 poolId) view returns (tuple(uint256 id, address creator, string underlying, address paymentToken, bool acceptingHedges, bool allowExternalLp, bool openEnabled, bool cappedEnabled, uint32 minCapDistanceBps, uint32 maxCapDistanceBps, uint32 openMaxPayoutBps, uint256 hedgerFeeRate, uint256 payoutFeeRate, uint256 lpProfitFeeRate, uint256 creatorLoyaltyRate, uint256 cash, uint256 reserved, uint256 deferredPremium, uint256 totalShares, uint256 pendingWithdrawShares, uint256 creatorEarnings, uint256 latestExpiry, uint256 activePositions, uint256 settledThroughDay, uint256 createdAt))",
  "function getCreatorPoolIds(address creator) view returns (uint256[])",
  "function getPoolTenors(uint256 poolId) view returns (tuple(uint32 tenorDays, bool active, uint32 markupBps, bool exists)[])",
  "function getPoolLiquidity(uint256 poolId) view returns (tuple(uint256 cash, uint256 reserved, uint256 deferredPremium, uint256 nav, uint256 free, uint256 holdback, uint256 capacity, uint256 totalShares, uint256 pendingWithdrawShares))",
  "function getPoolPosition(uint256 positionId) view returns (tuple(uint256 id, uint256 poolId, address hedger, uint8 structure, bool strikeAbove, uint8 status, uint32 tenorDays, uint64 createdAt, uint64 expiry, uint256 notional, uint256 spot, uint256 strike, uint256 cap, uint256 fairRate, uint256 premiumRate, uint256 premium, uint256 platformFee, uint256 maxPayout, uint256 settlementPrice, uint256 payout))",
  "function getPoolPositionCount(uint256 poolId) view returns (uint256)",
  "function getPoolPositions(uint256 poolId, uint256 offset, uint256 limit) view returns (tuple(uint256 id, uint256 poolId, address hedger, uint8 structure, bool strikeAbove, uint8 status, uint32 tenorDays, uint64 createdAt, uint64 expiry, uint256 notional, uint256 spot, uint256 strike, uint256 cap, uint256 fairRate, uint256 premiumRate, uint256 premium, uint256 platformFee, uint256 maxPayout, uint256 settlementPrice, uint256 payout)[])",
  "function getHedgerPoolPositionIds(address hedger) view returns (uint256[])",
  "function getPoolLpPosition(uint256 poolId, address lp) view returns (uint256 shares, uint256 value)",
  "function getPoolWithdrawal(uint256 requestId) view returns (tuple(uint256 id, uint256 poolId, address lp, uint256 shares, uint64 requestedAt, uint64 unlockAt, bool executed, bool cancelled))",
  "function getLpPoolWithdrawalIds(address lp) view returns (uint256[])",
] as const;

// ── Normalized views ──────────────────────────────────────────────────────────
// The same shape the Stellar wallet server returns (blockfinax-stellar/apps/wallet/
// server/currency-pool-normalize.ts), so the app reads pools and hedges without knowing
// which chain they came from. Amounts are decimal USDC strings, FX rates decimal strings,
// rates integers on the 1e6 scale, times unix seconds.

export interface NormalizedPool {
  chain: string;
  poolId: number;
  creator: string;
  pair: string;
  acceptingHedges: boolean;
  allowExternalLp: boolean;
  structures: { open: boolean; capped: boolean; minCapDistanceBps: number; maxCapDistanceBps: number; openMaxPayoutBps: number };
  tenors: { tenorDays: number; active: boolean; markupBps: number }[];
  fees: { hedgerFeeRateE6: number; payoutFeeRateE6: number; lpProfitFeeRateE6: number; creatorShareE6: number };
  liquidity: { cash: string; reserved: string; deferredPremium: string; nav: string; free: string; holdback: string; capacity: string };
  creatorEarnings: string;
  activePositions: number;
  latestExpiry: number;
}

export interface NormalizedPosition {
  chain: string;
  positionId: number;
  poolId: number;
  hedger: string;
  structure: StructureName;
  direction: "up" | "down";
  status: "active" | "settled" | "claimed";
  tenorDays: number;
  createdAt: number;
  expiry: number;
  notional: string;
  spot: string;
  strike: string;
  cap: string;
  fairRateE6: number;
  premiumRateE6: number;
  premium: string;
  fee: string;
  maxPayout: string;
  settlementPrice: string | null;
  payout: string;
}

/** Exact decimal string from an integer amount, trailing zeros trimmed. */
export function decimalString(value: bigint, decimals: number): string {
  const neg = value < BigInt(0);
  const abs = neg ? -value : value;
  let unit = BigInt(1);
  for (let i = 0; i < decimals; i++) unit *= BigInt(10);
  const s = `${abs / unit}.${(abs % unit).toString().padStart(decimals, "0")}`.replace(/0+$/, "").replace(/\.$/, "");
  return (neg ? "-" : "") + s;
}

const STATUS_NAMES = ["active", "settled", "claimed"] as const;

/** From getCurrencyPool + getPoolTenors + getPoolLiquidity on a Base or BSC Diamond. */
export function normalizeBasePool(chain: string, pool: any, tenors: any[], liq: any, decimals: number): NormalizedPool {
  const amt = (v: bigint) => decimalString(BigInt(v), decimals);
  return {
    chain,
    poolId: Number(pool.id),
    creator: pool.creator,
    pair: pool.underlying,
    acceptingHedges: pool.acceptingHedges,
    allowExternalLp: pool.allowExternalLp,
    structures: {
      open: pool.openEnabled, capped: pool.cappedEnabled,
      minCapDistanceBps: Number(pool.minCapDistanceBps), maxCapDistanceBps: Number(pool.maxCapDistanceBps),
      openMaxPayoutBps: Number(pool.openMaxPayoutBps),
    },
    tenors: tenors.map((t) => ({ tenorDays: Number(t.tenorDays), active: t.active, markupBps: Number(t.markupBps) })),
    fees: {
      hedgerFeeRateE6: Number(pool.hedgerFeeRate), payoutFeeRateE6: Number(pool.payoutFeeRate),
      lpProfitFeeRateE6: Number(pool.lpProfitFeeRate), creatorShareE6: Number(pool.creatorLoyaltyRate),
    },
    liquidity: {
      cash: amt(liq.cash), reserved: amt(liq.reserved), deferredPremium: amt(liq.deferredPremium), nav: amt(liq.nav),
      free: amt(liq.free), holdback: amt(liq.holdback), capacity: amt(liq.capacity),
    },
    creatorEarnings: amt(pool.creatorEarnings),
    activePositions: Number(pool.activePositions),
    latestExpiry: Number(pool.latestExpiry),
  };
}

/** From getPoolPosition on a Base or BSC Diamond. */
export function normalizeBasePosition(chain: string, p: any, decimals: number): NormalizedPosition {
  const amt = (v: bigint) => decimalString(BigInt(v), decimals);
  const rate = (v: bigint) => decimalString(BigInt(v), 6);
  return {
    chain,
    positionId: Number(p.id),
    poolId: Number(p.poolId),
    hedger: p.hedger,
    structure: Number(p.structure) === STRUCTURE.open ? "open" : "capped",
    direction: p.strikeAbove ? "up" : "down",
    status: STATUS_NAMES[Number(p.status)],
    tenorDays: Number(p.tenorDays),
    createdAt: Number(p.createdAt),
    expiry: Number(p.expiry),
    notional: amt(p.notional),
    spot: rate(p.spot),
    strike: rate(p.strike),
    cap: rate(p.cap),
    fairRateE6: Number(p.fairRate),
    premiumRateE6: Number(p.premiumRate),
    premium: amt(p.premium),
    fee: amt(p.platformFee),
    maxPayout: amt(p.maxPayout),
    settlementPrice: Number(p.status) === 0 ? null : rate(p.settlementPrice),
    payout: amt(p.payout),
  };
}
