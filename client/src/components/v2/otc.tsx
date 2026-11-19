/**
 * OTC: buy or sell USDC for local currency with approved merchants, with the USDC held in
 * escrow on Stellar until the person paid in local currency confirms it arrived. Payment is
 * by bank transfer or mobile money; the payer uploads proof and marks the order paid.
 * When no offer suits, a user requests a quote and merchants answer with a price.
 * Server side: server/otc. Contract: blockfinax-stellar contracts/otc-escrow.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Clock, Copy, FileText, Inbox, MessageSquarePlus, Plus, Send, ShieldCheck, Store, Trash2, Upload, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api, storedSessionToken } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import { useActingOrganisation } from '@/lib/use-acting-organisation';
import {
  localAmount, MAX_PROOF_BYTES, methodLabel, MIN_REQUEST_USDC, MOMO_PROVIDERS, OTC_CURRENCIES, OTC_CURRENCY_NAMES, parsePaymentMethod, PROOF_TYPES, STATUS_LABEL,
  type OtcCurrency, type OtcStatus, type PaymentMethod,
} from '@shared/otc';
import { fmt, signAndSend } from './shared';
import { Flag, Loading, Note, Spin, Sum, Tag } from './ui';

type Tab = 'buy' | 'sell' | 'orders' | 'merchant';

/**
 * What the account in use may do. Personal accounts and business admins: everything.
 * Business operators: buy USDC. Viewers: look. The server and the chain enforce the same.
 */
function useOtcRole() {
  const org = useActingOrganisation();
  const role = org ? org.role : 'personal';
  return {
    org,
    key: org ? `org-${org.id}` : 'me',
    canBuy: role !== 'viewer',
    canSell: role === 'personal' || role === 'admin',
    canRelease: role === 'personal' || role === 'admin',
    canMerchant: role === 'personal' || role === 'admin',
    role,
  };
}

interface MarketOffer { id: number; merchantName: string; completedTrades: number; side: 'sell' | 'buy'; currency: string; rate: string; available: string; minOrder: string; maxOrder: string; methods: string[] }
interface Quote { id: number; offerId: number | null; merchantName: string; rate: string; status: string; localAmount: string; methods: string[] }
interface MyRequest { id: number; side: 'buy' | 'sell'; currency: string; amount: string; methodType: 'bank' | 'momo' | 'any'; note: string | null; status: string; createdAt: string; expiresAt: string; quotes: Quote[] }
interface OpenRequest extends Omit<MyRequest, 'quotes'> { myQuote: { id: number; rate: string; status: string } | null }
interface Order {
  id: number; offerId: number; side: 'sell' | 'buy'; currency: string; rate: string; amount: string; localAmount: string; feeBps: number;
  status: OtcStatus; openedAt: string; payBy: string; paidAt: string | null; merchant: { wallet: string; name: string };
  payTo: PaymentMethod | null; hasProof: boolean; dispute: { reason: string; openedBy: string; outcome: string | null; note: string | null } | null;
  me?: { releases: boolean; pays: boolean; isMerchant: boolean };
}
interface Merchant { userId: number; wallet: string; displayName: string; about: string | null; markets: OtcCurrency[]; paymentDetails: Record<string, PaymentMethod[]>; status: 'pending' | 'approved' | 'declined' | 'removed'; note: string | null }
interface MyOffer { id: number; side: 'sell' | 'buy'; currency: string; rate: string; available: string; minOrder: string; maxOrder: string; active: boolean; quoteFor: string | null }

const pairOf = (c: string) => `USD/${c}`;
const money = (v: string | number, c: string) => `${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 })} ${c}`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const STATUS_TONE: Record<OtcStatus, 'green' | 'blue' | 'grey' | 'amber'> = {
  open: 'amber', paid: 'blue', released: 'green', cancelled: 'grey', disputed: 'amber', resolved_released: 'green', resolved_refunded: 'grey',
};

/** Send prepared escrow transactions with the passkey, wait until they land, then tell the server. */
async function runOtc(transactions: PreparedTransaction[], onStep: (m: string) => void, touched: { offerId?: number; orderId?: number; opened?: boolean }) {
  const hash = await signAndSend(transactions, onStep);
  const chain = transactions[transactions.length - 1]?.chain;
  onStep('Waiting for the network...');
  for (let i = 0; i < 20 && chain && hash; i++) {
    const st = await api<{ state: string }>(`/api/v2/transactions/${chain}/${hash}`).catch(() => ({ state: 'SUBMITTED' }));
    if (st.state === 'CONFIRMED') break;
    if (st.state === 'FAILED') throw new Error('The network did not accept this step');
    await new Promise((ok) => setTimeout(ok, 1_500));
  }
  return api<{ openedOrderId: number | null }>('/api/v2/otc/sync', touched);
}

function useSpot(currency: string) {
  return useQuery({
    queryKey: ['v2-spot', pairOf(currency)],
    queryFn: async () => Number((await api<{ spot: string }>(`/api/v2/spot?pair=${encodeURIComponent(pairOf(currency))}`)).spot),
    refetchInterval: 60_000, retry: false,
  });
}

export function OtcPage() {
  const r = useOtcRole();
  const [tab, setTab] = useState<Tab>('buy');
  const [openOrder, setOpenOrder] = useState<number | null>(null);
  useEffect(() => { setOpenOrder(null); }, [r.key]);
  if (openOrder !== null) return <OrderDetail id={openOrder} onBack={() => setOpenOrder(null)} />;
  return (
    <main className="bx-main">
      <section className="bx-full">
        <div className="bx-card">
          <div className="bx-card-h">
            <div>
              <h2>OTC</h2>
              <div className="sub">Buy or sell USDC for Naira, Cedi, Shillings, Rand or Egyptian pounds with approved merchants. The USDC stays in escrow on Stellar until the money arrives.</div>
              {r.org && <div className="sub" style={{ marginTop: 4 }}>Trading for <b>{r.org.name}</b> as {r.role === 'admin' ? 'an admin' : r.role === 'operator' ? 'an operator: you can buy USDC, and an admin sells or releases it' : 'a viewer: you can see orders but not trade'}.</div>}
            </div>
          </div>
          <div className="bx-seg" role="tablist" style={{ marginTop: 6 }}>
            {([['buy', 'Buy USDC'], ['sell', 'Sell USDC'], ['orders', 'My orders'], ['merchant', 'Merchant']] as [Tab, string][]).map(([t, l]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>
            ))}
          </div>
        </div>
        {(tab === 'buy' || tab === 'sell') && <MyRequests key={`req-${tab}-${r.key}`} side={tab} onOpened={setOpenOrder} />}
        {(tab === 'buy' || tab === 'sell') && <Market key={`${tab}-${r.key}`} side={tab} onOpened={setOpenOrder} />}
        {tab === 'orders' && <MyOrders onOpen={setOpenOrder} />}
        {tab === 'merchant' && (r.canMerchant ? <MerchantArea key={r.key} onOpen={setOpenOrder} /> : <div className="bx-card"><Note>Only an admin of {r.org?.name ?? 'this business'} can run it as a merchant.</Note></div>)}
      </section>
    </main>
  );
}

