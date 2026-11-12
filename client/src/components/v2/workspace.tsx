/**
 * The BlockFinaX workspace, after the approved design: a navigation rail with the
 * Hedger/Underwriter switch, a top bar with search and the role's main actions, and
 * pages built from a main column, a right column and docked action panels.
 *   Hedger: "What do you want to protect?"
 *   Underwriter: "How do you want your capital exposed?"
 */
import { ContactSales, NetworkSwitch } from './demo';
import { VerifyModal } from './verify';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Building2, Check, ChevronDown, CircleUser, GraduationCap, Home, Inbox, Layers, LineChart, List, Menu, Search, ShieldCheck, Store, Wallet, X } from 'lucide-react';
import logoPath from '@/assets/logo.png';
import { usePasskeySession } from '@/lib/identity';
import { ccyName, exposureLabel, fmt, poolRef, quoteCcy, useChains, useIsDemo, usePools, useUsdcBalances } from './shared';
import { Flag, Spin } from './ui';
import { HedgerHome, MyProtections, PairPage, ProtectPage, RatesPage } from './hedger-pages';
import { CreatePool, MyPools, PoolPage, RiskPage, UnderwriterHome, WithdrawCapital } from './underwriter-pages';
import { AccountPage, WalletPage, type WalletMode } from './money-pages';
import { AgentChat } from './agent-chat';
import { ProductTour } from './tour';
import { UnderwriterRequests } from './rfq';
import { LegalCard, useLegalStatus } from './legal-card';
import { api } from '@/lib/wallets/passkey-wallet';
import { onActingOrganisationChange, pendingInviteToken } from '@/lib/acting-organisation';
import { useActingOrganisation } from '@/lib/use-acting-organisation';
import { AccountMenu } from './account-menu';
import { OrganisationSettingsPage } from './organisation-card';
import { useViewMode, type ViewMode } from './view-mode';
import './workspace.css';

export type Role = 'hedger' | 'underwriter';
export type Page =
  | 'h-home' | 'h-markets' | 'h-protect' | 'h-protections' | 'h-rates' | 'wallet' | 'account' | 'org-settings' | 'pair'
  | 'u-home' | 'u-pools' | 'u-create' | 'u-pool' | 'u-risk' | 'u-withdraw' | 'u-requests';
export interface Target {
  /** Show the chart and buying panel on Markets (someone means to buy), not only the list. */
  buy?: boolean;
  rfq?: boolean; wallet?: 'deposit' | 'withdraw'; position?: string; pair?: string; pool?: string; direction?: 'up' | 'down'; days?: number; rates?: 'fx' | 'ir'; benchmark?: string }
export type Go = (page: Page, target?: Target) => void;

const NAV: Record<Role, { page: Page; label: string; icon: ReactNode }[]> = {
  hedger: [
    { page: 'h-home', label: 'Home', icon: <Home /> },
    { page: 'h-protect', label: 'Markets', icon: <Store /> },
    { page: 'h-protections', label: 'My protections', icon: <List /> },
    { page: 'h-rates', label: 'Rates', icon: <LineChart /> },
    { page: 'wallet', label: 'Wallet', icon: <Wallet /> },
  ],
  underwriter: [
    { page: 'u-home', label: 'Home', icon: <Home /> },
    { page: 'u-pools', label: 'Pools', icon: <Layers /> },
    { page: 'u-requests', label: 'Quote requests', icon: <Inbox /> },
    { page: 'u-risk', label: 'Risk and exposure', icon: <LineChart /> },
    { page: 'u-withdraw', label: 'Withdraw capital', icon: <ArrowUp /> },
    { page: 'wallet', label: 'Wallet', icon: <Wallet /> },
  ],
};

/** Simple: for businesses. Hedge, their cover, rates and wallet; no underwriting. */
const SIMPLE_NAV: { page: Page; label: string; icon: ReactNode }[] = [
  { page: 'h-protect', label: 'Hedge', icon: <ShieldCheck /> },
  { page: 'h-protections', label: 'My cover', icon: <List /> },
  { page: 'h-rates', label: 'Rates', icon: <LineChart /> },
  { page: 'wallet', label: 'Wallet', icon: <Wallet /> },
];
const SIMPLE_TABS: Page[] = ['h-protect', 'h-protections', 'h-rates', 'wallet'];
/** Pages Simple can show: its menu, plus settings and a rate or cover opened from a list. */
const SIMPLE_PAGES: Page[] = [...SIMPLE_TABS, 'account', 'org-settings', 'pair'];
/** Short names for the icon rail. */
const RAIL_LABEL: Partial<Record<Page, string>> = { 'h-protections': 'My cover', 'u-requests': 'Requests', 'u-risk': 'Risk', 'u-withdraw': 'Withdraw' };

