/**
 * Mainnet Safety Guards
 * 
 * Provides safety checks and confirmations for mainnet operations.
 * Prevents accidental transactions on mainnet, enforces limits, and validates network state.
 * Exports: MainnetGuard class, mainnetGuard instance
 */

import { isMainnet, getNetworkMode, DEFAULT_NETWORK } from "./networks";

export interface TransactionCheck {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
}

const MAINNET_TX_LIMITS = {
  maxSingleTransactionUSDC: 50000,
  maxDailyTransactionUSDC: 200000,
  minTransactionUSDC: 0.01,
  warningThresholdUSDC: 5000,
};

class MainnetGuard {
  private dailyTotals: Map<string, { total: number; date: string }> = new Map();

  isMainnetMode(): boolean {
    return isMainnet();
  }

  getNetworkLabel(): string {
    if (isMainnet()) {
      return `${DEFAULT_NETWORK.name} (Mainnet - REAL FUNDS)`;
    }
    return `${DEFAULT_NETWORK.name} (Testnet)`;
  }

  validateTransaction(amountUSDC: number, walletAddress: string): TransactionCheck {
    if (!isMainnet()) {
      return { allowed: true };
    }

    if (amountUSDC < MAINNET_TX_LIMITS.minTransactionUSDC) {
      return {
        allowed: false,
        reason: `Transaction amount ($${amountUSDC}) is below minimum ($${MAINNET_TX_LIMITS.minTransactionUSDC})`
      };
    }

    if (amountUSDC > MAINNET_TX_LIMITS.maxSingleTransactionUSDC) {
      return {
        allowed: false,
        reason: `Transaction amount ($${amountUSDC.toLocaleString()}) exceeds single transaction limit ($${MAINNET_TX_LIMITS.maxSingleTransactionUSDC.toLocaleString()})`
      };
    }

    const today = new Date().toISOString().split("T")[0];
    const key = `${walletAddress}:${today}`;
    const dailyData = this.dailyTotals.get(key) || { total: 0, date: today };
    
    if (dailyData.date !== today) {
      dailyData.total = 0;
      dailyData.date = today;
    }

    if (dailyData.total + amountUSDC > MAINNET_TX_LIMITS.maxDailyTransactionUSDC) {
      return {
        allowed: false,
        reason: `Daily transaction limit exceeded. Today's total: $${dailyData.total.toLocaleString()}, Limit: $${MAINNET_TX_LIMITS.maxDailyTransactionUSDC.toLocaleString()}`
      };
    }

    if (amountUSDC >= MAINNET_TX_LIMITS.warningThresholdUSDC) {
      return {
        allowed: true,
        requiresConfirmation: true,
        confirmationMessage: `You are about to send $${amountUSDC.toLocaleString()} USDC on ${DEFAULT_NETWORK.name} mainnet. This transaction uses REAL funds and cannot be reversed. Are you sure you want to proceed?`
      };
    }

    return {
      allowed: true,
      requiresConfirmation: true,
      confirmationMessage: `Confirm sending $${amountUSDC.toLocaleString()} USDC on ${DEFAULT_NETWORK.name} mainnet.`
    };
  }

  recordTransaction(walletAddress: string, amountUSDC: number) {
    const today = new Date().toISOString().split("T")[0];
    const key = `${walletAddress}:${today}`;
    const dailyData = this.dailyTotals.get(key) || { total: 0, date: today };
    dailyData.total += amountUSDC;
    this.dailyTotals.set(key, dailyData);
  }

  validateChainId(chainId: number): TransactionCheck {
    if (!isMainnet()) {
      return { allowed: true };
    }

    const SUPPORTED_MAINNET_CHAINS: Record<number, string> = {
      1135: "Lisk Mainnet",
      8453: "Base Mainnet",
      56:   "BNB Smart Chain Mainnet",
    };

    if (!SUPPORTED_MAINNET_CHAINS[chainId]) {
      return {
        allowed: false,
        reason: `Invalid chain for mainnet. Got chain ${chainId}. Supported chains: Lisk (1135), Base (8453), BSC (56).`
      };
    }

    return { allowed: true };
  }

  getTransactionLimits() {
    if (!isMainnet()) {
      return null;
    }
    return { ...MAINNET_TX_LIMITS };
  }
}

export const mainnetGuard = new MainnetGuard();
