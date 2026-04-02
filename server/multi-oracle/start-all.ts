/**
 * start-all.ts
 *
 * Starts all three oracle nodes for each configured chain.
 * Supports Lisk, Base, and BSC in parallel — 9 processes total when all
 * three chains are configured (3 oracle keys × 3 chains).
 *
 * Required env vars (per chain):
 *   DIAMOND_ADDRESS         — Lisk Mainnet Diamond (existing)
 *   BASE_DIAMOND_ADDRESS    — Base Mainnet Diamond
 *   BSC_DIAMOND_ADDRESS     — BNB Smart Chain Diamond
 *
 * Optional:
 *   LISK_RPC_URL            — defaults to https://rpc.api.lisk.com
 *   BASE_RPC_URL            — defaults to https://mainnet.base.org
 *   BSC_RPC_URL             — defaults to https://bsc-dataseed.binance.org
 */

import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isProd = process.env.NODE_ENV === "production";

const ORACLE_NODES = [
  { label: "A", file: isProd ? "multi-oracle/run-oracle-a.js" : "run-oracle-a.ts", key: "ORACLE_KEY_A" },
  { label: "B", file: isProd ? "multi-oracle/run-oracle-b.js" : "run-oracle-b.ts", key: "ORACLE_KEY_B" },
  { label: "C", file: isProd ? "multi-oracle/run-oracle-c.js" : "run-oracle-c.ts", key: "ORACLE_KEY_C" },
];

const CHAINS = [
  {
    label: "Lisk",
    diamondAddress: process.env.DIAMOND_ADDRESS,
    rpcUrl: process.env.LISK_RPC_URL || "https://rpc.api.lisk.com",
  },
  {
    label: "Base",
    diamondAddress: process.env.BASE_DIAMOND_ADDRESS,
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  },
  {
    label: "BSC",
    diamondAddress: process.env.BSC_DIAMOND_ADDRESS,
    rpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
  },
];

function spawnNode(
  fullLabel: string,
  file: string,
  extraEnv: Record<string, string>
): ChildProcess {
  const scriptPath = isProd
    ? path.join(process.cwd(), "dist", file)
    : path.join(__dirname, file);

  const child = isProd
    ? spawn("node", [scriptPath], {
        env: { ...process.env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawn("npx", ["tsx", scriptPath], {
        env: { ...process.env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
      });

  child.stdout?.on("data", (d) => process.stdout.write(`[${fullLabel}] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[${fullLabel}] ${d}`));

  child.on("exit", (code, signal) => {
    console.log(`[${fullLabel}] exited (code=${code} signal=${signal}) — restarting in 30s`);
    setTimeout(() => spawnNode(fullLabel, file, extraEnv), 30_000);
  });

  return child;
}

export function startAllOracleNodes() {
  const missingKeys = ORACLE_NODES.filter((n) => !process.env[n.key]).map((n) => n.key);
  if (missingKeys.length > 0) {
    console.log(`[MultiOracle] Missing oracle keys: ${missingKeys.join(", ")} — skipping all oracle nodes`);
    return;
  }

  const activeChains = CHAINS.filter((c) => !!c.diamondAddress);
  if (activeChains.length === 0) {
    console.log("[MultiOracle] No diamond addresses configured (DIAMOND_ADDRESS / BASE_DIAMOND_ADDRESS / BSC_DIAMOND_ADDRESS) — skipping oracle nodes");
    return;
  }

  console.log(`[MultiOracle] Starting oracle nodes for ${activeChains.length} chain(s): ${activeChains.map((c) => c.label).join(", ")}`);

  for (const chain of activeChains) {
    for (const node of ORACLE_NODES) {
      const fullLabel = `Oracle-${node.label}-${chain.label}`;
      const extraEnv: Record<string, string> = {
        DIAMOND_ADDRESS: chain.diamondAddress!,
        ORACLE_RPC_URL: chain.rpcUrl,
      };
      spawnNode(fullLabel, node.file, extraEnv);
      console.log(`[MultiOracle] ${fullLabel} spawned → ${chain.diamondAddress} @ ${chain.rpcUrl}`);
    }
  }
}