/** One button to the other view: Advanced while in Simple, Simple while in Advanced. */
function ViewSwitch({ mode, onChange }: { mode: ViewMode; onChange: (v: ViewMode) => void }) {
  const other: ViewMode = mode === 'simple' ? 'advanced' : 'simple';
  return (
    <button className="bx-viewbtn" onClick={() => onChange(other)} title={other === 'advanced' ? 'Show the full app' : 'Show the simple view'}>
      {other === 'advanced' ? 'Advanced' : 'Simple'}
    </button>
  );
}

/** Pages on the phone tab bar; everything else sits under More. */
const TABS: Record<Role, Page[]> = {
  hedger: ['h-home', 'h-protect', 'h-protections', 'wallet'],
  underwriter: ['u-home', 'u-pools', 'u-risk', 'wallet'],
};
const SHORT: Partial<Record<Page, string>> = { 'h-protections': 'Protections', 'u-risk': 'Risk' };
/** Pages reached from another page keep that page highlighted in the menu. */
const PARENT: Partial<Record<Page, Page>> = { 'u-create': 'u-pools', 'u-pool': 'u-pools' };

/**
 * On phones, list rows stack into cards, so each cell needs its column name. This copies the
 * names from each list header onto the cells below it (CSS shows them only on small screens).
 */
function useListLabels(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const label = () => {
      el.querySelectorAll<HTMLElement>('.bx-list-h').forEach((head) => {
        const names = Array.from(head.children).map((c) => (c.textContent ?? '').trim());
        let row = head.nextElementSibling as HTMLElement | null;
        while (row && row.classList.contains('bx-li')) {
          Array.from(row.children).forEach((cell, i) => {
            if (i > 0 && names[i] && cell.getAttribute('data-label') !== names[i]) cell.setAttribute('data-label', names[i]);
          });
          row = row.nextElementSibling as HTMLElement | null;
        }
      });
    };
    label();
    const obs = new MutationObserver(label);
    obs.observe(el, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [root]);
}

type Theme = 'light' | 'dark';
const THEME_KEY = 'bfx-theme';
function readTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

function readRole(): Role {
  try { return localStorage.getItem('bfx:cover-role') === 'underwriter' ? 'underwriter' : 'hedger'; } catch { return 'hedger'; }
}

