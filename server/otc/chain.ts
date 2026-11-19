/**
 * The OTC escrow contract on Stellar: reads, transactions for a user's passkey to approve,
 * and the arbiter's own calls (approving merchants, ruling on disputes).
 *
 * User transactions are prepared with the platform's fee sponsor as source and sent
 * through the sponsored relay (/api/v2/transactions/relay), like every other user call.
 * The arbiter signs with OTC_ARBITER_SECRET, a key that can only approve merchants and
 * rule on disputed orders; it cannot upgrade, pause or change fees.
 */
import { Keypair, contract } from "@stellar/stellar-sdk";
import type { ChainConfig } from "@shared/chains/registry";
import { ApplicationError } from "@shared/domain/types";
import { fromUnits, otcErrorMessage, RATE_SCALE, sideFromCode, statusFromCode, USDC_DECIMALS, type OtcSide, type OtcStatus } from "@shared/otc";
import type { PreparedTransaction } from "../chain/adapter";

export interface ChainOffer {
  id: number;
  merchant: string;
  side: OtcSide;
  currency: string;
  rate: string;
  available: string;
  minOrder: string;
  maxOrder: string;
  active: boolean;
  /** A quote: only this address may take it. Null for an offer listed to everyone. */
  taker: string | null;
}

export interface ChainOrder {
  id: number;
  offerId: number;
  merchant: string;
  taker: string;
  side: OtcSide;
  currency: string;
  rate: string;
  amount: string;
  feeBps: number;
  usdcFrom: string;
  usdcTo: string;
  status: OtcStatus;
  openedAt: Date;
  payBy: Date;
  paidAt: Date | null;
  proofHash: string;
}

export interface OtcGateway {
  contractId: string;
  chainKey: string;
  getOffer(id: number): Promise<ChainOffer | null>;
  getOrder(id: number): Promise<ChainOrder | null>;
  isMerchant(address: string): Promise<boolean>;
  prepare(label: string, method: string, args: Record<string, unknown>): Promise<PreparedTransaction[]>;
  arbiter(method: "set_merchant" | "resolve", args: Record<string, unknown>): Promise<string>;
  arbiterAddress(): string | null;
}

const usdc = (v: bigint) => fromUnits(v, USDC_DECIMALS);
const rate = (v: bigint) => fromUnits(v, Math.log10(RATE_SCALE));
const at = (s: bigint) => new Date(Number(s) * 1000);
const unwrap = (r: any) => (r && typeof r.unwrap === "function" ? r.unwrap() : r);

function toChainOffer(o: any): ChainOffer {
  return {
    id: Number(o.id), merchant: o.merchant, side: sideFromCode(Number(o.side)), currency: String(o.currency),
    rate: rate(BigInt(o.rate)), available: usdc(BigInt(o.available)), minOrder: usdc(BigInt(o.min_order)),
    maxOrder: usdc(BigInt(o.max_order)), active: Boolean(o.active), taker: o.taker ? String(o.taker) : null,
  };
}

function toChainOrder(o: any): ChainOrder {
  const hash = Buffer.from(o.proof_hash).toString("hex");
  return {
    id: Number(o.id), offerId: Number(o.offer_id), merchant: o.merchant, taker: o.taker, side: sideFromCode(Number(o.side)),
    currency: String(o.currency), rate: rate(BigInt(o.rate)), amount: usdc(BigInt(o.amount)), feeBps: Number(o.fee_bps),
    usdcFrom: o.usdc_from, usdcTo: o.usdc_to, status: statusFromCode(Number(o.status)), openedAt: at(BigInt(o.opened_at)),
    payBy: at(BigInt(o.pay_by)), paidAt: BigInt(o.paid_at) > BigInt(0) ? at(BigInt(o.paid_at)) : null,
    proofHash: /^0+$/.test(hash) ? "" : hash,
  };
}

function mapError(err: unknown): ApplicationError {
  const raw = err instanceof Error ? err.message : String(err);
  const known = otcErrorMessage(raw);
  // The service checks USDC balances before preparing, because the token's own error
  // numbers overlap the escrow's.
  if (known) return new ApplicationError("INVALID_REQUEST", known, raw.slice(0, 300));
  return new ApplicationError("UNKNOWN", "The network refused this step. Please try again.", raw.slice(0, 300));
}

export class StellarOtcGateway implements OtcGateway {
  readonly contractId: string;
  readonly chainKey: string;
  private clients = new Map<string, Promise<any>>();

  constructor(private readonly chain: ChainConfig, private readonly env: NodeJS.ProcessEnv = process.env) {
    if (!chain.contracts.otcEscrow) throw new Error(`${chain.key} has no OTC escrow`);
    this.contractId = chain.contracts.otcEscrow;
    this.chainKey = chain.key;
  }

  private sponsor(): string {
    const secret = this.env.STELLAR_FEE_PAYER_SECRET;
    if (!secret) throw new ApplicationError("CHAIN_NOT_ENABLED", "Stellar fee sponsor is not configured");
    return Keypair.fromSecret(secret).publicKey();
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

  private async read(method: string, args: Record<string, unknown>) {
    try {
      const result = (await (await this.client())[method](args)).result;
      // The reads fail only with "not found" (offer #8, order #11), which the SDK returns
      // as an Err with no message. Not found is an answer, not a failure.
      if (result && typeof result.isErr === "function" && result.isErr()) return null;
      return unwrap(result);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Not found is an answer, not a failure.
      if (/Error\(Contract, #(8|11)\)/.test(raw)) return null;
      throw mapError(err);
    }
  }

  async getOffer(id: number) {
    const o = await this.read("get_offer", { offer_id: BigInt(id) });
    return o ? toChainOffer(o) : null;
  }

  async getOrder(id: number) {
    const o = await this.read("get_order", { order_id: BigInt(id) });
    return o ? toChainOrder(o) : null;
  }

  async isMerchant(address: string) {
    return Boolean(await this.read("is_merchant", { who: address }));
  }

  async prepare(label: string, method: string, args: Record<string, unknown>): Promise<PreparedTransaction[]> {
    try {
      const tx = await (await this.client())[method](args);
      return [{ chain: this.chain.key, family: "stellar", label, payload: { kind: "stellar", networkPassphrase: this.chain.networkId, xdr: tx.toXDR() } }];
    } catch (err) {
      throw mapError(err);
    }
  }

  arbiterAddress() {
    const secret = this.env.OTC_ARBITER_SECRET;
    return secret ? Keypair.fromSecret(secret).publicKey() : null;
  }

  async arbiter(method: "set_merchant" | "resolve", args: Record<string, unknown>) {
    const secret = this.env.OTC_ARBITER_SECRET;
    if (!secret) throw new ApplicationError("CHAIN_NOT_ENABLED", "The OTC arbiter key is not configured on this server");
    try {
      const tx = await (await this.client(Keypair.fromSecret(secret)))[method](args);
      const sent = await tx.signAndSend();
      return String(sent.sendTransactionResponse?.hash ?? sent.getTransactionResponse?.txHash ?? "");
    } catch (err) {
      throw mapError(err);
    }
  }
}
