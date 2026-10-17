/**
 * Polls official sources for the benchmarks this deployment uses.
 *
 * Interest-rate benchmarks publish once a business day, so a 30-minute poll finds each
 * value well within its 4-hour grace. Startup reads the last 30 observations to fill gaps.
 */
import { db } from "../db";
import { drizzleRateRepository, oracleBenchmarks, refreshBenchmark } from "./service";
import { RateOracleSubmitter, submitterConfigFromEnv } from "./submitter";

const POLL_MS = 30 * 60_000;

export function startRateOracleScheduler(): void {
  const benchmarks = oracleBenchmarks();
  if (benchmarks.length === 0) return;
  const repo = drizzleRateRepository(db);
  const cfg = submitterConfigFromEnv();
  const submitter = cfg ? new RateOracleSubmitter(cfg) : null;

  const run = async (count: number) => {
    for (const b of benchmarks) {
      try {
        const s = await refreshBenchmark(repo, b.id, undefined, count);
        if (s.accepted || s.revised || s.rejected.length) {
          console.log(`[RateOracle] ${b.id} via ${s.source}: ${s.accepted} new, ${s.revised} revised, ${s.rejected.length} rejected`);
        }
        for (const r of s.rejected) console.warn(`[RateOracle] ${b.id} rejected ${r.observationDate} ${r.ratePercent}: ${r.code}`);
      } catch (err) {
        console.warn(`[RateOracle] ${b.id} fetch failed: ${(err as Error).message}`);
      }
      if (!submitter) continue;
      // Locked values go on chain; values still inside their revision window wait.
      const r = await submitter.sync(repo, b.id);
      if (r.submitted || r.recorded) console.log(`[RateOracle] ${b.id} on chain: ${r.submitted} submitted, ${r.recorded} already final`);
      for (const e of r.errors) console.warn(`[RateOracle] ${e}`);
    }
  };

  console.log(`[RateOracle] Watching ${benchmarks.map((b) => b.id).join(", ")}${submitter ? `; submitting to ${cfg!.contractId} with ${cfg!.nodes.length} nodes` : "; on-chain submission off"}`);
  setTimeout(() => {
    void run(30);
    setInterval(() => void run(5), POLL_MS);
  }, 30_000);
}