export function Workspace() {
  const [viewMode, setViewMode] = useViewMode();
  const demo = useIsDemo();
  const simple = viewMode === 'simple';
  const [chosenRole, setRole] = useState<Role>(readRole);
  const role: Role = simple ? 'hedger' : chosenRole;
  const nav = simple ? SIMPLE_NAV : NAV[role];
  const tabs = simple ? SIMPLE_TABS : TABS[role];
  // An organisation invitation opened before sign-in waits on the Account page.
  const [page, setPage] = useState<Page>(() => (pendingInviteToken() ? 'account' : simple ? 'h-protect' : role === 'hedger' ? 'h-home' : 'u-home'));
  // Switching to Simple from a page it does not have opens Buy cover.
  useEffect(() => { if (simple && !SIMPLE_PAGES.includes(page)) setPage('h-protect'); }, [simple, page]);
  const [pair, setPair] = useState<string | null>(null);
  const [pool, setPool] = useState<string | null>(null);
  const [buy, setBuy] = useState<Target>({});
  const [ratesAt, setRatesAt] = useState<Target>({});
  const [pairAt, setPairAt] = useState<Target>({});
  const [walletMode, setWalletMode] = useState<WalletMode>('none');
  const [, setLocation] = useLocation();
  const { session } = usePasskeySession();
  const balances = useUsdcBalances();

  const go: Go = (p, target) => {
    if (p === 'h-markets') p = 'h-protect'; // Markets and buying are one page
    if (target?.pair !== undefined) setPair(target.pair);
    if (target?.pool !== undefined) setPool(target.pool);
    if (p === 'h-protect') setBuy(target ?? {});
    if (p === 'h-rates') setRatesAt(target ?? {});
    if (p === 'pair') setPairAt(target ?? {});
    if (p === 'wallet') setWalletMode(target?.wallet ?? 'none');
    // The rail has no role switch: opening an underwriting or hedging page sets the side.
    const side: Role | null = p.startsWith('u-') ? 'underwriter' : p.startsWith('h-') ? 'hedger' : null;
    if (side && side !== chosenRole) {
      setRole(side);
      try { localStorage.setItem('bfx:cover-role', side); } catch { /* per-viewer convenience */ }
    }
    setPage(p);
    window.scrollTo(0, 0);
  };
  const switchRole = (r: Role) => {
    setRole(r);
    setPage(r === 'hedger' ? 'h-home' : 'u-home');
    try { localStorage.setItem('bfx:cover-role', r); } catch { /* per-viewer convenience */ }
  };
  const [more, setMore] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const chooseTheme = (next: Theme) => {
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* per-viewer convenience */ }
  };
  const content = useRef<HTMLDivElement>(null);
  useListLabels(content);
  const goTab = (p: Page) => { setMore(false); go(p); };
  // New accounts give their profile (name, country, individual or business) at sign-up,
  // before their passkey (wallet/profile-step.tsx); the workspace never stops for it.
  const qc = useQueryClient();
  // Switching between a personal account and a business must never show the other one's numbers.
  const acting = useActingOrganisation();
  useEffect(() => onActingOrganisationChange(() => { void qc.resetQueries(); }), [qc]);
  const viewOnly = acting?.role === 'viewer';
  // Which menu item to highlight on a page that has no item of its own: a cover opened from
  // My protections lights My protections; a pair opened from Markets lights Markets.
  const parentPage: Page | undefined = page === 'pair'
    ? (role === 'hedger' ? (pairAt.position ? 'h-protections' : 'h-protect') : 'u-pools')
    : PARENT[page];

  // Terms of Use and Privacy Policy: a new account accepts them once, right after it is created.
  // Existing accounts are never stopped here, and a failed check does not block anyone.
  const legal = useLegalStatus(session?.user.id ?? null);
  if (session && legal.isPending) {
    return <div className="bx" data-theme={theme}><div className="bx-onboard"><Spin /></div></div>;
  }
  if (session && legal.data?.needsAcceptance) {
    return <div className="bx" data-theme={theme}><LegalCard updated={Boolean(legal.data?.updated)} /></div>;
  }

  return (
    <div className="bx" data-theme={theme}>
      <div className="bx-content" ref={content}>
        <ContactSales />
        <VerifyModal />
        <header className="bx-top">
          <div className="bx-mbrand bx-show-sm"><img src={logoPath} alt="" />BlockFinaX</div>
          <div className="bx-tbrand bx-hide-sm"><img src={logoPath} alt="" />BlockFinaX{demo && <span className="bx-env">Testnet</span>}</div>
          {!simple && <RoleMenu role={role} onChange={switchRole} />}
          <nav className="bx-topnav bx-hide-sm" aria-label="Main">
            {nav.filter((n) => n.page !== 'wallet').map((n) => {
              const on = page === n.page || parentPage === n.page;
              return <button key={n.page} data-tour={n.page} className={`bx-tnav${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => go(n.page)}>{RAIL_LABEL[n.page] ?? n.label}</button>;
            })}
          </nav>
          <SearchBox role={role} go={go} />
          <div className="bx-top-r">
            <button className={`bx-balance-pill bx-hide-sm${page === 'wallet' ? ' on' : ''}`} data-tour="balance" onClick={() => go('wallet')}>Wallet · <span className="num">${fmt(balances.data?.total)} USDC</span></button>
            <span className="bx-hide-sm"><ViewSwitch mode={viewMode} onChange={setViewMode} /></span>
            {viewOnly ? null : <button className="bx-btn bx-hide-sm" onClick={() => go('wallet', { wallet: 'deposit' })}>Deposit</button>}
            <button className="bx-balance-pill num bx-show-sm" data-tour="balance" onClick={() => go('wallet')}>${fmt(balances.data?.total, 2)}</button>
            <span className="bx-top-account"><AccountMenu go={go} page={page} theme={theme} onTheme={chooseTheme} placement="top" /></span>
          </div>
        </header>

        {page === 'h-home' && <HedgerHome go={go} />}
        {page === 'h-protect' && <ProtectPage go={go} pair={buy.pair ?? pair} target={buy} />}
        {page === 'h-protections' && <MyProtections go={go} />}
        {page === 'h-rates' && <RatesPage go={go} target={ratesAt} />}
        {page === 'wallet' && <WalletPage mode={walletMode} />}
        {page === 'pair' && pairAt.pair && <PairPage key={pairAt.position ?? pairAt.pair} go={go} pair={pairAt.pair} role={role} focus={pairAt.position} />}
        {page === 'account' && <AccountPage go={go} />}
        {page === 'org-settings' && <OrganisationSettingsPage go={go} />}
        {page === 'u-home' && <UnderwriterHome go={go} />}
        {page === 'u-pools' && <MyPools go={go} />}
        {page === 'u-create' && <CreatePool go={go} />}
        {page === 'u-pool' && <PoolPage go={go} poolRef={pool} />}
        {page === 'u-risk' && <RiskPage go={go} poolRef={pool} />}
        {page === 'u-withdraw' && <WithdrawCapital go={go} poolRef={pool} />}
        {page === 'u-requests' && <UnderwriterRequests />}
        <StatusBar />
      </div>

      <AgentChat />
      <ProductTour role={role} userId={session?.user.id} />

      <nav className="bx-tabs" aria-label="Main">
        {tabs.map((p) => {
          const n = nav.find((x) => x.page === p)!;
          return (
            <button key={p} data-tour={p} className={`${(page === p || parentPage === p) && !more ? 'on' : ''}${p === 'h-protect' ? ' primary' : ''}`} onClick={() => goTab(p)}>
              {n.icon}<span>{simple ? n.label : SHORT[p] ?? n.label}</span>
            </button>
          );
        })}
        <button className={more || !(tabs.includes(page) || tabs.includes(parentPage as Page)) ? 'on' : ''} onClick={() => setMore((m) => !m)} aria-expanded={more}>
          {more ? <X /> : <Menu />}<span>More</span>
        </button>
      </nav>

      {more && (
        <div className="bx-sheet-bg" onClick={() => setMore(false)}>
          <div className="bx-sheet" role="dialog" aria-label="More" onClick={(e) => e.stopPropagation()}>
            <ViewSwitch mode={viewMode} onChange={(v) => { setViewMode(v); setMore(false); }} />
            {!simple && (
              <div className="bx-roles">
                <button className={role === 'hedger' ? 'on' : ''} onClick={() => { switchRole('hedger'); setMore(false); }}>Hedger</button>
                <button className={role === 'underwriter' ? 'on' : ''} onClick={() => { switchRole('underwriter'); setMore(false); }}>Underwriter</button>
              </div>
            )}
            {nav.filter((n) => !tabs.includes(n.page)).map((n) => (
              <button key={n.page} className={`bx-nav${page === n.page ? ' on' : ''}`} onClick={() => goTab(n.page)}>{n.icon}{n.label}</button>
            ))}
            {acting && <button className={`bx-nav${page === 'org-settings' ? ' on' : ''}`} onClick={() => goTab('org-settings')}><Building2 />Business settings</button>}
            <button className={`bx-nav${page === 'account' ? ' on' : ''}`} onClick={() => goTab('account')}><CircleUser />Profile settings</button>
            {!simple && <button className="bx-nav" onClick={() => setLocation('/learn')}><GraduationCap />Academy</button>}
            <div style={{ marginTop: 8 }}><NetworkSwitch /></div>
          </div>
        </div>
      )}
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
        .map((p) => ({ key: p, pair: p, title: ccyName(p), sub: p, act: () => go('h-protect', { pair: p, buy: true }) }));
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

/** The thin bar along the bottom: network, live rates and the time cover ends by (UTC). */
function StatusBar() {
  const env = useChains().data?.environment;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const utc = now.toISOString().slice(11, 16);
  return (
    <footer className="bx-status bx-hide-sm">
      <span><i className="bx-dot" aria-hidden="true" />Live rates</span>
      {env && <span>{env === 'testnet' ? 'Testnet, test USDC only' : 'Mainnet'}</span>}
      <span className="r">{utc} UTC · cover ends at 14:00 UTC</span>
    </footer>
  );
}

/** Hedger or Underwriter: a small dropdown that swaps the menu in the rail (Advanced only). */
function RoleMenu({ role, onChange }: { role: Role; onChange: (r: Role) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const options: [Role, string, string][] = [
    ['hedger', 'Hedger', 'Protect payments and income'],
    ['underwriter', 'Underwriter', 'Fund pools and earn premiums'],
  ];
  return (
    <div className="bx-rolemenu bx-hide-sm" ref={box} data-tour="roles">
      <button className="bx-rolemenu-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {role === 'hedger' ? 'Hedger' : 'Underwriter'} <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="bx-rolemenu-list" role="menu">
          {options.map(([r, label, sub]) => (
            <button key={r} role="menuitemradio" aria-checked={role === r} className={role === r ? 'on' : ''} onClick={() => { onChange(r); setOpen(false); }}>
              <span><b>{label}</b><span>{sub}</span></span>
              {role === r && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
