/**
 * The chain interface (Architecture v2.0).
 *
 * Everything above this file speaks BlockFinaX; everything that implements it speaks one
 * blockchain. One adapter per chain family: EvmAdapter serves Base, BSC and any future EVM
 * chain from registry entries; StellarAdapter serves Stellar networks.
 *
 * Adapters never sign for users. They prepare unsigned transactions that the user's wallet
 * provider signs, and they sign only what the platform itself attests (pricing quotes) or
 * submits (oracle prices, permissionless settlement) with keys supplied by the caller.
 */
import type { ChainConfig } from "@shared/chains/registry";
import type {
  ApplicationError,
  BusinessEvent,
  CurrencyPool,
  EconomicQuote,
  ProtectionPosition,
  ProtectionQuote,
  TransactionStatus,
} from "@shared/domain/types";

/** An unsigned transaction for a wallet provider to sign. The payload is chain-native. */
export interface PreparedTransaction {
  chain: string;
  family: "evm" | "stellar";
  /** What this step does, for the transaction UX ("Approve USDC", "Buy protection"). */
  label: string;
  payload:
    | { kind: "evm"; chainId: number; to: string; data: string; value: string }
    | { kind: "stellar"; networkPassphrase: string; xdr: string };
}

export interface TenorInput {
  tenorDays: number;
  active: boolean;
  markupBps: number;
}

export interface CreatePoolInput {
  pair: string;
  /** The move the pool covers. Each pool sells one direction. */
  direction: "up" | "down";
  allowExternalLp: boolean;
  structures: { open: boolean; capped: boolean; minCapDistanceBps: number; maxCapDistanceBps: number; openMaxPayoutBps: number };
  tenors: TenorInput[];
  initialLiquidity: string;
}

/** A platform key the caller holds (oracle operator, keeper). Never a user key. */
export interface PlatformSigner {
  /** EVM: hex private key. Stellar: S... secret. */
  secret: string;
}

export interface OracleRoundState {
  /** True when the position no longer needs a price (settled or consensus reached). */
  resolved: boolean;
  consensusPrice: string | null;
}

export interface ChainAdapter {
  readonly chain: ChainConfig;

  // Reads, returned in domain shapes.
  listPools(): Promise<CurrencyPool[]>;
  getPool(poolId: number): Promise<CurrencyPool>;
  getPosition(positionId: number): Promise<ProtectionPosition>;
  listPositions(owner: string): Promise<ProtectionPosition[]>;
  /** Positions in a pool that are still active, for the oracle engine. */
  listActivePositions(poolId: number): Promise<ProtectionPosition[]>;
  getBalance(owner: string, symbol: string): Promise<string>;
  getOracleState(positionId: number): Promise<OracleRoundState>;

  // The platform attests the economic quote in this chain's signature scheme.
  signQuote(economic: EconomicQuote, buyer: string, poolId: number): Promise<ProtectionQuote>;

  // Unsigned transactions for the user's wallet, in the order they must be sent.
  prepareCreatePool(owner: string, input: CreatePoolInput): Promise<PreparedTransaction[]>;
  prepareSetTenor(owner: string, poolId: number, tenor: TenorInput): Promise<PreparedTransaction[]>;
  prepareDeposit(owner: string, poolId: number, amount: string): Promise<PreparedTransaction[]>;
  prepareHedge(owner: string, quote: ProtectionQuote): Promise<PreparedTransaction[]>;
  prepareWithdrawalRequest(owner: string, poolId: number, shares: string): Promise<PreparedTransaction[]>;
  prepareWithdrawalExecute(owner: string, requestId: number): Promise<PreparedTransaction[]>;
  prepareClaim(owner: string, positionId: number): Promise<PreparedTransaction[]>;
  /** An LP's shares in a pool and what they are worth now, in the pool asset. */
  getLpPosition(poolId: number, owner: string): Promise<{ shares: string; value: string }>;
  /** The one-off fee for creating a pool, in the pool asset. */
  getPoolCreationFee(): Promise<string>;
  /** Send a listed asset from the user's account to another address on the same chain. */
  prepareTransfer(owner: string, to: string, symbol: string, amount: string): Promise<PreparedTransaction[]>;

  // Platform operations.
  submitOraclePrice(positionId: number, price: string, signer: PlatformSigner): Promise<TransactionStatus>;
  /** Settle after consensus. A no-op on chains that settle inside the oracle submission. */
  settle(positionId: number, signer: PlatformSigner): Promise<TransactionStatus>;

  // Translation into shared models.
  decodeEvents(fromHeight: number, toHeight?: number): Promise<BusinessEvent[]>;
  mapError(err: unknown): ApplicationError;
  getTransactionStatus(hash: string): Promise<TransactionStatus>;
}
