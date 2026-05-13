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
import { BfxMark } from '@/components/ui/bfx';

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
        <div className="bg-card rounded-2xl border p-6">
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
      <div className="relative overflow-hidden bfx-hero-brand rounded-2xl p-5 sm:p-6">
        <div className="absolute inset-0 bfx-hero-brand-dotgrid opacity-60 pointer-events-none" />
        <BfxMark
          size={160}
          className="absolute -right-8 -top-10 pointer-events-none"
          primary="rgba(255,255,255,0.08)"
          accent="rgba(255,255,255,0.18)"
        />

        <div className="relative">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] uppercase tracking-[0.12em] text-white/70 font-semibold">Total balance</p>
            <button
              type="button"
              onClick={handleRefresh}
              className="h-8 w-8 inline-flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Refresh balances"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-4">
            <div className="bfx-display text-3xl sm:text-[36px] font-semibold tracking-tight text-white leading-none">
              {formatCurrency(localTotalValue)}
            </div>
            <div className="text-[12px] text-white/55 mt-1.5">
              {assetCount} asset{assetCount !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Wallet Address */}
          {address && (
            <button
              type="button"
              className="w-full flex items-center gap-2 p-2.5 bg-white/[0.05] border border-white/10 rounded-xl cursor-pointer hover:bg-white/10 transition-colors text-left"
              onClick={handleCopyAddress}
            >
              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                <span className="text-[11px] font-semibold text-white font-mono-data">{address.slice(2, 4).toUpperCase()}</span>
              </div>
              <code className="text-xs text-white/75 flex-1 font-mono-data truncate">{formatAddress(address)}</code>
              {copied ? (
                <Check className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <Copy className="h-4 w-4 text-white/55 shrink-0" />
              )}
            </button>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2.5 mt-4">
            <Button
              onClick={() => setSendModalOpen(true)}
              className="h-11 rounded-xl bg-white text-[#0f2744] hover:bg-white/95 font-semibold shadow-sm"
            >
              <Send className="h-4 w-4 mr-2" />
              Send
            </Button>
            <Button
              onClick={() => setDepositModalOpen(true)}
              className="h-11 rounded-xl bg-white/10 hover:bg-white/15 text-white border border-white/15 font-semibold"
            >
              <ArrowDownLeft className="h-4 w-4 mr-2" />
              Receive
            </Button>
          </div>
        </div>
      </div>

      {/* Assets */}
      <div className="bg-card rounded-2xl border overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <span className="text-sm font-semibold">Assets</span>
          <span className="text-xs text-muted-foreground">{assetCount} asset{assetCount !== 1 ? 's' : ''}</span>
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
                <div className="text-sm font-semibold leading-tight">{nativeTokenName}</div>
                <div className="text-[11px] text-muted-foreground font-mono-data">
                  {formatCrypto(nativeBalance, nativeSym)}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold font-mono-data">{formatCurrency(nativeUsdValue)}</div>
              <div className="text-[11px] text-muted-foreground font-mono-data">{priceDisplay}</div>
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
                  <div className="text-sm font-semibold leading-tight">{token.name}</div>
                  <div className="text-[11px] text-muted-foreground font-mono-data">
                    {formatCrypto(balance, token.symbol, token.decimals === 6 ? 2 : 4)}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold font-mono-data">{formatCurrency(usdValue)}</div>
                <div className="text-[11px] text-muted-foreground font-mono-data">$1.00</div>
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
