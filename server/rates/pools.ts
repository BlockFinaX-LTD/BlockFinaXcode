/**
 * Interest-rate protection pools on Stellar (blockfinax-stellar/contracts/rate-pool).
 *
 * Reads pools and positions, quotes a protection from the pool's fixed terms and the oracle's
 * latest fixing, and prepares transactions for the user's passkey. The platform fee sponsor is
 * the source account; the user's smart account only authorizes, and the relay pays the fee.
 *
 * Env: STELLAR_RATE_POOL_CONTRACT, STELLAR_RATE_ORACLE_CONTRACT, STELLAR_FEE_PAYER_SECRET.
 */
import { BASE_FEE, Keypair, Operation, TransactionBuilder, nativeToScVal, rpc, scValToNative, type xdr } from "@stellar/stellar-sdk";
import { ApplicationError } from "@shared/domain/types";
import { microToPercent } from "@shared/rates/benchmarks";
import { fromEpochDay } from "./validate";

const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const USDC_DECIMALS = 7;
const UNIT = BigInt(10_000_000); // 10^7, USDC on Stellar
export const RATE_POOL_CHAIN = "stellar-testnet";

/** Methods the relay may pay for, and which argument must be the signed-in wallet. */
export const RATE_POOL_POLICY = {
  methods: new Set(["create_pool", "set_tenor", "set_pool_active", "deposit", "withdraw", "buy", "settle"]),
  walletArg: { create_pool: 0, deposit: 1, withdraw: 1, buy: 0 } as Record<string, number>,
  permissionless: new Set(["settle"]),
};

export function ratePoolContract(): string | null {
  return process.env.STELLAR_RATE_POOL_CONTRACT || null;
}

const toUsdc = (units: bigint | number) => {
  const v = BigInt(units);
  const neg = v < BigInt(0);
  const a = neg ? -v : v;
  return `${neg ? "-" : ""}${a / UNIT}.${(a % UNIT).toString().padStart(USDC_DECIMALS, "0")}`;
};
const fromUsdc = (amount: string) => {
  if (!/^\d+(\.\d{1,7})?$/.test(amount)) throw new ApplicationError("INVALID_REQUEST", "Enter an amount in USDC, up to 7 decimals");
  const [w, f = ""] = amount.split(".");
  return BigInt(w) * UNIT + BigInt((f + "0000000").slice(0, 7));
};

export interface RatePoolView {
  id: number;
  benchmark: string;
  direction: "rise" | "fall";
  creator: string;
  strikeOffsetPercent: string;
  capWidthPercent: string;
  lookbackDays: number;
  basis: number;
  capital: string;
  locked: string;
  available: string;
  active: boolean;
  tenors: { days: number; premiumBps: number }[];
  /** Latest indexed fixing the next purchase would use. */
  reference: { observationDate: string; ratePercent: string } | null;
  /** Strike and cap a purchase now would get. */
  strikePercent: string | null;
  capPercent: string | null;
}

export interface RatePositionView {
  id: number;
  poolId: number;
  benchmark: string;
  direction: "rise" | "fall";
  notional: string;
  premium: string;
  days: number;
  strikePercent: string;
  capPercent: string;
  startDate: string;
  startRatePercent: string;
  windowEndDate: string;
  expiry: number;
  createdAt: number;
  maxPayout: string;
  status: "active" | "settleable" | "settled" | "refunded";
  settlementRatePercent: string | null;
  payout: string | null;
}

export class RatePoolService {
  private readonly server = new rpc.Server(RPC);

  constructor(private readonly pool: string, private readonly oracle: string, private readonly sponsorSecret: string) {}

  static fromEnv(): RatePoolService | null {
    const pool = ratePoolContract();
    const oracle = process.env.STELLAR_RATE_ORACLE_CONTRACT;
    const secret = process.env.STELLAR_FEE_PAYER_SECRET;
    if (!pool || !oracle || !secret) return null;
    return new RatePoolService(pool, oracle, secret);
  }

  private get sponsor() {
    return Keypair.fromSecret(this.sponsorSecret).publicKey();
  }

