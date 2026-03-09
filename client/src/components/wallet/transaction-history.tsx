import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTransactions } from '@/hooks/use-transactions';
import { getNetworkById } from '@/lib/networks';
import { formatDistanceToNow } from 'date-fns';
import { ExternalLink, RefreshCw, ArrowUpRight, ArrowDownLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface TransactionHistoryProps {
  networkId: number;
  className?: string;
}

export function TransactionHistory({ networkId, className = '' }: TransactionHistoryProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { 
    transactions, 
    isLoadingTransactions, 
    formatCrypto, 
    formatCurrency,
    refreshAll 
  } = useTransactions(networkId);

  const network = getNetworkById(networkId);
  
  const displayTransactions = showAll ? transactions : transactions.slice(0, 5);

  const getTransactionStyles = (type: string, status: string) => {
    if (status === 'pending') {
      return { bg: 'bg-amber-50 dark:bg-amber-950/30', color: 'text-amber-600 dark:text-amber-400' };
    }
    if (status === 'failed') {
      return { bg: 'bg-red-50 dark:bg-red-950/30', color: 'text-red-600 dark:text-red-400' };
    }
    return type === 'received' 
      ? { bg: 'bg-emerald-50 dark:bg-emerald-950/30', color: 'text-emerald-600 dark:text-emerald-400' }
      : { bg: 'bg-slate-100 dark:bg-slate-800', color: 'text-slate-600 dark:text-slate-400' };
  };

  if (isLoadingTransactions) {
    return (
      <div className={`bg-card rounded-xl border ${className}`}>
        <div className="p-4 border-b">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="p-4 space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-card rounded-xl border ${className}`}>
      {/* Header */}
      <div 
        className="flex items-center justify-between p-4 border-b cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">Activity</span>
          {transactions.length > 0 && (
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
              {transactions.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isExpanded && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); refreshAll(); }}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>
      
      {isExpanded && (
        <div>
          {transactions.length === 0 ? (
            <div className="text-center py-10 px-4">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <ExternalLink className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium mb-1">No activity yet</p>
              <p className="text-xs text-muted-foreground">
                Transactions will appear here
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {displayTransactions.map((tx: any, index: number) => {
                const styles = getTransactionStyles(tx.type, tx.status);
                return (
                  <div 
                    key={tx.hash || index}
                    className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${styles.bg}`}>
                        {tx.type === 'received' ? (
                          <ArrowDownLeft className={`h-4 w-4 ${styles.color}`} />
                        ) : (
                          <ArrowUpRight className={`h-4 w-4 ${styles.color}`} />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-sm">
                          {tx.type === 'received' ? 'Received' : 'Sent'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(tx.timestamp, { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-medium text-sm ${tx.type === 'received' ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                        {tx.type === 'received' ? '+' : '-'}
                        {tx.tokenSymbol === 'USDC' || tx.tokenSymbol === 'TOKEN' 
                          ? `${parseFloat(tx.value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tx.tokenSymbol}`
                          : formatCrypto(tx.value, network?.symbol || '')}
                      </div>
                      {tx.hash && network?.blockExplorerUrl && (
                        <a
                          href={`${network.blockExplorerUrl}/tx/${tx.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          View
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
              
              {transactions.length > 5 && (
                <div className="p-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground"
                    onClick={() => setShowAll(!showAll)}
                  >
                    {showAll ? 'Show less' : `Show all ${transactions.length} transactions`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
