/**
 * Liquidity Unstaking Manager
 * 
 * Handles USDC token transfers from treasury pool back to user wallets.
 * Exports: UnstakeManager class, unstakeManager singleton
 */

import { ethers } from "ethers";

const USDC_ADDRESS = process.env.BASE_SEPOLIA_USDC_ADDRESS || "";
const BASE_SEPOLIA_RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

// ERC20 ABI for transfer function
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)"
];

export class UnstakeManager {
  private provider: ethers.JsonRpcProvider;
  private treasuryWallet: ethers.Wallet | null = null;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC);
    
    // Initialize treasury wallet from environment variable
    const treasuryPrivateKey = process.env.TREASURY_POOL_PRIVATE_KEY;
    if (treasuryPrivateKey) {
      this.treasuryWallet = new ethers.Wallet(treasuryPrivateKey, this.provider);
    }
  }

  /**
   * Transfer USDC tokens from Treasury Pool back to user wallet
   */
  async unstakeTokens(params: {
    userAddress: string;
    amount: string;
  }): Promise<{ txHash: string }> {
    if (!USDC_ADDRESS) throw new Error("BASE_SEPOLIA_USDC_ADDRESS must be configured before unstaking");
    if (!this.treasuryWallet) {
      throw new Error("Treasury Pool wallet not initialized. Missing TREASURY_POOL_PRIVATE_KEY.");
    }

    const { userAddress, amount } = params;

    try {

      // Create USDC contract instance
      const usdcContract = new ethers.Contract(
        USDC_ADDRESS,
        ERC20_ABI,
        this.treasuryWallet
      );

      // Check Treasury Pool balance
      const treasuryBalance = await usdcContract.balanceOf(this.treasuryWallet.address);
      const amountInWei = ethers.parseUnits(amount, 6); // USDC has 6 decimals
      

      if (treasuryBalance < amountInWei) {
        throw new Error(`Insufficient Treasury Pool balance. Has ${ethers.formatUnits(treasuryBalance, 6)} USDC, needs ${amount} USDC`);
      }

      // Execute transfer from Treasury Pool to user
      const tx = await usdcContract.transfer(userAddress, amountInWei);
      
      await tx.wait();
      

      return { txHash: tx.hash };
    } catch (error: any) {
      
      // User-friendly error messages
      if (error.code === "INSUFFICIENT_FUNDS") {
        throw new Error("Treasury Pool has insufficient ETH for gas fees");
      }
      
      throw new Error(error.message || "Failed to transfer tokens from Treasury Pool");
    }
  }

  /**
   * Get Treasury Pool USDC balance
   */
  async getTreasuryBalance(): Promise<string> {
    if (!this.treasuryWallet) {
      throw new Error("Treasury Pool wallet not initialized");
    }

    const usdcContract = new ethers.Contract(
      USDC_ADDRESS,
      ERC20_ABI,
      this.provider
    );

    const balance = await usdcContract.balanceOf(this.treasuryWallet.address);
    return ethers.formatUnits(balance, 6);
  }
}

// Export singleton instance
export const unstakeManager = new UnstakeManager();