  private async build(contract: string, method: string, args: xdr.ScVal[]) {
    const source = await this.server.getAccount(this.sponsor);
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(Operation.invokeContractFunction({ contract, function: method, args }))
      .setTimeout(300)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw mapRatePoolError(sim.error);
    return { tx, sim };
  }

  private async read<T>(contract: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
    const { sim } = await this.build(contract, method, args);
    const ret = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    return (ret ? scValToNative(ret) : undefined) as T;
  }

  private async prepare(label: string, method: string, args: xdr.ScVal[]) {
    const { tx, sim } = await this.build(this.pool, method, args);
    const assembled = rpc.assembleTransaction(tx, sim as rpc.Api.SimulateTransactionSuccessResponse).build();
    return [{ chain: RATE_POOL_CHAIN, family: "stellar" as const, label, payload: { kind: "stellar" as const, networkPassphrase: PASSPHRASE, xdr: assembled.toXDR() } }];
  }

  private async head(benchmark: string): Promise<[number, bigint, bigint] | null> {
    const h = await this.read<[number, bigint, bigint] | undefined>(this.oracle, "get_index_head", [nativeToScVal(benchmark, { type: "symbol" })]);
    return h ?? null;
  }

  async listPools(): Promise<RatePoolView[]> {
    const count = Number(await this.read<number>(this.pool, "pool_count"));
    const heads = new Map<string, [number, bigint, bigint] | null>();
    const out: RatePoolView[] = [];
    for (let id = 1; id <= count; id++) {
      const [p, tenors] = await Promise.all([
        this.read<any>(this.pool, "get_pool", [nativeToScVal(id, { type: "u32" })]),
        this.read<any[]>(this.pool, "get_tenors", [nativeToScVal(id, { type: "u32" })]),
      ]);
      if (!p) continue;
      const benchmark = String(p.benchmark);
      if (!heads.has(benchmark)) heads.set(benchmark, await this.head(benchmark));
      const head = heads.get(benchmark) ?? null;
      const rise = Number(p.direction) === 1;
      const rate = head ? Number(head[2]) : null;
      const strike = rate === null ? null : rise ? rate + Number(p.strike_offset) : rate - Number(p.strike_offset);
      const cap = strike === null ? null : rise ? strike + Number(p.cap_width) : strike - Number(p.cap_width);
      out.push({
        id, benchmark, direction: rise ? "rise" : "fall", creator: String(p.creator),
        strikeOffsetPercent: microToPercent(Number(p.strike_offset)), capWidthPercent: microToPercent(Number(p.cap_width)),
        lookbackDays: Number(p.lookback_days), basis: Number(p.basis),
        capital: toUsdc(p.capital), locked: toUsdc(p.locked), available: toUsdc(BigInt(p.capital) - BigInt(p.locked)),
        active: Boolean(p.active),
        tenors: (tenors ?? []).filter((t) => t.active).map((t) => ({ days: Number(t.days), premiumBps: Number(t.premium_bps) })).sort((a, b) => a.days - b.days),
        reference: head ? { observationDate: fromEpochDay(Number(head[0])), ratePercent: microToPercent(Number(head[2])) } : null,
        strikePercent: strike === null ? null : microToPercent(strike),
        capPercent: cap === null ? null : microToPercent(cap),
      });
    }
    return out;
  }

  /** Premium and maximum payout for a purchase, matching the contract's arithmetic. */
  quote(pool: RatePoolView, days: number, notional: string) {
    const tenor = pool.tenors.find((t) => t.days === days);
    if (!tenor) throw new ApplicationError("INVALID_REQUEST", `This pool does not offer ${days} days`);
    const n = fromUsdc(notional);
    const width = BigInt(Math.round(Number(pool.capWidthPercent) * 1_000_000));
    const premium = (n * BigInt(tenor.premiumBps)) / BigInt(10_000);
    const maxPayout = (n * width * BigInt(days)) / (BigInt(100_000_000) * BigInt(pool.basis));
    const available = fromUsdc(pool.available);
    return {
      premium: toUsdc(premium), maxPayout: toUsdc(maxPayout), premiumBps: tenor.premiumBps,
      enoughLiquidity: maxPayout <= available, strikePercent: pool.strikePercent, capPercent: pool.capPercent,
    };
  }

