/**
 * Routing providers.
 *
 *   DirectProvider     source and destination are the same network: no routing at all
 *   PrefundedProvider  BlockFinaX's own float on the destination pays out at once; the
 *                      sender's funds land in the treasury on the source network, and the
 *                      ledger records the rebalancing the treasury now owes itself
 *   CctpProvider       Circle CCTP burn-and-mint, for networks with a CCTP domain
 *
 * Aggregators (LI.FI) and solver networks plug in by implementing RoutingProvider; none
 * is wired yet. Every provider that touches a network does it through a port, so the
 * engine and its tests never need a live bridge.
 */
import type { RoutingQuote } from "@shared/domain/types";
import { fromUnits, toUnits } from "@shared/domain/pool-economics";
import type { PreparedTransaction } from "../chain/adapter";
import type { BalanceLedger } from "../domain/ledger";
import type { ProviderStatus, RouteRecord, RouteRequest, RoutingProvider } from "./types";

const QUOTE_TTL = 120;
const now = () => Math.floor(Date.now() / 1000);

function quoteFor(provider: string, req: RouteRequest, feeBps: number, seconds: number, risk: number, route: Record<string, unknown> = {}): RoutingQuote {
  const d = req.asset.decimals;
  const amountIn = toUnits(req.amount, d);
  const fee = (amountIn * BigInt(feeBps)) / BigInt(10_000);
  return {
    provider, sourceChain: req.sourceChain, destinationChain: req.destinationChain, assetIn: req.asset, assetOut: req.destinationAsset,
    amountIn: fromUnits(amountIn, d), amountOut: fromUnits(amountIn - fee, d), totalFees: fromUnits(fee, d),
    estimatedSeconds: seconds, expiresAt: now() + QUOTE_TTL, riskScore: risk, route,
  };
}

/** The user's own wallet sends the transfer; the adapter prepares it. */
export interface TransferPort {
  prepareTransfer(req: RouteRequest, to: string): Promise<PreparedTransaction[]>;
  /** Has the prepared transfer (by tracking id) confirmed on its network? */
  transferStatus(trackingId: string): Promise<"pending" | "confirmed" | "failed">;
}

export class DirectProvider implements RoutingProvider {
  readonly id = "direct";
  constructor(private readonly transfers?: TransferPort) {}
  supports(req: RouteRequest) {
    return req.sourceChain === req.destinationChain && req.asset.symbol === req.destinationAsset.symbol;
  }
  async getQuote(req: RouteRequest) {
    return quoteFor(this.id, req, 0, 5, 0);
  }
  async execute(route: RouteRecord) {
    const txs = route.request.sender === route.request.recipient || !this.transfers ? [] : await this.transfers.prepareTransfer(route.request, route.request.recipient);
    return { trackingId: `direct:${route.id}`, sourceTransactions: txs };
  }
  async getStatus(route: RouteRecord): Promise<{ status: ProviderStatus }> {
    if (!this.transfers || route.request.sender === route.request.recipient) return { status: "destination_confirmed" };
    const s = await this.transfers.transferStatus(route.trackingId!);
    return { status: s === "confirmed" ? "destination_confirmed" : s === "failed" ? "failed" : "pending" };
  }
  async recover() { return "refunded" as const; }
}

/** BlockFinaX treasury balances and payouts on each network. */
export interface TreasuryPort {
  /** Float available to prefund routes on a network. */
  available(chain: string, symbol: string): Promise<string>;
  /** Treasury address that receives the sender's funds on the source network. */
  address(chain: string): string;
  /** Pay the recipient from the destination float. Resolves when confirmed. */
  payout(req: RouteRequest, amount: string): Promise<"confirmed" | "failed">;
  sourceStatus(trackingId: string): Promise<"pending" | "confirmed" | "failed">;
  refund(route: RouteRecord): Promise<"confirmed" | "failed">;
  prepareSourceTransfer(req: RouteRequest, to: string): Promise<PreparedTransaction[]>;
}

export class PrefundedProvider implements RoutingProvider {
  readonly id = "blockfinax-prefunded";
  private paid = new Set<string>();
  constructor(private readonly treasury: TreasuryPort, private readonly cfg = { feeBps: 10, maxAmount: "250000" }) {}

