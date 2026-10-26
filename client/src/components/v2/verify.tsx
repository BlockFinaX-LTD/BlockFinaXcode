/**
 * Identity verification, opened when the server refuses a purchase or deposit with
 * VERIFICATION_REQUIRED (mainnet, policy §3.1). Basic and Verified are submitted here;
 * Enhanced, which needs company documents and source of wealth, goes through the team.
 *
 * Details the account already gave at onboarding are filled in, so nothing is asked twice.
 * Submissions go to /api/compliance/submit and are reviewed in the admin dashboard.
 */
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { COUNTRIES, PRIORITY_COUNTRIES } from '@shared/onboarding';
import { api, storedSessionToken } from '@/lib/wallets/passkey-wallet';
import { openContactSales } from './shared';
import { Spin } from './ui';

interface Standing {
  tier: number;
  submission: { status: string; requestedTier: number; notes: string | null } | null;
  prefill: Record<string, string>;
}
interface Onboarding { completed: boolean; accountType?: string; fullName?: string; country?: string; phone?: string | null; organisation?: { legalName: string; registrationNumber: string } | null }
interface Doc { label: string; filename: string; mime: string; dataUrl: string }

const TIER_NAMES = ['Unverified', 'Basic', 'Verified', 'Enhanced'];
const ID_TYPES = ['Ghana Card', 'Passport', 'National ID card', "Driver's licence"];
const MAX_FILE = 4 * 1024 * 1024;

/** The compliance routes take the session as a bearer token, like /api/v2. */
async function compliance<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${storedSessionToken() ?? ''}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message ?? json?.error ?? 'Request failed');
  return json as T;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

