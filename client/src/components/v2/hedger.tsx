/**
 * Hedger: "What do you want to protect?"
 *
 * Dashboard: USDC, protected exposure, active protections, next expiry, positions.
 * Protect an Exposure, in three steps:
 *   1. exposure (currency and the move that hurts), amount, days (only tenors on offer)
 *   2. today's rate and strike, with Open and Capped side by side; the cap re-prices live
 *   3. review, then Confirm Protection
 * BlockFinaX picks the pool and network; chain details stay under Advanced details.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Loader2, ShieldPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { ProtectionPosition, ProtectionQuote, SettlementResult } from '@shared/domain/types';
import { api } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import {
  Advanced, Flag, Line, Stat, ccyName, dateIn, dateOf, exposureLabel, fmt, fmtRate, pct, quoteCcy, signAndSend,
  useChains, useDebounced, usePools, useUsdcBalances, usdcOn, type Direction,
} from './shared';

type Hedge = { position: ProtectionPosition; pair: string; settlement: SettlementResult };

function useHedges() {
  return useQuery({
    queryKey: ['v2-hedges'],
    queryFn: async () => (await api<{ hedges: Hedge[] }>('/api/v2/hedges')).hedges,
    refetchInterval: 30_000,
  });
}

export function Hedger() {
  const [protecting, setProtecting] = useState(false);
  if (protecting) return <ProtectFlow onClose={() => setProtecting(false)} />;
  return <HedgerDashboard onProtect={() => setProtecting(true)} />;
}

// ── Dashboard ────────────────────────────────────────────────────────────────

function HedgerDashboard({ onProtect }: { onProtect: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const balances = useUsdcBalances();
  const hedges = useHedges();
  const [busy, setBusy] = useState<string | null>(null);

  const active = (hedges.data ?? []).filter((h) => h.settlement.status === 'pending');
  const exposure = active.reduce((s, h) => s + Number(h.position.notional), 0);
  const nextExpiry = active.length ? Math.min(...active.map((h) => h.position.expiry)) : null;

  async function claim(ref: string) {
    setBusy(ref);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/hedges/${encodeURIComponent(ref)}/claim/prepare`, {});
      await signAndSend(transactions, () => {});
      toast({ title: 'Payout received', description: 'The USDC is in your wallet.' });
      void qc.invalidateQueries({ queryKey: ['v2-hedges'] });
      void qc.invalidateQueries({ queryKey: ['v2-usdc-all'] });
    } catch (e) {
      toast({ title: 'Claim failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  return (
    <section className="cv-view on">
      <div className="pool-card">
        <div className="pool-stats">
          <Stat label="USDC balance" value={fmt(balances.data?.total)} />
          <Stat label="Protected exposure" value={`${fmt(exposure, 0)} USDC`} />
          <Stat label="Active protections" value={active.length} />
          <Stat label="Next expiry" value={nextExpiry ? dateOf(nextExpiry) : '-'} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onProtect}><ShieldPlus /> Protect an Exposure</button>
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '18px 0 8px' }}>Your protections</h3>
      {hedges.isLoading && <p className="send-note"><Loader2 className="spin" /> Loading...</p>}
      {!hedges.isLoading && !(hedges.data ?? []).length && <p className="send-note">No protections yet. Protect an exposure to get started.</p>}
      {(hedges.data ?? []).map(({ position: p, pair, settlement: s }) => {
        const ref = s.position;
        const claimable = s.status === 'settled_claimable';
        const status = s.status === 'pending' ? 'Active' : claimable ? `Pays ${fmt(s.netPayout)} USDC` : s.status === 'claimed' ? 'Paid out' : 'Expired, no payout';
        return (
          <div className="pool-card" key={ref}>
            <div className="pool-top">
              <Flag pair={pair} />
              <div className="pt-nm">
                <div className="a">{exposureLabel(pair, p.direction).title}</div>
                <div className="b">{fmt(p.notional, 0)} USDC · {p.structure === 'open' ? 'Open' : 'Capped'} · strike {fmtRate(p.strike)}{p.structure === 'capped' ? ` · cap ${fmtRate(p.cap)}` : ''}</div>
              </div>
              <div className="pool-apr"><div className="v">{status}</div><div className="l">{s.status === 'pending' ? `Expires ${dateOf(p.expiry)}` : ''}</div></div>
            </div>
            {claimable && (
              <button className="btn-sm2 primary" disabled={busy === ref} onClick={() => claim(ref)}>
                {busy === ref ? <Loader2 className="spin" /> : null} Receive {fmt(s.netPayout)} USDC
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ── Protect an Exposure ──────────────────────────────────────────────────────

type Structure = 'open' | 'capped';

function ProtectFlow({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pools = usePools();
  const chains = useChains();
  const balances = useUsdcBalances();

  // Step 1
  const exposures = useMemo(() => {
    const seen = new Map<string, { pair: string; direction: Direction }>();
    for (const p of pools.data ?? []) {
      if (!p.acceptingHedges || Number(p.liquidity.capacity) <= 0) continue;
      for (const d of (p.direction === 'both' ? ['up', 'down'] : [p.direction]) as Direction[]) seen.set(`${p.pair}:${d}`, { pair: p.pair, direction: d });
    }
    return Array.from(seen.values());
  }, [pools.data]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [exposure, setExposure] = useState<{ pair: string; direction: Direction } | null>(null);
  const [amount, setAmount] = useState('1000');
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => { if (!exposure && exposures[0]) setExposure(exposures[0]); }, [exposures, exposure]);

  const pair = exposure?.pair ?? null;
  const direction = exposure?.direction ?? 'up';
  const options = useQuery({
    queryKey: ['v2-options', pair, direction],
    enabled: Boolean(pair),
    queryFn: () => api<{ tenors: { tenorDays: number; open: boolean; capped: boolean; maxPayoutAvailable: string }[] }>(
      `/api/v2/options?pair=${encodeURIComponent(pair!)}&direction=${direction}`),
  });
  useEffect(() => {
    const ts = options.data?.tenors ?? [];
    if (ts.length && !ts.some((t) => t.tenorDays === days)) setDays((ts.find((t) => t.tenorDays >= 14) ?? ts[0]).tenorDays);
  }, [options.data, days]);
  const tenor = options.data?.tenors.find((t) => t.tenorDays === days);

  // Step 2
  const spot = useQuery({
    queryKey: ['v2-spot', pair],
    enabled: Boolean(pair),
    queryFn: async () => Number((await api<{ spot: string }>(`/api/v2/spot?pair=${encodeURIComponent(pair!)}`)).spot),
    refetchInterval: 60_000,
  });
  const pool = useMemo(
    () => (pools.data ?? []).find((p) => p.pair === pair && (p.direction === direction || p.direction === 'both')),
    [pools.data, pair, direction],
  );
  const capMin = (pool?.structures.minCapDistanceBps ?? 300) / 100;
  const capMax = (pool?.structures.maxCapDistanceBps || 2000) / 100;
  const [strikeMovePct, setStrikeMovePct] = useState(2);
  const [capPct, setCapPct] = useState(10);
  const [structure, setStructure] = useState<Structure>('capped');
  useEffect(() => { setCapPct((c) => Math.min(Math.max(c, capMin), capMax)); }, [capMin, capMax]);
  useEffect(() => { if (tenor && !tenor[structure]) setStructure(tenor.capped ? 'capped' : 'open'); }, [tenor, structure]);

  const sign = direction === 'up' ? 1 : -1;
  const strike = spot.data ? spot.data * (1 + (sign * strikeMovePct) / 100) : null;
  const cap = strike ? strike * (1 + (sign * capPct) / 100) : null;
  const base = pair && days && strike && Number(amount) > 0 ? { pair, notional: amount, tenorDays: days, direction, strike: strike.toFixed(6) } : null;

  const cappedReq = useDebounced(base && cap && tenor?.capped ? JSON.stringify({ ...base, structure: 'capped', cap: cap.toFixed(6) }) : null, 350);
  const openReq = useDebounced(base && tenor?.open ? JSON.stringify({ ...base, structure: 'open' }) : null, 350);
  const [refresh, setRefresh] = useState(0);
  const quoteOf = (req: string | null) => ({
    queryKey: ['v2-quote', req, refresh],
    enabled: step >= 2 && Boolean(req),
    retry: false,
    queryFn: () => api<ProtectionQuote>('/api/v2/quotes', JSON.parse(req!)),
  });
  const cappedQuote = useQuery(quoteOf(cappedReq));
  const openQuote = useQuery(quoteOf(openReq));
  const chosen = structure === 'capped' ? cappedQuote : openQuote;

  const [secondsLeft, setSecondsLeft] = useState(0);
  useEffect(() => {
    if (!chosen.data) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round(chosen.data!.expiresAt - Date.now() / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [chosen.data]);

  // Step 3
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const hub = chains.data?.activeLiquidityHub;
  const usdcOnHub = usdcOn(balances.data?.rows, hub);

  async function confirm() {
    const q = chosen.data;
    if (!q) return;
    if (secondsLeft < 5) { setRefresh((n) => n + 1); return; }
    if (usdcOnHub < Number(q.economic.totalCost)) {
      toast({ title: 'Not enough USDC', description: `This needs ${fmt(q.economic.totalCost)} USDC. Add USDC from Receive.`, variant: 'destructive' });
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
      <div className="pool-card" style={{ textAlign: 'center' }}>
        <CheckCircle2 style={{ color: 'var(--green)', width: 44, height: 44, margin: '8px auto' }} />
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>Your exposure is protected</h3>
        <p className="send-note">You can follow it on your dashboard.</p>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onClose}>Back to dashboard</button>
      </div>
    );
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <button className="sheet-x" onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as 1 | 2))}><ArrowLeft /></button>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Protect an Exposure</div>
        <div style={{ fontSize: 12, color: 'var(--tx-3)' }}>Step {step} of 3 · {step === 1 ? 'Your exposure' : step === 2 ? 'Choose protection' : 'Review'}</div>
      </div>
    </div>
  );

  if (pools.isLoading) return <section className="cv-view on">{header}<p className="send-note"><Loader2 className="spin" /> Loading...</p></section>;
  if (!exposures.length) return <section className="cv-view on">{header}<p className="send-note">No protection is available right now. Please check back soon.</p></section>;

  if (step === 1) {
    return (
      <section className="cv-view on">
        {header}
        <div className="field">
          <label>What currency are you exposed to?</label>
          <div style={{ display: 'grid', gap: 8 }}>
            {exposures.map((x) => {
              const l = exposureLabel(x.pair, x.direction);
              const on = exposure?.pair === x.pair && exposure.direction === x.direction;
              return (
                <button key={`${x.pair}:${x.direction}`} className="payway" onClick={() => setExposure(x)} style={on ? { outline: '2px solid var(--blue)' } : undefined}>
                  <span className="pwic"><Flag pair={x.pair} /></span>
                  <span className="pwc"><span className="t">{l.title}</span><span className="s">{l.who}</span></span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="field">
          <label>How much do you want to protect? (USDC)</label>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        <div className="field">
          <label>How many days do you need protection?</label>
          <div className="rtabs" style={{ flexWrap: 'wrap' }}>
            {(options.data?.tenors ?? []).map((t) => (
              <button key={t.tenorDays} className={t.tenorDays === days ? 'on' : ''} onClick={() => setDays(t.tenorDays)}>{t.tenorDays} days</button>
            ))}
          </div>
          {days ? <p className="send-note">Protection runs until {dateIn(days)}.</p> : null}
        </div>
        <button className="btn btn-primary" disabled={!exposure || !days || !(Number(amount) > 0)} onClick={() => setStep(2)}>Continue</button>
      </section>
    );
  }

  const ccy = pair ? quoteCcy(pair) : '';
  const verb = pair ? exposureLabel(pair, direction).verb : '';

  if (step === 2) {
    return (
      <section className="cv-view on">
        {header}
        <div className="pool-card">
          <div className="pool-stats">
            <Stat label="Current rate" value={spot.data ? `${fmtRate(spot.data)} ${ccy}` : '...'} sub="per 1 USD" />
            <Stat label="Protection strike" value={strike ? `${fmtRate(strike)} ${ccy}` : '...'} sub={`${strikeMovePct === 0 ? "at today's rate" : `${strikeMovePct}% from today`}`} />
          </div>
          <div className="rtabs" style={{ marginTop: 8 }}>
            {[0, 2, 5].map((m) => <button key={m} className={strikeMovePct === m ? 'on' : ''} onClick={() => setStrikeMovePct(m)}>{m === 0 ? "Today's rate" : `${m}% away`}</button>)}
          </div>
          <p className="send-note">You are protected if the {pair ? ccyName(pair) : ''} {verb} past the strike.</p>
        </div>

        {tenor?.capped && (
          <button className="pool-card" onClick={() => setStructure('capped')} style={{ textAlign: 'left', width: '100%', outline: structure === 'capped' ? '2px solid var(--blue)' : undefined }}>
            <div style={{ fontWeight: 600 }}>Capped Protection</div>
            <p className="send-note" style={{ marginTop: 2 }}>Covers the move from the strike up to a cap you choose.</p>
            <div className="field" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
              <label>Cap: a {capPct}% move beyond the strike{cap ? ` (${fmtRate(cap)} ${ccy})` : ''}</label>
              <input type="range" min={capMin} max={capMax} step={1} value={capPct} onChange={(e) => { setCapPct(Number(e.target.value)); setStructure('capped'); }} style={{ width: '100%' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--tx-3)' }}>
                <span>Lower cap = cheaper protection</span><span>Higher cap = more protection</span>
              </div>
            </div>
            <div className="brk" style={{ marginTop: 8 }}>
              <Line l="Premium" v={cappedQuote.data ? `${fmt(cappedQuote.data.economic.totalCost)} USDC` : cappedQuote.isFetching ? '...' : '-'} />
              <Line l="Maximum protection" v={cappedQuote.data ? `${fmt(cappedQuote.data.economic.maxPayout)} USDC` : '-'} />
            </div>
            {cappedQuote.error && <p className="send-note" style={{ color: '#e5484d' }}>{(cappedQuote.error as Error).message}</p>}
          </button>
        )}

        {tenor?.open && (
          <button className="pool-card" onClick={() => setStructure('open')} style={{ textAlign: 'left', width: '100%', outline: structure === 'open' ? '2px solid var(--blue)' : undefined }}>
            <div style={{ fontWeight: 600 }}>Open Protection</div>
            <p className="send-note" style={{ marginTop: 2 }}>Covers the whole move past the strike, up to the pool's maximum payout.</p>
            <div className="brk" style={{ marginTop: 8 }}>
              <Line l="Premium" v={openQuote.data ? `${fmt(openQuote.data.economic.totalCost)} USDC` : openQuote.isFetching ? '...' : '-'} />
              <Line l="Maximum protection available" v={openQuote.data ? `${fmt(openQuote.data.economic.maxPayout)} USDC` : '-'} />
            </div>
            {openQuote.error && <p className="send-note" style={{ color: '#e5484d' }}>{(openQuote.error as Error).message}</p>}
          </button>
        )}

        <button className="btn btn-primary" disabled={!chosen.data} onClick={() => setStep(3)}>Review</button>
      </section>
    );
  }

  const q = chosen.data!;
  const e = q.economic;
  return (
    <section className="cv-view on">
      {header}
      <div className="pool-card">
        <div className="pool-top" style={{ marginBottom: 8 }}>
          <Flag pair={e.pair} />
          <div className="pt-nm"><div className="a">{exposureLabel(e.pair, e.direction).title}</div><div className="b">{e.structure === 'open' ? 'Open Protection' : 'Capped Protection'}</div></div>
        </div>
        <div className="brk">
          <Line l="Amount protected" v={`${fmt(e.notional, 0)} USDC`} />
          <Line l="Current rate" v={`${fmtRate(e.spot)} ${ccy}`} />
          <Line l="Strike" v={`${fmtRate(e.strike)} ${ccy}`} />
          <Line l="Protection type" v={e.structure === 'open' ? 'Open' : 'Capped'} />
          {e.structure === 'capped' && <Line l="Cap" v={`${fmtRate(e.cap)} ${ccy}`} />}
          <Line l="Tenor" v={`${e.tenorDays} days`} />
          <Line l="Expiry" v={dateIn(e.tenorDays)} />
          <Line l="Maximum protection" v={`${fmt(e.maxPayout)} USDC`} />
          <Line l="Premium" v={`${fmt(e.premium)} USDC`} />
          <Line l="Execution cost" v={`${fmt(e.hedgerFee)} USDC`} />
          <Line l="Network fees" v="Covered by BlockFinaX" good />
          <Line l="Total cost" v={`${fmt(e.totalCost)} USDC`} total />
        </div>
        <Advanced>
          <Line l="Fair price" v={pct(e.fairRateE6 / 1e6, 3)} />
          <Line l="Offered price" v={pct(e.offerRateE6 / 1e6, 3)} />
          <Line l="Settlement network" v={chains.data?.chains.find((c) => c.key === e.executionChain)?.name ?? e.executionChain} />
          <Line l="Pool" v={`${e.pool.contract.slice(0, 6)}...${e.pool.contract.slice(-4)} · ${e.pool.id}`} />
          <Line l="Quote valid for" v={`${secondsLeft}s`} />
        </Advanced>
      </div>
      <p className="send-note">Your USDC: {fmt(usdcOnHub)}</p>
      <button className="btn btn-primary" disabled={!!busy} onClick={confirm}>
        {busy ? <><Loader2 className="spin" /> {busy}</> : secondsLeft < 5 ? 'Refresh price' : 'Confirm Protection'}
      </button>
    </section>
  );
}
