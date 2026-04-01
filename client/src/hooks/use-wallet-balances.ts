/**
 * useWalletBalances Hook - Live token balance tracking for the connected wallet
 *
 * Subscribes to real-time balance updates for ETH and USDC across all supported networks.
 * Automatically refreshes when the wallet address or selected network changes.
 * Used by the Wallet page and Header to display current balances.
 * Exports: useWalletBalances
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from './use-wallet';
import { balanceManager, type WalletBalance, type BalanceUpdate } from '@/lib/balance-manager';
import { NETWORKS } from '@/lib/networks';
import { fetchCryptoPrices, getEthPrice } from '@/lib/price-service';

export function useWalletBalances(selectedNetworkId?: number) {
  const { address, isUnlocked } = useWallet();
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ethPrice, setEthPrice] = useState<number | null>(null);

  // Fetch real-time prices on mount
  useEffect(() => {
    fetchCryptoPrices().then(prices => {
      if (prices?.eth) setEthPrice(prices.eth);
    });
    // Refresh prices every 5 minutes (match server cache)
    const interval = setInterval(() => {
      fetchCryptoPrices().then(prices => {
        if (prices?.eth) setEthPrice(prices.eth);
      });
    }, 5 * 60_000);
    return () => clearInterval(interval);
  }, []);

  // Get balance for selected network
  const selectedNetworkBalance = useMemo(() => {
    if (!selectedNetworkId) return null;
    return balances.find(b => b.networkId === selectedNetworkId) || null;
  }, [balances, selectedNetworkId]);

  // Get total portfolio value with proper USD calculation for each network
  const totalValue = useMemo(() => {
    return balances.reduce((total, balance) => {
      // Get network-specific USD price for native token
      const network = NETWORKS.find(n => n.id === balance.networkId);
      let nativeUsdPrice = 0;
      
      // Use live market prices for different native tokens
      if (network?.symbol === 'ETH') {
        nativeUsdPrice = ethPrice ?? 0; // Live ETH price; 0 if not yet loaded
      } else if (network?.symbol === 'MATIC') {
        nativeUsdPrice = 0.8; // MATIC price
      } else if (network?.symbol === 'BNB') {
        nativeUsdPrice = 300; // BNB price
      }
      
      const nativeValue = parseFloat(balance.nativeBalance) * nativeUsdPrice;
      
      // Token values (USDC = $1)
      const tokenValue = balance.tokenBalances.reduce((sum, tb) => sum + tb.usdValue, 0);
      
      return total + nativeValue + tokenValue;
    }, 0);
  }, [balances, ethPrice]);

  // Get all token balances across networks
  const allTokenBalances = useMemo(() => {
    const tokens: Array<{
      networkId: number;
      networkName: string;
      token: any;
      balance: string;
      usdValue: number;
    }> = [];

    balances.forEach(balance => {
      const network = NETWORKS.find(n => n.id === balance.networkId);
      if (network) {
        balance.tokenBalances.forEach(tb => {
          tokens.push({
            networkId: balance.networkId,
            networkName: network.name,
            token: tb.token,
            balance: tb.balance,
            usdValue: tb.usdValue
          });
        });
      }
    });

    return tokens;
  }, [balances]);

  // Update balances when balance manager notifies of changes
  const handleBalanceUpdate = useCallback((update: BalanceUpdate) => {
    if (!address || update.address !== address.toLowerCase()) return;
    
    setBalances(prev => {
      const filtered = prev.filter(b => 
        !(b.address === update.address && b.networkId === update.networkId)
      );
      return [...filtered, update.balances];
    });
  }, [address]);

  // Subscribe to balance updates
  useEffect(() => {
    if (!address || !isUnlocked) return;

    const unsubscribe = balanceManager.subscribe(handleBalanceUpdate);
    return unsubscribe;
  }, [address, isUnlocked, handleBalanceUpdate]);

  // Load initial balances
  const loadBalances = useCallback(async (forceRefresh = false) => {
    if (!address || !isUnlocked) {
      setBalances([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (forceRefresh) {
        // Clear cache for this wallet first
        balanceManager.clearWalletCache(address);
      }

      // Get cached balances first for immediate display
      const cachedBalances = balanceManager.getCachedBalances(address);
      if (cachedBalances.length > 0 && !forceRefresh) {
        setBalances(cachedBalances);
      }

      // Fetch fresh balances
      const freshBalances = await balanceManager.refreshAllBalances(address);
      setBalances(freshBalances);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load balances');
    } finally {
      setIsLoading(false);
    }
  }, [address, isUnlocked]);

  // Load specific network balance
  const loadNetworkBalance = useCallback(async (networkId: number, forceRefresh = false) => {
    if (!address || !isUnlocked) return null;

    try {
      const balance = await balanceManager.getBalance(address, networkId, forceRefresh);
      if (balance) {
        setBalances(prev => {
          const filtered = prev.filter(b => 
            !(b.address === balance.address && b.networkId === balance.networkId)
          );
          return [...filtered, balance];
        });
      }
      return balance;
    } catch (err) {
      return null;
    }
  }, [address, isUnlocked]);

  // Refresh all balances
  const refreshAll = useCallback(() => {
    loadBalances(true);
  }, [loadBalances]);

  // Refresh specific network
  const refreshNetwork = useCallback((networkId: number) => {
    loadNetworkBalance(networkId, true);
  }, [loadNetworkBalance]);

  // Clear balances when wallet changes
  useEffect(() => {
    if (!address || !isUnlocked) {
      setBalances([]);
      setError(null);
      return;
    }

    // Load balances for new wallet
    loadBalances();
  }, [address, isUnlocked, loadBalances]);

  // Format currency
  const formatCurrency = useCallback((value: number | null | undefined, currency: string = 'USD') => {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(value);
  }, []);

  // Format crypto amount
  const formatCrypto = useCallback((amount: string, symbol: string, decimals: number = 4) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return `0.00 ${symbol}`;
    return `${num.toFixed(decimals)} ${symbol}`;
  }, []);

  return {
    // Balance data
    balances,
    selectedNetworkBalance,
    allTokenBalances,
    totalValue,
    
    // Loading states
    isLoading,
    error,
    
    // Actions
    refreshAll,
    refreshNetwork,
    loadNetworkBalance,
    
    // Utilities
    formatCurrency,
    formatCrypto,
  };
}