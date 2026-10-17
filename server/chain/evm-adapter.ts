/**
 * EVM adapter: Base, BSC and any future EVM chain, configured by registry entry.
 *
 * Everything EVM lives here: JSON-RPC, the pool facets' ABI, calldata, ERC20 approvals,
 * ECDSA quote signing, receipts and logs. It returns and accepts only domain shapes.
 */
import { ethers } from "ethers";
import type { ChainConfig } from "@shared/chains/registry";
import { CURRENCY_POOL_ABI } from "@shared/currency-pool";
import { fromRate, fromUnits, toRate, toUnits, STRUCTURE_CODE } from "@shared/domain/pool-economics";
import {
  ApplicationError,
  formatResourceId,
  type Asset,
  type BusinessEvent,
  type BusinessEventType,
  type CurrencyPool,
  type EconomicQuote,
  type ProtectionPosition,
  type ProtectionQuote,
  type TransactionStatus,
} from "@shared/domain/types";
import { signPoolBuyQuote } from "../pricing/signer";
import type { ChainAdapter, CreatePoolInput, OracleRoundState, PlatformSigner, PreparedTransaction, TenorInput } from "./adapter";
import { mapEvmError } from "./errors";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const FEE_ABI = ["function getHedgeFeeConfig() view returns (uint256 creationFee, uint256 hedgerFeeRate, uint256 hedgerPayoutFeeRate, uint256 lpProfitFeeRate, uint256 creatorLoyaltyRate)"];
const EVENT_ABI = [
  "event CurrencyPoolCreated(uint256 indexed poolId, address indexed creator, string underlying, address paymentToken, uint256 initialLiquidity)",
  "event PoolTenorSet(uint256 indexed poolId, uint32 tenorDays, bool active, uint32 markupBps)",
  "event PoolStructuresSet(uint256 indexed poolId, bool openEnabled, bool cappedEnabled, uint32 minCapDistanceBps, uint32 maxCapDistanceBps, uint32 openMaxPayoutBps)",
  "event CurrencyPoolSettingsSet(uint256 indexed poolId, bool acceptingHedges, bool allowExternalLp)",
  "event PoolDeposited(uint256 indexed poolId, address indexed lp, uint256 amount, uint256 shares)",
  "event PoolWithdrawalRequested(uint256 indexed requestId, uint256 indexed poolId, address indexed lp, uint256 shares, uint256 unlockAt)",
  "event PoolWithdrawalExecuted(uint256 indexed requestId, uint256 shares, uint256 amount)",
  "event PoolCreatorEarningsWithdrawn(uint256 indexed poolId, address indexed creator, uint256 amount)",
  "event PoolProtectionPurchased(uint256 indexed positionId, uint256 indexed poolId, address indexed hedger, uint8 structure, uint32 tenorDays, uint256 notional, uint256 premium, uint256 platformFee, uint256 maxPayout, uint256 expiry)",
  "event PoolPositionSettled(uint256 indexed positionId, uint256 settlementPrice, uint256 payout)",
  "event PoolPayoutClaimed(uint256 indexed positionId, address indexed hedger, uint256 gross, uint256 fee, uint256 net)",
];
const STATUS = ["active", "settled", "claimed"] as const;
const QUOTE_TTL_SECONDS = 120;

export class EvmAdapter implements ChainAdapter {
  readonly provider: ethers.JsonRpcProvider;
  private readonly diamondAddress: string | null;
  private poolContract: ethers.Contract | null = null;
  private readonly iface = new ethers.Interface(CURRENCY_POOL_ABI as unknown as string[]);
  private readonly events = new ethers.Interface(EVENT_ABI);
  private readonly chainId: number;

  constructor(readonly chain: ChainConfig, provider?: ethers.JsonRpcProvider) {
    if (chain.family !== "evm") throw new Error(`${chain.key} is not an EVM chain`);
    this.chainId = Number(chain.networkId);
    // A funding-only chain (ACCESS_ONLY) may have no pool contract: balances and
    // transfers still work there, and pool features refuse with a clear error.
    this.diamondAddress = chain.contracts.currencyPool ?? null;
    this.provider = provider ?? new ethers.JsonRpcProvider(chain.rpcUrls[0], this.chainId, { staticNetwork: ethers.Network.from(this.chainId) });
  }

  private get diamond(): string {
    if (!this.diamondAddress) throw new ApplicationError("CHAIN_NOT_ENABLED", `${this.chain.name} has no BlockFinaX pool contract`);
    return this.diamondAddress;
  }