export function VerifyModal() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [required, setRequired] = useState(1);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [f, setF] = useState({ fullName: '', dateOfBirth: '', country: '', phone: '', idType: ID_TYPES[0], idNumber: '', address: '', sourceOfFunds: '', isPep: false });
  const [docs, setDocs] = useState<Record<string, Doc | null>>({ id: null, address: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const onVerify = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      setReason(d.reason ?? ''); setRequired(Math.min(3, Math.max(1, Number(d.requiredTier) || 1)));
      setSent(false); setError(null); setOpen(true);
    };
    window.addEventListener('bfx:verify', onVerify);
    return () => window.removeEventListener('bfx:verify', onVerify);
  }, []);

  useEffect(() => {
    if (!open) return;
    void Promise.all([
      compliance<Standing>('/api/compliance/me').catch(() => null),
      api<Onboarding>('/api/v2/onboarding').catch(() => null),
    ]).then(([s, o]) => {
      setStanding(s); setOnboarding(o);
      const p = s?.prefill ?? {};
      setF((x) => ({
        ...x,
        fullName: x.fullName || p.fullName || o?.fullName || '',
        dateOfBirth: x.dateOfBirth || p.dateOfBirth || '',
        country: x.country || p.country || o?.country || '',
        phone: x.phone || p.phone || o?.phone || '',
        idType: p.idType || x.idType,
        idNumber: x.idNumber || p.idNumber || '',
        address: x.address || p.address || '',
      }));
    });
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  const countries = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* codes shown */ }
    const label = (c: string) => names?.of(c) ?? c;
    const rest = COUNTRIES.slice(PRIORITY_COUNTRIES.length).map((c) => ({ c, n: label(c) })).sort((a, b) => a.n.localeCompare(b.n));
    return [...PRIORITY_COUNTRIES.map((c) => ({ c: c as string, n: label(c) })), ...rest];
  }, []);

  if (!open) return null;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const pending = standing?.submission && ['submitted', 'in_review'].includes(standing.submission.status);
  const tierNow = standing?.tier ?? 0;
  const target = Math.max(required, tierNow + 1);
  const org = onboarding?.accountType === 'organisation';

  async function attach(key: string, label: string, file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE) { setError('Each file must be under 4 MB.'); return; }
    if (!/^(image\/(png|jpe?g|webp)|application\/pdf)$/.test(file.type)) { setError('Upload a photo (JPG, PNG) or a PDF.'); return; }
    setError(null);
    setDocs((d) => ({ ...d, [key]: { label, filename: file.name, mime: file.type, dataUrl: '' } }));
    const dataUrl = await readFile(file);
    setDocs((d) => ({ ...d, [key]: { label, filename: file.name, mime: file.type, dataUrl } }));
  }

  const problem = !f.fullName.trim() ? 'Enter your full name.'
    : !f.dateOfBirth ? 'Enter your date of birth.'
    : !f.country ? 'Choose your country of residence.'
    : !f.idNumber.trim() ? `Enter your ${f.idType} number.`
    : target >= 2 && !f.address.trim() ? 'Enter your home address.'
    : target >= 2 && !f.sourceOfFunds.trim() ? 'Say where the money you use comes from.'
    : target >= 2 && !docs.id?.dataUrl ? 'Upload a photo of your ID.'
    : target >= 2 && !docs.address?.dataUrl ? 'Upload a proof of address.'
    : null;

  async function submit() {
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      await compliance('/api/compliance/submit', {
        requestedTier: target,
        entityType: 'individual',
        fullName: f.fullName.trim(), dateOfBirth: f.dateOfBirth, country: f.country, phone: f.phone.trim() || undefined,
        idType: f.idType, idNumber: f.idNumber.trim(), isPep: f.isPep,
        ...(target >= 2 ? { address: f.address.trim(), sourceOfFunds: f.sourceOfFunds.trim() } : {}),
        ...(org && onboarding?.organisation ? { companyName: onboarding.organisation.legalName, registrationNumber: onboarding.organisation.registrationNumber } : {}),
        documents: Object.values(docs).filter((d): d is Doc => Boolean(d?.dataUrl)),
      });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="bx-modal-bg" onClick={() => setOpen(false)}>
      <div className="bx-modal" role="dialog" aria-label="Verify your identity" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Verify your identity</h2>
            <div className="sub" style={{ marginTop: 4 }}>{reason || 'Verification is required before you buy protection or deposit.'}</div>
          </div>
          <button className="bx-icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X /></button>
        </div>

        {!standing ? <div style={{ padding: '24px 0', textAlign: 'center' }}><Spin /></div>
        : sent || pending ? (
          <div style={{ padding: '20px 0 6px' }}>
            <h3 style={{ margin: '0 0 6px' }}>{sent ? 'Thank you, we have your details' : 'Your verification is being reviewed'}</h3>
            <p className="muted" style={{ margin: 0 }}>Our team reviews verifications within one working day. You can explore and get quotes meanwhile; we will email you when it is done.</p>
            <button className="bx-btn block" style={{ marginTop: 18 }} onClick={() => setOpen(false)}>Done</button>
          </div>
        ) : target >= 3 ? (
          <div style={{ padding: '16px 0 6px' }}>
            <p style={{ margin: 0 }}>Amounts above $10,000 need Enhanced verification{org ? ', including your company documents' : ''}. Our team guides you through it.</p>
            <p className="muted" style={{ margin: '8px 0 0' }}>You are currently {TIER_NAMES[tierNow]}.</p>
            <button className="bx-btn block" style={{ marginTop: 18 }} onClick={() => { setOpen(false); openContactSales('verification'); }}>Contact our team</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
            <div className="muted" style={{ fontSize: 13 }}>
              {target === 1 ? 'Basic verification covers up to $1,000 moved and $1,000 of possible payout in 30 days.' : 'Verified covers up to $10,000 moved and $10,000 of possible payout in 30 days.'}
              {standing.submission?.status === 'rejected' && standing.submission.notes ? ` Your last submission was not approved: ${standing.submission.notes}` : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="bx-field" style={{ margin: 0 }}><span>Full legal name</span><input className="bx-input" value={f.fullName} onChange={set('fullName')} autoComplete="name" /></label>
              <label className="bx-field" style={{ margin: 0 }}><span>Date of birth</span><input className="bx-input" type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} autoComplete="bday" /></label>
              <label className="bx-field" style={{ margin: 0 }}><span>Country of residence</span>
                <select className="bx-input" value={f.country} onChange={set('country')}>
                  <option value="">Choose a country</option>
                  {countries.map(({ c, n }) => <option key={c} value={c}>{n}</option>)}
                </select>
              </label>
              <label className="bx-field" style={{ margin: 0 }}><span>Phone number</span><input className="bx-input" type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
              <label className="bx-field" style={{ margin: 0 }}><span>ID type</span>
                <select className="bx-input" value={f.idType} onChange={set('idType')}>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              </label>
              <label className="bx-field" style={{ margin: 0 }}><span>ID number</span><input className="bx-input" value={f.idNumber} onChange={set('idNumber')} /></label>
            </div>
            {target >= 2 && (
              <>
                <label className="bx-field" style={{ margin: 0 }}><span>Home address</span><input className="bx-input" value={f.address} onChange={set('address')} autoComplete="street-address" /></label>
                <label className="bx-field" style={{ margin: 0 }}><span>Where does the money you use come from?</span><input className="bx-input" placeholder="e.g. business revenue, salary, savings" value={f.sourceOfFunds} onChange={set('sourceOfFunds')} /></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label className="bx-field" style={{ margin: 0 }}><span>Photo of your ID</span><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => void attach('id', 'Photo ID', e.target.files?.[0])} /></label>
                  <label className="bx-field" style={{ margin: 0 }}><span>Proof of address (under 3 months old)</span><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => void attach('address', 'Proof of address', e.target.files?.[0])} /></label>
                </div>
              </>
            )}
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
              <input type="checkbox" checked={f.isPep} onChange={(e) => setF({ ...f, isPep: e.target.checked })} style={{ marginTop: 3 }} />
              <span>I hold, or have held, a prominent public position (or am a close family member or associate of someone who has).</span>
            </label>
            {error && <div className="bx-error">{error}</div>}
            <button className="bx-btn block" disabled={busy} onClick={submit}>{busy ? <><Spin /> Sending...</> : 'Submit for review'}</button>
            <div className="bx-hint">Your details are checked against sanctions lists and kept for six years, as the law requires.</div>
          </div>
        )}
      </div>
    </div>
  );
}
