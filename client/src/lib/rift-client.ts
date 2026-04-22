/**
 * rift-client.ts — Client-side Rift Finance SDK wrapper
 *
 * Uses @rift-finance/wallet directly in the browser. The SDK handles:
 *   - Signup, login (3 methods: email+OTP, phone+OTP, externalId+password)
 *   - Bearer token storage internally after login
 *   - Wallet balances across chains
 *   - Gasless transactions
 *
 * The SDK persists the bearer token in memory only — we re-hydrate by
 * storing the access token in localStorage and calling setBearerToken on init.
 */

import Rift, { Environment } from '@rift-finance/wallet';
import type {
  LoginRequest,
  SignupRequest,
  Balance,
  TransactionRequest,
  TransactionHistoryRequest,
  ChainName,
  TokenSymbol,
  User,
} from '@rift-finance/wallet';

const ACCESS_TOKEN_KEY = 'bfx_rift_token';
const USER_CACHE_KEY = 'bfx_rift_user';
const AUTH_METHOD_KEY = 'bfx_rift_auth_method'; // tells the send modal what to prompt for

const apiKey = (import.meta.env.VITE_RIFT_API_KEY || '').trim();

// ── Kill HTTP cache for Rift API requests ────────────────────────────────
// The SDK doesn't set { cache: 'no-store' } and backend returns 304s that
// browsers cache aggressively. Patch fetch globally (only for Rift hosts)
// so every SDK call gets fresh data.
if (typeof window !== 'undefined' && !(window as any).__riftNoCachePatched) {
  const origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
    if (url.includes('rift-sdk-wrapper') || url.includes('rift.fi') || url.includes('rift-finance')) {
      return origFetch(input, { ...(init || {}), cache: 'no-store' });
    }
    return origFetch(input, init);
  };
  (window as any).__riftNoCachePatched = true;
}

// Singleton Rift client — created once, re-used across the app.
export const rift = new Rift({
  apiKey,
  environment: Environment.PRODUCTION,
});

// Restore bearer token from localStorage on app boot
const storedToken = localStorage.getItem(ACCESS_TOKEN_KEY);
if (storedToken) {
  rift.setBearerToken(storedToken);
}

// ── Auth ──────────────────────────────────────────────────────────────────

export async function signup(req: SignupRequest) {
  return rift.auth.signup(req);
}

export async function sendOtp(target: { email?: string; phone?: string }) {
  if (target.email) return rift.auth.sendOtp({ email: target.email });
  if (target.phone) return rift.auth.sendOtp({ phone: target.phone });
  throw new Error('email or phone required');
}

export async function login(req: LoginRequest) {
  const res = await rift.auth.login(req);
  if (res?.accessToken) {
    rift.setBearerToken(res.accessToken);
    localStorage.setItem(ACCESS_TOKEN_KEY, res.accessToken);
  }
  if (res?.user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify({
    user: res.user,
    address: res.address,
    btcAddress: res.btcAddress,
  }));

  // Store the auth method + identifier so the send-modal knows what to re-prompt for.
  // We never store passwords or OTP codes.
  const r: any = req;
  if (r.email) {
    localStorage.setItem(AUTH_METHOD_KEY, JSON.stringify({ kind: 'email', email: r.email }));
  } else if (r.phoneNumber) {
    localStorage.setItem(AUTH_METHOD_KEY, JSON.stringify({ kind: 'phone', phoneNumber: r.phoneNumber }));
  } else if (r.externalId) {
    localStorage.setItem(AUTH_METHOD_KEY, JSON.stringify({ kind: 'password', externalId: r.externalId }));
  }
  return res;
}

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

export async function logout() {
  rift.clearBearerToken();
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(USER_CACHE_KEY);
  localStorage.removeItem(AUTH_METHOD_KEY);
  // Clear any cached tx-auth credential
  const { clearCachedTxAuth } = await import('./tx-auth');
  clearCachedTxAuth();
}

export async function getMe(): Promise<User | null> {
  if (!rift.isAuthenticated()) return null;
  try {
    const res = await rift.auth.getUser();
    return res?.user || null;
  } catch (err) {
    console.error('[rift] getUser failed:', err);
    return null;
  }
}

export function isLoggedIn(): boolean {
  return rift.isAuthenticated();
}

export function getCachedUserSummary(): { user: string; address: string; btcAddress?: string } | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── Wallet & balances ────────────────────────────────────────────────────

export async function getChainBalances(chain?: ChainName): Promise<Balance[]> {
  const res = await rift.wallet.getChainBalance(chain ? { chain } : undefined);
  return res?.data || [];
}

export async function getTokenBalance(token: TokenSymbol, chain?: ChainName): Promise<Balance[]> {
  const res = await rift.wallet.getTokenBalance({ token, chain });
  return res?.data || [];
}

// ── Assets — returns ONLY tokens the user actually owns ──────────────────

export interface UserToken {
  id: string;           // e.g. "ETHEREUM-USDC"
  name: string;
  chain_id: string;
  contract_address?: string | null;
  icon?: string;
}

export async function getUserTokens(): Promise<UserToken[]> {
  const res = await rift.assets.getUserTokens();
  return (res?.data as UserToken[]) || [];
}

/**
 * Convenience: returns only balances where amount > 0.
 * Filters out zero-balance chains from getChainBalance.
 */
export async function getOwnedBalances(): Promise<Balance[]> {
  const balances = await getChainBalances();
  return balances.filter(b => Number(b.amount) > 0);
}

// ── Transactions ─────────────────────────────────────────────────────────

export async function sendCrypto(req: TransactionRequest) {
  return rift.transactions.send(req);
}

export async function getHistory(req?: TransactionHistoryRequest) {
  return rift.transactions.getHistory(req);
}

export async function getFee(req: { recipient: string; amount: string; chain: ChainName; token: TokenSymbol }) {
  return rift.transactions.getFee(req as any);
}

// ── Arbitrary contract calls (via rift.signer.sendTransaction) ────────────

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
 * Gasless — paymaster-sponsored by Rift. Returns the on-chain tx hash.
 */
export async function signerSendTransaction(
  args: SignerTxArgs,
  auth: SignerAuth
): Promise<{ hash: string; raw: any }> {
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

/** Map our app's network IDs (chain IDs) → Rift ChainName. */
export const CHAIN_ID_TO_RIFT: Record<number, ChainName> = {
  8453: 'BASE',
  137: 'POLYGON',
  42161: 'ARBITRUM',
  1: 'ETHEREUM',
  1135: 'LISK',
  56: 'BNB',
  10: 'OPTIMISM',
  43114: 'AVAX',
  42220: 'CELO',
};

export function chainIdToRift(chainId: number): ChainName | null {
  return CHAIN_ID_TO_RIFT[chainId] || null;
}

// Re-export types so app code doesn't need to touch the SDK directly
export type { LoginRequest, SignupRequest, Balance, TransactionRequest, ChainName, TokenSymbol, User };
