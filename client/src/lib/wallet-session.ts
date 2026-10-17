/**
 * One wallet session for one BlockFinaX user (Architecture v2.0).
 *
 * Holds the user's accounts on every network, whichever providers created them, and the
 * network the user is currently looking at. Switching network never logs anyone out,
 * creates a profile or drops application state: it only changes which account is active.
 *
 * Sending runs every chain through the same lifecycle:
 *   PREPARED -> AWAITING_SIGNATURE -> SUBMITTED -> CONFIRMED | FAILED
 * so the transaction UX is written once.
 */
import {
  toWalletRequest,
  type ChainAccount,
  type ChainNamespace,
  type PreparedTransaction,
  type WalletProvider,
} from "./wallet-provider";

export type TransactionState = "PREPARED" | "AWAITING_SIGNATURE" | "SUBMITTED" | "CONFIRMED" | "FAILED";

export interface TransactionProgress {
  index: number;
  label: string;
  state: TransactionState;
  hash?: string;
  /** Shared ApplicationError code when the API or provider reports one. */
  error?: string;
  message?: string;
}

/** Resolves a submitted hash to CONFIRMED or FAILED, e.g. GET /api/v2/transactions/:chain/:hash. */
export type ConfirmationWatcher = (chain: string, hash: string) => Promise<"CONFIRMED" | "FAILED">;

export class WalletSession {
  private accounts: ChainAccount[] = [];
  private active: string | null = null;

  constructor(
    readonly userId: string,
    private readonly providers: WalletProvider[],
    private readonly watch: ConfirmationWatcher,
  ) {}

  /** Load accounts from every provider. Safe to call again after a provider links a new one. */
  async refresh(): Promise<ChainAccount[]> {
    const all = await Promise.all(this.providers.map((p) => p.getAccounts().catch(() => [])));
    this.accounts = all.flat();
    if (!this.active && this.accounts.length) this.active = this.accounts[0].networkKey;
    return this.accounts;
  }

  allAccounts(): ChainAccount[] {
    return [...this.accounts];
  }

  get activeNetwork(): string | null {
    return this.active;
  }

  activeAccount(): ChainAccount | undefined {
    return this.accounts.find((a) => a.networkKey === this.active);
  }

  accountOn(network: string): ChainAccount | undefined {
    return this.accounts.find((a) => a.networkKey === network);
  }

  /** Change the network in view. The user, session and other accounts stay as they are. */
  switchNetwork(network: string): ChainAccount {
    const account = this.accountOn(network);
    if (!account) throw new Error(`No account on ${network} yet`);
    this.active = network;
    return account;
  }

  private providerFor(namespace: ChainNamespace): WalletProvider {
    const p = this.providers.find((x) => x.namespaces.includes(namespace));
    if (!p) throw new Error(`No wallet provider for ${namespace}`);
    return p;
  }

  /**
   * Sign and send prepared transactions in order, reporting each through the shared
   * lifecycle. Stops at the first failure; later steps stay PREPARED.
   */
  async send(txs: PreparedTransaction[], onProgress: (p: TransactionProgress[]) => void): Promise<TransactionProgress[]> {
    const progress: TransactionProgress[] = txs.map((t, index) => ({ index, label: t.label, state: "PREPARED" }));
    const emit = () => onProgress(progress.map((p) => ({ ...p })));
    emit();
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const p = progress[i];
      try {
        p.state = "AWAITING_SIGNATURE";
        emit();
        const provider = this.providerFor(tx.family === "evm" ? "eip155" : "stellar");
        const result = await provider.sendTransaction(toWalletRequest(tx), (message) => { p.message = message; emit(); });
        p.state = "SUBMITTED";
        p.hash = result.transactionHash;
        emit();
        p.state = await this.watch(tx.chain, result.transactionHash);
        emit();
        if (p.state === "FAILED") break;
      } catch (err) {
        p.state = "FAILED";
        p.error = (err as { code?: string })?.code ?? (/reject|cancel|NotAllowed/i.test(String((err as Error)?.message)) ? "TRANSACTION_REJECTED" : "UNKNOWN");
        p.message = (err as Error)?.message;
        emit();
        break;
      }
    }
    return progress;
  }
}