  supports(req: RouteRequest) {
    return req.sourceChain !== req.destinationChain && req.asset.symbol === req.destinationAsset.symbol;
  }
  async getQuote(req: RouteRequest) {
    if (Number(req.amount) > Number(this.cfg.maxAmount)) return null;
    const float = await this.treasury.available(req.destinationChain, req.destinationAsset.symbol);
    if (Number(float) < Number(req.amount)) return null;
    return quoteFor(this.id, req, this.cfg.feeBps, 60, 0.05);
  }
  async execute(route: RouteRecord) {
    const to = this.treasury.address(route.request.sourceChain);
    return { trackingId: `prefunded:${route.id}`, sourceTransactions: await this.treasury.prepareSourceTransfer(route.request, to) };
  }
  async getStatus(route: RouteRecord): Promise<{ status: ProviderStatus; amountReceived?: string; sourceConfirmed?: boolean }> {
    const src = await this.treasury.sourceStatus(route.trackingId!);
    if (src === "failed") return { status: "failed" };
    if (src === "pending") return { status: "pending" };
    if (!this.paid.has(route.id)) {
      const out = await this.treasury.payout(route.request, route.quote.amountOut);
      if (out === "failed") return { status: "failed", sourceConfirmed: true };
      this.paid.add(route.id);
    }
    return { status: "destination_confirmed", amountReceived: route.quote.amountOut };
  }
  async recover(route: RouteRecord) {
    return (await this.treasury.refund(route)) === "confirmed" ? "refunded" as const : "manual" as const;
  }
  /** The treasury paid from its destination float and took the sender's funds on the source. */
  onDestinationConfirmed(route: RouteRecord, ledger: BalanceLedger) {
    const sym = route.request.asset.symbol;
    ledger.debit({ owner: "treasury", location: route.request.destinationChain, bucket: "float" }, sym, route.quote.amountOut, "prefunded payout", route.id);
    ledger.credit({ owner: "treasury", location: route.request.sourceChain, bucket: "float" }, sym, route.request.amount, "prefunded intake (rebalance owed)", route.id);
  }
}

/** Circle CCTP operations, behind a port: burn on the source, attest, mint on the destination. */
export interface CctpPort {
  prepareBurn(req: RouteRequest, sourceDomain: number, destinationDomain: number): Promise<PreparedTransaction[]>;
  status(trackingId: string): Promise<"burn_pending" | "attesting" | "minted" | "failed">;
  /** Re-attempt the mint with the existing attestation. CCTP burns cannot be refunded. */
  retryMint(trackingId: string): Promise<boolean>;
}

export class CctpProvider implements RoutingProvider {
  readonly id = "circle-cctp";
  constructor(private readonly port: CctpPort, private readonly domains: Record<string, number>, private readonly cfg = { feeBps: 1, seconds: 900 }) {}
  supports(req: RouteRequest) {
    return req.asset.symbol === "USDC" && req.destinationAsset.symbol === "USDC"
      && req.sourceChain !== req.destinationChain
      && this.domains[req.sourceChain] !== undefined && this.domains[req.destinationChain] !== undefined;
  }
  async getQuote(req: RouteRequest) {
    return quoteFor(this.id, req, this.cfg.feeBps, this.cfg.seconds, 0.02, {
      sourceDomain: this.domains[req.sourceChain], destinationDomain: this.domains[req.destinationChain],
    });
  }
  async execute(route: RouteRecord) {
    const txs = await this.port.prepareBurn(route.request, this.domains[route.request.sourceChain], this.domains[route.request.destinationChain]);
    return { trackingId: `cctp:${route.id}`, sourceTransactions: txs };
  }
  async getStatus(route: RouteRecord): Promise<{ status: ProviderStatus }> {
    const s = await this.port.status(route.trackingId!);
    return { status: s === "minted" ? "destination_confirmed" : s === "failed" ? "failed" : s === "attesting" ? "source_confirmed" : "pending" };
  }
  async recover(route: RouteRecord) {
    return (await this.port.retryMint(route.trackingId!)) ? "retrying" as const : "manual" as const;
  }
}
