/**
 * The public demo (demo.blockfinax.com): a banner that says it runs on test money, and the
 * Contact sales form for anyone who wants live protection.
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/wallets/passkey-wallet';
import { usePasskeySession } from '@/lib/identity';
import { openContactSales, useIsDemo } from './shared';
import { Spin } from './ui';

export function DemoBanner() {
  const demo = useIsDemo();
  if (!demo) return null;
  return (
    <div className="bx-demo-banner" role="note">
      <span><b>Demo</b> · runs on test networks with test USDC. Nothing here is real money.</span>
      <button className="bx-demo-cta" onClick={() => openContactSales('banner')}>Want live protection? Contact sales</button>
    </div>
  );
}

type Role = 'business' | 'underwriter' | 'partner' | 'other';

export function ContactSales() {
  const { session } = usePasskeySession();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('app');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', email: '', company: '', country: '', role: 'business' as Role, exposure: '', monthlyVolume: '', message: '' });

  useEffect(() => {
    const onOpen = (e: Event) => {
      setSource((e as CustomEvent).detail?.source ?? 'app');
      setSent(false); setError(null); setOpen(true);
      setF((x) => ({ ...x, name: x.name || session?.user.name || '', email: x.email || session?.user.email || '' }));
    };
    window.addEventListener('bfx:contact-sales', onOpen);
    return () => window.removeEventListener('bfx:contact-sales', onOpen);
  }, [session]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  if (!open) return null;

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit() {
    setBusy(true); setError(null);
    try {
      await api('/api/sales-requests', {
        name: f.name, email: f.email, role: f.role, source,
        ...(f.company ? { company: f.company } : {}), ...(f.country ? { country: f.country } : {}),
        ...(f.exposure ? { exposure: f.exposure } : {}), ...(f.monthlyVolume ? { monthlyVolume: f.monthlyVolume } : {}),
        ...(f.message ? { message: f.message } : {}),
      });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="bx-modal-bg" onClick={() => setOpen(false)}>
      <div className="bx-modal" role="dialog" aria-label="Contact sales" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div><h2 style={{ margin: 0 }}>Talk to sales</h2><div className="sub">Live protection with real USDC is available through our team.</div></div>
          <button className="bx-icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X /></button>
        </div>
        {sent ? (
          <div style={{ padding: '24px 0 8px' }}>
            <h3 style={{ margin: '0 0 6px' }}>Thank you</h3>
            <p className="muted" style={{ margin: 0 }}>We have your request and will reply to {f.email}, usually within one working day.</p>
            <button className="bx-btn block" style={{ marginTop: 18 }} onClick={() => setOpen(false)}>Back to the demo</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="bx-field" style={{ margin: 0 }}><span>Name</span><input className="bx-input" value={f.name} onChange={set('name')} /></label>
              <label className="bx-field" style={{ margin: 0 }}><span>Work email</span><input className="bx-input" type="email" value={f.email} onChange={set('email')} /></label>
              <label className="bx-field" style={{ margin: 0 }}><span>Company</span><input className="bx-input" value={f.company} onChange={set('company')} /></label>
              <label className="bx-field" style={{ margin: 0 }}><span>Country</span><input className="bx-input" value={f.country} onChange={set('country')} /></label>
            </div>
            <div>
              <span className="bx-label">I am interested as</span>
              <div className="bx-seg">
                {([['business', 'A business'], ['underwriter', 'An underwriter'], ['partner', 'A partner'], ['other', 'Other']] as [Role, string][]).map(([k, l]) => (
                  <button key={k} className={f.role === k ? 'on' : ''} onClick={() => setF({ ...f, role: k })}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="bx-field" style={{ margin: 0 }}><span>Currency exposure</span><input className="bx-input" placeholder="e.g. USD payables in naira" value={f.exposure} onChange={set('exposure')} /></label>
              <label className="bx-field" style={{ margin: 0 }}><span>Monthly volume (USD)</span><input className="bx-input" placeholder="e.g. 50,000" value={f.monthlyVolume} onChange={set('monthlyVolume')} /></label>
            </div>
            <label className="bx-field" style={{ margin: 0 }}><span>Anything else</span><textarea className="bx-input" rows={3} value={f.message} onChange={set('message')} /></label>
            {error && <div className="bx-error">{error}</div>}
            <button className="bx-btn block" disabled={busy || !f.name.trim() || !/^\S+@\S+\.\S+$/.test(f.email)} onClick={submit}>{busy ? <><Spin /> Sending...</> : 'Send to sales'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
