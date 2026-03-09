/**
 * USDC Manager - USDC token balance queries and transfer operations
 *
 * Provides USDC balance lookups, transfers, and formatted balance helpers across networks.
 * Exports: usdcManager, USDCManager class
 */
import { ethers } from 'ethers';
import { getNetworkByChainId, getNetworkById, NETWORKS } from './networks';
import { getTokensForNetwork } from './tokens';

function chainIdToNetworkId(chainId: number): number {
  if (chainId === 4202) return 2;   // Lisk Sepolia
  return chainId;
}

function getUsdcConfig(chainId: number): { address: string; rpcUrl: string; decimals: number } | null {
  const networkId = chainIdToNetworkId(chainId);
  const network = getNetworkById(networkId);
  if (!network) return null;
  
  const tokens = getTokensForNetwork(networkId);
  const usdcToken = tokens.find(t => t.symbol === 'USDC' || t.symbol === 'USDC.e');
  if (!usdcToken) return null;
  
  return {
    address: usdcToken.address,
    rpcUrl: network.rpcUrl,
    decimals: usdcToken.decimals
  };
}

class USDCManager {
  async getUSDCBalance(walletAddress: string, chainId: number = 4202): Promise<string> {
    try {
      const config = getUsdcConfig(chainId);
      if (!config) {
        return '0';
      }
      
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const usdcContract = new ethers.Contract(config.address, [
        'function balanceOf(address owner) view returns (uint256)',
        'function decimals() view returns (uint8)'
      ], provider);
      
      const balance = await usdcContract.balanceOf(walletAddress);
      return ethers.formatUnits(balance, config.decimals);
    } catch (error) {
      return '0';
    }
  }

  async transferUSDC(fromSigner: ethers.Wallet, toAddress: string, amount: string, chainId: number = 4202): Promise<string> {
    try {
      const config = getUsdcConfig(chainId);
      if (!config) {
        throw new Error(`No USDC config for chainId ${chainId}`);
      }
      
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const signerWithProvider = fromSigner.connect(provider);
      
      const usdcContract = new ethers.Contract(config.address, [
        'function transfer(address to, uint256 amount) returns (bool)',
        'function decimals() view returns (uint8)'
      ], signerWithProvider);
      
      const amountInWei = ethers.parseUnits(amount, config.decimals);
      
      const tx = await usdcContract.transfer(toAddress, amountInWei);
      await tx.wait();
      
      return tx.hash;
    } catch (error) {
      throw error;
    }
  }

  async ensureTestUSDC(walletAddress: string, chainId: number = 4202): Promise<boolean> {
    try {
      const balance = await this.getUSDCBalance(walletAddress, chainId);
      const balanceNum = parseFloat(balance);
      
      if (balanceNum < 5) {
        return true;
      }
      
      return false;
    } catch (error) {
      return true;
    }
  }

  async getFormattedBalance(walletAddress: string, chainId: number = 4202): Promise<{ balance: string; needsTestTokens: boolean }> {
    const balance = await this.getUSDCBalance(walletAddress, chainId);
    const needsTestTokens = await this.ensureTestUSDC(walletAddress, chainId);
    
    return {
      balance: parseFloat(balance).toFixed(2),
      needsTestTokens
    };
  }
}

export const usdcManager = new USDCManager();