// ── Payment methods ─────────────────────────────────────────────────────────

const EMPTY_BANK: PaymentMethod = { type: 'bank', bankName: '', accountNumber: '', accountName: '' };
const emptyMomo = (c: string): PaymentMethod => ({ type: 'momo', provider: MOMO_PROVIDERS[c as OtcCurrency]?.[0] ?? '', phone: '', accountName: '' });

/** Bank transfer or mobile money, in set fields. */
function MethodForm({ currency, value, onChange }: { currency: string; value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  const providers = MOMO_PROVIDERS[currency as OtcCurrency] ?? [];
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="bx-seg small">
        <button type="button" className={value.type === 'bank' ? 'on' : ''} onClick={() => onChange(EMPTY_BANK)}>Bank transfer</button>
        <button type="button" className={value.type === 'momo' ? 'on' : ''} disabled={!providers.length} onClick={() => onChange(emptyMomo(currency))}>Mobile money</button>
      </div>
      {value.type === 'bank' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="bx-field">Bank<input className="bx-input" value={value.bankName} placeholder="GTBank" onChange={(e) => onChange({ ...value, bankName: e.target.value })} /></label>
          <label className="bx-field">Account number<input className="bx-input num" inputMode="numeric" value={value.accountNumber} onChange={(e) => onChange({ ...value, accountNumber: e.target.value })} /></label>
          <label className="bx-field" style={{ gridColumn: '1 / -1' }}>Name on the account<input className="bx-input" value={value.accountName} onChange={(e) => onChange({ ...value, accountName: e.target.value })} /></label>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="bx-field">Provider
            <select className="bx-input" value={value.provider} onChange={(e) => onChange({ ...value, provider: e.target.value })}>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="bx-field">Mobile money number<input className="bx-input num" inputMode="tel" value={value.phone} placeholder="+233..." onChange={(e) => onChange({ ...value, phone: e.target.value })} /></label>
          <label className="bx-field" style={{ gridColumn: '1 / -1' }}>Name on the account<input className="bx-input" value={value.accountName} onChange={(e) => onChange({ ...value, accountName: e.target.value })} /></label>
        </div>
      )}
    </div>
  );
}

const methodProblem = (m: PaymentMethod) => { try { parsePaymentMethod(m); return null; } catch (e) { return (e as Error).message; } };

function CopyLine({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <b className="num" style={{ userSelect: 'all' }}>{value}</b>
        <button className="bx-icon-btn" aria-label={`Copy ${label}`} onClick={() => { void navigator.clipboard?.writeText(value); toast({ title: `${label} copied` }); }}><Copy style={{ width: 14 }} /></button>
      </span>
    </div>
  );
}

/** Where to send the money, each part copyable. */
function MethodCard({ m, amount }: { m: PaymentMethod; amount?: string }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '6px 12px' }}>
      <div style={{ fontWeight: 600, fontSize: 13, padding: '4px 0' }}>{methodLabel(m)}</div>
      {amount && <CopyLine label="Amount" value={amount} />}
      {m.type === 'bank' ? (
        <>
          <CopyLine label="Bank" value={m.bankName} />
          <CopyLine label="Account number" value={m.accountNumber} />
          <CopyLine label="Account name" value={m.accountName} />
        </>
      ) : (
        <>
          <CopyLine label="Provider" value={m.provider} />
          <CopyLine label="Number" value={m.phone} />
          <CopyLine label="Name" value={m.accountName} />
        </>
      )}
    </div>
  );
}

// ── Requests for a quote ────────────────────────────────────────────────────

