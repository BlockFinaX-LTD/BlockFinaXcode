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
import { ArrowLeftRight, ArrowUp, Building2, Check, ChevronDown, ChevronLeft, CircleUser, GraduationCap, Home, Inbox, Layers, LineChart, List, Menu, MessageCircle, Search, ShieldCheck, Store, Wallet, X } from 'lucide-react';
import logoPath from '@/assets/logo.png';
import { usePasskeySession } from '@/lib/identity';
import { ccyName, exposureLabel, fmt, poolRef, quoteCcy, useChains, useIsDemo, usePools, useUsdcBalances } from './shared';
import { Flag, Spin } from './ui';
import { HedgerHome, MyProtections, PairPage, ProtectPage, RatesPage } from './hedger-pages';
import { CreatePool, UnderwriteDesk } from './underwriter-pages';
import { AccountPage, WalletPage, type WalletMode } from './money-pages';
import { AgentChat } from './agent-chat';
import { ProductTour } from './tour';
import { UnderwriterRequests } from './rfq';
import { OtcPage } from './otc';
import { PerpsPage } from './perps';
import { OtcSwap } from './otc-swap';
import { Dashboard, openPerpMarket } from './dashboard';
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
  | 'h-home' | 'h-markets' | 'h-protect' | 'h-protections' | 'h-rates' | 'wallet' | 'otc' | 'perps' | 'dash' | 'account' | 'org-settings' | 'pair'
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
const SIMPLE_PAGES: Page[] = [...SIMPLE_TABS, 'account', 'org-settings', 'pair', 'perps', 'otc', 'dash'];
/** Short names for the icon rail. */
const RAIL_LABEL: Partial<Record<Page, string>> = { 'h-protections': 'My cover', 'u-requests': 'Requests', 'u-risk': 'Risk', 'u-withdraw': 'Withdraw' };

/**
 * Three sections, always in the top bar: Hedge, Trade (perps) and OTC. Each shows only its own
 * menu. Wallet, profile and settings belong to no section and open inside the current one.
 */
type Section = 'home' | 'hedge' | 'trade' | 'otc';
const SECTION_KEY = 'bfx:section';
const NEUTRAL: Page[] = ['wallet', 'account', 'org-settings'];
const sectionOf = (p: Page): Section | null => (NEUTRAL.includes(p) ? null : p === 'dash' ? 'home' : p === 'perps' ? 'trade' : p === 'otc' ? 'otc' : 'hedge');
const PAGE_TITLE: Partial<Record<Page, string>> = { wallet: 'Wallet', account: 'Profile', 'org-settings': 'Business settings' };
const SECTION_NAME: Record<Section, string> = { home: 'Home', hedge: 'Hedge', trade: 'Trade', otc: 'OTC' };

/** The page this browser tab was on, so a refresh returns to it. Session storage: a new tab starts at Home. */
const VIEW_KEY = 'bfx:view';
const RESTORABLE: Page[] = ['dash', 'h-home', 'h-protect', 'h-protections', 'h-rates', 'wallet', 'otc', 'perps', 'account', 'org-settings', 'pair',
  'u-home', 'u-pools', 'u-pool', 'u-create', 'u-risk', 'u-withdraw', 'u-requests'];
function readView(): { page: Page; pair: string | null; pool: string | null } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null');
    if (!v || !RESTORABLE.includes(v.page) || (v.page === 'pair' && !v.pair)) return null;
    return { page: v.page, pair: v.pair ?? null, pool: v.pool ?? null };
  } catch { return null; }
}
function writeView(v: { page: Page; pair: string | null; pool: string | null }) {
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* storage blocked: refresh goes Home */ }
}
function readSection(): Section | null {
  try { const v = localStorage.getItem(SECTION_KEY); return v === 'home' || v === 'trade' || v === 'hedge' || v === 'otc' ? v : null; } catch { return null; }
}

function SectionTabs({ section, onChange, compact }: { section: Section | null; onChange: (s: Section) => void; compact?: boolean }) {
  return (
    <nav className={`bx-sections${compact ? ' compact' : ''}`} aria-label="Sections">
      {(['home', 'hedge', 'trade', 'otc'] as Section[]).map((k) => (
        <button key={k} className={section === k ? 'on' : ''} aria-current={section === k ? 'page' : undefined} onClick={() => onChange(k)}>
          {compact && (k === 'home' ? <Home size={15} /> : k === 'hedge' ? <ShieldCheck size={15} /> : k === 'trade' ? <LineChart size={15} /> : <Layers size={15} />)}
          {SECTION_NAME[k]}
        </button>
      ))}
    </nav>
  );
}

