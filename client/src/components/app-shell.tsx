/**
 * AppShell — chrome around every signed-in page, rebuilt to the new design.
 *
 *   - Sidebar (desktop ≥761px): brand + Home / Cover / Earn
 *   - Appbar (sticky): greeting, account pill, live market search (⌘K),
 *     theme toggle, notifications
 *   - Mobile tab bar: same three routes
 *
 * Theme is local to the shell, persisted to localStorage, and applied as a
 * `data-theme` attribute on the `.bfx-app` wrapper so the scoped design CSS
 * flips without touching the Tailwind/shadcn styling on public pages.
 *
 * The market search is wired to live FX rates (`/api/fx/rates`) and deep-links
 * the Cover page with the chosen pair, mirroring the design's search flow.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useRift } from '@rift-finance/react';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Shield, TrendingUp, Search, Bell, Moon, Sun } from 'lucide-react';
import logoPath from '@/assets/logo.png';
import { FlagSvg, CommoditySvg, KNOWN_FLAGS } from '@/components/app-glyphs';
import { useOpenMarkets } from '@/hooks/use-open-markets';
import '@/styles/app-ui.css';
import '@/styles/app-extra.css';

type Theme = 'dark' | 'light';
const THEME_KEY = 'bfx-theme';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function abbreviate(addr?: string | null): string {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function firstNameFromUser(user: any): string {
  const raw = (user?.email || user?.user || '').split('@')[0] || 'there';
  const head = raw.split(/[._-]/)[0] || raw;
  return head.charAt(0).toUpperCase() + head.slice(1);
}

function partOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Good night';
}

// Names for the local-currency leg of a pair, used in the search dropdown.
const CURRENCY_NAMES: Record<string, string> = {
  NGN: 'Nigerian naira', GHS: 'Ghanaian cedi', KES: 'Kenyan shilling',
  ZAR: 'South African rand', EGP: 'Egyptian pound', XOF: 'West African CFA',
  UGX: 'Ugandan shilling', TZS: 'Tanzanian shilling', XAF: 'Central African CFA',
  EUR: 'Euro', GBP: 'British pound', USD: 'US dollar',
};

type FXRate = { pair: string; rate: number };
type FXResponse = {
  rates: Record<string, FXRate>;
  pairs?: string[];
  pairsWithClass?: Array<{ pair: string; assetClass: string }>;
};

type Market = { id?: number; pair: string; name: string; code: string; cls: 'fx' | 'cmd'; prem: number };

interface AppShellProps {
  active: 'home' | 'cover' | 'earn';
  greeting?: { title: string; subtitle?: string };
  children: React.ReactNode;
}

export function AppShell({ active, greeting, children }: AppShellProps) {
  const [, setLocation] = useLocation();
  const { user } = useRift();
  const [theme, setTheme] = useState<Theme>('dark');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTheme(readTheme()); }, []);

  const flipTheme = () => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        inputRef.current?.focus();
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Search surfaces live OPEN cover pools (loaded lazily once the field is used).
  const markets = useOpenMarkets(searchOpen || search.length > 0);

  const results = useMemo<Market[]>(() => {
    const mapped: Market[] = markets.map((m) => {
      const [base, quote] = m.underlying.split('/');
      const isCmd = ['XAU', 'XAG', 'XPT', 'XPD', 'XTI', 'XBR', 'XNG', 'XCO', 'XCF', 'XWH', 'XSG', 'BRENT', 'WTI', 'COCOA'].includes(base);
      const code = quote === 'USD' ? base : quote;
      return {
        id: m.id,
        pair: m.underlying.replace('/', ' / '),
        name: `${m.name} · ${m.strikeAbove ? 'rises past' : 'falls below'} ${m.strike.toLocaleString()}`,
        code, cls: isCmd ? 'cmd' : 'fx', prem: m.premiumRate * 100,
      };
    });
    const q = search.trim().toLowerCase();
    if (!q) return mapped.slice(0, 8);
    const qn = q.replace(/[\s/]/g, '');
    return mapped
      .filter((m) => {
        const hay = `${m.pair} ${m.name} ${m.code}`.toLowerCase();
        return hay.includes(q) || hay.replace(/[\s/]/g, '').includes(qn);
      })
      .slice(0, 8);
  }, [markets, search]);

  const go = (m?: Market) => {
    setSearch('');
    setSearchOpen(false);
    setActiveIdx(-1);
    // Deep-link to the specific pool; the Cover page opens its details sheet.
    setLocation(m?.id != null ? `/hedge?event=${m.id}` : '/hedge');
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searchOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { if (results.length) go(results[activeIdx < 0 ? 0 : activeIdx]); }
    else if (e.key === 'Escape') { setSearchOpen(false); inputRef.current?.blur(); }
  };

  const title = greeting?.title || `${partOfDayGreeting()}, ${firstNameFromUser(user)}`;
  const subtitle = greeting?.subtitle || "Here's your portfolio today";

  const navItem = (
    key: AppShellProps['active'],
    to: string,
    label: string,
    Icon: React.ComponentType<any>,
  ) => (
    <Link href={to} className={`sb-link${active === key ? ' on' : ''}`}>
      <Icon /> {label}
    </Link>
  );

  return (
    <div className="bfx-app" data-theme={theme}>
      <div className="shell">
        {/* ===== SIDEBAR ===== */}
        <aside className="sidebar">
          <Link href="/home" className="sb-logo">
            <img src={logoPath} alt="BlockFinaX" />
            <span className="wm">BlockFinaX</span>
          </Link>
          <nav className="sb-nav">
            {navItem('home', '/home', 'Home', LayoutDashboard)}
            {navItem('cover', '/hedge', 'Cover', Shield)}
            {navItem('earn', '/tasks', 'Earn', TrendingUp)}
          </nav>
        </aside>

        {/* ===== MAIN ===== */}
        <main className="main">
          <header className="appbar">
            <div className="greeting">
              <div className="g1">{title}</div>
              <div className="g2">{subtitle}</div>
            </div>

            {user?.address && (
              <div className="ab-acct" title={user.address}>
                <span className="ava" />
                <span className="meta">
                  <span className="n">{firstNameFromUser(user)}</span>
                  <span className="a">{abbreviate(user.address)}</span>
                </span>
              </div>
            )}

            <div className="ab-r">
              <div className={`hsearch${searchOpen ? ' open' : ''}`}>
                <Search />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search markets"
                  autoComplete="off"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); setActiveIdx(-1); }}
                  onFocus={() => setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 140)}
                  onKeyDown={onSearchKey}
                />
                <kbd>⌘K</kbd>
                <div className="hsearch-dd">
                  {results.length === 0 ? (
                    <div className="hs-empty">{search.trim() ? 'No open pools match' : 'No open pools right now'}</div>
                  ) : (
                    results.map((m, i) => (
                      <div
                        key={m.id ?? m.pair}
                        className={`hs-row${i === activeIdx ? ' active' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); go(m); }}
                      >
                        <span className={`hs-fl${m.cls === 'cmd' ? ' cmd' : ''}`}>
                          {m.cls === 'cmd'
                            ? <CommoditySvg ic={m.code.toLowerCase()} />
                            : <FlagSvg code={m.code} />}
                        </span>
                        <div className="hs-m">
                          <div className="a">{m.pair}</div>
                          <div className="b">{m.name}</div>
                        </div>
                        <div className="hs-r">
                          {m.prem.toFixed(1)}%
                          <span className="u">premium</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <button type="button" className="iconbtn" aria-label="Toggle theme" onClick={flipTheme}>
                <span className="ic-moon"><Moon /></span>
                <span className="ic-sun"><Sun /></span>
              </button>
              <button type="button" className="iconbtn" aria-label="Notifications">
                <span className="bdot" />
                <Bell />
              </button>
            </div>
          </header>

          <div className="content">{children}</div>
        </main>
      </div>

      {/* ===== BOTTOM TAB BAR (mobile) ===== */}
      <nav className="tabbar">
        <Link href="/home" className={`tab${active === 'home' ? ' on' : ''}`}>
          <LayoutDashboard /><span className="tl">Home</span>
        </Link>
        <Link href="/hedge" className={`tab${active === 'cover' ? ' on' : ''}`}>
          <Shield /><span className="tl">Cover</span>
        </Link>
        <Link href="/tasks" className={`tab${active === 'earn' ? ' on' : ''}`}>
          <TrendingUp /><span className="tl">Earn</span>
        </Link>
      </nav>
    </div>
  );
}
