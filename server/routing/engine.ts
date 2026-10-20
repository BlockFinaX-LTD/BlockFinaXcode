/**
 * The routing engine: best-execution choice between providers, and a route state machine
 * that never loses track of funds.
 *
 *   REQUESTED -> SOURCE_CONFIRMED -> ROUTING -> DESTINATION_CONFIRMED
 *             -> ACTION_PENDING -> ACTION_COMPLETED
 *   any routing failure            -> FAILED -> RECOVERY_REQUIRED -> REFUNDED, or back to ROUTING
 *   action failure after arrival   -> RECOVERY_REQUIRED, funds credited to the user on the hub
 *
 * Bridge completion is not action completion: funds that arrive but cannot be deposited
 * or hedged stay as the user's available balance on the destination, recorded in the
 * ledger, until the action is retried or the user withdraws.
 */
import { randomUUID } from "node:crypto";
import type { ChainRegistry } from "@shared/chains/registry";
import { ApplicationError, type RoutingQuote, type RoutingState } from "@shared/domain/types";
import { fromUnits, toUnits } from "@shared/domain/pool-economics";
import type { BalanceLedger } from "../domain/ledger";
import type { RouteRecord, RouteRequest, RouteStore, RoutingProvider } from "./types";

export interface RankingPolicy {
  /** Quotes above this risk are never chosen. */
  maxRisk: number;
  /** Value of one hour of waiting, as a fraction of the amount. */
  timeWeightPerHour: number;
  /** Penalty per unit of risk score, as a fraction of the amount. */
  riskWeight: number;
}

export const DEFAULT_POLICY: RankingPolicy = { maxRisk: 0.5, timeWeightPerHour: 0.001, riskWeight: 0.01 };

/** Higher is better: what the user receives, less a price on waiting and on risk. */
export function scoreQuote(q: RoutingQuote, policy: RankingPolicy): number {
  const amountIn = Number(q.amountIn);
  if (!(amountIn > 0)) return -Infinity;
  return Number(q.amountOut) / amountIn - (q.estimatedSeconds / 3600) * policy.timeWeightPerHour - q.riskScore * policy.riskWeight;
}

/** Runs once funds are on the destination: an LP deposit, a hedge, or a plain credit. */
export type ActionRunner = (route: RouteRecord) => Promise<"completed" | "failed">;

