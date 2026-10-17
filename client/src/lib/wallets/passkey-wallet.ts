/**
 * The BlockFinaX passkey wallet in the browser (testnet, VITE_WALLET_PROVIDER=passkey).
 *
 * Users sign in with an email code or Google. Their passkey then owns their smart
 * accounts and approves transactions on every chain (it can also sign them back in):
 *   - Base Sepolia: the server prepares a UserOperation for the user's Coinbase Smart
 *     Wallet; the passkey signs its hash; the BlockFinaX relayer submits and pays gas.
 *   - Stellar: the passkey signs the smart account's authorization entries (Passkey Kit);
 *     the BlockFinaX fee payer submits through /api/v2/transactions/relay.
 * The private key never leaves the device.
 */
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  ChainAccount, WalletProvider, WalletStep, WalletTransactionRequest, WalletTransactionResult,
} from "../wallet-provider";

const TOKEN_KEY = "bfx:passkey-session";

export interface PasskeyAccount {
  chain: string;
  address: string;
  walletProvider: string;
  accountType: string;
  isPrimary: boolean;
}

export interface PasskeySession {
  sessionToken: string;
  user: { id: number; name: string | null; email?: string | null };
  credentialId: string | null;
  accounts: PasskeyAccount[];
}

interface WalletConfig {
  enabled: boolean;
  rpId?: string;
  evm?: { chain: string; chainId: number; name: string } | null;
  stellar?: { chain: string; rpcUrl: string; networkPassphrase: string; walletWasmHash: string } | null;
}

export function storedSessionToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function storeSessionToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable: session lasts for this page only */ }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const token = storedSessionToken();
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? json?.error ?? json?.message ?? "Request failed");
  return json as T;
}

let configPromise: Promise<WalletConfig> | null = null;
export const walletConfig = () => (configPromise ??= api<WalletConfig>("/api/wallet/passkey/config"));

/** Step 1 of email sign-in: send a six-digit code. */
export async function startEmailSignIn(email: string): Promise<string> {
  const { requestId } = await api<{ requestId: string }>("/api/wallet/auth/email/start", { email });
  return requestId;
}

/** Step 2 of email sign-in: check the code and start a session. */
export async function finishEmailSignIn(email: string, requestId: string, code: string): Promise<PasskeySession | null> {
  const { sessionToken } = await api<{ sessionToken: string }>("/api/wallet/auth/email/verify", { email, requestId, code });
  storeSessionToken(sessionToken);
  return currentPasskeySession();
}

/** Google sign-in starts on the server and returns to /auth/google/done#token=... */
export function startGoogleSignIn() {
  window.location.assign("/api/auth/google/start");
}

/** Read the session token Google sign-in left in the URL fragment, then clear it. */
export function acceptGoogleRedirect(): boolean {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token");
  if (!token) return false;
  storeSessionToken(token);
  history.replaceState(null, "", "/auth");
  return true;
}

/** Create the wallet passkey for the signed-in user; this creates their smart accounts. */
export async function createWalletPasskey(): Promise<PasskeySession & { errors?: string[] }> {
  const { flow, options } = await api<{ flow: string; options: any }>("/api/wallet/passkey/register/options", {});
  const response = await startRegistration({ optionsJSON: options });
  const created = await api<{ errors?: string[] }>("/api/wallet/passkey/register/verify", { flow, response });
  const session = await currentPasskeySession();
  if (!session) throw new Error("Your session ended. Sign in again.");
  return { ...session, errors: created.errors };
}

/** Sign in with an existing passkey (the browser offers the user's saved passkeys). */
export async function signInWithPasskey(): Promise<PasskeySession> {
  const { flow, options } = await api<{ flow: string; options: any }>("/api/wallet/passkey/signin/options", {});
  const response = await startAuthentication({ optionsJSON: options });
  const session = await api<PasskeySession>("/api/wallet/passkey/signin/verify", { flow, response });
  storeSessionToken(session.sessionToken);
  return session;
}

export async function currentPasskeySession(): Promise<PasskeySession | null> {
  const token = storedSessionToken();
  if (!token) return null;
  try {
    const me = await api<Omit<PasskeySession, "sessionToken">>("/api/wallet/passkey/me");
    return { ...me, sessionToken: token };
  } catch {
    storeSessionToken(null);
    return null;
  }
}

export async function signOutPasskey() {
  try { await api("/api/auth/logout", {}); } catch { /* the token is dropped either way */ }
  storeSessionToken(null);
}

