/**
 * useTransactions Hook - Fetches and manages wallet transaction history
 *
 * Loads on-chain transaction history for the connected wallet across networks.
 * Also handles sending USDC, tracking pending transactions, and gas sponsorship.
 * Used by the Wallet page to display activity and trigger transfers.
 * Exports: useTransactions
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletManager, type WalletBalance, type TransactionData } from '@/lib/wallet';
import { fallbackProvider } from '@/lib/rpc-provider';
import { tokenManager, getTokensForNetwork } from '@/lib/tokens';
import { NETWORKS } from '@/lib/networks';
import { useWallet } from './use-wallet';
import { useWalletBalances } from './use-wallet-balances';
import { useToast } from '@/hooks/use-toast';
import { getEthPrice, fetchCryptoPrices } from '@/lib/price-service';

export function useTransactions(networkId: number) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { address } = useWallet();
  
  // Use the new real-time balance system
  const walletBalances = useWalletBalances(networkId);
  
  // Legacy compatibility - map new balance data to old format
  const balance = useMemo(() => {
    if (!walletBalances.selectedNetworkBalance) return null;
    const networkBalance = walletBalances.selectedNetworkBalance;
    return {
      balance: networkBalance.nativeBalance,
      networkId: networkBalance.networkId,
      symbol: networkBalance.nativeSymbol
    };
  }, [walletBalances.selectedNetworkBalance]);

  const [ethPrice, setEthPrice] = useState<number | null>(getEthPrice());
  
  useEffect(() => {
    fetchCryptoPrices().then(prices => {
      if (prices?.eth) setEthPrice(prices.eth);
    });
  }, []);
  
  const allBalances = useMemo(() => {
    return walletBalances.balances.map(balance => {
      const network = NETWORKS.find(n => n.id === balance.networkId);
      const balanceValue = parseFloat(balance.nativeBalance);
      const usdValue = balanceValue * ethPrice;
      
      return {
        networkId: balance.networkId,
        balance: balance.nativeBalance,
        symbol: balance.nativeSymbol,
        usdValue,
        network
      };
    }).filter(b => parseFloat(b.balance) > 0);
  }, [walletBalances.balances, ethPrice]);

  const tokenBalances = useMemo(() => {
    if (!walletBalances.selectedNetworkBalance) return [];
    return walletBalances.selectedNetworkBalance.tokenBalances;
  }, [walletBalances.selectedNetworkBalance]);

  // Get transaction history from backend API
  const transactionsQuery = useQuery({
    queryKey: ['transactions', networkId, address],
    queryFn: async () => {
      if (!address) return [];
      try {
        // Convert internal network ID to chainId for the API
        const network = NETWORKS.find(n => n.id === networkId);
        const chainId = network?.chainId || 1135;
        const response = await fetch(`/api/wallet/${address}/transactions?networkId=${chainId}`);
        if (!response.ok) {
          return [];
        }
        const data = await response.json();
        return data.transactions || [];
      } catch (error) {
        return [];
      }
    },
    enabled: !!address,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const sendTransactionMutation = useMutation({
    mutationFn: async ({ 
      to, 
      amount, 
      networkId, 
      tokenAddress, 
      tokenDecimals,
      feeAmount,
      treasuryAddress,
    }: { 
      to: string; 
      amount: string; 
      networkId: number; 
      tokenAddress?: string; 
      tokenDecimals?: number; 
      feeAmount?: string;
      treasuryAddress?: string;
    }) => {
      if (tokenAddress && tokenDecimals && feeAmount && treasuryAddress) {
        const result = await walletManager.sendTokenTransactionWithFee(to, amount, networkId, tokenAddress, tokenDecimals, feeAmount, treasuryAddress);
        try {
          const network = NETWORKS.find(n => n.id === networkId);
          await fetch("/api/fees/record", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              txHash: result.hash,
              feeTxHash: result.feeTxHash,
              fromWallet: address,
              toWallet: to,
              transferAmount: amount,
              feeAmount,
              feePercent: "0.3",
              token: "USDC",
              chainId: network?.chainId || 1135,
            }),
          });
        } catch {}
        return result;
      } else if (tokenAddress && tokenDecimals) {
        return walletManager.sendTokenTransaction(to, amount, networkId, tokenAddress, tokenDecimals);
      } else {
        return walletManager.sendTransaction(to, amount, networkId);
      }
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Transaction Sent",
        description: `Transaction hash: ${data.hash.slice(0, 10)}...`,
      });

      walletBalances.refreshAll();
      queryClient.invalidateQueries({ queryKey: ['transactions', networkId] });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Transaction Failed",
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Gas estimation
  const [gasEstimate, setGasEstimate] = useState<string>('');
  const [isEstimatingGas, setIsEstimatingGas] = useState(false);

  const estimateGas = useCallback(async (to: string, amount: string, networkId: number, tokenAddress?: string, tokenDecimals?: number) => {
    if (!to || !amount || !walletManager.isUnlocked()) return;

    setIsEstimatingGas(true);
    try {
      const estimate = await walletManager.estimateGasFee(to, amount, networkId, tokenAddress, tokenDecimals);
      setGasEstimate(estimate);
    } catch (error) {
      setGasEstimate('0.001'); // Fallback
    } finally {
      setIsEstimatingGas(false);
    }
  }, []);

  // Calculate total portfolio value including ETH and tokens
  const totalValue = useMemo(() => {
    return walletBalances.totalValue;
  }, [walletBalances.totalValue]);



  // Refresh all data
  const refreshAll = useCallback(() => {
    walletBalances.refreshAll();
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
  }, [walletBalances, queryClient]);

  return {
    // Balance data
    balance,
    allBalances,
    tokenBalances,
    totalValue,
    isLoadingBalance: walletBalances.isLoading,
    balanceError: walletBalances.error,

    // Transaction data
    transactions: transactionsQuery.data || [],
    isLoadingTransactions: transactionsQuery.isLoading,
    transactionsError: transactionsQuery.error,

    // Send transaction
    sendTransaction: sendTransactionMutation.mutate,
    isSendingTransaction: sendTransactionMutation.isPending,
    sendTransactionError: sendTransactionMutation.error,

    // Gas estimation
    gasEstimate,
    isEstimatingGas,
    estimateGas,

    // Utilities
    formatCurrency: walletBalances.formatCurrency,
    formatCrypto: walletBalances.formatCrypto,
    refreshAll,
  };
}