  private get pools(): ethers.Contract {
    return (this.poolContract ??= new ethers.Contract(this.diamond, CURRENCY_POOL_ABI as unknown as string[], this.provider));
  }

  // ── Domain mapping ──────────────────────────────────────────────────────────

  private assetFor(token: string): Asset {
    const hit = Object.entries(this.chain.assets).find(([, a]) => a.addressOrContract.toLowerCase() === token.toLowerCase());
    if (!hit) throw new ApplicationError("INVALID_REQUEST", `Token ${token} is not configured on ${this.chain.key}`);
    return { symbol: hit[0], chain: this.chain.key, ...hit[1] };
  }

  private ref(kind: string, id: bigint | number) {
    return { chain: this.chain.key, contract: this.diamond, id: `${kind}/${id}` };
  }

  private toPool(p: any, tenors: any[], liq: any): CurrencyPool {
    const asset = this.assetFor(p.paymentToken);
    const amt = (v: bigint) => fromUnits(BigInt(v), asset.decimals);
    return {
      ref: this.ref("pool", p.id), chain: this.chain.key, poolId: Number(p.id), creator: p.creator, pair: p.underlying, asset,
      acceptingHedges: p.acceptingHedges, allowExternalLp: p.allowExternalLp,
      structures: {
        open: p.openEnabled, capped: p.cappedEnabled, minCapDistanceBps: Number(p.minCapDistanceBps),
        maxCapDistanceBps: Number(p.maxCapDistanceBps), openMaxPayoutBps: Number(p.openMaxPayoutBps),
      },
      tenors: tenors.map((t) => ({ tenorDays: Number(t.tenorDays), active: t.active, markupBps: Number(t.markupBps) })),
      fees: {
        hedgerFeeRateE6: Number(p.hedgerFeeRate), payoutFeeRateE6: Number(p.payoutFeeRate),
        lpProfitFeeRateE6: Number(p.lpProfitFeeRate), creatorShareE6: Number(p.creatorLoyaltyRate),
      },
      liquidity: {
        cash: amt(liq.cash), reserved: amt(liq.reserved), deferredPremium: amt(liq.deferredPremium), nav: amt(liq.nav),
        free: amt(liq.free), holdback: amt(liq.holdback), capacity: amt(liq.capacity),
      },
      creatorEarnings: amt(p.creatorEarnings), activePositions: Number(p.activePositions), latestExpiry: Number(p.latestExpiry),
    };
  }

  private toPosition(p: any, decimals: number): ProtectionPosition {
    const amt = (v: bigint) => fromUnits(BigInt(v), decimals);
    const status = STATUS[Number(p.status)];
    return {
      ref: this.ref("position", p.id), chain: this.chain.key, positionId: Number(p.id), poolId: Number(p.poolId),
      hedger: p.hedger, structure: Number(p.structure) === 0 ? "open" : "capped", direction: p.strikeAbove ? "up" : "down",
      status, tenorDays: Number(p.tenorDays), createdAt: Number(p.createdAt), expiry: Number(p.expiry),
      notional: amt(p.notional), spot: fromRate(p.spot), strike: fromRate(p.strike), cap: fromRate(p.cap),
      fairRateE6: Number(p.fairRate), premiumRateE6: Number(p.premiumRate), premium: amt(p.premium), fee: amt(p.platformFee),
      maxPayout: amt(p.maxPayout), settlementPrice: status === "active" ? null : fromRate(p.settlementPrice), payout: amt(p.payout),
    };
  }

