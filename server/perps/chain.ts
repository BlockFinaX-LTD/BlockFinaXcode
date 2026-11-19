/**
 * The perp clearinghouse on Stellar: reads, the operator's calls (prices, fills, funding,
 * liquidations) and transactions for a trader's passkey to approve (deposit, withdraw,
 * trading key, escape hatch).
 *
 * The operator signs with PERP_OPERATOR_SECRET. On chain that key can post prices within
 * each market's band, submit signed fills and apply capped funding. It cannot move anyone's
 * USDC except through fills both traders signed.
 */
import { Keypair, contract } from "@stellar/stellar-sdk";
import type { ChainConfig } from "@shared/chains/registry";
import { ApplicationError } from "@shared/domain/types";
import type { PerpOrder } from "@shared/perps";
import type { PreparedTransaction } from "../chain/adapter";

export interface ChainMarket {
  id: number;
  symbol: string;
  maxLeverage: number;
  maintBps: number;
  oiCap: bigint;
  vaultOiCap: bigint;
  fundingCapPpm: bigint;
  markBandBps: number;
  weekendBandBps: number;
  maxStaleness: number;
  status: number;
  index: bigint;
  mark: bigint;
  priceAt: number;
  weekend: boolean;
  cumFunding: bigint;
  fundingAt: number;
  longOi: bigint;
  shortOi: bigint;
}

export interface ChainPosition { market: number; size: bigint; entry: bigint; mark: bigint; upnl: bigint; fundingOwed: bigint; notional: bigint }
export interface ChainAccount { collateral: bigint; value: bigint; initial: bigint; maintenance: bigint; withdrawable: bigint; positions: ChainPosition[] }
export interface ChainFill { maker: { order: PerpOrder; sig: string }; taker: { order: PerpOrder; sig: string }; price: bigint; size: bigint }

const big = (v: unknown) => BigInt(v as any);

function toMarket(m: any): ChainMarket {
  const p = m.params;
  return {
    id: Number(m.id), symbol: String(p.symbol), maxLeverage: Number(p.max_leverage), maintBps: Number(p.maint_bps),
    oiCap: big(p.oi_cap), vaultOiCap: big(p.vault_oi_cap), fundingCapPpm: big(p.funding_cap_ppm), markBandBps: Number(p.mark_band_bps),
    weekendBandBps: Number(p.weekend_band_bps), maxStaleness: Number(p.max_staleness), status: Number(m.status), index: big(m.index),
    mark: big(m.mark), priceAt: Number(m.price_at), weekend: Boolean(m.weekend), cumFunding: big(m.cum_funding), fundingAt: Number(m.funding_at),
    longOi: big(m.long_oi), shortOi: big(m.short_oi),
  };
}

const orderArg = (o: PerpOrder) => ({
  account: o.account, key: Buffer.from(o.key, "hex"), market: o.market, is_buy: o.isBuy, price: o.price, size: o.size,
  nonce: o.nonce, expiry: o.expiry, reduce_only: o.reduceOnly,
});

const ERRORS: Record<number, string> = {
  5: "Enter an amount above zero.", 6: "That market does not exist.", 7: "This market is not open for that.", 8: "Prices are being refreshed. Try again in a moment.",
  10: "Your trading key is not approved. Enable trading first.", 11: "The order has expired.", 13: "The order is already filled.", 14: "The price moved past your limit.",
  15: "A reduce-only order cannot add to a position.", 16: "Not enough margin for this.", 17: "This market's open interest limit is reached.", 18: "The liquidity vault's limit for this market is reached.",
  19: "This account is not below maintenance margin.", 22: "The escape hatch is not open: fills are still settling.", 24: "You cannot trade with yourself.",
};
export function perpErrorMessage(raw: string): string | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(raw);
  return m ? ERRORS[Number(m[1])] ?? null : null;
}
function mapError(err: unknown): ApplicationError {
  const raw = err instanceof Error ? err.message : String(err);
  const known = perpErrorMessage(raw);
  return known ? new ApplicationError("INVALID_REQUEST", known, raw.slice(0, 300)) : new ApplicationError("UNKNOWN", "The network refused this step. Please try again.", raw.slice(0, 300));
}

