/**
 * The BlockFinaX workspace: one sidebar, two experiences.
 *   Hedger: "What do you want to protect?"
 *   Underwriter: "How do you want your capital exposed?"
 * The blockchain stays out of sight; networks appear only when moving money in or out.
 */
import { useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import {
  ArrowDownToLine, ArrowUpFromLine, CircleUser, Gauge, Home, LayoutDashboard, Layers, PlusCircle, Shield, ShieldPlus,
  SlidersHorizontal, Wallet,
} from 'lucide-react';
import logoPath from '@/assets/logo.png';
import { usePasskeySession } from '@/lib/identity';
import { fmt, useUsdcBalances } from './shared';
import { HedgerDashboard, MyProtections, ProtectFlow } from './hedger-pages';
import { CreatePoolWizard, MyPools, RiskExposure, TenorPricing, UnderwriterDashboard, UnderwriterWithdraw } from './underwriter-pages';
import { AccountPage, AddFunds, SendFunds } from './money-pages';
import './workspace.css';

export type Role = 'hedger' | 'underwriter';
export type Page =
  | 'h-dashboard' | 'h-protect' | 'h-protections' | 'funds' | 'send' | 'account'
  | 'u-dashboard' | 'u-pools' | 'u-create' | 'u-tenors' | 'u-risk' | 'u-withdraw';

const NAV: Record<Role, { page: Page; label: string; icon: ReactNode }[]> = {
  hedger: [
    { page: 'h-dashboard', label: 'Dashboard', icon: <LayoutDashboard /> },
    { page: 'h-protect', label: 'Protect', icon: <ShieldPlus /> },
    { page: 'h-protections', label: 'My Protections', icon: <Shield /> },
    { page: 'funds', label: 'Add Funds', icon: <ArrowDownToLine /> },
    { page: 'send', label: 'Withdraw', icon: <ArrowUpFromLine /> },
  ],
  underwriter: [
    { page: 'u-dashboard', label: 'Dashboard', icon: <LayoutDashboard /> },
    { page: 'u-pools', label: 'My Pools', icon: <Layers /> },
    { page: 'u-create', label: 'Create Pool', icon: <PlusCircle /> },
    { page: 'u-tenors', label: 'Tenor Pricing', icon: <SlidersHorizontal /> },
    { page: 'u-risk', label: 'Risk & Exposure', icon: <Gauge /> },
    { page: 'u-withdraw', label: 'Withdraw', icon: <ArrowUpFromLine /> },
  ],
};

const HEAD: Record<Page, [string, string]> = {
  'h-dashboard': ['Dashboard', 'Your currency risk protection at a glance.'],
  'h-protect': ['Create Protection', 'Protect a payment or receivable against a currency move.'],
  'h-protections': ['My Protections', 'Every protection you have bought.'],
  funds: ['Add Funds', 'Receive USDC into your BlockFinaX account.'],
  send: ['Withdraw', 'Send USDC to another account.'],
  account: ['Account', 'Your sign-in and wallet details.'],
  'u-dashboard': ['Dashboard', 'Your underwriting activity and capital usage.'],
  'u-pools': ['My Pools', 'Pools you underwrite, and pools open to new capital.'],
  'u-create': ['Create Pool', 'Provide liquidity and set your underwriting terms.'],
  'u-tenors': ['Tenor Configuration', 'Set your pricing for each tenor.'],
  'u-risk': ['Risk & Exposure', 'Where your capital is working, and when it comes back.'],
  'u-withdraw': ['Withdraw Capital', 'Give notice and collect capital from your pools.'],
};

function readRole(): Role {
  try { return localStorage.getItem('bfx:cover-role') === 'underwriter' ? 'underwriter' : 'hedger'; } catch { return 'hedger'; }
}

export function Workspace() {
  const [role, setRole] = useState<Role>(readRole);
  const [page, setPage] = useState<Page>(role === 'hedger' ? 'h-dashboard' : 'u-dashboard');
  const [focusPool, setFocusPool] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { session } = usePasskeySession();
  const balances = useUsdcBalances();

  const switchRole = (r: Role) => {
    setRole(r);
    setPage(r === 'hedger' ? 'h-dashboard' : 'u-dashboard');
    try { localStorage.setItem('bfx:cover-role', r); } catch { /* convenience only */ }
  };
  const go = (p: Page, poolRef?: string) => { setPage(p); if (poolRef !== undefined) setFocusPool(poolRef); window.scrollTo(0, 0); };
  const initials = (session?.user.name || session?.user.email || 'BX').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  const [title, subtitle] = HEAD[page];

  return (
    <div className={`bx${role === 'underwriter' ? ' uw' : ''}`}>
      <aside className="bx-side">
        <div className="bx-logo"><img src={logoPath} alt="" />BlockFinaX</div>
        <div className="bx-role">
          <button className={role === 'hedger' ? 'on' : ''} onClick={() => switchRole('hedger')}>Hedger</button>
          <button className={role === 'underwriter' ? 'on' : ''} onClick={() => switchRole('underwriter')}>Underwriter</button>
        </div>
        <div className="bx-navs">
          {NAV[role].map((n) => (
            <button key={n.page} className={`bx-nav${page === n.page ? ' on' : ''}`} onClick={() => go(n.page)}>{n.icon}{n.label}</button>
          ))}
        </div>
        <div className="bx-side-foot">
          <div className="bx-testnet">Testnet · test USDC only</div>
          <button className={`bx-nav${page === 'account' ? ' on' : ''}`} onClick={() => go('account')}><CircleUser />Account</button>
          <button className="bx-nav" onClick={() => setLocation('/home')}><Home />Back to wallet</button>
        </div>
      </aside>

      <main className="bx-main">
        <div className="bx-head">
          <div><h1>{title}</h1><p>{subtitle}</p></div>
          <div className="bx-head-r">
            <span className="bx-pill"><span className="bx-coin">$</span>{fmt(balances.data?.total)} USDC<Wallet style={{ width: 15, color: 'var(--bx-muted)' }} /></span>
            <button className="bx-avatar" style={{ border: 0, cursor: 'pointer' }} onClick={() => go('account')}>{initials}</button>
          </div>
        </div>

        {page === 'h-dashboard' && <HedgerDashboard go={go} />}
        {page === 'h-protect' && <ProtectFlow go={go} />}
        {page === 'h-protections' && <MyProtections go={go} />}
        {page === 'funds' && <AddFunds />}
        {page === 'send' && <SendFunds />}
        {page === 'account' && <AccountPage />}
        {page === 'u-dashboard' && <UnderwriterDashboard go={go} />}
        {page === 'u-pools' && <MyPools go={go} />}
        {page === 'u-create' && <CreatePoolWizard go={go} />}
        {page === 'u-tenors' && <TenorPricing focus={focusPool} />}
        {page === 'u-risk' && <RiskExposure focus={focusPool} />}
        {page === 'u-withdraw' && <UnderwriterWithdraw focus={focusPool} />}
      </main>
    </div>
  );
}

export type Go = (p: Page, poolRef?: string) => void;
