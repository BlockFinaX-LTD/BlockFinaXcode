/**
 * Circle CCTP V2, wired to real networks (the CctpPort behind CctpProvider).
 *
 *   Funding, EVM -> Stellar
 *     1. The user's smart account approves USDC and calls TokenMessengerV2.depositForBurnWithHook
 *        in one sponsored operation. mintRecipient and destinationCaller are Circle's
 *        CctpForwarder on Stellar; the hook names the user's Stellar wallet.
 *     2. Circle attests the burn (Iris).
 *     3. BlockFinaX calls CctpForwarder.mint_and_forward(message, attestation) on Stellar,
 *        paying the fee itself. The forwarder mints and sends the USDC to the user's wallet
 *        in the same invocation.
 *
 *   Withdrawal, Stellar -> EVM
 *     1. The user's Stellar wallet calls TokenMessengerMinter.deposit_for_burn_with_hook with
 *        Circle's Forwarding Service hook, so Circle submits the mint on the EVM chain.
 *     2. Delivery is confirmed when MessageTransmitterV2.usedNonces(nonce) is set.
 *
 * Amounts in CCTP messages are six-decimal. Stellar USDC has seven: a mint multiplies by
 * ten, and a burn ignores the seventh decimal, so withdrawals are rounded down to it.
 */
import { ethers } from "ethers";
import { StrKey, rpc } from "@stellar/stellar-sdk";
import type { ChainConfig, ChainRegistry } from "@shared/chains/registry";
import { ApplicationError } from "@shared/domain/types";
import { fromUnits, toUnits } from "@shared/domain/pool-economics";
import type { PreparedTransaction } from "../chain/adapter";
import type { AdapterRegistry } from "../chain";
import type { CctpPort } from "./providers";
import type { RouteRecord, RouteRequest } from "./types";

/** Fast Transfer: attested at "confirmed" rather than final, for a small Circle fee. */
const FAST = 1000;
/** `cctp-forward`, version 0, no extra data: ask Circle to submit the destination mint. */
const FORWARD_HOOK = "0x636374702d666f72776172640000000000000000000000000000000000000000";
const ZERO32 = new Uint8Array(32);

const erc20 = new ethers.Interface(["function approve(address,uint256)"]);
const tokenMessenger = new ethers.Interface([
  "function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)",
]);
const messageTransmitter = new ethers.Interface(["function usedNonces(bytes32) view returns (uint256)"]);

export interface IrisMessage {
  status: string;
  message: string;
  attestation: string;
  eventNonce: string;
  /** Set when Circle's Forwarding Service has submitted the destination mint. */
  forwardState?: string;
  destinationMintTxHash?: string;
}

export interface CctpEstimate {
  /** Most Circle may charge, in the source asset's units, as a decimal string. */
  maxFee: string;
  seconds: number;
}

/** Hook data that tells Stellar's CctpForwarder where to send the minted USDC. */
export function stellarForwardHook(recipient: string): string {
  const r = ethers.toUtf8Bytes(recipient);
  const head = new Uint8Array(32);
  new DataView(head.buffer).setUint32(24, 0);
  new DataView(head.buffer).setUint32(28, r.length);
  return ethers.hexlify(ethers.concat([head, r]));
}

/** A Stellar contract id (C...) as the 32 bytes CCTP carries. */
export function stellarContractBytes32(id: string): string {
  return ethers.hexlify(StrKey.decodeContract(id));
}

/** An EVM address left-padded to 32 bytes. */
export function evmAddressBytes32(address: string): Uint8Array {
  return ethers.getBytes(ethers.zeroPadValue(ethers.getAddress(address), 32));
}

/** Withdrawals: CCTP burns six decimals, so drop anything below them. */
export function roundToCctpUnits(amount: string, decimals: number): bigint {
  const units = toUnits(amount, decimals);
  const step = BigInt(10 ** Math.max(decimals - 6, 0));
  return (units / step) * step;
}

