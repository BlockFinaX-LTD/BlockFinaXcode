/**
 * BlockFinaX domain types (Architecture v2.0).
 *
 * Everything in shared/domain speaks BlockFinaX: pools, tenors, quotes, hedges,
 * settlement, routing, balances. Nothing here knows about ABI, XDR, ECDSA, ed25519,
 * `msg.sender`, `require_auth`, ERC20 approvals or Stellar asset contracts. Those live
 * in the chain adapters (server/chain) and wallet providers (client/src/lib/wallets).
 *
 * Amounts crossing this boundary are exact decimal strings in human units ("1800.5").
 * Adapters convert to and from chain units using the Asset's decimals.
 *
 * Terminology (docs/architecture/v2/architecture-v2.0.md):
 *   Liquidity Hub       the chain where canonical underwriting TVL currently lives
 *   Funding Network     the chain a user supplies assets from
 *   Withdrawal Network  the chain a user wants assets returned to
 *   Execution Network   the chain a hedge executes on (by default, the Liquidity Hub)
 */

/** Registry key of a configured chain, e.g. "base", "bsc", "stellar". */
export type ChainKey = string;

export type ChainFamily = "evm" | "stellar";

/** A chain-aware identity for anything on-chain: `chain:contract:id`. */
export interface ResourceId {
  chain: ChainKey;
  contract: string;
  id: string;
}

export function formatResourceId(r: ResourceId): string {
  return `${r.chain}:${r.contract}:${r.id}`;
}

export function parseResourceId(value: string): ResourceId {
  const first = value.indexOf(":");
  const last = value.lastIndexOf(":");
  if (first <= 0 || last <= first) throw new ApplicationError("INVALID_REQUEST", `Not a resource id: ${value}`);
  return { chain: value.slice(0, first), contract: value.slice(first + 1, last), id: value.slice(last + 1) };
}

export interface Asset {
  symbol: string;
  chain: ChainKey;
  decimals: number;
  /** ERC20 address on EVM, asset contract id on Stellar. Adapters only. */
  addressOrContract: string;
}

/** One lifecycle for every chain and wallet. Providers map native states into it. */
export type TransactionState = "PREPARED" | "AWAITING_SIGNATURE" | "SUBMITTED" | "CONFIRMED" | "FAILED";

