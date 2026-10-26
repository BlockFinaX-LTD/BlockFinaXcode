/**
 * First-run form: individual or organisation, then a few basic details.
 *
 * Shown by the workspace until the account has completed it. No ID numbers or
 * documents here; those are asked for at the first purchase or pool.
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, Building2, User } from 'lucide-react';
import {
  COUNTRIES, INDUSTRIES, INTENTS, INTENT_LABELS, MONTHLY_VOLUMES, PRIORITY_COUNTRIES, validateOnboarding,
  type AccountType, type Intent,
} from '@shared/onboarding';
import { api } from '@/lib/wallets/passkey-wallet';
import logoPath from '@/assets/logo.png';
import { Spin } from './ui';

export interface OnboardingView {
  completed: boolean;
  accountType?: AccountType;
  intents?: Intent[];
}

function useCountryNames() {
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* older browsers show codes */ }
    const label = (code: string) => names?.of(code) ?? code;
    const rest = COUNTRIES.slice(PRIORITY_COUNTRIES.length).map((c) => ({ code: c, name: label(c) })).sort((a, b) => a.name.localeCompare(b.name));
    return { first: PRIORITY_COUNTRIES.map((c) => ({ code: c as string, name: label(c) })), rest };
  }, []);
}

function CountrySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { first, rest } = useCountryNames();
  return (
    <select className="bx-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a country</option>
      {first.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      <option disabled>──────────</option>
      {rest.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
    </select>
  );
}

export function Onboarding({ email, defaultName, onDone }: { email?: string | null; defaultName?: string | null; onDone: (v: OnboardingView) => void }) {
  const [type, setType] = useState<AccountType | null>(null);
  const [fullName, setFullName] = useState(defaultName ?? '');
  const [country, setCountry] = useState('');
  const [phone, setPhone] = useState('');
  const [intents, setIntents] = useState<Intent[]>([]);
  const [jobTitle, setJobTitle] = useState('');
  const [legalName, setLegalName] = useState('');
  const [registrationCountry, setRegistrationCountry] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [industry, setIndustry] = useState('');
  const [monthlyVolume, setMonthlyVolume] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = { accountType: type, fullName, country, phone, intents, jobTitle, legalName, registrationCountry, registrationNumber, industry, monthlyVolume };
  const { problems } = validateOnboarding(form);
  const toggle = (i: Intent) => setIntents((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));

  async function submit() {
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api<OnboardingView>('/api/v2/onboarding', form));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bx-onboard">
      <div className="bx-onboard-card">
        <div className="bx-onboard-brand"><img src={logoPath} alt="" />BlockFinaX</div>

        {!type ? (
          <>
            <h1>Who is this account for?</h1>
            <p className="sub">{email ? `Signed in as ${email}. ` : ''}This sets up the right workspace.</p>
            <div className="bx-onboard-types">
              <button onClick={() => setType('individual')}>
                <User />
                <span className="t">For myself</span>
                <span className="p">I manage my own currency risk or capital</span>
              </button>
              <button onClick={() => setType('organisation')}>
                <Building2 />
                <span className="t">For an organisation</span>
                <span className="p">A company, NGO or institution, with a team</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <button className="bx-link bx-onboard-back" onClick={() => { setType(null); setTried(false); }}><ArrowLeft /> Back</button>
            <h1>{type === 'individual' ? 'About you' : 'About your organisation'}</h1>
            <p className="sub">A few basics. We don't ask for ID or documents now.</p>

            <div className="bx-onboard-grid">
              <label className="bx-field">Your full name
                <input className="bx-input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
              </label>
              {type === 'organisation' && (
                <label className="bx-field">Your job title
                  <input className="bx-input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Finance Director" autoComplete="organization-title" />
                </label>
              )}
              <label className="bx-field">Your country of residence
                <CountrySelect value={country} onChange={setCountry} />
              </label>
              {type === 'individual' && (
                <label className="bx-field">Phone number
                  <input className="bx-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+233 24 123 4567" autoComplete="tel" />
                </label>
              )}
              {type === 'organisation' && (
                <>
                  <label className="bx-field wide">Organisation's legal name
                    <input className="bx-input" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="As registered" autoComplete="organization" />
                  </label>
                  <label className="bx-field">Country of registration
                    <CountrySelect value={registrationCountry} onChange={setRegistrationCountry} />
                  </label>
                  <label className="bx-field">Registration number
                    <input className="bx-input" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
                  </label>
                  <label className="bx-field">Industry
                    <select className="bx-input" value={industry} onChange={(e) => setIndustry(e.target.value)}>
                      <option value="">Choose an industry</option>
                      {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
                    </select>
                  </label>
                  <label className="bx-field">Expected monthly amount
                    <select className="bx-input" value={monthlyVolume} onChange={(e) => setMonthlyVolume(e.target.value)}>
                      <option value="">Choose a range</option>
                      {MONTHLY_VOLUMES.map((v) => <option key={v}>{v}</option>)}
                    </select>
                  </label>
                </>
              )}
            </div>

            <span className="bx-label">What do you want to do? Choose all that apply.</span>
            <div className="bx-onboard-intents">
              {INTENTS.map((i) => (
                <button key={i} className={intents.includes(i) ? 'on' : ''} aria-pressed={intents.includes(i)} onClick={() => toggle(i)}>
                  <span className="t">{INTENT_LABELS[type][i].title}</span>
                  <span className="p">{INTENT_LABELS[type][i].line}</span>
                </button>
              ))}
            </div>

            {tried && problems[0] && <p className="bx-error">{problems[0]}</p>}
            {error && <p className="bx-error">{error}</p>}
            <button className="bx-btn block" style={{ marginTop: 16 }} disabled={busy} onClick={submit}>{busy ? <Spin /> : null} Continue</button>
            <p className="bx-hint" style={{ marginTop: 10 }}>
              {type === 'organisation'
                ? 'You can explore and get quotes straight away. Before your first purchase or pool we will ask for company documents and your ID.'
                : 'You can explore and get quotes straight away. Before your first purchase or pool we will ask for your ID.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
