import { isWalletSandbox, walletDefaultChainId } from "@/lib/wallet-environment";
/**
 * useWallet Hook — Wallet state sourced from the Rift widget
 *
 * The @rift-finance/react widget owns sign-in and the smart-wallet address.
 * This hook adapts useRift() into the legacy shape (isUnlocked, wallet,
 * address, settings, etc.) so the rest of the app didn't need to change.
 */
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useIdentity as useRift } from '@/lib/identity';
import {
  getMe as riftGetMe,
  clearLocalRiftState,
  getCachedUserSummary,
} from '@/lib/rift-client';
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
  selectedNetworkId: walletDefaultChainId,
  theme: 'dark',
  currency: 'USD',
  autoLock: true,
  autoLockTimeout: 30,
};

function loadSettings(): WalletSettings {
  try {
    const raw = localStorage.getItem(isWalletSandbox ? 'sandbox_wallet_settings' : 'wallet_settings');
    const settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    return isWalletSandbox ? { ...settings, selectedNetworkId: walletDefaultChainId } : settings;
  } catch { return DEFAULT_SETTINGS; }
}

function saveSettings(s: WalletSettings) {
  localStorage.setItem(isWalletSandbox ? 'sandbox_wallet_settings' : 'wallet_settings', JSON.stringify(s));
}

// True on first paint if the Rift provider has a persisted session in storage.
// Without checking this, useWallet flips isLoading=false before rehydration
// completes and pages redirect to /auth on every reload.
function hasStoredRiftSession(): boolean {
  if (typeof window === 'undefined') return false;
  try { return !!window.localStorage.getItem('rift:identity'); } catch { return false; }
}

export function useWallet() {
  const { user, isAuthenticated, signOut } = useRift();

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Suppresses the "logged out" state during the brief window between mount
  // and the Rift provider rehydrating its JWT from storage.
  const [pendingHydration, setPendingHydration] = useState<boolean>(() => hasStoredRiftSession());

  const [settings, setSettings] = useState<WalletSettings>(loadSettings());
  const { toast } = useToast();

  // Once the provider confirms auth, hydration is done. Also clear after a
  // 2s grace period in case the stored token is invalid and the silent
  // refresh fails — we shouldn't leave isLoading stuck forever.
  useEffect(() => {
    if (isAuthenticated) { setPendingHydration(false); return; }
    if (!pendingHydration) return;
    const t = setTimeout(() => setPendingHydration(false), 2000);
    return () => clearTimeout(t);
  }, [isAuthenticated, pendingHydration]);

  // Keep walletManager + display name in sync with the widget. We also pull
  // the full Rift user profile (once per session) so OTP-gated tx prompts
  // know which channel to use.
  useEffect(() => {
    // Don't decide "user is logged out" while the JWT is still rehydrating.
    if (pendingHydration) return;

    if (!isAuthenticated || !user) {
      walletManager.setAddress(null);
      setDisplayName(null);
      setIsLoading(false);
      return;
    }

    walletManager.setAddress(user.address);

    // Cached snapshot for instant render
    const cached = getCachedUserSummary();
    setDisplayName(cached?.user || 'My Wallet');
    setIsLoading(false);

    // Best-effort: pull the full user record from Rift (also persists the
    // AuthMethod so the tx-auth dialog can prompt for the right channel)
    riftGetMe().then((profile) => {
      if (!profile) return;
      const name = (profile as any).displayName || (profile as any).externalId || (profile as any).email || 'My Wallet';
      setDisplayName(name);
    }).catch(() => {});
  }, [pendingHydration, isAuthenticated, user?.user, user?.address]);

  // ── Auto-lock timer ────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings.autoLock || !isAuthenticated) return;
    const timeout = setTimeout(() => {
      lockWallet();
      toast({ title: 'Wallet Locked', description: 'Auto-locked for security.' });
    }, settings.autoLockTimeout * 60 * 1000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, settings.autoLock, settings.autoLockTimeout]);

  // ── Lock (sign out via the widget; clears server session + local state) ─
  const lockWallet = useCallback(async () => {
    await signOut();
    clearLocalRiftState();
    walletManager.lockWallet();
    setDisplayName(null);
  }, [signOut]);

  const deleteWallet = useCallback(async () => {
    await lockWallet();
    toast({ title: 'Signed Out', description: 'You can sign back in any time.' });
  }, [lockWallet, toast]);

  // ── Settings ───────────────────────────────────────────────────────────
  const updateSettings = useCallback((newSettings: Partial<WalletSettings>) => {
    const updated = { ...settings, ...newSettings, ...(isWalletSandbox ? { selectedNetworkId: walletDefaultChainId } : {}) };
    setSettings(updated);
    saveSettings(updated);
  }, [settings]);

  const walletExists = useCallback(() => isAuthenticated, [isAuthenticated]);

  const address = user?.address ?? null;
  const wallet = isAuthenticated && address
    ? { address, name: displayName || 'My Wallet' }
    : null;

  return {
    isUnlocked: isAuthenticated,
    wallet,
    address,
    isLoading,
    error,
    settings,
    lockWallet,
    deleteWallet,
    updateSettings,
    walletExists,
    checkWalletStatus: async () => {}, // no-op — widget drives state now
  };
}
