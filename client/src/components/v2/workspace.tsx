/**
 * The BlockFinaX workspace, after the approved design: a navigation rail with the
 * Hedger/Underwriter switch, a top bar with search and the role's main actions, and
 * pages built from a main column, a right column and docked action panels.
 *   Hedger: "What do you want to protect?"
 *   Underwriter: "How do you want your capital exposed?"
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { ArrowDown, ArrowUp, CircleUser, Home, Layers, LineChart, List, PlusCircle, Search, Shield, SlidersHorizontal, Store, Wallet } from 'lucide-react';
import logoPath from '@/assets/logo.png';
import { usePasskeySession } from '@/lib/identity';
import { ccyName, exposureLabel, fmt, poolRef, quoteCcy, usePools, useUsdcBalances } from './shared';
import { Flag } from './ui';
import { HedgerHome, MarketsPage, MyProtections, ProtectPage, RatesPage } from './hedger-pages';
import { CreatePool, MyPools, PoolPage, RiskPage, UnderwriterHome, WithdrawCapital } from './underwriter-pages';
import { AccountPage, AddFunds, SendFunds } from './money-pages';
import './workspace.css';

export type Role = 'hedger' | 'underwriter';
export type Page =
  | 'h-home' | 'h-markets' | 'h-protect' | 'h-protections' | 'h-rates' | 'funds' | 'send' | 'account'
  | 'u-home' | 'u-pools' | 'u-create' | 'u-pool' | 'u-risk' | 'u-withdraw';
export interface Target { pair?: string; pool?: string; direction?: 'up' | 'down'; days?: number; rates?: 'fx' | 'ir'; benchmark?: string }
export type Go = (page: Page, target?: Target) => void;

const NAV: Record<Role, { page: Page; label: string; icon: ReactNode }[]> = {
  hedger: [
    { page: 'h-home', label: 'Home', icon: <Home /> },
    { page: 'h-markets', label: 'Markets', icon: <Store /> },
    { page: 'h-protect', label: 'Protect', icon: <Shield /> },
    { page: 'h-protections', label: 'My protections', icon: <List /> },
    { page: 'h-rates', label: 'Rates', icon: <LineChart /> },
    { page: 'funds', label: 'Add funds', icon: <ArrowDown /> },
    { page: 'send', label: 'Withdraw', icon: <ArrowUp /> },
  ],
  underwriter: [
    { page: 'u-home', label: 'Home', icon: <Home /> },
    { page: 'u-pools', label: 'My pools', icon: <Layers /> },
    { page: 'u-create', label: 'Create pool', icon: <PlusCircle /> },
    { page: 'u-pool', label: 'Tenor pricing', icon: <SlidersHorizontal /> },
    { page: 'u-risk', label: 'Risk and exposure', icon: <LineChart /> },
    { page: 'u-withdraw', label: 'Withdraw', icon: <ArrowUp /> },
  ],
};

function readRole(): Role {
  try { return localStorage.getItem('bfx:cover-role') === 'underwriter' ? 'underwriter' : 'hedger'; } catch { return 'hedger'; }
}

export function Workspace() {
  const [role, setRole] = useState<Role>(readRole);
  const [page, setPage] = useState<Page>(role === 'hedger' ? 'h-home' : 'u-home');
  const [pair, setPair] = useState<string | null>(null);
  const [pool, setPool] = useState<string | null>(null);
  const [buy, setBuy] = useState<Target>({});
  const [ratesAt, setRatesAt] = useState<Target>({});
  const [, setLocation] = useLocation();
  const { session } = usePasskeySession();
  const balances = useUsdcBalances();

  const go: Go = (p, target) => {
    if (target?.pair !== undefined) setPair(target.pair);
    if (target?.pool !== undefined) setPool(target.pool);
    if (p === 'h-protect') setBuy(target ?? {});
    if (p === 'h-rates') setRatesAt(target ?? {});
    setPage(p);
    window.scrollTo(0, 0);
  };
  const switchRole = (r: Role) => {
    setRole(r);
    setPage(r === 'hedger' ? 'h-home' : 'u-home');
    try { localStorage.setItem('bfx:cover-role', r); } catch { /* per-viewer convenience */ }
  };
  const initials = (session?.user.name || session?.user.email || 'BX').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

  return (
    <div className="bx">
      <nav className="bx-rail" aria-label="Main">
        <div className="bx-brand"><img src={logoPath} alt="" />BlockFinaX</div>
        <div className="bx-roles">
          <button className={role === 'hedger' ? 'on' : ''} onClick={() => switchRole('hedger')}>Hedger</button>
          <button className={role === 'underwriter' ? 'on' : ''} onClick={() => switchRole('underwriter')}>Underwriter</button>
        </div>
        <div className="bx-navs">
          {NAV[role].map((n) => (
            <button key={n.page} className={`bx-nav${page === n.page ? ' on' : ''}`} onClick={() => go(n.page)}>{n.icon}{n.label}</button>
          ))}
        </div>
        <div className="bx-rail-foot">
          <div className="bx-testnet">Testnet · test USDC only</div>
          <button className={`bx-nav${page === 'account' ? ' on' : ''}`} onClick={() => go('account')}><CircleUser />Account</button>
          <button className="bx-nav" onClick={() => setLocation('/home')}><Wallet />Back to wallet</button>
        </div>
      </nav>

      <div className="bx-content">
        <header className="bx-top">
          <SearchBox role={role} go={go} />
          <div className="bx-top-r">
            <span className="bx-balance-pill num bx-hide-sm">${fmt(balances.data?.total)} USDC</span>
            {role === 'hedger' ? (
              <>
                <button className="bx-btn ghost bx-hide-sm" onClick={() => go('funds')}>Add funds</button>
                <button className="bx-btn" onClick={() => go('h-protect')}>Protect an exposure</button>
              </>
            ) : (
              <>
                <button className="bx-btn ghost bx-hide-sm" onClick={() => go('u-pools')}>Add liquidity</button>
                <button className="bx-btn" onClick={() => go('u-create')}>Create pool</button>
              </>
            )}
            <button className="bx-avatar" aria-label="Account" onClick={() => go('account')}>{initials}</button>
          </div>
        </header>

        {page === 'h-home' && <HedgerHome go={go} />}
        {page === 'h-markets' && <MarketsPage go={go} />}
        {page === 'h-protect' && <ProtectPage go={go} pair={buy.pair ?? pair} target={buy} />}
        {page === 'h-protections' && <MyProtections go={go} />}
        {page === 'h-rates' && <RatesPage go={go} target={ratesAt} />}
        {page === 'funds' && <AddFunds />}
        {page === 'send' && <SendFunds />}
        {page === 'account' && <AccountPage />}
        {page === 'u-home' && <UnderwriterHome go={go} />}
        {page === 'u-pools' && <MyPools go={go} />}
        {page === 'u-create' && <CreatePool go={go} />}
        {page === 'u-pool' && <PoolPage go={go} poolRef={pool} />}
        {page === 'u-risk' && <RiskPage go={go} poolRef={pool} />}
        {page === 'u-withdraw' && <WithdrawCapital go={go} poolRef={pool} />}
      </div>
    </div>
  );
}

