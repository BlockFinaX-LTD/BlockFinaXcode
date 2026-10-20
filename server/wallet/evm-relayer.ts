/**
 * ERC-4337 submission for users' passkey smart accounts.
 *
 * Two sponsors:
 *   - a third-party bundler and paymaster (ERC-7677, e.g. Coinbase Developer Platform)
 *     when `bundlerUrl` is set: the paymaster pays gas and bills BlockFinaX off-chain
 *   - otherwise BlockFinaX's own bundler: the relayer key calls handleOps with a zero
 *     gas price and pays the network fee itself
 *
 * Two steps, so the user signs exactly what the server checked:
 *   1. prepare(): policy-check the calls, build the UserOperation with a zero gas price,
 *      and keep it server-side under an id. The user gets only the hash to sign.
 *   2. submit(): verify the passkey assertion over that hash, attach the signature, and
 *      send EntryPoint.handleOps from the relayer key. The relayer pays the network fee.
 *
 * Policy (the sponsor never pays for arbitrary calls):
 *   - targets must be on the allowlist (testnet USDC and the chain's BlockFinaX contracts)
 *   - only approve/transfer on tokens; no ETH value
 *   - per-user daily operation cap
 */
import { ethers } from "ethers";
import {
  ADD_OWNER_SELECTOR, ENTRY_POINT_V06, callDataFor, decodeCalls, dummySignature, encodeWebAuthnSignature, entryPointInterface,
  initCodeFor, userOpHash, userOpTuple, type Call, type UserOperation,
} from "./evm-smart-account";

const TOKEN_METHODS = new Set(["0x095ea7b3", "0xa9059cbb"]); // approve, transfer

export interface RelayerPolicy {
  /** Token contracts: only approve and transfer. */
  tokens: string[];
  /** BlockFinaX contracts: any method (the contract enforces its own rules). */
  contracts: string[];
  dailyOpsPerUser: number;
}

interface Pending {
  userId: number;
  op: UserOperation;
  hash: string;
  expiresAt: number;
  /** Set only for a server-built backup-passkey operation: allows addOwnerPublicKey on the account itself. */
  ownerChange?: boolean;
}

export class EvmRelayer {
  private readonly pending = new Map<string, Pending>();
  private readonly daily = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();

  private readonly bundler: ethers.JsonRpcProvider | null;

  constructor(
    private readonly provider: ethers.Provider,
    private readonly chainId: number,
    private readonly signer: ethers.Signer | null,
    private readonly policy: RelayerPolicy,
    private readonly now: () => number = Date.now,
    bundlerUrl?: string,
  ) {
    this.bundler = bundlerUrl
      ? new ethers.JsonRpcProvider(bundlerUrl, chainId, { staticNetwork: ethers.Network.from(chainId), batchMaxCount: 1 })
      : null;
  }

  get sponsor(): "paymaster" | "relayer" {
    return this.bundler ? "paymaster" : "relayer";
  }

  /** Throws unless every call is allowed for sponsorship. */
  checkCalls(calls: Call[], ownerChange?: { sender: string }) {
    if (calls.length === 0 || calls.length > 4) throw new Error("A transaction must contain one to four calls");
    if (ownerChange) {
      // Exactly one call: the account adding an owner to itself, with no value.
      const [c] = calls;
      if (calls.length !== 1 || c.value !== BigInt(0) || c.target.toLowerCase() !== ownerChange.sender.toLowerCase()
        || c.data.slice(0, 10).toLowerCase() !== ADD_OWNER_SELECTOR.toLowerCase()) {
        throw new Error("Only adding a passkey owner is sponsored here");
      }
      return;
    }
    const tokens = this.policy.tokens.map((a) => a.toLowerCase());
    const contracts = this.policy.contracts.map((a) => a.toLowerCase());
    for (const c of calls) {
      if (c.value !== BigInt(0)) throw new Error("Sending ETH is not sponsored");
      const target = c.target.toLowerCase();
      if (tokens.includes(target)) {
        if (!TOKEN_METHODS.has(c.data.slice(0, 10).toLowerCase())) throw new Error("Only token approve and transfer are sponsored");
      } else if (!contracts.includes(target)) {
        throw new Error("This contract is not approved for sponsored transactions");
      }
    }
  }

