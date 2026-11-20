/**
 * The signed-in home: total balance across the wallet and trading, open profit or loss, cover
 * in force, quick actions, a markets panel (perps, cover, rates) and notices.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, CalendarDays, CircleDollarSign, Eye, EyeOff, Layers, LineChart, Megaphone, PlusCircle, Repeat, ShieldCheck, Wallet } from 'lucide-react';
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
const NOTICES: { title: string; text: string; date: string }[] = [
  { title: 'Simpler cover', text: 'Every cover now pays the full move, up to 20% of the amount. No limits to choose.', date: '18 Nov 2026' },
  { title: 'Perps are live on testnet', text: 'USD/NGN, USD/GHS, USD/KES and USD/ZAR, up to 20x.', date: '18 Nov 2026' },
  { title: 'Cover on any day', text: 'Cover now sells for any end date from 1 to 90 days, ending at 14:00 UTC.', date: '24 Oct 2026' },
];

/** Ring colours for cover by pair (brand blues and a few accents). */
const RING = ['#2563eb', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444'];

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
        <div className="dx-hero">
          <div className="dx-bal-k">Portfolio
            <button className="dx-eye" onClick={() => setHide(!hide)} aria-label={hide ? 'Show balances' : 'Hide balances'}>{hide ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          <div className="dx-bal num">{money(total, hide)} <span className="dx-unit">USDC</span></div>
          <div className="dx-pnl">Open PnL <span className={`num ${openPnl >= 0 ? 'up' : 'down'}`}>{signedMoney(openPnl, hide)} {!hide && base > 0 ? `(${pctS(openPnl / base)})` : ''}</span></div>
        </div>

        <div className="dx-split">
          <button onClick={() => go('wallet')}><span><Wallet size={15} />Wallet</span><b className="num">{money(walletUsd, hide)}</b></button>
          <button onClick={() => go('perps')}><span><ArrowLeftRight size={15} />Trading</span><b className="num">{money(tradingUsd, hide)}</b></button>
          <button onClick={() => go('h-protections')}><span><Layers size={15} />Cover in force</span><b className="num">{hide ? '••••' : `${compact(protectedUsd)}`}</b><small>{activeCover.length} active</small></button>
        </div>

        <div className="dx-card dx-quick">
          <div className="dx-card-h"><b>Quick actions</b></div>
          <div className="dx-qgrid">
            <button className="primary" onClick={() => go('wallet', { wallet: 'deposit' })}><PlusCircle size={20} /><b>Deposit</b><small>Add USDC</small></button>
            <button onClick={() => go('h-protect')}><ShieldCheck size={20} /><b>Hedge</b><small>Buy cover</small></button>
            <button onClick={() => go('perps')}><LineChart size={20} /><b>Trade</b><small>Perps</small></button>
            <button onClick={() => go('otc')}><Repeat size={20} /><b>Swap</b><small>USDC and cash</small></button>
          </div>
        </div>

        <CoverCard go={go} hide={hide} active={activeCover} />

        <div className="dx-card dx-updates">
          <div className="dx-card-h"><b>Updates</b></div>
          {NOTICES.map((n) => (
            <div key={n.title} className="dx-update">
              <span className="dx-update-i"><Megaphone size={16} /></span>
              <div><b>{n.title}</b><p>{n.text}</p></div>
              <time>{n.date}</time>
            </div>
          ))}
        </div>
      </section>

      <section className="dx-right"><MarketsPanel go={go} /></section>
    </div>
  );
}


/** Cover in force: a ring split by pair, with the count, next expiry and payout waiting to be claimed. */
function CoverCard({ go, hide, active }: { go: Go; hide: boolean; active: Hedge[] }) {
  const byPair = new Map<string, number>();
  for (const h of active) byPair.set(h.pair, (byPair.get(h.pair) ?? 0) + Number(h.position.notional));
  const parts = [...byPair.entries()].sort((a, b) => b[1] - a[1]);
  const total = parts.reduce((x, [, v]) => x + v, 0);
  const pending = active.filter((h) => h.settlement.status === 'pending');
  const nowS = Date.now() / 1000;
  const upcoming = pending.map((h) => Number(h.position.expiry)).filter((x) => x > nowS);
  const next = upcoming.length ? Math.min(...upcoming) : null;
  const toClaim = active.filter((h) => h.settlement.status === 'settled_claimable').reduce((x, h) => x + Number(h.settlement.netPayout), 0);
  const R = 42, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="dx-card dx-cover">
      <div className="dx-card-h"><b>Your cover</b><button className="dx-link" onClick={() => go('h-protections')}>View all</button></div>
      {!active.length ? (
        <div className="dx-cover-empty">No cover in force. <button className="dx-link" onClick={() => go('h-protect')}>Buy cover</button></div>
      ) : (
        <div className="dx-cover-in">
          <div className="dx-ring">
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r={R} fill="none" stroke="var(--soft)" strokeWidth="9" />
              {parts.map(([pair, v], i) => {
                const len = total ? (v / total) * C : 0;
                const el = <circle key={pair} cx="50" cy="50" r={R} fill="none" stroke={RING[i % RING.length]} strokeWidth="9" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" />;
                offset += len;
                return el;
              })}
            </svg>
            <div className="dx-ring-c"><b className="num">{hide ? '••••' : compact(total)}</b><small>In force</small></div>
          </div>
          <div className="dx-cover-list">
            <div><span><ShieldCheck size={15} />Active covers</span><b className="num">{active.length}</b></div>
            <div><span><CalendarDays size={15} />Next expiry</span><b>{next ? new Date(next * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}</b></div>
            <div><span><CircleDollarSign size={15} />Payout to claim</span><b className={`num ${toClaim > 0 ? 'up' : ''}`}>{hide ? '••••' : `$${toClaim.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</b></div>
            <div className="dx-pairs">{parts.slice(0, 4).map(([pair], i) => <span key={pair}><i style={{ background: RING[i % RING.length] }} />{pair}</span>)}</div>
          </div>
        </div>
      )}
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
      <span className="dx-name"><Flag pair={m.pair} /><b>{m.base}{m.quote}</b><small>Perp, up to {m.maxLeverage}x</small></span>
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
