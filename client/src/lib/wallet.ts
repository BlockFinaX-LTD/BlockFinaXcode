/**
 * wallet.ts — Compatibility shim over Rift Finance
 *
 * The old WalletManager (Lit-based) is gone. Now wallets are managed by Rift.
 * This module exposes a compatible API so existing call sites (hedge-contract,
 * use-transactions) keep working — they delegate to Rift via /api/rift/*.
 *
 * For on-chain hedge contract calls, the migration to Rift's
 * `rift_send_transaction` is still pending. Those paths throw a clear error.
 */

import { isLoggedIn } from './rift-client';

let _cachedAddress: string | null = null;

export interface WalletBalance {
  networkId: number;
  balance: string;
  usdValue: number | null;
  symbol: string;
}

class WalletManager {
  /**
   * Returns the user's smart wallet address (Rift returns the same address
   * across all chains since they're CREATE2-deployed deterministically).
   */
  getAddress(): string | null {
    return _cachedAddress;
  }

  /** Set by useWallet after riftGetMe returns. */
  setAddress(address: string | null): void {
    _cachedAddress = address;
  }

  isUnlocked(): boolean {
    return isLoggedIn() && !!_cachedAddress;
  }

  lockWallet(): void {
    _cachedAddress = null;
  }

  async signMessage(_message: string): Promise<string> {
    throw new Error('Direct message signing not yet wired to Rift — use specific Rift endpoints instead.');
  }

  async signOffline(_txParams: any): Promise<string> {
    throw new Error('On-chain transaction signing has not yet been migrated to Rift. Use /api/rift/send instead.');
  }

  async getSigner(_networkId?: number): Promise<any> {
    throw new Error('Direct ethers signer access is no longer available. Use Rift API endpoints (/api/rift/send, /api/rift/balance) instead.');
  }

  // Stubbed transaction helpers — UIs that call these will display the error toast.
  async sendTransaction(_to: string, _amount: string, _networkId: number): Promise<{ hash: string; transaction: any }> {
    throw new Error('Use rift-client sendCrypto() for ETH/BNB transfers (gasless via Rift).');
  }

  async sendTokenTransaction(
    _to: string, _amount: string, _networkId: number, _tokenAddress: string, _tokenDecimals: number
  ): Promise<{ hash: string; transaction: any }> {
    throw new Error('Use rift-client sendCrypto() for ERC-20 transfers (gasless via Rift).');
  }

  async estimateGasFee(
    _to: string, _amount: string, _networkId: number, _tokenAddress?: string, _tokenDecimals?: number
  ): Promise<{ fee: string; feeUsd: number | null }> {
    return { fee: '0', feeUsd: null }; // Rift is gasless — fees are paid in USDC, calculated via /api/rift/fee
  }

  async getSmartAccountAddress(_chainId: number): Promise<string> {
    if (!_cachedAddress) throw new Error('Wallet not unlocked');
    return _cachedAddress;
  }
}

export const walletManager = new WalletManager();
