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
 *   deviation 7%     a rate that moved more than this since the last one for the pair is held
 *                    back until a later poll (at least one cooldown apart) sees it again
 *                    within 1%; a real move then settles, a single bad reading does not
 */
import type { ChainRegistry } from "@shared/chains/registry";
import type { ChainKey, ProtectionPosition } from "@shared/domain/types";
import type { AdapterRegistry } from "../chain";
import type { ChainAdapter, PlatformSigner } from "../chain/adapter";

export const ORACLE_POLICY = { staleSeconds: 900, cooldownSeconds: 300, pollSeconds: 300, maxDeviation: 0.07 } as const;

export interface OracleEngineState {
  /** chain:positionId -> unix seconds of this operator's last submission. */
  submittedAt: Map<string, number>;
  /** pair -> last rate this operator used. */
  lastPrice: Map<string, number>;
  /** pair -> a large move seen once and waiting for a second reading to confirm it. */
  pendingJump: Map<string, { price: number; seenAt: number }>;
}

export const newOracleState = (): OracleEngineState => ({ submittedAt: new Map(), lastPrice: new Map(), pendingJump: new Map() });

/** Confirm a move beyond the deviation guard only when a later poll sees it again. */
function jumpConfirmed(state: OracleEngineState, pair: string, price: number, now: number): boolean {
  state.pendingJump ??= new Map();
  const seen = state.pendingJump.get(pair);
  if (seen && now - seen.seenAt >= ORACLE_POLICY.cooldownSeconds && Math.abs(price - seen.price) / seen.price <= 0.01) {
    state.pendingJump.delete(pair);
    return true;
  }
  if (!seen || Math.abs(price - seen.price) / seen.price > 0.01) state.pendingJump.set(pair, { price, seenAt: now });
  return false;
}

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
  const due: { chain: ChainKey; adapter: ChainAdapter; position: ProtectionPosition; pair: string }[] = [];

  for (const chain of deps.chains.settlementNetworks()) {
    if (!deps.signerFor(chain.key)) continue;
    try {
      // The current pool contract and any legacy ones still holding hedges.
      const adapters = typeof deps.adapters.adaptersFor === "function" ? deps.adapters.adaptersFor(chain.key) : [deps.adapters.adapterFor(chain.key)];
      for (const adapter of adapters) {
        for (const pool of await adapter.listPools()) {
          if (pool.activePositions === 0) continue;
          for (const p of await adapter.listActivePositions(pool.poolId)) {
            if (p.expiry <= now) due.push({ chain: chain.key, adapter, position: p, pair: pool.pair });
          }
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

  for (const { chain, adapter, position, pair } of due) {
    // Position ids restart on each contract, so the contract is part of the key.
    const contract = position.ref?.contract;
    const isCurrent = !contract || contract === deps.chains.get(chain).contracts.currencyPool;
    const key = isCurrent ? `${chain}:${position.positionId}` : `${chain}:${contract}:${position.positionId}`;
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
        if (!jumpConfirmed(state, pair, price, now)) {
          report.skipped.push({ position: key, reason: "deviation guard" });
          continue;
        }
        state.lastPrice.set(pair, price);
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
