/**
 * Provider-neutral wallet contract for application features.
 *
 * Authentication/session state is intentionally not part of this interface:
 * a wallet provider proves control of an address and signs chain operations;
 * platform identity remains owned by the BlockFinaX account system.
 */
export type ChainNamespace = "eip155" | "stellar";

export interface ChainAccount {
  chainNamespace: ChainNamespace;
  networkKey: string;
  address: string;
  accountType: "eoa" | "smart_account" | "soroban_contract" | "external";
  provider: string;
}

export interface EvmTransactionRequest {
  kind: "evm_transaction";
  chainId: number;
  to: string;
  data?: string;
  value?: string;
  /** Several calls approved together in one operation (for example approve, then burn). */
  calls?: { to: string; data: string; value: string }[];
}

export interface SorobanTransactionRequest {
  kind: "soroban_transaction";
  networkKey: string;
  transactionXdr: string;
}

export type WalletTransactionRequest = EvmTransactionRequest | SorobanTransactionRequest;

export interface WalletTransactionResult {
  chainNamespace: ChainNamespace;
  networkKey: string;
  transactionHash: string;
}

/** Progress callback while a provider signs and submits (e.g. "Approving token..."). */
export type WalletStep = (message: string) => void;

/**
 * The canonical wallet interface (Architecture v2.0, docs/architecture/v2/wallet-v2.0.md).
 *
 * Rift is one implementation, the Stellar passkey wallet another; MetaMask, WalletConnect
 * or a BlockFinaX smart wallet would be more. Providers handle account access and signing
 * only. They do not own the user's BlockFinaX account, business data or product rules,
 * and the backend prepares every transaction they sign.
 */
export interface WalletProvider {
  readonly id: string;
  /** The chain families this provider signs for. */
  readonly namespaces: ChainNamespace[];
  getAccounts(): Promise<ChainAccount[]>;
  connect(): Promise<ChainAccount[]>;
  disconnect(): Promise<void>;
  sendTransaction(request: WalletTransactionRequest, onStep?: WalletStep): Promise<WalletTransactionResult>;
  signMessage?(account: ChainAccount, message: Uint8Array): Promise<Uint8Array>;
}

/** An unsigned transaction from the API (server/chain/adapter.ts PreparedTransaction). */
export interface PreparedTransaction {
  chain: string;
  family: "evm" | "stellar";
  label: string;
  /** After this step, ask the API for the next one (it can only be prepared once this one is on chain). */
  continues?: boolean;
  payload:
    | { kind: "evm"; chainId: number; to: string; data: string; value: string; calls?: { to: string; data: string; value: string }[] }
    | { kind: "stellar"; networkPassphrase: string; xdr: string };
}

export function toWalletRequest(tx: PreparedTransaction): WalletTransactionRequest {
  return tx.payload.kind === "evm"
    ? { kind: "evm_transaction", chainId: tx.payload.chainId, to: tx.payload.to, data: tx.payload.data, value: tx.payload.value, calls: tx.payload.calls }
    : { kind: "soroban_transaction", networkKey: tx.chain, transactionXdr: tx.payload.xdr };
}
