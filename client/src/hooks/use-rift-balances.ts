import { isWalletSandbox } from "@/lib/wallet-environment";
/**
 * useRiftBalances Hook — Wallet balances via the Rift SDK
 *
 * Fires as soon as a bearer token is available (don't wait for useWallet's
 * async getUser to complete). Caches the last successful result in
 * sessionStorage so the UI shows balances instantly on reload.
 *
 * ## One fetch, however many components ask
 *
 * The state below is module-level on purpose. Five components mount this hook
 * — the home page, the wallet dashboard, the wallet card, the send modal and
 * the transfer sheet — and each used to carry its own thirty-second timer, its
 * own fetch on mount and its own focus listener. The in-flight guard was a ref,
 * so it deduplicated within one component and across none of them.
 *
 * The result was a burst of five identical requests every thirty seconds, five
 * more whenever the tab regained focus, and five on any navigation that
 * remounted them. Rift answered with 429, and because an error response
 * carries no CORS headers the browser reported it as a CORS failure, which
 * points at the wrong thing entirely.
 *
 * Now there is one timer, one focus listener and one request. A second caller
 * arriving while a fetch is open waits on that same promise rather than
 * starting another, and a request within MIN_GAP_MS of the last is answered
 * from what we already have.
 */
import { useState, useEffect, useCallback } from 'react';
import { useWallet } from './use-wallet';
import { getChainBalances, getTokenBalance, isLoggedIn } from '@/lib/rift-client';
import type { Balance, ChainName, TokenSymbol } from '@/lib/rift-client';

const NETWORK_ID_TO_RIFT_CHAIN: Record<number, ChainName> = {
  8453: 'BASE',
  137: 'POLYGON',
  42161: 'ARBITRUM',
  1: 'ETHEREUM',
  56: 'BNB',
};

const CACHE_KEY = isWalletSandbox ? 'bfx_sandbox_balances' : 'bfx_rift_balances';

function loadCached(): Balance[] {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCached(balances: Balance[]) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(balances)); } catch {}
}

// ── Shared across every consumer ─────────────────────────────────────────

const POLL_MS = 30_000;
/** Requests closer together than this are answered from the last result. */
const MIN_GAP_MS = 10_000;

type Snapshot = { balances: Balance[]; isLoading: boolean; error: string | null };

let shared: Snapshot = { balances: loadCached(), isLoading: false, error: null };
let pending: Promise<void> | null = null;
let lastFetchAt = 0;
const listeners = new Set<(s: Snapshot) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let focusBound = false;

function onSharedFocus() {
  if (isLoggedIn()) void refreshShared(true);
}

function publish(next: Partial<Snapshot>) {
  shared = { ...shared, ...next };
  listeners.forEach((l) => l(shared));
}

/**
 * Fetches once, however many callers ask.
 *
 * Concurrent callers get the same promise; a caller arriving within MIN_GAP_MS
 * of the last completed fetch gets nothing new, which is what turns five
 * components mounting at once into a single request.
 */
function refreshShared(silent = false, force = false): Promise<void> {
  if (!isLoggedIn()) {
    saveCached([]);
    publish({ balances: [], error: null });
    return Promise.resolve();
  }
  if (pending) return pending;
  if (!force && Date.now() - lastFetchAt < MIN_GAP_MS) return Promise.resolve();

  if (!silent) publish({ isLoading: true });
  publish({ error: null });

  pending = (async () => {
    try {
      const data = await getChainBalances();
      lastFetchAt = Date.now();
      saveCached(data);
      publish({ balances: data });
    } catch (err: any) {
      // Rift answers a rate limit with 429, and an error response carries no
      // CORS headers — so the browser reports "blocked by CORS policy", which
      // describes the symptom and hides the cause. Say which it was.
      const msg = String(err?.message || 'Failed to load balances');
      const rateLimited = /429|too many/i.test(msg);
      console.error('[useRiftBalances] failed:', rateLimited ? 'rate limited by Rift (429)' : msg);
      publish({ error: rateLimited ? 'Balances are rate limited — retrying shortly.' : msg });
    } finally {
      publish({ isLoading: false });
      pending = null;
    }
  })();

  return pending;
}

export function useRiftBalances(networkId?: number) {
  const { address } = useWallet();
  const [snap, setSnap] = useState<Snapshot>(shared);
  const { balances, isLoading, error } = snap;

  const refreshAll = useCallback(
    // An explicit refresh after a transaction must not be swallowed by the
    // gap, so callers asking out loud bypass it.
    (silent = false) => refreshShared(silent, !silent),
    [],
  );

  useEffect(() => {
    listeners.add(setSnap);
    setSnap(shared);

    // First subscriber starts the shared timer and focus listener; the last
    // one out clears them.
    if (!timer) {
      timer = setInterval(() => {
        if (isLoggedIn()) void refreshShared(true);
      }, POLL_MS);
    }
    if (!focusBound) {
      focusBound = true;
      window.addEventListener('focus', onSharedFocus);
    }

    void refreshShared(shared.balances.length > 0);

    return () => {
      listeners.delete(setSnap);
      if (listeners.size === 0) {
        if (timer) { clearInterval(timer); timer = null; }
        if (focusBound) { window.removeEventListener('focus', onSharedFocus); focusBound = false; }
      }
    };
  }, []);

  // Filter to selected chain
  const selectedChain = networkId ? NETWORK_ID_TO_RIFT_CHAIN[networkId] : null;
  const filtered = selectedChain ? balances.filter(b => b.chain === selectedChain) : balances;

  // Group by chain for display
  const byChain = balances.reduce<Record<string, Balance[]>>((acc, b) => {
    (acc[b.chain] = acc[b.chain] || []).push(b);
    return acc;
  }, {});

  return {
    address,
    balances,
    filtered,
    byChain,
    isLoading,
    error,
    refreshAll: () => refreshAll(false),
  };
}

export async function fetchTokenBalance(token: TokenSymbol, chain?: ChainName): Promise<Balance | null> {
  try {
    const data = await getTokenBalance(token, chain);
    return data?.[0] || null;
  } catch {
    return null;
  }
}
