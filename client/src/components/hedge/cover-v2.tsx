/**
 * Cover on the currency-pool model (Architecture v2.0), for the passkey-wallet build.
 *
 * Buy cover asks the buyer's questions in their words: which currency, what worries
 * them (it weakening or strengthening, which picks the pool), how much and when the
 * payment is due. It then prices one recommended cover automatically and says what it
 * does in a sentence; the protection rate, cap and cover type sit behind "Adjust".
 *
 * Every pool sells one direction (enforced by the contract), so "what worries you" is a
 * choice of pool, not a setting on a pool.
 *
 * Underwrite lists pools with what an underwriter needs (direction, size, use, share
 * value and return, their own stake) and creates new pools. Portfolio holds the user's
 * cover and claims. Everything is USDC and network fees are sponsored.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronUp, Layers, Loader2, PlusCircle, Shield, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FlagSvg } from '@/components/app-glyphs';
import type { CurrencyPool, ProtectionPosition, ProtectionQuote, SettlementResult } from '@shared/domain/types';
import { api, passkeyBalances, passkeyWalletProvider } from '@/lib/wallets/passkey-wallet';
import { toWalletRequest, type PreparedTransaction } from '@/lib/wallet-provider';

type View = 'buy' | 'lp' | 'portfolio';
type Structure = 'open' | 'capped';
type Direction = 'up' | 'down';

const CURRENCY_NAMES: Record<string, string> = { NGN: 'Naira', GHS: 'Cedi', KES: 'Shilling', ZAR: 'Rand', EGP: 'Pound' };
const quoteCcy = (pair: string) => pair.split('/')[1] ?? pair;
const ccyName = (pair: string) => CURRENCY_NAMES[quoteCcy(pair)] ?? quoteCcy(pair);
const fmt = (v: string | number, dp = 2) => Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtRate = (v: string | number) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
const dateIn = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const poolRef = (p: CurrencyPool) => `${p.ref.chain}:${p.ref.contract}:${p.ref.id}`;

/** What a direction means for a pair, in the buyer's terms. */
function worry(pair: string, d: Direction | 'both') {
  const name = ccyName(pair);
  return d === 'down'
    ? { title: `${name} gets stronger`, who: 'For exporters and anyone earning USD', short: `${name} strengthening` }
    : { title: `${name} gets weaker`, who: 'For importers and anyone paying in USD', short: `${name} weakening` };
}

function Flag({ pair }: { pair: string }) {
  return <span className="mkt-fl"><FlagSvg code={quoteCcy(pair)} /></span>;
}

async function signAndSend(transactions: PreparedTransaction[], onStep: (m: string) => void) {
  let hash = '';
  for (const tx of transactions) {
    onStep(tx.label);
    hash = (await passkeyWalletProvider.sendTransaction(toWalletRequest(tx), onStep)).transactionHash;
  }
  return hash;
}

function useHubPools() {
  return useQuery({
    queryKey: ['v2-pools'],
    queryFn: async () => (await api<{ pools: CurrencyPool[] }>('/api/v2/pools')).pools,
    refetchInterval: 30_000,
  });
}