export class CircleCctpPort implements CctpPort {
  constructor(
    private readonly chains: ChainRegistry,
    private readonly adapters: AdapterRegistry,
    private readonly irisUrl: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  private cctp(chain: ChainConfig) {
    if (!chain.cctp) throw new ApplicationError("NO_ROUTE", `${chain.name} has no CCTP configuration`);
    return chain.cctp;
  }

  private usdc(chain: ChainConfig) {
    const a = chain.assets.USDC;
    if (!a) throw new ApplicationError("NO_ROUTE", `No USDC on ${chain.name}`);
    return a;
  }

  private async fees(src: number, dst: number, forward: boolean): Promise<{ bps: number; forwardFee: bigint }> {
    const r = await this.http(`${this.irisUrl}/v2/burn/USDC/fees/${src}/${dst}${forward ? "?forward=true" : ""}`);
    if (!r.ok) throw new ApplicationError("NO_ROUTE", `Circle has no CCTP route from domain ${src} to ${dst}`);
    const rows = (await r.json()) as { finalityThreshold: number; minimumFee: number; forwardFee?: { high?: number } }[];
    const fast = rows.find((x) => x.finalityThreshold === FAST) ?? rows[0];
    return { bps: Number(fast?.minimumFee ?? 0), forwardFee: BigInt(Math.ceil(fast?.forwardFee?.high ?? 0)) };
  }

  /** The most Circle may take, as six-decimal USDC units, for this amount and direction. */
  private async maxFee6(req: RouteRequest): Promise<bigint> {
    const src = this.chains.get(req.sourceChain);
    const dst = this.chains.get(req.destinationChain);
    const forward = dst.family === "evm";
    const { bps, forwardFee } = await this.fees(this.cctp(src).domain, this.cctp(dst).domain, forward);
    const amount6 = toUnits(req.amount, 6);
    // Fast fee, rounded up, with a 20% margin: maxFee is a ceiling, Circle charges the actual fee.
    const fast = (amount6 * BigInt(Math.round(bps * 100)) + BigInt(999_999)) / BigInt(1_000_000);
    return (fast * BigInt(12)) / BigInt(10) + forwardFee + BigInt(1);
  }

  async estimate(req: RouteRequest): Promise<CctpEstimate> {
    const fee6 = await this.maxFee6(req);
    if (fee6 >= toUnits(req.amount, 6)) throw new ApplicationError("INVALID_REQUEST", "The amount is too small to cover the transfer fee");
    const dst = this.chains.get(req.destinationChain);
    return { maxFee: fromUnits(fee6, 6), seconds: dst.family === "stellar" ? 60 : 120 };
  }

  async prepareBurn(req: RouteRequest, sourceDomain: number, destinationDomain: number): Promise<PreparedTransaction[]> {
    const src = this.chains.get(req.sourceChain);
    const dst = this.chains.get(req.destinationChain);
    const fee6 = await this.maxFee6(req);

    if (src.family === "evm" && dst.family === "stellar") {
      const token = this.usdc(src);
      const amount = toUnits(req.amount, token.decimals);
      const forwarder = this.cctp(dst).forwarder;
      if (!forwarder) throw new ApplicationError("NO_ROUTE", `${dst.name} has no CCTP forwarder configured`);
      if (!StrKey.isValidContract(req.recipient) && !StrKey.isValidEd25519PublicKey(req.recipient)) {
        throw new ApplicationError("INVALID_REQUEST", "The Stellar recipient is not a valid address");
      }
      const forwarder32 = stellarContractBytes32(forwarder);
      const messenger = this.cctp(src).tokenMessenger;
      const approve = erc20.encodeFunctionData("approve", [messenger, amount]);
      const burn = tokenMessenger.encodeFunctionData("depositForBurnWithHook", [
        amount, destinationDomain, forwarder32, token.addressOrContract, forwarder32, fee6, FAST, stellarForwardHook(req.recipient),
      ]);
      return [{
        chain: src.key, family: "evm", label: `Move ${req.amount} USDC to ${dst.name}`,
        payload: {
          kind: "evm", chainId: Number(src.networkId), to: messenger, data: burn, value: "0",
          calls: [{ to: token.addressOrContract, data: approve, value: "0" }, { to: messenger, data: burn, value: "0" }],
        },
      }];
    }

    if (src.family === "stellar" && dst.family === "evm") {
      const token = this.usdc(src);
      const amount = roundToCctpUnits(req.amount, token.decimals);
      if (amount <= BigInt(0)) throw new ApplicationError("INVALID_REQUEST", "Enter an amount above zero");
      if (!ethers.isAddress(req.recipient)) throw new ApplicationError("INVALID_REQUEST", "Enter a valid 0x address");
      const scale = BigInt(10 ** Math.max(token.decimals - 6, 0));
      const adapter = this.adapters.adapterFor(src.key) as unknown as {
        prepareContractCall(contract: string, label: string, method: string, args: Record<string, unknown>): Promise<PreparedTransaction[]>;
        prepareTokenApprove(owner: string, spender: string, units: bigint, label: string): Promise<PreparedTransaction[]>;
        tokenAllowance(from: string, spender: string): Promise<bigint>;
      };
      const messenger = this.cctp(src).tokenMessenger;
      // The messenger pulls the USDC with transfer_from, so the wallet first allows it. A
      // Soroban transaction holds one call, so that is its own step; the burn is prepared after.
      if ((await adapter.tokenAllowance(req.sender, messenger)) < amount) {
        const [approve] = await adapter.prepareTokenApprove(req.sender, messenger, amount, `Allow the transfer of ${req.amount} USDC`);
        return [{ ...approve, continues: true }];
      }
      return adapter.prepareContractCall(messenger, `Move ${req.amount} USDC to ${dst.name}`, "deposit_for_burn_with_hook", {
        caller: req.sender,
        amount,
        destination_domain: destinationDomain,
        mint_recipient: Buffer.from(evmAddressBytes32(req.recipient)),
        burn_token: token.addressOrContract,
        destination_caller: Buffer.from(ZERO32),
        max_fee: fee6 * scale,
        min_finality_threshold: FAST,
        hook_data: Buffer.from(ethers.getBytes(FORWARD_HOOK)),
      });
    }

    throw new ApplicationError("NO_ROUTE", `CCTP does not route ${src.name} to ${dst.name} here`);
  }

  /** Circle's attested message for a burn, or null while it is not indexed yet. */
  async message(sourceDomain: number, txHash: string): Promise<IrisMessage | null> {
    const r = await this.http(`${this.irisUrl}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(txHash)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Circle attestation service returned ${r.status}`);
    const body = (await r.json()) as { messages?: IrisMessage[] };
    return body.messages?.[0] ?? null;
  }

  private async sourceFailed(chain: ChainConfig, hash: string): Promise<boolean> {
    try {
      if (chain.family === "evm") {
        const receipt = await new ethers.JsonRpcProvider(chain.rpcUrls[0]).getTransactionReceipt(hash);
        return receipt !== null && receipt.status === 0;
      }
      const tx = await new rpc.Server(chain.rpcUrls[0]).getTransaction(hash);
      return tx.status === rpc.Api.GetTransactionStatus.FAILED;
    } catch {
      return false;
    }
  }

  /** Mint on Stellar through the forwarder. Already minted counts as done. */
  private async mintOnStellar(route: RouteRecord, msg: IrisMessage): Promise<boolean> {
    const dst = this.chains.get(route.request.destinationChain);
    const cctp = this.cctp(dst);
    const adapter = this.adapters.adapterFor(dst.key) as unknown as {
      invokeAsPlatform(contract: string, method: string, args: Record<string, unknown>): Promise<string>;
    };
    try {
      route.destinationTxHash = await adapter.invokeAsPlatform(cctp.forwarder!, "mint_and_forward", {
        message: Buffer.from(ethers.getBytes(msg.message)),
        attestation: Buffer.from(ethers.getBytes(msg.attestation)),
      });
      return true;
    } catch (err) {
      if (await this.nonceUsedOnStellar(dst, msg.eventNonce)) return true;
      route.lastError = (err as Error).message?.slice(0, 300);
      return false;
    }
  }

  private async nonceUsedOnStellar(chain: ChainConfig, nonce: string): Promise<boolean> {
    try {
      const { contract } = await import("@stellar/stellar-sdk");
      const c: any = await contract.Client.from({ contractId: this.cctp(chain).messageTransmitter, rpcUrl: chain.rpcUrls[0], networkPassphrase: chain.networkId });
      const tx = await c.is_nonce_used({ nonce: Buffer.from(ethers.getBytes(nonce)) });
      return Boolean(tx.result);
    } catch {
      return false;
    }
  }

  private async nonceUsedOnEvm(chain: ChainConfig, nonce: string): Promise<boolean> {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrls[0]);
    const data = messageTransmitter.encodeFunctionData("usedNonces", [nonce]);
    const [used] = messageTransmitter.decodeFunctionResult("usedNonces", await provider.call({ to: this.cctp(chain).messageTransmitter, data }));
    return BigInt(used) !== BigInt(0);
  }

