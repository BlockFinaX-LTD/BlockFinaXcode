import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useTransactions } from '@/hooks/use-transactions';
import { useWallet } from '@/hooks/use-wallet';
import { getNetworkById } from '@/lib/networks';
import { fetchCryptoPrices, getBnbPrice } from '@/lib/price-service';
import { SendModal } from './send-modal';
import { DepositModal } from './deposit-modal';
import { RefreshCw, Send, ArrowDownLeft, Copy, Check } from 'lucide-react';
import { EthIcon, UsdcIcon, UsdtIcon, BnbIcon } from '@/components/crypto-icons';
import { Skeleton } from '@/components/ui/skeleton';

interface EnhancedWalletOverviewProps {
  selectedNetworkId: number;
  className?: string;
  onTabChange?: (tab: string) => void;
}

export function EnhancedWalletOverview({ selectedNetworkId, className = '', onTabChange }: EnhancedWalletOverviewProps) {
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const { formatCurrency, formatCrypto, refreshAll } = useTransactions(selectedNetworkId);

  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const [bnbPrice, setBnbPrice] = useState<number | null>(getBnbPrice());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchCryptoPrices().then(prices => {
      if (prices?.eth) setEthPrice(prices.eth);
      if (prices?.bnb) setBnbPrice(prices.bnb);
    });
  }, []);

  const network = getNetworkById(selectedNetworkId);
  const chainId = network?.chainId;

  const nativeQuery = useQuery({
    queryKey: ['/api/wallet', address, 'native-balance', chainId],
    queryFn: async () => {
      const res = await fetch(`/api/wallet/${address}/native-balance?networkId=${chainId}`);
      if (!res.ok) return { balance: '0', symbol: network?.symbol || 'ETH' };
      return res.json();
    },
    enabled: !!address && !!chainId,
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const tokenQuery = useQuery({
    queryKey: ['/api/wallet', address, 'token-balances', chainId],
    queryFn: async () => {
      const res = await fetch(`/api/wallet/${address}/token-balances?networkId=${chainId}`);
      if (!res.ok) return { balances: [] };
      return res.json();
    },
    enabled: !!address && !!chainId,
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const nativeBalance: string = nativeQuery.data?.balance ?? '0';
  const nativeSym: string = nativeQuery.data?.symbol ?? network?.symbol ?? 'ETH';
  const tokenBalances: any[] = tokenQuery.data?.balances ?? [];

  const nativePrice = nativeSym === 'BNB' ? (bnbPrice ?? 0) : (ethPrice ?? 0);
  const nativeUsdValue = parseFloat(nativeBalance) * nativePrice;

  // Derive total from the same backend data used by the asset rows (not from useTransactions)
  const localTotalValue = nativeUsdValue + tokenBalances.reduce((sum: number, { usdValue }: any) => sum + (usdValue || 0), 0);

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const handleCopyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/wallet', address, 'native-balance', chainId] });
    queryClient.invalidateQueries({ queryKey: ['/api/wallet', address, 'token-balances', chainId] });
    refreshAll();
  };

  const isLoading = nativeQuery.isLoading || tokenQuery.isLoading;
  const nativeTokenName = nativeSym === 'BNB' ? 'BNB' : 'Ethereum';
  const priceDisplay = nativeSym === 'BNB'
    ? (bnbPrice != null ? `$${bnbPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—')
    : (ethPrice != null ? `$${ethPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—');

  const assetCount = 1 + tokenBalances.length;

  if (isLoading && !nativeQuery.data) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="bg-card rounded-xl border p-6">
          <Skeleton className="h-4 w-24 mb-3" />
          <Skeleton className="h-10 w-40 mb-2" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Balance Card */}
      <div className="bg-card rounded-xl border p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-muted-foreground font-medium">Total Balance</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="mb-5">
          <div className="text-3xl sm:text-4xl font-semibold tracking-tight mb-1">
            {formatCurrency(localTotalValue)}
          </div>
          <div className="text-sm text-muted-foreground">
            {network?.name || 'Network'}
          </div>
        </div>

        {/* Wallet Address */}
        {address && (
          <div
            className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors"
            onClick={handleCopyAddress}
          >
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-xs font-medium text-primary">{address.slice(2, 4).toUpperCase()}</span>
            </div>
            <code className="text-sm text-muted-foreground flex-1">{formatAddress(address)}</code>
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3 mt-5">
          <Button onClick={() => setSendModalOpen(true)} className="h-11">
            <Send className="h-4 w-4 mr-2" />
            Send
          </Button>
          <Button variant="outline" onClick={() => setDepositModalOpen(true)} className="h-11">
            <ArrowDownLeft className="h-4 w-4 mr-2" />
            Receive
          </Button>
        </div>
      </div>

      {/* Assets */}
      <div className="bg-card rounded-xl border">
        <div className="flex items-center justify-between p-4 border-b">
          <span className="font-medium">Assets</span>
          <span className="text-sm text-muted-foreground">{assetCount} assets</span>
        </div>

        <div className="divide-y divide-border">
          {/* Native token row */}
          <div className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${nativeSym === 'BNB' ? '' : 'bg-slate-100 dark:bg-slate-800'}`}>
                {nativeSym === 'BNB'
                  ? <BnbIcon className="w-10 h-10" />
                  : <EthIcon className="w-5 h-5" />}
              </div>
              <div>
                <div className="font-medium">{nativeTokenName}</div>
                <div className="text-sm text-muted-foreground">
                  {formatCrypto(nativeBalance, nativeSym)}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium">{formatCurrency(nativeUsdValue)}</div>
              <div className="text-xs text-muted-foreground">{priceDisplay}</div>
            </div>
          </div>

          {/* Token rows */}
          {tokenBalances.map(({ token, balance, usdValue }: any) => (
            <div key={token.symbol} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${token.color}15` }}
                >
                  {token.symbol === 'USDC' || token.symbol === 'USDC.e' ? (
                    <UsdcIcon className="w-6 h-6" />
                  ) : token.symbol === 'USDT' ? (
                    <UsdtIcon className="w-6 h-6" />
                  ) : (
                    <span className="text-lg">{token.icon}</span>
                  )}
                </div>
                <div>
                  <div className="font-medium">{token.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatCrypto(balance, token.symbol, token.decimals === 6 ? 2 : 4)}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">{formatCurrency(usdValue)}</div>
                <div className="text-xs text-muted-foreground">$1.00</div>
              </div>
            </div>
          ))}

          {/* Empty state */}
          {!nativeQuery.isLoading && tokenBalances.length === 0 && parseFloat(nativeBalance) === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No assets found on {network?.name}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <SendModal
        isOpen={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        defaultNetworkId={selectedNetworkId}
      />
      <DepositModal
        isOpen={depositModalOpen}
        onClose={() => setDepositModalOpen(false)}
      />
    </div>
  );
}
