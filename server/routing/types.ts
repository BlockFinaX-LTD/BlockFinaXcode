/**
 * Routing layer types (Architecture v2.0, docs/architecture/v2/routing-v2.0.md).
 *
 * The routing layer moves assets between a user's Funding or Withdrawal Network and the
 * Liquidity Hub. Providers (direct, BlockFinaX prefunded liquidity, Circle CCTP, and
 * later aggregators and solvers) all satisfy RoutingProvider; the engine asks every
 * eligible one for a quote and picks the best execution outcome.
 */
import type { Asset, ChainKey, RoutingQuote, RoutingState } from "@shared/domain/types";
import type { PreparedTransaction } from "../chain/adapter";
import type { BalanceLedger } from "../domain/ledger";

export type RouteKind = "fund" | "withdraw";

/** What happens on the destination once funds arrive. */
export type RouteAction =
  | { type: "credit" }
  | { type: "lp_deposit"; poolId: number }
  | { type: "hedge"; quoteRef: string };

export interface RouteRequest {
  userId: string;
  kind: RouteKind;
  sourceChain: ChainKey;
  destinationChain: ChainKey;
  asset: Asset;
  destinationAsset: Asset;
  amount: string;
  /** The user's address on each side. */
  sender: string;
  recipient: string;
  action: RouteAction;
}

export type ProviderStatus = "pending" | "source_confirmed" | "destination_confirmed" | "failed";

export interface RouteRecord {
  id: string;
  request: RouteRequest;
  quote: RoutingQuote;
  state: RoutingState;
  trackingId?: string;
  amountReceived?: string;
  history: { state: RoutingState; at: number; note?: string }[];
}

export interface RoutingProvider {
  readonly id: string;
  /** Can this provider move this asset between these chains at all? */
  supports(req: RouteRequest): boolean;
  getQuote(req: RouteRequest): Promise<RoutingQuote | null>;
  /** Starts the route. Returns the user's source-chain transactions to sign, if any. */
  execute(route: RouteRecord): Promise<{ trackingId: string; sourceTransactions: PreparedTransaction[] }>;
  /** sourceConfirmed: set with "failed" when the funds left the sender before the failure. */
  getStatus(route: RouteRecord): Promise<{ status: ProviderStatus; amountReceived?: string; sourceConfirmed?: boolean }>;
  /** After a failure: refunded to the sender, retrying to the destination, or needs a person. */
  recover(route: RouteRecord): Promise<"refunded" | "retrying" | "manual">;
  /** Extra ledger entries when the provider moves platform money (prefunded float). */
  onDestinationConfirmed?(route: RouteRecord, ledger: BalanceLedger): void;
}

export interface RouteStore {
  save(route: RouteRecord): Promise<void>;
  get(id: string): Promise<RouteRecord | undefined>;
  listByUser(userId: string): Promise<RouteRecord[]>;
}

export class InMemoryRouteStore implements RouteStore {
  private routes = new Map<string, RouteRecord>();
  async save(route: RouteRecord) { this.routes.set(route.id, structuredClone(route)); }
  async get(id: string) { const r = this.routes.get(id); return r ? structuredClone(r) : undefined; }
  async listByUser(userId: string) { return Array.from(this.routes.values()).filter((r) => r.request.userId === userId); }
}
