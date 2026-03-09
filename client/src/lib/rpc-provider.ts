/**
 * Fallback Provider - Multi-RPC provider with automatic failover
 *
 * Tries multiple RPC endpoints per chain and caches working providers for reliability.
 * Exports: fallbackProvider, FallbackProvider class
 */
import { ethers } from 'ethers';

const RPC_FALLBACKS: Record<number, string[]> = {
  4202: [
    'https://rpc.sepolia-api.lisk.com',
    'https://lisk-sepolia.drpc.org',
    'https://rpc.lisk-sepolia-testnet.lisk.com'
  ]
};

export class FallbackProvider {
  private providers: Map<number, ethers.JsonRpcProvider> = new Map();
  private workingRpcs: Map<number, string> = new Map();

  async getWorkingProvider(chainId: number): Promise<ethers.JsonRpcProvider | null> {
    if (this.providers.has(chainId)) {
      return this.providers.get(chainId)!;
    }

    const rpcUrls = RPC_FALLBACKS[chainId as keyof typeof RPC_FALLBACKS] || [];
    
    for (const rpcUrl of rpcUrls) {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 5000)
        );
        
        await Promise.race([
          provider.getBlockNumber(),
          timeoutPromise
        ]);
        
        this.providers.set(chainId, provider);
        this.workingRpcs.set(chainId, rpcUrl);
        return provider;
        
      } catch (error) {
        continue;
      }
    }
    
    return null;
  }

  async getBalance(address: string, chainId: number): Promise<string | null> {
    const provider = await this.getWorkingProvider(chainId);
    if (!provider) return null;

    try {
      const balance = await provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (error) {
      this.providers.delete(chainId);
      this.workingRpcs.delete(chainId);
      return null;
    }
  }

  async getTransaction(txHash: string): Promise<{chainId: number, receipt: any, transaction: any} | null> {
    for (const [chainId] of Object.entries(RPC_FALLBACKS)) {
      const provider = await this.getWorkingProvider(parseInt(chainId));
      if (!provider) continue;

      try {
        const receipt = await provider.getTransactionReceipt(txHash);
        if (receipt) {
          const transaction = await provider.getTransaction(txHash);
          return { chainId: parseInt(chainId), receipt, transaction };
        }
      } catch (error) {
        continue;
      }
    }
    return null;
  }

  getWorkingRpcUrl(chainId: number): string | null {
    return this.workingRpcs.get(chainId) || null;
  }

  clearCache() {
    this.providers.clear();
    this.workingRpcs.clear();
  }
}

export const fallbackProvider = new FallbackProvider();
