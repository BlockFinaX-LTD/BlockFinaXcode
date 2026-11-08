/**
 * Runs the pool oracle engine on a schedule (testnet): every expired hedge on Stellar,
 * including hedges on legacy pool contracts, gets a price from each oracle operator, and
 * settles once the quorum agrees.
 *
 * Testnet runs both operators in this one server with keys held together, so they are not
 * independent; production needs separate operators.
 *
 * Env: POOL_ORACLE_NODE_SECRETS (comma-separated S... keys), falling back to
 * RATE_ORACLE_NODE_SECRETS, which on testnet holds the same two operator keys.
 */
import { AdapterRegistry } from "../chain";
import { chainRegistry } from "../chain/config";
import { newOracleState, ORACLE_POLICY, runOracleEngine, type OracleEngineState } from "./oracle-engine";

export function startPoolOracleRunner(): void {
  const secrets = (process.env.POOL_ORACLE_NODE_SECRETS || process.env.RATE_ORACLE_NODE_SECRETS || "")
    .split(",").map((s) => s.trim()).filter((s) => s.startsWith("S"));
  const chains = chainRegistry();
  if (!chains || secrets.length === 0) {
    console.log("[PoolOracle] Not started: no chain registry or no operator keys");
    return;
  }
  const adapters = new AdapterRegistry(chains);
  const states: OracleEngineState[] = secrets.map(() => newOracleState());
  let running = false;

  const cycle = async () => {
    if (running) return;
    running = true;
    try {
      const { getRate } = await import("../fx-oracle");
      const { recordSoon } = await import("../records/log");
      // Evidence for each fixing: the source and raw value each rate came from, kept with the submission.
      const evidence = new Map<string, { rate: number; source: string; fetchedAt: string }>();
      for (let i = 0; i < secrets.length; i++) {
        const report = await runOracleEngine({
          chains,
          adapters,
          // Stellar pools only: Base Sepolia has no pool contract on testnet.
          signerFor: (key) => (chains.get(key).family === "stellar" ? { secret: secrets[i] } : null),
          fetchPrices: async (pairs) => {
            const out: Record<string, number> = {};
            for (const p of pairs) {
              try {
                const r = await getRate(p);
                if (!r) continue; // reported per hedge as no price
                out[p] = Number(r.rate);
                evidence.set(p, { rate: Number(r.rate), source: String((r as { source?: string }).source ?? "unknown"), fetchedAt: new Date().toISOString() });
              } catch { /* reported per hedge as no price */ }
            }
            return out;
          },
          onSubmitted: (e) => recordSoon({
            actor: { type: "oracle", id: `operator-${i + 1}` },
            action: "fixing.submitted",
            subject: { type: "position", id: `${e.chain}:${e.contract ?? "current"}:${e.positionId}` },
            data: { ...e, evidence: evidence.get(e.pair) ?? null },
          }),
          now: () => Math.floor(Date.now() / 1000),
          log: (m) => console.warn(`[PoolOracle] ${m}`),
        }, states[i]);
        if (report.submitted.length || report.settled.length || report.failed.length) {
          console.log(`[PoolOracle] operator ${i + 1}: submitted ${report.submitted.join(", ") || "none"}; settled ${report.settled.join(", ") || "none"}`
            + (report.failed.length ? `; failed ${report.failed.map((f) => `${f.position} (${f.error})`).join(", ")}` : ""));
        }
      }
    } catch (err) {
      console.warn(`[PoolOracle] cycle failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };

  console.log(`[PoolOracle] Settling expired Stellar hedges with ${secrets.length} operator key(s)`);
  setTimeout(() => {
    void cycle();
    setInterval(() => void cycle(), ORACLE_POLICY.pollSeconds * 1000);
  }, 45_000);
}
