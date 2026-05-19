/**
 * Fallback Provider - Multi-RPC provider with automatic failover
 *
 * Tries multiple RPC endpoints per chain and caches working providers for reliability.
 * Exports: fallbackProvider, FallbackProvider class
 */
import { ethers } from 'ethers';

export const RPC_FALLBACKS: Record<number, string[]> = {
  8453: [
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
    'https://base.drpc.org',
    'https://base-mainnet.public.blastapi.io'
  ],
  56: [
    'https://bsc-dataseed.binance.org',
    'https://bsc-dataseed1.defibit.io',
    'https://bsc-dataseed1.ninicoin.io',
    'https://bsc.drpc.org'
  ]
};

export class FallbackProvider {
  private providers: Map<number, ethers.JsonRpcProvider> = new Map();
  private workingRpcs: Map<number, string> = new Map();

  async getWorkingProvider(chainId: number): Promise<ethers.JsonRpcProvider | null> {
    if (this.providers.has(chainId)) {
      return this.providers.get(chainId)!;
    }

    if (!RPC_FALLBACKS[chainId as keyof typeof RPC_FALLBACKS]) {
      return null;
    }

    // Route all RPC calls through the server proxy to avoid browser-level rate
    // limits on public nodes (critical for Railway / any production deployment).
    const proxyUrl = `${window.location.origin}/api/rpc/${chainId}`;
    const provider = new ethers.JsonRpcProvider(
      proxyUrl,
      chainId,
      { staticNetwork: true }   // skip eth_chainId auto-detect round-trip
    );

    this.providers.set(chainId, provider);
    this.workingRpcs.set(chainId, proxyUrl);
    return provider;
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
