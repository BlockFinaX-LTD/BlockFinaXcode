/**
 * useWallet Hook — Rift Finance wallet state management
 *
 * Wallets are managed by Rift Finance. After login, smart wallets are
 * auto-deployed across Base, Polygon, Arbitrum, Lisk, BNB, etc.
 * No private keys, no PINs, no seed phrases on this device.
 */
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getMe as riftGetMe, logout as riftLogout, isLoggedIn, getCachedUserSummary } from '@/lib/rift-client';
import { walletManager } from '@/lib/wallet';

export interface WalletState {
  isUnlocked: boolean;
  wallet: { address: string; name: string } | null;
  address: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface WalletSettings {
  selectedNetworkId: number;
  theme: 'light' | 'dark';
  currency: 'USD' | 'EUR' | 'GBP' | 'NGN' | 'GHS' | 'KES' | 'ZAR';
  autoLock: boolean;
  autoLockTimeout: number;
}

const DEFAULT_SETTINGS: WalletSettings = {
  selectedNetworkId: 8453, // Base
  theme: 'dark',
  currency: 'USD',
  autoLock: true,
  autoLockTimeout: 30,
};

function loadSettings(): WalletSettings {
  try {
    const raw = localStorage.getItem('wallet_settings');
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}

function saveSettings(s: WalletSettings) {
  localStorage.setItem('wallet_settings', JSON.stringify(s));
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    isUnlocked: false,
    wallet: null,
    address: null,
    isLoading: true,
    error: null,
  });

  const [settings, setSettings] = useState<WalletSettings>(loadSettings());
  const { toast } = useToast();

  // ── Check status on mount ──────────────────────────────────────────────
  const checkWalletStatus = useCallback(async () => {
    if (!isLoggedIn()) {
      setState({ isUnlocked: false, wallet: null, address: null, isLoading: false, error: null });
      return;
    }

    // Use cached snapshot first for instant render
    const cached = getCachedUserSummary();
    if (cached?.address) {
      walletManager.setAddress(cached.address);
      setState({
        isUnlocked: true,
        wallet: { address: cached.address, name: cached.user || 'My Wallet' },
        address: cached.address,
        isLoading: false,
        error: null,
      });
    }

    try {
      const user = await riftGetMe();
      const address = user?.address || cached?.address || null;
      const name = user?.displayName || user?.externalId || cached?.user || 'My Wallet';
      walletManager.setAddress(address);
      setState({
        isUnlocked: true,
        wallet: address ? { address, name } : null,
        address,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      console.warn('[useWallet] Failed to fetch user, clearing session:', err?.message);
      await riftLogout();
      setState({ isUnlocked: false, wallet: null, address: null, isLoading: false, error: null });
    }
  }, []);

  useEffect(() => { checkWalletStatus(); }, [checkWalletStatus]);

  // ── Auto-lock timer ────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings.autoLock || !state.isUnlocked) return;
    const timeout = setTimeout(() => {
      lockWallet();
      toast({ title: 'Wallet Locked', description: 'Auto-locked for security.' });
    }, settings.autoLockTimeout * 60 * 1000);
    return () => clearTimeout(timeout);
  }, [state.isUnlocked, settings.autoLock, settings.autoLockTimeout]);

  // ── Lock (logout) ──────────────────────────────────────────────────────
  const lockWallet = useCallback(async () => {
    await riftLogout();
    walletManager.lockWallet();
    setState({ isUnlocked: false, wallet: null, address: null, isLoading: false, error: null });
  }, []);

  // ── Delete (also logout — Rift account itself is preserved) ────────────
  const deleteWallet = useCallback(async () => {
    await riftLogout();
    setState({ isUnlocked: false, wallet: null, address: null, isLoading: false, error: null });
    toast({ title: 'Signed Out', description: 'You can sign back in any time.' });
  }, [toast]);

  // ── Settings ───────────────────────────────────────────────────────────
  const updateSettings = useCallback((newSettings: Partial<WalletSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    saveSettings(updated);
  }, [settings]);

  const walletExists = useCallback(() => isLoggedIn(), []);

  return {
    ...state,
    settings,
    lockWallet,
    deleteWallet,
    updateSettings,
    walletExists,
    checkWalletStatus,
  };
}