function RequestModal({ side, currency: start, onClose }: { side: 'buy' | 'sell'; currency: OtcCurrency; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [currency, setCurrency] = useState<OtcCurrency>(start);
  const [amount, setAmount] = useState('500');
  const [methodType, setMethodType] = useState<'bank' | 'momo' | 'any'>('any');
  const [payee, setPayee] = useState<PaymentMethod>(EMPTY_BANK);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const spot = useSpot(currency);
  const problem = !(Number(amount) >= MIN_REQUEST_USDC) ? `Requests start at ${MIN_REQUEST_USDC} USDC` : side === 'sell' ? methodProblem(payee) : null;

  async function send() {
    setBusy(true);
    try {
      await api('/api/v2/otc/requests', { side, currency, amount, methodType: side === 'sell' ? payee.type : methodType, payee: side === 'sell' ? payee : undefined, note });
      toast({ title: 'Request sent', description: 'Approved merchants can now quote. We email you when a quote arrives.' });
      void qc.invalidateQueries({ queryKey: ['v2-otc-requests'] });
      onClose();
    } catch (e) {
      toast({ title: 'Request not sent', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }

  return (
    <div className="bx-modal-bg" onClick={onClose}>
      <div className="bx-modal" role="dialog" aria-label="Request a quote" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div><h2 style={{ margin: 0 }}>Request a quote to {side} USDC</h2><div className="sub" style={{ marginTop: 4 }}>Approved merchants send you a price. Nothing is locked until you accept one.</div></div>
          <button className="bx-icon-btn" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
          <label className="bx-field">Currency
            <select className="bx-input" value={currency} onChange={(e) => setCurrency(e.target.value as OtcCurrency)}>
              {OTC_CURRENCIES.map((c) => <option key={c} value={c}>{OTC_CURRENCY_NAMES[c]} ({c})</option>)}
            </select>
          </label>
          <label className="bx-field">Amount (USDC)
            <input className="bx-input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
        </div>
        {spot.data && Number(amount) > 0 ? <div className="bx-hint">About {money(Number(amount) * spot.data, currency)} at today's market rate.</div> : null}
        {side === 'buy' ? (
          <label className="bx-field" style={{ marginTop: 10 }}>How you want to pay
            <select className="bx-input" value={methodType} onChange={(e) => setMethodType(e.target.value as 'bank' | 'momo' | 'any')}>
              <option value="any">Bank transfer or mobile money</option>
              <option value="bank">Bank transfer</option>
              <option value="momo">Mobile money</option>
            </select>
          </label>
        ) : (
          <div className="bx-field" style={{ marginTop: 10 }}>Where the merchant pays you
            <MethodForm currency={currency} value={payee} onChange={setPayee} />
          </div>
        )}
        <label className="bx-field" style={{ marginTop: 10 }}>Note for merchants (optional)
          <input className="bx-input" value={note} placeholder="For example: needed by Friday" onChange={(e) => setNote(e.target.value)} />
        </label>
        {problem && <p className="bx-error">{problem}</p>}
        <button className="bx-btn block" style={{ marginTop: 14 }} disabled={busy || Boolean(problem)} onClick={send}>{busy ? <Spin /> : null} Send request</button>
        <div className="bx-hint">Your request stays open for 24 hours. Merchants do not see who you are.</div>
      </div>
    </div>
  );
}

/** The user's requests and the quotes on them; accepting one opens the order. */
function MyRequests({ side, onOpened }: { side: 'buy' | 'sell'; onOpened: (id: number) => void }) {
  const r = useOtcRole();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['v2-otc-requests', r.key], queryFn: async () => (await api<{ requests: MyRequest[] }>('/api/v2/otc/requests')).requests, refetchInterval: 20_000 });
  const [taking, setTaking] = useState<{ request: MyRequest; quote: Quote } | null>(null);
  const shown = (q.data ?? []).filter((x) => x.side === side && x.status === 'open');
  if (!shown.length) return null;
  return (
    <div className="bx-card">
      <div className="bx-card-h"><div><h2>Your requests</h2><div className="sub">Quotes from merchants, best price first. Accept one to open the order.</div></div></div>
      {shown.map((x) => (
        <div key={x.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div><b>{x.side === 'buy' ? 'Buy' : 'Sell'} {fmt(x.amount)} USDC for {x.currency}</b><div className="muted" style={{ fontSize: 12 }}>Open until {when(x.expiresAt)}{x.methodType !== 'any' ? ` · ${x.methodType === 'bank' ? 'bank transfer' : 'mobile money'}` : ''}</div></div>
            <button className="bx-btn ghost small" onClick={async () => { await api(`/api/v2/otc/requests/${x.id}/cancel`, {}); void qc.invalidateQueries({ queryKey: ['v2-otc-requests'] }); }}>Cancel request</button>
          </div>
          {!x.quotes.length ? <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>Waiting for quotes. We email you when one arrives.</div> : x.quotes.map((qt) => (
            <div key={qt.id} className="bx-li" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1.4fr) minmax(0,1.6fr) auto', alignItems: 'center' }}>
              <span><b>{qt.merchantName}</b>{qt.methods.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{qt.methods.join(', ')}</div>}</span>
              <span className="num">{money(qt.rate, x.currency)} per USDC</span>
              <span className="num">{x.side === 'buy' ? 'You pay' : 'You receive'} {money(qt.localAmount, x.currency)}</span>
              <span className="r"><button className="bx-btn small" disabled={!qt.offerId || (x.side === 'buy' ? !r.canBuy : !r.canSell)} onClick={() => setTaking({ request: x, quote: qt })}>Accept</button></span>
            </div>
          ))}
        </div>
      ))}
      {taking && taking.quote.offerId && (
        <TradeModal
          offer={{ id: taking.quote.offerId, merchantName: taking.quote.merchantName, completedTrades: 0, side: taking.request.side === 'buy' ? 'sell' : 'buy', currency: taking.request.currency, rate: taking.quote.rate, available: taking.request.amount, minOrder: taking.request.amount, maxOrder: taking.request.amount, methods: taking.quote.methods }}
          fromQuote
          onClose={() => setTaking(null)}
          onOpened={(id) => { setTaking(null); onOpened(id); }}
        />
      )}
    </div>
  );
}

// ── Market ──────────────────────────────────────────────────────────────────

function Market({ side, onOpened }: { side: 'buy' | 'sell'; onOpened: (id: number) => void }) {
  const r = useOtcRole();
  const allowed = side === 'buy' ? r.canBuy : r.canSell;
  const [currency, setCurrency] = useState<OtcCurrency>('NGN');
  const [taking, setTaking] = useState<MarketOffer | null>(null);
  const [requesting, setRequesting] = useState(false);
  const spot = useSpot(currency);
  const offers = useQuery({
    queryKey: ['v2-otc-market', currency, side, r.key],
    queryFn: async () => (await api<{ offers: MarketOffer[] }>(`/api/v2/otc/market?currency=${currency}&side=${side}`)).offers,
    refetchInterval: 20_000,
  });
  const vsMarket = (rate: string) => {
    if (!spot.data) return null;
    const pct = (Number(rate) / spot.data - 1) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% vs market`;
  };
  return (
    <div className="bx-card">
      <div className="bx-card-h">
        <div>
          <h2>{side === 'buy' ? 'Buy USDC' : 'Sell USDC'}</h2>
          <div className="sub">{side === 'buy'
            ? 'Pay the merchant in local currency. Their USDC is already locked in escrow and comes to you when they confirm your payment.'
            : 'Lock your USDC in escrow. The merchant pays you in local currency, and you release the USDC once it has arrived.'}</div>
        </div>
        <button className="bx-btn ghost small" disabled={!allowed} onClick={() => setRequesting(true)}><MessageSquarePlus style={{ width: 14 }} /> Request a quote</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {OTC_CURRENCIES.map((c) => (
          <button key={c} className={`bx-chip${c === currency ? ' on' : ''}`} onClick={() => setCurrency(c)}><Flag pair={pairOf(c)} /> {c}</button>
        ))}
      </div>
      {!allowed && <div style={{ marginBottom: 8 }}><Note warn>{r.role === 'viewer' ? 'Viewers can see offers but cannot trade.' : `Only an admin can sell ${r.org?.name ?? 'the business'}'s USDC.`}</Note></div>}
      {spot.data ? <div className="bx-hint" style={{ marginBottom: 8 }}>Market rate today: <span className="num">{money(spot.data, currency)}</span> per USD</div> : null}
      {offers.isLoading ? <Loading /> : !offers.data?.length ? (
        <div className="bx-empty" style={{ display: 'grid', justifyItems: 'center', gap: 10 }}>
          <span><Store /> No {OTC_CURRENCY_NAMES[currency]} offers right now.</span>
          <button className="bx-btn" disabled={!allowed} onClick={() => setRequesting(true)}><MessageSquarePlus style={{ width: 14 }} /> Request a quote from merchants</button>
        </div>
      ) : (
        <>
          <div className="bx-li bx-list-h" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.4fr) auto' }}>
            <span>Merchant</span><span>Price per USDC</span><span>Available</span><span>Limits</span><span />
          </div>
          {offers.data.map((o) => (
            <div key={o.id} className="bx-li" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.4fr) auto', alignItems: 'center' }}>
              <span><b>{o.merchantName}</b><div className="muted" style={{ fontSize: 12 }}>{o.completedTrades} completed trade{o.completedTrades === 1 ? '' : 's'}{o.methods.length ? ` · ${o.methods.join(', ')}` : ''}</div></span>
              <span className="num">{money(o.rate, currency)}<div className="muted" style={{ fontSize: 12 }}>{vsMarket(o.rate)}</div></span>
              <span className="num">{fmt(o.available)} USDC</span>
              <span className="num">{fmt(o.minOrder)} to {fmt(o.maxOrder)} USDC</span>
              <span className="r"><button className="bx-btn small" disabled={!allowed} onClick={() => setTaking(o)}>{side === 'buy' ? 'Buy' : 'Sell'}</button></span>
            </div>
          ))}
        </>
      )}
      {taking && <TradeModal offer={taking} onClose={() => setTaking(null)} onOpened={(id) => { setTaking(null); onOpened(id); }} />}
      {requesting && <RequestModal side={side} currency={currency} onClose={() => setRequesting(false)} />}
    </div>
  );
}

function TradeModal({ offer, onClose, onOpened, fromQuote }: { offer: MarketOffer; onClose: () => void; onOpened: (id: number) => void; fromQuote?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const userBuys = offer.side === 'sell';
  const max = Math.min(Number(offer.maxOrder), Number(offer.available));
  const [amount, setAmount] = useState(String(Math.min(max, Math.max(Number(offer.minOrder), 100))));
  const [payee, setPayee] = useState<PaymentMethod>(EMPTY_BANK);
  const [methodIndex, setMethodIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const n = Number(amount);
  const needsPayee = !userBuys && !fromQuote;
  const problem = !(n >= Number(offer.minOrder) && n <= max) ? `Enter ${fmt(offer.minOrder)} to ${fmt(max)} USDC`
    : needsPayee ? methodProblem(payee) : null;
  const local = n > 0 ? localAmount(String(n), offer.rate) : '0';

  async function go() {
    setBusy('Preparing...');
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/otc/orders/prepare', { offerId: offer.id, amount, methodIndex: userBuys ? methodIndex : undefined, payee: needsPayee ? payee : undefined });
      const out = await runOtc(transactions, setBusy, { opened: true });
      for (const k of ['v2-otc-market', 'v2-otc-orders', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
      toast({ title: 'Order opened', description: userBuys ? 'Pay the merchant within 30 minutes, then mark the order paid.' : 'Your USDC is in escrow. The merchant will pay you and mark the order paid.' });
      if (out.openedOrderId) onOpened(out.openedOrderId); else onClose();
    } catch (e) {
      toast({ title: 'Order not opened', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  return (
    <div className="bx-modal-bg" onClick={onClose}>
      <div className="bx-modal" role="dialog" aria-label={userBuys ? 'Buy USDC' : 'Sell USDC'} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div><h2 style={{ margin: 0 }}>{userBuys ? 'Buy' : 'Sell'} USDC with {offer.merchantName}</h2><div className="sub" style={{ marginTop: 4 }}>{money(offer.rate, offer.currency)} per USDC</div></div>
          <button className="bx-icon-btn" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        <label className="bx-field" style={{ marginTop: 14 }}>Amount (USDC)
          <input className="bx-input num" inputMode="decimal" value={amount} disabled={fromQuote} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        </label>
        {userBuys && offer.methods.length > 0 && (
          <div className="bx-field" style={{ marginTop: 10 }}>How you will pay
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {offer.methods.map((m, i) => <button key={i} type="button" className={`bx-chip${methodIndex === i ? ' on' : ''}`} onClick={() => setMethodIndex(i)}>{m}</button>)}
            </div>
            <span className="bx-hint">You see the account details once the order is open.</span>
          </div>
        )}
        {needsPayee && (
          <div className="bx-field" style={{ marginTop: 10 }}>Where the merchant pays you
            <MethodForm currency={offer.currency} value={payee} onChange={setPayee} />
          </div>
        )}
        <div className="bx-sums" style={{ marginTop: 12 }}>
          <Sum l={userBuys ? 'You pay' : 'You receive'} v={<span className="num">{money(local, offer.currency)}</span>} total />
          <Sum l={userBuys ? 'You receive' : 'You lock in escrow'} v={<span className="num">{fmt(amount || 0)} USDC</span>} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Note>{userBuys
            ? 'You have 30 minutes to pay by bank transfer or mobile money. Pay from an account in your own name, then upload the receipt or a screenshot and tap I have paid.'
            : 'Your USDC goes into escrow now. Release it only once the money is in your account. Never rely on a screenshot.'}</Note>
        </div>
        {problem && <p className="bx-error">{problem}</p>}
        <button className="bx-btn block" style={{ marginTop: 14 }} disabled={busy !== null || Boolean(problem)} onClick={go}>{busy ? <><Spin /> {busy}</> : userBuys ? 'Open order' : 'Lock USDC and open order'}</button>
      </div>
    </div>
  );
}

// ── Orders ──────────────────────────────────────────────────────────────────

function useMyOrders() {
  const { key } = useOtcRole();
  return useQuery({ queryKey: ['v2-otc-orders', key], queryFn: async () => (await api<{ orders: Order[] }>('/api/v2/otc/orders')).orders, refetchInterval: 20_000 });
}

function OrderRows({ orders, onOpen }: { orders: Order[]; onOpen: (id: number) => void }) {
  return (
    <>
      {orders.map((o) => {
        const userBuys = o.side === 'sell' ? !o.me?.isMerchant : Boolean(o.me?.isMerchant);
        return (
          <button key={o.id} className="bx-li" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1.4fr) minmax(0,1.4fr) minmax(0,1.2fr)', alignItems: 'center', width: '100%', textAlign: 'left' }} onClick={() => onOpen(o.id)}>
            <span><b>{userBuys ? 'Buy' : 'Sell'} {fmt(o.amount)} USDC</b><div className="muted" style={{ fontSize: 12 }}>Order {o.id} · {o.me?.isMerchant ? 'your offer' : o.merchant.name}</div></span>
            <span className="num">{money(o.localAmount, o.currency)}</span>
            <span className="muted" style={{ fontSize: 12 }}>{when(o.openedAt)}</span>
            <span><Tag tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Tag></span>
          </button>
        );
      })}
    </>
  );
}

function MyOrders({ onOpen }: { onOpen: (id: number) => void }) {
  const orders = useMyOrders();
  return (
    <div className="bx-card">
      <div className="bx-card-h"><div><h2>My orders</h2><div className="sub">Every OTC order you are in, as a buyer, a seller or a merchant.</div></div></div>
      {orders.isLoading ? <Loading /> : !orders.data?.length ? <div className="bx-empty"><Inbox /> No orders yet.</div> : <OrderRows orders={orders.data} onOpen={onOpen} />}
    </div>
  );
}

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Date.parse(to) - now);
  const m = Math.floor(left / 60_000), s = Math.floor((left % 60_000) / 1000);
  return <span className="num">{left ? `${m}:${String(s).padStart(2, '0')}` : 'time is up'}</span>;
}

function OrderDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const r = useOtcRole();
  const q = useQuery({ queryKey: ['v2-otc-order', id, r.key], queryFn: async () => (await api<{ order: Order }>(`/api/v2/otc/orders/${id}`)).order, refetchInterval: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const o = q.data;
  const refresh = () => { for (const k of [['v2-otc-order', id], ['v2-otc-orders'], ['v2-otc-market'], ['v2-usdc-all']]) void qc.invalidateQueries({ queryKey: k }); };

  async function step(label: string, path: string, body: unknown = {}) {
    setBusy('Preparing...');
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(path, body);
      await runOtc(transactions, setBusy, { orderId: id });
      toast({ title: label });
      refresh();
      return true;
    } catch (e) {
      toast({ title: 'That did not go through', description: (e as Error).message, variant: 'destructive' });
      return false;
    } finally { setBusy(null); }
  }

  async function markPaid() {
    if (!file) return;
    if (!PROOF_TYPES.includes(file.type) || file.size > MAX_PROOF_BYTES) {
      toast({ title: 'Choose another file', description: 'A photo, screenshot or PDF under 5 MB', variant: 'destructive' });
      return;
    }
    setBusy('Uploading your proof...');
    try {
      const data = await new Promise<string>((ok, fail) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1] ?? '');
        r.onerror = () => fail(new Error('Could not read the file'));
        r.readAsDataURL(file);
      });
      await api(`/api/v2/otc/orders/${id}/proof`, { type: file.type, data });
    } catch (e) {
      setBusy(null);
      toast({ title: 'Proof not uploaded', description: (e as Error).message, variant: 'destructive' });
      return;
    }
    await step('Marked as paid', `/api/v2/otc/orders/${id}/paid/prepare`);
  }

  async function viewProof() {
    const res = await fetch(`/api/v2/otc/orders/${id}/proof`, { headers: { Authorization: `Bearer ${storedSessionToken() ?? ''}` } });
    if (!res.ok) { toast({ title: 'No proof yet', variant: 'destructive' }); return; }
    window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener');
  }

  if (q.isLoading || !o) return <main className="bx-main"><section className="bx-full"><div className="bx-card">{q.error ? <Note warn>{(q.error as Error).message}</Note> : <Loading />}</div></section></main>;
  const seen = o.me ?? { releases: false, pays: false, isMerchant: false };
  // Act only where the role allows; otherwise show what is waiting and who can do it.
  const me = { ...seen, pays: seen.pays && r.canBuy, releases: seen.releases && r.canRelease };
  const waitingForAdmin = seen.releases && !r.canRelease && (o.status === 'paid' || o.status === 'disputed');
  const userBuys = o.side === 'sell' ? !me.isMerchant : me.isMerchant;
  const lapsed = o.status === 'open' && Date.parse(o.payBy) < Date.now();

  return (
    <main className="bx-main">
      <section className="bx-full">
        <div className="bx-card">
          <button className="bx-btn ghost small" onClick={onBack}>Back to OTC</button>
          <div className="bx-card-h" style={{ marginTop: 10 }}>
            <div>
              <h2>{userBuys ? 'Buy' : 'Sell'} {fmt(o.amount)} USDC · order {o.id}</h2>
              <div className="sub">{me.isMerchant ? 'On your offer' : `With ${o.merchant.name}`} · opened {when(o.openedAt)}</div>
            </div>
            <Tag tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Tag>
          </div>
          <div className="bx-sums">
            <Sum l="Local currency" v={<span className="num">{money(o.localAmount, o.currency)}</span>} total />
            <Sum l="Price" v={<span className="num">{money(o.rate, o.currency)} per USDC</span>} />
            <Sum l="USDC in escrow" v={<span className="num">{fmt(o.amount)} USDC</span>} />
            {o.feeBps > 0 && <Sum l="BlockFinaX fee" v={<span className="num">{(o.feeBps / 100).toFixed(2)}% of the USDC</span>} />}
          </div>
        </div>

        {/* The person paying in local currency */}
        {me.pays && o.status === 'open' && !lapsed && (
          <div className="bx-card">
            <div className="bx-card-h"><div><h2><Clock style={{ width: 16, verticalAlign: -2 }} /> Pay {money(o.localAmount, o.currency)}</h2><div className="sub">Time left: <Countdown to={o.payBy} /></div></div></div>
            <ol style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
              <li>Send exactly <b>{money(o.localAmount, o.currency)}</b> by {o.payTo ? methodLabel(o.payTo).toLowerCase() : 'bank transfer or mobile money'} to the account below, from an account in your own name.</li>
              <li>Take a screenshot of the confirmation, or download the receipt.</li>
              <li>Upload it here and tap <b>I have paid</b>.</li>
            </ol>
            {o.payTo ? <MethodCard m={o.payTo} amount={o.localAmount} /> : <Note warn>The account details are missing. Message the other side below.</Note>}
            <div style={{ marginTop: 10 }}><Note>Do not write "USDC" or "crypto" in the payment reference. Only tap I have paid once the money has left your account.</Note></div>
            <label className="bx-field" style={{ marginTop: 12 }}>Proof of payment: receipt, screenshot or PDF (under 5 MB)
              <input type="file" accept={PROOF_TYPES.join(',')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="bx-btn" disabled={busy !== null || !file} onClick={markPaid}>{busy ? <><Spin /> {busy}</> : <><Upload style={{ width: 14 }} /> I have paid</>}</button>
              <button className="bx-btn ghost" disabled={busy !== null} onClick={() => step('Order cancelled', `/api/v2/otc/orders/${id}/cancel/prepare`)}>Cancel order</button>
            </div>
          </div>
        )}

        {/* The person holding the USDC in escrow */}
        {me.releases && (o.status === 'paid' || o.status === 'disputed') && (
          <div className="bx-card">
            <div className="bx-card-h"><div><h2><ShieldCheck style={{ width: 16, verticalAlign: -2 }} /> Check your account, then release</h2><div className="sub">The other side says they paid {money(o.localAmount, o.currency)}.</div></div></div>
            {o.payTo && <div style={{ marginBottom: 10 }}><div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>It should have arrived in:</div><MethodCard m={o.payTo} amount={o.localAmount} /></div>}
            <Note warn>Open your bank or mobile money app and check the money has arrived, from an account in the buyer's name. A screenshot or an email can be faked. Once released, the USDC cannot be taken back.</Note>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="bx-btn" disabled={busy !== null} onClick={() => step('USDC released', `/api/v2/otc/orders/${id}/release/prepare`)}>{busy ? <><Spin /> {busy}</> : 'The money arrived: release USDC'}</button>
              {o.hasProof && <button className="bx-btn ghost" onClick={viewProof}><FileText style={{ width: 14 }} /> See their proof</button>}
            </div>
          </div>
        )}

        {waitingForAdmin && <div className="bx-card"><Note>The other side says they paid {money(o.localAmount, o.currency)}. An admin of {r.org?.name ?? 'the business'} needs to check the account and release the USDC.</Note></div>}

        {me.releases && o.status === 'open' && (
          <div className="bx-card"><Note>{lapsed ? 'The time to pay has run out.' : <>Waiting for the other side to pay. Time left: <Countdown to={o.payBy} /></>}</Note>
            {lapsed && <button className="bx-btn" style={{ marginTop: 10 }} disabled={busy !== null} onClick={() => step('Order cancelled and USDC returned', `/api/v2/otc/orders/${id}/cancel/prepare`)}>{busy ? <><Spin /> {busy}</> : 'Cancel and return the USDC'}</button>}
          </div>
        )}
        {me.pays && lapsed && (
          <div className="bx-card"><Note warn>The time to pay has run out, so this order can no longer be marked paid. If you already paid, message the other side below.</Note>
            <button className="bx-btn ghost" style={{ marginTop: 10 }} disabled={busy !== null} onClick={() => step('Order cancelled', `/api/v2/otc/orders/${id}/cancel/prepare`)}>Cancel order</button>
          </div>
        )}
        {me.pays && o.status === 'paid' && <div className="bx-card"><Note>You marked this paid. The other side is checking their account and will release the USDC.</Note></div>}

        {o.status === 'paid' && r.canBuy && (
          <div className="bx-card">
            {!disputing ? (
              <button className="bx-btn ghost small" onClick={() => setDisputing(true)}>Something is wrong: open a dispute</button>
            ) : (
              <>
                <h3 style={{ marginTop: 0 }}>Open a dispute</h3>
                <div className="sub">BlockFinaX reviews the proof, the messages and any bank records, then releases the USDC or returns it. Nobody else can move it while we look.</div>
                <textarea className="bx-input" rows={3} style={{ marginTop: 8 }} placeholder="What went wrong?" value={reason} onChange={(e) => setReason(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="bx-btn" disabled={busy !== null || reason.trim().length < 10} onClick={async () => { if (await step('Dispute opened', `/api/v2/otc/orders/${id}/dispute/prepare`, { reason })) setDisputing(false); }}>{busy ? <><Spin /> {busy}</> : 'Open dispute'}</button>
                  <button className="bx-btn ghost" onClick={() => setDisputing(false)}>Back</button>
                </div>
              </>
            )}
          </div>
        )}
        {o.dispute && (
          <div className="bx-card">
            <h3 style={{ marginTop: 0 }}>Dispute</h3>
            <p style={{ fontSize: 13 }}>{o.dispute.reason}</p>
            {o.dispute.outcome ? <Note>BlockFinaX {o.dispute.outcome === 'released' ? 'released the USDC' : 'returned the USDC'}. {o.dispute.note}</Note> : <Note>BlockFinaX is reviewing this order.</Note>}
          </div>
        )}
        <Messages orderId={id} canWrite={r.canBuy} />
      </section>
    </main>
  );
}

function Messages({ orderId, canWrite }: { orderId: number; canWrite: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['v2-otc-messages', orderId], queryFn: async () => (await api<{ messages: { id: number; body: string; from: string; mine: boolean; createdAt: string }[] }>(`/api/v2/otc/orders/${orderId}/messages`)).messages, refetchInterval: 10_000 });
  const [text, setText] = useState('');
  async function send() {
    if (!text.trim()) return;
    await api(`/api/v2/otc/orders/${orderId}/messages`, { body: text });
    setText('');
    void qc.invalidateQueries({ queryKey: ['v2-otc-messages', orderId] });
  }
  return (
    <div className="bx-card">
      <div className="bx-card-h"><div><h2>Messages</h2><div className="sub">Seen by both sides and by BlockFinaX if there is a dispute. Never share passwords, codes or your passkey.</div></div></div>
      {(q.data ?? []).map((m) => (
        <div key={m.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
          <div className="muted" style={{ fontSize: 11 }}>{m.mine ? 'You' : m.from} · {when(m.createdAt)}</div>
          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{m.body}</div>
        </div>
      ))}
      {canWrite && <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input className="bx-input" value={text} placeholder="Write a message" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} />
        <button className="bx-btn" aria-label="Send" onClick={send}><Send style={{ width: 14 }} /></button>
      </div>}
    </div>
  );
}

// ── Merchants ───────────────────────────────────────────────────────────────

function MerchantArea({ onOpen }: { onOpen: (id: number) => void }) {
  const { key } = useOtcRole();
  const q = useQuery({ queryKey: ['v2-otc-merchant', key], queryFn: () => api<{ wallet: string; merchant: Merchant | null; offers: MyOffer[] }>('/api/v2/otc/merchant') });
  if (q.isLoading) return <div className="bx-card"><Loading /></div>;
  if (q.error) return <div className="bx-card"><Note warn>{(q.error as Error).message}</Note></div>;
  const m = q.data?.merchant;
  if (!m || m.status === 'declined') return <ApplyForm declined={m?.status === 'declined'} />;
  if (m.status === 'pending') return <div className="bx-card"><Note>Your application to become a merchant is being reviewed. We email you when it is decided.</Note></div>;
  if (m.status === 'removed') return <div className="bx-card"><Note warn>Your merchant access was removed. Your existing offers and orders can still finish. Contact BlockFinaX to talk about it.</Note></div>;
  return <MerchantDesk merchant={m} offers={q.data!.offers} onOpen={onOpen} />;
}

function DetailsFields({ markets, setMarkets, details, setDetails }: { markets: OtcCurrency[]; setMarkets: (m: OtcCurrency[]) => void; details: Record<string, PaymentMethod[]>; setDetails: (d: Record<string, PaymentMethod[]>) => void }) {
  const list = (c: string) => details[c] ?? [];
  const set = (c: string, next: PaymentMethod[]) => setDetails({ ...details, [c]: next });
  return (
    <>
      <div className="bx-field" style={{ marginTop: 10 }}>Currencies you trade
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {OTC_CURRENCIES.map((c) => (
            <button key={c} type="button" className={`bx-chip${markets.includes(c) ? ' on' : ''}`} onClick={() => setMarkets(markets.includes(c) ? markets.filter((x) => x !== c) : [...markets, c])}><Flag pair={pairOf(c)} /> {c}</button>
          ))}
        </div>
      </div>
      {markets.map((c) => (
        <div key={c} className="bx-field" style={{ marginTop: 12 }}>
          <span>{OTC_CURRENCY_NAMES[c]} accounts buyers pay into</span>
          {list(c).map((m, i) => (
            <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, marginTop: 6 }}>
              <MethodForm currency={c} value={m} onChange={(next) => set(c, list(c).map((x, j) => (j === i ? next : x)))} />
              <button type="button" className="bx-btn ghost small" style={{ marginTop: 6 }} onClick={() => set(c, list(c).filter((_, j) => j !== i))}><Trash2 style={{ width: 13 }} /> Remove</button>
            </div>
          ))}
          {list(c).length < 4 && <button type="button" className="bx-btn ghost small" style={{ marginTop: 6, justifySelf: 'start' }} onClick={() => set(c, [...list(c), EMPTY_BANK])}><Plus style={{ width: 13 }} /> Add a bank or mobile money account</button>}
        </div>
      ))}
    </>
  );
}

const detailsProblem = (markets: OtcCurrency[], details: Record<string, PaymentMethod[]>) => {
  for (const c of markets) for (const m of details[c] ?? []) { const p = methodProblem(m); if (p) return `${c}: ${p}`; }
  return null;
};

function ApplyForm({ declined }: { declined: boolean }) {
  const { org } = useOtcRole();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(org?.name ?? '');
  const [about, setAbout] = useState('');
  const [markets, setMarkets] = useState<OtcCurrency[]>(['NGN']);
  const [details, setDetails] = useState<Record<string, PaymentMethod[]>>({});
  const [busy, setBusy] = useState(false);
  const problem = detailsProblem(markets, details);
  async function apply() {
    setBusy(true);
    try {
      await api('/api/v2/otc/merchant/apply', { displayName: name, about, markets, paymentDetails: details });
      toast({ title: 'Application sent', description: 'We review every merchant and email you with the decision.' });
      void qc.invalidateQueries({ queryKey: ['v2-otc-merchant'] });
    } catch (e) {
      toast({ title: 'Application not sent', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }
  return (
    <div className="bx-card">
      <div className="bx-card-h"><div><h2>Become a merchant</h2><div className="sub">Merchants post offers to buy and sell USDC for local currency. BlockFinaX approves every merchant before their offers appear.{org ? ` You are applying for ${org.name}: its business account holds the USDC and its admins run the offers.` : ''}</div></div></div>
      {declined && <Note warn>Your last application was not approved. You can apply again with more detail.</Note>}
      <label className="bx-field" style={{ marginTop: 10 }}>Name buyers and sellers will see
        <input className="bx-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your business or trading name" />
      </label>
      <label className="bx-field" style={{ marginTop: 10 }}>About your business
        <textarea className="bx-input" rows={3} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Where you are, how long you have traded, typical volumes" />
      </label>
      <DetailsFields markets={markets} setMarkets={setMarkets} details={details} setDetails={setDetails} />
      {problem && <p className="bx-error">{problem}</p>}
      <button className="bx-btn block" style={{ marginTop: 14 }} disabled={busy || name.trim().length < 2 || !markets.length || Boolean(problem)} onClick={apply}>{busy ? <Spin /> : null} Apply</button>
    </div>
  );
}

function MerchantDesk({ merchant, offers, onOpen }: { merchant: Merchant; offers: MyOffer[]; onOpen: (id: number) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const orders = useMyOrders();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [markets, setMarkets] = useState<OtcCurrency[]>(merchant.markets);
  const [details, setDetails] = useState<Record<string, PaymentMethod[]>>(merchant.paymentDetails);
  const [busy, setBusy] = useState<string | null>(null);
  const onMine = useMemo(() => (orders.data ?? []).filter((o) => o.me?.isMerchant), [orders.data]);
  const waiting = onMine.filter((o) => o.status === 'paid' || o.status === 'disputed' || (o.status === 'open' && o.side === 'buy'));

  async function saveDetails() {
    try {
      await api('/api/v2/otc/merchant', { markets, paymentDetails: details });
      toast({ title: 'Saved' });
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['v2-otc-merchant'] });
    } catch (e) { toast({ title: 'Not saved', description: (e as Error).message, variant: 'destructive' }); }
  }

  async function change(o: MyOffer, body: Record<string, unknown>, done: string) {
    setBusy(`${o.id}`);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/otc/offers/${o.id}/prepare`, body);
      await runOtc(transactions, () => {}, { offerId: o.id });
      toast({ title: done });
      for (const k of ['v2-otc-merchant', 'v2-otc-market', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast({ title: 'That did not go through', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  return (
    <>
      <MerchantRequests merchant={merchant} />
      {waiting.length > 0 && (
        <div className="bx-card">
          <div className="bx-card-h"><div><h2>Needs you</h2><div className="sub">Orders on your offers waiting for you to pay or to check a payment and release.</div></div></div>
          <OrderRows orders={waiting} onOpen={onOpen} />
        </div>
      )}
      <div className="bx-card">
        <div className="bx-card-h">
          <div><h2>Your offers</h2><div className="sub">Trading as {merchant.displayName}. Selling locks your USDC in escrow; buying locks nothing until a user opens an order.</div></div>
          <button className="bx-btn small" onClick={() => setCreating(true)}><ArrowLeftRight style={{ width: 14 }} /> New offer</button>
        </div>
        {!offers.length ? <div className="bx-empty">No offers yet.</div> : offers.map((o) => (
          <div key={o.id} className="bx-li" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1.3fr) minmax(0,1.3fr) minmax(0,1.3fr) auto', alignItems: 'center' }}>
            <span><b>{o.side === 'sell' ? 'Selling' : 'Buying'} USDC · {o.currency}</b><div className="muted" style={{ fontSize: 12 }}>Offer {o.id}{o.quoteFor ? ' · quote for one customer' : ''}</div></span>
            <span className="num">{money(o.rate, o.currency)}</span>
            <span className="num">{fmt(o.available)} USDC {o.side === 'sell' ? 'locked' : 'to buy'}</span>
            <span>{o.active ? <Tag tone="green">Live</Tag> : <Tag tone="grey">Closed</Tag>}</span>
            <span className="r" style={{ display: 'flex', gap: 6 }}>
              {o.active && <button className="bx-btn ghost small" disabled={busy !== null} onClick={() => { const r = prompt(`New price in ${o.currency} per USDC`, o.rate); if (r) void change(o, { kind: 'update', rate: r }, 'Price updated'); }}>Price</button>}
              {o.active && <button className="bx-btn ghost small" disabled={busy !== null} onClick={() => change(o, { kind: 'close' }, o.side === 'sell' ? 'Offer closed and free USDC returned' : 'Offer closed')}>{busy === `${o.id}` ? <Spin /> : 'Close'}</button>}
              {!o.active && Number(o.available) > 0 && o.side === 'sell' && <button className="bx-btn ghost small" disabled={busy !== null} onClick={() => change(o, { kind: 'withdraw', amount: o.available }, 'USDC returned')}>Take out</button>}
            </span>
          </div>
        ))}
      </div>
      <div className="bx-card">
        <div className="bx-card-h"><div><h2>Payment details</h2><div className="sub">Shown to buyers when they open an order on your selling offers.</div></div>
          {!editing && <button className="bx-btn ghost small" onClick={() => setEditing(true)}>Edit</button>}
        </div>
        {editing ? (
          <>
            <DetailsFields markets={markets} setMarkets={setMarkets} details={details} setDetails={setDetails} />
            {detailsProblem(markets, details) && <p className="bx-error">{detailsProblem(markets, details)}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="bx-btn" disabled={Boolean(detailsProblem(markets, details))} onClick={saveDetails}>Save</button><button className="bx-btn ghost" onClick={() => setEditing(false)}>Cancel</button></div>
          </>
        ) : merchant.markets.map((c) => (
          <div key={c} style={{ marginTop: 8 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{OTC_CURRENCY_NAMES[c]}</div>
            {(merchant.paymentDetails[c] ?? []).length ? <div style={{ display: 'grid', gap: 6 }}>{merchant.paymentDetails[c].map((m, i) => <MethodCard key={i} m={m} />)}</div> : <span className="muted" style={{ fontSize: 13 }}>No account yet. Add one so buyers can pay you.</span>}
          </div>
        ))}
      </div>
      {creating && <NewOfferModal merchant={merchant} onClose={() => setCreating(false)} />}
    </>
  );
}

function NewOfferModal({ merchant, onClose }: { merchant: Merchant; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [side, setSide] = useState<'sell' | 'buy'>('sell');
  const [currency, setCurrency] = useState<OtcCurrency>(merchant.markets[0] ?? 'NGN');
  const spot = useSpot(currency);
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('1000');
  const [minOrder, setMinOrder] = useState('50');
  const [maxOrder, setMaxOrder] = useState('1000');
  const [busy, setBusy] = useState<string | null>(null);
  const problem = !(Number(rate) > 0) ? 'Enter your price'
    : !(Number(minOrder) >= 1) ? 'The smallest order is at least 1 USDC'
    : !(Number(maxOrder) >= Number(minOrder)) ? 'The largest order must be at least the smallest'
    : !(Number(amount) >= Number(minOrder)) ? 'The amount must be at least the smallest order'
    : side === 'sell' && !(merchant.paymentDetails[currency] ?? []).length ? `Add a ${currency} bank or mobile money account first` : null;

  async function create() {
    setBusy('Preparing...');
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/otc/offers/prepare', { side, currency, rate, amount, minOrder, maxOrder });
      await runOtc(transactions, setBusy, {});
      toast({ title: 'Offer live', description: side === 'sell' ? `${amount} USDC is locked in escrow for buyers.` : 'Users can now sell you USDC.' });
      for (const k of ['v2-otc-merchant', 'v2-otc-market', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    } catch (e) {
      toast({ title: 'Offer not created', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  return (
    <div className="bx-modal-bg" onClick={onClose}>
      <div className="bx-modal" role="dialog" aria-label="New offer" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0 }}>New offer</h2>
          <button className="bx-icon-btn" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        <div className="bx-seg" style={{ marginTop: 12 }}>
          <button className={side === 'sell' ? 'on' : ''} onClick={() => setSide('sell')}>I sell USDC</button>
          <button className={side === 'buy' ? 'on' : ''} onClick={() => setSide('buy')}>I buy USDC</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <label className="bx-field">Currency
            <select className="bx-input" value={currency} onChange={(e) => setCurrency(e.target.value as OtcCurrency)}>
              {merchant.markets.map((c) => <option key={c} value={c}>{OTC_CURRENCY_NAMES[c]} ({c})</option>)}
            </select>
          </label>
          <label className="bx-field">Your price ({currency} per USDC)
            <input className="bx-input num" inputMode="decimal" value={rate} placeholder={spot.data ? spot.data.toFixed(2) : ''} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          <label className="bx-field">{side === 'sell' ? 'USDC to sell (locked now)' : 'Most USDC you will buy'}
            <input className="bx-input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          <span />
          <label className="bx-field">Smallest order (USDC)
            <input className="bx-input num" inputMode="decimal" value={minOrder} onChange={(e) => setMinOrder(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          <label className="bx-field">Largest order (USDC)
            <input className="bx-input num" inputMode="decimal" value={maxOrder} onChange={(e) => setMaxOrder(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
        </div>
        {spot.data ? <div className="bx-hint">Market rate today: {money(spot.data, currency)} per USD.</div> : null}
        <div style={{ marginTop: 12 }}><Note>{side === 'sell'
          ? 'Your USDC moves into escrow now. You can take out whatever no order has reserved, or close the offer, at any time.'
          : 'Nothing is locked now. When a user opens an order, their USDC is locked and you pay them in local currency.'}</Note></div>
        {problem && <p className="bx-error">{problem}</p>}
        <button className="bx-btn block" style={{ marginTop: 14 }} disabled={busy !== null || Boolean(problem)} onClick={create}>{busy ? <><Spin /> {busy}</> : side === 'sell' ? 'Lock USDC and post offer' : 'Post offer'}</button>
      </div>
    </div>
  );
}

/** Requests merchants can quote. A quote is an escrow offer only the requester can take. */
function MerchantRequests({ merchant }: { merchant: Merchant }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { key } = useOtcRole();
  const q = useQuery({ queryKey: ['v2-otc-open-requests', key], queryFn: async () => (await api<{ requests: OpenRequest[] }>('/api/v2/otc/requests/open')).requests, refetchInterval: 30_000 });
  const [busy, setBusy] = useState<number | null>(null);
  const [quoting, setQuoting] = useState<OpenRequest | null>(null);
  const [rate, setRate] = useState('');
  const spot = useSpot(quoting?.currency ?? merchant.markets[0] ?? 'NGN');

  async function send(r: OpenRequest) {
    setBusy(r.id);
    try {
      const out = await api<{ quoteId: number; transactions: PreparedTransaction[] }>(`/api/v2/otc/requests/${r.id}/quote/prepare`, { rate });
      await runOtc(out.transactions, () => {}, {});
      await api(`/api/v2/otc/quotes/${out.quoteId}/sent`, {});
      toast({ title: 'Quote sent', description: r.side === 'buy' ? `${fmt(r.amount)} USDC is locked for this customer until they accept or you close the quote.` : 'The customer can now accept it.' });
      setQuoting(null); setRate('');
      for (const k of ['v2-otc-open-requests', 'v2-otc-merchant', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast({ title: 'Quote not sent', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  return (
    <div className="bx-card">
      <div className="bx-card-h"><div><h2>Requests</h2><div className="sub">Customers asking for a price in your currencies. Answer with a quote; only that customer can take it.</div></div></div>
      {q.isLoading ? <Loading /> : !q.data?.length ? <div className="bx-empty"><Inbox /> No open requests right now.</div> : q.data.map((r) => (
        <div key={r.id} className="bx-li" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.4fr) auto', alignItems: 'center' }}>
          <span><b>Customer wants to {r.side} {fmt(r.amount)} USDC for {r.currency}</b><div className="muted" style={{ fontSize: 12 }}>{r.methodType === 'any' ? 'Bank or mobile money' : r.methodType === 'bank' ? 'Bank transfer' : 'Mobile money'} · open until {when(r.expiresAt)}{r.note ? ` · "${r.note}"` : ''}</div></span>
          <span>{r.myQuote ? <Tag tone="blue">Quoted {money(r.myQuote.rate, r.currency)}</Tag> : null}</span>
          <span className="r">{!r.myQuote && <button className="bx-btn small" disabled={busy !== null} onClick={() => { setQuoting(r); setRate(''); }}>Send a quote</button>}</span>
        </div>
      ))}
      {quoting && (
        <div className="bx-modal-bg" onClick={() => setQuoting(null)}>
          <div className="bx-modal" role="dialog" aria-label="Send a quote" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div><h2 style={{ margin: 0 }}>Quote: customer {quoting.side}s {fmt(quoting.amount)} USDC</h2><div className="sub" style={{ marginTop: 4 }}>{OTC_CURRENCY_NAMES[quoting.currency as OtcCurrency]} ({quoting.currency})</div></div>
              <button className="bx-icon-btn" aria-label="Close" onClick={() => setQuoting(null)}><X /></button>
            </div>
            <label className="bx-field" style={{ marginTop: 14 }}>Your price ({quoting.currency} per USDC)
              <input className="bx-input num" inputMode="decimal" value={rate} placeholder={spot.data ? spot.data.toFixed(2) : ''} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} />
            </label>
            {Number(rate) > 0 && <div className="bx-hint">{quoting.side === 'buy' ? 'They pay you' : 'You pay them'} {money(localAmount(quoting.amount, rate), quoting.currency)}.</div>}
            <div style={{ marginTop: 12 }}><Note>{quoting.side === 'buy'
              ? `${fmt(quoting.amount)} USDC moves into escrow now, reserved for this customer. Close the quote to get it back if they do not accept.`
              : 'Nothing is locked now. If they accept, their USDC is locked and you pay them in local currency.'}</Note></div>
            <button className="bx-btn block" style={{ marginTop: 14 }} disabled={busy !== null || !(Number(rate) > 0)} onClick={() => send(quoting)}>{busy !== null ? <Spin /> : null} Send quote</button>
          </div>
        </div>
      )}
    </div>
  );
}
