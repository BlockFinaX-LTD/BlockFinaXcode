/**
 * Stellar adapter: Soroban currency pools and their oracle-consensus instance.
 *
 * Everything Stellar lives here: Soroban RPC, contract specs, XDR, ed25519 quote signing,
 * `require_auth` callers, the Stellar asset contract and Soroban events. Contract clients
 * are built from the on-chain contract spec, so no generated bindings are needed.
 */
import { randomBytes } from "node:crypto";
import { BASE_FEE, Keypair, Operation, StrKey, TransactionBuilder, contract, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { ChainConfig } from "@shared/chains/registry";
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
import type { ChainAdapter, CreatePoolInput, OracleRoundState, PlatformSigner, PreparedTransaction, TenorInput } from "./adapter";
import { mapStellarError } from "./errors";
import { stellarQuoteDigest, type StellarBuyParams } from "./stellar-quote";
import { inspectPoolCall, relay } from "./stellar-relay";

const QUOTE_TTL_SECONDS = 120;
type AnyClient = any;

const unwrap = (r: any) => (r && typeof r.unwrap === "function" ? r.unwrap() : r);

/** Soroban event name (snake_case struct name) to business event type. */
const EVENT_TYPES: Record<string, BusinessEventType> = {
  pool_created: "PoolCreated",
  tenor_set: "TenorUpdated",
  structures_set: "StructuresUpdated",
  pool_settings_set: "PoolSettingsUpdated",
  liquidity_added: "LiquidityAdded",
  withdrawal_requested: "WithdrawalRequested",
  withdrawal_executed: "LiquidityRemoved",
  creator_earnings_withdrawn: "CreatorEarningsWithdrawn",
  protection_purchased: "HedgeCreated",
  position_settled: "HedgeSettled",
  payout_claimed: "PayoutClaimed",
};

export class StellarAdapter implements ChainAdapter {
  private readonly poolId: string;
  private readonly server: rpc.Server;
  private clients = new Map<string, Promise<AnyClient>>();

  constructor(readonly chain: ChainConfig, private readonly env: NodeJS.ProcessEnv = process.env) {
    if (chain.family !== "stellar") throw new Error(`${chain.key} is not a Stellar chain`);
    if (!chain.contracts.currencyPool) throw new Error(`${chain.key} has no currency-pool contract`);
    this.poolId = chain.contracts.currencyPool;
    this.server = new rpc.Server(chain.rpcUrls[0]);
  }

  private get usdc(): Asset {
    const a = this.chain.assets.USDC;
    if (!a) throw new ApplicationError("INVALID_REQUEST", `No USDC configured on ${this.chain.key}`);
    return { symbol: "USDC", chain: this.chain.key, ...a };
  }

  /** Source account for prepared transactions: the platform's fee sponsor. Users authorize, the sponsor pays. */
  private get sponsor(): string {
    const secret = this.env.STELLAR_FEE_PAYER_SECRET;
    if (!secret) throw new ApplicationError("CHAIN_NOT_ENABLED", "Stellar fee sponsor is not configured");
    return Keypair.fromSecret(secret).publicKey();
  }

  private client(contractId: string, signer?: Keypair): Promise<AnyClient> {
    const key = `${contractId}:${signer?.publicKey() ?? "read"}`;
    if (!this.clients.has(key)) {
      const opts: any = { contractId, networkPassphrase: this.chain.networkId, rpcUrl: this.chain.rpcUrls[0], publicKey: signer?.publicKey() ?? this.sponsor };
      if (signer) opts.signTransaction = contract.basicNodeSigner(signer, this.chain.networkId).signTransaction;
      this.clients.set(key, contract.Client.from(opts));
    }
    return this.clients.get(key)!;
  }

  private ref(kind: string, id: number) {
    return { chain: this.chain.key, contract: this.poolId, id: `${kind}/${id}` };
  }

  private toPool(p: any, liq: any): CurrencyPool {
    const amt = (v: bigint) => fromUnits(BigInt(v), this.usdc.decimals);
    return {
      ref: this.ref("pool", p.id), chain: this.chain.key, poolId: p.id, creator: p.creator, pair: p.pair, asset: this.usdc,
      acceptingHedges: p.accepting_hedges, allowExternalLp: p.allow_external_lp,
      structures: {
        open: p.structures.open_enabled, capped: p.structures.capped_enabled, minCapDistanceBps: p.structures.min_cap_distance_bps,
        maxCapDistanceBps: p.structures.max_cap_distance_bps, openMaxPayoutBps: p.structures.open_max_payout_bps,
      },
      tenors: p.tenors.map((t: any) => ({ tenorDays: t.tenor_days, active: t.active, markupBps: t.markup_bps })),
      fees: { hedgerFeeRateE6: p.hedger_fee_rate, payoutFeeRateE6: p.payout_fee_rate, lpProfitFeeRateE6: p.lp_profit_fee_rate, creatorShareE6: p.creator_share },
      liquidity: {
        cash: amt(liq.cash), reserved: amt(liq.reserved), deferredPremium: amt(liq.deferred_premium), nav: amt(liq.nav),
        free: amt(liq.free), holdback: amt(liq.holdback), capacity: amt(liq.capacity),
      },
      creatorEarnings: amt(p.creator_earnings), activePositions: p.active_positions, latestExpiry: Number(p.latest_expiry),
    };
  }

  toPosition(p: any): ProtectionPosition {
    const amt = (v: bigint) => fromUnits(BigInt(v), this.usdc.decimals);
    const tag = String(p.status?.tag ?? p.status).toLowerCase() as ProtectionPosition["status"];
    return {
      ref: this.ref("position", p.id), chain: this.chain.key, positionId: p.id, poolId: p.pool_id, hedger: p.hedger,
      structure: p.structure === 0 ? "open" : "capped", direction: p.strike_above ? "up" : "down", status: tag,
      tenorDays: p.tenor_days, createdAt: Number(p.created_at), expiry: Number(p.expiry), notional: amt(p.notional),
      spot: fromRate(BigInt(p.spot)), strike: fromRate(BigInt(p.strike)), cap: fromRate(BigInt(p.cap)),
      fairRateE6: p.fair_rate, premiumRateE6: p.premium_rate, premium: amt(p.premium), fee: amt(p.platform_fee),
      maxPayout: amt(p.max_payout), settlementPrice: tag === "active" ? null : fromRate(BigInt(p.settlement_price)), payout: amt(p.payout),
    };
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  async getPool(poolId: number): Promise<CurrencyPool> {
    try {
      const c = await this.client(this.poolId);
      const [p, l] = await Promise.all([c.get_pool({ pool_id: poolId }), c.get_liquidity({ pool_id: poolId })]);
      return this.toPool(unwrap(p.result), unwrap(l.result));
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async listPools(): Promise<CurrencyPool[]> {
    const count = Number((await (await this.client(this.poolId)).get_pool_count()).result);
    const out: CurrencyPool[] = [];
    for (let id = 1; id <= count; id++) out.push(await this.getPool(id));
    return out;
  }

  async getPosition(positionId: number): Promise<ProtectionPosition> {
    try {
      return this.toPosition(unwrap((await (await this.client(this.poolId)).get_position({ position_id: positionId })).result));
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async listPositions(owner: string): Promise<ProtectionPosition[]> {
    const page = unwrap((await (await this.client(this.poolId)).list_user_positions({ hedger: owner, start: 0, limit: 50 })).result);
    return page.map((p: any) => this.toPosition(p));
  }

  async listActivePositions(poolId: number): Promise<ProtectionPosition[]> {
    const c = await this.client(this.poolId);
    const total: number = unwrap((await c.get_pool({ pool_id: poolId })).result).position_count;
    const out: ProtectionPosition[] = [];
    for (let start = 0; start < total; start += 50) {
      const page = unwrap((await c.list_pool_positions({ pool_id: poolId, start, limit: 50 })).result);
      for (const p of page) if (String(p.status?.tag) === "Active") out.push(this.toPosition(p));
    }
    return out;
  }

  async getBalance(owner: string, symbol: string): Promise<string> {
    const a = this.chain.assets[symbol];
    if (!a) throw new ApplicationError("INVALID_REQUEST", `${symbol} not configured on ${this.chain.key}`);
    try {
      const { sim } = await this.simulateToken(a.addressOrContract, "balance", [nativeToScVal(owner, { type: "address" })]);
      return fromUnits(BigInt(scValToNative(sim.result!.retval)), a.decimals);
    } catch {
      // An account with no trustline or no balance entry holds nothing.
      return "0";
    }
  }

  /**
   * Stellar asset contracts publish no contract spec, so contract.Client cannot load
   * them. Token calls are built and simulated directly.
   */
  private async simulateToken(token: string, method: string, args: xdr.ScVal[]) {
    const source = await this.server.getAccount(this.sponsor);
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.chain.networkId })
      .addOperation(Operation.invokeContractFunction({ contract: token, function: method, args }))
      .setTimeout(300)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
    return { tx, sim };
  }

  async prepareTransfer(owner: string, to: string, symbol: string, amount: string): Promise<PreparedTransaction[]> {
    const a = this.chain.assets[symbol];
    if (!a) throw new ApplicationError("INVALID_REQUEST", `${symbol} not configured on ${this.chain.key}`);
    if (!StrKey.isValidEd25519PublicKey(to) && !StrKey.isValidContract(to)) throw new ApplicationError("INVALID_REQUEST", "Enter a valid Stellar G or C address");
    if (to === owner) throw new ApplicationError("INVALID_REQUEST", "You cannot send to your own address");
    const units = toUnits(amount, a.decimals);
    if (units <= BigInt(0)) throw new ApplicationError("INVALID_REQUEST", "Enter an amount above zero");
    try {
      const { tx, sim } = await this.simulateToken(a.addressOrContract, "transfer", [
        nativeToScVal(owner, { type: "address" }), nativeToScVal(to, { type: "address" }), nativeToScVal(units, { type: "i128" }),
      ]);
      const assembled = rpc.assembleTransaction(tx, sim as rpc.Api.SimulateTransactionSuccessResponse).build();
      return [{ chain: this.chain.key, family: "stellar", label: `Send ${amount} ${symbol}`, payload: { kind: "stellar", networkPassphrase: this.chain.networkId, xdr: assembled.toXDR() } }];
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async getOracleState(positionId: number): Promise<OracleRoundState> {
    const pos = await this.getPosition(positionId);
    if (pos.status !== "active") return { resolved: true, consensusPrice: pos.settlementPrice };
    if (!this.chain.contracts.poolOracle) return { resolved: false, consensusPrice: null };
    const consensus = (await (await this.client(this.chain.contracts.poolOracle)).get_consensus({ event_id: positionId })).result;
    return { resolved: Boolean(consensus), consensusPrice: consensus ? fromRate(BigInt(consensus[0])) : null };
  }

  // ── Quotes ──────────────────────────────────────────────────────────────────

  async signQuote(economic: EconomicQuote, buyer: string, poolId: number): Promise<ProtectionQuote> {
    const secret = this.env.POOL_PRICING_SECRET;
    if (!secret) throw new ApplicationError("QUOTE_INVALID", "Stellar pool pricing key is not configured");
    const ts = BigInt(Math.floor(Date.now() / 1000));
    const params: StellarBuyParams = {
      pool_id: poolId, notional: toUnits(economic.notional, this.usdc.decimals), tenor_days: economic.tenorDays,
      structure: STRUCTURE_CODE[economic.structure], strike_above: economic.direction === "up",
      spot: toRate(economic.spot), strike: toRate(economic.strike), cap: toRate(economic.cap), fair_rate: economic.fairRateE6,
      max_cost: toUnits(economic.totalCost, this.usdc.decimals), deadline: ts + BigInt(QUOTE_TTL_SECONDS),
      quote_timestamp: ts, quote_nonce: randomBytes(32),
    };
    const signature = Keypair.fromSecret(secret).sign(stellarQuoteDigest(this.poolId, buyer, params));
    const s = (v: bigint) => v.toString();
    return {
      economic, buyer, expiresAt: Number(ts) + QUOTE_TTL_SECONDS,
      executable: {
        ...params, notional: s(params.notional), spot: s(params.spot), strike: s(params.strike), cap: s(params.cap),
        max_cost: s(params.max_cost), deadline: s(params.deadline), quote_timestamp: s(params.quote_timestamp),
        quote_nonce: params.quote_nonce.toString("hex"), signature: signature.toString("hex"),
      },
    };
  }

  // ── Preparing transactions ──────────────────────────────────────────────────

  private async prepare(label: string, method: string, args: Record<string, unknown>): Promise<PreparedTransaction[]> {
    try {
      const tx = await (await this.client(this.poolId))[method](args);
      return [{ chain: this.chain.key, family: "stellar", label, payload: { kind: "stellar", networkPassphrase: this.chain.networkId, xdr: tx.toXDR() } }];
    } catch (err) {
      throw this.mapError(err);
    }
  }

  prepareCreatePool(owner: string, input: CreatePoolInput) {
    return this.prepare("Create pool", "create_pool", {
      creator: owner, pair: input.pair, allow_external_lp: input.allowExternalLp,
      structures: {
        open_enabled: input.structures.open, capped_enabled: input.structures.capped,
        min_cap_distance_bps: input.structures.minCapDistanceBps, max_cap_distance_bps: input.structures.maxCapDistanceBps,
        open_max_payout_bps: input.structures.openMaxPayoutBps,
      },
      tenors: input.tenors.map((t) => ({ tenor_days: t.tenorDays, active: t.active, markup_bps: t.markupBps })),
      initial_liquidity: toUnits(input.initialLiquidity, this.usdc.decimals),
    });
  }

  prepareSetTenor(_owner: string, poolId: number, t: TenorInput) {
    return this.prepare(`Set ${t.tenorDays}-day tenor`, "set_tenor", { pool_id: poolId, tenor: { tenor_days: t.tenorDays, active: t.active, markup_bps: t.markupBps } });
  }

  prepareDeposit(owner: string, poolId: number, amount: string) {
    return this.prepare("Add liquidity", "deposit", { pool_id: poolId, lp: owner, amount: toUnits(amount, this.usdc.decimals) });
  }

  prepareHedge(owner: string, quote: ProtectionQuote) {
    const e = quote.executable as Record<string, any>;
    return this.prepare("Buy protection", "buy_protection", {
      hedger: owner,
      params: {
        pool_id: e.pool_id, notional: BigInt(e.notional), tenor_days: e.tenor_days, structure: e.structure, strike_above: e.strike_above,
        spot: BigInt(e.spot), strike: BigInt(e.strike), cap: BigInt(e.cap), fair_rate: e.fair_rate, max_cost: BigInt(e.max_cost),
        deadline: BigInt(e.deadline), quote_timestamp: BigInt(e.quote_timestamp), quote_nonce: Buffer.from(e.quote_nonce, "hex"),
      },
      signature: Buffer.from(e.signature, "hex"),
    });
  }

  prepareWithdrawalRequest(owner: string, poolId: number, shares: string) {
    return this.prepare("Request withdrawal", "request_withdrawal", { pool_id: poolId, lp: owner, shares: BigInt(shares) });
  }

  prepareWithdrawalExecute(_owner: string, requestId: number) {
    return this.prepare("Withdraw liquidity", "execute_withdrawal", { request_id: requestId });
  }

  prepareClaim(_owner: string, positionId: number) {
    return this.prepare("Claim payout", "claim_payout", { position_id: positionId });
  }

  // ── Platform operations ─────────────────────────────────────────────────────

  async submitOraclePrice(positionId: number, price: string, signer: PlatformSigner): Promise<TransactionStatus> {
    try {
      if (!this.chain.contracts.poolOracle) throw new ApplicationError("CHAIN_NOT_ENABLED", "No pool oracle configured");
      const key = Keypair.fromSecret(signer.secret);
      const pos = await this.getPosition(positionId);
      const oracle = await this.client(this.chain.contracts.poolOracle, key);
      const tx = await oracle.submit_rate({ oracle: key.publicKey(), event_id: positionId, price: toRate(price), event_expiry: BigInt(pos.expiry) });
      const sent = await tx.signAndSend();
      return { chain: this.chain.key, state: "CONFIRMED", hash: sent.sendTransactionResponse?.hash };
    } catch (err) {
      return { chain: this.chain.key, state: "FAILED", error: mapStellarError(err, "oracle").code };
    }
  }

  async settle(positionId: number, signer: PlatformSigner): Promise<TransactionStatus> {
    try {
      const pool = await this.client(this.poolId, Keypair.fromSecret(signer.secret));
      const sent = await (await pool.settle_position({ position_id: positionId })).signAndSend();
      return { chain: this.chain.key, state: "CONFIRMED", hash: sent.sendTransactionResponse?.hash };
    } catch (err) {
      return { chain: this.chain.key, state: "FAILED", error: this.mapError(err).code };
    }
  }

  // ── Translation ─────────────────────────────────────────────────────────────

  async decodeEvents(fromHeight: number): Promise<BusinessEvent[]> {
    const res = await this.server.getEvents({ startLedger: fromHeight, filters: [{ type: "contract", contractIds: [this.poolId] }] });
    return res.events
      .map((e: any) => this.decodeEvent(e.topic.map((t: xdr.ScVal) => scValToNative(t)), scValToNative(e.value), {
        height: e.ledger, index: Number(String(e.id).split("-")[1] ?? 0), tx: e.txHash,
      }))
      .filter((e): e is BusinessEvent => e !== null);
  }

  /** One Soroban event (decoded topics and data) to a business event. */
  decodeEvent(topics: unknown[], data: any, cursor: BusinessEvent["cursor"]): BusinessEvent | null {
    const type = EVENT_TYPES[String(topics[0])];
    if (!type) return null;
    const usd = (v: unknown) => fromUnits(BigInt(v as bigint), this.usdc.decimals);
    const pool = (id: unknown) => formatResourceId(this.ref("pool", Number(id)));
    const pos = (id: unknown) => formatResourceId(this.ref("position", Number(id)));
    const d = data ?? {};
    const byType: Record<BusinessEventType, () => [string, BusinessEvent["data"]]> = {
      PoolCreated: () => [pool(topics[1]), { creator: String(topics[2]), pair: d.pair, amount: usd(d.initial_liquidity) }],
      TenorUpdated: () => [pool(topics[1]), { tenorDays: d.tenor_days, active: d.active, markupBps: d.markup_bps, added: d.added }],
      StructuresUpdated: () => [pool(topics[1]), { open: d.open_enabled, capped: d.capped_enabled, openMaxPayoutBps: d.open_max_payout_bps }],
      PoolSettingsUpdated: () => [pool(topics[1]), { acceptingHedges: d.accepting_hedges, allowExternalLp: d.allow_external_lp }],
      LiquidityAdded: () => [pool(topics[1]), { lp: String(topics[2]), amount: usd(d.amount), shares: String(d.shares) }],
      WithdrawalRequested: () => [pool(topics[1]), { lp: d.lp, shares: String(d.shares), unlockAt: Number(d.unlock_at) }],
      LiquidityRemoved: () => [formatResourceId(this.ref("withdrawal", Number(topics[2]))), { shares: String(d.shares), amount: usd(d.amount) }],
      CreatorEarningsWithdrawn: () => [pool(topics[1]), { creator: String(topics[2]), amount: usd(d.amount) }],
      HedgeCreated: () => [pos(topics[2]), {
        pool: pool(topics[1]), hedger: d.hedger, structure: d.structure === 0 ? "open" : "capped", tenorDays: d.tenor_days,
        notional: usd(d.notional), premium: usd(d.premium), fee: usd(d.fee), maxPayout: usd(d.max_payout), expiry: Number(d.expiry),
      }],
      HedgeSettled: () => [pos(topics[2]), { settlementPrice: fromRate(BigInt(d.settlement_price)), payout: usd(d.payout) }],
      PayoutClaimed: () => [pos(topics[1]), { hedger: String(topics[2]), gross: usd(d.gross_amount), fee: usd(d.fee), net: usd(d.net_amount) }],
      RouteStarted: () => ["", {}], RouteCompleted: () => ["", {}], RouteFailed: () => ["", {}],
    };
    const [subject, fields] = byType[type]();
    return { type, subject, chain: this.chain.key, cursor, data: fields };
  }

  /**
   * Relay a user-authorized pool call with the platform's fee payer, after checking it is an
   * approved call on this pool contract authorized by `wallet`. Returns the transaction hash.
   */
  async relayUserTransaction(xdrEnvelope: string, wallet: string): Promise<TransactionStatus> {
    const call = inspectPoolCall(xdrEnvelope, this.chain.networkId, wallet, this.poolId, Object.values(this.chain.assets).map((a) => a.addressOrContract));
    // Preferred: OpenZeppelin Relayer Channels builds the envelope and pays the fee.
    const relayerUrl = this.env.STELLAR_RELAYER_URL;
    const relayerKey = this.env.STELLAR_RELAYER_API_KEY;
    if (relayerUrl && relayerKey) {
      const { RelayerClient } = await import("passkey-kit/server");
      const result = await new RelayerClient({ baseUrl: relayerUrl, apiKey: relayerKey })
        .send(call.func.toXDR("base64"), call.auth.map((a) => a.toXDR("base64")));
      if (!result.success) throw this.mapError(new Error(result.error.message));
      return { chain: this.chain.key, state: "CONFIRMED", hash: result.hash };
    }
    // Fallback: the platform fee payer submits and pays.
    const secret = this.env.STELLAR_FEE_PAYER_SECRET;
    if (!secret) throw new ApplicationError("CHAIN_NOT_ENABLED", "Stellar fee sponsor is not configured");
    try {
      const hash = await relay(this.server, this.chain.networkId, secret, call.func, call.auth);
      return { chain: this.chain.key, state: "SUBMITTED", hash };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  mapError(err: unknown): ApplicationError {
    return mapStellarError(err, "pool");
  }

  async getTransactionStatus(hash: string): Promise<TransactionStatus> {
    const r = await this.server.getTransaction(hash);
    const state = r.status === rpc.Api.GetTransactionStatus.SUCCESS ? "CONFIRMED"
      : r.status === rpc.Api.GetTransactionStatus.FAILED ? "FAILED" : "SUBMITTED";
    return { chain: this.chain.key, state, hash };
  }
}
