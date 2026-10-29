/**
 * Personal deposit addresses on EVM funding networks (contracts/evm/StellarDeposit.sol).
 *
 * Each user's address is derived from their Stellar wallet with CREATE2, so it exists before
 * the contract does and can only ever forward USDC to that wallet through Circle CCTP.
 *
 * The watcher:
 *   1. reads the canonical USDC balance of every deposit address (Multicall3), never events,
 *      so a fake token or a spoofed Transfer log cannot trigger anything;
 *   2. for a balance at or above the contract's minimum, records a route and calls
 *      factory.flush from the platform smart account (gas paid by the paymaster);
 *   3. the routing worker then follows Circle's attestation and mints on Stellar.
 * The user is credited only by Circle's mint on Stellar.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import type { ChainConfig, ChainRegistry } from "@shared/chains/registry";
import { fromUnits, toUnits } from "@shared/domain/pool-economics";
import { EvmRelayer, paymasterUrls } from "../wallet/evm-relayer";
import { smartAccountAddress } from "../wallet/evm-smart-account";
import type { RoutingEngine } from "./engine";
import type { RouteStore } from "./types";

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const multicall = new ethers.Interface(["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])"]);
const erc20 = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
/** Circle's cap is far below this; the contract enforces it again (maxFeeBps). */
const FAST = 1000;

let artifact: { StellarDepositFactory: { abi: any; bytecode: string }; StellarDeposit: { abi: any; bytecode: string } } | null = null;
function build() {
  if (!artifact) artifact = JSON.parse(readFileSync(path.join(process.cwd(), "contracts/evm/artifacts/StellarDeposit.json"), "utf8"));
  return artifact!;
}
export const factoryInterface = () => new ethers.Interface(build().StellarDepositFactory.abi);

/** Computed in shared/wallet-trust.ts, so the app can recompute and check every address it shows. */
export { depositAddressFor } from "@shared/wallet-trust";
import { depositAddressFor } from "@shared/wallet-trust";

/** Funding networks that have a deposit factory. */
export function depositChains(chains: ChainRegistry): ChainConfig[] {
  return chains.all().filter((c) => c.family === "evm" && c.state !== "DISABLED" && c.cctp?.depositFactory && c.cctp?.depositImplementation);
}

/** A user's deposit address on each funding network, for the Deposit screen and the API. */
export function depositAddressesFor(chains: ChainRegistry, stellarWallet: string) {
  return depositChains(chains).map((c) => ({
    chain: c.key,
    name: c.name,
    address: depositAddressFor(c.cctp!.depositFactory!, c.cctp!.depositImplementation!, stellarWallet),
    assets: ["USDC"],
    minimum: fromUnits(BigInt(c.cctp!.depositMinAmount ?? "1000000"), 6),
  }));
}

/** The platform smart account that triggers flushes, owned by EVM_RELAYER_PRIVATE_KEY. */
export class PlatformSubmitter {
  private readonly provider: ethers.JsonRpcProvider;
  private readonly owner: ethers.Wallet;
  private readonly relayer: EvmRelayer;
  private account: string | null = null;

  constructor(private readonly chain: ChainConfig, allowed: string[], secret = process.env.EVM_RELAYER_PRIVATE_KEY, paymasters = paymasterUrls(Number(chain.networkId))) {
    if (!secret || paymasters.length === 0) throw new Error("EVM_RELAYER_PRIVATE_KEY and a paymaster (EVM_PAYMASTER_URL or EVM_PAYMASTER_FALLBACK_URL) are required");
    const id = Number(chain.networkId);
    this.provider = new ethers.JsonRpcProvider(chain.rpcUrls[0], id, { staticNetwork: ethers.Network.from(id) });
    this.owner = new ethers.Wallet(secret);
    this.relayer = new EvmRelayer(this.provider, id, null, { tokens: [], contracts: allowed, dailyOpsPerUser: 10_000 }, Date.now, paymasters);
  }

  get ownerBytes() {
    return ethers.AbiCoder.defaultAbiCoder().encode(["address"], [this.owner.address]);
  }

  async address() {
    this.account ??= await smartAccountAddress(this.provider, this.ownerBytes);
    return this.account;
  }

  async send(calls: { target: string; data: string }[]): Promise<{ hash: string; success: boolean }> {
    const prepared = await this.relayer.prepare({
      userId: 0, sender: await this.address(), owner: this.ownerBytes, calls: calls.map((c) => ({ target: c.target, data: c.data, value: BigInt(0) })),
      // Creating a contract (the factory, or a user's deposit address on its first flush) needs more than a transfer.
      callGasLimit: BigInt(900_000),
    });
    return this.relayer.submitWithOwnerKey(this.relayer.take(prepared.id, 0), this.owner);
  }
}

export interface DepositWallet {
  userId: string;
  stellarWallet: string;
}

/** Read real USDC balances of deposit addresses and flush the ones with enough in them. */
export class DepositWatcher {
  private submitter: PlatformSubmitter | null = null;

