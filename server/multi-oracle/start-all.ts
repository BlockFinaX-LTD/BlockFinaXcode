/**
 * start-all.ts
 *
 * Starts all three oracle nodes as child processes.
 * Called once from server/index.ts on startup when oracle keys are present.
 * Each node runs in isolation with its own data sources and wallet.
 */

import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isProd = process.env.NODE_ENV === "production";

const NODES = [
  { label: "Oracle-A", file: isProd ? "multi-oracle/run-oracle-a.js" : "run-oracle-a.ts", key: "ORACLE_KEY_A" },
  { label: "Oracle-B", file: isProd ? "multi-oracle/run-oracle-b.js" : "run-oracle-b.ts", key: "ORACLE_KEY_B" },
  { label: "Oracle-C", file: isProd ? "multi-oracle/run-oracle-c.js" : "run-oracle-c.ts", key: "ORACLE_KEY_C" },
];

function spawnNode(label: string, file: string, key: string): ChildProcess {
  const scriptPath = isProd
    ? path.join(process.cwd(), "dist", file)
    : path.join(__dirname, file);

  const child = isProd
    ? spawn("node", [scriptPath], { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] })
    : spawn("npx", ["tsx", scriptPath], { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });

  child.stdout?.on("data", (d) => process.stdout.write(`[${label}] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[${label}] ${d}`));

  child.on("exit", (code, signal) => {
    console.log(`[${label}] exited (code=${code} signal=${signal}) — restarting in 30s`);
    setTimeout(() => spawnNode(label, file, key), 30_000);
  });

  return child;
}

export function startAllOracleNodes() {
  const diamond = process.env.DIAMOND_ADDRESS;
  if (!diamond) {
    console.log("[MultiOracle] DIAMOND_ADDRESS not set — skipping oracle nodes");
    return;
  }

  const missing = NODES.filter((n) => !process.env[n.key]).map((n) => n.key);
  if (missing.length > 0) {
    console.log(`[MultiOracle] Missing env vars: ${missing.join(", ")} — skipping oracle nodes`);
    return;
  }

  console.log("[MultiOracle] Starting 3 oracle nodes...");
  for (const { label, file, key } of NODES) {
    spawnNode(label, file, key);
    console.log(`[MultiOracle] ${label} spawned`);
  }
}
