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
    // Auto-connect with demo wallet for contract functionality
    const demoAddress = "0xef5Bed7c221c85A2c88e3c0223ee45482d6F037d";
    setAddress(demoAddress);
    setIsConnected(true);
    sessionStorage.setItem('wallet_address', demoAddress);
  }, []);

  const connect = async () => {
    // For demo purposes, use a fixed address
    const demoAddress = "0xef5Bed7c221c85A2c88e3c0223ee45482d6F037d";
    setAddress(demoAddress);
    setIsConnected(true);
    sessionStorage.setItem('wallet_address', demoAddress);
  };

  const disconnect = () => {
    setAddress(null);
    setIsConnected(false);
    sessionStorage.removeItem('wallet_address');
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