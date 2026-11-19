/**
 * The signed-in home: total balance across the wallet and trading, open profit or loss, cover
 * in force, quick actions, a markets panel (perps, cover, rates) and notices.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowLeftRight, Eye, EyeOff, LineChart, Megaphone, ShieldCheck } from 'lucide-react';
import type { ProtectionPosition, SettlementResult } from '@shared/domain/types';
import { api } from '@/lib/wallets/passkey-wallet';
import { useActingOrganisation } from '@/lib/use-acting-organisation';
import { pairName, usePools, useUsdcBalances } from './shared';
import { Flag } from './ui';
import type { Go } from './workspace';
import './dashboard.css';

interface PerpMarket { id: number; pair: string; base: string; quote: string; decimals: number; mark: number; change24h: number; volume24h: number; maxLeverage: number; fundingPredicted: number }
interface PerpAccount { equity: number; onChain: { collateral: number }; positions: { upnl: number; notional: number }[] }
type Hedge = { position: ProtectionPosition; pair: string; settlement: SettlementResult };

/** Short notices for everyone. Newest first. */
const NOTICES: { text: string; date: string }[] = [
  { text: 'Simpler cover: every cover now pays the full move, up to 20% of the amount. No limits to choose.', date: '18 Nov 2026' },
  { text: 'Perps are live on testnet: USD/NGN, USD/GHS, USD/KES and USD/ZAR, up to 20x.', date: '18 Nov 2026' },
  { text: 'Cover now sells on any day from 1 to 90, ending at 14:00 UTC.', date: '24 Oct 2026' },
];

const HIDE_KEY = 'bfx:hide-balance';
const money = (v: number, hide: boolean, dp = 2) => (hide ? '••••••' : `$${v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const signedMoney = (v: number, hide: boolean) => (hide ? '••••' : `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pctS = (v: number, dp = 2) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;
const px = (v: number | null | undefined, dp: number) => (v == null || !Number.isFinite(v) ? '-' : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const compact = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);

/** Open a perp market: the trade screen picks it up from here. */
export function openPerpMarket(go: Go, id: number) {
  try { localStorage.setItem('bfx:perp-market', String(id)); } catch { /* per-viewer convenience */ }
  window.dispatchEvent(new CustomEvent('bfx:perp-market', { detail: id }));
  go('perps');
}

export function Dashboard({ go }: { go: Go }) {
  const acting = useActingOrganisation();
  const [hide, setHide] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem(HIDE_KEY, hide ? '1' : '0'); } catch { /* ignore */ } }, [hide]);

  const wallet = useUsdcBalances();
  const perps = useQuery({ queryKey: ['perps-account', null], queryFn: () => api<PerpAccount>('/api/perps/account'), enabled: !acting, retry: false, refetchInterval: 10_000 });
  const hedges = useQuery({ queryKey: ['dash-hedges', acting?.id ?? 'me'], queryFn: async () => (await api<{ hedges: Hedge[] }>('/api/v2/hedges')).hedges, refetchInterval: 30_000 });

  const walletUsd = wallet.data?.total ?? 0;
  const tradingUsd = perps.data?.equity ?? 0;
  const total = walletUsd + tradingUsd;
  const openPnl = (perps.data?.positions ?? []).reduce((s, p) => s + p.upnl, 0);
  const activeCover = (hedges.data ?? []).filter((h) => h.settlement.status === 'pending' || h.settlement.status === 'settled_claimable');
  const protectedUsd = activeCover.reduce((s, h) => s + Number(h.position.notional), 0);
  const base = total - openPnl;

  return (
    <div className="dx">
      <section className="dx-left">
        <div className="dx-bal-k">Your total balance
          <button className="dx-eye" onClick={() => setHide(!hide)} aria-label={hide ? 'Show balances' : 'Hide balances'}>{hide ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
        <div className="dx-bal num">{money(total, hide)} <span className="dx-unit">USDC</span></div>
        <div className="dx-pnl">Open PnL <span className={`num ${openPnl >= 0 ? 'up' : 'down'}`}>{signedMoney(openPnl, hide)} {!hide && base > 0 ? `(${pctS(openPnl / base)})` : ''}</span></div>

        <div className="dx-split">
          <button onClick={() => go('wallet')}><span>Wallet</span><b className="num">{money(walletUsd, hide)}</b></button>
          <button onClick={() => go('perps')}><span>Trading</span><b className="num">{money(tradingUsd, hide)}</b></button>
          <button onClick={() => go('h-protections')}><span>Cover in force</span><b className="num">{hide ? '••••' : `${compact(protectedUsd)}`}</b><small>{activeCover.length} active</small></button>
        </div>

        <div className="dx-actions">
          <button className="dx-btn primary" onClick={() => go('wallet', { wallet: 'deposit' })}><ArrowDownToLine size={17} />Deposit</button>
          <button className="dx-btn" onClick={() => go('perps')}><LineChart size={17} />Trade</button>
          <button className="dx-btn" onClick={() => go('h-protect')}><ShieldCheck size={17} />Hedge</button>
          <button className="dx-btn" onClick={() => go('otc')}><ArrowLeftRight size={17} />Convert</button>
        </div>

        <div className="dx-notices">
          {NOTICES.map((n) => (
            <div key={n.text} className="dx-notice"><Megaphone size={15} /><span>{n.text}</span><time>{n.date}</time></div>
          ))}
        </div>
      </section>

      <section className="dx-right"><MarketsPanel go={go} /></section>
    </div>
  );
}

