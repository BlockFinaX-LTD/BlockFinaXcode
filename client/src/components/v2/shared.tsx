/**
 * Shared pieces for the Hedger and Underwriter experiences (Architecture v2.0).
 *
 * Users answer business questions; BlockFinaX chooses the execution network and keeps
 * chain details behind "Advanced details". Everything is USDC and network fees are
 * sponsored.
 */
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
export const dateIn = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const poolRef = (p: CurrencyPool) => `${p.ref.chain}:${p.ref.contract}:${p.ref.id}`;

/**
 * How a direction is named, by audience.
 *   Hedgers think in business flows: payables (USD to pay) and receivables (USD to receive).
 *   Underwriters see the risk their capital backs: depreciation or appreciation cover.
 * `verb` is for plain explanations ("if the naira weakens past your strike").
 */
export function exposureLabel(pair: string, d: Direction | 'both') {
  const name = ccyName(pair);
  return d === 'down'
    ? { title: `${name} receivables protection`, kind: 'Receivables protection', flow: 'receivables', who: 'For USD you will receive', cover: `${name} appreciation cover`, verb: 'strengthens' }
    : { title: `${name} payables protection`, kind: 'Payables protection', flow: 'payables', who: 'For USD you have to pay', cover: `${name} depreciation cover`, verb: 'weakens' };
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
