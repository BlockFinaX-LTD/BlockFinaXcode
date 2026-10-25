/**
 * Rift as one WalletProvider among several (Architecture v2.0).
 *
 * Owns Rift's signing path: device signing for migrated wallets, otherwise a one-time
 * credential. hedge-contract.ts sends through this provider too, so the path exists once.
 */
import { assertWalletTransactionsEnabled } from "../wallet-environment";
import type { ChainAccount, WalletProvider, WalletStep, WalletTransactionRequest, WalletTransactionResult } from "../wallet-provider";

/** Registry chain key for an EVM chain id, for the accounts Rift reports. */
const NETWORK_KEYS: Record<number, string> = { 8453: "base", 56: "bsc", 84532: "base-sepolia" };

export class RiftWalletProvider implements WalletProvider {
  readonly id = "rift";
  readonly namespaces = ["eip155" as const];

  async getAccounts(): Promise<ChainAccount[]> {
    const { getCachedUserSummary } = await import("../rift-client");
    const me = getCachedUserSummary();
    if (!me?.address) return [];
    // A Rift smart account has the same address on every EVM chain it supports.
    return Object.values(NETWORK_KEYS).map((networkKey) => ({
      chainNamespace: "eip155" as const, networkKey, address: me.address, accountType: "smart_account" as const, provider: this.id,
    }));
  }

  async connect() {
    return this.getAccounts();
  }

  async disconnect() {
    const { clearLocalRiftState } = await import("../rift-client");
    clearLocalRiftState();
  }

  async sendTransaction(request: WalletTransactionRequest, onStep?: WalletStep): Promise<WalletTransactionResult> {
    if (request.kind !== "evm_transaction") throw new Error("Rift signs EVM transactions only");
    assertWalletTransactionsEnabled();
    const { chainIdToRift, signerSendTransaction } = await import("../rift-client");
    const { requestTxAuth, clearCachedTxAuth } = await import("../tx-auth");
    const chainName = chainIdToRift(request.chainId);
    if (!chainName) throw new Error(`Chain ${request.chainId} is not supported by Rift.`);
    const networkKey = NETWORK_KEYS[request.chainId] ?? String(request.chainId);
    const tx = { chain: chainName, to: request.to, data: request.data ?? "0x", value: request.value ?? "0" };

    // A migrated wallet signs on the device; the proof is bound to this exact operation.
    const { trySignWithV3 } = await import("../v3-sign");
    const v3Hash = await trySignWithV3(tx, { title: "Approve this transaction", onStep });
    if (v3Hash) return { chainNamespace: "eip155", networkKey, transactionHash: v3Hash };

    onStep?.("Authorizing transaction...");
    const auth = await requestTxAuth(
      "Authorize on-chain action",
      "Enter your credential to submit this transaction. The code is valid for 5 minutes.",
    );
    onStep?.("Submitting transaction...");
    try {
      const { hash } = await signerSendTransaction(tx, auth);
      if (!hash) throw new Error("Rift returned no transaction hash");
      return { chainNamespace: "eip155", networkKey, transactionHash: hash };
    } catch (err: any) {
      const msg = String(err?.message || err || "").toLowerCase();
      if (msg.includes("unauthorized") || msg.includes("invalid code") || msg.includes("invalid otp") || msg.includes("invalid password")) {
        clearCachedTxAuth();
      }
      throw err;
    }
  }
}

export const riftWalletProvider = new RiftWalletProvider();