type Tab = 'rates' | 'perps' | 'cover';

function MarketsPanel({ go }: { go: Go }) {
  const [tab, setTab] = useState<Tab>('rates');
  const perps = useQuery({ queryKey: ['perps-markets'], queryFn: () => api<{ markets: PerpMarket[] }>('/api/perps/markets'), refetchInterval: 5000, retry: false });
  const pools = usePools();
  const rates = useQuery({ queryKey: ['v2-rates-dash'], queryFn: async () => (await api<{ rates: { pair: string; spot: number | null; change: number | null }[] }>('/api/v2/rates')).rates, refetchInterval: 60_000 });

  /** Per pair: total LP (every pool's value, what underwriters have in) and what is still free to sell. */
  const cover = (() => {
    const by = new Map<string, { pair: string; lp: number; capacity: number; up: boolean; down: boolean }>();
    for (const p of pools.data ?? []) {
      const m = by.get(p.pair) ?? { pair: p.pair, lp: 0, capacity: 0, up: false, down: false };
      m.lp += Number(p.liquidity.nav) || 0;
      if (p.acceptingHedges && Number(p.liquidity.capacity) > 0) {
        m.capacity += Number(p.liquidity.capacity);
        if (p.direction === 'up' || p.direction === 'both') m.up = true;
        if (p.direction === 'down' || p.direction === 'both') m.down = true;
      }
      by.set(p.pair, m);
    }
    return [...by.values()].filter((m) => m.lp > 0).sort((a, b) => b.capacity - a.capacity);
  })();
  const perpList = perps.data?.markets ?? [];

  const perpRow = (m: PerpMarket) => (
    <button key={`p${m.id}`} className="dx-row" onClick={() => openPerpMarket(go, m.id)}>
      <span className="dx-name"><Flag pair={m.pair} /><b>{m.base}{m.quote}</b><small>Perp · {m.maxLeverage}x</small></span>
      <span className="num dx-px">{px(m.mark, m.decimals)}</span>
      <span className={`num dx-ch ${m.change24h >= 0 ? 'up' : 'down'}`}>{pctS(m.change24h)}</span>
    </button>
  );
  const rateOf = (pair: string) => rates.data?.find((r) => r.pair === pair);
  const coverLpRow = (c: (typeof cover)[number]) => (
    <button key={`l${c.pair}`} className="dx-row" onClick={() => go('h-protect', { pair: c.pair })}>
      <span className="dx-name"><Flag pair={c.pair} /><b>{c.pair}</b>{c.capacity <= 0 && <small>Not selling</small>}</span>
      <span className="num dx-px">{rateOf(c.pair)?.spot != null ? rateOf(c.pair)!.spot!.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}</span>
      <span className="num dx-ch">{compact(c.capacity)}</span>
    </button>
  );
  const rateRows = (rates.data ?? []).slice(0, 8).map((r) => (
    <button key={`r${r.pair}`} className="dx-row" onClick={() => go('pair', { pair: r.pair })}>
      <span className="dx-name"><Flag pair={r.pair} /><b>{r.pair}</b><small>{pairName(r.pair)}</small></span>
      <span className="num dx-px">{r.spot != null ? r.spot.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}</span>
      <span className={`num dx-ch ${r.change == null ? 'muted' : r.change >= 0 ? 'up' : 'down'}`}>{r.change == null ? '-' : pctS(r.change)}</span>
    </button>
  ));

  const rows = tab === 'perps' ? perpList.map(perpRow)
    : tab === 'cover' ? cover.map(coverLpRow)
    : rateRows;
  const head = tab === 'cover' ? ['Market', 'Price', 'LP'] : ['Market', 'Price', '24h'];

  return (
    <div className="dx-card">
      <div className="dx-tabs">
        {(['rates', 'perps', 'cover'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'perps' ? 'Perps' : t === 'cover' ? 'Cover' : 'Rates'}</button>
        ))}
        <button className="dx-all" onClick={() => (tab === 'cover' ? go('h-protect') : tab === 'rates' ? go('h-rates') : go('perps'))}>View all</button>
      </div>
      <div className="dx-head"><span>{head[0]}</span><span>{head[1]}</span><span>{head[2]}</span></div>
      {rows.length ? rows : <div className="dx-empty">Loading markets...</div>}
    </div>
  );
}