export class RoutingEngine {
  constructor(
    private readonly chains: ChainRegistry,
    private readonly providers: RoutingProvider[],
    private readonly store: RouteStore,
    private readonly ledger: BalanceLedger,
    private readonly runAction: ActionRunner,
    private readonly policy: RankingPolicy = DEFAULT_POLICY,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /** Eligible quotes, best first. Same-network requests only ever use the direct provider. */
  async quote(req: RouteRequest): Promise<{ quote: RoutingQuote; score: number }[]> {
    if (req.kind === "fund") this.chains.require(req.sourceChain, "funding");
    if (req.kind === "withdraw") this.chains.require(req.destinationChain, "withdrawals");
    const now = this.clock();
    const quotes = await Promise.all(this.providers.filter((p) => p.supports(req)).map((p) => p.getQuote(req).catch(() => null)));
    return quotes
      .filter((q): q is RoutingQuote => q !== null && q.expiresAt > now && q.riskScore <= this.policy.maxRisk)
      .map((quote) => ({ quote, score: scoreQuote(quote, this.policy) }))
      .sort((a, b) => b.score - a.score);
  }

  /** Funding defaults to the hub. Direct elsewhere only where the registry allows execution. */
  destinationFor(sourceChain: string): string {
    return this.chains.executionNetworkFor(sourceChain).key;
  }

  async start(req: RouteRequest, quote: RoutingQuote) {
    const provider = this.provider(quote.provider);
    const route: RouteRecord = { id: randomUUID(), request: req, quote, state: "REQUESTED", history: [], createdAt: this.clock() };
    this.move(route, "REQUESTED");
    const { trackingId, sourceTransactions } = await provider.execute(route);
    route.trackingId = trackingId;
    await this.store.save(route);
    return { route, sourceTransactions };
  }

  /** Poll the provider and advance as far as the route can go now. Safe to call repeatedly. */
  async advance(id: string): Promise<RouteRecord> {
    const route = await this.require(id);
    const provider = this.provider(route.quote.provider);
    const sym = route.request.asset.symbol;
    const user = route.request.userId;
    const transit = { owner: user, location: `transit:${route.id}`, bucket: "pending_routing" as const };

    if (route.state === "REQUESTED" || route.state === "SOURCE_CONFIRMED" || route.state === "ROUTING") {
      const { status, amountReceived, sourceConfirmed } = await provider.getStatus(route);
      if (status === "failed") {
        if (route.state === "REQUESTED" && sourceConfirmed) {
          // The funds left the sender before delivery failed: they are in transit, never lost.
          this.ledger.credit(transit, sym, route.request.amount, "route source confirmed", route.id);
          this.move(route, "SOURCE_CONFIRMED");
        }
        if (route.state !== "REQUESTED") this.move(route, "FAILED", "provider reported failure");
        else this.move(route, "FAILED", "source transaction failed; nothing left the sender");
      }
      if ((status === "source_confirmed" || status === "destination_confirmed") && route.state === "REQUESTED") {
        this.ledger.credit(transit, sym, route.request.amount, "route source confirmed", route.id);
        this.move(route, "SOURCE_CONFIRMED");
        this.move(route, "ROUTING");
      }
      if (status === "destination_confirmed" && route.state === "ROUTING") {
        const received = amountReceived ?? route.quote.amountOut;
        const d = route.request.asset.decimals;
        const fee = fromUnits(toUnits(route.request.amount, d) - toUnits(received, d), d);
        const dest = { owner: user, location: route.request.destinationChain, bucket: "available" as const };
        this.ledger.transfer(transit, dest, sym, received, "route delivered", route.id);
        if (Number(fee) > 0) this.ledger.debit(transit, sym, fee, `routing fee: ${provider.id}`, route.id);
        provider.onDestinationConfirmed?.(route, this.ledger);
        route.amountReceived = received;
        this.move(route, "DESTINATION_CONFIRMED");
      }
    }

    if (route.state === "DESTINATION_CONFIRMED" || (route.state === "RECOVERY_REQUIRED" && route.amountReceived)) {
      this.move(route, "ACTION_PENDING");
      const result = await this.runAction(route).catch(() => "failed" as const);
      if (result === "completed") {
        if (route.request.action.type !== "credit") {
          this.ledger.transfer(
            { owner: user, location: route.request.destinationChain, bucket: "available" },
            { owner: user, location: route.request.destinationChain, bucket: "reserved" },
            sym, route.amountReceived!, route.request.action.type, route.id,
          );
        }
        this.move(route, "ACTION_COMPLETED");
      } else {
        // The funds are safe: they are the user's available balance on the destination.
        this.move(route, "RECOVERY_REQUIRED", "funds arrived; destination action failed and can be retried");
      }
    }

    if (route.state === "FAILED") this.move(route, "RECOVERY_REQUIRED", "routing failed");
    await this.store.save(route);
    return route;
  }

  /** The next source-chain step, for routes whose first step had to confirm before it. */
  async continueRoute(id: string, userId: string) {
    const route = await this.require(id);
    if (route.request.userId !== userId) throw new ApplicationError("UNAUTHORIZED", "This transfer belongs to another account");
    if (route.sourceTxHash || route.state !== "REQUESTED") throw new ApplicationError("INVALID_REQUEST", "This transfer has already started");
    const { sourceTransactions } = await this.provider(route.quote.provider).execute(route);
    return { route, sourceTransactions };
  }

  /** Record the user's submitted source transaction, then advance. Only the route's owner may. */
  async attachSource(id: string, userId: string, txHash: string): Promise<RouteRecord> {
    const route = await this.require(id);
    if (route.request.userId !== userId) throw new ApplicationError("UNAUTHORIZED", "This transfer belongs to another account");
    if (route.sourceTxHash && route.sourceTxHash !== txHash) throw new ApplicationError("INVALID_REQUEST", "This transfer already has a source transaction");
    route.sourceTxHash = txHash;
    await this.store.save(route);
    return this.advance(id);
  }

  /** Recover a route whose routing failed. Action failures are retried with advance(). */
  async recover(id: string): Promise<RouteRecord> {
    const route = await this.require(id);
    if (route.state !== "RECOVERY_REQUIRED" || route.amountReceived) return route;
    const outcome = await this.provider(route.quote.provider).recover(route);
    const transit = { owner: route.request.userId, location: `transit:${route.id}`, bucket: "pending_routing" as const };
    const inTransit = this.ledger.balance(transit, route.request.asset.symbol);
    if (outcome === "refunded") {
      if (Number(inTransit) > 0) this.ledger.debit(transit, route.request.asset.symbol, inTransit, "route refunded to sender", route.id);
      this.move(route, "REFUNDED");
    } else if (outcome === "retrying") {
      this.move(route, "ROUTING", "provider retrying delivery");
    }
    await this.store.save(route);
    return route;
  }

  private provider(id: string): RoutingProvider {
    const p = this.providers.find((x) => x.id === id);
    if (!p) throw new ApplicationError("ROUTING_FAILED", `Unknown routing provider ${id}`);
    return p;
  }

  private async require(id: string): Promise<RouteRecord> {
    const r = await this.store.get(id);
    if (!r) throw new ApplicationError("INVALID_REQUEST", `Route ${id} not found`);
    return r;
  }

  private move(route: RouteRecord, state: RoutingState, note?: string) {
    route.state = state;
    route.history.push({ state, at: this.clock(), note });
  }
}
