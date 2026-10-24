/**
 * The Stellar passkey smart account as a WalletProvider (Architecture v2.0).
 *
 * The passkey signs the authorization for one contract call; the BlockFinaX backend
 * inspects it and pays the fee (POST /api/v2/transactions/relay). The passkey library is
 * passed in, so this provider does not tie the product to one passkey SDK.
 */
import type { ChainAccount, WalletProvider, WalletStep, WalletTransactionRequest, WalletTransactionResult } from "../wallet-provider";

export interface PasskeySigner {
  /** Sign the smart account's authorization entries in a prepared transaction; returns the signed XDR. */
  signAuth(transactionXdr: string, networkKey: string): Promise<string>;
}

export class StellarPasskeyWalletProvider implements WalletProvider {
  readonly id = "stellar-passkey";
  readonly namespaces = ["stellar" as const];

  constructor(
    private readonly signer: PasskeySigner,
    private readonly api: (path: string, body?: unknown) => Promise<any>,
  ) {}

  async getAccounts(): Promise<ChainAccount[]> {
    const { accounts } = await this.api("/api/v2/accounts");
    return (accounts as { chain: string; address: string; walletProvider: string }[])
      .filter((a) => a.walletProvider === this.id)
      .map((a) => ({ chainNamespace: "stellar" as const, networkKey: a.chain, address: a.address, accountType: "soroban_contract" as const, provider: this.id }));
  }

  async connect() {
    return this.getAccounts();
  }

  async disconnect() {}

  async sendTransaction(request: WalletTransactionRequest, onStep?: WalletStep): Promise<WalletTransactionResult> {
    if (request.kind !== "soroban_transaction") throw new Error("This wallet signs Stellar transactions only");
    onStep?.("Confirm with your passkey...");
    const signed = await this.signer.signAuth(request.transactionXdr, request.networkKey);
    onStep?.("Submitting transaction...");
    const status = await this.api("/api/v2/transactions/relay", { chain: request.networkKey, xdr: signed });
    return { chainNamespace: "stellar", networkKey: request.networkKey, transactionHash: status.hash };
  }
}
