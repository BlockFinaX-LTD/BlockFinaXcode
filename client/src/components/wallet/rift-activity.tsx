/**
 * rift-activity.tsx — Unified on-chain activity feed for the wallet's
 * Activity tab and the home page.
 *
 * Pulls three streams in parallel and merges them by timestamp:
 *   - rift.transactions.getHistory() → sends (outbound transfers)
 *   - rift.deposits.getAllDeposits() → receives (inbound USDC transfers)
 *   - GET /api/hedge/activity/:wallet → BlockFinaX hedge actions
 *     (buy_protection, lp_deposit, claim_payout, claim_premiums,
 *      withdraw_lp, recover_expired, toggle_pool, create_event)
 *
 * Every row carries a tx hash so it deep-links to the right block explorer.
 */

import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowUpRight, ArrowDownLeft, ExternalLink, RefreshCw,
  Activity as ActivityIcon, Shield, DollarSign, Settings, Sparkles,
  Plus, Unlock, AlertTriangle, Gift,
} from 'lucide-react';
import { getHistory, getDeposits } from '@/lib/rift-client';
import { useWallet } from '@/hooks/use-wallet';
import { formatDistanceToNow } from 'date-fns';

// ── Types ───────────────────────────────────────────────────────────────

type TransferKind = 'send' | 'receive';

// Mirrors the server's action enum (see shared/schema.ts hedgeActivity).
type HedgeActionType =
  | 'create_event'
  | 'buy_protection'
  | 'lp_deposit'
  | 'claim_payout'
  | 'claim_premiums'
  | 'withdraw_lp'
  | 'recover_expired'
  | 'toggle_pool'
  | 'settle_event'
  | 'reward_payout';

interface BaseRow {
  hash: string;
  amount?: number;
  token?: string;
  chain: string;     // for explorer linking
  timestamp: number; // ms epoch
}

type TransferRow = BaseRow & {
  kind: 'transfer';
  direction: TransferKind;
  counterparty: string; // recipient for sends, sender for receives
};

type HedgeRow = BaseRow & {
  kind: 'hedge';
  actionType: HedgeActionType;
  metadata?: any;
};

export type ActivityRow = TransferRow | HedgeRow;

// ── Helpers ─────────────────────────────────────────────────────────────

const CHAIN_ID_TO_NAME: Record<number, string> = {
  1135: 'LISK', 8453: 'BASE', 56: 'BNB',
  137: 'POLYGON', 42161: 'ARBITRUM', 1: 'ETHEREUM', 10: 'OPTIMISM',
};

export function explorerUrl(chain: string, hash: string): string {
  const c = (chain || '').toLowerCase();
  if (!hash) return '';
  if (c === 'base') return `https://basescan.org/tx/${hash}`;
  if (c === 'bnb' || c === 'bsc') return `https://bscscan.com/tx/${hash}`;
  if (c === 'polygon') return `https://polygonscan.com/tx/${hash}`;
  if (c === 'arbitrum') return `https://arbiscan.io/tx/${hash}`;
  if (c === 'optimism') return `https://optimistic.etherscan.io/tx/${hash}`;
  if (c === 'lisk') return `https://blockscout.lisk.com/tx/${hash}`;
  if (c === 'celo') return `https://celoscan.io/tx/${hash}`;
  return `https://etherscan.io/tx/${hash}`;
}

