/**
 * Shared pieces for the Hedger and Underwriter experiences (Architecture v2.0).
 *
 * Users answer business questions; BlockFinaX chooses the execution network and keeps
 * chain details behind "Advanced details". Everything is USDC and network fees are
 * sponsored.
 */
import { expiryAt } from '@shared/domain/durations';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CurrencyPool } from '@shared/domain/types';
import { api, passkeyBalances, passkeyWalletProvider } from '@/lib/wallets/passkey-wallet';
import { toWalletRequest, type PreparedTransaction } from '@/lib/wallet-provider';

export type Direction = 'up' | 'down';

const CURRENCY_NAMES: Record<string, string> = {
  NGN: 'Naira', GHS: 'Cedi', KES: 'Kenyan shilling', ZAR: 'Rand', EGP: 'Egyptian pound', XOF: 'West African CFA franc',
  XAF: 'Central African CFA franc', MAD: 'Moroccan dirham', UGX: 'Ugandan shilling', TZS: 'Tanzanian shilling', RWF: 'Rwandan franc',
  ETB: 'Ethiopian birr', ZMW: 'Zambian kwacha', MZN: 'Mozambican metical', BWP: 'Botswana pula', MUR: 'Mauritian rupee', TND: 'Tunisian dinar',
};
/** A pair as a reader names it: "Naira" for USD/NGN, "Naira per euro" for EUR/NGN. */
export const pairName = (pair: string) => {
  const base = pair.split('/')[0];
  const name = CURRENCY_NAMES[quoteCcy(pair)] ?? quoteCcy(pair);
  return base === 'USD' ? name : `${name} per ${base === 'EUR' ? 'euro' : base === 'GBP' ? 'pound' : base}`;
};
export const quoteCcy = (pair: string) => pair.split('/')[1] ?? pair;
export const ccyName = (pair: string) => CURRENCY_NAMES[quoteCcy(pair)] ?? quoteCcy(pair);
export const fmt = (v: string | number | null | undefined, dp = 2) =>
  Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtRate = (v: string | number) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const pct = (fraction: number, dp = 2) => `${(fraction * 100).toFixed(dp)}%`;
