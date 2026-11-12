/**
 * The account switcher: who you are acting as, and everything about you, in one menu.
 *
 * In the sidebar it is a card ("Acme Imports · Admin"); in the top bar it is the avatar.
 * The menu holds your email, light or dark, the account you act as (with every business
 * you belong to), Business settings, Profile settings, help and sign out.
 */
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Building2, Check, ChevronRight, Compass, FileText, GraduationCap, LogOut, Moon, Plus, Sun, UserRound } from 'lucide-react';
import { useLocation } from 'wouter';
import { usePasskeySession } from '@/lib/identity';
import { signOutPasskey } from '@/lib/wallets/passkey-wallet';
import { setActingOrganisation } from '@/lib/acting-organisation';
import { useActingOrganisation } from '@/lib/use-acting-organisation';
import { NetworkSwitch } from './demo';
import { actAs, listOrganisations, organisationsConfig, type OrganisationSummary } from '@/lib/organisations';
import { startTour } from './tour';
import type { Go, Page } from './workspace';

const ROLE_LABEL = { admin: 'Admin', operator: 'Operator', viewer: 'Viewer' } as const;
/** Opening "Create business account" from the menu lands on the form, already open. */
export const CREATE_BUSINESS_FLAG = 'bfx:create-business';

function initials(text: string | null | undefined) {
  return (text || 'BX').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export function AccountMenu({ go, page, theme, onTheme, placement }: {
  go: Go;
  page: Page;
  theme: 'light' | 'dark';
  onTheme: (t: 'light' | 'dark') => void;
  /** "rail": a card in the sidebar, opening upwards. "top": the avatar in the top bar, opening downwards. */
  placement: 'rail' | 'top';
}) {
  const { session, setSession } = usePasskeySession();
  const acting = useActingOrganisation();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [orgs, setOrgs] = useState<OrganisationSummary[]>([]);
  const [offered, setOffered] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => { organisationsConfig().then((c) => setOffered(c.available)).catch(() => setOffered(false)); }, []);
  useEffect(() => { if (open && offered) listOrganisations().then(setOrgs).catch(() => setOrgs([])); }, [open, offered]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setAccountsOpen(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setAccountsOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const personalName = session?.user.name || session?.user.email || 'My account';
  const name = acting ? acting.name : personalName;
  const sub = acting ? `Business · ${ROLE_LABEL[acting.role]}` : 'Personal account';
  const close = () => { setOpen(false); setAccountsOpen(false); };
  const choose = (o: OrganisationSummary | null) => {
    actAs(o);
    close();
  };
  const usable = orgs.filter((o) => o.status === 'active' && o.myStatus === 'active');

  const avatar = (biz: boolean, text: string) => <span className={`bx-acct-av${biz ? ' biz' : ''}`} aria-hidden="true">{biz ? text.trim()[0]?.toUpperCase() ?? 'B' : initials(text)}</span>;

  const accounts = (
    <div className={`bx-menu bx-menu-sub${placement === 'top' ? ' inline' : ''}`} role="menu" aria-label="Accounts">
      <div className="bx-menu-head">Accounts</div>
      <button className="bx-menu-item" role="menuitemradio" aria-checked={!acting} onClick={() => choose(null)}>
        {avatar(false, personalName)}<span className="grow">Personal</span>{!acting && <Check />}
      </button>
      {usable.map((o) => (
        <button key={o.id} className="bx-menu-item" role="menuitemradio" aria-checked={acting?.id === o.id} onClick={() => choose(o)}>
          {avatar(true, o.name)}<span className="grow"><span className="bx-acct-name">{o.name}</span><span className="bx-acct-sub">{ROLE_LABEL[o.myRole]}</span></span>
          {acting?.id === o.id && <Check />}
        </button>
      ))}
      {offered && (
        <>
          <div className="bx-menu-sep" />
          <button className="bx-menu-item" onClick={() => { try { sessionStorage.setItem(CREATE_BUSINESS_FLAG, '1'); } catch { /* the form opens closed instead */ } close(); go('account'); }}>
            <Plus /><span className="grow">Create business account</span>
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="bx-acct-wrap" ref={box}>
      {placement === 'rail' ? (
        <button className={`bx-acct${open ? ' on' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
          {avatar(Boolean(acting), name)}
          <span className="bx-acct-txt"><span className="bx-acct-name">{name}</span><span className="bx-acct-sub">{sub}</span></span>
        </button>
      ) : (
        <button className={`bx-avatar${acting ? ' biz' : ''}`} aria-label={`${name}, ${sub}. Open account menu`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {acting ? acting.name.trim()[0]?.toUpperCase() : initials(personalName)}
        </button>
      )}

      {open && (
        <div className={`bx-menu ${placement}`} role="menu" aria-label="Account">
          <div className="bx-menu-email">{session?.user.email}</div>
          <div className="bx-menu-theme" role="group" aria-label="Appearance">
            <button className={theme === 'light' ? 'on' : ''} aria-label="Light" aria-pressed={theme === 'light'} onClick={() => onTheme('light')}><Sun /></button>
            <button className={theme === 'dark' ? 'on' : ''} aria-label="Dark" aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')}><Moon /></button>
          </div>
          {/* The network switch lives here at the top; the side menu kept it at its foot. */}
          {placement === 'top' && <div className="bx-menu-net"><NetworkSwitch /></div>}
          <div className="bx-menu-sep" />

          <div className="bx-menu-anchor">
            <button className={`bx-menu-item${accountsOpen ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={accountsOpen} onClick={() => setAccountsOpen((v) => !v)}>
              {avatar(Boolean(acting), name)}
              <span className="grow"><span className="bx-acct-name">{name}</span><span className="bx-acct-sub">{acting ? 'Business account' : 'Personal account'}</span></span>
              <ChevronRight className={accountsOpen && placement === 'top' ? 'bx-rot' : ''} />
            </button>
            {accountsOpen && accounts}
          </div>

          <div className="bx-menu-sep" />
          {acting && (
            <button className={`bx-menu-item${page === 'org-settings' ? ' on' : ''}`} onClick={() => { close(); go('org-settings'); }}>
              <Building2 /><span className="grow">Business settings</span>
            </button>
          )}
          <button className={`bx-menu-item${page === 'account' ? ' on' : ''}`} onClick={() => { close(); go('account'); }}>
            <UserRound /><span className="grow">Profile settings</span>
          </button>

          <div className="bx-menu-sep" />
          <button className="bx-menu-item" onClick={() => { close(); startTour(); }}><Compass /><span className="grow">Product tour</span></button>
          <button className="bx-menu-item" onClick={() => { close(); setLocation('/learn'); }}><GraduationCap /><span className="grow">Academy</span></button>
          <a className="bx-menu-item" href="https://docs.blockfinax.com" target="_blank" rel="noreferrer" onClick={close}><BookOpen /><span className="grow">Docs</span></a>
          <a className="bx-menu-item" href="/terms" onClick={close}><FileText /><span className="grow">Terms and policies</span></a>

          <div className="bx-menu-sep" />
          <button className="bx-menu-item" onClick={async () => {
            close();
            setActingOrganisation(null);
            await signOutPasskey();
            setSession(null);
            setLocation('/auth');
          }}><LogOut /><span className="grow">Log out</span></button>
        </div>
      )}
    </div>
  );
}
