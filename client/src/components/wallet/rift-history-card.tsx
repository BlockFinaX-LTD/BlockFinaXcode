/**
 * rift-history-card.tsx — Recent transactions via Rift SDK
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, ArrowUpRight, ExternalLink } from 'lucide-react';
import { getHistory } from '@/lib/rift-client';
import { useWallet } from '@/hooks/use-wallet';

interface RiftTx {
  transaction_hash?: string;
  transactionHash?: string;
  amount: string | number;
  chain: string;
  token: string;
  recipient_address?: string;
  recipientAddress?: string;
  created_at?: string;
  createdAt?: string;
}

function explorerUrl(chain: string, hash: string): string {
  const c = chain.toLowerCase();
  if (c === 'base') return `https://basescan.org/tx/${hash}`;
  if (c === 'bnb' || c === 'bsc') return `https://bscscan.com/tx/${hash}`;
  if (c === 'polygon') return `https://polygonscan.com/tx/${hash}`;
  if (c === 'arbitrum') return `https://arbiscan.io/tx/${hash}`;
  if (c === 'optimism') return `https://optimistic.etherscan.io/tx/${hash}`;
  if (c === 'lisk') return `https://blockscout.lisk.com/tx/${hash}`;
  if (c === 'celo') return `https://celoscan.io/tx/${hash}`;
  return `https://etherscan.io/tx/${hash}`;
}

export function RiftHistoryCard() {
  const { isUnlocked } = useWallet();
  const [txs, setTxs] = useState<RiftTx[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!isUnlocked) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await getHistory({ limit: 10 });
      // Rift returns either Transaction[] or { transactions, pagination } — handle both
      const list: RiftTx[] = Array.isArray(result) ? result : (result as any)?.transactions || [];
      setTxs(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load transactions');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (isUnlocked) refresh(); }, [isUnlocked]);

  if (!isUnlocked) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recent Activity</CardTitle>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && txs.length === 0 && (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        {!isLoading && txs.length === 0 && !error && (
          <p className="text-xs text-muted-foreground py-2 text-center">No transactions yet.</p>
        )}
        <ul className="space-y-2">
          {txs.map((tx, i) => {
            const hash = tx.transaction_hash || tx.transactionHash || '';
            const recipient = tx.recipient_address || tx.recipientAddress || '';
            const date = tx.created_at || tx.createdAt;
            return (
              <li key={hash || i} className="flex items-center justify-between rounded-md hover:bg-muted/30 px-2 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      Sent {tx.amount} {tx.token}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {tx.chain} • to {recipient ? `${recipient.slice(0, 6)}…${recipient.slice(-4)}` : '—'}
                    </span>
                  </div>
                </div>
                <div className="text-right flex flex-col items-end">
                  {date && (
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(date).toLocaleDateString()}
                    </span>
                  )}
                  {hash && (
                    <a
                      href={explorerUrl(tx.chain, hash)}
                      target="_blank" rel="noopener noreferrer"
                      className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
