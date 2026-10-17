/**
 * The oracle engine, once, for every chain (Architecture v2.0).
 *
 * Market data and policy are decided here; chain submission is the adapter's job. Each
 * poll it finds hedges past expiry on every chain that still settles (the hub and any
 * draining chain), fetches one rate per pair from the shared FX source, and asks each
 * chain's adapter to submit it and to settle once a quorum agrees.
 *
 * Policy (the same as both contracts enforce):
 *   stale     900 s  a submission older than this no longer counts
 *   cooldown  300 s  an oracle waits this long before replacing its own price
 *   poll      300 s  so a hedge gets a price within about 5 minutes of expiry
 *   deviation 7%     refuse a rate that moved more than this since the last one for the pair
 */
import type { ChainRegistry } from "@shared/chains/registry";
import type { ChainKey, ProtectionPosition } from "@shared/domain/types";
import type { AdapterRegistry } from "../chain";
import type { PlatformSigner } from "../chain/adapter";

export const ORACLE_POLICY = { staleSeconds: 900, cooldownSeconds: 300, pollSeconds: 300, maxDeviation: 0.07 } as const;

export interface OracleEngineState {
  /** chain:positionId -> unix seconds of this operator's last submission. */
  submittedAt: Map<string, number>;
  /** pair -> last rate this operator used. */
  lastPrice: Map<string, number>;
}

export const newOracleState = (): OracleEngineState => ({ submittedAt: new Map(), lastPrice: new Map() });

export interface OracleCycleReport {
  submitted: string[];
  settled: string[];
  skipped: { position: string; reason: string }[];
  failed: { position: string; error: string }[];
}

export interface OracleEngineDeps {
  chains: ChainRegistry;
  adapters: AdapterRegistry;
  /** This operator's key on a chain, or null if it does not run that chain. */
  signerFor(chain: ChainKey): PlatformSigner | null;
  fetchPrices(pairs: string[]): Promise<Record<string, number>>;
  now(): number;
  log(message: string): void;
}

/** One poll across every settling chain. Never throws; failures are reported per hedge. */
export async function runOracleEngine(deps: OracleEngineDeps, state: OracleEngineState): Promise<OracleCycleReport> {
  const report: OracleCycleReport = { submitted: [], settled: [], skipped: [], failed: [] };
  const now = deps.now();
  const due: { chain: ChainKey; position: ProtectionPosition; pair: string }[] = [];

  for (const chain of deps.chains.settlementNetworks()) {
    if (!deps.signerFor(chain.key)) continue;
    try {
      const adapter = deps.adapters.adapterFor(chain.key);
      for (const pool of await adapter.listPools()) {
        if (pool.activePositions === 0) continue;
        for (const p of await adapter.listActivePositions(pool.poolId)) {
          if (p.expiry <= now) due.push({ chain: chain.key, position: p, pair: pool.pair });
        }
      }
    } catch (err) {
      deps.log(`${chain.key}: scan failed, retrying next poll: ${(err as Error).message}`);
    }
  }
  if (due.length === 0) return report;

  let prices: Record<string, number>;
  try {
    prices = await deps.fetchPrices(Array.from(new Set(due.map((d) => d.pair))));
  } catch (err) {
    deps.log(`Price source failed, nothing submitted: ${(err as Error).message}`);
    return report;
  }

  for (const { chain, position, pair } of due) {
    const key = `${chain}:${position.positionId}`;
    const adapter = deps.adapters.adapterFor(chain);
    const signer = deps.signerFor(chain)!;
    try {
      if ((await adapter.getOracleState(position.positionId)).resolved) {
        const s = await adapter.settle(position.positionId, signer);
        if (s.state === "CONFIRMED") report.settled.push(key);
        continue;
      }
      const last = state.submittedAt.get(key);
      if (last !== undefined) {
        const age = now - last;
        if (age < ORACLE_POLICY.cooldownSeconds) { report.skipped.push({ position: key, reason: "cooldown" }); continue; }
        if (age + ORACLE_POLICY.pollSeconds < ORACLE_POLICY.staleSeconds) { report.skipped.push({ position: key, reason: "own price still fresh" }); continue; }
      }
      const price = prices[pair];
      if (!price || !Number.isFinite(price) || price <= 0) { report.skipped.push({ position: key, reason: `no price for ${pair}` }); continue; }
      const previous = state.lastPrice.get(pair);
      if (previous && Math.abs(price - previous) / previous > ORACLE_POLICY.maxDeviation) {
        report.skipped.push({ position: key, reason: "deviation guard" });
        continue;
      }
      const sent = await adapter.submitOraclePrice(position.positionId, price.toFixed(6), signer);
      if (sent.state !== "CONFIRMED") { report.failed.push({ position: key, error: sent.error ?? "UNKNOWN" }); continue; }
      state.submittedAt.set(key, now);
      state.lastPrice.set(pair, price);
      report.submitted.push(key);
      if ((await adapter.getOracleState(position.positionId)).resolved) {
        const s = await adapter.settle(position.positionId, signer);
        if (s.state === "CONFIRMED") report.settled.push(key);
      }
    } catch (err) {
      report.failed.push({ position: key, error: (err as Error).message });
    }
  }
  return report;
}

/** "USD/GHS" pairs to the FX source's base/quote map. */
export function pairMap(pairs: string[]) {
  return Object.fromEntries(pairs.map((p) => { const [base, quote] = p.split("/"); return [p, { base, quote }]; }));
}
