/**
 * oracle-registration.ts
 *
 * Automatically registers oracle node wallets on the Diamond contract at startup.
 * Uses DEPLOYER_PRIVATE_KEY (contract owner) to call setOracleAdmin for each
 * configured oracle key (ORACLE_KEY_A / B / C).
 *
 * Safe to run every startup — it catches and logs failures without crashing.
 */

import { ethers } from "ethers";

const ORACLE_ABI = [
  "function setOracleAdmin(address oracle) external",
];

const isProd = process.env.NODE_ENV === "production";

const RPC_URL =
  process.env.ORACLE_RPC_URL ||
  (isProd ? "https://rpc.api.lisk.com" : "https://rpc.sepolia-api.lisk.com");

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
    console.log("[OracleReg] No oracle keys configured — skipping registration.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const owner = new ethers.Wallet(deployerKey, provider);
  const contract = new ethers.Contract(diamondAddress, ORACLE_ABI, owner);

  console.log(`[OracleReg] Registering ${oracleKeys.length} oracle node(s) on Diamond...`);

  for (const { label, key } of oracleKeys) {
    try {
      const wallet = new ethers.Wallet(key);
      const address = wallet.address;
      console.log(`[OracleReg] ${label} → ${address} — sending setOracleAdmin...`);
      const tx = await contract.setOracleAdmin(address);
      const receipt = await tx.wait();
      console.log(`[OracleReg] ${label} registered ✓ (tx: ${receipt.hash})`);
    } catch (err: any) {
      console.error(`[OracleReg] ${label} registration failed: ${err.message || err}`);
    }
  }

  console.log("[OracleReg] Done.");
}
