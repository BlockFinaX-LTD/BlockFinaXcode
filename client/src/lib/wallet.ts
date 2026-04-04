/**
 * Wallet Management - Core wallet operations
 *
 * Handles wallet creation, import, encryption/decryption, locking/unlocking, and signing.
 * Exports: walletManager, WalletManager class, WalletBalance, TransactionData
 */
import { ethers } from 'ethers';
import {
  secureStorage, type StoredWallet,
  saveWalletV2, loadWalletV2, hasWalletV2, deleteWalletV2,
} from './encrypted-storage';
import { NETWORKS, type NetworkConfig, getNetworkById, getNetworkByChainId } from './networks';
import { fallbackProvider, RPC_FALLBACKS } from './rpc-provider';
import { fetchCryptoPrices } from './price-service';

export interface WalletBalance {
  networkId: number;
  balance: string;
  usdValue: number | null; // null when price data is unavailable
  symbol: string;
}

export interface TransactionData {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasPrice?: string;
  gasUsed?: string;
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: number;
  timestamp: Date;
  networkId: number;
  type: 'sent' | 'received';
  usdValue?: number;
}

class WalletManager {
  private wallet: ethers.Wallet | null = null;
  private providers: Map<number, ethers.JsonRpcProvider> = new Map();
  private storedPrivateKey: string | null = null;
  private storedMnemonic: string | null = null; // cached after unlock for exportMnemonic()
  private signers: Map<number, ethers.Wallet> = new Map(); // Connected signers per network

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Don't pre-initialize providers to avoid connection errors
    // They will be created on-demand using the fallback system
  }

  getProvider(networkId: number): ethers.JsonRpcProvider | null {
    return this.providers.get(networkId) || null;
  }

  getWallet(): ethers.Wallet | null {
    return this.wallet;
  }

  // Get connected signer for specific network or basic wallet signer
  async getSigner(networkId?: number): Promise<ethers.Wallet | null> {
    if (!this.wallet) {
      // Try to restore wallet first
      if (this.storedPrivateKey) {
        this.restoreWalletFromMemory();
      }
      if (!this.wallet) {
        return null;
      }
    }

    // If no network specified, return basic wallet instance
    if (!networkId) {
      return this.wallet;
    }

    // Check if we already have a connected signer for this network
    if (this.signers.has(networkId)) {
      const signer = this.signers.get(networkId)!;
      return signer;
    }

    // Create new connected signer
    // First try by ID, then by chainId for backward compatibility
    let network = getNetworkById(networkId);
    if (!network) {
      network = getNetworkByChainId(networkId);
    }
    if (!network) {
      return null;
    }

    let provider = await fallbackProvider.getWorkingProvider(network.chainId);

    // If health-checked provider unavailable, fall back to direct connection
    if (!provider) {
      const rpcUrls = RPC_FALLBACKS[network.chainId] || [];
      for (const rpcUrl of rpcUrls) {
        try {
          provider = new ethers.JsonRpcProvider(rpcUrl);
          break;
        } catch {
          continue;
        }
      }
    }

    if (!provider) {
      return null;
    }

    const connectedSigner = this.wallet.connect(provider);
    this.signers.set(networkId, connectedSigner);
    return connectedSigner;
  }

  // Generate new wallet with mnemonic
  generateWallet(): { mnemonic: string; privateKey: string; address: string } {
    const wallet = ethers.Wallet.createRandom();
    return {
      mnemonic: wallet.mnemonic?.phrase || '',
      privateKey: wallet.privateKey,
      address: wallet.address
    };
  }

  // Import wallet from mnemonic
  importFromMnemonic(mnemonic: string): { privateKey: string; address: string } {
    try {
      const cleaned = mnemonic.trim().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      const wallet = ethers.Wallet.fromPhrase(cleaned);
      return {
        privateKey: wallet.privateKey,
        address: wallet.address
      };
    } catch (error) {
      throw new Error('Invalid mnemonic phrase');
    }
  }

  // Import wallet from private key
  importFromPrivateKey(privateKey: string): { address: string } {
    try {
      const wallet = new ethers.Wallet(privateKey);
      return {
        address: wallet.address
      };
    } catch (error) {
      throw new Error('Invalid private key');
    }
  }

  // ── Helpers shared by create / import ───────────────────────────────────────

  private async _saveV2AndActivate(
    address: string, name: string, privateKey: string,
    mnemonic: string | null, isImported: boolean, pin: string
  ): Promise<StoredWallet> {
    const createdAt = new Date().toISOString();
    await saveWalletV2({ address, name, privateKey, mnemonic, isImported, createdAt }, pin);
    secureStorage.setPassword(pin);
    secureStorage.setSessionPrivateKey(privateKey);
    this.storedPrivateKey = privateKey;
    this.storedMnemonic = mnemonic;
    this.wallet = new ethers.Wallet(privateKey);
    // Return a StoredWallet struct with v2 markers (no key material in the struct)
    return { address, name, encryptedPrivateKey: 'v2', encryptedMnemonic: mnemonic ? 'v2' : undefined, isImported, createdAt };
  }

  // Create and save wallet
  async createWallet(password: string, name: string = 'Main Account'): Promise<StoredWallet> {
    const { mnemonic, privateKey, address } = this.generateWallet();
    return this._saveV2AndActivate(address, name, privateKey, mnemonic, false, password);
  }

  // Create and save wallet using a specific mnemonic (used after showing it to the user)
  async createWalletFromMnemonic(password: string, mnemonic: string, name: string = 'Main Account'): Promise<StoredWallet> {
    const cleaned = mnemonic.trim().replace(/\s+/g, ' ');
    const { privateKey, address } = this.importFromMnemonic(cleaned);
    return this._saveV2AndActivate(address, name, privateKey, cleaned, false, password);
  }

  // Import and save wallet
  async importWallet(
    password: string,
    input: string,
    type: 'mnemonic' | 'private_key',
    name: string = 'Imported Account'
  ): Promise<StoredWallet> {
    let privateKey: string;
    let address: string;
    let mnemonic: string | null = null;

    if (type === 'mnemonic') {
      const cleaned = input.trim().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      const imported = this.importFromMnemonic(cleaned);
      privateKey = imported.privateKey;
      address = imported.address;
      mnemonic = cleaned;
    } else {
      const trimmedKey = input.trim();
      const imported = this.importFromPrivateKey(trimmedKey);
      privateKey = trimmedKey;
      address = imported.address;
    }

    return this._saveV2AndActivate(address, name, privateKey, mnemonic, true, password);
  }

  // Unlock existing wallet — tries v2 (PBKDF2) first, falls back to v1 (legacy
  // CryptoJS) and auto-migrates v1 wallets to v2 on success.
  async unlockWallet(password: string): Promise<StoredWallet | null> {
    const walletExists = !!localStorage.getItem('wallet_encrypted');

    // ── V2 path (PBKDF2 + AES-GCM) ──
    if (hasWalletV2()) {
      try {
        const data = await loadWalletV2(password);
        if (!data) throw new Error('No v2 wallet data');
        this.storedPrivateKey = data.privateKey;
        this.storedMnemonic = data.mnemonic;
        this.wallet = new ethers.Wallet(data.privateKey);
        secureStorage.setPassword(password);
        secureStorage.setSessionPrivateKey(data.privateKey);
        return {
          address: data.address, name: data.name,
          encryptedPrivateKey: 'v2', encryptedMnemonic: data.mnemonic ? 'v2' : undefined,
          isImported: data.isImported, createdAt: data.createdAt,
        };
      } catch (err: any) {
        secureStorage.clearPassword();
        this.storedPrivateKey = null;
        this.storedMnemonic = null;
        throw new Error(walletExists ? 'Incorrect PIN' : 'No wallet found');
      }
    }

    // ── V1 legacy path (CryptoJS raw PIN) — migrate to v2 on success ──
    try {
      secureStorage.setPassword(password);
      const storedWallet = secureStorage.loadWallet();
      if (!storedWallet) throw new Error(walletExists ? 'Incorrect PIN' : 'No wallet found');

      const privateKey = secureStorage.decrypt(storedWallet.encryptedPrivateKey);
      const mnemonic = storedWallet.encryptedMnemonic
        ? (() => { try { return secureStorage.decrypt(storedWallet.encryptedMnemonic!); } catch { return null; } })()
        : null;

      // Migrate to v2 silently in the background
      saveWalletV2({ address: storedWallet.address, name: storedWallet.name, privateKey, mnemonic, isImported: storedWallet.isImported, createdAt: storedWallet.createdAt }, password)
        .catch(() => {}); // migration failure is non-fatal

      this.storedPrivateKey = privateKey;
      this.storedMnemonic = mnemonic;
      this.wallet = new ethers.Wallet(privateKey);
      secureStorage.setSessionPrivateKey(privateKey);
      return storedWallet;
    } catch (error) {
      secureStorage.clearPassword();
      this.storedPrivateKey = null;
      this.storedMnemonic = null;
      throw error;
    }
  }

  // Lock wallet
  lockWallet(): void {
    this.wallet = null;
    this.storedPrivateKey = null;
    this.storedMnemonic = null;
    this.signers.clear();
    secureStorage.clearPassword();
  }

  // Check if wallet is unlocked
  isUnlocked(): boolean {
    // If wallet instance is null but we have private key in memory, restore it
    if (!this.wallet && (this.storedPrivateKey || secureStorage.isUnlocked())) {
      this.restoreWalletFromMemory();
    }
    return this.wallet !== null;
  }

  // Restore wallet instance using stored private key or session storage
  restoreWalletFromMemory(): void {
    try {
      
      // Memory cache only — no sessionStorage fallback (XSS risk)
      if (this.storedPrivateKey) {
        this.wallet = new ethers.Wallet(this.storedPrivateKey);
        return;
      }
      
      // Try to decrypt from storage (legacy v1 only)
      try {
        const storedWallet = secureStorage.loadWallet();
        if (storedWallet) {
          const privateKey = secureStorage.decrypt(storedWallet.encryptedPrivateKey);
          this.storedPrivateKey = privateKey;
          this.wallet = new ethers.Wallet(privateKey);
          secureStorage.setSessionPrivateKey(privateKey);
          return;
        }
      } catch (error) {
      }
      
    } catch (error) {
    }
  }

  // Get current wallet address
  getAddress(): string | null {
    // If wallet instance is null but we have private key in memory, restore it
    if (!this.wallet && (this.storedPrivateKey || secureStorage.isUnlocked())) {
      this.restoreWalletFromMemory();
    }
    return this.wallet?.address || null;
  }

  // Restore wallet from private key (for session restoration)
  restoreWallet(privateKey: string): void {
    this.wallet = new ethers.Wallet(privateKey);
  }

  // Get wallet balance for specific network
  async getBalance(networkId: number): Promise<WalletBalance | null> {
    if (!this.wallet) throw new Error('Wallet not unlocked');
    
    const network = getNetworkById(networkId);
    if (!network) return null;

    try {
      const [balanceEth, prices] = await Promise.all([
        fallbackProvider.getBalance(this.wallet.address, network.chainId),
        fetchCryptoPrices(),
      ]);

      if (balanceEth === null) {
        return null;
      }

      // Lisk uses ETH as its native gas token; usdValue is null if price unavailable
      const usdValue = prices?.eth ? parseFloat(balanceEth) * prices.eth : null;

      return {
        networkId,
        balance: balanceEth,
        usdValue,
        symbol: network.symbol
      };
    } catch (error) {
      return null;
    }
  }

  // Get all network balances
  async getAllBalances(): Promise<WalletBalance[]> {
    const balances: WalletBalance[] = [];
    
    for (const network of NETWORKS) {
      const balance = await this.getBalance(network.id);
      if (balance) {
        balances.push(balance);
      }
    }
    
    return balances;
  }

  private async ensureGasForNetwork(walletAddress: string, networkId: number): Promise<void> {
    try {
      const network = getNetworkById(networkId) || getNetworkByChainId(networkId);
      if (!network) return;
      const provider = await fallbackProvider.getWorkingProvider(network.chainId);
      if (!provider) return;
      const balance = await provider.getBalance(walletAddress);
      const minGas = ethers.parseEther("0.001");
      if (balance < minGas) {
        const res = await fetch("/api/gas/sponsor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress, chainId: network.chainId }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.sponsored) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
    } catch {
    }
  }

  // ── Server-assisted signing helpers ──────────────────────────────────
  // All RPC calls (nonce, gas, fee data) are made by the SERVER so the
  // browser never needs to contact an RPC endpoint directly (avoids CORS).

  // Step 1: ask the server to build the ready-to-sign tx object
  private async getTxParams(chainId: number, from: string, to: string, data: string, value: bigint): Promise<any> {
    const res = await fetch('/api/wallet/tx-params', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainId, from, to, data, value: value.toString() }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Failed to fetch tx params');
    return body.tx;
  }

  // Step 2: sign offline (no provider needed — pure crypto)
  private async signOffline(txParams: any): Promise<string> {
    if (!this.wallet) throw new Error('Wallet not unlocked');
    // Reconstruct bigint fields that were serialised as strings by the server
    const tx: any = { ...txParams };
    for (const field of ['value', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']) {
      if (tx[field] !== undefined) tx[field] = BigInt(tx[field]);
    }
    return this.wallet.signTransaction(tx);
  }

  // Step 3: broadcast via server (avoids eth_sendRawTransaction CORS block)
  private async broadcastViaServer(signedTx: string, chainId: number): Promise<string> {
    const res = await fetch('/api/wallet/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTx, chainId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Broadcast failed');
    return data.hash;
  }

  // Send native ETH/BNB — fully server-assisted (no browser RPC calls)
  async sendTransaction(
    to: string,
    amount: string,
    networkId: number
  ): Promise<{ hash: string; transaction: any }> {
    if (!this.wallet) throw new Error('Wallet not unlocked - signer not available');
    const network = getNetworkById(networkId);
    if (!network) throw new Error('Unknown network');
    const chainId = network.chainId;
    const from = this.wallet.address;
    const value = ethers.parseEther(amount);

    const txParams = await this.getTxParams(chainId, from, to, '0x', value);
    const signedTx = await this.signOffline(txParams);
    const hash    = await this.broadcastViaServer(signedTx, chainId);
    return { hash, transaction: { hash } };
  }

  // Send ERC-20 token — fully server-assisted (no browser RPC calls)
  async sendTokenTransaction(
    to: string,
    amount: string,
    networkId: number,
    tokenAddress: string,
    tokenDecimals: number
  ): Promise<{ hash: string; transaction: any }> {
    if (!this.wallet) throw new Error('Wallet not unlocked - signer not available');
    const network = getNetworkById(networkId);
    if (!network) throw new Error('Unknown network');
    const chainId = network.chainId;
    const from = this.wallet.address;

    await this.ensureGasForNetwork(from, networkId);

    // Encode calldata offline — no network needed
    const iface = new ethers.Interface(["function transfer(address,uint256) returns (bool)"]);
    const tokenAmount = ethers.parseUnits(amount, tokenDecimals);
    const data = iface.encodeFunctionData("transfer", [to, tokenAmount]);

    const txParams = await this.getTxParams(chainId, from, tokenAddress, data, 0n);
    const signedTx = await this.signOffline(txParams);
    const hash    = await this.broadcastViaServer(signedTx, chainId);
    return { hash, transaction: { hash } };
  }

  // Send ERC-20 with fee split — fully server-assisted
  async sendTokenTransactionWithFee(
    to: string,
    amount: string,
    networkId: number,
    tokenAddress: string,
    tokenDecimals: number,
    feeAmount: string,
    treasuryAddress: string
  ): Promise<{ hash: string; feeTxHash: string | null; transaction: any }> {
    if (!this.wallet) throw new Error('Wallet not unlocked - signer not available');
    const network = getNetworkById(networkId);
    if (!network) throw new Error('Unknown network');
    const chainId = network.chainId;
    const from = this.wallet.address;

    await this.ensureGasForNetwork(from, networkId);

    const iface = new ethers.Interface(["function transfer(address,uint256) returns (bool)"]);
    const decimalPlaces = Math.min(tokenDecimals, 18);
    const netAmount = (parseFloat(amount) - parseFloat(feeAmount)).toFixed(decimalPlaces);
    const netTokenAmount = ethers.parseUnits(netAmount, tokenDecimals);

    // Main transfer
    const data1 = iface.encodeFunctionData("transfer", [to, netTokenAmount]);
    const txParams1 = await this.getTxParams(chainId, from, tokenAddress, data1, 0n);
    const signedTx1 = await this.signOffline(txParams1);
    const hash = await this.broadcastViaServer(signedTx1, chainId);

    // Fee transfer (nonce + 1 to avoid collision)
    let feeTxHash: string | null = null;
    try {
      const feeTokenAmount = ethers.parseUnits(parseFloat(feeAmount).toFixed(decimalPlaces), tokenDecimals);
      const data2 = iface.encodeFunctionData("transfer", [treasuryAddress, feeTokenAmount]);
      const txParams2 = await this.getTxParams(chainId, from, tokenAddress, data2, 0n);
      txParams2.nonce = txParams1.nonce + 1; // ensure ordering
      const signedTx2 = await this.signOffline(txParams2);
      feeTxHash = await this.broadcastViaServer(signedTx2, chainId);
    } catch {
      // Fee collection failure is non-fatal
    }

    return { hash, feeTxHash, transaction: { hash } };
  }

  // Estimate gas fee
  async estimateGasFee(to: string, amount: string, networkId: number, tokenAddress?: string, tokenDecimals?: number): Promise<string> {
    // Get connected signer for the specific network
    const signer = await this.getSigner(networkId);
    
    if (!signer) {
      throw new Error('Wallet not unlocked');
    }
    
    const provider = signer.provider as ethers.JsonRpcProvider;
    if (!provider) throw new Error('No provider available for gas estimation');

    try {
      let gasEstimate: bigint;

      if (tokenAddress && tokenDecimals) {
        // Token transfer gas estimation
        const erc20Abi = [
          "function transfer(address to, uint256 amount) returns (bool)"
        ];
        
        const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, signer);
        const tokenAmount = ethers.parseUnits(amount, tokenDecimals);
        
        gasEstimate = await tokenContract.transfer.estimateGas(to, tokenAmount);
      } else {
        // Native ETH transfer gas estimation
        const value = ethers.parseEther(amount);
        gasEstimate = await provider.estimateGas({
          from: signer.address,
          to,
          value
        });
      }

      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei');
      
      const gasFee = gasEstimate * gasPrice;
      return ethers.formatEther(gasFee);
    } catch (error) {
      return '0.001'; // Fallback estimate
    }
  }

  // Get transaction history
  async getTransactionHistory(networkId: number, limit: number = 10): Promise<TransactionData[]> {
    if (!this.wallet) throw new Error('Wallet not unlocked');
    
    const provider = this.getProvider(networkId);
    if (!provider) return [];

    try {
      // In a real app, you'd use a service like Etherscan API or Alchemy
      // For demo purposes, we'll return mock data
      const mockTransactions: TransactionData[] = [
        {
          hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          from: '0x742d35Cc6634C0532925a3b8D4c5A743E5d5c43E',
          to: this.wallet.address,
          value: '0.5',
          status: 'confirmed',
          blockNumber: 18500000,
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
          networkId,
          type: 'received',
          usdValue: 500
        },
        {
          hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          from: this.wallet.address,
          to: '0x742d35Cc6634C0532925a3b8D4c5A743E5d5c43E',
          value: '0.1',
          status: 'pending',
          timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
          networkId,
          type: 'sent',
          usdValue: 100
        }
      ];

      return mockTransactions.slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  // Export private key
  exportPrivateKey(): string {
    if (!this.wallet) throw new Error('Wallet not unlocked');
    return this.wallet.privateKey;
  }

  // Export mnemonic — uses the in-memory cache populated on unlock.
  exportMnemonic(): string | null {
    // v2: returned from memory (populated during unlock / create)
    if (this.storedMnemonic) return this.storedMnemonic;
    // v1 legacy fallback
    const storedWallet = secureStorage.loadWallet();
    if (!storedWallet?.encryptedMnemonic) return null;
    try {
      return secureStorage.decrypt(storedWallet.encryptedMnemonic);
    } catch {
      return null;
    }
  }
}

export const walletManager = new WalletManager();
