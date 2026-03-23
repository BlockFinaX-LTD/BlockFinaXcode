/**
 * useWallet Hook - Core wallet state management
 *
 * Manages wallet lock/unlock state, session persistence, and auto-lock timer.
 * This is the primary hook used across the app to check if a wallet is connected
 * and to get the current wallet address and unlock status.
 * Exports: useWallet, WalletState
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { walletManager } from '@/lib/wallet';
import { secureStorage, deleteWalletV2, type StoredWallet, type WalletSettings } from '@/lib/encrypted-storage';
import { useToast } from '@/hooks/use-toast';

export interface WalletState {
  isUnlocked: boolean;
  wallet: StoredWallet | null;
  address: string | null;
  isLoading: boolean;
  error: string | null;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    isUnlocked: false,
    wallet: null,
    address: null,
    isLoading: true,
    error: null
  });

  const [settings, setSettings] = useState<WalletSettings>(secureStorage.loadSettings());
  const { toast } = useToast();

  // Check wallet status on mount
  useEffect(() => {
    checkWalletStatus();
  }, []);

  // Auto-lock functionality
  useEffect(() => {
    if (!settings.autoLock || !state.isUnlocked) return;

    const timeout = setTimeout(() => {
      lockWallet();
      toast({
        title: "Wallet Locked",
        description: "Your wallet has been automatically locked for security.",
      });
    }, settings.autoLockTimeout * 60 * 1000);

    return () => clearTimeout(timeout);
  }, [state.isUnlocked, settings.autoLock, settings.autoLockTimeout]);

  const registeredAddresses = useRef<Set<string>>(new Set());

  const registerWalletWithBackend = useCallback(async (wallet: StoredWallet) => {
    if (!wallet.address || registeredAddresses.current.has(wallet.address.toLowerCase())) return;
    registeredAddresses.current.add(wallet.address.toLowerCase());
    try {
      const sessionToken = localStorage.getItem('bfx_session');
      const authHeader = sessionToken ? { 'x-session-token': sessionToken } : {};

      // Only send non-sensitive metadata — private key material stays on device only.
      // encryptedPrivateKey is a required DB column (legacy), so we send a safe
      // placeholder that clearly contains no key data.
      const res = await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          address: wallet.address,
          name: wallet.name,
          encryptedPrivateKey: `device_only:${wallet.address}`, // address is public — not sensitive
          encryptedMnemonic: null, // never sent to server
          isImported: wallet.isImported || false,
        }),
      });
      if (!res.ok) {
        registeredAddresses.current.delete(wallet.address.toLowerCase());
        return;
      }

      // Link this wallet address to the current auth session so cross-device
      // checks can detect it on future logins from other devices.
      if (sessionToken) {
        fetch('/api/auth/session/wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
          body: JSON.stringify({ walletAddress: wallet.address }),
        }).catch(() => {});
      }
    } catch (err) {
      registeredAddresses.current.delete(wallet.address.toLowerCase());
    }
  }, []);

  const checkWalletStatus = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      let isUnlocked = walletManager.isUnlocked();
      let address = walletManager.getAddress();
      let wallet: StoredWallet | null = null;

      // If wallet manager says not unlocked, check persistent state
      if (!isUnlocked && secureStorage.isWalletUnlocked()) {
        // Trust the persistent unlock state for UI purposes
        const unlockedData = secureStorage.getWalletUnlockedData();
        if (unlockedData) {
          isUnlocked = true;
          address = unlockedData.address;
          // Load wallet data for display (non-sensitive operations only)
          try {
            wallet = secureStorage.loadWallet();
          } catch (error) {
            // If can't load wallet data, still show as unlocked with basic info
            wallet = {
              address: unlockedData.address,
              name: unlockedData.name,
              encryptedPrivateKey: '',
              isImported: false,
              createdAt: new Date().toISOString()
            };
          }
        }
      } else if (isUnlocked) {
        wallet = secureStorage.loadWallet();
      }

      setState({
        isUnlocked,
        wallet,
        address,
        isLoading: false,
        error: null
      });

      if (isUnlocked && wallet && wallet.address) {
        registerWalletWithBackend(wallet);
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }, [registerWalletWithBackend]);

  const createWallet = useCallback(async (password: string, name?: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const wallet = await walletManager.createWallet(password, name);
      const address = walletManager.getAddress();
      
      if (wallet) {
        secureStorage.setWalletUnlocked(wallet);
      }

      await registerWalletWithBackend(wallet);
      
      try {
        const transactionsResponse = await fetch(`/api/points/transactions/${wallet.address}`);
        const transactions = await transactionsResponse.json();
        const hasSignupBonus = transactions.some((t: any) => t.type === 'signup_bonus');
        
        if (!hasSignupBonus) {
          const SIGNUP_BONUS = 100;
          
          const pointsResponse = await fetch(`/api/points/${wallet.address}`);
          const userPoints = await pointsResponse.json();
          
          await fetch(`/api/points/${wallet.address}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              points: SIGNUP_BONUS,
            })
          });
          
          await fetch('/api/points/transactions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              walletAddress: wallet.address,
              type: 'signup_bonus',
              points: SIGNUP_BONUS,
              description: 'Welcome bonus for creating an account',
              referenceId: wallet.address,
            })
          });
        }
      } catch (apiError) {
      }
      
      setState({
        isUnlocked: true,
        wallet,
        address,
        isLoading: false,
        error: null
      });

      toast({
        title: "Wallet Created",
        description: "Your new wallet has been created successfully.",
      });

      return wallet;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create wallet';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage
      }));
      
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
      
      throw error;
    }
  }, [toast, registerWalletWithBackend]);

  const importWallet = useCallback(async (
    password: string,
    input: string,
    type: 'mnemonic' | 'private_key',
    name?: string
  ) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const wallet = await walletManager.importWallet(password, input, type, name);
      const address = walletManager.getAddress();
      
      if (wallet) {
        secureStorage.setWalletUnlocked(wallet);
      }

      await registerWalletWithBackend(wallet);
      
      try {
        // Check if user already has a signup bonus (check point transactions)
        const transactionsResponse = await fetch(`/api/points/transactions/${wallet.address}`);
        const transactions = await transactionsResponse.json();
        const hasSignupBonus = transactions.some((t: any) => t.type === 'signup_bonus');
        
        // If no signup bonus exists, award it
        if (!hasSignupBonus) {
          const SIGNUP_BONUS = 100;
          
          // Get current points to update them
          const pointsResponse = await fetch(`/api/points/${wallet.address}`);
          const userPoints = await pointsResponse.json();
          
          // Update points to include signup bonus
          await fetch(`/api/points/${wallet.address}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              points: SIGNUP_BONUS,
            })
          });
          
          // Create point transaction record
          await fetch('/api/points/transactions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              walletAddress: wallet.address,
              type: 'signup_bonus',
              points: SIGNUP_BONUS,
              description: 'Welcome bonus for creating an account',
              referenceId: wallet.address,
            })
          });
        }
      } catch (apiError) {
        // Don't block wallet import if bonus fails
      }
      
      setState({
        isUnlocked: true,
        wallet,
        address,
        isLoading: false,
        error: null
      });

      toast({
        title: "Wallet Imported",
        description: "Your wallet has been imported successfully.",
      });

      return wallet;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to import wallet';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage
      }));
      
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
      
      throw error;
    }
  }, [toast, registerWalletWithBackend]);

  const unlockWallet = useCallback(async (password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const wallet = await walletManager.unlockWallet(password);
      const address = walletManager.getAddress();
      
      if (wallet) {
        secureStorage.setWalletUnlocked(wallet);
      }

      await registerWalletWithBackend(wallet);
      
      setState({
        isUnlocked: true,
        wallet,
        address,
        isLoading: false,
        error: null
      });

      toast({
        title: "Wallet Unlocked",
        description: "Welcome back!",
      });

      return wallet;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to unlock wallet';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage
      }));
      
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
      
      throw error;
    }
  }, [toast, registerWalletWithBackend]);

  const lockWallet = useCallback(() => {
    walletManager.lockWallet();
    secureStorage.clearWalletUnlocked();
    setState({
      isUnlocked: false,
      wallet: null,
      address: null,
      isLoading: false,
      error: null
    });
  }, []);

  const deleteWallet = useCallback(() => {
    secureStorage.deleteWallet();
    deleteWalletV2(); // also purge v2 PBKDF2 keys from localStorage
    secureStorage.clearWalletUnlocked();
    walletManager.lockWallet();
    setState({
      isUnlocked: false,
      wallet: null,
      address: null,
      isLoading: false,
      error: null
    });

    toast({
      title: "Wallet Deleted",
      description: "Your wallet has been permanently deleted.",
    });
  }, [toast]);

  const updateSettings = useCallback((newSettings: Partial<WalletSettings>) => {
    const updatedSettings = { ...settings, ...newSettings };
    setSettings(updatedSettings);
    secureStorage.saveSettings(updatedSettings);
  }, [settings]);

  const exportPrivateKey = useCallback(() => {
    try {
      return walletManager.exportPrivateKey();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to export private key",
      });
      throw error;
    }
  }, [toast]);

  const exportMnemonic = useCallback(() => {
    try {
      return walletManager.exportMnemonic();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to export mnemonic",
      });
      throw error;
    }
  }, [toast]);

  const walletExists = useCallback(() => {
    return secureStorage.walletExists();
  }, []);

  // Creates wallet using an already-generated mnemonic (fixes double-generation bug)
  const createWalletFromMnemonic = useCallback(async (password: string, mnemonic: string, name?: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const wallet = await walletManager.createWalletFromMnemonic(password, mnemonic, name);
      const address = walletManager.getAddress();
      if (wallet) secureStorage.setWalletUnlocked(wallet);
      await registerWalletWithBackend(wallet);
      try {
        const transactionsResponse = await fetch(`/api/points/transactions/${wallet.address}`);
        const transactions = await transactionsResponse.json();
        const hasSignupBonus = transactions.some((t: any) => t.type === 'signup_bonus');
        if (!hasSignupBonus) {
          await fetch(`/api/points/${wallet.address}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points: 100 }) });
          await fetch('/api/points/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ walletAddress: wallet.address, type: 'signup_bonus', points: 100, description: 'Welcome bonus for creating an account', referenceId: wallet.address }) });
        }
      } catch {}
      setState({ isUnlocked: true, wallet, address, isLoading: false, error: null });
      toast({ title: "Wallet Created", description: "Your new wallet has been created successfully." });
      return wallet;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create wallet';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      toast({ variant: "destructive", title: "Error", description: errorMessage });
      throw error;
    }
  }, [toast, registerWalletWithBackend]);

  return {
    ...state,
    settings,
    createWallet,
    createWalletFromMnemonic,
    importWallet,
    unlockWallet,
    lockWallet,
    deleteWallet,
    updateSettings,
    exportPrivateKey,
    exportMnemonic,
    walletExists,
    checkWalletStatus
  };
}