  async prepare(input: { userId: number; sender: string; owner: string; calls: Call[]; ownerChange?: boolean; callGasLimit?: bigint }): Promise<{ id: string; hash: string }> {
    this.checkCalls(input.calls, input.ownerChange ? { sender: input.sender } : undefined);
    const day = `${input.userId}:${new Date(this.now()).toISOString().slice(0, 10)}`;
    if ((this.daily.get(day) ?? 0) >= this.policy.dailyOpsPerUser) throw new Error("Daily sponsored transaction limit reached");

    const deployed = (await this.provider.getCode(input.sender)) !== "0x";
    const nonceData = entryPointInterface.encodeFunctionData("getNonce", [input.sender, 0]);
    const [nonce] = entryPointInterface.decodeFunctionResult("getNonce", await this.provider.call({ to: ENTRY_POINT_V06, data: nonceData }));
    const op: UserOperation = {
      sender: input.sender,
      nonce,
      initCode: deployed ? "0x" : initCodeFor(input.owner),
      callData: callDataFor(input.calls),
      callGasLimit: input.callGasLimit ?? BigInt(500_000),
      verificationGasLimit: BigInt(deployed ? 400_000 : 1_000_000),
      preVerificationGas: BigInt(60_000),
      maxFeePerGas: BigInt(0),
      maxPriorityFeePerGas: BigInt(0),
      paymasterAndData: "0x",
      signature: dummySignature(),
    };
    if (this.bundler) await this.sponsorWithPaymaster(op);
    const hash = userOpHash(op, this.chainId);
    const id = ethers.hexlify(ethers.randomBytes(16));
    this.sweep();
    this.pending.set(id, { userId: input.userId, op, hash, expiresAt: this.now() + 5 * 60_000, ownerChange: input.ownerChange });
    return { id, hash };
  }

  /** The prepared operation, for the caller to verify the passkey assertion against its hash. */
  take(id: string, userId: number): Pending {
    const p = this.pending.get(id);
    this.pending.delete(id);
    if (!p || p.expiresAt < this.now()) throw new Error("This transaction expired. Please try again.");
    if (p.userId !== userId) throw new Error("This transaction belongs to another user");
    // Re-check policy on what will actually run.
    this.checkCalls(decodeCalls(p.op.callData), p.ownerChange ? { sender: p.op.sender } : undefined);
    return p;
  }

  async submit(p: Pending, assertion: { authenticatorData: Uint8Array; clientDataJSON: string; signature: Uint8Array; ownerIndex?: number }): Promise<{ hash: string; success: boolean }> {
    const op = { ...p.op, signature: encodeWebAuthnSignature(assertion) };
    const day = `${p.userId}:${new Date(this.now()).toISOString().slice(0, 10)}`;
    this.daily.set(day, (this.daily.get(day) ?? 0) + 1);
    if (this.bundler) return this.submitToBundler(op, p.hash);
    if (!this.signer) throw new Error("The EVM relayer is not configured");
    return this.serialized(async () => {
      const beneficiary = await this.signer!.getAddress();
      const tx = await this.signer!.sendTransaction({
        to: ENTRY_POINT_V06,
        data: entryPointInterface.encodeFunctionData("handleOps", [[userOpTuple(op)], beneficiary]),
      });
      const receipt = await tx.wait(1, 120_000);
      if (!receipt || receipt.status !== 1) throw new Error("The transaction failed on Base Sepolia");
      const event = receipt.logs
        .map((l) => { try { return entryPointInterface.parseLog(l); } catch { return null; } })
        .find((e) => e?.name === "UserOperationEvent" && e.args.userOpHash === p.hash);
      return { hash: receipt.hash, success: Boolean(event?.args.success) };
    });
  }