function shortAddr(a?: string | null): string {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function normalizeSends(raw: any): TransferRow[] {
  const list: any[] = Array.isArray(raw) ? raw : raw?.transactions || [];
  return list.map((tx) => {
    const hash = tx.transaction_hash || tx.transactionHash || '';
    const recipient = tx.recipient_address || tx.recipientAddress || '';
    const dateStr = tx.created_at || tx.createdAt || '';
    return {
      kind: 'transfer' as const,
      direction: 'send' as const,
      hash,
      amount: typeof tx.amount === 'number' ? tx.amount : parseFloat(tx.amount || '0'),
      token: tx.token || 'USDC',
      chain: tx.chain || '',
      counterparty: recipient,
      timestamp: dateStr ? new Date(dateStr).getTime() : 0,
    };
  });
}

function normalizeDeposits(raw: any): TransferRow[] {
  const list: any[] = Array.isArray(raw) ? raw : raw?.deposits || raw?.data?.deposits || [];
  return list.map((d) => {
    const hash = d.transactionHash || d.transaction_hash || '';
    const amountNum = typeof d.amount === 'number' ? d.amount : parseFloat(d.amount || '0');
    const blockTs = d.blockTimestamp || d.block_timestamp;
    const createdAt = d.createdAt || d.created_at;
    let timestamp = 0;
    if (blockTs) {
      const n = parseInt(String(blockTs), 10);
      timestamp = Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : 0;
    }
    if (!timestamp && createdAt) timestamp = new Date(createdAt).getTime();
    return {
      kind: 'transfer' as const,
      direction: 'receive' as const,
      hash,
      amount: amountNum,
      token: 'USDC',
      chain: d.chain || 'BASE',
      counterparty: d.fromAddress || d.from_address || '',
      timestamp,
    };
  });
}

function normalizeHedgeActivity(raw: any): HedgeRow[] {
  const list: any[] = Array.isArray(raw) ? raw : [];
  return list.map((r) => {
    let metadata: any = null;
    try {
      metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
    } catch { /* ignore malformed metadata */ }
    return {
      kind: 'hedge' as const,
      actionType: r.actionType as HedgeActionType,
      hash: r.txHash || '',
      amount: r.amount != null ? parseFloat(String(r.amount)) : undefined,
      token: r.token || undefined,
      chain: CHAIN_ID_TO_NAME[r.chainId] || '',
      timestamp: r.createdAt ? new Date(r.createdAt).getTime() : 0,
      metadata,
    };
  });
}

// ── Hedge action presentation map ───────────────────────────────────────

interface HedgeStyle {
  label: string;
  icon: LucideIcon;
  iconBg: string;
  amountSign: '+' | '-' | '';
  amountColor?: string;
}

const HEDGE_STYLES: Record<HedgeActionType, HedgeStyle> = {
  create_event: {
    label: 'Created cover pool',
    icon: Plus,
    iconBg: 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400',
    amountSign: '-',
  },
  buy_protection: {
    label: 'Bought cover',
    icon: Shield,
    iconBg: 'bg-primary/10 text-primary',
    amountSign: '-',
  },
  lp_deposit: {
    label: 'Provided liquidity',
    icon: DollarSign,
    iconBg: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    amountSign: '-',
  },
  claim_payout: {
    label: 'Claimed payout',
    icon: Sparkles,
    iconBg: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    amountSign: '+',
    amountColor: 'text-emerald-700 dark:text-emerald-400',
  },
  claim_premiums: {
    label: 'Claimed premiums',
    icon: Sparkles,
    iconBg: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    amountSign: '+',
    amountColor: 'text-emerald-700 dark:text-emerald-400',
  },
  withdraw_lp: {
    label: 'Withdrew liquidity',
    icon: Unlock,
    iconBg: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400',
    amountSign: '+',
    amountColor: 'text-emerald-700 dark:text-emerald-400',
  },
  recover_expired: {
    label: 'Recovered expired pool',
    icon: AlertTriangle,
    iconBg: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    amountSign: '+',
    amountColor: 'text-emerald-700 dark:text-emerald-400',
  },
  toggle_pool: {
    label: 'Updated pool settings',
    icon: Settings,
    iconBg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
    amountSign: '',
  },
  settle_event: {
    label: 'Settled pool',
    icon: Sparkles,
    iconBg: 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400',
    amountSign: '',
  },
  reward_payout: {
    label: 'Reward received',
    icon: Gift,
    iconBg: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    amountSign: '+',
    amountColor: 'text-emerald-700 dark:text-emerald-400',
  },
};

// ── Hook: fetch + merge activity ────────────────────────────────────────

export function useUnifiedActivity(walletAddress: string | null | undefined, limit = 60) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const hedgeUrl = walletAddress ? `/api/hedge/activity/${walletAddress}?limit=${limit}` : null;

      const [sendsRes, depositsRes, hedgeRes] = await Promise.allSettled([
        getHistory({ limit: 50 }),
        getDeposits(),
        hedgeUrl
          ? fetch(hedgeUrl).then(r => r.ok ? r.json() : Promise.reject(r.statusText))
          : Promise.resolve([]),
      ]);

      const sends    = sendsRes.status    === 'fulfilled' ? normalizeSends(sendsRes.value)         : [];
      const receives = depositsRes.status === 'fulfilled' ? normalizeDeposits(depositsRes.value)    : [];
      const hedge    = hedgeRes.status    === 'fulfilled' ? normalizeHedgeActivity(hedgeRes.value)  : [];

      // Only fail if EVERY stream failed — one empty stream is fine.
      if (sendsRes.status === 'rejected' && depositsRes.status === 'rejected' && hedgeRes.status === 'rejected') {
        throw sendsRes.reason || depositsRes.reason || hedgeRes.reason;
      }

      const merged = [...sends, ...receives, ...hedge]
        .filter((r) => r.hash || r.timestamp)
        .sort((a, b) => b.timestamp - a.timestamp);

      setRows(merged);
    } catch (err: any) {
      setError(err?.message || 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [walletAddress]);

  return { rows, loading, error, refresh };
}

