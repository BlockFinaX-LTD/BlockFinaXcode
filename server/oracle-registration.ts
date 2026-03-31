/**
 * oracle-registration.ts
 *
 * Ensures oracle node wallets are registered on the Diamond contract at startup.
 * Uses DEPLOYER_PRIVATE_KEY (contract owner) to call addOracle() for each
 * configured oracle key (ORACLE_KEY_A / B / C).
 *
 * Checks isAuthorisedOracle() first — skips any already-registered nodes.
 * Safe to run every startup — idempotent.
 */

import { ethers } from "ethers";

const ORACLE_ABI = [
  "function addOracle(address oracle) external",
  "function removeOracle(address oracle) external",
  "function isAuthorisedOracle(address oracle) external view returns (bool)",
  "function isAuthorizedOracle(address oracle) external view returns (bool)",
];

const isProd = process.env.NODE_ENV === "production";

const RPC_URL =
  process.env.ORACLE_RPC_URL ||
  (isProd ? "https://rpc.api.lisk.com" : "https://rpc.sepolia-api.lisk.com");

async function isRegistered(readContract: ethers.Contract, address: string): Promise<boolean | null> {
  for (const fn of ["isAuthorisedOracle", "isAuthorizedOracle"]) {
    try {
      return await (readContract as any)[fn](address);
    } catch {
      continue;
    }
  }
  return null; // can't determine — assume not registered
}

export async function registerOracleNodes(): Promise<void> {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  const diamondAddress = process.env.DIAMOND_ADDRESS;

  if (!deployerKey || !diamondAddress) {
    console.log("[OracleReg] Skipping — DEPLOYER_PRIVATE_KEY or DIAMOND_ADDRESS not set.");
    return;
  }

  const oracleKeys = [
    { label: "Oracle-A", key: process.env.ORACLE_KEY_A },
    { label: "Oracle-B", key: process.env.ORACLE_KEY_B },
    { label: "Oracle-C", key: process.env.ORACLE_KEY_C },
  ].filter((n): n is { label: string; key: string } => !!n.key);

  if (oracleKeys.length === 0) {
    console.log("[OracleReg] No oracle keys configured — skipping.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const owner = new ethers.Wallet(deployerKey, provider);
  const writeContract = new ethers.Contract(diamondAddress, ORACLE_ABI, owner);
  const readContract = new ethers.Contract(diamondAddress, ORACLE_ABI, provider);

  console.log(`[OracleReg] Checking ${oracleKeys.length} oracle node(s)...`);

  for (const { label, key } of oracleKeys) {
    try {
      const address = new ethers.Wallet(key).address;

      const alreadyRegistered = await isRegistered(readContract, address);
      if (alreadyRegistered === true) {
        console.log(`[OracleReg] ${label} (${address}) already registered — skipping.`);
        continue;
      }

      console.log(`[OracleReg] ${label} → ${address} — calling addOracle...`);
      const tx = await writeContract.addOracle(address);
      const receipt = await tx.wait();
      console.log(`[OracleReg] ${label} registered ✓ (tx: ${receipt.hash})`);
    } catch (err: any) {
      console.error(`[OracleReg] ${label} — ${err.message || err}`);
    }
  }

  console.log("[OracleReg] Done.");
}