export class PerpChain {
  readonly contractId: string;
  readonly chainKey: string;
  private clients = new Map<string, Promise<any>>();
  /** Operator calls share one source account, so they go one at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly chain: ChainConfig, private readonly env: NodeJS.ProcessEnv = process.env) {
    if (!chain.contracts.perpClearinghouse) throw new Error(`${chain.key} has no perp clearinghouse`);
    this.contractId = chain.contracts.perpClearinghouse;
    this.chainKey = chain.key;
  }

  get explorer() { return this.chain.explorer; }

  private sponsor(): string {
    const secret = this.env.STELLAR_FEE_PAYER_SECRET;
    if (secret) return Keypair.fromSecret(secret).publicKey();
    const op = this.env.PERP_OPERATOR_SECRET;
    if (op) return Keypair.fromSecret(op).publicKey();
    throw new ApplicationError("CHAIN_NOT_ENABLED", "Stellar fee sponsor is not configured");
  }

  operatorKey(): Keypair | null {
    const s = this.env.PERP_OPERATOR_SECRET;
    return s ? Keypair.fromSecret(s) : null;
  }

  private client(signer?: Keypair): Promise<any> {
    const key = signer?.publicKey() ?? "read";
    if (!this.clients.has(key)) {
      const opts: any = { contractId: this.contractId, networkPassphrase: this.chain.networkId, rpcUrl: this.chain.rpcUrls[0], publicKey: signer?.publicKey() ?? this.sponsor() };
      if (signer) opts.signTransaction = contract.basicNodeSigner(signer, this.chain.networkId).signTransaction;
      const p = contract.Client.from(opts);
      p.catch(() => this.clients.delete(key));
      this.clients.set(key, p);
    }
    return this.clients.get(key)!;
  }

  private async read(method: string, args: Record<string, unknown> = {}) {
    try {
      const r = (await (await this.client())[method](args)).result;
      return r && typeof r.unwrap === "function" ? r.unwrap() : r;
    } catch (err) {
      throw mapError(err);
    }
  }

  async markets(): Promise<ChainMarket[]> {
    return ((await this.read("markets")) as any[]).map(toMarket);
  }

  async account(who: string): Promise<ChainAccount> {
    const a: any = await this.read("account", { who });
    return {
      collateral: big(a.collateral), value: big(a.value), initial: big(a.initial), maintenance: big(a.maintenance), withdrawable: big(a.withdrawable),
      positions: (a.positions as any[]).map((p) => ({ market: Number(p.market), size: big(p.size), entry: big(p.entry), mark: big(p.mark), upnl: big(p.upnl), fundingOwed: big(p.funding_owed), notional: big(p.notional) })),
    };
  }

  async keyExpiry(who: string, keyHex: string): Promise<number> {
    return Number(await this.read("key_expiry", { who, key: Buffer.from(keyHex, "hex") }));
  }
  async insurance(): Promise<bigint> { return big(await this.read("insurance")); }
  async vaultAddress(): Promise<string> { return String(await this.read("vault_address")); }
  async escapeOpen(): Promise<boolean> { return Boolean(await this.read("escape_open")); }
  async filled(digestHex: string): Promise<bigint> { return big(await this.read("filled", { hash: Buffer.from(digestHex, "hex") })); }

  /** A transaction for the trader's passkey to approve, sent through the sponsored relay. */
  async prepare(label: string, method: string, args: Record<string, unknown>): Promise<PreparedTransaction[]> {
    try {
      const tx = await (await this.client())[method](args);
      return [{ chain: this.chain.key, family: "stellar", label, payload: { kind: "stellar", networkPassphrase: this.chain.networkId, xdr: tx.toXDR() } }];
    } catch (err) {
      throw mapError(err);
    }
  }

  private operatorCall(method: string, args: Record<string, unknown>): Promise<string> {
    const run = async () => {
      const key = this.operatorKey();
      if (!key) throw new ApplicationError("CHAIN_NOT_ENABLED", "PERP_OPERATOR_SECRET is not configured on this server");
      const tx = await (await this.client(key))[method](args);
      const sent = await tx.signAndSend();
      return String(sent.sendTransactionResponse?.hash ?? sent.getTransactionResponse?.txHash ?? "");
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  pushPrices(updates: { market: number; index: bigint; mark: bigint; weekend: boolean }[]) {
    return this.operatorCall("push_prices", { updates: updates.map((u) => ({ market: u.market, index: u.index, mark: u.mark, weekend: u.weekend })) });
  }

  applyFunding(market: number, ratePpm: bigint, commitmentHex: string) {
    return this.operatorCall("apply_funding", { market, rate_ppm: ratePpm, commitment: Buffer.from(commitmentHex, "hex") });
  }

  settleFills(fills: ChainFill[]) {
    return this.operatorCall("settle_fills", {
      fills: fills.map((f) => ({
        maker: { order: orderArg(f.maker.order), sig: Buffer.from(f.maker.sig, "hex") },
        taker: { order: orderArg(f.taker.order), sig: Buffer.from(f.taker.sig, "hex") },
        price: f.price, size: f.size,
      })),
    });
  }

  liquidate(account: string) {
    const key = this.operatorKey();
    return this.operatorCall("liquidate", { keeper: key?.publicKey(), account });
  }
}