/** A top-bar section with a dropdown of its pages, opened on hover or click. */
function NavMenu({ label, active, onOpen, items }: { label: string; active: boolean; onOpen: () => void; items: ({ label: string; sub?: string; onClick: () => void; on?: boolean } | { heading: string })[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="bx-nm" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className={`bx-nm-btn${active ? ' on' : ''}`} aria-expanded={open} onClick={() => { onOpen(); setOpen(false); }}>{label}<ChevronDown size={15} /></button>
      {open && (
        <div className="bx-nm-menu" role="menu">
          {items.map((it, i) => 'heading' in it
            ? <div key={i} className="bx-nm-h">{it.heading}</div>
            : <button key={i} role="menuitem" className={`bx-nm-item${it.on ? ' on' : ''}`} onClick={() => { it.onClick(); setOpen(false); }}><span>{it.label}</span>{it.sub && <small>{it.sub}</small>}</button>)}
        </div>
      )}
    </div>
  );
}

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
  const startSection = readSection();
  // A refresh comes back to the same page (kept for this browser tab only).
  const saved = readView();
  const [page, setPage] = useState<Page>(() => {
    if (pendingInviteToken()) return 'account';
    return saved?.page ?? 'dash';
  });
  const [section, setSection] = useState<Section>(() => (saved?.page ? sectionOf(saved.page) ?? 'home' : 'home'));
  useEffect(() => { const s2 = sectionOf(page); if (s2) setSection(s2); }, [page]);
  // Switching to Simple from a page it does not have opens Buy cover.
  useEffect(() => { if (simple && !SIMPLE_PAGES.includes(page)) setPage('h-protect'); }, [simple, page]);
  const [pair, setPair] = useState<string | null>(saved?.pair ?? null);
  const [pool, setPool] = useState<string | null>(saved?.pool ?? null);
  const [buy, setBuy] = useState<Target>(saved?.page === 'h-protect' && saved.pair ? { pair: saved.pair } : {});
  const [ratesAt, setRatesAt] = useState<Target>({});
  useEffect(() => { writeView({ page, pair, pool }); }, [page, pair, pool]);
  const [pairAt, setPairAt] = useState<Target>(saved?.page === 'pair' && saved.pair ? { pair: saved.pair } : {});
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
    const sec = sectionOf(p);
    try { if (sec) localStorage.setItem(SECTION_KEY, sec); } catch { /* per-viewer convenience */ }
    window.scrollTo(0, 0);
  };
  const perpMarkets = useQuery({ queryKey: ['perps-markets'], queryFn: () => api<{ markets: { id: number; pair: string; base: string; quote: string; maxLeverage: number; mark: number; decimals: number }[] }>('/api/perps/markets'), refetchInterval: 15_000, retry: false });
  const switchSection = (next: Section) => {
    if (next === 'home') go('dash');
    else if (next === 'trade') go('perps');
    else if (next === 'otc') go('otc');
    // Hedge always opens Buy cover; Underwrite is its own item in the Hedge menu.
    else go('h-protect');
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
          {page === 'dash'
            ? <span className="bx-show-sm bx-msections"><SectionTabs section={section} onChange={switchSection} compact /></span>
            : <span className="bx-show-sm bx-msections"><button className="bx-mhome" onClick={() => go('dash')}><ChevronLeft size={16} />Home</button><b className="bx-mtitle">{PAGE_TITLE[page] ?? SECTION_NAME[section]}</b></span>}
          <button className="bx-tbrand bx-homebtn bx-hide-sm" onClick={() => go('dash')} aria-label="Home"><img src={logoPath} alt="" />BlockFinaX{demo && <span className="bx-env">Testnet</span>}</button>
          {page === 'dash' ? (
          <nav className="bx-nmbar bx-hide-sm" aria-label="Main">
              <NavMenu label="Hedge" active={section === 'hedge'} onOpen={() => switchSection('hedge')} items={[
                { label: 'Buy cover', onClick: () => go('h-protect') },
                ...(simple ? [] : [{ label: 'Underwrite', onClick: () => go('u-home') }]),
              ]} />
              <NavMenu label="Trade" active={section === 'trade'} onOpen={() => switchSection('trade')} items={[
                { heading: 'Perpetual futures' },
                ...(perpMarkets.data?.markets ?? []).map((m) => ({ label: `${m.base}${m.quote}-PERP`, sub: `${m.mark.toLocaleString(undefined, { maximumFractionDigits: m.decimals })} · up to ${m.maxLeverage}x`, onClick: () => openPerpMarket(go, m.id) })),
              ]} />
              <button className={`bx-nm-btn${section === 'otc' ? ' on' : ''}`} onClick={() => switchSection('otc')}>OTC</button>
            </nav>
          ) : (
            <div className="bx-crumb bx-hide-sm">
              <button className="bx-crumb-home" onClick={() => go('dash')}><ChevronLeft size={16} />Home</button>
              <span className="bx-crumb-sep">/</span>
              <span className="bx-crumb-cur">{PAGE_TITLE[page] ?? SECTION_NAME[section]}</span>

            </div>
          )}
          <span className="bx-hide-sm bx-searchwrap"><SearchBox role={role} go={go} /></span>
          <span style={{ flex: 1 }} />
          <div className="bx-top-r">
            <button className={`bx-balance-pill bx-hide-sm${page === 'wallet' ? ' on' : ''}`} data-tour="balance" onClick={() => go('wallet')}>Wallet · <span className="num">${fmt(balances.data?.total)} USDC</span></button>
            {section === 'hedge' && <span className="bx-hide-sm"><ViewSwitch mode={viewMode} onChange={setViewMode} /></span>}
            {viewOnly ? null : <button className="bx-btn bx-hide-sm" onClick={() => go('wallet', { wallet: 'deposit' })}>Deposit</button>}
            <button className="bx-ask-top bx-show-sm" aria-label="Ask Finax" data-tour="ask" onClick={() => window.dispatchEvent(new Event('bfx:ask-open'))}><MessageCircle /></button>
            <span className="bx-top-account bx-hide-sm"><AccountMenu go={go} page={page} theme={theme} onTheme={chooseTheme} placement="top" /></span>
            <button className={`bx-avatar bx-mavatar bx-show-sm${page === 'account' ? ' on' : ''}`} aria-label="Profile" onClick={() => go('account')}>{initialsOf(session?.user.name ?? session?.user.email ?? '')}</button>
          </div>
        </header>
        {section === 'hedge' && !simple && (
          <div className="bx-rolebar">
            <div className="bx-roles bx-mroles" role="group" aria-label="Side">
              <button className={role === 'hedger' ? 'on' : ''} aria-pressed={role === 'hedger'} onClick={() => switchRole('hedger')}>Hedger</button>
              <button className={role === 'underwriter' ? 'on' : ''} aria-pressed={role === 'underwriter'} onClick={() => switchRole('underwriter')}>Underwriter</button>
            </div>
          </div>
        )}

        {page === 'h-home' && <HedgerHome go={go} />}
        {page === 'h-protect' && <ProtectPage go={go} pair={buy.pair ?? pair} target={buy} />}
        {page === 'h-protections' && <MyProtections go={go} />}
        {page === 'h-rates' && <RatesPage go={go} target={ratesAt} />}
        {page === 'wallet' && <WalletPage mode={walletMode} />}
        {page === 'otc' && <OtcSwap /> /* the merchant marketplace (OtcPage) opens at launch */}
        {page === 'perps' && <PerpsPage />}
        {page === 'dash' && <Dashboard go={go} />}
        {page === 'pair' && pairAt.pair && <PairPage key={pairAt.position ?? pairAt.pair} go={go} pair={pairAt.pair} role={role} focus={pairAt.position} />}
        {page === 'account' && <AccountPage go={go} />}
        {page === 'org-settings' && <OrganisationSettingsPage go={go} />}
        {(page === 'u-home' || page === 'u-pool' || page === 'u-risk' || page === 'u-withdraw') && <UnderwriteDesk go={go} poolRef={pool} />}
        {page === 'u-pools' && <UnderwriteDesk go={go} poolRef={pool} tab="all" />}
        {page === 'u-requests' && <UnderwriterRequests />}
        {page === 'u-create' && <CreatePool go={go} />}
        <StatusBar />
      </div>

      <AgentChat />
      <ProductTour role={role} userId={session?.user.id} />

      <nav className="bx-tabs" aria-label="Main" hidden={section !== 'hedge'}>
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

/** Up to two initials for the profile button. */
function initialsOf(name: string) {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