/** Sign the smart account's authorization entries in a prepared Stellar transaction. */
async function signStellarAuth(transactionXdr: string, credentialId: string, contract: string): Promise<string> {
  const { Buffer } = await import("buffer");
  (globalThis as any).Buffer ??= Buffer;
  const [{ PasskeyKit }, { xdr, Address }] = await Promise.all([import("passkey-kit"), import("@stellar/stellar-sdk")]);
  const cfg = (await walletConfig()).stellar;
  if (!cfg) throw new Error("Stellar is not enabled for this wallet");
  const kit = new PasskeyKit({ rpcUrl: cfg.rpcUrl, networkPassphrase: cfg.networkPassphrase, walletWasmHash: cfg.walletWasmHash });
  await kit.connectWallet({ keyId: credentialId, getContractId: async () => contract });
  if (kit.contractId !== contract) throw new Error("This passkey does not control the expected Stellar account");

  const envelope = xdr.TransactionEnvelope.fromXDR(transactionXdr, "base64");
  const op = envelope.v1().tx().operations()[0];
  const invoke = op.body().invokeHostFunctionOp();
  const signed: InstanceType<typeof xdr.SorobanAuthorizationEntry>[] = [];
  for (const entry of invoke.auth()) {
    // Simulation returns V1 address credentials; PasskeyKit upgrades them to V2
    // (address-bound) before signing, which is the only form the relay accepts.
    const creds = entry.credentials();
    const kind = creds.switch().name;
    const address = kind === "sorobanCredentialsAddressV2" ? creds.addressV2().address()
      : kind === "sorobanCredentialsAddress" ? creds.address().address() : null;
    const ours = address !== null && Address.fromScAddress(address).toString() === contract;
    signed.push(ours ? await kit.signAuthEntry(entry) : entry);
  }
  invoke.auth(signed);
  return envelope.toXDR("base64");
}

export class PasskeyWalletProvider implements WalletProvider {
  readonly id = "blockfinax-passkey";
  readonly namespaces = ["eip155" as const, "stellar" as const];

  async getAccounts(): Promise<ChainAccount[]> {
    const session = await currentPasskeySession();
    const cfg = await walletConfig();
    return (session?.accounts ?? []).map((a) => ({
      chainNamespace: a.chain === cfg.stellar?.chain ? ("stellar" as const) : ("eip155" as const),
      networkKey: a.chain,
      address: a.address,
      accountType: a.accountType === "soroban_contract" ? ("soroban_contract" as const) : ("smart_account" as const),
      provider: this.id,
    }));
  }

  async connect() {
    return this.getAccounts();
  }

  async disconnect() {
    await signOutPasskey();
  }

  async sendTransaction(request: WalletTransactionRequest, onStep?: WalletStep): Promise<WalletTransactionResult> {
    if (request.kind === "evm_transaction") {
      onStep?.("Preparing transaction...");
      const prepared = await api<{ id: string; options: any }>("/api/wallet/evm/prepare", {
        calls: [{ to: request.to, data: request.data ?? "0x", value: request.value ?? "0" }],
      });
      onStep?.("Approve with your passkey...");
      const response = await startAuthentication({ optionsJSON: prepared.options });
      onStep?.("Submitting transaction...");
      const result = await api<{ chain: string; hash: string; state: string }>("/api/wallet/evm/submit", { id: prepared.id, response });
      if (result.state !== "CONFIRMED") throw new Error(`The transaction reverted on chain: ${result.hash}`);
      return { chainNamespace: "eip155", networkKey: result.chain, transactionHash: result.hash };
    }
    const session = await currentPasskeySession();
    const account = session?.accounts.find((a) => a.chain === request.networkKey);
    if (!session?.credentialId || !account) throw new Error("No Stellar account for this wallet");
    onStep?.("Approve with your passkey...");
    const signedXdr = await signStellarAuth(request.transactionXdr, session.credentialId, account.address);
    onStep?.("Submitting transaction...");
    const status = await api<{ hash: string }>("/api/v2/transactions/relay", { chain: request.networkKey, xdr: signedXdr });
    return { chainNamespace: "stellar", networkKey: request.networkKey, transactionHash: status.hash };
  }
}

export const passkeyWalletProvider = new PasskeyWalletProvider();

/** Network keys in the shape the wallet screens use ("stellar-testnet" -> "STELLAR_TESTNET"). */
export const toScreenChain = (key: string) => key.toUpperCase().replace(/-/g, "_");
export const fromScreenChain = (name: string) => name.toLowerCase().replace(/_/g, "-");

/** Balances on every chain the user has an account on, in the screens' Balance shape. */
export async function passkeyBalances() {
  const [{ balances }, { chains }] = await Promise.all([
    api<{ balances: { chain: string; symbol: string; amount: string | null }[] }>("/api/v2/balances"),
    api<{ chains: { key: string; name: string }[] }>("/api/v2/chains"),
  ]);
  const names = new Map(chains.map((c) => [c.key, c.name]));
  return balances.map((b) => ({
    chain: toScreenChain(b.chain),
    chainName: names.get(b.chain) ?? b.chain,
    token: b.symbol,
    amount: Number(b.amount ?? 0),
  }));
}

/** Prepare and send a transfer with the passkey; returns the transaction hash. */
export async function passkeySend(input: { chain: string; symbol: string; to: string; amount: string }, onStep?: (m: string) => void) {
  const { toWalletRequest } = await import("../wallet-provider");
  const chain = fromScreenChain(input.chain);
  const { transactions } = await api<{ transactions: import("../wallet-provider").PreparedTransaction[] }>("/api/v2/transfers/prepare", { ...input, chain });
  let hash = "";
  for (const tx of transactions) hash = (await passkeyWalletProvider.sendTransaction(toWalletRequest(tx), onStep)).transactionHash;
  return hash;
}