export interface TransactionStatus {
  chain: ChainKey;
  state: TransactionState;
  hash?: string;
  error?: ApplicationErrorCode;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export const APPLICATION_ERROR_CODES = [
  "INSUFFICIENT_LIQUIDITY",
  "INVALID_TENOR",
  "TENOR_DISABLED",
  "INVALID_CAP",
  "INVALID_STRIKE",
  "STRUCTURE_NOT_OFFERED",
  "QUOTE_EXPIRED",
  "QUOTE_USED",
  "QUOTE_INVALID",
  "SLIPPAGE_EXCEEDED",
  "ORACLE_NOT_READY",
  "ORACLE_PRICE_REJECTED",
  "POSITION_SETTLED",
  "NOTHING_TO_CLAIM",
  "WITHDRAWAL_NOT_READY",
  "POOL_NOT_FOUND",
  "POOL_NOT_ACCEPTING",
  "CHAIN_NOT_ENABLED",
  "CHAIN_DRAINING",
  "ROUTING_FAILED",
  "NO_ROUTE",
  "DESTINATION_FUNDS_MISSING",
  "INSUFFICIENT_BALANCE",
  "UNAUTHORIZED",
  "TRANSACTION_REJECTED",
  "PAUSED",
  "INVALID_REQUEST",
  "UNKNOWN",
] as const;

export type ApplicationErrorCode = (typeof APPLICATION_ERROR_CODES)[number];

/** The only error shape the API and frontend show. Raw chain errors stay in `detail`. */
export class ApplicationError extends Error {
  constructor(
    public readonly code: ApplicationErrorCode,
    message?: string,
    public readonly detail?: string,
  ) {
    super(message ?? code);
    this.name = "ApplicationError";
  }
}

// ── Pools, quotes, hedges ─────────────────────────────────────────────────────

export type ProtectionStructure = "open" | "capped";
export type Direction = "up" | "down";

export interface Tenor {
  tenorDays: number;
  active: boolean;
  markupBps: number;
}

export interface PoolStructures {
  open: boolean;
  capped: boolean;
  minCapDistanceBps: number;
  maxCapDistanceBps: number;
  openMaxPayoutBps: number;
}

export interface FeeRates {
  hedgerFeeRateE6: number;
  payoutFeeRateE6: number;
  lpProfitFeeRateE6: number;
  creatorShareE6: number;
}

export interface CurrencyPool {
  ref: ResourceId;
  chain: ChainKey;
  poolId: number;
  creator: string;
  pair: string;
  asset: Asset;
  acceptingHedges: boolean;
  allowExternalLp: boolean;
  structures: PoolStructures;
  tenors: Tenor[];
  fees: FeeRates;
  liquidity: { cash: string; reserved: string; deferredPremium: string; nav: string; free: string; holdback: string; capacity: string };
  creatorEarnings: string;
  activePositions: number;
  latestExpiry: number;
}

export type PositionStatus = "active" | "settled" | "claimed";

export interface ProtectionPosition {
  ref: ResourceId;
  chain: ChainKey;
  positionId: number;
  poolId: number;
  hedger: string;
  structure: ProtectionStructure;
  direction: Direction;
  status: PositionStatus;
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

/** What a hedger asks for. No chain anywhere: BlockFinaX picks the Execution Network. */
export interface ProtectionRequest {
  pair: string;
  notional: string;
  tenorDays: number;
  structure: ProtectionStructure;
  direction: Direction;
  strike: string;
  cap?: string;
}

/** The economic quote, produced before any chain-specific signing or encoding. */
export interface EconomicQuote {
  pair: string;
  notional: string;
  tenorDays: number;
  structure: ProtectionStructure;
  direction: Direction;
  spot: string;
  strike: string;
  cap: string;
  fairRateE6: number;
  markupBps: number;
  offerRateE6: number;
  premium: string;
  hedgerFee: string;
  totalCost: string;
  maxPayout: string;
  pool: ResourceId;
  executionChain: ChainKey;
}

/** An economic quote plus the adapter's executable, signed payload for one buyer. */
export interface ProtectionQuote {
  economic: EconomicQuote;
  buyer: string;
  expiresAt: number;
  /** Chain-specific, opaque to the product layer; passed back to the adapter to build the transaction. */
  executable: Record<string, unknown>;
}

export interface SettlementResult {
  /** `chain:contract:position/<id>` */
  position: string;
  settlementPrice: string | null;
  grossPayout: string;
  fee: string;
  netPayout: string;
  status: "pending" | "settled_no_payout" | "settled_claimable" | "claimed";
}

// ── Routing ───────────────────────────────────────────────────────────────────

export interface RoutingQuote {
  provider: string;
  sourceChain: ChainKey;
  destinationChain: ChainKey;
  assetIn: Asset;
  assetOut: Asset;
  amountIn: string;
  amountOut: string;
  totalFees: string;
  estimatedSeconds: number;
  expiresAt: number;
  /** 0 (safest) to 1. Combines provider security policy, health and track record. */
  riskScore: number;
  /** Provider-specific execution data, opaque to the product layer. */
  route: Record<string, unknown>;
}

export type RoutingState =
  | "REQUESTED"
  | "SOURCE_CONFIRMED"
  | "ROUTING"
  | "DESTINATION_CONFIRMED"
  | "ACTION_PENDING"
  | "ACTION_COMPLETED"
  | "FAILED"
  | "RECOVERY_REQUIRED"
  | "REFUNDED";

// ── Events ────────────────────────────────────────────────────────────────────

export type BusinessEventType =
  | "PoolCreated"
  | "LiquidityAdded"
  | "LiquidityRemoved"
  | "WithdrawalRequested"
  | "TenorUpdated"
  | "StructuresUpdated"
  | "PoolSettingsUpdated"
  | "HedgeCreated"
  | "HedgeSettled"
  | "PayoutClaimed"
  | "CreatorEarningsWithdrawn"
  | "RouteStarted"
  | "RouteCompleted"
  | "RouteFailed";

export interface BusinessEvent {
  type: BusinessEventType;
  /** `chain:contract:id` of the pool, hedge or route the event is about. */
  subject: string;
  chain: ChainKey;
  /** Chain position for ordering and de-duplication (block/ledger, log index). */
  cursor: { height: number; index: number; tx: string };
  timestamp?: number;
  data: Record<string, string | number | boolean | null>;
}
