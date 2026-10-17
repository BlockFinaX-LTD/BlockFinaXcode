/**
 * BlockFinaX's own ERC-4337 bundler for its users' passkey smart accounts (testnet).
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
  ENTRY_POINT_V06, callDataFor, decodeCalls, dummySignature, encodeWebAuthnSignature, entryPointInterface,
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
}

export class EvmRelayer {
  private readonly pending = new Map<string, Pending>();
  private readonly daily = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly provider: ethers.Provider,
    private readonly chainId: number,
    private readonly signer: ethers.Signer | null,
    private readonly policy: RelayerPolicy,
    private readonly now: () => number = Date.now,
  ) {}

  /** Throws unless every call is allowed for sponsorship. */
  checkCalls(calls: Call[]) {
    if (calls.length === 0 || calls.length > 4) throw new Error("A transaction must contain one to four calls");
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

  async prepare(input: { userId: number; sender: string; owner: string; calls: Call[] }): Promise<{ id: string; hash: string }> {
    this.checkCalls(input.calls);
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
      callGasLimit: BigInt(500_000),
      verificationGasLimit: BigInt(deployed ? 400_000 : 1_000_000),
      preVerificationGas: BigInt(60_000),
      maxFeePerGas: BigInt(0),
      maxPriorityFeePerGas: BigInt(0),
      paymasterAndData: "0x",
      signature: dummySignature(),
    };
    const hash = userOpHash(op, this.chainId);
    const id = ethers.hexlify(ethers.randomBytes(16));
    this.sweep();
    this.pending.set(id, { userId: input.userId, op, hash, expiresAt: this.now() + 5 * 60_000 });
    return { id, hash };
  }

  /** The prepared operation, for the caller to verify the passkey assertion against its hash. */
  take(id: string, userId: number): Pending {
    const p = this.pending.get(id);
    this.pending.delete(id);
    if (!p || p.expiresAt < this.now()) throw new Error("This transaction expired. Please try again.");
    if (p.userId !== userId) throw new Error("This transaction belongs to another user");
    // Re-check policy on what will actually run.
    this.checkCalls(decodeCalls(p.op.callData));
    return p;
  }

  async submit(p: Pending, assertion: { authenticatorData: Uint8Array; clientDataJSON: string; signature: Uint8Array }): Promise<{ hash: string; success: boolean }> {
    if (!this.signer) throw new Error("The Base testnet relayer is not configured");
    const op = { ...p.op, signature: encodeWebAuthnSignature(assertion) };
    const day = `${p.userId}:${new Date(this.now()).toISOString().slice(0, 10)}`;
    this.daily.set(day, (this.daily.get(day) ?? 0) + 1);
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
