/**
 * oracle-registration.ts
 *
 * Ensures oracle node wallets are registered on all configured Diamond
 * contracts at startup. Runs on Base and BSC in parallel when the
 * respective diamond address env vars are set.
 *
 * Required (at least one):
 *   BASE_DIAMOND_ADDRESS    — Base Mainnet Diamond
 *   BSC_DIAMOND_ADDRESS     — BNB Smart Chain Diamond
 *
 * Optional (defaults to public RPCs):
 *   BASE_RPC_URL / BSC_RPC_URL
 *
 * The same DEPLOYER_PRIVATE_KEY and ORACLE_KEY_A/B/C are used across
 * all chains. Safe to run every startup — idempotent.
 */

import { ethers } from "ethers";

const ORACLE_ABI = [
  "function addOracle(address oracle) external",
  "function isAuthorisedOracle(address oracle) external view returns (bool)",
  "function isAuthorizedOracle(address oracle) external view returns (bool)",
];

const CHAINS = [
  {
    label: "Base",
    diamondAddress: process.env.BASE_DIAMOND_ADDRESS || "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  },
  {
    label: "BSC",
    diamondAddress: process.env.BSC_DIAMOND_ADDRESS || "0xaC939C0897981Abc0711ec4e37527F13106180fc",
    rpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
  },
];

async function isRegistered(
  readContract: ethers.Contract,
  address: string
): Promise<boolean | null> {
  for (const fn of ["isAuthorisedOracle", "isAuthorizedOracle"]) {
    try {
      return await (readContract as any)[fn](address);
    } catch {
      continue;
    }
  }
  return null;
}

async function registerOnChain(
  chainLabel: string,
  diamondAddress: string,
  rpcUrl: string,
  deployerKey: string,
  oracleKeys: Array<{ label: string; key: string }>
): Promise<void> {
  const tag = `[OracleReg:${chainLabel}]`;
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const owner = new ethers.Wallet(deployerKey, provider);
    const writeContract = new ethers.Contract(diamondAddress, ORACLE_ABI, owner);
    const readContract = new ethers.Contract(diamondAddress, ORACLE_ABI, provider);

    console.log(`${tag} Checking ${oracleKeys.length} oracle node(s) on ${diamondAddress}...`);

    for (const { label, key } of oracleKeys) {
      try {
        const address = new ethers.Wallet(key).address;
        const alreadyRegistered = await isRegistered(readContract, address);

        if (alreadyRegistered === true) {
          console.log(`${tag} ${label} (${address}) already registered — skipping.`);
          continue;
        }

        console.log(`${tag} ${label} → ${address} — calling addOracle...`);
        const tx = await writeContract.addOracle(address);
        const receipt = await tx.wait();
        console.log(`${tag} ${label} registered ✓ (tx: ${receipt.hash})`);
      } catch (err: any) {
        console.error(`${tag} ${label} — ${err.message || err}`);
      }
    }

    console.log(`${tag} Done.`);
  } catch (err: any) {
    console.error(`${tag} Chain setup failed — ${err.message || err}`);
  }
}

export async function registerOracleNodes(): Promise<void> {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) {
    console.log("[OracleReg] Skipping — DEPLOYER_PRIVATE_KEY not set.");
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

  const activeChains = CHAINS.filter((c) => !!c.diamondAddress);
  if (activeChains.length === 0) {
    console.log("[OracleReg] No diamond addresses configured — skipping.");
    return;
  }

  console.log(`[OracleReg] Registering on ${activeChains.length} chain(s): ${activeChains.map((c) => c.label).join(", ")}`);

  await Promise.all(
    activeChains.map((chain) =>
      registerOnChain(chain.label, chain.diamondAddress!, chain.rpcUrl, deployerKey, oracleKeys)
    )
  );
}