function useUsdc(chain: string | undefined) {
  return useQuery({
    queryKey: ['v2-usdc', chain],
    enabled: Boolean(chain),
    queryFn: async () => {
      const key = (chain ?? '').toUpperCase().replace(/-/g, '_');
      return (await passkeyBalances()).find((b) => b.chain === key && b.token === 'USDC')?.amount ?? 0;
    },
    refetchInterval: 30_000,
  });
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function CoverV2() {
  const [view, setView] = useState<View>('buy');
  return (
    <>
      <div className="page-head">
        <div className="ph-l">
          <h1>Cover</h1>
          <p>Protect a payment against a currency move, or earn by underwriting. Everything is in USDC and network fees are covered.</p>
        </div>
      </div>
      <div className="cv-tabs">
        <button className={view === 'buy' ? 'on' : ''} onClick={() => setView('buy')}><ShieldCheck /> Buy cover</button>
        <button className={view === 'lp' ? 'on' : ''} onClick={() => setView('lp')}><Layers /> Underwrite</button>
        <button className={view === 'portfolio' ? 'on' : ''} onClick={() => setView('portfolio')}><Shield /> Portfolio</button>
      </div>
      {view === 'buy' && <BuyCover onBought={() => setView('portfolio')} />}
      {view === 'lp' && <Underwrite />}
      {view === 'portfolio' && <Portfolio />}
    </>
  );
}

// ── Buy cover ────────────────────────────────────────────────────────────────

function BuyCover({ onBought }: { onBought: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pools = useHubPools();

  const live = useMemo(() => (pools.data ?? []).filter((p) => p.acceptingHedges && Number(p.liquidity.capacity) > 0), [pools.data]);
  const pairs = useMemo(() => Array.from(new Set(live.map((p) => p.pair))), [live]);

  const [pair, setPair] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('up');
  const [notional, setNotional] = useState('1000');
  const [tenorDays, setTenorDays] = useState<number | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [structure, setStructure] = useState<Structure>('capped');
  const [strikeMove, setStrikeMove] = useState(0.02);
  const [capMove, setCapMove] = useState(0.1);

  useEffect(() => { if (!pair && pairs[0]) setPair(pairs[0]); }, [pairs, pair]);
  const directions = useMemo(() => {
    const ds = new Set(live.filter((p) => p.pair === pair).map((p) => p.direction));
    return (['up', 'down'] as Direction[]).filter((d) => ds.has(d) || ds.has('both'));
  }, [live, pair]);
  useEffect(() => { if (directions.length && !directions.includes(direction)) setDirection(directions[0]); }, [directions, direction]);

  const chain = live[0]?.chain;
  const usdc = useUsdc(chain);
  const options = useQuery({
    queryKey: ['v2-options', pair, direction],
    enabled: Boolean(pair),
    queryFn: () => api<{ tenors: { tenorDays: number; open: boolean; capped: boolean; maxPayoutAvailable: string }[] }>(
      `/api/v2/options?pair=${encodeURIComponent(pair!)}&direction=${direction}`),
  });
  const spot = useQuery({
    queryKey: ['v2-spot', pair],
    enabled: Boolean(pair),
    queryFn: async () => Number((await api<{ spot: string }>(`/api/v2/spot?pair=${encodeURIComponent(pair!)}`)).spot),
    refetchInterval: 60_000,
  });
  useEffect(() => {
    const ts = options.data?.tenors ?? [];
    if (ts.length && !ts.some((t) => t.tenorDays === tenorDays)) setTenorDays((ts.find((t) => t.tenorDays >= 14) ?? ts[0]).tenorDays);
  }, [options.data, tenorDays]);
  const tenor = options.data?.tenors.find((t) => t.tenorDays === tenorDays);
  useEffect(() => { if (tenor && !tenor[structure]) setStructure(tenor.capped ? 'capped' : 'open'); }, [tenor, structure]);

  const sign = direction === 'up' ? 1 : -1;
  const strike = spot.data ? spot.data * (1 + sign * strikeMove) : null;
  const cap = strike ? strike * (1 + sign * capMove) : null;

  // Price automatically once the inputs settle; refresh when the held price runs out.
  const request = useDebounced(
    pair && tenorDays && strike && Number(notional) > 0
      ? JSON.stringify({ pair, notional, tenorDays, structure, direction, strike: strike.toFixed(6), ...(structure === 'capped' && cap ? { cap: cap.toFixed(6) } : {}) })
      : null,
    500,
  );
  const [refresh, setRefresh] = useState(0);
  const quote = useQuery({
    queryKey: ['v2-quote', request, refresh],
    enabled: Boolean(request),
    retry: false,
    queryFn: () => api<ProtectionQuote>('/api/v2/quotes', JSON.parse(request!)),
  });
  const [secondsLeft, setSecondsLeft] = useState(0);
  useEffect(() => {
    if (!quote.data) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round(quote.data!.expiresAt - Date.now() / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [quote.data]);

  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function buy() {
    const q = quote.data;
    if (!q) return;
    if (secondsLeft < 5) { setRefresh((n) => n + 1); return; }
    if (Number(usdc.data ?? 0) < Number(q.economic.totalCost)) {
      toast({ title: 'Not enough USDC', description: `You need ${fmt(q.economic.totalCost)} USDC. Add USDC from Receive.`, variant: 'destructive' });
      return;
    }
    setBusy('Preparing...');
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/hedges/prepare', { quote: q });
      setDone(await signAndSend(transactions, (m) => setBusy(m)));
      for (const k of ['v2-hedges', 'v2-pools', 'v2-usdc']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast({ title: 'Purchase failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (pools.isLoading) return <p className="send-note"><Loader2 className="spin" /> Loading markets...</p>;
  if (!pairs.length) return <p className="send-note">No cover is on sale right now. Check back soon.</p>;

  if (done) {
    return (
      <div className="pool-card" style={{ textAlign: 'center' }}>
        <CheckCircle2 style={{ color: 'var(--green)', width: 40, height: 40, margin: '8px auto' }} />
        <h3 style={{ fontSize: 17, fontWeight: 600 }}>You're covered</h3>
        <p style={{ fontSize: 12.5, color: 'var(--tx-3)' }}>Your cover is active. Track it in Portfolio.</p>
        <a href={`https://stellar.expert/explorer/testnet/tx/${done}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--blue)' }}>{done.slice(0, 10)}...{done.slice(-6)}</a>
        <div className="ctapair" style={{ marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={() => setDone(null)}>Buy more</button>
          <button className="btn btn-primary" onClick={() => { setDone(null); onBought(); }}>View portfolio</button>
        </div>
      </div>
    );
  }

  const e = quote.data?.economic;
  const ccy = pair ? quoteCcy(pair) : '';
  const due = tenorDays ? dateIn(tenorDays) : '';

  return (
    <section className="cv-view on">
      <div className="field">
        <label>Which currency?</label>
        <div className="rtabs">
          {pairs.map((p) => (
            <button key={p} className={p === pair ? 'on' : ''} onClick={() => setPair(p)}><Flag pair={p} /> {ccyName(p)}</button>
          ))}
        </div>
        {spot.data ? <p className="send-note">Today 1 USD = {fmtRate(spot.data)} {ccy}</p> : null}
      </div>

      {pair && (
        <div className="field">
          <label>What worries you?</label>
          <div style={{ display: 'grid', gap: 8 }}>
            {directions.map((d) => {
              const w = worry(pair, d);
              return (
                <button key={d} className="payway" onClick={() => setDirection(d)}
                  style={direction === d ? { outline: '2px solid var(--blue)' } : undefined}>
                  <span className="pwc"><span className="t">{w.title}</span><span className="s">{w.who}</span></span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="field">
        <label>Payment to protect (USDC)</label>
        <input className="input" inputMode="decimal" value={notional} onChange={(ev) => setNotional(ev.target.value.replace(/[^0-9.]/g, ''))} />
      </div>

      <div className="field">
        <label>When is it due?</label>
        <div className="rtabs">
          {(options.data?.tenors ?? []).map((t) => (
            <button key={t.tenorDays} className={t.tenorDays === tenorDays ? 'on' : ''} onClick={() => setTenorDays(t.tenorDays)}>{dateIn(t.tenorDays)}</button>
          ))}
        </div>
      </div>

      {strike && cap && tenorDays && (
        <div className="pool-card">
          <p style={{ fontSize: 14, lineHeight: 1.5, margin: 0 }}>
            {direction === 'up' ? (
              <>If 1 USD costs more than <b>{fmtRate(strike)} {ccy}</b> on {due}, you receive the difference on {fmt(notional, 0)} USDC
                {structure === 'capped' ? <>, counted up to {fmtRate(cap)} {ccy}</> : null}.</>
            ) : (
              <>If 1 USD buys less than <b>{fmtRate(strike)} {ccy}</b> on {due}, you receive the difference on {fmt(notional, 0)} USDC
                {structure === 'capped' ? <>, counted down to {fmtRate(cap)} {ccy}</> : null}.</>
            )}
          </p>
          <div className="brk" style={{ marginTop: 10 }}>
            <div className="brk-line total"><span className="l">You pay</span><span className="v">{e ? `${fmt(e.totalCost)} USDC` : quote.isFetching ? '...' : '-'}</span></div>
            <div className="brk-line"><span className="l">Most you can receive</span><span className="v">{e ? `${fmt(e.maxPayout)} USDC` : '-'}</span></div>
            {e && <div className="brk-line"><span className="l">Includes BlockFinaX fee</span><span className="v">{fmt(e.hedgerFee)} USDC</span></div>}
            <div className="brk-line"><span className="l">Network fees</span><span className="v" style={{ color: 'var(--green)' }}>Covered</span></div>
          </div>
          {quote.error && <p className="send-note" style={{ color: 'var(--red, #e5484d)' }}>{(quote.error as Error).message}</p>}
          <button className="send-note" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 0, padding: 0, marginTop: 8, color: 'var(--blue)', cursor: 'pointer' }} onClick={() => setAdjust((a) => !a)}>
            {adjust ? <ChevronUp /> : <ChevronDown />} Adjust cover
          </button>
          {adjust && (
            <>
              <div className="field">
                <label>Protection starts</label>
                <div className="rtabs">
                  {[0, 0.02, 0.05].map((m) => (
                    <button key={m} className={strikeMove === m ? 'on' : ''} onClick={() => setStrikeMove(m)}>{m === 0 ? "At today's rate" : `${m * 100}% from today`}</button>
                  ))}
                </div>
                <p className="send-note">Starting closer to today costs more.</p>
              </div>
              <div className="field">
                <label>Cover type</label>
                <div className="rtabs">
                  <button className={structure === 'capped' ? 'on' : ''} disabled={tenor ? !tenor.capped : false} onClick={() => setStructure('capped')}>Capped</button>
                  <button className={structure === 'open' ? 'on' : ''} disabled={tenor ? !tenor.open : false} onClick={() => setStructure('open')}>Open</button>
                </div>
                <p className="send-note">{structure === 'capped' ? 'Pays up to a limit you choose. Cheaper.' : "Pays the whole move, up to the pool's maximum."}</p>
              </div>
              {structure === 'capped' && (
                <div className="field">
                  <label>Pays up to</label>
                  <div className="rtabs">
                    {[0.05, 0.1, 0.2].map((m) => (
                      <button key={m} className={capMove === m ? 'on' : ''} onClick={() => setCapMove(m)}>{`A ${m * 100}% move`}</button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <p className="send-note">Your USDC: {fmt(usdc.data ?? 0)}{e && secondsLeft > 0 ? ` · Price held for ${secondsLeft}s` : ''}</p>
      <button className="btn btn-primary" disabled={!!busy || !e} onClick={buy}>
        {busy ? <><Loader2 className="spin" /> {busy}</> : e ? (secondsLeft < 5 ? 'Refresh price' : `Buy cover for ${fmt(e.totalCost)} USDC`) : 'Pricing...'}
      </button>
      {pair && <p className="send-note">Sold by the {worry(pair, direction).short} pool. Its underwriters are paid your premium for taking this risk.</p>}
    </section>
  );
}

// ── Underwrite ───────────────────────────────────────────────────────────────

function PoolStats({ p }: { p: CurrencyPool }) {
  const nav = Number(p.liquidity.nav);
  const used = nav > 0 ? Math.round((Number(p.liquidity.reserved) / nav) * 100) : 0;
  const sharePrice = Number(p.totalShares) > 0 ? nav / Number(p.totalShares) : 1;
  const years = Math.max((Date.now() / 1000 - p.createdAt) / (365 * 86_400), 1 / 365);
  const growth = sharePrice - 1;
  const yearly = years >= 7 / 365 ? growth / years : null;
  const markups = p.tenors.filter((t) => t.active).map((t) => t.markupBps);
  return (
    <>
      <div className="pool-stats">
        <div className="pool-stat"><div className="l">Pool size</div><div className="v tnum">{fmt(nav, 0)}</div></div>
        <div className="pool-stat"><div className="l">Free to sell</div><div className="v tnum">{fmt(p.liquidity.capacity, 0)}</div></div>
        <div className="pool-stat"><div className="l">Share value</div><div className="v tnum">{sharePrice.toFixed(4)}</div></div>
        <div className="pool-stat"><div className="l">{yearly === null ? 'Return so far' : 'Yearly return'}</div><div className="v tnum">{((yearly ?? growth) * 100).toFixed(2)}%</div></div>
      </div>
      <div className="pool-stats">
        <div className="pool-stat"><div className="l">Premiums being earned</div><div className="v tnum">{fmt(p.liquidity.deferredPremium)}</div></div>
        <div className="pool-stat"><div className="l">Active cover</div><div className="v tnum">{p.activePositions}</div></div>
        <div className="pool-stat"><div className="l">Price vs fair</div><div className="v tnum">{markups.length ? `${Math.min(...markups) / 100}%` : '-'}</div></div>
      </div>
      <div className="pool-cap"><div className="row1"><span>Capacity in use</span><span>{used}%</span></div><div className="liqbar"><i style={{ width: `${used}%` }} /></div></div>
    </>
  );
}

function YourStake({ p }: { p: CurrencyPool }) {
  const stake = useQuery({
    queryKey: ['v2-lp', poolRef(p)],
    queryFn: () => api<{ shares: string; value: string }>(`/api/v2/pools/${encodeURIComponent(poolRef(p))}/lp`),
    refetchInterval: 30_000,
  });
  if (!stake.data || Number(stake.data.shares) === 0) return null;
  return <p className="send-note">Your stake: {fmt(stake.data.value)} USDC ({fmt(stake.data.shares, 2)} shares)</p>;
}

function Underwrite() {
  const [sub, setSub] = useState<'pools' | 'create'>('pools');
  return (
    <>
      <div className="assettog cv-sub">
        <button className={sub === 'pools' ? 'on' : ''} onClick={() => setSub('pools')}><Layers /> Pools</button>
        <button className={sub === 'create' ? 'on' : ''} onClick={() => setSub('create')}><PlusCircle /> Create pool</button>
      </div>
      {sub === 'pools' ? <PoolList /> : <CreatePool onCreated={() => setSub('pools')} />}
    </>
  );
}

function PoolList() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pools = useHubPools();
  const usdc = useUsdc(pools.data?.[0]?.chain);
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function deposit(pool: CurrencyPool) {
    setBusy('Preparing...');
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/deposits/prepare`, { amount });
      await signAndSend(transactions, (m) => setBusy(m));
      toast({ title: 'Liquidity added', description: `${fmt(amount)} USDC added to the ${worry(pool.pair, pool.direction).short} pool.` });
      setOpen(null); setAmount('');
      for (const k of ['v2-pools', 'v2-usdc', 'v2-lp']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast({ title: 'Deposit failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (pools.isLoading) return <p className="send-note"><Loader2 className="spin" /> Loading pools...</p>;
  if (!pools.data?.length) return <p className="send-note">No pools yet. Create the first one.</p>;
  return (
    <section className="cv-view on">
      {pools.data.map((p) => {
        const key = p.ref.id;
        const w = worry(p.pair, p.direction);
        return (
          <div className="pool-card" key={key}>
            <div className="pool-top">
              <Flag pair={p.pair} />
              <div className="pt-nm">
                <div className="a">{p.direction === 'both' ? `${ccyName(p.pair)} (both directions)` : `Covers ${w.short}`}</div>
                <div className="b">{p.pair} · {p.tenors.filter((t) => t.active).map((t) => `${t.tenorDays}d`).join(' · ')}</div>
              </div>
            </div>
            <PoolStats p={p} />
            <YourStake p={p} />
            {open === key ? (
              <>
                <div className="field" style={{ marginTop: 10 }}>
                  <label>Amount (USDC) · you have {fmt(usdc.data ?? 0)}</label>
                  <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
                <p className="send-note">You earn premiums from {w.short} cover and pay out if it happens. Withdrawals wait for the cover sold to end.</p>
                <div className="ctapair">
                  <button className="btn btn-ghost" disabled={!!busy} onClick={() => setOpen(null)}>Cancel</button>
                  <button className="btn btn-primary" disabled={!!busy || !(Number(amount) > 0)} onClick={() => deposit(p)}>
                    {busy ? <><Loader2 className="spin" /> {busy}</> : 'Add liquidity'}
                  </button>
                </div>
              </>
            ) : (
              <button className="btn-sm2 primary" disabled={!p.allowExternalLp} onClick={() => setOpen(key)}>{p.allowExternalLp ? 'Underwrite' : 'Closed to new underwriters'}</button>
            )}
          </div>
        );
      })}
    </section>
  );
}

const TENOR_CHOICES = [3, 7, 14, 30, 45, 60, 90];

function CreatePool({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ['v2-pool-setup'], queryFn: () => api<{ chain: string; pairs: string[]; creationFee: string }>('/api/v2/pools/setup') });
  const usdc = useUsdc(setup.data?.chain);
  const [pair, setPair] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('up');
  const [tenors, setTenors] = useState<number[]>([7, 14, 30]);
  const [markupPct, setMarkupPct] = useState('115');
  const [open, setOpen] = useState(true);
  const [capped, setCapped] = useState(true);
  const [liquidity, setLiquidity] = useState('500');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (!pair && setup.data?.pairs[0]) setPair(setup.data.pairs[0]); }, [setup.data, pair]);

  const markupBps = Math.round(Number(markupPct) * 100);
  const fee = Number(setup.data?.creationFee ?? 0);
  const total = Number(liquidity || 0) + fee;
  const problem =
    !pair ? 'Choose a currency'
      : !tenors.length ? 'Choose at least one length'
        : !(markupBps >= 9000 && markupBps <= 50000) ? 'Price must be 90% to 500% of fair'
          : !open && !capped ? 'Offer at least one cover type'
            : !(Number(liquidity) >= 10) ? 'Start with at least 10 USDC'
              : total > Number(usdc.data ?? 0) ? `You need ${fmt(total)} USDC` : null;

  async function create() {
    setBusy('Preparing...');
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/pools/prepare', {
        pair, direction, allowExternalLp: true, initialLiquidity: liquidity,
        structures: { open, capped, minCapDistanceBps: 300, maxCapDistanceBps: 2000, openMaxPayoutBps: 3000 },
        tenors: tenors.map((d) => ({ tenorDays: d, active: true, markupBps })),
      });
      await signAndSend(transactions, (m) => setBusy(m));
      toast({ title: 'Pool created', description: `Your ${worry(pair!, direction).short} pool is live.` });
      for (const k of ['v2-pools', 'v2-usdc']) void qc.invalidateQueries({ queryKey: [k] });
      onCreated();
    } catch (e) {
      toast({ title: 'Could not create pool', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (setup.isLoading) return <p className="send-note"><Loader2 className="spin" /> Loading...</p>;
  return (
    <section className="cv-view on">
      <div className="field">
        <label>Currency</label>
        <div className="rtabs">
          {(setup.data?.pairs ?? []).map((p) => <button key={p} className={p === pair ? 'on' : ''} onClick={() => setPair(p)}><Flag pair={p} /> {ccyName(p)}</button>)}
        </div>
      </div>
      {pair && (
        <div className="field">
          <label>Cover this pool sells</label>
          <div className="rtabs">
            {(['up', 'down'] as Direction[]).map((d) => <button key={d} className={direction === d ? 'on' : ''} onClick={() => setDirection(d)}>{worry(pair, d).short}</button>)}
          </div>
          <p className="send-note">Your pool pays out if the {ccyName(pair)} {direction === 'up' ? 'weakens' : 'strengthens'} past what buyers chose. It earns their premiums otherwise.</p>
        </div>
      )}
      <div className="field">
        <label>Lengths offered</label>
        <div className="rtabs" style={{ flexWrap: 'wrap' }}>
          {TENOR_CHOICES.map((d) => (
            <button key={d} className={tenors.includes(d) ? 'on' : ''} onClick={() => setTenors((ts) => ts.includes(d) ? ts.filter((x) => x !== d) : [...ts, d].sort((a, b) => a - b))}>{d} days</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Your price (% of fair price)</label>
        <input className="input" inputMode="decimal" value={markupPct} onChange={(e) => setMarkupPct(e.target.value.replace(/[^0-9.]/g, ''))} />
        <p className="send-note">100% sells at the model's fair price. Higher earns more per sale but sells less.</p>
      </div>
      <div className="field">
        <label>Cover types</label>
        <div className="rtabs">
          <button className={capped ? 'on' : ''} onClick={() => setCapped((v) => !v)}>Capped</button>
          <button className={open ? 'on' : ''} onClick={() => setOpen((v) => !v)}>Open</button>
        </div>
      </div>
      <div className="field">
        <label>Starting liquidity (USDC)</label>
        <input className="input" inputMode="decimal" value={liquidity} onChange={(e) => setLiquidity(e.target.value.replace(/[^0-9.]/g, ''))} />
        <p className="send-note">Plus a one-off {fmt(fee)} USDC creation fee. You have {fmt(usdc.data ?? 0)} USDC.</p>
      </div>
      {problem && <p className="send-note">{problem}</p>}
      <button className="btn btn-primary" disabled={!!busy || !!problem} onClick={create}>
        {busy ? <><Loader2 className="spin" /> {busy}</> : `Create pool for ${fmt(total)} USDC`}
      </button>
    </section>
  );
}

// ── Portfolio ────────────────────────────────────────────────────────────────

function Portfolio() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const hedges = useQuery({
    queryKey: ['v2-hedges'],
    queryFn: async () => (await api<{ hedges: { position: ProtectionPosition; pair: string; settlement: SettlementResult }[] }>('/api/v2/hedges')).hedges,
    refetchInterval: 30_000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function claim(ref: string) {
    setBusy(ref);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/hedges/${encodeURIComponent(ref)}/claim/prepare`, {});
      await signAndSend(transactions, () => {});
      toast({ title: 'Payout claimed', description: 'The USDC is in your wallet.' });
      void qc.invalidateQueries({ queryKey: ['v2-hedges'] });
    } catch (e) {
      toast({ title: 'Claim failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (hedges.isLoading) return <p className="send-note"><Loader2 className="spin" /> Loading your cover...</p>;
  if (!hedges.data?.length) return <p className="send-note">You have no cover yet. Buy cover to protect a payment.</p>;
  return (
    <section className="cv-view on">
      {hedges.data.map(({ position: p, pair, settlement: s }) => {
        const ref = s.position;
        const claimable = s.status === 'settled_claimable';
        const label = s.status === 'pending' ? 'Active' : claimable ? `Pays ${fmt(s.netPayout)} USDC` : s.status === 'claimed' ? 'Paid' : 'Ended, no payout';
        return (
          <div className="pool-card" key={ref}>
            <div className="pool-top">
              <Flag pair={pair} />
              <div className="pt-nm">
                <div className="a">{worry(pair, p.direction).short} · {p.structure === 'open' ? 'Open' : 'Capped'}</div>
                <div className="b">{fmt(p.notional, 0)} USDC · from {fmtRate(p.strike)}{p.cap ? ` to ${fmtRate(p.cap)}` : ''} {quoteCcy(pair)}</div>
              </div>
              <div className="pool-apr"><div className="v">{label}</div><div className="l">{s.status === 'pending' ? `Ends ${new Date(p.expiry * 1000).toLocaleDateString()}` : ''}</div></div>
            </div>
            {claimable && (
              <button className="btn-sm2 primary" disabled={busy === ref} onClick={() => claim(ref)}>
                {busy === ref ? <Loader2 className="spin" /> : null} Claim {fmt(s.netPayout)} USDC
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
