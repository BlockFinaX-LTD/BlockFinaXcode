/**
 * Connector portal (connector.blockfinax.com, also at /connector on the app).
 *
 * Connectors and independent contractors apply, accept the programme terms, complete the
 * training, register prospects, share a referral link, follow their referrals, see their
 * rewards and, for contractors, accept engagements. BlockFinaX manages all of it from the
 * admin dashboard (Connectors). Server: server/connectors.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote, BookOpen, Briefcase, Megaphone, Check, CheckCircle2, Circle, Copy, FileSignature, FolderOpen, GraduationCap, Home, LogOut, Moon,
  Sparkles, Sun, UserPlus, UserRound, Building2,
} from 'lucide-react';
import {
  AGREEMENTS, AREAS, COMPANY, LEDGER_LABELS, MATERIALS, MODULES, PASS_MARK, areaByKey,
  type AgreementDoc, type AreaKey, type LedgerKind, type MemberKind, type Module,
} from '@shared/connector-programme';
import { COUNTRIES, PRIORITY_COUNTRIES } from '@shared/onboarding';
import { api } from '@/lib/wallets/passkey-wallet';
import { rememberReturnPath, useIdentity } from '@/lib/identity';
import { Loading, Note, Spin, Tag } from '@/components/v2/ui';
import { FinaxChat } from '@/components/finax-chat';
import { CONNECTORS_INFO_HREF } from '@/lib/app-links';
import logoPath from '@/assets/logo.png';
import '@/components/v2/workspace.css';
import './connector.css';

/** True when the app is served on the connector subdomain, where the portal is the whole site. */
export const isConnectorHost = typeof window !== 'undefined' && /^connector\./i.test(window.location.hostname);
const BASE = isConnectorHost ? '' : '/connector';
const IS_TESTNET = (import.meta.env.VITE_NETWORK_MODE ?? 'testnet') !== 'mainnet';

// ── Types from the API ────────────────────────────────────────────────────

interface Me {
  prefill?: null | { fullName: string; country: string; phone: string; organisation: string };
  member: null | {
    kind: MemberKind; fullName: string; organisation: string | null; country: string; email: string; phone: string | null;
    markets: string | null; areas: AreaKey[]; about: string | null; status: 'applied' | 'active' | 'paused' | 'ended' | 'declined';
    payoutDetails: string | null; joinedAt: string;
  };
  signing: { open: boolean; binding: boolean };
  agreement: { kind: 'connector' | 'contractor'; version: string; hash: string;
    signed: null | { typedName: string; signedAt: string; binding: boolean; countersignedAt: string | null } };
  lessons: { id: string; passed: boolean; score: number | null; attempts: number }[];
  missing: string[];
  ready: boolean;
  referral: null | { code: string; link: string };
  counts: null | { registrations: number; approved: number; qualifying: number; referrals: number; offers: number; new_offers: number };
}

interface Registration {
  id: string; area: AreaKey; organisation: string; website: string | null; contactName: string; contactRole: string | null;
  contactEmail: string | null; country: string; need: string; status: 'pending' | 'approved' | 'declined' | 'live' | 'closed';
  rewardTerms: string | null; bonusUsd: number | null; periodStart: string | null; periodEnd: string | null;
  decisionNote: string | null; createdAt: string;
}

interface Referral { id: number; name: string | null; email: string | null; joinedAt: string; onboarded: boolean; contracts: number; estimatedShare: number; periodEnd: string | null }

interface Rewards {
  lines: { id: number; kind: LedgerKind; quarter: string; amountUsd: number; note: string | null; reference: string | null; organisation: string | null; createdAt: string }[];
  statement: { quarters: { quarter: string; earned: number; paid: number }[]; earned: number; paid: number; owed: number };
  currentQuarter: string;
  estimatedFromReferrals: number;
  payoutDetails: string | null;
}

interface Engagement { id: string; title: string; scope: string; feeTerms: string; startsOn: string | null; endsOn: string | null; status: string; acceptedName: string | null; acceptedAt: string | null; createdAt: string }

// ── Helpers ───────────────────────────────────────────────────────────────

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const errMsg = (e: unknown) => (e as Error)?.message || 'Something went wrong. Try again.';

function useCountries() {
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* older browsers show codes */ }
    const label = (c: string) => names?.of(c) ?? c;
    const first = PRIORITY_COUNTRIES.map((c) => ({ code: c as string, name: label(c) }));
    const rest = COUNTRIES.slice(PRIORITY_COUNTRIES.length).map((c) => ({ code: c as string, name: label(c) })).sort((a, b) => a.name.localeCompare(b.name));
    return { first, rest, label };
  }, []);
}

function CountrySelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { first, rest } = useCountries();
  return (
    <select id={id} className="bx-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a country</option>
      {first.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      <option disabled>──────────</option>
      {rest.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
    </select>
  );
}

function Field({ label, htmlFor, children, wide }: { label: string; htmlFor: string; children: ReactNode; wide?: boolean }) {
  return <label className={`bx-field${wide ? ' wide' : ''}`} htmlFor={htmlFor}><span>{label}</span>{children}</label>;
}

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bx-cp-copy">
      <code>{value}</code>
      <button type="button" className="bx-btn ghost small" onClick={() => {
        navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
      }}><Copy /> {copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

const THEME_KEY = 'bfx-theme';
function useTheme(): ['light' | 'dark', () => void] {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => { try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  return [theme, () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* per-viewer convenience */ }
  }];
}

// ── Portal ────────────────────────────────────────────────────────────────

type Tab = 'home' | 'prospects' | 'engagements' | 'offers' | 'referrals' | 'training' | 'materials' | 'rewards' | 'profile' | 'agreement';

/** Paths in the address bar. Older paths still open the right page. */
const PATHS: Record<string, Tab> = {
  '': 'home', overview: 'home', prospects: 'prospects', engagements: 'engagements', offers: 'offers', referrals: 'referrals',
  learn: 'training', training: 'training', materials: 'materials', earnings: 'rewards', rewards: 'rewards', profile: 'profile', agreement: 'agreement',
};
const PATH_OF: Record<Tab, string> = {
  home: '', prospects: 'prospects', engagements: 'engagements', offers: 'offers', referrals: 'referrals',
  training: 'learn', materials: 'materials', rewards: 'earnings', profile: 'profile', agreement: 'agreement',
};

type Section = 'home' | 'offers' | 'referrals' | 'learn' | 'earnings' | 'profile';
const RAIL: { key: Section; label: string; icon: typeof Home; to: Tab }[] = [
  { key: 'home', label: 'Home', icon: Home, to: 'home' },
  { key: 'offers', label: 'Offers', icon: Megaphone, to: 'offers' },
  { key: 'referrals', label: 'Referrals', icon: UserPlus, to: 'referrals' },
  { key: 'learn', label: 'Learn', icon: GraduationCap, to: 'training' },
  { key: 'earnings', label: 'Earnings', icon: Banknote, to: 'rewards' },
  { key: 'profile', label: 'Profile', icon: UserRound, to: 'profile' },
];

/** Which rail item a page belongs to. Accepted terms are opened from Profile; terms still to accept from Home. */
function sectionOf(tab: Tab, me: Me): Section {
  if (tab === 'home' || tab === 'prospects' || tab === 'engagements') return 'home';
  if (tab === 'training' || tab === 'materials') return 'learn';
  if (tab === 'rewards') return 'earnings';
  if (tab === 'agreement') return me.agreement.signed ? 'profile' : 'home';
  return tab;
}

function StatusBadge({ me }: { me: Me }) {
  const s = me.member!.status;
  const [tone, text] =
    s === 'applied' ? ['amber', 'Application under review']
    : s === 'paused' ? ['amber', 'Paused']
    : s === 'ended' || s === 'declined' ? ['grey', 'Not active']
    : me.ready ? ['green', me.member!.kind === 'contractor' ? 'Active contractor' : 'Active connector']
    : ['blue', 'Setup in progress'];
  return <span className={`bx-cp-badge ${tone}`}>{tone === 'green' ? <CheckCircle2 /> : <Circle />}{text}</span>;
}

export default function ConnectorPortal() {
  const identity = useIdentity();
  const [location, setLocation] = useLocation();
  const [theme, flipTheme] = useTheme();
  const [finax, setFinax] = useState(false);
  const signedIn = !!(identity.signedIn ?? identity.isAuthenticated);
  const ready = identity.ready ?? true;

  const me = useQuery<Me>({ queryKey: ['connector-me'], queryFn: () => api<Me>('/api/v2/connectors/me'), enabled: signedIn, staleTime: 30_000 });

  const tab: Tab = PATHS[location.slice(BASE.length).split('/').filter(Boolean)[0] ?? ''] ?? 'home';
  const go = (t: Tab) => { setLocation(`${BASE}/${PATH_OF[t]}`.replace(/\/$/, '') || '/'); window.scrollTo(0, 0); };

  const signIn = () => { rememberReturnPath(window.location.pathname); setLocation('/auth'); };
  // The programme is explained on the website; signed-out visitors go straight to sign in or sign up.
  useEffect(() => { if (ready && !signedIn) signIn(); }, [ready, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready || (signedIn && me.isLoading)) {
    return <div className="bx" data-theme={theme}><div className="bx-onboard"><Spin /></div></div>;
  }
  if (!signedIn) return <div className="bx" data-theme={theme}><div className="bx-onboard"><Spin /></div></div>;
  if (me.error) {
    return <div className="bx" data-theme={theme}><div className="bx-onboard"><div className="bx-onboard-card"><Note warn>{errMsg(me.error)}</Note>
      <button className="bx-btn" style={{ marginTop: 14 }} onClick={signIn}>Sign in again</button></div></div></div>;
  }
  const data = me.data!;
  if (!data.member) return <div className="bx" data-theme={theme}><ApplyPage email={identity.user?.email ?? null} prefill={data.prefill ?? null} /></div>;

  if (data.member.status === 'applied' || data.member.status === 'declined') {
    return <div className="bx" data-theme={theme}><ApplicationStatus me={data} onSignOut={() => void identity.signOut().then(() => setLocation('/auth'))} /></div>;
  }

  const contractor = data.member.kind === 'contractor';
  const section = sectionOf(tab, data);
  const initial = (data.member.fullName.trim()[0] ?? 'B').toUpperCase();
  const badge = (key: Section) =>
    key === 'offers' ? data.counts?.new_offers : key === 'home' && contractor ? data.counts?.offers : 0;
  const safeTab: Tab = tab === 'engagements' && !contractor ? 'home' : tab;

  return (
    <div className="bx bx-cp" data-theme={theme}>
      <aside className="bx-cp-rail" aria-label="Portal">
        <img className="bx-cp-mark" src={logoPath} alt="BlockFinaX" />
        {RAIL.map((n) => (
          <button key={n.key} className={`bx-cp-ri${section === n.key ? ' on' : ''}`} onClick={() => go(n.to)} aria-current={section === n.key ? 'page' : undefined}>
            <n.icon />{n.label}
            {!!badge(n.key) && <span className="bx-cp-count">{badge(n.key)}</span>}
          </button>
        ))}
        <button className={`bx-cp-ri${finax ? ' on' : ''}`} onClick={() => setFinax(!finax)}><Sparkles />Finax</button>
        <div className="bx-cp-rail-foot">
          {IS_TESTNET && <div className="bx-cp-testnet">TESTNET</div>}
          <button className="bx-cp-ri small" onClick={flipTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
          <button className="bx-cp-ri small" onClick={() => void identity.signOut().then(() => setLocation(BASE || '/'))} title="Sign out"><LogOut /></button>
          <button className="bx-cp-avatar" onClick={() => go('profile')} title={data.member.fullName}>{initial}</button>
        </div>
      </aside>
      <div className="bx-content">
        <nav className="bx-cp-tabs" aria-label="Portal sections">
          {RAIL.map((n) => <button key={n.key} className={section === n.key ? 'on' : ''} onClick={() => go(n.to)}>{n.label}{!!badge(n.key) && ` (${badge(n.key)})`}</button>)}
          <button className={finax ? 'on' : ''} onClick={() => setFinax(!finax)}>Finax</button>
        </nav>
        <main className="bx-cp-main">
          {section === 'home' && safeTab !== 'agreement' && <HomePage me={data} tab={safeTab} go={go} />}
          {safeTab === 'agreement' && <AgreementTab me={data} />}
          {safeTab === 'offers' && <OffersTab />}
          {section === 'learn' && <LearnPage me={data} tab={safeTab} go={go} />}
          {safeTab === 'referrals' && <ReferralsTab me={data} />}
          {safeTab === 'rewards' && <RewardsTab />}
          {safeTab === 'profile' && <ProfileTab me={data} go={go} />}
        </main>
      </div>
      {!finax && <button className="bx-cp-ask" onClick={() => setFinax(true)}><Sparkles />Ask Finax</button>}
      <FinaxChat scope="connector" launcher="none" open={finax} onOpenChange={setFinax} />
    </div>
  );
}

/** Underlined tabs inside a page, with an optional count. */
function SubTabs({ items, current, go }: { items: { tab: Tab; label: string; count?: number }[]; current: Tab; go: (t: Tab) => void }) {
  return (
    <div className="bx-cp-subtabs" role="tablist">
      {items.map((i) => (
        <button key={i.tab} role="tab" aria-selected={current === i.tab} className={current === i.tab ? 'on' : ''} onClick={() => go(i.tab)}>
          {i.label}{!!i.count && <span className="n">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

function HomePage({ me, tab, go }: { me: Me; tab: Tab; go: (t: Tab) => void }) {
  const m = me.member!;
  const items: { tab: Tab; label: string; count?: number }[] = [
    { tab: 'home', label: me.ready ? 'Overview' : 'Get started' },
    { tab: 'prospects', label: 'Prospects', count: me.counts?.registrations },
  ];
  if (m.kind === 'contractor') items.push({ tab: 'engagements', label: 'Engagements', count: me.counts?.offers });
  return (
    <>
      <div className="bx-cp-welcome">
        <h1>Welcome back, {m.fullName.split(' ')[0]}!</h1>
        <StatusBadge me={me} />
      </div>
      <SubTabs items={items} current={tab} go={go} />
      <div className="bx-cp-embedded">
        {tab === 'home' && <Overview me={me} go={go} />}
        {tab === 'prospects' && <ProspectsTab me={me} go={go} />}
        {tab === 'engagements' && <EngagementsTab me={me} go={go} />}
      </div>
    </>
  );
}

function LearnPage({ me, tab, go }: { me: Me; tab: Tab; go: (t: Tab) => void }) {
  const passed = me.lessons.filter((l) => l.passed).length;
  return (
    <>
      <div>
        <h1 className="bx-cp-h1">Learn</h1>
        <p className="bx-cp-lede">The training you need before introducing anyone, and the only materials to share with prospects.</p>
      </div>
      <SubTabs items={[{ tab: 'training', label: `Training (${passed} of ${MODULES.length})` }, { tab: 'materials', label: 'Materials' }]} current={tab} go={go} />
      <div className="bx-cp-embedded">
        {tab === 'training' && <TrainingTab me={me} />}
        {tab === 'materials' && <MaterialsTab />}
      </div>
    </>
  );
}

// ── Application ───────────────────────────────────────────────────────────

interface ProfileForm { kind: MemberKind; fullName: string; organisation: string; country: string; phone: string; markets: string; areas: AreaKey[]; about: string }

/** The groups offered on the form, in plain words. Other areas still exist for older profiles and the terms. */
const INTRODUCE_OPTIONS: { key: AreaKey; label: string }[] = [
  { key: 'hedgers', label: 'Businesses that need protection' },
  { key: 'underwriters', label: 'Underwriters and funds' },
  { key: 'distribution', label: 'Fintechs and payment apps' },
  { key: 'institutions', label: 'Banks and trade associations' },
  { key: 'local_partners', label: 'Exchanges and payment providers' },
  { key: 'market_data', label: 'Market data providers' },
  { key: 'new_country', label: 'New country launches' },
  { key: 'grants', label: 'Grants and development finance' },
  { key: 'talent', label: 'Talent' },
];
const introduceLabel = (k: AreaKey) => INTRODUCE_OPTIONS.find((o) => o.key === k)?.label ?? areaByKey(k)?.label ?? k;

function ProfileFields({ form, set, lockKind }: { form: ProfileForm; set: (f: ProfileForm) => void; lockKind?: boolean }) {
  const toggleArea = (k: AreaKey) => set({ ...form, areas: form.areas.includes(k) ? form.areas.filter((a) => a !== k) : [...form.areas, k] });
  return (
    <>
      <div className="bx-field">
        <span>How do you want to participate?</span>
        <div className="bx-choice">
          {(['connector', 'contractor'] as MemberKind[]).map((k) => (
            <button key={k} type="button" className={form.kind === k ? 'on' : ''} disabled={lockKind && form.kind !== k} onClick={() => set({ ...form, kind: k })}>
              <div className="t">{k === 'connector' ? 'Introduce and earn' : 'Take paid gigs'}</div>
              <div className="p">{k === 'connector' ? 'Introduce people and organisations, and earn when it leads to results.' : 'Take on paid work such as research, workshops or onboarding support. You can make introductions too.'}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="bx-cp-form">
        <Field label="Full legal name" htmlFor="cp-name"><input id="cp-name" className="bx-input" autoComplete="name" value={form.fullName} onChange={(e) => set({ ...form, fullName: e.target.value })} /></Field>
        <Field label="Organisation, if you represent one" htmlFor="cp-org"><input id="cp-org" className="bx-input" autoComplete="organization" value={form.organisation} onChange={(e) => set({ ...form, organisation: e.target.value })} /></Field>
        <Field label="Country of residence" htmlFor="cp-country"><CountrySelect id="cp-country" value={form.country} onChange={(v) => set({ ...form, country: v })} /></Field>
        <Field label="Phone, optional" htmlFor="cp-phone"><input id="cp-phone" className="bx-input" autoComplete="tel" value={form.phone} onChange={(e) => set({ ...form, phone: e.target.value })} /></Field>
        <Field label="Markets you know best" htmlFor="cp-markets" wide><input id="cp-markets" className="bx-input" placeholder="For example: Nigeria and Ghana, importers and fintechs" value={form.markets} onChange={(e) => set({ ...form, markets: e.target.value })} /></Field>
      </div>
      <div className="bx-field">
        <span>{form.kind === 'contractor' ? 'Who can you introduce? Optional' : 'Who can you introduce?'}</span>
        <div className="bx-cp-areas">
          {INTRODUCE_OPTIONS.map((o) => {
            const on = form.areas.includes(o.key);
            return (
              <label key={o.key} className={on ? 'on' : ''}>
                <input type="checkbox" checked={on} onChange={() => toggleArea(o.key)} />
                {on && <Check aria-hidden="true" />}{o.label}
              </label>
            );
          })}
        </div>
      </div>
      <Field label="Your background, in a few sentences" htmlFor="cp-about" wide>
        <textarea id="cp-about" className="bx-input" rows={4} placeholder={form.kind === 'contractor' ? 'Your experience, the languages you speak and the work you can take on' : 'Your experience and the people you know in these markets'} value={form.about} onChange={(e) => set({ ...form, about: e.target.value })} />
      </Field>
    </>
  );
}

function ApplyPage({ email, prefill }: { email: string | null; prefill: Me['prefill'] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ProfileForm>({
    kind: 'connector', fullName: prefill?.fullName ?? '', organisation: prefill?.organisation ?? '', country: prefill?.country ?? '',
    phone: prefill?.phone ?? '', markets: '', areas: [], about: '',
  });
  const filled = !!(prefill?.fullName || prefill?.country);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await api('/api/v2/connectors/apply', form); await qc.invalidateQueries({ queryKey: ['connector-me'] }); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="bx-onboard">
      <div className="bx-onboard-card" style={{ maxWidth: 760 }}>
        <div className="bx-brand" style={{ padding: '0 0 14px' }}><img src={logoPath} alt="" />BlockFinaX</div>
        <h1 className="bx-cp-h1">Apply to the Connector Programme</h1>
        <p className="bx-cp-lede" style={{ marginBottom: 18 }}>{email ? `You are signed in as ${email}. ` : 'You are signed in. '}One last step: tell us how you want to participate. BlockFinaX reviews every application and emails you when you are accepted; the programme terms and training open then.</p>
        {filled && <Note>We filled in what your BlockFinaX account already has. Check it, then finish the rest.</Note>}
        <ProfileFields form={form} set={setForm} />
        {error && <Note warn>{error}</Note>}
        <button className="bx-btn" style={{ marginTop: 14 }} disabled={busy} onClick={submit}>{busy ? <Spin /> : null}Submit application</button>
      </div>
    </div>
  );
}

/** Between applying and being accepted: what was sent, and what happens next. */
function ApplicationStatus({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const m = me.member!;
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();
  const [form, setForm] = useState<ProfileForm>({ kind: m.kind, fullName: m.fullName, organisation: m.organisation ?? '', country: m.country, phone: m.phone ?? '', markets: m.markets ?? '', areas: m.areas, about: m.about ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { label } = useCountries();
  const declined = m.status === 'declined';
  const save = async () => {
    setBusy(true); setError(null);
    try { await api('/api/v2/connectors/apply', form); await qc.invalidateQueries({ queryKey: ['connector-me'] }); setEditing(false); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="bx-onboard">
      <div className="bx-onboard-card" style={{ maxWidth: 680, display: 'grid', gap: 18 }}>
        <div className="bx-brand" style={{ padding: 0 }}><img src={logoPath} alt="" />BlockFinaX</div>
        <div style={{ display: 'grid', gap: 8 }}>
          <span className={`bx-cp-badge ${declined ? 'grey' : 'amber'}`} style={{ justifySelf: 'start' }}><Circle />{declined ? 'Not accepted' : 'Under review'}</span>
          <h1 className="bx-cp-h1">{declined ? 'Your application was not accepted' : 'Application received'}</h1>
          <p className="bx-cp-lede" style={{ margin: 0 }}>
            {declined
              ? 'Thank you for applying. We are not able to accept your application at this time. You are welcome to apply again later, or contact BlockFinaX to discuss it.'
              : `Thank you, ${m.fullName.split(' ')[0]}. BlockFinaX reviews every application, usually within a few working days. We will email ${m.email} when you are accepted, and your portal opens here.`}
          </p>
        </div>
        {!declined && (
          <ul className="bx-cp-check">
            <li><Check className="done" /><span>Application sent on {day(m.joinedAt)}</span></li>
            <li><Circle className="todo" /><span>BlockFinaX reviews it</span></li>
            <li><Circle className="todo" /><span>Once accepted: agree to the programme terms and complete four short lessons</span></li>
          </ul>
        )}
        {editing ? (
          <section style={{ display: 'grid', gap: 8 }}>
            <ProfileFields form={form} set={setForm} />
            {error && <Note warn>{error}</Note>}
            <div className="bx-cp-row">
              <button className="bx-btn" disabled={busy} onClick={save}>{busy ? <Spin /> : null}{declined ? 'Apply again' : 'Save changes'}</button>
              <button className="bx-btn ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </section>
        ) : (
          <section className="bx-card" style={{ display: 'grid', gap: 6 }}>
            <div className="bx-card-h"><h2>What you sent</h2><button className="bx-link" onClick={() => setEditing(true)}>{declined ? 'Update and apply again' : 'Edit'}</button></div>
            <span><b>{m.fullName}</b>{m.organisation ? `, ${m.organisation}` : ''} · {m.kind === 'contractor' ? 'Independent contractor' : 'Connector'}</span>
            <span className="muted">{label(m.country)}{m.markets ? ` · ${m.markets}` : ''}</span>
            {m.areas.length > 0 && <span className="muted">Who you can introduce: {m.areas.map(introduceLabel).join(', ')}</span>}
          </section>
        )}
        <div className="bx-cp-row" style={{ justifyContent: 'space-between' }}>
          <a className="bx-link" href={CONNECTORS_INFO_HREF}>About the programme</a>
          <button className="bx-link" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────

function Overview({ me, go }: { me: Me; go: (t: Tab) => void }) {
  const m = me.member!;
  const passed = me.lessons.filter((l) => l.passed).length;
  const steps: { done: boolean; label: string; tab?: Tab }[] = [
    { done: m.status !== 'applied', label: m.status === 'applied' ? 'Application under review' : 'Application approved' },
    { done: !!me.agreement.signed, label: `Accept the ${AGREEMENTS[me.agreement.kind].title}`, tab: 'agreement' },
    { done: passed === MODULES.length, label: `Complete the training (${passed} of ${MODULES.length})`, tab: 'training' },
  ];
  return (
    <>
      <p className="bx-cp-lede" style={{ marginTop: 0 }}>{m.kind === 'contractor' ? 'Your engagements, terms and payments in one place.' : 'Your introductions, referrals and rewards in one place.'}</p>
      {m.status === 'paused' && <Note warn>Your access is paused. Rewards already earned are not affected. Contact BlockFinaX to discuss it.</Note>}
      {(m.status === 'ended' || m.status === 'declined') && <Note warn>Your membership is not active.</Note>}
      {!me.ready && (
        <section className="bx-card">
          <div className="bx-card-h"><h2>Get started</h2></div>
          <ul className="bx-cp-check" style={{ marginTop: 12 }}>
            {steps.map((s) => (
              <li key={s.label}>{s.done ? <Check className="done" /> : <Circle className="todo" />}
                {s.tab && !s.done ? <button className="bx-link" onClick={() => go(s.tab!)}>{s.label}</button> : <span>{s.label}</span>}</li>
            ))}
          </ul>
        </section>
      )}
      {!!me.counts?.new_offers && (
        <Note>{me.counts.new_offers === 1 ? 'There is a new offer' : `There are ${me.counts.new_offers} new offers`} from BlockFinaX. <button className="bx-link" onClick={() => go('offers')}>See offers</button></Note>
      )}
      {me.referral && (
        <section className="bx-card">
          <div className="bx-card-h"><h2>Your referral link</h2></div>
          <p className="sub" style={{ marginBottom: 12 }}>People who create a BlockFinaX account through this link are credited to you. They sign up and verify themselves.</p>
          <CopyBox value={me.referral.link} />
        </section>
      )}
      {me.counts && (
        <div className="bx-cp-grid">
          <div className="bx-cp-stat"><b>{me.counts.registrations}</b><span>Prospects registered</span></div>
          <div className="bx-cp-stat"><b>{me.counts.approved}</b><span>Approved introductions</span></div>
          <div className="bx-cp-stat"><b>{me.counts.referrals}</b><span>Referred users</span></div>
          <div className="bx-cp-stat"><b>{me.counts.new_offers}</b><span>New offers</span></div>
        </div>
      )}
    </>
  );
}

// ── Terms ─────────────────────────────────────────────────────────────────

export function AgreementView({ doc }: { doc: AgreementDoc }) {
  return (
    <article className="bx-cp-doc">
      <div className="muted" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>{doc.version} · Issued {doc.issued}</div>
      <h2 className="bx-cp-h1" style={{ fontFamily: 'Geist, system-ui, sans-serif' }}>{doc.title}</h2>
      <div className="bx-cp-parties">
        <div><span className="r">Company</span><b>{COMPANY.name}</b><span>{COMPANY.description[0]!.toUpperCase() + COMPANY.description.slice(1)}, registered office {COMPANY.address}</span></div>
        <div><span className="r">{doc.kind === 'contractor' ? 'Contractor' : 'Connector'}</span><b>The member who accepts these terms</b><span>By ticking the box and clicking Accept in the portalonically</span></div>
      </div>
      <p>{doc.intro}</p>
      {doc.clauses.map((c) => (
        <section key={c.n}>
          <h3><span className="n">{c.n}</span>{c.title}</h3>
          <ol>{c.items.map(([k, t]) => <li key={k}><span className="k">{k}</span><span>{t}</span></li>)}</ol>
        </section>
      ))}
      {doc.schedule && (
        <section>
          <h3>{doc.schedule.title}</h3>
          <div className="bx-cp-scroll">
            <table className="bx-cp-table">
              <thead><tr><th>Area</th><th>What qualifies</th><th>Reward</th></tr></thead>
              <tbody>{doc.schedule.rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </article>
  );
}

function AgreementTab({ me }: { me: Me }) {
  const qc = useQueryClient();
  const doc = AGREEMENTS[me.agreement.kind];
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accepted = me.agreement.signed;
  const accept = async () => {
    setBusy(true); setError(null);
    try { await api('/api/v2/connectors/sign', { agree }); await qc.invalidateQueries({ queryKey: ['connector-me'] }); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <section className="bx-card"><AgreementView doc={doc} /></section>
      <section className="bx-cp-sign" aria-labelledby="sig-h">
        <h2 id="sig-h" style={{ margin: 0, fontSize: 18 }}>{accepted ? 'You accepted these terms' : 'Accept the terms'}</h2>
        {accepted ? (
          <>
            <span className="muted">Accepted by {accepted.typedName} on {new Date(accepted.signedAt).toUTCString()}{accepted.binding ? '' : ' · test acceptance on testnet, not binding'}</span>
            <span className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>Text fingerprint (SHA-256): {me.agreement.hash}</span>
          </>
        ) : !me.signing.open ? (
          <Note>These terms open for acceptance once BlockFinaX has finalised them. You can read them now.</Note>
        ) : (
          <>
            {!me.signing.binding && <Note>This is testnet. Your acceptance is recorded as a test and is not binding.</Note>}
            <label className="bx-cp-tick"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I have read and agree to the {doc.title}{doc.schedule ? ', including its Schedule' : ''}.</span></label>
            {error && <Note warn>{error}</Note>}
            <button className="bx-btn" style={{ justifySelf: 'start' }} disabled={busy || !agree} onClick={accept}>{busy ? <Spin /> : <Check />}Accept</button>
          </>
        )}
      </section>
    </>
  );
}

// ── Training ──────────────────────────────────────────────────────────────

function TrainingTab({ me }: { me: Me }) {
  const [open, setOpen] = useState<string | null>(null);
  const mod = open ? MODULES.find((m) => m.id === open) : null;
  if (mod) return <Lesson mod={mod} status={me.lessons.find((l) => l.id === mod.id)} onBack={() => setOpen(null)} />;
  return (
    <>
      <div>
        <h1 className="bx-cp-h1">Training</h1>
        <p className="bx-cp-lede">Four short lessons, each with a quiz. Pass all four, at {Math.round(PASS_MARK * 100)}% or more, before you register prospects. You can retake a quiz as often as you like.</p>
      </div>
      <section className="bx-card">
        {MODULES.map((m, i) => {
          const l = me.lessons.find((x) => x.id === m.id);
          return (
            <div key={m.id} className="bx-li click" style={{ gridTemplateColumns: '28px 1fr auto' }} onClick={() => setOpen(m.id)}>
              <span className="muted num">{i + 1}</span>
              <span><b>{m.title}</b><br /><span className="muted" style={{ fontSize: 13 }}>{m.minutes} minutes · {m.questions.length} questions</span></span>
              {l?.passed ? <Tag tone="green">Passed</Tag> : l?.attempts ? <Tag tone="amber">Try again</Tag> : <Tag tone="grey">Not started</Tag>}
            </div>
          );
        })}
      </section>
    </>
  );
}

function Lesson({ mod, status, onBack }: { mod: Module; status?: Me['lessons'][number]; onBack: () => void }) {
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<null | { correct: number; total: number; passed: boolean; wrong: string[] }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ correct: number; total: number; passed: boolean; wrong: string[] }>(`/api/v2/connectors/lessons/${mod.id}`, { answers });
      setResult(r);
      await qc.invalidateQueries({ queryKey: ['connector-me'] });
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  // Consecutive "- " lines become one list.
  const blocks: (string | string[])[] = [];
  for (const p of mod.body) {
    const last = blocks[blocks.length - 1];
    if (!p.startsWith('- ')) blocks.push(p);
    else if (Array.isArray(last)) last.push(p.slice(2));
    else blocks.push([p.slice(2)]);
  }
  return (
    <>
      <button className="bx-link" style={{ justifySelf: 'start' }} onClick={onBack}>Back to training</button>
      <section className="bx-card bx-cp-lesson">
        <h1 className="bx-cp-h1">{mod.title}</h1>
        {status?.passed && <Note>You passed this lesson. You can review it and retake the quiz any time.</Note>}
        {blocks.map((b, i) => (typeof b === 'string' ? <p key={i}>{b}</p> : <ul key={i}>{b.map((x) => <li key={x}>{x}</li>)}</ul>))}
      </section>
      <section className="bx-card" style={{ display: 'grid', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Quiz</h2>
        {mod.questions.map((q, qi) => (
          <fieldset key={q.id} className="bx-cp-q" style={{ border: 0, margin: 0, padding: '14px 0 0', borderTop: '1px solid var(--line)' }}>
            <legend className="qt" style={{ padding: 0 }}>{qi + 1}. {q.q}</legend>
            {q.options.map((o, oi) => (
              <label key={oi} className={`${answers[q.id] === oi ? 'on' : ''}${result?.wrong.includes(q.id) && answers[q.id] === oi ? ' wrong' : ''}`}>
                <input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => { setAnswers({ ...answers, [q.id]: oi }); setResult(null); }} />
                <span>{o}</span>
              </label>
            ))}
          </fieldset>
        ))}
        {result && (result.passed
          ? <Note>Passed: {result.correct} of {result.total} correct.{result.wrong.length ? ' Questions marked in red were wrong; review them before you start.' : ''}</Note>
          : <Note warn>{result.correct} of {result.total} correct. You need {Math.ceil(PASS_MARK * result.total)} to pass. Review the lesson and try again.</Note>)}
        {error && <Note warn>{error}</Note>}
        <div className="bx-cp-row">
          <button className="bx-btn" disabled={busy || Object.keys(answers).length < mod.questions.length} onClick={submit}>{busy ? <Spin /> : null}Submit answers</button>
          {result?.passed && <button className="bx-btn ghost" onClick={onBack}>Next lesson</button>}
        </div>
      </section>
    </>
  );
}

// ── Prospects ─────────────────────────────────────────────────────────────

const REG_TONE: Record<Registration['status'], 'green' | 'blue' | 'grey' | 'amber'> = { pending: 'amber', approved: 'blue', live: 'green', declined: 'grey', closed: 'grey' };
const REG_LABEL: Record<Registration['status'], string> = { pending: 'Pending review', approved: 'Approved', live: 'Live', declined: 'Declined', closed: 'Closed' };

function ProspectsTab({ me, go }: { me: Me; go: (t: Tab) => void }) {
  const regs = useQuery({ queryKey: ['connector-regs'], queryFn: () => api<{ registrations: Registration[] }>('/api/v2/connectors/registrations') });
  const [adding, setAdding] = useState(false);
  const { label } = useCountries();
  return (
    <>
      <div className="bx-cp-row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 className="bx-cp-h1">Prospects</h1>
          <p className="bx-cp-lede">Register every organisation before you introduce it. BlockFinaX approves it with the reward that applies; that approval is your Approval Notice.</p>
        </div>
        {me.ready && !adding && <button className="bx-btn" onClick={() => setAdding(true)}>Register a prospect</button>}
      </div>
      {!me.ready && (
        <Note warn>Before you can register prospects: {me.missing.join('; ')}.{' '}
          {!me.agreement.signed && <button className="bx-link" onClick={() => go('agreement')}>Open the terms</button>}</Note>
      )}
      {adding && <RegisterForm onDone={() => setAdding(false)} />}
      {regs.isLoading ? <Loading /> : !regs.data?.registrations.length ? (
        <section className="bx-card"><div className="bx-empty">No prospects yet. Registered introductions and their status will appear here.</div></section>
      ) : (
        <div className="bx-cp-items">
          {regs.data.registrations.map((r) => (
            <div key={r.id} className="bx-cp-item">
              <span className="ic"><Building2 /></span>
              <span className="body">
                <span className="t">{r.organisation}</span>
                <span className="s">{[areaByKey(r.area)?.label, label(r.country), r.contactName + (r.contactRole ? `, ${r.contactRole}` : '')].join(' · ')}</span>
                {r.rewardTerms && r.status !== 'declined' && <span className="s">Reward: {r.rewardTerms}{r.bonusUsd ? `, bonus ${usd(r.bonusUsd)}` : ''}{r.periodEnd ? `, period ${day(r.periodStart)} to ${day(r.periodEnd)}` : ''}</span>}
                {r.decisionNote && <span className="s">Note from BlockFinaX: {r.decisionNote}</span>}
              </span>
              <span className="meta"><span>Registered on {day(r.createdAt)}</span><Tag tone={REG_TONE[r.status]}>{REG_LABEL[r.status]}</Tag></span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ area: '' as AreaKey | '', organisation: '', website: '', contactName: '', contactRole: '', contactEmail: '', country: '', need: '', permission: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = f.area ? areaByKey(f.area) : null;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api('/api/v2/connectors/registrations', f);
      await Promise.all([qc.invalidateQueries({ queryKey: ['connector-regs'] }), qc.invalidateQueries({ queryKey: ['connector-me'] })]);
      onDone();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <section className="bx-card">
      <div className="bx-card-h"><h2>Register a prospect</h2><button className="bx-link" onClick={onDone}>Cancel</button></div>
      <div className="bx-cp-form" style={{ marginTop: 14 }}>
        <Field label="Area" htmlFor="rg-area" wide>
          <select id="rg-area" className="bx-select" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value as AreaKey })}>
            <option value="">Choose an area</option>
            {AREAS.map((a) => <option key={a.key} value={a.key}>{a.group}: {a.label}</option>)}
          </select>
        </Field>
        {area && <div className="wide" style={{ marginBottom: 14 }}><Note>{area.qualifies}. Reward: {area.reward}.</Note></div>}
        {f.area === 'fundraising' && <div className="wide" style={{ marginBottom: 14 }}><Note warn>Do not ask anyone to invest. Register the investor's interest only; any fee needs a separate fundraising agreement, signed by both sides, before you introduce anyone.</Note></div>}
        <Field label="Organisation" htmlFor="rg-org"><input id="rg-org" className="bx-input" value={f.organisation} onChange={(e) => setF({ ...f, organisation: e.target.value })} /></Field>
        <Field label="Website" htmlFor="rg-web"><input id="rg-web" className="bx-input" placeholder="acme.com" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></Field>
        <Field label="Person you know there" htmlFor="rg-contact"><input id="rg-contact" className="bx-input" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
        <Field label="Their role" htmlFor="rg-role"><input id="rg-role" className="bx-input" placeholder="Chief Financial Officer" value={f.contactRole} onChange={(e) => setF({ ...f, contactRole: e.target.value })} /></Field>
        <Field label="Their work email, optional" htmlFor="rg-email"><input id="rg-email" type="email" className="bx-input" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
        <Field label="Country" htmlFor="rg-country"><CountrySelect id="rg-country" value={f.country} onChange={(v) => setF({ ...f, country: v })} /></Field>
        <Field label="What they need" htmlFor="rg-need" wide>
          <textarea id="rg-need" className="bx-input" rows={3} placeholder="For example: pays about $200,000 a month in dollar invoices from Lagos and wants to cap the naira cost." value={f.need} onChange={(e) => setF({ ...f, need: e.target.value })} />
        </Field>
      </div>
      <label className="bx-cp-tick"><input type="checkbox" checked={f.permission} onChange={(e) => setF({ ...f, permission: e.target.checked })} />
        <span>I have this person's permission to introduce them to BlockFinaX, I will tell them BlockFinaX may reward me, and I do not work for this organisation.</span></label>
      {error && <Note warn>{error}</Note>}
      <button className="bx-btn" style={{ marginTop: 10 }} disabled={busy || !f.permission} onClick={submit}>{busy ? <Spin /> : null}Register prospect</button>
    </section>
  );
}

// ── Referrals ─────────────────────────────────────────────────────────────

function ReferralsTab({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ['connector-referrals'], queryFn: () => api<{ referrals: Referral[] }>('/api/v2/connectors/referrals') });
  return (
    <>
      <div>
        <h1 className="bx-cp-h1">Referrals</h1>
        <p className="bx-cp-lede">People who created a BlockFinaX account through your link. You see their progress, never their balances or contracts. Estimates are 25% of the protocol fees on their contracts in their first 12 months; the quarterly statement is what is paid.</p>
      </div>
      {me.referral ? <CopyBox value={me.referral.link} /> : <Note>Your referral link appears once your application is approved, you have accepted the terms and your training is complete.</Note>}
      {q.isLoading ? <Loading /> : !q.data?.referrals.length ? <section className="bx-card"><div className="bx-empty">No referrals yet.</div></section> : (
        <div className="bx-cp-items">
          {q.data.referrals.map((r) => (
            <div key={r.id} className="bx-cp-item">
              <span className="ic"><UserRound /></span>
              <span className="body">
                <span className="t">{r.name ?? 'New user'}</span>
                <span className="s">{[r.email, `estimated reward ${usd(r.estimatedShare)}`].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="meta"><span>Joined on {day(r.joinedAt)}</span>
                {r.contracts > 0 ? <Tag tone="green">{r.contracts} contract{r.contracts === 1 ? '' : 's'}</Tag> : r.onboarded ? <Tag tone="blue">Profile complete</Tag> : <Tag tone="grey">Signed up</Tag>}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Rewards ───────────────────────────────────────────────────────────────

function RewardsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['connector-rewards'], queryFn: () => api<Rewards>('/api/v2/connectors/rewards') });
  const [payout, setPayout] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (q.data && payout === null) setPayout(q.data.payoutDetails ?? ''); }, [q.data, payout]);
  if (q.isLoading || !q.data) return <Loading />;
  const r = q.data;
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await api('/api/v2/connectors/payout', { details: payout }); setMsg({ ok: true, text: 'Saved' }); await qc.invalidateQueries({ queryKey: ['connector-rewards'] }); }
    catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  };
  return (
    <>
      <div>
        <h1 className="bx-cp-h1">Earnings</h1>
        <p className="bx-cp-lede">Rewards are paid every quarter, within 30 days of quarter end, in US dollars or USDC of equal value. Amounts under $100 roll forward.</p>
      </div>
      <div className="bx-cp-grid">
        <div className="bx-cp-stat"><b>{usd(r.statement.earned)}</b><span>Earned to date</span></div>
        <div className="bx-cp-stat"><b>{usd(r.statement.paid)}</b><span>Paid to date</span></div>
        <div className="bx-cp-stat"><b>{usd(r.statement.owed)}</b><span>Owed</span></div>
        <div className="bx-cp-stat"><b>{usd(r.estimatedFromReferrals)}</b><span>Estimated from referrals, not yet in a statement</span></div>
      </div>
      <section className="bx-card">
        <div className="bx-card-h"><h2>Statements</h2></div>
        {!r.statement.quarters.length ? <div className="bx-empty">Your first statement appears after the quarter in which you earn a reward.</div> : (
          <>
            <div className="bx-list-h" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}><span>Quarter</span><span className="r">Earned</span><span className="r">Paid</span></div>
            {r.statement.quarters.map((s) => (
              <div key={s.quarter} className="bx-li" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}><span className="num">{s.quarter}</span><span className="r num">{usd(s.earned)}</span><span className="r num">{usd(s.paid)}</span></div>
            ))}
          </>
        )}
      </section>
      <section className="bx-card">
        <div className="bx-card-h"><h2>Details</h2></div>
        {!r.lines.length ? <div className="bx-empty">No entries yet.</div> : r.lines.map((l) => (
          <div key={l.id} className="bx-li" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
            <span><b>{LEDGER_LABELS[l.kind]}</b> <span className="muted">· {l.quarter}{l.organisation ? ` · ${l.organisation}` : ''}</span>
              {(l.note || l.reference) && <><br /><span className="muted" style={{ fontSize: 13 }}>{[l.note, l.reference].filter(Boolean).join(' · ')}</span></>}</span>
            <span className={`num${l.kind === 'payment' ? ' up' : ''}`}>{l.kind === 'payment' ? 'Paid ' : ''}{usd(l.amountUsd)}</span>
          </div>
        ))}
      </section>
      <section className="bx-card">
        <div className="bx-card-h"><h2>Where we pay you</h2></div>
        <p className="sub" style={{ marginBottom: 12 }}>A bank account or a USDC wallet in your own name. For a bank, include the bank name, account name and number, and SWIFT code. For USDC, give a Stellar address.</p>
        <textarea id="cp-payout" aria-label="Payout details" className="bx-input" rows={3} value={payout ?? ''} onChange={(e) => setPayout(e.target.value)} />
        <div className="bx-cp-row" style={{ marginTop: 10 }}>
          <button className="bx-btn" disabled={busy} onClick={save}>{busy ? <Spin /> : null}Save payout details</button>
          {msg && <span className={msg.ok ? 'up' : 'down'}>{msg.text}</span>}
        </div>
      </section>
    </>
  );
}

// ── Engagements ───────────────────────────────────────────────────────────

function EngagementsTab({ me, go }: { me: Me; go: (t: Tab) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['connector-engagements'], queryFn: () => api<{ engagements: Engagement[] }>('/api/v2/connectors/engagements') });
  const [agree, setAgree] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const act = async (id: string, action: 'accept' | 'decline') => {
    setBusy(id); setError({ ...error, [id]: '' });
    try {
      await api(`/api/v2/connectors/engagements/${id}/${action}`, action === 'accept' ? { agree: !!agree[id] } : {});
      await Promise.all([qc.invalidateQueries({ queryKey: ['connector-engagements'] }), qc.invalidateQueries({ queryKey: ['connector-me'] })]);
    } catch (e) { setError({ ...error, [id]: errMsg(e) }); } finally { setBusy(null); }
  };
  const tone: Record<string, 'green' | 'blue' | 'grey' | 'amber'> = { offered: 'amber', accepted: 'blue', completed: 'green', declined: 'grey', cancelled: 'grey' };
  return (
    <>
      <div>
        <h1 className="bx-cp-h1">Engagements</h1>
        <p className="bx-cp-lede">Paid pieces of work BlockFinaX offers you under the Contractor Terms. Tick the box and accept the ones you want to take on.</p>
      </div>
      {!me.agreement.signed && <Note warn>Accept the Contractor Terms before accepting engagements. <button className="bx-link" onClick={() => go('agreement')}>Open them</button></Note>}
      {q.isLoading ? <Loading /> : !q.data?.engagements.length ? <section className="bx-card"><div className="bx-empty">No engagements yet. Offers from BlockFinaX will appear here.</div></section> : q.data.engagements.map((e) => (
        <section key={e.id} className="bx-card" style={{ display: 'grid', gap: 10 }}>
          <div className="bx-card-h"><h2>{e.title}</h2><Tag tone={tone[e.status] ?? 'grey'}>{e.status[0]!.toUpperCase() + e.status.slice(1)}</Tag></div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{e.scope}</p>
          <span><b>Fees:</b> {e.feeTerms}</span>
          {(e.startsOn || e.endsOn) && <span className="muted">Dates: {e.startsOn ?? 'open'} to {e.endsOn ?? 'open'}</span>}
          {e.acceptedName && <span className="muted">Accepted by <i>{e.acceptedName}</i> on {day(e.acceptedAt)}</span>}
          {e.status === 'offered' && (
            <div style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <label className="bx-cp-tick"><input type="checkbox" checked={!!agree[e.id]} onChange={(ev) => setAgree({ ...agree, [e.id]: ev.target.checked })} />
                <span>I accept this engagement under the Contractor Terms.</span></label>
              {error[e.id] && <Note warn>{error[e.id]}</Note>}
              <div className="bx-cp-row">
                <button className="bx-btn" disabled={busy === e.id || !agree[e.id]} onClick={() => act(e.id, 'accept')}>Accept engagement</button>
                <button className="bx-btn ghost" disabled={busy === e.id} onClick={() => act(e.id, 'decline')}>Decline</button>
              </div>
            </div>
          )}
        </section>
      ))}
    </>
  );
}

// ── Offers ────────────────────────────────────────────────────────────────

interface Offer {
  id: string; title: string; summary: string; details: string | null; area: AreaKey | null; country: string | null;
  audience: 'all' | 'connector' | 'contractor'; reward: string; closesOn: string | null; status: 'open' | 'closed'; createdAt: string;
  mine: null | { status: 'interested' | 'selected' | 'not_selected' | 'withdrawn'; note: string | null; at: string };
}

const MINE_LABEL: Record<string, [string, 'green' | 'blue' | 'grey' | 'amber']> = {
  interested: ['You are interested', 'blue'], selected: ['You were selected', 'green'], not_selected: ['Not selected this time', 'grey'], withdrawn: ['Withdrawn', 'grey'],
};

function OffersTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['connector-offers'], queryFn: () => api<{ canRespond: boolean; offers: Offer[] }>('/api/v2/connectors/offers') });
  const { label } = useCountries();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const act = async (id: string, action: 'respond' | 'withdraw') => {
    setBusy(id); setError({ ...error, [id]: '' });
    try {
      await api(`/api/v2/connectors/offers/${id}/${action}`, action === 'respond' ? { note: note[id] ?? '' } : {});
      await Promise.all([qc.invalidateQueries({ queryKey: ['connector-offers'] }), qc.invalidateQueries({ queryKey: ['connector-me'] })]);
      setOpen(null);
    } catch (e) { setError({ ...error, [id]: errMsg(e) }); } finally { setBusy(null); }
  };
  return (
    <>
      <div>
        <h1 className="bx-cp-h1">Offers</h1>
        <p className="bx-cp-lede">Opportunities BlockFinaX is looking for help with right now. Say you are interested and BlockFinaX will get back to you. Any reward is confirmed in writing when you are selected.</p>
      </div>
      {q.isLoading ? <Loading /> : !q.data?.offers.length ? (
        <section className="bx-card"><div className="bx-empty">No open offers right now. New offers appear here, and we email you when one is posted.</div></section>
      ) : q.data.offers.map((o) => {
        const area = o.area ? areaByKey(o.area) : null;
        const mine = o.mine ? MINE_LABEL[o.mine.status] : null;
        const canAct = q.data!.canRespond && o.status === 'open';
        return (
          <section key={o.id} className="bx-card" style={{ display: 'grid', gap: 10 }}>
            <div className="bx-card-h" style={{ alignItems: 'flex-start' }}>
              <div>
                <h2>{o.title}</h2>
                <div className="sub">{[area?.label, o.country ? label(o.country) : null, o.audience === 'contractor' ? 'For contractors' : o.audience === 'connector' ? 'For connectors' : null,
                  o.closesOn ? `Closes ${day(o.closesOn)}` : null].filter(Boolean).join(' · ')}</div>
              </div>
              {mine ? <Tag tone={mine[1]}>{mine[0]}</Tag> : o.status === 'closed' ? <Tag tone="grey">Closed</Tag> : <Tag tone="amber">Open</Tag>}
            </div>
            <p style={{ margin: 0, lineHeight: 1.55 }}>{o.summary}</p>
            {o.details && <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.55 }} className="muted">{o.details}</p>}
            <span><b>Reward:</b> {o.reward}</span>
            {o.mine?.note && <span className="muted" style={{ fontSize: 13 }}>Your note: {o.mine.note}</span>}
            {canAct && (!o.mine || o.mine.status === 'withdrawn') && (open === o.id ? (
              <div style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <label htmlFor={`of-${o.id}`} className="muted" style={{ fontSize: 13 }}>How you can help, in a sentence or two</label>
                <textarea id={`of-${o.id}`} className="bx-input" rows={3} value={note[o.id] ?? ''} onChange={(e) => setNote({ ...note, [o.id]: e.target.value })} />
                {error[o.id] && <Note warn>{error[o.id]}</Note>}
                <div className="bx-cp-row">
                  <button className="bx-btn" disabled={busy === o.id} onClick={() => act(o.id, 'respond')}>{busy === o.id ? <Spin /> : null}Send</button>
                  <button className="bx-btn ghost" onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </div>
            ) : <button className="bx-btn" style={{ justifySelf: 'start' }} onClick={() => setOpen(o.id)}>I'm interested</button>)}
            {canAct && o.mine?.status === 'interested' && (
              <button className="bx-link" style={{ justifySelf: 'start' }} disabled={busy === o.id} onClick={() => act(o.id, 'withdraw')}>Withdraw my interest</button>
            )}
            {!q.data!.canRespond && o.status === 'open' && <Note>You can respond to offers once BlockFinaX has approved your application.</Note>}
          </section>
        );
      })}
    </>
  );
}

// ── Materials and profile ─────────────────────────────────────────────────

function MaterialsTab() {
  return (
    <>
      <div>
        <h1 className="bx-cp-h1">Materials</h1>
        <p className="bx-cp-lede">The only materials to share with prospects. Do not make your own claims about prices, returns or payouts; point people to these pages and to BlockFinaX.</p>
      </div>
      <div className="bx-cp-grid">
        {MATERIALS.map((m) => (
          <a key={m.url} className="bx-card" href={m.url} target="_blank" rel="noopener noreferrer" style={{ display: 'grid', gap: 6, color: 'inherit' }}>
            <Tag tone="grey">{m.audience}</Tag>
            <b style={{ fontSize: 15 }}>{m.title}</b>
            <span className="muted" style={{ fontSize: 13.5 }}>{m.description}</span>
          </a>
        ))}
      </div>
    </>
  );
}

function ProfileTab({ me, go }: { me: Me; go: (t: Tab) => void }) {
  const qc = useQueryClient();
  const m = me.member!;
  const [form, setForm] = useState<ProfileForm>({ kind: m.kind, fullName: m.fullName, organisation: m.organisation ?? '', country: m.country, phone: m.phone ?? '', markets: m.markets ?? '', areas: m.areas, about: m.about ?? '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await api('/api/v2/connectors/apply', form); setMsg({ ok: true, text: 'Saved' }); await qc.invalidateQueries({ queryKey: ['connector-me'] }); }
    catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  };
  const nameChanged = form.fullName.trim() !== m.fullName;
  return (
    <>
      <div>
        <h1 className="bx-cp-h1">Profile</h1>
        <p className="bx-cp-lede">{m.email} · member since {day(m.joinedAt)} · status: {m.status}</p>
      </div>
      <section className="bx-card">
        <ProfileFields form={form} set={setForm} lockKind={m.status !== 'applied'} />
        {nameChanged && me.agreement.signed && <Note warn>Your accepted terms carry your current name. If your legal name has changed, contact BlockFinaX.</Note>}
        <div className="bx-cp-row" style={{ marginTop: 10 }}>
          <button className="bx-btn" disabled={busy} onClick={save}>{busy ? <Spin /> : null}Save profile</button>
          {msg && <span className={msg.ok ? 'up' : 'down'}>{msg.text}</span>}
        </div>
      </section>
      {me.agreement.signed && (
        <section className="bx-card">
          <h2 style={{ fontSize: 16, marginBottom: 6 }}>Your terms</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            {AGREEMENTS[me.agreement.kind].title}, version {me.agreement.version}. Accepted {day(me.agreement.signed.signedAt)}.
          </p>
          <button className="bx-btn ghost" onClick={() => go('agreement')}><FileSignature />View the terms</button>
        </section>
      )}
    </>
  );
}
