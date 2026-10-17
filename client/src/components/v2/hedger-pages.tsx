/**
 * Hedger pages: Dashboard, Create Protection (three steps) and My Protections.
 * "What do you want to protect?" BlockFinaX picks the pool and network.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, CheckCircle2, FileText, ShieldCheck, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { ProtectionPosition, ProtectionQuote, SettlementResult } from '@shared/domain/types';
import { api } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import {
  ccyName, dateIn, dateOf, exposureLabel, fmt, fmtRate, pct, quoteCcy, signAndSend, useChains, useDebounced, usePools,
  useUsdcBalances, usdcOn, type Direction,
} from './shared';
import { Card, Ccy, Loading, Row, Spin, StatCard, Steps, Tag } from './ui';
import type { Go } from './workspace';

type Hedge = { position: ProtectionPosition; pair: string; settlement: SettlementResult };

function useHedges() {
  return useQuery({
    queryKey: ['v2-hedges'],
    queryFn: async () => (await api<{ hedges: Hedge[] }>('/api/v2/hedges')).hedges,
    refetchInterval: 30_000,
  });
}

function useSpots(pairs: string[]) {
  const qs = useQueries({
    queries: pairs.map((pair) => ({
      queryKey: ['v2-spot', pair],
      queryFn: async () => Number((await api<{ spot: string }>(`/api/v2/spot?pair=${encodeURIComponent(pair)}`)).spot),
      refetchInterval: 60_000,
    })),
  });
  return new Map(pairs.map((p, i) => [p, qs[i].data]));
}

/** What an active protection would pay if it ended at today's rate. */
function payoutToday(p: ProtectionPosition, spot: number | undefined) {
  if (!spot) return null;
  const strike = Number(p.strike), cap = Number(p.cap), notional = Number(p.notional), entry = Number(p.spot);
  const moved = p.direction === 'up' ? Math.min(spot, cap) - strike : strike - Math.max(spot, cap);
  return Math.max(0, Math.min(Number(p.maxPayout), (notional * moved) / entry));
}

const daysLeft = (expiry: number) => Math.max(0, Math.ceil((expiry - Date.now() / 1000) / 86_400));

// ── Dashboard ────────────────────────────────────────────────────────────────

export function HedgerDashboard({ go }: { go: Go }) {
  const balances = useUsdcBalances();
  const hedges = useHedges();
  const active = (hedges.data ?? []).filter((h) => h.settlement.status === 'pending');
  const spots = useSpots(Array.from(new Set(active.map((h) => h.pair))));
  const exposure = active.reduce((s, h) => s + Number(h.position.notional), 0);
  const next = active.length ? Math.min(...active.map((h) => h.position.expiry)) : null;

  return (
    <>
      <div className="bx-grid bx-stats">
        <StatCard label="Available balance" value={`$${fmt(balances.data?.total)}`} sub="USDC" icon={<Wallet />} />
        <StatCard label="Protected exposure" value={`$${fmt(exposure, 0)}`} sub={`${active.length ? 'across ' + new Set(active.map((h) => h.pair)).size + ' currencies' : 'nothing protected yet'}`} icon={<ShieldCheck />} />
        <StatCard label="Active protections" value={active.length} icon={<FileText />} />
        <StatCard label="Next expiry" value={next ? `${daysLeft(next)} days` : '-'} sub={next ? dateOf(next) : undefined} icon={<CalendarDays />} tone="a" />
      </div>
      <div className="bx-cta"><button className="bx-btn primary big" onClick={() => go('h-protect')}>Protect an Exposure <ArrowRight /></button></div>
      <Card title="Your active protections" action={<button className="bx-link" onClick={() => go('h-protections')}>View all →</button>}>
        {hedges.isLoading ? <Loading /> : !active.length ? (
          <div className="bx-empty">No active protections. Protect an exposure to get started.</div>
        ) : (
          <ProtectionTable rows={active} spots={spots} />
        )}
      </Card>
    </>
  );
}

