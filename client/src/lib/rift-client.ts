import { isWalletSandbox, walletRiftKey, walletSdkUrl, assertWalletTransactionsEnabled } from "./wallet-environment";
/**
 * rift-client.ts — Wallet SDK wrapper (auth is handled by @rift-finance/react)
 *
 * The widget (RiftProvider + RiftAuth) owns sign-in/up and the JWT lifecycle.
 * This module keeps the @rift-finance/wallet SDK around purely for typed REST
 * calls (balances, transactions, signer) — the JWT is pushed into the SDK by
 * RiftTokenBridge in rift-token-bridge.tsx.
 *
 * Exports cover everything the rest of the app calls today MINUS the old
 * sendOtp/login/signup/getAuthMethod flow (those now live in the widget).
 */

import Rift, { Environment } from '@rift-finance/wallet';
import type {
  Balance,
  TransactionRequest,
  TransactionHistoryRequest,
  ChainName,
  TokenSymbol,
  User,
} from '@rift-finance/wallet';

const USER_CACHE_KEY = 'bfx_rift_user';            // {user, address, btcAddress}
const AUTH_METHOD_KEY = 'bfx_rift_auth_method';    // {kind, email|phoneNumber|externalId}

/**
 * The browser must use a PUBLISHABLE key (pk_), never a secret one (sk_).
 *
 * Anything Vite sees prefixed VITE_ is inlined into the bundle it ships to
 * every visitor, so a key placed here is public by construction. That is fine
 * for a widget key — Rift's docs are explicit that the project key is meant to
 * be public and the safety property is the origin allowlist — and it is not
 * fine for a server key, which can enumerate and suspend users.
 *
 * Prefers VITE_RIFT_PUBLIC_KEY. The fallback keeps the app running until Rift
 * issues a pk_; the moment they do, this becomes a config change and nothing
 * else needs touching.
 */
const apiKey = walletRiftKey;

// Hosts that answer Rift API calls but send no Access-Control-Allow-Origin for
// http://localhost. In dev these are rewritten through our own server (see
// server/routes/rift-proxy.ts); in production they are called directly.
const CORS_BLOCKED_HOSTS = ['payment.riftfi.xyz', 'api.riftfi.xyz', 'auth.riftfi.xyz'];

/**
 * In development, rewrite a Rift API URL to the same-origin dev proxy.
 * Returns null when the URL should be left alone.
 *
 * Rift only allowlists the deployed origin, so the browser blocks these
 * responses on localhost even though they return 200 — which surfaces as
 * empty balances rather than an error. The proxy sidesteps that: CORS is a
 * browser rule, and a server-to-server request isn't subject to it.
 */
