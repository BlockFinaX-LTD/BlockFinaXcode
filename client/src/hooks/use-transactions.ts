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
import { ethers } from 'ethers';
import { walletManager, type WalletBalance, type TransactionData } from '@/lib/wallet';
import { fallbackProvider } from '@/lib/rpc-provider';
import { tokenManager, getTokensForNetwork } from '@/lib/tokens';
import { NETWORKS, getNetworkById } from '@/lib/networks';
import { useWallet } from './use-wallet';
import { useWalletBalances } from './use-wallet-balances';
import { useToast } from '@/hooks/use-toast';
import { getEthPrice, getBnbPrice, fetchCryptoPrices } from '@/lib/price-service';

// ── Server-assisted signing (zero browser RPC calls) ──────────────────────
// Fetches tx params (nonce, gas, chainId) from the server so the browser
// never needs to contact an RPC directly. Private key never leaves the device.

async function fetchTxParams(chainId: number, from: string, to: string, data: string, value: bigint) {
  const res = await fetch('/api/wallet/tx-params', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chainId, from, to, data, value: value.toString() }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Failed to prepare transaction');
  return body.tx;
}

function rehydrateTx(txParams: any) {
  const tx = { ...txParams };
  for (const field of ['value', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']) {
    if (tx[field] !== undefined) tx[field] = BigInt(tx[field]);
  }
  return tx;
}

async function broadcastTx(signedTx: string, chainId: number): Promise<string> {
  const res = await fetch('/api/wallet/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedTx, chainId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Broadcast failed');
  return body.hash;
}

async function sendTokenViaServer(
  walletAddress: string,
  chainId: number,
  tokenAddress: string,
  recipient: string,
  amount: string,
  tokenDecimals: number,
): Promise<string> {
  const iface = new ethers.Interface(['function transfer(address,uint256) returns (bool)']);
  const tokenAmount = ethers.parseUnits(amount, tokenDecimals);
  const data = iface.encodeFunctionData('transfer', [recipient, tokenAmount]);
  const params = await fetchTxParams(chainId, walletAddress, tokenAddress, data, 0n);
  const signedTx = await walletManager.signOffline(params);
  return broadcastTx(signedTx, chainId);
}

async function sendNativeViaServer(
  walletAddress: string,
  chainId: number,
  recipient: string,
  amount: string,
): Promise<string> {
  const value = ethers.parseEther(amount);
  const params = await fetchTxParams(chainId, walletAddress, recipient, '0x', value);
  const signedTx = await walletManager.signOffline(params);
  return broadcastTx(signedTx, chainId);
}

async function ensureGas(walletAddress: string, chainId: number) {
  try {
    const res = await fetch('/api/gas/sponsor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, chainId }),
    });
    if (res.ok) {
      const data = await res.json();
      // Only wait if gas was actually sent — avoids unnecessary 2 s delay
      if (data.sponsored) await new Promise(r => setTimeout(r, 2000));
    }
  } catch { /* non-fatal */ }
}

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
  
  const [bnbPrice, setBnbPrice] = useState<number | null>(getBnbPrice());
  useEffect(() => {
    fetchCryptoPrices().then(prices => {
      if (prices?.bnb) setBnbPrice(prices.bnb);
    });
  }, []);

  const allBalances = useMemo(() => {
    return walletBalances.balances.map(balance => {
      const network = NETWORKS.find(n => n.id === balance.networkId);
      const balanceValue = parseFloat(balance.nativeBalance);
      const symbol = balance.nativeSymbol;
      const pricePerToken = symbol === 'BNB' ? (bnbPrice ?? 0) : (ethPrice ?? 0);
      const usdValue = balanceValue * pricePerToken;

      return {
        networkId: balance.networkId,
        balance: balance.nativeBalance,
        symbol,
        usdValue,
        network
      };
    });
  }, [walletBalances.balances, ethPrice, bnbPrice]);

  const tokenBalances = useMemo(() => {
    if (!walletBalances.selectedNetworkBalance) return [];
    return walletBalances.selectedNetworkBalance.tokenBalances;
  }, [walletBalances.selectedNetworkBalance]);

  // Get transaction history from backend API — fetch all chains
  const transactionsQuery = useQuery({
    queryKey: ['transactions', address],
    queryFn: async () => {
      if (!address) return [];
      try {
        const response = await fetch(`/api/wallet/${address}/transactions`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.transactions || [];
      } catch (error) {
        return [];
      }
    },
    enabled: !!address,
    refetchInterval: 30000,
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
      // Get wallet address — works for both local wallets and Lit PKPs
      const walletAddress = walletManager.getAddress();
      if (!walletAddress) throw new Error('Wallet is locked — please unlock first');

      const network = getNetworkById(networkId);
      if (!network) throw new Error('Unknown network selected');
      const chainId = network.chainId;

      // Ensure gas is available (non-fatal if it fails)
      await ensureGas(walletAddress, chainId);

      if (tokenAddress && tokenDecimals && feeAmount && treasuryAddress) {
        // Stablecoin send WITH fee split
        const decimalPlaces = Math.min(tokenDecimals, 18);
        const netAmount = (parseFloat(amount) - parseFloat(feeAmount)).toFixed(decimalPlaces);

        const hash = await sendTokenViaServer(walletAddress, chainId, tokenAddress, to, netAmount, tokenDecimals);

        // Fee transfer with nonce + 1
        let feeTxHash: string | null = null;
        try {
          const iface = new ethers.Interface(['function transfer(address,uint256) returns (bool)']);
          const feeAmt = ethers.parseUnits(parseFloat(feeAmount).toFixed(decimalPlaces), tokenDecimals);
          const feeData = iface.encodeFunctionData('transfer', [treasuryAddress, feeAmt]);
          const feeParams = await fetchTxParams(chainId, walletAddress, tokenAddress, feeData, 0n);
          feeParams.nonce += 1;
          const signedFeeTx = await walletManager.signOffline(feeParams);
          feeTxHash = await broadcastTx(signedFeeTx, chainId);
        } catch { /* fee collection failure is non-fatal */ }

        // Record fee server-side
        try {
          await fetch('/api/fees/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              txHash: hash,
              feeTxHash,
              fromWallet: walletAddress,
              toWallet: to,
              transferAmount: amount,
              feeAmount,
              feePercent: '0.3',
              token: 'USDC',
              chainId,
            }),
          });
        } catch {}

        return { hash, feeTxHash, transaction: { hash } };

      } else if (tokenAddress && tokenDecimals) {
        // ERC-20 send without fee
        const hash = await sendTokenViaServer(walletAddress, chainId, tokenAddress, to, amount, tokenDecimals);
        return { hash, transaction: { hash } };

      } else {
        // Native ETH/BNB send
        const hash = await sendNativeViaServer(walletAddress, chainId, to, amount);
        return { hash, transaction: { hash } };
      }
    },
    onSuccess: (data) => {
      toast({
        title: 'Transaction Sent',
        description: `Transaction hash: ${data.hash.slice(0, 10)}...`,
      });
      walletBalances.refreshAll();
      queryClient.invalidateQueries({ queryKey: ['transactions', networkId] });
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Transaction Failed',
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

    // Send transaction — use mutateAsync so errors propagate to the caller's try/catch
    sendTransaction: sendTransactionMutation.mutateAsync,
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
