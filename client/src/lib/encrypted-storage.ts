/**
 * Secure Storage - Encrypted local storage for wallet data (AES-256)
 *
 * Handles wallet encryption/decryption, session management, and settings persistence.
 * Exports: secureStorage, SecureStorage class, StoredWallet, WalletSettings
 */
import CryptoJS from 'crypto-js';

const STORAGE_KEY = 'cryptowallet_data';
const WALLET_KEY = 'wallet_encrypted';
const SETTINGS_KEY = 'wallet_settings';

export interface StoredWallet {
  address: string;
  name: string;
  encryptedPrivateKey: string;
  encryptedMnemonic?: string;
  isImported: boolean;
  createdAt: string;
}

export interface WalletSettings {
  selectedNetworkId: number;
  theme: 'light' | 'dark';
  currency: 'USD' | 'EUR' | 'GBP';
  autoLock: boolean;
  autoLockTimeout: number; // minutes
}

class SecureStorage {
  private password: string | null = null;
  private readonly SESSION_PASSWORD_KEY = 'wallet_session_key';
  private readonly SESSION_PRIVATE_KEY = 'wallet_private_key_session';

  setPassword(password: string): void {
    this.password = password;
    // Store password in session storage for transaction signing
    sessionStorage.setItem(this.SESSION_PASSWORD_KEY, password);
  }

  clearPassword(): void {
    this.password = null;
    sessionStorage.removeItem(this.SESSION_PASSWORD_KEY);
    sessionStorage.removeItem(this.SESSION_PRIVATE_KEY);
  }

  // Store decrypted private key in session for transaction signing
  setSessionPrivateKey(privateKey: string): void {
    sessionStorage.setItem(this.SESSION_PRIVATE_KEY, privateKey);
  }

  // Get decrypted private key from session
  getSessionPrivateKey(): string | null {
    return sessionStorage.getItem(this.SESSION_PRIVATE_KEY);
  }

  isUnlocked(): boolean {
    if (this.password !== null) return true;
    
    // Try to restore password from session storage
    const sessionPassword = sessionStorage.getItem(this.SESSION_PASSWORD_KEY);
    if (sessionPassword) {
      this.password = sessionPassword;
      return true;
    }
    
    return false;
  }

  private ensurePassword(): void {
    if (!this.password) {
      const sessionPassword = sessionStorage.getItem(this.SESSION_PASSWORD_KEY);
      if (sessionPassword) {
        this.password = sessionPassword;
      }
    }
  }

  encrypt(data: string): string {
    this.ensurePassword();
    if (!this.password) {
      throw new Error('Wallet is locked');
    }
    return CryptoJS.AES.encrypt(data, this.password).toString();
  }

  decrypt(encryptedData: string): string {
    this.ensurePassword();
    if (!this.password) {
      throw new Error('Wallet is locked');
    }
    
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, this.password);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      if (!decrypted || decrypted.length === 0) {
        throw new Error('Decryption returned empty result');
      }
      return decrypted;
    } catch (error) {
      throw new Error('Invalid password or corrupted data');
    }
  }

  // Alternative decryption method with password verification
  decryptWithPasswordCheck(encryptedData: string): string {
    this.ensurePassword();
    
    // Try current password first
    if (this.password) {
      try {
        const bytes = CryptoJS.AES.decrypt(encryptedData, this.password);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        if (decrypted && decrypted.length > 0) {
          return decrypted;
        }
      } catch (error) {
      }
    }
    
    // Try session private key as fallback
    const sessionKey = this.getSessionPrivateKey();
    if (sessionKey) {
      try {
        const bytes = CryptoJS.AES.decrypt(encryptedData, sessionKey);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        if (decrypted && decrypted.length > 0) {
          return decrypted;
        }
      } catch (error) {
      }
    }
    
    throw new Error('Unable to decrypt data with available keys');
  }

  saveWallet(wallet: StoredWallet): void {
    const encryptedWallet = this.encrypt(JSON.stringify(wallet));
    localStorage.setItem(WALLET_KEY, encryptedWallet);
  }

  loadWallet(): StoredWallet | null {
    try {
      const encryptedWallet = localStorage.getItem(WALLET_KEY);
      if (!encryptedWallet) {
        return null;
      }
      
      // Ensure password is restored from session storage
      this.ensurePassword();
      
      if (!this.password) {
        return null;
      }
      
      const decryptedData = this.decrypt(encryptedWallet);
      const wallet = JSON.parse(decryptedData);
      return wallet;
    } catch (error) {
      return null;
    }
  }

  walletExists(): boolean {
    return localStorage.getItem(WALLET_KEY) !== null;
  }

  deleteWallet(): void {
    localStorage.removeItem(WALLET_KEY);
    this.clearPassword();
  }

  saveSettings(settings: WalletSettings): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  loadSettings(): WalletSettings {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    
    // Default settings
    return {
      selectedNetworkId: 1,
      theme: 'light',
      currency: 'USD',
      autoLock: true,
      autoLockTimeout: 15
    };
  }

  // Session storage for temporary data
  setSessionData(key: string, data: any): void {
    sessionStorage.setItem(key, JSON.stringify(data));
  }

  getSessionData<T>(key: string): T | null {
    const stored = sessionStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  }

  clearSessionData(key: string): void {
    sessionStorage.removeItem(key);
  }

  // Simple wallet session management using localStorage
  setWalletUnlocked(wallet: StoredWallet): void {
    localStorage.setItem('wallet_unlocked', JSON.stringify({
      address: wallet.address,
      name: wallet.name,
      isUnlocked: true,
      timestamp: Date.now()
    }));
  }

  isWalletUnlocked(): boolean {
    const session = localStorage.getItem('wallet_unlocked');
    if (!session) return false;
    
    try {
      const parsed = JSON.parse(session);
      // Check if session is less than 24 hours old
      if (Date.now() - parsed.timestamp > 86400000) {
        this.clearWalletUnlocked();
        return false;
      }
      return parsed.isUnlocked === true;
    } catch {
      return false;
    }
  }

  getWalletUnlockedData(): { address: string; name: string } | null {
    const session = localStorage.getItem('wallet_unlocked');
    if (!session) return null;
    
    try {
      const parsed = JSON.parse(session);
      return { address: parsed.address, name: parsed.name };
    } catch {
      return null;
    }
  }

  clearWalletUnlocked(): void {
    localStorage.removeItem('wallet_unlocked');
  }
}

export const secureStorage = new SecureStorage();