function devProxyUrl(rawUrl: string): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    const u = new URL(rawUrl, window.location.origin);
    if (!CORS_BLOCKED_HOSTS.includes(u.hostname)) return null;
    return `${window.location.origin}/rift-proxy/${u.hostname}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

// ── Kill HTTP cache for Rift API requests ────────────────────────────────
// The SDK doesn't set { cache: 'no-store' } and backend returns 304s that
// browsers cache aggressively. Patch fetch globally (only for Rift hosts).
if (typeof window !== 'undefined' && !(window as any).__riftNoCachePatched) {
  const origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
    if (
      url.includes('rift-sdk-wrapper') ||
      url.includes('rift.fi') ||
      url.includes('rift-finance') ||
      url.includes('riftfi.xyz') ||
      url.includes('widget.blockfinax.com')
    ) {
      const proxied = devProxyUrl(url);
      if (proxied) {
        // Preserve headers/body when the SDK passed a Request object.
        const nextInput: RequestInfo | URL =
          typeof input === 'string' || input instanceof URL ? proxied : new Request(proxied, input);
        return origFetch(nextInput, { ...(init || {}), cache: 'no-store' });
      }
      return origFetch(input, { ...(init || {}), cache: 'no-store' });
    }
    return origFetch(input, init);
  };
  (window as any).__riftNoCachePatched = true;
}

// Singleton Rift wallet client — bearer token is set by RiftTokenBridge.
export const rift = new Rift({
  apiKey,
  environment: isWalletSandbox ? Environment.DEVELOPMENT : Environment.PRODUCTION,
  baseUrl: walletSdkUrl,
});

// ── Identity surface ─────────────────────────────────────────────────────
// Cached after the widget's first successful sign-in. The widget's RiftUser
// only carries uuid + addresses; we need email/phone/externalId for OTP-gated
// spending endpoints, which we get from rift.auth.getUser() once the bearer
// is bridged in.

export type AuthMethod =
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phoneNumber: string }
  | { kind: 'password'; externalId: string };

export function getAuthMethod(): AuthMethod | null {
  try {
    const raw = localStorage.getItem(AUTH_METHOD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuthMethod(m: AuthMethod): void {
  localStorage.setItem(AUTH_METHOD_KEY, JSON.stringify(m));
}

export function clearAuthMethod(): void {
  localStorage.removeItem(AUTH_METHOD_KEY);
}

export function getCachedUserSummary(): { user: string; address: string; btcAddress?: string } | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCachedUserSummary(s: { user: string; address: string; btcAddress?: string }): void {
  localStorage.setItem(USER_CACHE_KEY, JSON.stringify(s));
}

export function clearCachedUserSummary(): void {
  localStorage.removeItem(USER_CACHE_KEY);
}

/**
 * Pull the full user record from Rift (requires the bearer to be set).
 * Returns null if not authenticated or the call fails. Side-effect: derives
 * an AuthMethod from the user's identifiers and persists it so the tx-auth
 * dialog knows what to prompt for.
 */
export async function getMe(): Promise<User | null> {
  // The passkey-wallet build has no Rift account; its session token is not a Rift token.
  if (import.meta.env.VITE_WALLET_PROVIDER !== 'rift') return null;
  if (!rift.isAuthenticated()) return null;
  try {
    const res = await rift.auth.getUser();
    const user = res?.user || null;
    if (user) {
      // Persist a method preference so code-gated tx prompts work.
      //
      // Phone first, then email. An SMS has no spam folder, arrives in
      // seconds, and does not depend on SPF, DKIM or a sending domain's
      // reputation — all of which have to be right for a code sent by email to
      // reach an inbox rather than a junk folder the customer never opens.
      // Email remains the fallback for anyone with no number on file.
      //
      // This matters less than it used to: a wallet migrated to device signing
      // never sees a code at all. It is here for the ones that haven't.
      const u = user as any;
      if (u.phoneNumber) setAuthMethod({ kind: 'phone', phoneNumber: u.phoneNumber });
      else if (u.email) setAuthMethod({ kind: 'email', email: u.email });
      else if (u.externalId) setAuthMethod({ kind: 'password', externalId: u.externalId });
    }
    return user;
  } catch (err) {
    console.error('[rift] getUser failed:', err);
    return null;
  }
}

export function isLoggedIn(): boolean {
  if (import.meta.env.VITE_WALLET_PROVIDER !== 'rift') {
    try { return !!sessionStorage.getItem('bfx:passkey-session'); } catch { return false; }
  }
  return rift.isAuthenticated();
}

// ── Wallet & balances ────────────────────────────────────────────────────

export async function getChainBalances(chain?: ChainName): Promise<Balance[]> {
  if (import.meta.env.VITE_WALLET_PROVIDER !== 'rift') {
    const { passkeyBalances } = await import('./wallets/passkey-wallet');
    const all = (await passkeyBalances()) as Balance[];
    return chain ? all.filter((b) => b.chain === chain) : all;
  }
  if (isWalletSandbox) {
    const address = getCachedUserSummary()?.address;
    if (!address) return [];
    const response = await fetch(`/api/sandbox/balances/${encodeURIComponent(address)}`);
    if (!response.ok) throw new Error('Unable to read testnet balances');
    return (await response.json()).balances;
  }
  const res = await rift.wallet.getChainBalance(chain ? { chain } : undefined);
  return res?.data || [];
}

export async function getTokenBalance(token: TokenSymbol, chain?: ChainName): Promise<Balance[]> {
  if (isWalletSandbox) return (await getChainBalances()).filter(b => b.token === token);
  const res = await rift.wallet.getTokenBalance({ token, chain });
  return res?.data || [];
}

// ── Assets ───────────────────────────────────────────────────────────────

export interface UserToken {
  id: string;
  name: string;
  chain_id: string;
  contract_address?: string | null;
  icon?: string;
}

export async function getUserTokens(): Promise<UserToken[]> {
  if (isWalletSandbox) return [];
  const res = await rift.assets.getUserTokens();
  return (res?.data as UserToken[]) || [];
}

export async function getOwnedBalances(): Promise<Balance[]> {
  const balances = await getChainBalances();
  return balances.filter(b => Number(b.amount) > 0);
}

// ── OTPs (for tx authorization — auth login OTPs live in the widget) ─────

export async function sendOtp(target: { email?: string; phone?: string }) {
  assertWalletTransactionsEnabled();
  if (target.email) return rift.auth.sendOtp({ email: target.email });
  if (target.phone) return rift.auth.sendOtp({ phone: target.phone });
  throw new Error('email or phone required');
}

// ── Transactions ─────────────────────────────────────────────────────────

export async function sendCrypto(req: TransactionRequest) {
  assertWalletTransactionsEnabled();
  return rift.transactions.send(req);
}

export async function getHistory(req?: TransactionHistoryRequest) {
  if (isWalletSandbox) return { transactions: [] };
  return rift.transactions.getHistory(req);
}

// Inbound transfers (USDC received) — separate Rift service backed by The Graph.
// SDK returns `{ deposits: Deposit[] }` (or sometimes the bare array); caller
// should normalize.
export async function getDeposits() {
  if (isWalletSandbox) return { deposits: [] };
  return (rift as any).deposits.getAllDeposits();
}

export async function getFee(req: { recipient: string; amount: string; chain: ChainName; token: TokenSymbol }) {
  assertWalletTransactionsEnabled();
  return rift.transactions.getFee(req as any);
}

// ── Logout — delegates to the widget for the server-side revocation ──────
// Local-only cleanup; the actual session revocation runs in useRift().signOut().
export function clearLocalRiftState() {
  rift.clearBearerToken();
  localStorage.removeItem(USER_CACHE_KEY);
  localStorage.removeItem(AUTH_METHOD_KEY);
}

// ── Arbitrary contract calls ─────────────────────────────────────────────

export interface SignerTxArgs {
  chain: ChainName;
  to: string;
  data?: string;
  value?: string;   // decimal string in wei
}

export interface SignerAuth {
  email?: string;
  phoneNumber?: string;
  externalId?: string;
  otpCode?: string;
  password?: string;
}

/**
 * Submit an arbitrary EVM transaction via the user's Rift smart wallet.
 * Gasless — paymaster-sponsored by Rift. Returns the UserOp hash.
 */
export async function signerSendTransaction(
  args: SignerTxArgs,
  auth: SignerAuth
): Promise<{ hash: string; raw: any }> {
  assertWalletTransactionsEnabled();
  const res = await (rift.signer as any).sendTransaction({
    chain: args.chain,
    transactionData: {
      to: args.to,
      data: args.data || '0x',
      value: args.value || '0',
    },
    ...auth,
  });
  return { hash: (res as any)?.hash || (res as any)?.transactionHash, raw: res };
}

// ── Helpers ──────────────────────────────────────────────────────────────

export const CHAIN_ID_TO_RIFT: Record<number, ChainName> = {
  8453: 'BASE',
  137: 'POLYGON',
  42161: 'ARBITRUM',
  1: 'ETHEREUM',
  56: 'BNB',
  10: 'OPTIMISM',
  43114: 'AVAX',
  42220: 'CELO',
};

export function chainIdToRift(chainId: number): ChainName | null {
  return CHAIN_ID_TO_RIFT[chainId] || null;
}

// Re-export types so app code doesn't need to touch the SDK directly
export type { Balance, TransactionRequest, ChainName, TokenSymbol, User };