  /**
   * Submit an operation for a smart account owned by a platform key (not a passkey), such as
   * the account that triggers deposit-address flushes. The signature is the Coinbase Smart
   * Wallet SignatureWrapper around an ECDSA signature of the operation hash.
   */
  async submitWithOwnerKey(p: Pending, owner: ethers.Wallet, ownerIndex = 0): Promise<{ hash: string; success: boolean }> {
    const sig = owner.signingKey.sign(p.hash).serialized;
    const op = { ...p.op, signature: ethers.AbiCoder.defaultAbiCoder().encode(["tuple(uint256 ownerIndex, bytes signatureData)"], [[ownerIndex, sig]]) };
    if (this.bundler) return this.submitToBundler(op, p.hash);
    throw new Error("Platform operations need a paymaster (EVM_PAYMASTER_URL)");
  }

  /**
   * ERC-7677: get stub paymaster data, estimate gas with the bundler, then get the final
   * paymaster data. The passkey signs the hash of the op including paymasterAndData, so
   * the paymaster's sponsorship and gas limits are fixed before the user approves.
   */
  private async sponsorWithPaymaster(op: UserOperation) {
    const bundler = this.bundler!;
    const chainHex = ethers.toQuantity(this.chainId);
    const fees = await bundler.getFeeData();
    op.maxFeePerGas = ((fees.maxFeePerGas ?? fees.gasPrice ?? BigInt(0)) * BigInt(12)) / BigInt(10);
    op.maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? op.maxFeePerGas;
    const stub = await bundler.send("pm_getPaymasterStubData", [toRpc(op), ENTRY_POINT_V06, chainHex, {}]);
    op.paymasterAndData = stub.paymasterAndData;
    const gas = await bundler.send("eth_estimateUserOperationGas", [toRpc(op), ENTRY_POINT_V06]);
    op.callGasLimit = (BigInt(gas.callGasLimit) * BigInt(12)) / BigInt(10);
    op.verificationGasLimit = (BigInt(gas.verificationGasLimit) * BigInt(13)) / BigInt(10);
    // Base prices L1 data into preVerificationGas, and it moves between estimate and send.
    op.preVerificationGas = (BigInt(gas.preVerificationGas) * BigInt(3)) / BigInt(2);
    if (!stub.isFinal) {
      const final = await bundler.send("pm_getPaymasterData", [toRpc(op), ENTRY_POINT_V06, chainHex, {}]);
      op.paymasterAndData = final.paymasterAndData;
    }
  }

  private async submitToBundler(op: UserOperation, hash: string): Promise<{ hash: string; success: boolean }> {
    const bundler = this.bundler!;
    const sent: string = await bundler.send("eth_sendUserOperation", [toRpc(op), ENTRY_POINT_V06]);
    if (sent.toLowerCase() !== hash.toLowerCase()) throw new Error("The bundler accepted a different operation than the one approved");
    for (let i = 0; i < 60; i++) {
      const receipt = await bundler.send("eth_getUserOperationReceipt", [sent]);
      if (receipt) return { hash: receipt.receipt?.transactionHash ?? receipt.transactionHash ?? sent, success: Boolean(receipt.success) };
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`The transaction is still pending. Operation ${sent}`);
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }

  private sweep() {
    const now = this.now();
    for (const [id, p] of Array.from(this.pending.entries())) if (p.expiresAt < now) this.pending.delete(id);
  }
}

/** A UserOperation in the JSON-RPC shape bundlers and paymasters expect. */
export function toRpc(op: UserOperation) {
  return {
    sender: op.sender,
    nonce: ethers.toQuantity(op.nonce),
    initCode: op.initCode,
    callData: op.callData,
    callGasLimit: ethers.toQuantity(op.callGasLimit),
    verificationGasLimit: ethers.toQuantity(op.verificationGasLimit),
    preVerificationGas: ethers.toQuantity(op.preVerificationGas),
    maxFeePerGas: ethers.toQuantity(op.maxFeePerGas),
    maxPriorityFeePerGas: ethers.toQuantity(op.maxPriorityFeePerGas),
    paymasterAndData: op.paymasterAndData,
    signature: op.signature,
  };
}