  private async decimalsOfPool(poolId: number): Promise<number> {
    return this.assetFor((await this.pools.getCurrencyPool(poolId)).paymentToken).decimals;
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  async getPool(poolId: number): Promise<CurrencyPool> {
    try {
      const [p, tenors, liq] = await Promise.all([this.pools.getCurrencyPool(poolId), this.pools.getPoolTenors(poolId), this.pools.getPoolLiquidity(poolId)]);
      if (p.id === BigInt(0)) throw new ApplicationError("POOL_NOT_FOUND", `Pool ${poolId} not found on ${this.chain.key}`);
      return this.toPool(p, tenors, liq);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async listPools(): Promise<CurrencyPool[]> {
    if (!this.diamondAddress) return [];
    const count = Number(await this.pools.getCurrencyPoolCount());
    const out: CurrencyPool[] = [];
    for (let id = 1; id <= count; id++) out.push(await this.getPool(id));
    return out;
  }

  async getPosition(positionId: number): Promise<ProtectionPosition> {
    const p = await this.pools.getPoolPosition(positionId);
    if (p.id === BigInt(0)) throw new ApplicationError("INVALID_REQUEST", `Position ${positionId} not found`);
    return this.toPosition(p, await this.decimalsOfPool(Number(p.poolId)));
  }

  async listPositions(owner: string): Promise<ProtectionPosition[]> {
    if (!this.diamondAddress) return [];
    const ids: bigint[] = await this.pools.getHedgerPoolPositionIds(owner);
    const out: ProtectionPosition[] = [];
    for (const id of [...ids].reverse().slice(0, 100)) out.push(await this.getPosition(Number(id)));
    return out;
  }

  async listActivePositions(poolId: number): Promise<ProtectionPosition[]> {
    const decimals = await this.decimalsOfPool(poolId);
    const total = Number(await this.pools.getPoolPositionCount(poolId));
    const out: ProtectionPosition[] = [];
    for (let offset = 0; offset < total; offset += 100) {
      const page = await this.pools.getPoolPositions(poolId, offset, 100);
      for (const p of page) if (Number(p.status) === 0) out.push(this.toPosition(p, decimals));
    }
    return out;
  }

  async getBalance(owner: string, symbol: string): Promise<string> {
    const a = this.chain.assets[symbol];
    if (!a) throw new ApplicationError("INVALID_REQUEST", `${symbol} not configured on ${this.chain.key}`);
    const token = new ethers.Contract(a.addressOrContract, ERC20_ABI, this.provider);
    return fromUnits(await token.balanceOf(owner), a.decimals);
  }

  async getOracleState(positionId: number): Promise<OracleRoundState> {
    const p = await this.pools.getPoolPosition(positionId);
    const settled = Number(p.status) !== 0;
    return { resolved: settled, consensusPrice: settled ? fromRate(p.settlementPrice) : null };
  }

  // ── Quotes ──────────────────────────────────────────────────────────────────

  async signQuote(economic: EconomicQuote, buyer: string, poolId: number): Promise<ProtectionQuote> {
    const pool = await this.getPool(poolId);
    const d = pool.asset.decimals;
    const notional = toUnits(economic.notional, d);
    const params = {
      poolId: BigInt(poolId), notional, tenorDays: economic.tenorDays, structure: STRUCTURE_CODE[economic.structure],
      strikeAbove: economic.direction === "up", spot: toRate(economic.spot), strike: toRate(economic.strike),
      cap: toRate(economic.cap), fairRate: BigInt(economic.fairRateE6),
    };
    const att = await signPoolBuyQuote({ ...params, chainId: this.chainId, diamondAddress: this.diamond, buyer });
    if (!att) throw new ApplicationError("QUOTE_INVALID", "Pricing engine signing key is not configured");
    const s = (v: bigint) => v.toString();
    return {
      economic, buyer, expiresAt: Number(att.quoteTimestamp) + QUOTE_TTL_SECONDS,
      executable: {
        poolId: s(params.poolId), notional: s(notional), tenorDays: params.tenorDays, structure: params.structure,
        strikeAbove: params.strikeAbove, spot: s(params.spot), strike: s(params.strike), cap: s(params.cap),
        fairRate: s(params.fairRate), maxCost: s(toUnits(economic.totalCost, d)),
        deadline: s(att.quoteTimestamp + BigInt(QUOTE_TTL_SECONDS)), quoteTimestamp: s(att.quoteTimestamp),
        quoteNonce: att.quoteNonce, signature: att.signature, token: pool.asset.addressOrContract,
      },
    };
  }

  // ── Preparing transactions ──────────────────────────────────────────────────

  private tx(label: string, to: string, data: string): PreparedTransaction {
    return { chain: this.chain.key, family: "evm", label, payload: { kind: "evm", chainId: this.chainId, to, data, value: "0" } };
  }

  private poolCall(label: string, method: string, args: unknown[]): PreparedTransaction {
    return this.tx(label, this.diamond, this.iface.encodeFunctionData(method, args));
  }

  /** An approval step, only when the current allowance does not already cover the amount. */
  private async approval(owner: string, token: string, amount: bigint, symbol: string): Promise<PreparedTransaction[]> {
    const erc20 = new ethers.Contract(token, ERC20_ABI, this.provider);
    const allowance: bigint = await erc20.allowance(owner, this.diamond).catch(() => BigInt(0));
    if (allowance >= amount) return [];
    return [this.tx(`Approve ${symbol}`, token, new ethers.Interface(ERC20_ABI).encodeFunctionData("approve", [this.diamond, amount]))];
  }

  async prepareCreatePool(owner: string, input: CreatePoolInput): Promise<PreparedTransaction[]> {
    const asset = this.chain.assets.USDC ? { symbol: "USDC", ...this.chain.assets.USDC } : null;
    if (!asset) throw new ApplicationError("INVALID_REQUEST", `No USDC configured on ${this.chain.key}`);
    const liquidity = toUnits(input.initialLiquidity, asset.decimals);
    const fees = await new ethers.Contract(this.diamond, FEE_ABI, this.provider).getHedgeFeeConfig();
    return [
      ...(await this.approval(owner, asset.addressOrContract, liquidity + fees.creationFee, "USDC")),
      this.poolCall("Create pool", "createCurrencyPool", [{
        underlying: input.pair, paymentToken: asset.addressOrContract, allowExternalLp: input.allowExternalLp,
        structures: {
          openEnabled: input.structures.open, cappedEnabled: input.structures.capped,
          minCapDistanceBps: input.structures.minCapDistanceBps, maxCapDistanceBps: input.structures.maxCapDistanceBps,
          openMaxPayoutBps: input.structures.openMaxPayoutBps,
        },
        tenors: input.tenors, initialLiquidity: liquidity,
      }]),
    ];
  }

  async prepareSetTenor(_owner: string, poolId: number, tenor: TenorInput) {
    return [this.poolCall(`Set ${tenor.tenorDays}-day tenor`, "setPoolTenor", [poolId, tenor])];
  }

  async prepareDeposit(owner: string, poolId: number, amount: string) {
    const pool = await this.getPool(poolId);
    const units = toUnits(amount, pool.asset.decimals);
    return [
      ...(await this.approval(owner, pool.asset.addressOrContract, units, pool.asset.symbol)),
      this.poolCall("Add liquidity", "poolDeposit", [poolId, units]),
    ];
  }

  async prepareTransfer(owner: string, to: string, symbol: string, amount: string) {
    const a = this.chain.assets[symbol];
    if (!a) throw new ApplicationError("INVALID_REQUEST", `${symbol} not configured on ${this.chain.key}`);
    if (!ethers.isAddress(to)) throw new ApplicationError("INVALID_REQUEST", "Enter a valid 0x address");
    if (to.toLowerCase() === owner.toLowerCase()) throw new ApplicationError("INVALID_REQUEST", "You cannot send to your own address");
    const units = toUnits(amount, a.decimals);
    if (units <= BigInt(0)) throw new ApplicationError("INVALID_REQUEST", "Enter an amount above zero");
    const data = new ethers.Interface(["function transfer(address,uint256)"]).encodeFunctionData("transfer", [ethers.getAddress(to), units]);
    return [this.tx(`Send ${amount} ${symbol}`, a.addressOrContract, data)];
  }

  async prepareHedge(owner: string, quote: ProtectionQuote) {
    const e = quote.executable as Record<string, string>;
    const pool = await this.getPool(Number(e.poolId));
    const { token, ...params } = e;
    return [
      ...(await this.approval(owner, token, BigInt(e.maxCost), pool.asset.symbol)),
      this.poolCall("Buy protection", "buyPoolProtection", [params]),
    ];
  }

  async prepareWithdrawalRequest(_owner: string, poolId: number, shares: string) {
    return [this.poolCall("Request withdrawal", "requestPoolWithdrawal", [poolId, BigInt(shares)])];
  }

  async prepareWithdrawalExecute(_owner: string, requestId: number) {
    return [this.poolCall("Withdraw liquidity", "executePoolWithdrawal", [requestId])];
  }

  async prepareClaim(_owner: string, positionId: number) {
    return [this.poolCall("Claim payout", "claimPoolPayout", [positionId])];
  }

  // ── Platform operations ─────────────────────────────────────────────────────

  async submitOraclePrice(positionId: number, price: string, signer: PlatformSigner): Promise<TransactionStatus> {
    try {
      const wallet = new ethers.Wallet(signer.secret, this.provider);
      const c = new ethers.Contract(this.diamond, ["function submitPositionRate(uint256,uint256)"], wallet);
      const tx = await c.submitPositionRate(positionId, toRate(price));
      const r = await tx.wait();
      return { chain: this.chain.key, state: r?.status === 1 ? "CONFIRMED" : "FAILED", hash: tx.hash };
    } catch (err) {
      return { chain: this.chain.key, state: "FAILED", error: this.mapError(err).code };
    }
  }

  /** The pool facet settles inside the oracle submission that completes the quorum. */
  async settle(): Promise<TransactionStatus> {
    return { chain: this.chain.key, state: "CONFIRMED" };
  }

  // ── Translation ─────────────────────────────────────────────────────────────

  async decodeEvents(fromHeight: number, toHeight?: number): Promise<BusinessEvent[]> {
    const logs = await this.provider.getLogs({ address: this.diamond, fromBlock: fromHeight, toBlock: toHeight ?? "latest" });
    return logs.map((l) => this.decodeLog(l)).filter((e): e is BusinessEvent => e !== null);
  }

  /** One EVM log to a business event, or null when the log is not a pool event. */
  decodeLog(log: { topics: readonly string[]; data: string; blockNumber: number; index: number; transactionHash: string }): BusinessEvent | null {
    let parsed: ethers.LogDescription | null = null;
    try { parsed = this.events.parseLog({ topics: [...log.topics], data: log.data }); } catch { return null; }
    if (!parsed) return null;
    const a = parsed.args;
    const usd = (v: bigint) => fromUnits(v, this.chain.assets.USDC?.decimals ?? 6);
    const pool = (id: bigint) => formatResourceId(this.ref("pool", id));
    const pos = (id: bigint) => formatResourceId(this.ref("position", id));
    const map: Record<string, () => [BusinessEventType, string, BusinessEvent["data"]]> = {
      CurrencyPoolCreated: () => ["PoolCreated", pool(a.poolId), { creator: a.creator, pair: a.underlying, amount: usd(a.initialLiquidity) }],
      PoolTenorSet: () => ["TenorUpdated", pool(a.poolId), { tenorDays: Number(a.tenorDays), active: a.active, markupBps: Number(a.markupBps) }],
      PoolStructuresSet: () => ["StructuresUpdated", pool(a.poolId), { open: a.openEnabled, capped: a.cappedEnabled, openMaxPayoutBps: Number(a.openMaxPayoutBps) }],
      CurrencyPoolSettingsSet: () => ["PoolSettingsUpdated", pool(a.poolId), { acceptingHedges: a.acceptingHedges, allowExternalLp: a.allowExternalLp }],
      PoolDeposited: () => ["LiquidityAdded", pool(a.poolId), { lp: a.lp, amount: usd(a.amount), shares: a.shares.toString() }],
      PoolWithdrawalRequested: () => ["WithdrawalRequested", pool(a.poolId), { lp: a.lp, shares: a.shares.toString(), unlockAt: Number(a.unlockAt) }],
      PoolWithdrawalExecuted: () => ["LiquidityRemoved", formatResourceId(this.ref("withdrawal", a.requestId)), { shares: a.shares.toString(), amount: usd(a.amount) }],
      PoolCreatorEarningsWithdrawn: () => ["CreatorEarningsWithdrawn", pool(a.poolId), { creator: a.creator, amount: usd(a.amount) }],
      PoolProtectionPurchased: () => ["HedgeCreated", pos(a.positionId), {
        pool: pool(a.poolId), hedger: a.hedger, structure: Number(a.structure) === 0 ? "open" : "capped", tenorDays: Number(a.tenorDays),
        notional: usd(a.notional), premium: usd(a.premium), fee: usd(a.platformFee), maxPayout: usd(a.maxPayout), expiry: Number(a.expiry),
      }],
      PoolPositionSettled: () => ["HedgeSettled", pos(a.positionId), { settlementPrice: fromRate(a.settlementPrice), payout: usd(a.payout) }],
      PoolPayoutClaimed: () => ["PayoutClaimed", pos(a.positionId), { hedger: a.hedger, gross: usd(a.gross), fee: usd(a.fee), net: usd(a.net) }],
    };
    // Builders are lazy: each event only reads its own fields.
    const build = map[parsed.name];
    if (!build) return null;
    const hit = build();
    return {
      type: hit[0], subject: hit[1], chain: this.chain.key, data: hit[2],
      cursor: { height: log.blockNumber, index: log.index, tx: log.transactionHash },
    };
  }

  mapError(err: unknown): ApplicationError {
    return mapEvmError(err);
  }

  async getTransactionStatus(hash: string): Promise<TransactionStatus> {
    const r = await this.provider.getTransactionReceipt(hash);
    if (!r) return { chain: this.chain.key, state: "SUBMITTED", hash };
    return { chain: this.chain.key, state: r.status === 1 ? "CONFIRMED" : "FAILED", hash };
  }
}