/** Search currencies (hedger) or pools (underwriter) and jump straight to them. */
function SearchBox({ role, go }: { role: Role; go: Go }) {
  const pools = usePools();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const all = pools.data ?? [];
    if (role === 'hedger') {
      const pairs = Array.from(new Set(all.map((p) => p.pair)));
      return pairs
        .filter((p) => `${p} ${ccyName(p)} ${quoteCcy(p)}`.toLowerCase().includes(term))
        .map((p) => ({ key: p, pair: p, title: ccyName(p), sub: p, act: () => go('h-protect', { pair: p }) }));
    }
    return all
      .filter((p) => `${p.pair} ${ccyName(p.pair)} ${exposureLabel(p.pair, p.direction === 'both' ? 'up' : p.direction).cover}`.toLowerCase().includes(term))
      .map((p) => ({ key: poolRef(p), pair: p.pair, title: exposureLabel(p.pair, p.direction === 'both' ? 'up' : p.direction).cover, sub: `$${fmt(p.liquidity.nav, 0)} pool`, act: () => go('u-pool', { pool: poolRef(p) }) }));
  }, [q, pools.data, role, go]);

  return (
    <label className="bx-search">
      <Search size={17} aria-hidden="true" />
      <input
        aria-label={role === 'hedger' ? 'Search currencies' : 'Search pools'}
        placeholder={role === 'hedger' ? 'Search currencies' : 'Search pools'}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { results[0].act(); setQ(''); } }}
      />
      {open && results.length > 0 && (
        <div className="bx-search-results">
          {results.slice(0, 6).map((r) => (
            <button key={r.key} type="button" onMouseDown={() => { r.act(); setQ(''); }}>
              <Flag pair={r.pair} />
              <span><span style={{ display: 'block', fontWeight: 600 }}>{r.title}</span><span className="muted" style={{ fontSize: 12 }}>{r.sub}</span></span>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}
