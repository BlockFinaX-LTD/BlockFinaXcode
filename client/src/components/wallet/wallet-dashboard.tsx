import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTransactions } from '@/hooks/use-transactions';
import { useWallet } from '@/hooks/use-wallet';
import { getNetworkById } from '@/lib/networks';
import { fetchCryptoPrices } from '@/lib/price-service';
import { SendModal } from './send-modal';
import { DepositModal } from './deposit-modal';
import { RefreshCw, Send, ArrowDownLeft, Copy, Check } from 'lucide-react';
import { EthIcon, UsdcIcon } from '@/components/crypto-icons';
import { Skeleton } from '@/components/ui/skeleton';

interface EnhancedWalletOverviewProps {
  selectedNetworkId: number;
  className?: string;
  onTabChange?: (tab: string) => void;
}

export function EnhancedWalletOverview({ selectedNetworkId, className = '', onTabChange }: EnhancedWalletOverviewProps) {
  const { address } = useWallet();
  const { 
    allBalances, 
    tokenBalances,
    totalValue, 
    isLoadingBalance, 
    formatCurrency, 
    formatCrypto, 
    refreshAll 
  } = useTransactions(selectedNetworkId);
  
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [ethPrice, setEthPrice] = useState<number>(3200);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchCryptoPrices().then(prices => {
      setEthPrice(prices.eth);
    });
  }, []);

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const handleCopyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoadingBalance) {
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
      {/* Balance Card - Clean minimal design */}
      <div className="bg-card rounded-xl border p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-muted-foreground font-medium">Total Balance</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={refreshAll}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="mb-5">
          <div className="text-3xl sm:text-4xl font-semibold tracking-tight mb-1">
            {formatCurrency(totalValue)}
          </div>
          <div className="text-sm text-muted-foreground">
            {getNetworkById(selectedNetworkId)?.name || 'Network'}
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
          <Button
            onClick={() => setSendModalOpen(true)}
            className="h-11"
          >
            <Send className="h-4 w-4 mr-2" />
            Send
          </Button>
          
          <Button
            variant="outline"
            onClick={() => setDepositModalOpen(true)}
            className="h-11"
          >
            <ArrowDownLeft className="h-4 w-4 mr-2" />
            Receive
          </Button>
        </div>
      </div>

      {/* Token Holdings - Clean list */}
      <div className="bg-card rounded-xl border">
        <div className="flex items-center justify-between p-4 border-b">
          <span className="font-medium">Assets</span>
          <span className="text-sm text-muted-foreground">
            {(allBalances.length > 0 ? 1 : 0) + tokenBalances.length} tokens
          </span>
        </div>
        
        <div className="divide-y divide-border">
          {/* ETH Balance */}
          {(() => {
            const selectedBalance = allBalances.find(b => b.networkId === selectedNetworkId);
            if (!selectedBalance) return null;
            
            return (
              <div className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <EthIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-medium">Ethereum</div>
                    <div className="text-sm text-muted-foreground">
                      {formatCrypto(selectedBalance.balance, 'ETH')}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{formatCurrency(selectedBalance.usdValue)}</div>
                  <div className="text-xs text-muted-foreground">
                    ${ethPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </div>
              </div>
            );
          })()}
          
          {/* Token Balances */}
          {tokenBalances.map(({ token, balance, usdValue }: any) => (
            <div key={token.symbol} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${token.color}15` }}
                >
                  {token.symbol === 'USDC' || token.symbol === 'USDC.e' ? (
                    <UsdcIcon className="w-6 h-6" />
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