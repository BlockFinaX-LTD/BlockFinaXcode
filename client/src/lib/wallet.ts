/**
 * wallet.ts — Compatibility shim over Rift Finance
 *
 * The old WalletManager (Lit-based) is gone. Now wallets are managed by Rift.
 * This module exposes a compatible API so existing call sites (hedge-contract,
 * use-transactions) keep working — they delegate to Rift.
 *
 * `getSigner()` returns a read-only stub: hedge-contract only uses `signer.address`
 * and `signer.connect(provider)` for read calls. All writes go through
 * `sendContractTx` which routes to `rift.signer.sendTransaction`.
 */

import { ethers } from 'ethers';
import { isLoggedIn } from './rift-client';

let _cachedAddress: string | null = null;

/**
 * Minimal signer-like object used by hedge-contract for read ops (balance checks
 * via connected contracts). Write ops in hedge-contract ignore this entirely and
 * route through Rift — see `sendContractTx` in hedge-contract.ts.
 */
class ReadOnlySigner {
  constructor(public readonly address: string) {}
  connect(provider: ethers.Provider): ethers.Contract | any {
    // Return a Voidable "runner" that can do reads. Writes will not reach the signer.
    return new ethers.VoidSigner(this.address, provider);
  }
}

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

  /**
   * Returns a read-only signer-like object. hedge-contract uses this for:
   *   1. `signer.address` — the user's wallet address (needed for balance/allowance checks)
   *   2. `signer.connect(provider)` — to build read contracts
   * All write transactions are routed through Rift inside `sendContractTx`, so
   * the returned object never actually signs anything.
   */
  async getSigner(_networkId?: number): Promise<any> {
    if (!_cachedAddress) return null;
    return new ReadOnlySigner(_cachedAddress);
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
