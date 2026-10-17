/**
 * Wallet Context - Global React context for wallet connection state
 *
 * Provides wallet address and connection status to any component in the app
 * without passing props manually through every level of the component tree.
 * Wraps the app at the top level in App.tsx.
 * Exports: WalletProvider, useWalletContext
 */
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface WalletContextType {
  address: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const ethereum = (window as Window & { ethereum?: { request: (args: { method: string }) => Promise<unknown>; on?: (event: string, cb: (...args: unknown[]) => void) => void; removeListener?: (event: string, cb: (...args: unknown[]) => void) => void } }).ethereum;
    if (!ethereum) return;
    const syncAccounts = (accounts: unknown) => {
      const account = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : null;
      setAddress(account);
      setIsConnected(Boolean(account));
    };
    const onAccountsChanged = (accounts: unknown) => syncAccounts(accounts);
    void ethereum.request({ method: 'eth_accounts' }).then(syncAccounts).catch(() => syncAccounts([]));
    ethereum.on?.('accountsChanged', onAccountsChanged);
    return () => ethereum.removeListener?.('accountsChanged', onAccountsChanged);
  }, []);

  const connect = async () => {
    const ethereum = (window as Window & { ethereum?: { request: (args: { method: string }) => Promise<unknown> } }).ethereum;
    if (!ethereum) throw new Error('No injected wallet was found. Install or open a wallet to connect.');
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    const account = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : null;
    if (!account) throw new Error('The wallet returned no connected account.');
    setAddress(account);
    setIsConnected(true);
  };

  const disconnect = () => {
    setAddress(null);
    setIsConnected(false);
  };

  return (
    <WalletContext.Provider value={{ address, isConnected, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