function ProtectionTable({ rows, spots, onClaim, busy }: { rows: Hedge[]; spots: Map<string, number | undefined>; onClaim?: (ref: string) => void; busy?: string | null }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="bx-table">
        <thead>
          <tr><th>Exposure</th><th>Protection</th><th className="num">Amount</th><th>Expiry</th><th>Status</th><th className="num">Est. payout (today)</th>{onClaim && <th />}</tr>
        </thead>
        <tbody>
          {rows.map(({ position: p, pair, settlement: s }) => {
            const active = s.status === 'pending';
            const today = active ? payoutToday(p, spots.get(pair)) : Number(s.netPayout);
            return (
              <tr key={s.position}>
                <td><Ccy pair={pair} /></td>
                <td>{p.direction === 'up' ? 'Above' : 'Below'} {fmtRate(p.strike)}<div className="sub">{p.structure === 'capped' ? `Capped at ${fmtRate(p.cap)}` : 'Open'}</div></td>
                <td className="num">${fmt(p.notional, 0)}</td>
                <td>{dateOf(p.expiry)}<div className="sub">{active ? `${daysLeft(p.expiry)} days` : 'ended'}</div></td>
                <td>{active ? <Tag tone="green">Active</Tag> : s.status === 'settled_claimable' ? <Tag tone="blue">Payout ready</Tag> : s.status === 'claimed' ? <Tag tone="grey">Paid</Tag> : <Tag tone="grey">Expired</Tag>}</td>
                <td className="num">{today === null ? '-' : `$${fmt(today)}`}</td>
                {onClaim && <td className="num">{s.status === 'settled_claimable' && <button className="bx-btn primary small" disabled={busy === s.position} onClick={() => onClaim(s.position)}>{busy === s.position ? <Spin /> : 'Receive'}</button>}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MyProtections({ go }: { go: Go }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const hedges = useHedges();
  const all = hedges.data ?? [];
  const spots = useSpots(Array.from(new Set(all.map((h) => h.pair))));
  const [busy, setBusy] = useState<string | null>(null);
  async function claim(ref: string) {
    setBusy(ref);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/hedges/${encodeURIComponent(ref)}/claim/prepare`, {});
      await signAndSend(transactions, () => {});
      toast({ title: 'Payout received', description: 'The USDC is in your account.' });
      for (const k of ['v2-hedges', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast({ title: 'Not received', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }
  return (
    <Card title="All protections" action={<button className="bx-btn primary small" onClick={() => go('h-protect')}>Protect an Exposure</button>}>
      {hedges.isLoading ? <Loading /> : !all.length ? <div className="bx-empty">You have not bought protection yet.</div> : <ProtectionTable rows={all} spots={spots} onClaim={claim} busy={busy} />}
    </Card>
  );
}

// ── Create Protection ────────────────────────────────────────────────────────

const AMOUNT_CHIPS = [100, 500, 1000, 5000];

export function ProtectFlow({ go }: { go: Go }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pools = usePools();
  const chains = useChains();
  const balances = useUsdcBalances();
  const [step, setStep] = useState(0);

  const exposures = useMemo(() => {
    const seen = new Map<string, { pair: string; direction: Direction }>();
    for (const p of pools.data ?? []) {
      if (!p.acceptingHedges || Number(p.liquidity.capacity) <= 0) continue;
      for (const d of (p.direction === 'both' ? ['up', 'down'] : [p.direction]) as Direction[]) seen.set(`${p.pair}:${d}`, { pair: p.pair, direction: d });
    }
    return Array.from(seen.values());
  }, [pools.data]);
  const [exposureKey, setExposureKey] = useState<string>('');
  useEffect(() => { if (!exposureKey && exposures[0]) setExposureKey(`${exposures[0].pair}:${exposures[0].direction}`); }, [exposures, exposureKey]);
  const [pair, direction] = (exposureKey || ':up').split(':') as [string, Direction];
  const [amount, setAmount] = useState('1000');
  const [days, setDays] = useState<number | null>(null);

  const options = useQuery({
    queryKey: ['v2-options', pair, direction],
    enabled: Boolean(pair),
    queryFn: () => api<{ tenors: { tenorDays: number; open: boolean; capped: boolean }[] }>(`/api/v2/options?pair=${encodeURIComponent(pair)}&direction=${direction}`),
  });
  useEffect(() => {
    const ts = options.data?.tenors ?? [];
    if (ts.length && !ts.some((t) => t.tenorDays === days)) setDays((ts.find((t) => t.tenorDays >= 14) ?? ts[0]).tenorDays);
  }, [options.data, days]);
  const tenor = options.data?.tenors.find((t) => t.tenorDays === days);

  const spot = useQuery({
    queryKey: ['v2-spot', pair],
    enabled: Boolean(pair),
    queryFn: async () => Number((await api<{ spot: string }>(`/api/v2/spot?pair=${encodeURIComponent(pair)}`)).spot),
    refetchInterval: 60_000,
  });
  const pool = (pools.data ?? []).find((p) => p.pair === pair && (p.direction === direction || p.direction === 'both'));
  const capMin = (pool?.structures.minCapDistanceBps ?? 300) / 100;
  const capMax = (pool?.structures.maxCapDistanceBps || 2000) / 100;
  const sign = direction === 'up' ? 1 : -1;

  const [strikeText, setStrikeText] = useState('');
  useEffect(() => { if (spot.data && !strikeText) setStrikeText((spot.data * (1 + sign * 0.02)).toFixed(2)); }, [spot.data, strikeText, sign]);
  useEffect(() => { setStrikeText(''); }, [pair, direction]);
  const strike = Number(strikeText) > 0 ? Number(strikeText) : null;
  const [capPct, setCapPct] = useState(10);
  useEffect(() => { setCapPct((c) => Math.min(Math.max(c, capMin), capMax)); }, [capMin, capMax]);
  const cap = strike ? strike * (1 + (sign * capPct) / 100) : null;
  const [structure, setStructure] = useState<'open' | 'capped'>('capped');
  useEffect(() => { if (tenor && !tenor[structure]) setStructure(tenor.capped ? 'capped' : 'open'); }, [tenor, structure]);

  const base = pair && days && strike && Number(amount) > 0 ? { pair, notional: amount, tenorDays: days, direction, strike: strike.toFixed(6) } : null;
  const cappedReq = useDebounced(base && cap && tenor?.capped ? JSON.stringify({ ...base, structure: 'capped', cap: cap.toFixed(6) }) : null, 350);
  const openReq = useDebounced(base && tenor?.open ? JSON.stringify({ ...base, structure: 'open' }) : null, 350);
  const [refresh, setRefresh] = useState(0);
  const quoteQuery = (req: string | null) => ({
    queryKey: ['v2-quote', req, refresh],
    enabled: step >= 1 && Boolean(req),
    retry: false,
    queryFn: () => api<ProtectionQuote>('/api/v2/quotes', JSON.parse(req!)),
  });
  const capped = useQuery(quoteQuery(cappedReq));
  const open = useQuery(quoteQuery(openReq));
  const chosen = structure === 'capped' ? capped : open;
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!chosen.data) return;
    const tick = () => setLeft(Math.max(0, Math.round(chosen.data!.expiresAt - Date.now() / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [chosen.data]);

  const hub = chains.data?.activeLiquidityHub;
  const onHub = usdcOn(balances.data?.rows, hub);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const ccy = quoteCcy(pair);

  async function confirm() {
    const q = chosen.data;
    if (!q) return;
    if (left < 5) { setRefresh((n) => n + 1); return; }
    if (onHub < Number(q.economic.totalCost)) {
      toast({ title: 'Not enough USDC', description: `This needs ${fmt(q.economic.totalCost)} USDC. Add funds first.`, variant: 'destructive' });
      return;
    }
    setBusy('Preparing...');
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/hedges/prepare', { quote: q });
      await signAndSend(transactions, (m) => setBusy(m));
      setDone(true);
      for (const k of ['v2-hedges', 'v2-pools', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast({ title: 'Protection not placed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (done) {
    return (
      <Card>
        <div className="bx-empty" style={{ color: 'var(--bx-text)' }}>
          <CheckCircle2 style={{ width: 48, height: 48, color: 'var(--bx-green)' }} />
          <h2 style={{ fontSize: 20, margin: '10px 0 4px' }}>Your exposure is protected</h2>
          <p className="bx-muted">{fmt(amount, 0)} USDC of {exposureLabel(pair, direction).title.toLowerCase()} risk, until {days ? dateIn(days) : ''}.</p>
          <div className="bx-actions" style={{ justifyContent: 'center' }}>
            <button className="bx-btn ghost" onClick={() => { setDone(false); setStep(0); }}>Protect another</button>
            <button className="bx-btn primary" onClick={() => go('h-dashboard')}>Go to dashboard</button>
          </div>
        </div>
      </Card>
    );
  }

  if (pools.isLoading) return <Loading />;
  if (!exposures.length) return <Card><div className="bx-empty">No protection is available right now. Please check back soon.</div></Card>;

  return (
    <>
      <Steps labels={['Exposure', 'Protection', 'Review']} current={step} />

      {step === 0 && (
        <>
          <div className="bx-grid bx-two">
            <Card title="What are you protecting?">
              <div className="bx-field">
                <label>Currency exposure</label>
                <select className="bx-select" value={exposureKey} onChange={(e) => setExposureKey(e.target.value)}>
                  {exposures.map((x) => <option key={`${x.pair}:${x.direction}`} value={`${x.pair}:${x.direction}`}>{quoteCcy(x.pair)} · {exposureLabel(x.pair, x.direction).title}</option>)}
                </select>
                <span className="bx-muted">{exposureLabel(pair, direction).who}</span>
              </div>
              <div className="bx-field">
                <label>Amount (USD)</label>
                <input className="bx-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                <div className="bx-chips">
                  {AMOUNT_CHIPS.map((c) => <button key={c} className={`bx-chip${Number(amount) === c ? ' on' : ''}`} onClick={() => setAmount(String(c))}>${c.toLocaleString()}</button>)}
                </div>
              </div>
            </Card>
            <Card title="How long do you need protection?">
              {options.isLoading ? <Loading /> : (
                <div className="bx-tiles">
                  {(options.data?.tenors ?? []).map((t) => (
                    <button key={t.tenorDays} className={`bx-tile${t.tenorDays === days ? ' on' : ''}`} onClick={() => setDays(t.tenorDays)}>
                      {t.tenorDays} days<span className="d">until {dateIn(t.tenorDays)}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="bx-muted" style={{ marginTop: 12 }}>Only lengths underwriters offer right now are shown.</p>
            </Card>
          </div>
          <div className="bx-actions"><button className="bx-btn primary" disabled={!days || !(Number(amount) > 0)} onClick={() => setStep(1)}>Continue <ArrowRight /></button></div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="bx-grid bx-two">
            <Card>
              <div className="bx-muted">Current USD/{ccy}</div>
              <div style={{ fontSize: 30, fontWeight: 700, marginTop: 4 }}>{spot.data ? fmtRate(spot.data) : '...'}</div>
              <div className="bx-muted">1 USD in {ccyName(pair)}</div>
            </Card>
            <Card>
              <div className="bx-field" style={{ marginBottom: 0 }}>
                <label>Protection starts {direction === 'up' ? 'above' : 'below'}</label>
                <input className="bx-input" inputMode="decimal" value={strikeText} onChange={(e) => setStrikeText(e.target.value.replace(/[^0-9.]/g, ''))} />
                <span className="bx-muted">You are covered if 1 USD {direction === 'up' ? 'rises above' : 'falls below'} this rate.</span>
              </div>
            </Card>
          </div>
          <div className="bx-grid bx-two" style={{ marginTop: 14 }}>
            {tenor?.open && (
              <button className={`bx-option${structure === 'open' ? ' on' : ''}`} onClick={() => setStructure('open')}>
                <div className="t">Open Protection</div>
                <div className="d">Covers the whole move past your rate, up to the pool's maximum payout.</div>
                <div className="bx-rows" style={{ marginTop: 12 }}>
                  <Row l="Premium" v={open.data ? `${pct(open.data.economic.offerRateE6 / 1e6)} · $${fmt(open.data.economic.totalCost)}` : open.isFetching ? '...' : '-'} />
                  <Row l="Maximum protection available" v={open.data ? `$${fmt(open.data.economic.maxPayout)}` : '-'} />
                </div>
                {open.error && <p className="bx-error">{(open.error as Error).message}</p>}
              </button>
            )}
            {tenor?.capped && (
              <div className={`bx-option${structure === 'capped' ? ' on' : ''}`} onClick={() => setStructure('capped')} role="button">
                <div className="t">Capped Protection</div>
                <div className="d">Covers the move between {strike ? fmtRate(strike) : 'your rate'} and a maximum rate you choose.</div>
                <div className="bx-rows" style={{ marginTop: 12 }}>
                  <Row l="Premium" v={capped.data ? `${pct(capped.data.economic.offerRateE6 / 1e6)} · $${fmt(capped.data.economic.totalCost)}` : capped.isFetching ? '...' : '-'} />
                  <Row l="Maximum protection" v={capped.data ? `$${fmt(capped.data.economic.maxPayout)}` : '-'} />
                </div>
                <div className="bx-field" style={{ marginTop: 12, marginBottom: 0 }}>
                  <label>Maximum protected rate (cap): <b style={{ color: 'var(--bx-text)' }}>{cap ? fmtRate(cap) : '-'}</b></label>
                  <input className="bx-range" type="range" min={capMin} max={capMax} step={1} value={capPct} onChange={(e) => { setCapPct(Number(e.target.value)); setStructure('capped'); }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }} className="bx-muted">
                    <span>Lower cap = cheaper</span><span>Higher cap = more protection</span>
                  </div>
                </div>
                {capped.error && <p className="bx-error">{(capped.error as Error).message}</p>}
              </div>
            )}
          </div>
          <div className="bx-actions">
            <button className="bx-btn ghost" onClick={() => setStep(0)}>Back</button>
            <button className="bx-btn primary" disabled={!chosen.data} onClick={() => setStep(2)}>Review <ArrowRight /></button>
          </div>
        </>
      )}

      {step === 2 && chosen.data && (() => {
        const e = chosen.data.economic;
        return (
          <div className="bx-grid bx-wide">
            <Card title="Review Protection">
              <p style={{ marginTop: -4, marginBottom: 12 }}>You are protecting <b>${fmt(e.notional, 0)}</b> of {ccy} exposure.</p>
              <div className="bx-rows">
                <Row l="Current rate" v={fmtRate(e.spot)} />
                <Row l="Protection starts" v={fmtRate(e.strike)} />
                <Row l="Protection type" v={e.structure === 'open' ? 'Open' : 'Capped'} />
                {e.structure === 'capped' && <Row l="Maximum protected rate" v={fmtRate(e.cap)} />}
                <Row l="Duration" v={`${e.tenorDays} days`} />
                <Row l="Expiry" v={dateIn(e.tenorDays)} />
                <Row l="Maximum protection" v={`$${fmt(e.maxPayout)}`} />
                <Row l="Premium" v={`${pct(e.offerRateE6 / 1e6)} ($${fmt(e.premium)})`} />
                <Row l="Execution cost" v={`$${fmt(e.hedgerFee)}`} />
                <Row l="Network fees" v="Covered by BlockFinaX" good />
                <Row l="Total" v={`$${fmt(e.totalCost)}`} total />
              </div>
              <div className="bx-actions">
                <button className="bx-btn ghost" onClick={() => setStep(1)}>Back</button>
                <button className="bx-btn primary" disabled={!!busy} onClick={confirm}>{busy ? <><Spin /> {busy}</> : left < 5 ? 'Refresh price' : 'Confirm Protection'}</button>
              </div>
            </Card>
            <Card title="Payment">
              <div className="bx-rows">
                <Row l="You pay" v={`$${fmt(e.totalCost)} USDC`} />
                <Row l="Your balance" v={`$${fmt(onHub)} USDC`} />
                <Row l="Price held for" v={`${left}s`} />
              </div>
              {onHub < Number(e.totalCost) && <p className="bx-note warn" style={{ marginTop: 12 }}>Your balance is too low. Add funds, then come back.</p>}
              <details style={{ marginTop: 14 }}>
                <summary className="bx-muted" style={{ cursor: 'pointer' }}>Advanced details</summary>
                <div className="bx-rows" style={{ marginTop: 8 }}>
                  <Row l="Fair price" v={pct(e.fairRateE6 / 1e6, 3)} />
                  <Row l="Offered price" v={pct(e.offerRateE6 / 1e6, 3)} />
                  <Row l="Settlement network" v={chains.data?.chains.find((c) => c.key === e.executionChain)?.name ?? e.executionChain} />
                  <Row l="Pool" v={`${e.pool.contract.slice(0, 6)}...${e.pool.contract.slice(-4)} · ${e.pool.id}`} />
                </div>
              </details>
            </Card>
          </div>
        );
      })()}
    </>
  );
}