  async status(route: RouteRecord): Promise<"burn_pending" | "attesting" | "minted" | "failed"> {
    if (!route.sourceTxHash) return "burn_pending";
    const src = this.chains.get(route.request.sourceChain);
    const dst = this.chains.get(route.request.destinationChain);
    const msg = await this.message(this.cctp(src).domain, route.sourceTxHash);
    if (!msg) return (await this.sourceFailed(src, route.sourceTxHash)) ? "failed" : "burn_pending";
    route.cctpNonce = msg.eventNonce;
    if (msg.status !== "complete" || !msg.attestation || msg.attestation === "PENDING") return "attesting";
    if (dst.family === "stellar") return (await this.mintOnStellar(route, msg)) ? "minted" : "attesting";
    if (msg.destinationMintTxHash) route.destinationTxHash = msg.destinationMintTxHash;
    return (await this.nonceUsedOnEvm(dst, msg.eventNonce)) ? "minted" : "attesting";
  }

  async retryMint(route: RouteRecord): Promise<boolean> {
    if (!route.sourceTxHash) return false;
    const dst = this.chains.get(route.request.destinationChain);
    if (dst.family !== "stellar") return false;
    const msg = await this.message(this.cctp(this.chains.get(route.request.sourceChain)).domain, route.sourceTxHash);
    return Boolean(msg && msg.status === "complete" && (await this.mintOnStellar(route, msg)));
  }
}
