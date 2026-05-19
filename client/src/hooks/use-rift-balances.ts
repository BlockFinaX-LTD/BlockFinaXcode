/**
 * useRiftBalances Hook — Wallet balances via the Rift SDK
 *
 * Fires as soon as a bearer token is available (don't wait for useWallet's
 * async getUser to complete). Caches the last successful result in
 * sessionStorage so the UI shows balances instantly on reload.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
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

const CACHE_KEY = 'bfx_rift_balances';

function loadCached(): Balance[] {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCached(balances: Balance[]) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(balances)); } catch {}
}

export function useRiftBalances(networkId?: number) {
  const { address } = useWallet();
  // Hydrate from cache immediately so reloads show old data instantly
  const [balances, setBalances] = useState<Balance[]>(() => loadCached());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refreshAll = useCallback(async (silent = false) => {
    // Use rift's own check — bearer token is set synchronously on app boot
    if (!isLoggedIn()) {
      setBalances([]);
      saveCached([]);
      return;
    }
    if (inFlight.current) return; // dedupe concurrent requests
    inFlight.current = true;
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const data = await getChainBalances();
      setBalances(data);
      saveCached(data);
    } catch (err: any) {
      console.error('[useRiftBalances] failed:', err?.message);
      setError(err?.message || 'Failed to load balances');
    } finally {
      setIsLoading(false);
      inFlight.current = false;
    }
  }, []);

  // Initial fetch as soon as the hook mounts (don't wait for useWallet)
  useEffect(() => {
    refreshAll(loadCached().length > 0); // silent if we already have cached data showing
  }, [refreshAll]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      if (isLoggedIn()) refreshAll(true);
    }, 30 * 1000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  // Refresh on focus (when user returns to tab)
  useEffect(() => {
    const onFocus = () => { if (isLoggedIn()) refreshAll(true); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshAll]);

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