  async positionsOf(wallet: string): Promise<RatePositionView[]> {
    const ids = (await this.read<number[]>(this.pool, "positions_of", [nativeToScVal(wallet, { type: "address" })])) ?? [];
    const pools = new Map<number, any>();
    const out: RatePositionView[] = [];
    const now = Date.now() / 1000;
    for (const id of ids.map(Number).reverse()) {
      const p = await this.read<any>(this.pool, "get_position", [nativeToScVal(id, { type: "u32" })]);
      if (!p) continue;
      const poolId = Number(p.pool_id);
      if (!pools.has(poolId)) pools.set(poolId, await this.read<any>(this.pool, "get_pool", [nativeToScVal(poolId, { type: "u32" })]));
      const pool = pools.get(poolId);
      out.push({
        id, poolId, benchmark: String(pool?.benchmark ?? ""), direction: Number(p.direction) === 1 ? "rise" : "fall",
        notional: toUsdc(p.notional), premium: toUsdc(p.premium), days: Number(p.days),
        strikePercent: microToPercent(Number(p.strike)), capPercent: microToPercent(Number(p.cap)),
        startDate: fromEpochDay(Number(p.start_day)), startRatePercent: microToPercent(Number(p.start_rate)),
        windowEndDate: fromEpochDay(Number(p.end_day)), expiry: Number(p.expiry), createdAt: Number(p.created_at),
        maxPayout: toUsdc(p.max_payout),
        status: p.settled ? "settled" : p.refunded ? "refunded" : now >= Number(p.expiry) ? "settleable" : "active",
        settlementRatePercent: p.settled ? microToPercent(Number(p.settlement_rate)) : null,
        payout: p.settled ? toUsdc(p.payout) : null,
      });
    }
    return out;
  }

  prepareBuy(wallet: string, poolId: number, days: number, notional: string) {
    return this.prepare(`Buy ${days}-day rate protection`, "buy", [
      nativeToScVal(wallet, { type: "address" }), nativeToScVal(poolId, { type: "u32" }),
      nativeToScVal(days, { type: "u32" }), nativeToScVal(fromUsdc(notional), { type: "i128" }),
    ]);
  }

  prepareDeposit(wallet: string, poolId: number, amount: string) {
    return this.prepare(`Deposit ${amount} USDC`, "deposit", [
      nativeToScVal(poolId, { type: "u32" }), nativeToScVal(wallet, { type: "address" }), nativeToScVal(fromUsdc(amount), { type: "i128" }),
    ]);
  }

  prepareSettle(positionId: number) {
    return this.prepare("Settle rate protection", "settle", [nativeToScVal(positionId, { type: "u32" })]);
  }
}

/** Contract error numbers to messages a buyer can act on. */
export function mapRatePoolError(raw: string): ApplicationError {
  const m = /Error\(Contract, #(\d+)\)/.exec(raw);
  const messages: Record<number, string> = {
    7: "This length is not offered right now",
    8: "Enter a larger amount",
    9: "No official rate has been recorded yet",
    10: "The latest official rate is too old; try again after the next publication",
    11: "Not enough liquidity in this pool for that amount",
    13: "Already settled",
    14: "This protection has not expired yet",
    15: "Waiting for the last official rate in the window to be recorded",
    16: "Some official rates in the window are missing",
    17: "You do not hold that many shares",
    18: "That capital is backing open protections",
  };
  const code = m ? Number(m[1]) : 0;
  if (code === 11) return new ApplicationError("INSUFFICIENT_LIQUIDITY", messages[11]);
  if (messages[code]) return new ApplicationError("INVALID_REQUEST", messages[code]);
  if (/insufficient|balance/i.test(raw)) return new ApplicationError("INVALID_REQUEST", "Not enough USDC in your wallet");
  return new ApplicationError("UNKNOWN", "The rate pool rejected this transaction");
}
