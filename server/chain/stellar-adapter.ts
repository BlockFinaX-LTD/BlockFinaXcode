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
import type { DurationRule } from "@shared/domain/durations";
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
import type { ChainAdapter, CreatePoolInput, LpAccountView, OracleRoundState, PlatformSigner, PreparedTransaction, TenorInput, WithdrawalRequestView } from "./adapter";
import { mapStellarError } from "./errors";
import { stellarQuoteDigest, type StellarBuyParams } from "./stellar-quote";
import { inspectPoolCall, relay } from "./stellar-relay";
import { mapRatePoolError, RATE_POOL_POLICY } from "../rates/pools";

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

  /** A legacy adapter reads, settles and pays out an earlier contract, and sells nothing. */
  constructor(readonly chain: ChainConfig, private readonly env: NodeJS.ProcessEnv = process.env, readonly legacy = false) {
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
      direction: p.direction === 1 ? "up" : p.direction === 2 ? "down" : "both",
      acceptingHedges: this.legacy ? false : p.accepting_hedges, allowExternalLp: this.legacy ? false : p.allow_external_lp,
      legacy: this.legacy || undefined,
      structures: {
        open: p.structures.open_enabled, capped: p.structures.capped_enabled, minCapDistanceBps: p.structures.min_cap_distance_bps,
        maxCapDistanceBps: p.structures.max_cap_distance_bps, openMaxPayoutBps: p.structures.open_max_payout_bps,
        minStrikeDistanceBps: p.structures.min_strike_distance_bps ?? 0,
      },
      tenors: p.tenors.map((t: any) => ({ tenorDays: t.tenor_days, active: t.active, markupBps: t.markup_bps })),
      fees: { hedgerFeeRateE6: p.hedger_fee_rate, payoutFeeRateE6: p.payout_fee_rate, lpProfitFeeRateE6: p.lp_profit_fee_rate, creatorShareE6: p.creator_share },
      liquidity: {
        cash: amt(liq.cash), reserved: amt(liq.reserved), deferredPremium: amt(liq.deferred_premium), nav: amt(liq.nav),
        free: amt(liq.free), holdback: amt(liq.holdback), capacity: amt(liq.capacity),
      },
      creatorEarnings: amt(p.creator_earnings), activePositions: p.active_positions, latestExpiry: Number(p.latest_expiry),
      totalShares: amt(p.total_shares), createdAt: Number(p.created_at),
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
      const [p, l, rule] = await Promise.all([c.get_pool({ pool_id: poolId }), c.get_liquidity({ pool_id: poolId }), this.durationRule(c, poolId)]);
      return { ...this.toPool(unwrap(p.result), unwrap(l.result)), durations: rule };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /** The protocol's longest duration; contracts from before duration rules sell what they list. */
  private maxTenorDays: { value: number; at: number } | null = null;

  private async durationRule(c: any, poolId: number): Promise<DurationRule | undefined> {
    if (typeof c.get_duration_rule !== "function") return undefined;
    try {
      if (!this.maxTenorDays || Date.now() - this.maxTenorDays.at > 300_000) {
        this.maxTenorDays = { value: Number((await c.get_max_tenor_days()).result), at: Date.now() };
      }
      const max = this.maxTenorDays.value;
      const r = unwrap((await c.get_duration_rule({ pool_id: poolId })).result);
      const mode = r.mode === 1 ? "any" : r.mode === 2 ? "up-to" : "specific";
      return { mode, minDays: Number(r.min_days), maxDays: mode === "up-to" ? Math.min(Number(r.max_days), max) : max };
    } catch {
      return undefined;
    }
  }

  /**
   * Every pool. Reading them from the network takes seconds, and Markets, quotes and the
   * options list all need them, so the last result is kept: fresh for 20 seconds, then
   * served while a new read runs in the background. A relayed transaction starts a new
   * read at once, and callers wait for it, so its effect shows straight away.
   */
  private pools: { value: CurrencyPool[]; at: number } | null = null;
  private poolsRead: Promise<CurrencyPool[]> | null = null;
  private poolsGeneration = 0;

  listPools(): Promise<CurrencyPool[]> {
    if (this.pools && Date.now() - this.pools.at < 20_000) return Promise.resolve(this.pools.value);
    const read = this.refreshPools();
    if (this.pools) {
      read.catch(() => undefined); // keep serving the last result if the background read fails
      return Promise.resolve(this.pools.value);
    }
    return read;
  }

  private refreshPools(): Promise<CurrencyPool[]> {
    if (this.poolsRead) return this.poolsRead;
    // A read started before a transaction must not overwrite one started after it.
    const generation = this.poolsGeneration;
    const read: Promise<CurrencyPool[]> = this.readAllPools()
      .then((value) => { if (generation === this.poolsGeneration) this.pools = { value, at: Date.now() }; return value; })
      .finally(() => { if (this.poolsRead === read) this.poolsRead = null; });
    this.poolsRead = read;
    return read;
  }

  /** After a transaction that may have changed pools: read them again, and make callers wait for it. */
  forgetPools() {
    this.poolsGeneration += 1;
    this.pools = null;
    this.poolsRead = null;
    this.refreshPools().catch(() => undefined);
  }

  private async readAllPools(): Promise<CurrencyPool[]> {
    const count = Number((await (await this.client(this.poolId)).get_pool_count()).result);
    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const out: CurrencyPool[] = [];
    for (let i = 0; i < ids.length; i += 8) out.push(...(await Promise.all(ids.slice(i, i + 8).map((id) => this.getPool(id)))));
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

  async getLpPosition(poolId: number, owner: string) {
    const c = await this.client(this.poolId);
    const [shares, value] = unwrap((await c.get_lp_position({ pool_id: poolId, lp: owner })).result);
    const out: { shares: string; value: string; account?: LpAccountView } = {
      shares: fromUnits(BigInt(shares ?? 0), this.usdc.decimals), value: fromUnits(BigInt(value ?? 0), this.usdc.decimals),
    };
    // Contracts with per-hedge underwriting expose the breakdown; earlier ones do not.
    if (typeof c.get_lp_account === "function") {
      const a = (await c.get_lp_account({ pool_id: poolId, lp: owner })).result;
      if (a) {
        const amt = (v: bigint) => fromUnits(BigInt(v), this.usdc.decimals);
        out.account = {
          free: amt(a.free), reserved: amt(a.reserved), earned: amt(a.earned), paid: amt(a.paid),
          pendingWithdraw: amt(a.pending_withdraw), backing: Boolean(a.backing), maxTenorDays: Number(a.max_tenor_days),
          minTenorDays: typeof c.get_lp_min_tenor_days === "function"
            ? Number((await c.get_lp_min_tenor_days({ pool_id: poolId, lp: owner })).result ?? 0) : 0,
          withdrawable: amt(BigInt(a.free) - BigInt(a.pending_withdraw)),
        };
      }
    }
    return out;
  }

  /** Whether this underwriter's free money backs new sales, and the range of tenors it backs. */
  async prepareLpPreferences(owner: string, poolId: number, backing: boolean, maxTenorDays: number, minTenorDays = 0) {
    const days = (d: number) => Math.max(0, Math.min(365, Math.floor(d)));
    const label = backing ? "Update backing preferences" : "Stop backing new protection";
    const c = await this.client(this.poolId);
    if (typeof c.set_lp_backing_range === "function") {
      return this.prepare(label, "set_lp_backing_range", {
        pool_id: poolId, lp: owner, backing, min_tenor_days: days(minTenorDays), max_tenor_days: days(maxTenorDays),
      });
    }
    if (minTenorDays > 0) throw new ApplicationError("INVALID_REQUEST", "Setting a shortest duration needs the upgraded pool contract");
    return this.prepare(label, "set_lp_preferences", { pool_id: poolId, lp: owner, backing, max_tenor_days: days(maxTenorDays) });
  }

  /** Money able to back a new hedge of this many days, given each underwriter's range; null on older contracts. */
  async capacityFor(poolId: number, tenorDays: number): Promise<string | null> {
    const c = await this.client(this.poolId);
    if (typeof c.get_capacity_for !== "function") return null;
    const v = unwrap((await c.get_capacity_for({ pool_id: poolId, tenor_days: tenorDays })).result);
    return fromUnits(BigInt(v ?? 0), this.usdc.decimals);
  }

  /** Whether `owner` may take over the pool: its creator has no money left in it and `owner` has the most. */
  async takeOverStatus(poolId: number, owner: string): Promise<{ supported: boolean; eligible: boolean; reason: string | null }> {
    const c = await this.client(this.poolId);
    if (typeof c.take_over_pool !== "function") return { supported: false, eligible: false, reason: null };
    const pool = unwrap((await c.get_pool({ pool_id: poolId })).result);
    if (pool.creator === owner) return { supported: true, eligible: false, reason: "You already manage this pool" };
    const lps: [string, any][] = unwrap((await c.list_pool_lps({ pool_id: poolId })).result) ?? [];
    const stake = (who: string) => { const e = lps.find(([a]) => a === who); return e ? BigInt(e[1].free) + BigInt(e[1].reserved) : BigInt(0); };
    if (stake(pool.creator) > BigInt(0)) return { supported: true, eligible: false, reason: "The creator still has money in this pool" };
    const mine = stake(owner);
    if (mine <= BigInt(0) || lps.some(([a]) => stake(a) > mine)) return { supported: true, eligible: false, reason: "Only the underwriter with the most money in the pool can take it over" };
    return { supported: true, eligible: true, reason: null };
  }

  prepareTakeOver(owner: string, poolId: number) {
    return this.prepare("Take over pool", "take_over_pool", { pool_id: poolId, claimant: owner });
  }

  async listWithdrawals(owner: string): Promise<WithdrawalRequestView[]> {
    // Request ids are global and sequential; walk them until the first missing one.
    const c = await this.client(this.poolId);
    const out: WithdrawalRequestView[] = [];
    for (let id = 1; id <= 500; id++) {
      let r: any;
      try { r = unwrap((await c.get_withdrawal({ request_id: id })).result); } catch { break; }
      if (!r || r.lp !== owner) continue;
      out.push({
        requestId: r.id, poolId: r.pool_id, shares: fromUnits(BigInt(r.shares), this.usdc.decimals),
        requestedAt: Number(r.requested_at), unlockAt: Number(r.unlock_at),
        status: r.executed ? "executed" : r.cancelled ? "cancelled" : "pending",
      });
    }
    return out;
  }

  prepareSetStructures(_owner: string, poolId: number, s: CreatePoolInput["structures"]) {
    return this.prepare("Update protection settings", "set_structures", {
      pool_id: poolId,
      structures: {
        open_enabled: s.open, capped_enabled: s.capped, min_cap_distance_bps: s.minCapDistanceBps,
        max_cap_distance_bps: s.maxCapDistanceBps, open_max_payout_bps: s.openMaxPayoutBps,
        min_strike_distance_bps: s.minStrikeDistanceBps ?? 0,
      },
    });
  }

  async getPoolCreationFee() {
    const cfg = unwrap((await (await this.client(this.poolId)).get_configuration()).result);
    return fromUnits(BigInt(cfg[8]), this.usdc.decimals);
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
    const oracle = await this.client(this.chain.contracts.poolOracle);
    // Current oracles keep one round per (hedge, expiry); contracts deployed before the
    // 27 Oct 2026 audit keep one round per hedge and return (price, expiry).
    if (typeof oracle.get_consensus_at === "function") {
      const price = (await oracle.get_consensus_at({ event_id: positionId, event_expiry: BigInt(pos.expiry) })).result;
      return { resolved: price !== undefined && price !== null, consensusPrice: price != null ? fromRate(BigInt(price)) : null };
    }
    const consensus = (await oracle.get_consensus({ event_id: positionId })).result;
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

  /** An unsigned call on another contract (Circle CCTP), with the platform as fee source. */
  async prepareContractCall(contractId: string, label: string, method: string, args: Record<string, unknown>): Promise<PreparedTransaction[]> {
    try {
      const tx = await (await this.client(contractId))[method](args);
      return [{ chain: this.chain.key, family: "stellar", label, payload: { kind: "stellar", networkPassphrase: this.chain.networkId, xdr: tx.toXDR() } }];
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /** USDC allowance from a wallet to a spender, in 7-decimal units. */
  async tokenAllowance(from: string, spender: string): Promise<bigint> {
    const { sim } = await this.simulateToken(this.usdc.addressOrContract, "allowance", [
      nativeToScVal(from, { type: "address" }), nativeToScVal(spender, { type: "address" }),
    ]);
    const ret = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    return ret ? BigInt(scValToNative(ret)) : BigInt(0);
  }

  /** An unsigned USDC approve from the user's wallet to a spender, valid for about 80 minutes. */
  async prepareTokenApprove(owner: string, spender: string, units: bigint, label: string): Promise<PreparedTransaction[]> {
    try {
      const latest = await this.server.getLatestLedger();
      const { tx, sim } = await this.simulateToken(this.usdc.addressOrContract, "approve", [
        nativeToScVal(owner, { type: "address" }), nativeToScVal(spender, { type: "address" }),
        nativeToScVal(units, { type: "i128" }), nativeToScVal(latest.sequence + 1_000, { type: "u32" }),
      ]);
      const assembled = rpc.assembleTransaction(tx, sim as rpc.Api.SimulateTransactionSuccessResponse).build();
      return [{ chain: this.chain.key, family: "stellar", label, payload: { kind: "stellar", networkPassphrase: this.chain.networkId, xdr: assembled.toXDR() } }];
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /** A permissionless call the platform signs and pays for itself (the CCTP mint). Returns the hash. */
  async invokeAsPlatform(contractId: string, method: string, args: Record<string, unknown>): Promise<string> {
    const secret = this.env.STELLAR_FEE_PAYER_SECRET;
    if (!secret) throw new ApplicationError("CHAIN_NOT_ENABLED", "Stellar fee sponsor is not configured");
    const c = await this.client(contractId, Keypair.fromSecret(secret));
    const sent = await (await c[method](args)).signAndSend();
    const hash = sent.sendTransactionResponse?.hash;
    if (!hash) throw new ApplicationError("TRANSACTION_REJECTED", `${method} was not submitted`);
    return hash;
  }

  prepareCreatePool(owner: string, input: CreatePoolInput) {
    return this.prepare("Create pool", "create_pool", {
      creator: owner, pair: input.pair, direction: input.direction === "down" ? 2 : 1, allow_external_lp: input.allowExternalLp,
      structures: {
        open_enabled: input.structures.open, capped_enabled: input.structures.capped,
        min_cap_distance_bps: input.structures.minCapDistanceBps, max_cap_distance_bps: input.structures.maxCapDistanceBps,
        open_max_payout_bps: input.structures.openMaxPayoutBps,
        min_strike_distance_bps: input.structures.minStrikeDistanceBps ?? 0,
      },
      tenors: input.tenors.map((t) => ({ tenor_days: t.tenorDays, active: t.active, markup_bps: t.markupBps })),
      initial_liquidity: toUnits(input.initialLiquidity, this.usdc.decimals),
    });
  }

  /**
   * A create_pool transaction whose authorization stays valid for `validSeconds`, for the
   * creator to approve now and the platform to submit later (Request a quote offers).
   */
  async prepareCreatePoolForLater(owner: string, input: CreatePoolInput, validSeconds: number): Promise<PreparedTransaction> {
    const [tx] = await this.prepareCreatePool(owner, input);
    const payload = tx.payload as { kind: "stellar"; networkPassphrase: string; xdr: string };
    const latest = (await this.server.getLatestLedger()).sequence;
    const until = latest + Math.ceil(validSeconds / 5);
    const envelope = xdr.TransactionEnvelope.fromXDR(payload.xdr, "base64");
    const invoke = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp();
    for (const entry of invoke.auth()) {
      const c = entry.credentials();
      if (c.switch().name === "sorobanCredentialsAddress") c.address().signatureExpirationLedger(until);
    }
    return { ...tx, label: "Approve your offer", payload: { ...payload, xdr: envelope.toXDR("base64") } };
  }

  /** The newest pools, newest first (for finding a pool just created). */
  async recentPools(limit: number): Promise<CurrencyPool[]> {
    const count = Number((await (await this.client(this.poolId)).get_pool_count()).result);
    const out: CurrencyPool[] = [];
    for (let id = count; id >= 1 && out.length < limit; id--) out.push(await this.getPool(id));
    return out;
  }

  prepareSetDurationRule(_owner: string, poolId: number, r: { mode: "specific" | "any" | "up-to"; minDays: number; maxDays: number }) {
    const mode = r.mode === "any" ? 1 : r.mode === "up-to" ? 2 : 0;
    return this.prepare("Set durations", "set_duration_rule", { pool_id: poolId, rule: { mode, min_days: r.minDays, max_days: r.mode === "up-to" ? r.maxDays : 0 } });
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
    return this.prepare("Request withdrawal", "request_withdrawal", { pool_id: poolId, lp: owner, shares: toUnits(shares, this.usdc.decimals) });
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
    const ratePool = this.env.STELLAR_RATE_POOL_CONTRACT;
    const extra = ratePool ? [{ contract: ratePool, ...RATE_POOL_POLICY }] : [];
    // The user's own smart wallet may add a backup passkey as a signer (authorized by itself).
    extra.push({ contract: wallet, methods: new Set(["add_signer"]), walletArg: {}, permissionless: new Set<string>() });
    // Circle CCTP: the user's wallet burns its own USDC to move it to another network.
    const cctp = this.chain.cctp?.tokenMessenger;
    if (cctp) extra.push({ contract: cctp, methods: new Set(["deposit_for_burn_with_hook"]), walletArg: { deposit_for_burn_with_hook: 0 }, permissionless: new Set<string>() });
    const call = inspectPoolCall(xdrEnvelope, this.chain.networkId, wallet, this.poolId, Object.values(this.chain.assets).map((a) => a.addressOrContract), extra, cctp ? [cctp] : []);
    const fail = (err: unknown) => (ratePool && call.target === ratePool ? mapRatePoolError(err instanceof Error ? err.message : String(err)) : this.mapError(err));
    // Preferred: OpenZeppelin Relayer Channels builds the envelope and pays the fee.
    const relayerUrl = this.env.STELLAR_RELAYER_URL;
    const relayerKey = this.env.STELLAR_RELAYER_API_KEY;
    const secret = this.env.STELLAR_FEE_PAYER_SECRET;
    if (relayerUrl && relayerKey) {
      const { RelayerClient } = await import("passkey-kit/server");
      const result = await new RelayerClient({ baseUrl: relayerUrl, apiKey: relayerKey })
        .send(call.func.toXDR("base64"), call.auth.map((a) => a.toXDR("base64")));
      if (result.success) return { chain: this.chain.key, state: "CONFIRMED", hash: result.hash };
      // A relayer that cannot build the transaction (it once priced a hedge at ~745 XLM) is
      // not the last word: the platform fee payer tries, under its own fee cap.
      console.warn(`[stellar] relayer failed, trying the platform fee payer: ${result.error.message}`);
      if (!secret) throw fail(new Error(result.error.message));
    }
    // Fallback: the platform fee payer submits and pays.
    if (!secret) throw new ApplicationError("CHAIN_NOT_ENABLED", "Stellar fee sponsor is not configured");
    try {
      const hash = await relay(this.server, this.chain.networkId, secret, call.func, call.auth);
      return { chain: this.chain.key, state: "SUBMITTED", hash };
    } catch (err) {
      throw fail(err);
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
