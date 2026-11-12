/**
 * Customer side of the compliance records (server/records):
 *   YourDataCard            a link to the Privacy Policy and a deletion request (Account page)
 *   BusinessVerificationCard  the business identity check, KYB (Business settings, admins)
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/wallets/passkey-wallet';
import { Spin, Sum, Tag } from './ui';

const day = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// ── Your data ────────────────────────────────────────────────────────────────

interface Deletion { id: number; status: string; requested_at: string; completed_at: string | null }

export function YourDataCard() {
  const request = useQuery({ queryKey: ['records-deletion'], queryFn: () => api<{ request: Deletion | null }>('/api/records/deletion') });
  const current = request.data?.request;
  return (
    <div className="bx-card">
      <h2 style={{ marginBottom: 6 }}>Your data</h2>
      <div className="sub">What we keep, for how long, and how to ask us to delete it is set out in our <a href="/privacy" target="_blank" rel="noreferrer" className="bx-link">Privacy Policy</a>.</div>
      {current?.status === 'received' ? (
        <div className="bx-hint" style={{ textAlign: 'left', marginTop: 12 }}>You asked us to delete your data on {day(current.requested_at)}. We are handling it.</div>
      ) : current?.status === 'completed' ? (
        <div className="bx-hint" style={{ textAlign: 'left', marginTop: 12 }}>Your deletion request was completed on {day(current.completed_at)}.</div>
      ) : null}
    </div>
  );
}

// ── Business verification (KYB) ──────────────────────────────────────────────

interface Person { name: string; role: 'director' | 'owner' | 'director_and_owner'; nationality: string; dateOfBirth: string; ownershipPct: string; isPep: boolean }
interface KybView { id: number; status: string; submitted_at: string; reviewed_at: string | null; reviewer_notes: string | null; documents: { id: number; kind: string; name: string }[] }

const KYB_STATUS: Record<string, [string, 'green' | 'grey' | 'amber']> = {
  submitted: ['Under review', 'amber'], approved: ['Verified', 'green'], rejected: ['Not approved', 'grey'], more_info: ['More information needed', 'amber'],
};
const DOC_LABEL: Record<string, string> = {
  certificate_of_incorporation: 'Certificate of incorporation', company_register_extract: 'Company register extract', proof_of_address: 'Proof of business address',
  director_id: "A director's ID", owner_id: "An owner's ID", ownership_structure: 'Ownership structure', other: 'Other',
};
const emptyPerson = (): Person => ({ name: '', role: 'director_and_owner', nationality: '', dateOfBirth: '', ownershipPct: '', isPep: false });

export function BusinessVerificationCard({ organisationId, isAdmin }: { organisationId: number; isAdmin: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['records-kyb', organisationId], enabled: isAdmin, queryFn: () => api<{ submission: KybView | null }>(`/api/records/kyb/${organisationId}`) });
  const [editing, setEditing] = useState(false);
  const [company, setCompany] = useState({ legalName: '', registrationNumber: '', country: '', incorporationDate: '', registeredAddress: '', businessActivity: '', sourceOfFunds: '', website: '' });
  const [people, setPeople] = useState<Person[]>([emptyPerson()]);
  const [busy, setBusy] = useState(false);
  const [docKind, setDocKind] = useState('certificate_of_incorporation');
  const sub = status.data?.submission;

  if (!isAdmin) return null;
  const set = (k: keyof typeof company) => (e: { target: { value: string } }) => setCompany({ ...company, [k]: e.target.value });
  const setP = (i: number, patch: Partial<Person>) => setPeople(people.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function submit() {
    setBusy(true);
    try {
      await api(`/api/records/kyb/${organisationId}`, { company, people: people.map((p) => ({ ...p, ownershipPct: p.ownershipPct === '' ? undefined : Number(p.ownershipPct) })) });
      toast({ title: 'Details sent', description: 'Now upload the documents below. We will review them and let you know.' });
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['records-kyb', organisationId] });
    } catch (e) {
      toast({ title: 'Not sent', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }

  async function upload(file: File) {
    if (!sub) return;
    if (file.size > 5 * 1024 * 1024) { toast({ title: 'File too large', description: 'Files must be under 5 MB.', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = () => reject(new Error('Could not read the file'));
        r.readAsDataURL(file);
      });
      await api(`/api/records/kyb/${organisationId}/${sub.id}/documents`, { kind: docKind, name: file.name, type: file.type, data });
      void qc.invalidateQueries({ queryKey: ['records-kyb', organisationId] });
    } catch (e) {
      toast({ title: 'Not uploaded', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }

  const [label, tone] = sub ? KYB_STATUS[sub.status] ?? [sub.status, 'grey'] : ['Not started', 'grey' as const];
  return (
    <div className="bx-card">
      <div className="bx-card-h">
        <div><h2>Business verification</h2><div className="sub">We verify every business before it can trade larger amounts: the company, its directors and anyone who owns 25% or more.</div></div>
        <Tag tone={tone}>{label}</Tag>
      </div>
      {sub && !editing && (
        <>
          <div className="bx-sums">
            <Sum l="Sent" v={day(sub.submitted_at)} />
            {sub.reviewed_at && <Sum l="Reviewed" v={day(sub.reviewed_at)} />}
            {sub.reviewer_notes && <Sum l="Our note" v={sub.reviewer_notes} />}
          </div>
          {sub.status !== 'approved' && (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <div className="bx-label" style={{ margin: 0 }}>Documents ({sub.documents.length})</div>
              {sub.documents.map((d) => <div key={d.id} style={{ fontSize: 12 }}>{DOC_LABEL[d.kind] ?? d.kind}: {d.name}</div>)}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select className="bx-select" style={{ width: 'auto' }} value={docKind} onChange={(e) => setDocKind(e.target.value)}>
                  {Object.entries(DOC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <label className="bx-btn ghost small" style={{ cursor: busy ? 'wait' : 'pointer' }}>
                  {busy ? <Spin /> : null} Upload a PDF or photo
                  <input type="file" accept="application/pdf,image/png,image/jpeg" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
                </label>
              </div>
              {(sub.status === 'rejected' || sub.status === 'more_info') && <button className="bx-btn ghost small" style={{ justifySelf: 'start' }} onClick={() => setEditing(true)}>Send updated details</button>}
            </div>
          )}
        </>
      )}
      {(!sub || editing) && (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <div className="bx-strike-in">
            <label className="bx-field" style={{ margin: 0 }}><span>Legal name</span><input className="bx-input" value={company.legalName} onChange={set('legalName')} /></label>
            <label className="bx-field" style={{ margin: 0 }}><span>Registration number</span><input className="bx-input" value={company.registrationNumber} onChange={set('registrationNumber')} /></label>
          </div>
          <div className="bx-strike-in">
            <label className="bx-field" style={{ margin: 0 }}><span>Country of registration</span><input className="bx-input" value={company.country} onChange={set('country')} placeholder="e.g. Ghana" /></label>
            <label className="bx-field" style={{ margin: 0 }}><span>Date of incorporation</span><input className="bx-input" type="date" value={company.incorporationDate} onChange={set('incorporationDate')} /></label>
          </div>
          <label className="bx-field" style={{ margin: 0 }}><span>Registered address</span><input className="bx-input" value={company.registeredAddress} onChange={set('registeredAddress')} /></label>
          <label className="bx-field" style={{ margin: 0 }}><span>What the business does</span><input className="bx-input" value={company.businessActivity} onChange={set('businessActivity')} placeholder="e.g. Imports machinery from China" /></label>
          <label className="bx-field" style={{ margin: 0 }}><span>Where the business's money comes from</span><input className="bx-input" value={company.sourceOfFunds} onChange={set('sourceOfFunds')} placeholder="e.g. Sales revenue" /></label>
          <label className="bx-field" style={{ margin: 0 }}><span>Website (optional)</span><input className="bx-input" value={company.website} onChange={set('website')} /></label>

          <div className="bx-label" style={{ margin: '6px 0 0' }}>Directors and owners of 25% or more</div>
          {people.map((p, i) => (
            <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, display: 'grid', gap: 8 }}>
              <div className="bx-strike-in">
                <label className="bx-field" style={{ margin: 0 }}><span>Full name</span><input className="bx-input" value={p.name} onChange={(e) => setP(i, { name: e.target.value })} /></label>
                <label className="bx-field" style={{ margin: 0 }}><span>Role</span>
                  <select className="bx-select" value={p.role} onChange={(e) => setP(i, { role: e.target.value as Person['role'] })}>
                    <option value="director_and_owner">Director and owner</option><option value="director">Director</option><option value="owner">Owner</option>
                  </select>
                </label>
              </div>
              <div className="bx-strike-in">
                <label className="bx-field" style={{ margin: 0 }}><span>Nationality</span><input className="bx-input" value={p.nationality} onChange={(e) => setP(i, { nationality: e.target.value })} /></label>
                <label className="bx-field" style={{ margin: 0 }}><span>Date of birth</span><input className="bx-input" type="date" value={p.dateOfBirth} onChange={(e) => setP(i, { dateOfBirth: e.target.value })} /></label>
              </div>
              {p.role !== 'director' && <label className="bx-field" style={{ margin: 0 }}><span>Ownership (%)</span><input className="bx-input num" inputMode="decimal" value={p.ownershipPct} onChange={(e) => setP(i, { ownershipPct: e.target.value.replace(/[^0-9.]/g, '') })} /></label>}
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <input type="checkbox" checked={p.isPep} onChange={(e) => setP(i, { isPep: e.target.checked })} />
                This person holds, or has held, a prominent public position, or is a close relative of someone who does
              </label>
              {people.length > 1 && <button className="bx-link" style={{ justifySelf: 'start', fontSize: 12 }} onClick={() => setPeople(people.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          ))}
          <button className="bx-btn ghost small" style={{ justifySelf: 'start' }} onClick={() => setPeople([...people, emptyPerson()])}>Add another person</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="bx-btn" disabled={busy} onClick={submit}>{busy ? <Spin /> : null} Send for verification</button>
            {editing && <button className="bx-btn ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </div>
      )}
    </div>
  );
}
