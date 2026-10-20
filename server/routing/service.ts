/**
 * The routing service: one RoutingEngine for the API and the background worker, with
 * persistent routes and ledger, and Circle CCTP wired wherever two chains have it.
 */
import type { ChainRegistry } from "@shared/chains/registry";
import { ApplicationError } from "@shared/domain/types";
import type { AdapterRegistry } from "../chain";
import { RoutingEngine } from "./engine";
import { CctpProvider, DirectProvider } from "./providers";
import { CircleCctpPort } from "./cctp";
import { DbRouteStore, PersistentLedger, ensureRoutingTables } from "./store";
import type { RouteRecord, RoutingProvider } from "./types";

export interface RoutingService {
  engine: RoutingEngine;
  store: DbRouteStore;
  cctpEnabled: boolean;
}

let service: Promise<RoutingService> | null = null;

async function query(text: string, params?: unknown[]) {
  const { pool } = await import("../db");
  if (!pool) throw new ApplicationError("CHAIN_NOT_ENABLED", "Routing needs a database");
  return pool.query(text, params);
}

export function routingService(chains: ChainRegistry, adapters: AdapterRegistry): Promise<RoutingService> {
  if (!service) {
    service = (async () => {
      await ensureRoutingTables(query);
      const store = new DbRouteStore(query);
      const ledger = await PersistentLedger.load(query);
      const domains: Record<string, number> = {};
      for (const c of chains.all()) if (c.cctp && c.state !== "DISABLED") domains[c.key] = c.cctp.domain;
      const cctpEnabled = Object.keys(domains).length >= 2 && Boolean(chains.config.cctpAttestationUrl);
      const providers: RoutingProvider[] = [new DirectProvider()];
      if (cctpEnabled) providers.push(new CctpProvider(new CircleCctpPort(chains, adapters, chains.config.cctpAttestationUrl!), domains));
      // Funds that arrive are credited to the user's wallet by the transfer itself.
      const engine = new RoutingEngine(chains, providers, store, ledger, async () => "completed");
      return { engine, store, cctpEnabled };
    })();
    service.catch(() => { service = null; });
  }
  return service;
}

/** A route as the app and API show it. */
export function routeView(r: RouteRecord) {
  return {
    id: r.id,
    kind: r.request.kind,
    provider: r.quote.provider,
    sourceChain: r.request.sourceChain,
    destinationChain: r.request.destinationChain,
    recipient: r.request.recipient,
    amount: r.request.amount,
    amountOut: r.amountReceived ?? r.quote.amountOut,
    maxFee: r.quote.totalFees,
    state: r.state,
    sourceTxHash: r.sourceTxHash ?? null,
    destinationTxHash: r.destinationTxHash ?? null,
    createdAt: r.createdAt ?? r.history[0]?.at ?? null,
    updatedAt: r.history[r.history.length - 1]?.at ?? null,
    error: r.state === "RECOVERY_REQUIRED" ? r.lastError ?? r.history[r.history.length - 1]?.note ?? null : null,
  };
}

let worker: ReturnType<typeof setInterval> | null = null;

/** Advance every open route, every 20 seconds. Safe to call more than once. */
export function startRoutingWorker(load: () => Promise<{ chains: ChainRegistry; adapters: AdapterRegistry }>) {
  if (worker) return;
  let running = false;
  const lastRecovery = new Map<string, number>();
  const cycle = async () => {
    if (running) return;
    running = true;
    try {
      const { chains, adapters } = await load();
      const { engine, store } = await routingService(chains, adapters);
      for (const route of await store.listOpen()) {
        try {
          if (route.state === "RECOVERY_REQUIRED") {
            // Retry delivery at most once a minute; routes with funds already delivered retry the action.
            if (Date.now() - (lastRecovery.get(route.id) ?? 0) < 60_000) continue;
            lastRecovery.set(route.id, Date.now());
            if (route.amountReceived) await engine.advance(route.id);
            else await engine.recover(route.id);
            continue;
          }
          // Not signed yet: nothing to follow until the user submits the source transaction.
          if (route.state === "REQUESTED" && !route.sourceTxHash) continue;
          const before = route.state;
          const after = await engine.advance(route.id);
          if (after.state !== before) console.log(`[Routing] ${route.id} ${before} -> ${after.state}`);
        } catch (err) {
          console.warn(`[Routing] ${route.id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      console.warn(`[Routing] cycle failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };
  worker = setInterval(() => void cycle(), 20_000);
  setTimeout(() => void cycle(), 30_000);
}
