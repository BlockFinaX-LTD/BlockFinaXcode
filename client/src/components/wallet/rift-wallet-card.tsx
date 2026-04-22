/**
 * rift-wallet-card.tsx — Smart wallet + token balances via the Rift SDK
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Copy, Check, RefreshCw, Wallet, Send } from 'lucide-react';
import { useRiftBalances } from '@/hooks/use-rift-balances';
import { useWallet } from '@/hooks/use-wallet';
import { RiftSendModal } from './rift-send-modal';

function shortAddress(addr: string | null | undefined): string {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function RiftWalletCard() {
  const { address, wallet } = useWallet();
  const { byChain, isLoading, error, refreshAll, balances } = useRiftBalances();
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  // Total amount (assumes USDC == $1; for other tokens this is just a sum of `amount`)
  const total = balances.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
  const nonZero = balances.filter(b => Number(b.amount) > 0);

  if (!address) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            {wallet?.name || 'My Wallet'}
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refreshAll} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Address */}
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase text-muted-foreground tracking-wider">Smart wallet</span>
            <code className="text-sm font-mono">{shortAddress(address)}</code>
          </div>
          <Button variant="ghost" size="sm" className="h-8" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        {/* Total */}
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Approx. total</div>
          <div className="text-3xl font-semibold">
            ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setSendOpen(true)} disabled={nonZero.length === 0}>
            <Send className="h-4 w-4 mr-2" /> Send
          </Button>
          <Button variant="outline" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
            Receive
          </Button>
        </div>

        {/* Balances grouped by chain */}
        <div className="space-y-3">
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Holdings</div>

          {isLoading && balances.length === 0 && (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading balances…
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          {!isLoading && nonZero.length === 0 && !error && (
            <p className="text-xs text-muted-foreground py-2">
              No tokens yet. Fund this address to get started.
            </p>
          )}

          {Object.entries(byChain).map(([chain, items]) => {
            const visible = items.filter(i => Number(i.amount) > 0);
            if (visible.length === 0) return null;
            // Prefer the SDK's display name; fall back to title-casing the enum key
            const raw = (visible[0] as any)?.chainName || chain;
            const chainName = /[a-z]/.test(raw) ? raw : raw.charAt(0) + raw.slice(1).toLowerCase();
            return (
              <div key={chain} className="space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">{chainName}</div>
                {visible.map((b, i) => (
                  <div key={`${chain}-${i}`} className="flex items-center justify-between rounded-md hover:bg-muted/30 px-2 py-2">
                    <span className="text-sm font-medium">{b.token}</span>
                    <span className="text-sm font-semibold">
                      {Number(b.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </CardContent>

      <RiftSendModal open={sendOpen} onClose={() => setSendOpen(false)} />
    </Card>
  );
}
