/**
 * Deploy StellarDeposit and StellarDepositFactory on an EVM chain with the deterministic CREATE2
 * deployer, so the addresses are the same wherever and whenever they are deployed.
 *
 *   Paid by an account with ETH (a one-time deployment):
 *     DEPLOYER_PRIVATE_KEY=... npx tsx scripts/deploy-deposit-factory.ts base-sepolia [minAmount6]
 *   Sponsored by the configured paymasters (EVM_RELAYER_PRIVATE_KEY's platform account):
 *     SPONSORED=1 EVM_RELAYER_PRIVATE_KEY=... EVM_PAYMASTER_FALLBACK_URL=... npx tsx scripts/deploy-deposit-factory.ts base-sepolia
 *   Print the addresses without deploying:
 *     PLAN_ONLY=1 npx tsx scripts/deploy-deposit-factory.ts base-sepolia [minAmount6]
 *
 * Coinbase's paymaster caps the cost of one sponsored operation, and contract code is too
 * large for it on Base, so deployment is a normal transaction. Deposit flushes stay sponsored.
 */
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { StrKey } from "@stellar/stellar-sdk";
import { ChainRegistry } from "../shared/chains/registry";
import { PlatformSubmitter } from "../server/routing/deposit-addresses";

const DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
const SALT = ethers.id("blockfinax.stellar-deposit.v1");
const chainKey = process.argv[2] ?? "base-sepolia";
const minAmount = BigInt(process.argv[3] ?? "1000000");
const MAX_FEE_BPS = BigInt(10);

const cfg = JSON.parse(readFileSync(`config/chains/${process.env.CHAIN_CONFIG ?? "testnet"}.json`, "utf8"));
const chains = new ChainRegistry(cfg);
const evm = chains.get(chainKey);
const hub = chains.hub;
if (!evm.cctp || !hub.cctp?.forwarder) throw new Error("CCTP is not configured on both chains");
const art = JSON.parse(readFileSync("contracts/evm/artifacts/StellarDeposit.json", "utf8"));
const provider = new ethers.JsonRpcProvider(evm.rpcUrls[0]);
const planOnly = process.env.PLAN_ONLY === "1";
const payer = process.env.DEPLOYER_PRIVATE_KEY ? new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider) : null;

/** Deploy once with CREATE2 through the deterministic deployer; return the address. */
async function deploy(name: string, initCode: string) {
  const address = ethers.getCreate2Address(DEPLOYER, SALT, ethers.keccak256(initCode));
  if ((await provider.getCode(address)) !== "0x") {
    console.log(`${name} already deployed`, address);
    return address;
  }
  if (planOnly) {
    console.log(`${name} will be at`, address);
    return address;
  }
  if (process.env.SPONSORED === "1") {
    const sent = await new PlatformSubmitter(evm, [DEPLOYER]).send([{ target: DEPLOYER, data: ethers.concat([SALT, initCode]) }]);
    console.log(`${name} deploy tx`, sent.hash, sent.success ? "ok" : "FAILED");
  } else {
    if (!payer) throw new Error("Set DEPLOYER_PRIVATE_KEY (an account with a little ETH), SPONSORED=1, or PLAN_ONLY=1");
    const tx = await payer.sendTransaction({ to: DEPLOYER, data: ethers.concat([SALT, initCode]) });
    const receipt = await tx.wait();
    console.log(`${name} deploy tx`, tx.hash, receipt?.status === 1 ? "ok" : "FAILED");
  }
  for (let i = 0; i < 10 && (await provider.getCode(address)) === "0x"; i++) await new Promise((r) => setTimeout(r, 2000));
  if ((await provider.getCode(address)) === "0x") throw new Error(`${name} not found after deployment`);
  console.log(`${name} deployed`, address);
  return address;
}

if (payer) console.log("paid by", payer.address, ethers.formatEther(await provider.getBalance(payer.address)), "ETH");
const implementation = await deploy("StellarDeposit", art.StellarDeposit.bytecode);
const args = [implementation, evm.assets.USDC.addressOrContract, evm.cctp.tokenMessenger, ethers.hexlify(StrKey.decodeContract(hub.cctp.forwarder)), hub.cctp.domain, minAmount, MAX_FEE_BPS];
const factory = await deploy("StellarDepositFactory", ethers.concat([art.StellarDepositFactory.bytecode, new ethers.Interface(art.StellarDepositFactory.abi).encodeDeploy(args)]));
console.log(JSON.stringify({ depositFactory: factory, depositImplementation: implementation, depositMinAmount: minAmount.toString() }));
