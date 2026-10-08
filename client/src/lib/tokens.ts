import { isWalletSandbox, sandboxTokenAddress } from "./wallet-environment";
/**
 * Tokens - Token registry and ERC-20 contract helpers
 *
 * Defines token configurations per network and provides balance/transfer utilities.
 * Exports: tokenManager, TokenManager class, TokenConfig, NETWORK_TOKENS, getTokensForNetwork, getTokenBySymbol, ERC20_ABI
 */
import { ethers } from 'ethers';

export interface TokenConfig {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  icon: string;
  color: string;
}

export interface NetworkTokens {
  [networkId: number]: TokenConfig[];
}

export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

export const NETWORK_TOKENS: NetworkTokens = isWalletSandbox ? {
  84532: sandboxTokenAddress ? [{ symbol: 'sUSD', name: 'Sandbox USD', address: sandboxTokenAddress, decimals: 6, icon: '💵', color: '#2775CA' }] : [],
} : {
  // Lisk (network IDs 1 + 2) was removed when smart-contract support for
  // Lisk was dropped. Supported networks: Base (3) and BSC (4).
  //
  // Base Mainnet (internal network ID 3)
  3: [
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
      icon: '💵',
      color: '#2775CA'
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      decimals: 6,
      icon: '💲',
      color: '#26A17B'
    }
  ],
  // BNB Smart Chain Mainnet (internal network ID 4)
  4: [
    {
      symbol: 'USDC',
      name: 'USD Coin (BSC)',
      address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      decimals: 18,
      icon: '💵',
      color: '#2775CA'
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0x55d398326f99059fF775485246999027B3197955',
      decimals: 18,
      icon: '💲',
      color: '#26A17B'
    }
  ]
};

export const getTokensForNetwork = (networkId: number): TokenConfig[] => {
  return NETWORK_TOKENS[networkId] || [];
};

export const getTokenBySymbol = (networkId: number, symbol: string): TokenConfig | undefined => {
  const tokens = getTokensForNetwork(networkId);
  return tokens.find(token => token.symbol === symbol);
};

export class TokenManager {
  async getTokenBalance(
    tokenAddress: string,
    walletAddress: string,
    provider: ethers.JsonRpcProvider,
    decimals: number = 18
  ): Promise<string> {
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const balance = await contract.balanceOf(walletAddress);
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      throw error;
    }
  }

  async getAllTokenBalances(
    networkId: number,
    walletAddress: string,
    provider: ethers.JsonRpcProvider
  ): Promise<Array<{ token: TokenConfig; balance: string; usdValue: number }>> {
    const tokens = getTokensForNetwork(networkId);
    const balances = [];

    for (const token of tokens) {
      let balance = '0';
      let usdValue = 0;
      
      if (token.symbol === 'USDC' || token.symbol === 'USDC.e') {
        try {
          const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
          const rawBalance = await contract.balanceOf(walletAddress);
          balance = ethers.formatUnits(rawBalance, token.decimals);
          usdValue = parseFloat(balance) * 1.0;
        } catch (error) {
          balance = '0';
        }
      } else {
        try {
          balance = await this.getTokenBalance(
            token.address,
            walletAddress,
            provider,
            token.decimals
          );
          usdValue = parseFloat(balance) * 1;
        } catch (error) {
          balance = '0';
          usdValue = 0;
        }
      }
      
      balances.push({
        token,
        balance,
        usdValue
      });
    }

    return balances;
  }

  async detectUSDCBalance(
    walletAddress: string,
    provider: ethers.JsonRpcProvider,
    networkId: number
  ): Promise<string> {
    try {
      let usdcContracts: string[] = [];
      
      if (networkId === 1) {
        usdcContracts = ['0xF242275d3a6527d877f2c927a82D9b057609cc71'];
      } else if (networkId === 2) {
        usdcContracts = ['0xf52Ad63619Bf9cFeF510341ac6b4038554399562'];
      } else if (networkId === 3) {
        usdcContracts = ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'];
      } else if (networkId === 4) {
        usdcContracts = ['0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'];
      }
      
      for (const usdcAddress of usdcContracts) {
        try {
          const usdcContract = new ethers.Contract(usdcAddress, [
            'function balanceOf(address owner) view returns (uint256)',
            'function decimals() view returns (uint8)',
            'function symbol() view returns (string)'
          ], provider);
          
          const balance = await usdcContract.balanceOf(walletAddress);
          if (balance > 0) {
            const decimals = await usdcContract.decimals();
            const formatted = ethers.formatUnits(balance, decimals);
            return formatted;
          }
        } catch (error) {
        }
      }
      
      try {
        const latestBlock = await provider.getBlockNumber();
        const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        
        const logs = await provider.getLogs({
          fromBlock: Math.max(0, latestBlock - 1000),
          toBlock: latestBlock,
          topics: [
            transferTopic,
            null,
            ethers.zeroPadValue(walletAddress, 32)
          ]
        });
        
        if (logs.length > 0) {
          const tokenContractSet = new Set(logs.map((log: any) => log.address));
          const tokenContracts = Array.from(tokenContractSet);
          
          for (const tokenAddress of tokenContracts) {
            try {
              const tokenContract = new ethers.Contract(tokenAddress as string, [
                'function balanceOf(address owner) view returns (uint256)',
                'function decimals() view returns (uint8)',
                'function symbol() view returns (string)',
                'function name() view returns (string)'
              ], provider);
              
              const balance = await tokenContract.balanceOf(walletAddress);
              if (balance > 0) {
                const decimals = await tokenContract.decimals();
                const symbol = await tokenContract.symbol();
                const name = await tokenContract.name();
                
                const symbolLower = symbol.toLowerCase();
                const nameLower = name.toLowerCase();
                
                if (symbolLower.includes('usdc') || nameLower.includes('usdc') || 
                    symbolLower.includes('usd') || nameLower.includes('usd coin')) {
                  const formatted = ethers.formatUnits(balance, decimals);
                  return formatted;
                }
              }
            } catch (error) {
            }
          }
        }
      } catch (error) {
      }
      
      return '0';
    } catch (error) {
      return '0';
    }
  }

  async transferToken(
    tokenAddress: string,
    to: string,
    amount: string,
    decimals: number,
    signer: ethers.Wallet
  ): Promise<ethers.TransactionResponse> {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const amountInWei = ethers.parseUnits(amount, decimals);
    return await contract.transfer(to, amountInWei);
  }
}

export const tokenManager = new TokenManager();