// ── Row renderer (re-usable on home page) ───────────────────────────────

export function ActivityRowView({ row }: { row: ActivityRow }) {
  const href = explorerUrl(row.chain, row.hash);

  if (row.kind === 'hedge') {
    const style = HEDGE_STYLES[row.actionType] || HEDGE_STYLES.toggle_pool;
    const Icon = style.icon;
    const meta = row.metadata;
    const subtitle = meta?.taskTitle || meta?.eventName || meta?.underlying || '';
    return (
      <div className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`h-10 w-10 rounded-full flex items-center justify-center ${style.iconBg}`}>
            <Icon className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-semibold tracking-tight">{style.label}</span>
              {row.chain && (
                <span className="text-[9.5px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                  {row.chain}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {subtitle && <span className="font-mono-data">{subtitle}</span>}
              {row.timestamp ? (
                <span className="text-muted-foreground/70">
                  {subtitle ? ' · ' : ''}{formatDistanceToNow(row.timestamp, { addSuffix: true })}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          {row.amount != null && row.amount > 0 && style.amountSign !== '' && (
            <div className={`text-[13px] font-semibold font-mono-data tabular-nums ${style.amountColor ?? 'text-foreground'}`}>
              {style.amountSign}{row.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
              <span className="text-[10.5px] text-muted-foreground font-medium">{row.token || 'USD'}</span>
            </div>
          )}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10.5px] text-muted-foreground hover:text-primary inline-flex items-center gap-0.5 mt-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              View <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    );
  }

  // Transfer row (send / receive)
  const isReceive = row.direction === 'receive';
  const iconBg = isReceive
    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';
  const amountColor = isReceive ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground';
  const label = isReceive ? 'Received' : 'Sent';
  const counterpartyLabel = isReceive ? 'from' : 'to';

  return (
    <div className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${iconBg}`}>
          {isReceive
            ? <ArrowDownLeft className="h-4 w-4" strokeWidth={2.2} />
            : <ArrowUpRight className="h-4 w-4" strokeWidth={2.2} />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold tracking-tight">{label}</span>
            {row.chain && (
              <span className="text-[9.5px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                {row.chain}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate font-mono-data">
            {counterpartyLabel} {shortAddr(row.counterparty)}
            {row.timestamp ? (
              <span className="text-muted-foreground/70"> · {formatDistanceToNow(row.timestamp, { addSuffix: true })}</span>
            ) : null}
          </p>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`text-[13px] font-semibold font-mono-data tabular-nums ${amountColor}`}>
          {isReceive ? '+' : '−'}{(row.amount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
          <span className="text-[10.5px] text-muted-foreground font-medium">{row.token}</span>
        </div>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10.5px] text-muted-foreground hover:text-primary inline-flex items-center gap-0.5 mt-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            View <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Wallet Activity card ────────────────────────────────────────────────

export function RiftActivity() {
  const { isUnlocked, address } = useWallet();
  const { rows, loading, error, refresh } = useUnifiedActivity(isUnlocked ? address : undefined);

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-border/40 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="h-7 w-7 rounded-full bg-primary/10 inline-flex items-center justify-center">
            <ActivityIcon className="h-3.5 w-3.5 text-primary" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Activity</span>
          {rows.length > 0 && (
            <span className="text-[10.5px] font-mono-data tabular-nums px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-gray-100 dark:border-border/40">
              {rows.length}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Body */}
      {loading && rows.length === 0 ? (
        <div className="px-5 pb-5 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="px-5 pb-5">
          <div className="rounded-xl border border-red-100 dark:border-red-500/20 bg-red-50/60 dark:bg-red-500/5 px-3 py-2.5 text-[12px] text-red-700 dark:text-red-300">
            {error}
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 px-4">
          <div className="h-10 w-10 rounded-full bg-muted/60 mx-auto mb-2.5 flex items-center justify-center">
            <ActivityIcon className="h-5 w-5 text-muted-foreground/70" />
          </div>
          <p className="text-sm font-medium">No activity yet</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Transfers and cover actions will appear here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-border/40">
          {rows.map((r, i) => (
            <ActivityRowView key={`${r.hash}-${r.kind}-${i}`} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}
