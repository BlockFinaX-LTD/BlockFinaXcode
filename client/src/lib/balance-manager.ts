/**
 * Balance Manager - Real-time balance tracking for ETH and ERC-20 tokens
 *
 * Manages cached wallet balances with subscription-based updates across networks.
 * Exports: balanceManager, BalanceManager class, WalletBalance, BalanceUpdate
 */
import { ethers } from 'ethers';
import { fallbackProvider } from './rpc-provider';
import { tokenManager, getTokensForNetwork } from './tokens';
import { NETWORKS } from './networks';

export interface WalletBalance {
  address: string;
  networkId: number;
  nativeBalance: string;
  nativeSymbol: string;
  tokenBalances: Array<{
    token: {
      symbol: string;
      name: string;
      address: string;
      decimals: number;
      icon: string;
      color: string;
    };
    balance: string;
    usdValue: number;
  }>;
  lastUpdated: number;
}

export interface BalanceUpdate {
  address: string;
  networkId: number;
  balances: WalletBalance;
}

class BalanceManager {
  private balanceCache = new Map<string, WalletBalance>();
  private updateCallbacks = new Set<(update: BalanceUpdate) => void>();
  private activeRequests = new Map<string, Promise<WalletBalance>>();

  private getCacheKey(address: string, networkId: number): string {
    return `${address.toLowerCase()}_${networkId}`;
  }

  // Subscribe to balance updates
  subscribe(callback: (update: BalanceUpdate) => void): () => void {
    this.updateCallbacks.add(callback);
    return () => this.updateCallbacks.delete(callback);
  }

  // Get cached balance or fetch fresh
  async getBalance(address: string, networkId: number, forceRefresh = false): Promise<WalletBalance | null> {
    if (!address || !networkId) return null;

    const cacheKey = this.getCacheKey(address, networkId);
    
    // Return cached if available and not forcing refresh
    if (!forceRefresh && this.balanceCache.has(cacheKey)) {
      const cached = this.balanceCache.get(cacheKey)!;
      // Cache is valid for 30 seconds
      if (Date.now() - cached.lastUpdated < 30000) {
        return cached;
      }
    }

    // Check if request is already in progress
    if (this.activeRequests.has(cacheKey)) {
      return await this.activeRequests.get(cacheKey)!;
    }

    // Start fresh request
    const request = this.fetchFreshBalance(address, networkId);
    this.activeRequests.set(cacheKey, request);

    try {
      const balance = await request;
      this.activeRequests.delete(cacheKey);
      return balance;
    } catch (error) {
      this.activeRequests.delete(cacheKey);
      return null;
    }
  }

  // Fetch fresh balance from blockchain
  private async fetchFreshBalance(address: string, networkId: number): Promise<WalletBalance> {
    const network = NETWORKS.find(n => n.id === networkId);
    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }

    // Get provider for this network
    const provider = await fallbackProvider.getWorkingProvider(network.chainId);
    if (!provider) {
      throw new Error(`No working provider for network ${network.name}`);
    }

    // Fetch native balance
    const nativeBalanceWei = await provider.getBalance(address);
    const nativeBalance = ethers.formatEther(nativeBalanceWei);

    let tokenBalances = await tokenManager.getAllTokenBalances(networkId, address, provider);

    if (tokenBalances.length === 0 || tokenBalances.every(tb => parseFloat(tb.balance) === 0)) {
      try {
        const res = await fetch(`/api/wallet/${address}/token-balances?networkId=${network.chainId}`);
        if (res.ok) {
          const serverBalances = await res.json();
          if (serverBalances.balances && serverBalances.balances.length > 0) {
            tokenBalances = serverBalances.balances;
          }
        }
      } catch {
      }
    }

    const walletBalance: WalletBalance = {
      address: address.toLowerCase(),
      networkId,
      nativeBalance,
      nativeSymbol: network.symbol,
      tokenBalances,
      lastUpdated: Date.now()
    };

    // Cache the result
    const cacheKey = this.getCacheKey(address, networkId);
    this.balanceCache.set(cacheKey, walletBalance);

    // Notify subscribers
    const update: BalanceUpdate = {
      address: address.toLowerCase(),
      networkId,
      balances: walletBalance
    };

    this.updateCallbacks.forEach(callback => {
      try {
        callback(update);
      } catch (error) {
      }
    });

    return walletBalance;
  }

  // Refresh balance for specific wallet and network
  async refreshBalance(address: string, networkId: number): Promise<WalletBalance | null> {
    return this.getBalance(address, networkId, true);
  }

  // Refresh all cached balances for a wallet
  async refreshAllBalances(address: string): Promise<WalletBalance[]> {
    const results: WalletBalance[] = [];
    
    for (const network of NETWORKS) {
      try {
        const balance = await this.refreshBalance(address, network.id);
        if (balance) {
          results.push(balance);
        }
      } catch (error) {
      }
    }

    return results;
  }

  // Clear cache for specific wallet
  clearWalletCache(address: string): void {
    const lowerAddress = address.toLowerCase();
    const keysToDelete = Array.from(this.balanceCache.keys()).filter(key => 
      key.startsWith(lowerAddress)
    );
    
    keysToDelete.forEach(key => this.balanceCache.delete(key));
  }

  // Clear all cache
  clearAllCache(): void {
    this.balanceCache.clear();
    this.activeRequests.clear();
  }

  // Get all cached balances for a wallet
  getCachedBalances(address: string): WalletBalance[] {
    const lowerAddress = address.toLowerCase();
    const balances: WalletBalance[] = [];
    
    Array.from(this.balanceCache.entries()).forEach(([key, balance]) => {
      if (key.startsWith(lowerAddress)) {
        balances.push(balance);
      }
    });

    return balances;
  }
}

export const balanceManager = new BalanceManager();