export const dateOf = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
/** The date cover bought now for `days` ends: 14:00 UTC on that date, weekends moved to Monday. */
export const dateIn = (days: number) => new Date(expiryAt(Math.floor(Date.now() / 1000), days) * 1000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
/** The exact end of cover bought now for `days`, in the viewer's time. */
export const endsAt = (days: number) => new Date(expiryAt(Math.floor(Date.now() / 1000), days) * 1000).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const poolRef = (p: CurrencyPool) => `${p.ref.chain}:${p.ref.contract}:${p.ref.id}`;

/**
 * How a direction is named. Both sides of the trade see the same product name:
 *   Cap:   pays if the rate rises above the strike (the local currency weakens).
 *   Floor: pays if the rate falls below the strike (the local currency strengthens).
 * `verb` is for plain explanations ("if the naira weakens past your strike").
 */
export function exposureLabel(pair: string, d: Direction | 'both') {
  return d === 'down'
    ? { title: `${pair} Floor`, kind: 'Floor', flow: 'receipts', who: 'For USD you will receive', cover: `${pair} Floor`, verb: 'strengthens' }
    : { title: `${pair} Cap`, kind: 'Cap', flow: 'payments', who: 'For USD you have to pay', cover: `${pair} Cap`, verb: 'weakens' };
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
  /** Circle CCTP connects this network to the others. */
  cctp?: boolean;
}

// ── Cross-network transfers (Circle CCTP) ────────────────────────────────────

export interface RouteView {
  id: string;
  kind: 'fund' | 'withdraw';
  sourceChain: string;
  destinationChain: string;
  recipient: string;
  amount: string;
  amountOut: string;
  maxFee: string;
  state: string;
  sourceTxHash: string | null;
  destinationTxHash: string | null;
  createdAt: number | null;
  error: string | null;
}

export interface TransferQuote { amountIn: string; amountOut: string; totalFees: string; estimatedSeconds: number; provider: string }

const OPEN_STATES = new Set(['REQUESTED', 'SOURCE_CONFIRMED', 'ROUTING', 'DESTINATION_CONFIRMED', 'ACTION_PENDING', 'RECOVERY_REQUIRED']);

export function useTransfers() {
  return useQuery({
    queryKey: ['v2-routes'],
    queryFn: () => api<{ routes: RouteView[] }>('/api/v2/routing').then((r) => r.routes),
    refetchInterval: (q) => ((q.state.data as RouteView[] | undefined)?.some((r) => OPEN_STATES.has(r.state) && r.sourceTxHash) ? 5_000 : 60_000),
  });
}

export function useTransferQuote(input: { kind: 'fund' | 'withdraw'; network: string | null; amount: string; recipient?: string }) {
  const amount = useDebounced(input.amount, 400);
  return useQuery({
    queryKey: ['v2-route-quote', input.kind, input.network, amount],
    queryFn: () => api<{ quotes: TransferQuote[] }>('/api/v2/routing/quote', { kind: input.kind, network: input.network, amount }).then((r) => r.quotes.find((q) => q.provider !== 'direct') ?? r.quotes[0]),
    enabled: Boolean(input.network) && Number(amount) > 0,
    retry: false,
  });
}

/**
 * Move USDC between a network and the hub: start the route, sign each source step with the
 * passkey (a step marked `continues` must confirm before the next can be prepared), then
 * report the final transaction so BlockFinaX can follow it to delivery.
 */
export async function runTransfer(input: { kind: 'fund' | 'withdraw'; network: string; amount: string; recipient?: string }, onStep: (m: string) => void): Promise<RouteView> {
  onStep('Preparing transfer...');
  let { route, transactions } = await api<{ route: RouteView; transactions: PreparedTransaction[] }>('/api/v2/routing/execute', input);
  let hash = '';
  for (let guard = 0; guard < 4; guard++) {
    let more = false;
    for (const tx of transactions) {
      onStep(tx.label);
      hash = (await passkeyWalletProvider.sendTransaction(toWalletRequest(tx), onStep)).transactionHash;
      more = Boolean(tx.continues);
    }
    if (!more) break;
    // The next step is prepared once the previous one is visible on chain.
    onStep('Preparing the transfer...');
    for (let wait = 0; wait < 10; wait++) {
      ({ route, transactions } = await api<{ route: RouteView; transactions: PreparedTransaction[] }>(`/api/v2/routing/${route.id}/continue`, {}));
      if (!transactions.every((t) => t.continues)) break;
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  onStep('Sending to Circle...');
  return (await api<{ route: RouteView }>(`/api/v2/routing/${route.id}/source`, { txHash: hash })).route;
}

/** How a transfer's state reads to a person. */
export function transferStatus(r: RouteView): { label: string; tone: 'green' | 'amber' | 'grey' | 'blue' } {
  if (r.state === 'ACTION_COMPLETED' || r.state === 'DESTINATION_CONFIRMED' || r.state === 'ACTION_PENDING') return { label: 'Arrived', tone: 'green' };
  if (r.state === 'REFUNDED') return { label: 'Refunded', tone: 'grey' };
  if (r.state === 'CANCELLED') return { label: 'Not sent', tone: 'grey' };
  if (r.state === 'RECOVERY_REQUIRED') return { label: 'Retrying delivery', tone: 'amber' };
  if (r.state === 'REQUESTED' && !r.sourceTxHash) return { label: 'Not approved', tone: 'grey' };
  return { label: 'Moving', tone: 'blue' };
}

export function useChains() {
  return useQuery({
    queryKey: ['v2-chains'],
    queryFn: () => api<{ environment?: string; activeLiquidityHub: string; chains: ChainInfo[] }>('/api/v2/chains'),
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

/** The public demo: the testnet deployment, with test money only. */
export function useIsDemo() {
  return useChains().data?.environment === 'testnet';
}

/** Open the Contact sales form from anywhere in the app. */
export function openContactSales(source: string) {
  window.dispatchEvent(new CustomEvent('bfx:contact-sales', { detail: { source } }));
}
