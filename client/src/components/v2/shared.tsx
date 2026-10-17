/**
 * Shared pieces for the Hedger and Underwriter experiences (Architecture v2.0).
 *
 * Users answer business questions; BlockFinaX chooses the execution network and keeps
 * chain details behind "Advanced details". Everything is USDC and network fees are
 * sponsored.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { FlagSvg } from '@/components/app-glyphs';
import type { CurrencyPool } from '@shared/domain/types';
import { api, passkeyBalances, passkeyWalletProvider } from '@/lib/wallets/passkey-wallet';
import { toWalletRequest, type PreparedTransaction } from '@/lib/wallet-provider';

export type Direction = 'up' | 'down';

const CURRENCY_NAMES: Record<string, string> = { NGN: 'Naira', GHS: 'Cedi', KES: 'Kenyan shilling', ZAR: 'Rand', EGP: 'Egyptian pound' };
export const quoteCcy = (pair: string) => pair.split('/')[1] ?? pair;
export const ccyName = (pair: string) => CURRENCY_NAMES[quoteCcy(pair)] ?? quoteCcy(pair);
export const fmt = (v: string | number | null | undefined, dp = 2) =>
  Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtRate = (v: string | number) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const pct = (fraction: number, dp = 2) => `${(fraction * 100).toFixed(dp)}%`;
export const dateOf = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const dateIn = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const poolRef = (p: CurrencyPool) => `${p.ref.chain}:${p.ref.contract}:${p.ref.id}`;

/** An exposure as the user thinks of it: the currency and the move that hurts them. */
export function exposureLabel(pair: string, d: Direction | 'both') {
  const name = ccyName(pair);
  return d === 'down'
    ? { title: `${name} strengthening`, who: 'You earn in USD and convert to ' + quoteCcy(pair), verb: 'strengthens' }
    : { title: `${name} weakening`, who: 'You pay in USD or hold ' + quoteCcy(pair), verb: 'weakens' };
}

export function Flag({ pair }: { pair: string }) {
  return <span className="mkt-fl"><FlagSvg code={quoteCcy(pair)} /></span>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="pool-stat">
      <div className="l">{label}</div>
      <div className="v tnum">{value}</div>
      {sub ? <div className="l" style={{ marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

/** A horizontal bar split into labelled parts, for simple risk visuals. */
export function SplitBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', background: 'var(--bg-3, #eee)' }}>
        {parts.map((p) => <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: 'var(--tx-3)' }}>
        {parts.map((p) => (
          <span key={p.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block' }} />{p.label}: {fmt(p.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Advanced({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 0, padding: 0, color: 'var(--tx-3)', fontSize: 12, cursor: 'pointer' }}>
        {open ? <ChevronUp style={{ width: 14 }} /> : <ChevronDown style={{ width: 14 }} />} Advanced details
      </button>
      {open && <div className="brk" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

export function Line({ l, v, total, good }: { l: ReactNode; v: ReactNode; total?: boolean; good?: boolean }) {
  return (
    <div className={`brk-line${total ? ' total' : ''}`}>
      <span className="l">{l}</span>
      <span className="v" style={good ? { color: 'var(--green)' } : undefined}>{v}</span>
    </div>
  );
}

/** Sign and submit prepared transactions with the passkey wallet, in order. */
export async function signAndSend(transactions: PreparedTransaction[], onStep: (m: string) => void) {
  let hash = '';
  for (const tx of transactions) {
    onStep(tx.label);
    hash = (await passkeyWalletProvider.sendTransaction(toWalletRequest(tx), onStep)).transactionHash;
  }
  return hash;
}

export function usePools() {
  return useQuery({
    queryKey: ['v2-pools'],
    queryFn: async () => (await api<{ pools: CurrencyPool[] }>('/api/v2/pools')).pools,
    refetchInterval: 30_000,
  });
}

export interface ChainInfo {
  key: string;
  name: string;
  state: string;
  capabilities: Record<string, boolean>;
}

export function useChains() {
  return useQuery({
    queryKey: ['v2-chains'],
    queryFn: () => api<{ activeLiquidityHub: string; chains: ChainInfo[] }>('/api/v2/chains'),
    staleTime: 300_000,
  });
}

/** USDC per network and in total, across every account the user holds. */
export function useUsdcBalances() {
  return useQuery({
    queryKey: ['v2-usdc-all'],
    queryFn: async () => {
      const rows = (await passkeyBalances()).filter((b) => b.token === 'USDC');
      return { rows, total: rows.reduce((s, b) => s + Number(b.amount || 0), 0) };
    },
    refetchInterval: 30_000,
  });
}

/** USDC on one network (by registry key, e.g. "stellar-testnet"). */
export function usdcOn(rows: { chain: string; amount: number }[] | undefined, chainKey: string | undefined) {
  if (!rows || !chainKey) return 0;
  const key = chainKey.toUpperCase().replace(/-/g, '_');
  return Number(rows.find((b) => b.chain === key)?.amount ?? 0);
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * Funding from a network other than the liquidity hub goes through the routing layer.
 * Until routing execution is switched on, the request is refused with a clear message.
 */
export async function routeFunding(input: { network: string; amount: string; hubName?: string }) {
  try {
    await api('/api/v2/routing/quote', { kind: 'fund', network: input.network, amount: input.amount });
    await api('/api/v2/routing/execute', { kind: 'fund', network: input.network, amount: input.amount });
  } catch {
    throw new Error(`Funding from another network is being switched on. For now, please fund from ${input.hubName ?? 'the main network'}.`);
  }
}