  constructor(
    private readonly chains: ChainRegistry,
    private readonly chain: ChainConfig,
    private readonly engine: RoutingEngine,
    private readonly store: RouteStore & { listOpen?: () => Promise<{ request: { sender: string } }[]> },
    private readonly wallets: () => Promise<DepositWallet[]>,
    private readonly estimateMaxFee: (amount: string) => Promise<string>,
    private readonly log: (m: string) => void = (m) => console.log(`[Deposits] ${m}`),
  ) {}

  private get factory() {
    return this.chain.cctp!.depositFactory!;
  }

  private get minimum(): bigint {
    return BigInt(this.chain.cctp!.depositMinAmount ?? "1000000");
  }

  async balances(addresses: string[]): Promise<bigint[]> {
    const usdc = this.chain.assets.USDC.addressOrContract;
    const provider = new ethers.JsonRpcProvider(this.chain.rpcUrls[0]);
    const out: bigint[] = [];
    for (let i = 0; i < addresses.length; i += 200) {
      const batch = addresses.slice(i, i + 200);
      const data = multicall.encodeFunctionData("aggregate3", [batch.map((a) => ({ target: usdc, allowFailure: true, callData: erc20.encodeFunctionData("balanceOf", [a]) }))]);
      const [results] = multicall.decodeFunctionResult("aggregate3", await provider.call({ to: MULTICALL3, data }));
      for (const r of results as { success: boolean; returnData: string }[]) {
        out.push(r.success && r.returnData !== "0x" ? BigInt(erc20.decodeFunctionResult("balanceOf", r.returnData)[0]) : BigInt(0));
      }
    }
    return out;
  }

  private ready = false;

  async scan(): Promise<number> {
    // Nothing to do until the factory is deployed on this chain.
    if (!this.ready) {
      const code = await new ethers.JsonRpcProvider(this.chain.rpcUrls[0]).getCode(this.factory);
      if (code === "0x") return 0;
      this.ready = true;
    }
    const wallets = await this.wallets();
    if (wallets.length === 0) return 0;
    const addresses = wallets.map((w) => depositAddressFor(this.factory, this.chain.cctp!.depositImplementation!, w.stellarWallet));
    const balances = await this.balances(addresses);
    // An address with a transfer already on its way is left alone until that one is delivered.
    const busy = new Set((await (this.store.listOpen?.() ?? Promise.resolve([]))).map((r) => r.request.sender.toLowerCase()));
    let flushed = 0;
    for (let i = 0; i < wallets.length; i++) {
      const amount6 = balances[i];
      if (amount6 < this.minimum || busy.has(addresses[i].toLowerCase())) continue;
      try {
        await this.flush(wallets[i], addresses[i], amount6);
        flushed++;
      } catch (err) {
        this.log(`flush ${addresses[i]} failed: ${(err as Error).message}`);
      }
    }
    return flushed;
  }

  private async flush(w: DepositWallet, address: string, amount6: bigint) {
    const hub = this.chains.hub;
    const amount = fromUnits(amount6, 6);
    const maxFee = await this.estimateMaxFee(amount);
    const maxFee6 = toUnits(maxFee, 6);
    const request = {
      userId: w.userId, kind: "fund" as const, sourceChain: this.chain.key, destinationChain: hub.key,
      asset: this.chains.asset(this.chain.key, "USDC"), destinationAsset: this.chains.asset(hub.key, "USDC"),
      amount, sender: address, recipient: w.stellarWallet, action: { type: "credit" as const },
    };
    const now = Math.floor(Date.now() / 1000);
    const quote = {
      provider: "circle-cctp", sourceChain: this.chain.key, destinationChain: hub.key, assetIn: request.asset, assetOut: request.destinationAsset,
      amountIn: amount, amountOut: fromUnits(amount6 - maxFee6, 6), totalFees: maxFee, estimatedSeconds: 60, expiresAt: now + 120, riskScore: 0.02,
      route: { depositAddress: address },
    };
    // Record the route before sending, so a delivered burn is always followed to the mint.
    const route = await this.engine.track(request, quote);
    let sent: { hash: string; success: boolean };
    try {
      this.submitter ??= new PlatformSubmitter(this.chain, [this.factory]);
      const data = factoryInterface().encodeFunctionData("flush", [w.stellarWallet, maxFee6, FAST]);
      sent = await this.submitter.send([{ target: this.factory, data }]);
    } catch (err) {
      const message = (err as Error).message;
      // Accepted but not yet mined: it may still land, so keep the route (and the address) open.
      if (!/still pending/i.test(message)) await this.engine.cancel(route.id, `flush not sent: ${message.slice(0, 200)}`);
      throw err;
    }
    if (!sent.success) {
      await this.engine.cancel(route.id, `flush reverted in ${sent.hash}`);
      throw new Error(`flush reverted in ${sent.hash}`);
    }
    await this.engine.attachSource(route.id, w.userId, sent.hash);
    this.log(`${amount} USDC from ${address} on its way to ${w.stellarWallet} (${sent.hash})`);
  }
}
