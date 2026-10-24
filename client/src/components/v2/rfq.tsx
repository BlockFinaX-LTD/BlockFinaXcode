/**
 * Request a quote. Businesses ask approved underwriters for cover no pool sells; underwriters
 * answer with firm offers; the business accepts one and buys it with their passkey.
 * Server side: server/rfq.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { ProtectionQuote } from '@shared/domain/types';
import { api, signStellarForLater } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import { ccyName, endsAt, exposureLabel, fmt, fmtRate, signAndSend, type Direction } from './shared';
import { Loading, Note, Spin, Sum, Tag } from './ui';

const MIN_REQUEST = 5_000;

export interface RequestDraft {
  pair: string;
  direction: Direction;
  notional?: string;
  tenorDays?: number;
  strike?: number | null;
  cap?: number | null;
  reason?: string;
}

interface Offer { id: string; label: string; strike: string; cap: string; spot: string; premium: string; maxPayout: string; validUntil: string; status: string; live: boolean; error: string | null }
interface MyRequest { id: string; pair: string; direction: Direction; notional: string; tenorDays: number; strike: string | null; cap: string | null; maxPremium: string | null; status: string; createdAt: string; expiresAt: string; offers: Offer[] }

const until = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// ── Businesses: the request form ─────────────────────────────────────────────

/** "Request a quote", opened from Protect or Markets. */
export function RequestQuoteModal({ draft, pairs, onClose }: { draft: RequestDraft; pairs: string[]; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pair, setPair] = useState(draft.pair);
  const [direction, setDirection] = useState<Direction>(draft.direction);
  const [notional, setNotional] = useState(String(Math.max(Number(draft.notional ?? 0), MIN_REQUEST)));
  const [days, setDays] = useState(String(draft.tenorDays ?? 30));
  const [strike, setStrike] = useState(draft.strike ? draft.strike.toFixed(4) : '');
  const [cap, setCap] = useState(draft.cap ? draft.cap.toFixed(4) : '');
  const [maxPremium, setMaxPremium] = useState('');
  const [busy, setBusy] = useState(false);
  const d = Number(days);
  const problem = !(Number(notional) >= MIN_REQUEST) ? `Requests start at $${MIN_REQUEST.toLocaleString()} protected`
    : !(Number.isInteger(d) && d >= 1 && d <= 90) ? 'Choose 1 to 90 days' : null;

  async function send() {
    setBusy(true);
    try {
      await api('/api/v2/rfq', {
        pair, direction, notional, tenorDays: d, strike: strike || undefined, cap: cap || undefined, maxPremium: maxPremium || undefined, reason: draft.reason,
      });
      toast({ title: 'Request sent', description: 'Underwriters can now quote. You will get an email for each offer.' });
      void qc.invalidateQueries({ queryKey: ['v2-rfq-mine'] });
      onClose();
    } catch (e) {
      toast({ title: 'Request not sent', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }

  return (
    <div className="bx-modal-bg" onClick={onClose}>
      <div className="bx-modal" role="dialog" aria-label="Request a quote" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Request a quote</h2>
            <div className="sub" style={{ marginTop: 4 }}>Approved underwriters price cover that no pool sells today. You choose whether to accept.</div>
          </div>
          <button className="bx-icon-btn" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        {draft.reason && <div style={{ marginTop: 12 }}><Note>{draft.reason}</Note></div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
          <label className="bx-field">Currency
            <select className="bx-input" value={pair} onChange={(e) => setPair(e.target.value)}>
              {pairs.map((p) => <option key={p} value={p}>{ccyName(p)} ({p})</option>)}
            </select>
          </label>
          <label className="bx-field">Which move worries you
            <select className="bx-input" value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
              <option value="up">{exposureLabel(pair, 'up').cover}</option>
              <option value="down">{exposureLabel(pair, 'down').cover}</option>
            </select>
          </label>
          <label className="bx-field">Amount to protect (USD)
            <input className="bx-input num" inputMode="decimal" value={notional} onChange={(e) => setNotional(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          <label className="bx-field">Duration (days)
            <input className="bx-input num" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label className="bx-field">Protection starts at (optional)
            <input className="bx-input num" inputMode="decimal" placeholder="Rate" value={strike} onChange={(e) => setStrike(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          <label className="bx-field">Maximum rate covered (optional)
            <input className="bx-input num" inputMode="decimal" placeholder="Rate" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          <label className="bx-field" style={{ gridColumn: '1 / -1' }}>Most you would pay (optional, USDC)
            <input className="bx-input num" inputMode="decimal" value={maxPremium} onChange={(e) => setMaxPremium(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
        </div>
        {Number.isInteger(d) && d >= 1 && d <= 90 && <div className="bx-hint" style={{ marginTop: 6 }}>Cover would end {endsAt(d)}.</div>}
        {problem && <p className="bx-error">{problem}</p>}
        <button className="bx-btn block" style={{ marginTop: 14 }} disabled={busy || Boolean(problem)} onClick={send}>{busy ? <Spin /> : null} Send request</button>
        <div className="bx-hint">Your name is not shown to underwriters. Requests stay open for 3 days.</div>
      </div>
    </div>
  );
}

// ── Businesses: requests and offers ─────────────────────────────────────────

export function useMyQuoteRequests() {
  return useQuery({ queryKey: ['v2-rfq-mine'], queryFn: async () => (await api<{ requests: MyRequest[] }>('/api/v2/rfq/mine')).requests, refetchInterval: 30_000 });
}

/** The business's requests and the offers on them, cheapest first. */
export function MyQuoteRequests() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const requests = useMyQuoteRequests();
  const [busy, setBusy] = useState<string | null>(null);
  const shown = (requests.data ?? []).filter((r) => r.status === 'open' || r.offers.some((o) => o.status === 'accepted'));
  if (!shown.length) return null;

  async function accept(r: MyRequest, o: Offer) {
    setBusy(o.id);
    try {
      const { quote } = await api<{ quote: ProtectionQuote }>(`/api/v2/rfq/offers/${o.id}/accept`, {});
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/hedges/prepare', { quote });
      await signAndSend(transactions, () => {});
      await api(`/api/v2/rfq/offers/${o.id}/bought`, {});
      toast({ title: 'Protection placed', description: `${ccyName(r.pair)} cover for $${fmt(r.notional, 0)} is active.` });
      for (const k of ['v2-rfq-mine', 'v2-hedges', 'v2-pools', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast({ title: 'Quote not accepted', description: (e as Error).message, variant: 'destructive' });
      void qc.invalidateQueries({ queryKey: ['v2-rfq-mine'] });
    } finally { setBusy(null); }
  }

  async function cancel(r: MyRequest) {
    await api(`/api/v2/rfq/${r.id}/cancel`, {});
    void qc.invalidateQueries({ queryKey: ['v2-rfq-mine'] });
  }

  return (
    <div className="bx-card">
      <div className="bx-card-h"><div><h2>Your quote requests</h2><div className="sub">Offers from underwriters, cheapest first. Accept one and approve with your passkey.</div></div></div>
      {shown.map((r) => (
        <div key={r.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <b>{ccyName(r.pair)}</b> · {exposureLabel(r.pair, r.direction).cover} · <span className="num">${fmt(r.notional, 0)}</span> · {r.tenorDays} days
              <div className="muted" style={{ fontSize: 12 }}>Open until {until(r.expiresAt)}</div>
            </div>
            {r.status === 'open' && <button className="bx-btn ghost small" onClick={() => cancel(r)}>Cancel request</button>}
          </div>
          {!r.offers.length ? (
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>Waiting for offers. You will get an email when one arrives.</div>
          ) : r.offers.map((o) => (
            <div key={o.id} className="bx-sums" style={{ marginTop: 8 }}>
              <Sum l={o.label} v={o.status === 'accepted' ? <Tag tone="green">Accepted</Tag> : o.live ? <span className="muted">Valid until {until(o.validUntil)}</span> : <Tag tone="grey">{o.status === 'failed' ? 'No longer available' : 'Expired'}</Tag>} />
              <Sum l="Protection starts at" v={<span className="num">{fmtRate(Number(o.strike))}</span>} />
              <Sum l="Maximum rate covered" v={<span className="num">{fmtRate(Number(o.cap))}</span>} />
              <Sum l="Most you can receive" v={<span className="num">${fmt(o.maxPayout)}</span>} />
              <Sum l="Premium" v={<span className="num">${fmt(o.premium)}</span>} />
              {(o.live || o.status === 'accepted') && (
                <button className="bx-btn" style={{ marginTop: 8 }} disabled={busy !== null} onClick={() => accept(r, o)}>
                  {busy === o.id ? <Spin /> : null} {o.status === 'accepted' ? 'Finish buying' : 'Accept and buy'}
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Underwriters ─────────────────────────────────────────────────────────────

interface OpenRequest extends Omit<MyRequest, 'offers'> { myOffer: { status: string; valid_until: string } | null; offerValidSeconds: number }
interface MyOffer { id: string; pair: string; direction: Direction; notional: string; tenorDays: number; strike: string; cap: string; premium: string; maxPayout: string; status: string; validUntil: string; poolId: number | null; error: string | null }

export function UnderwriterRequests() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const open = useQuery({ queryKey: ['v2-rfq-open'], queryFn: () => api<{ approved: boolean; requests: OpenRequest[] }>('/api/v2/rfq/open'), refetchInterval: 30_000 });
  const mine = useQuery({ queryKey: ['v2-rfq-offers'], queryFn: async () => (await api<{ offers: MyOffer[] }>('/api/v2/rfq/offers/mine')).offers, refetchInterval: 30_000 });
  const [answering, setAnswering] = useState<OpenRequest | null>(null);

  async function withdraw(id: string) {
    await api(`/api/v2/rfq/offers/${id}/withdraw`, {});
    for (const k of ['v2-rfq-offers', 'v2-rfq-open']) void qc.invalidateQueries({ queryKey: [k] });
    toast({ title: 'Offer withdrawn' });
  }

  return (
    <main className="bx-main">
      <section className="bx-full">
        <div className="bx-card">
          <div className="bx-card-h"><div><h2>Quote requests</h2><div className="sub">Businesses asking for cover no pool sells today. Your offer is a firm price; your USDC is committed only if the business accepts.</div></div></div>
          {open.isLoading ? <Loading /> : open.data && !open.data.approved ? (
            <Note warn>Your account is not approved to answer requests.</Note>
          ) : !open.data?.requests.length ? (
            <div className="bx-empty"><Inbox /> No open requests right now.</div>
          ) : open.data.requests.map((r) => (
            <div key={r.id} className="bx-li" style={{ gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(0, 1fr)) auto', alignItems: 'center' }}>
              <span><b>{ccyName(r.pair)}</b> · {exposureLabel(r.pair, r.direction).cover}</span>
              <span className="num">${fmt(r.notional, 0)}</span>
              <span>{r.tenorDays} days</span>
              <span className="muted" style={{ fontSize: 12 }}>{r.strike ? `From ${fmtRate(Number(r.strike))}` : 'Strike open'}{r.maxPremium ? ` · up to $${fmt(r.maxPremium)}` : ''}</span>
              <span className="r">{r.myOffer ? <Tag tone="blue">Offer sent</Tag> : <button className="bx-btn small" onClick={() => setAnswering(r)}>Make an offer</button>}</span>
            </div>
          ))}
        </div>
        <div className="bx-card">
          <div className="bx-card-h"><div><h2>Your offers</h2></div></div>
          {!mine.data?.length ? <div className="bx-empty">You have not made any offers yet.</div> : mine.data.map((o) => (
            <div key={o.id} className="bx-li" style={{ gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(0, 1fr)) auto', alignItems: 'center' }}>
              <span><b>{ccyName(o.pair)}</b> · ${fmt(o.notional, 0)} · {o.tenorDays} days</span>
              <span className="num">Premium ${fmt(o.premium)}</span>
              <span className="num">Backs ${fmt(o.maxPayout)}</span>
              <span>{o.status === 'open' ? (Date.parse(o.validUntil) > Date.now() ? <Tag tone="blue">Waiting</Tag> : <Tag tone="grey">Expired</Tag>) : o.status === 'accepted' || o.status === 'bought' ? <Tag tone="green">Accepted</Tag> : <Tag tone="grey">{o.status === 'failed' ? 'Failed' : 'Withdrawn'}</Tag>}</span>
              <span className="r">{o.status === 'open' && Date.parse(o.validUntil) > Date.now() && <button className="bx-btn ghost small" onClick={() => withdraw(o.id)}>Withdraw</button>}</span>
            </div>
          ))}
        </div>
      </section>
      {answering && <OfferModal request={answering} onClose={() => setAnswering(null)} onSent={() => { setAnswering(null); for (const k of ['v2-rfq-offers', 'v2-rfq-open']) void qc.invalidateQueries({ queryKey: [k] }); }} />}
    </main>
  );
}

function OfferModal({ request: r, onClose, onSent }: { request: OpenRequest; onClose: () => void; onSent: () => void }) {
  const { toast } = useToast();
  const [strike, setStrike] = useState(r.strike ?? '');
  const [cap, setCap] = useState(r.cap ?? '');
  const [premium, setPremium] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const hours = r.offerValidSeconds / 3600;

  async function send() {
    setBusy('Preparing...');
    try {
      const prep = await api<{ id: string; transaction: PreparedTransaction; maxPayout: string; creationFee: string }>(`/api/v2/rfq/${r.id}/offers/prepare`, { strike, cap, premium });
      const payload = prep.transaction.payload as { xdr: string };
      const signedXdr = await signStellarForLater(prep.transaction.chain, payload.xdr, (m) => setBusy(m));
      await api(`/api/v2/rfq/offers/${prep.id}/submit`, { signedXdr });
      toast({ title: 'Offer sent', description: `If accepted, $${fmt(prep.maxPayout)} plus the $${fmt(prep.creationFee)} pool fee is committed from your wallet.` });
      onSent();
    } catch (e) {
      toast({ title: 'Offer not sent', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  return (
    <div className="bx-modal-bg" onClick={onClose}>
      <div className="bx-modal" role="dialog" aria-label="Make an offer" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div><h2 style={{ margin: 0 }}>Make an offer</h2><div className="sub" style={{ marginTop: 4 }}>{ccyName(r.pair)} · {exposureLabel(r.pair, r.direction).cover} · ${fmt(r.notional, 0)} · {r.tenorDays} days</div></div>
          <button className="bx-icon-btn" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
          <label className="bx-field">Protection starts at
            <input className="bx-input num" inputMode="decimal" value={strike} onChange={(e) => setStrike(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          <label className="bx-field">Maximum rate covered
            <input className="bx-input num" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          <label className="bx-field" style={{ gridColumn: '1 / -1' }}>Your premium (USDC)
            <input className="bx-input num" inputMode="decimal" value={premium} onChange={(e) => setPremium(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
        </div>
        {r.maxPremium && <div className="bx-hint">The business would pay up to ${fmt(r.maxPremium)}.</div>}
        <div style={{ marginTop: 12 }}><Note>Valid for {hours >= 24 ? '24 hours' : `${hours} hour${hours === 1 ? '' : 's'}`}. Nothing leaves your wallet now. If the business accepts, a private pool with these terms is created from your USDC, holding the most the cover can pay, plus the pool fee.</Note></div>
        <button className="bx-btn block" style={{ marginTop: 14 }} disabled={busy !== null || !(Number(strike) > 0 && Number(cap) > 0 && Number(premium) > 0)} onClick={send}>{busy ? <><Spin /> {busy}</> : 'Approve and send offer'}</button>
      </div>
    </div>
  );
}
