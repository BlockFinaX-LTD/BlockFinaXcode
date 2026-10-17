/**
 * Underwriter pages: "How do you want your capital exposed?"
 * Dashboard, My Pools, Create Pool (four steps), Tenor Pricing, Risk & Exposure, Withdraw.
 * All tenors share one pool's liquidity. BlockFinaX computes the fair price; the
 * underwriter sets the offer, stored on chain as a markup on fair (90% to 500%).
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BarChart3, CalendarDays, CircleDollarSign, FileText, Hourglass, Lock, PieChart, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { CurrencyPool, ProtectionPosition } from '@shared/domain/types';
import { api } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import { usePasskeySession } from '@/lib/identity';
import {
  ccyName, dateOf, exposureLabel, fmt, pct, poolRef, quoteCcy, routeFunding, signAndSend, useChains, usePools,
  useUsdcBalances, usdcOn, type Direction,
} from './shared';
import { Card, Ccy, Loading, Row, Spin, StatCard, Steps, Tag, Toggle } from './ui';
import type { Go } from './workspace';

const MARKUP_MIN = 9000;
const MARKUP_MAX = 50000;
type Stake = { shares: string; value: string };
type Withdrawal = { chain: string; requestId: number; poolId: number; shares: string; unlockAt: number; status: string };

const sharePrice = (p: CurrencyPool) => (Number(p.totalShares) > 0 ? Number(p.liquidity.nav) / Number(p.totalShares) : 1);
const poolName = (p: CurrencyPool) => (p.direction === 'both' ? `${ccyName(p.pair)}, both directions` : exposureLabel(p.pair, p.direction).title);
const shortDate = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function useStakes(pools: CurrencyPool[]) {
  const qs = useQueries({
    queries: pools.map((p) => ({
      queryKey: ['v2-lp', poolRef(p)],
      queryFn: () => api<Stake>(`/api/v2/pools/${encodeURIComponent(poolRef(p))}/lp`),
      refetchInterval: 30_000,
    })),
  });
  return new Map(pools.map((p, i) => [poolRef(p), qs[i].data]));
}

function usePoolPositions(pools: CurrencyPool[]) {
  const qs = useQueries({
    queries: pools.map((p) => ({
      queryKey: ['v2-pool-positions', poolRef(p)],
      queryFn: async () => (await api<{ positions: ProtectionPosition[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(p))}/positions`)).positions,
      refetchInterval: 60_000,
    })),
  });
  return new Map(pools.map((p, i) => [poolRef(p), qs[i].data ?? []]));
}

function releasesOf(positions: ProtectionPosition[], share = 1) {
  const byDay = new Map<string, number>();
  for (const p of positions) {
    const day = new Date(p.expiry * 1000).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(p.maxPayout) * share);
  }
  return byDay;
}

/** Pools the user is in (stake) or created, and their share of each. */
function useMyBook() {
  const pools = usePools();
  const all = pools.data ?? [];
  const stakes = useStakes(all);
  const { session } = usePasskeySession();
  const mine = new Set((session?.accounts ?? []).map((a) => a.address));
  const yours = all.filter((p) => Number(stakes.get(poolRef(p))?.value ?? 0) > 0 || mine.has(p.creator));
  return { pools, all, stakes, yours, isCreator: (p: CurrencyPool) => mine.has(p.creator) };
}

function PoolPicker({ pools, value, onChange }: { pools: CurrencyPool[]; value: string | null; onChange: (ref: string) => void }) {
  return (
    <select className="bx-select" style={{ maxWidth: 360 }} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {pools.map((p) => <option key={poolRef(p)} value={poolRef(p)}>{quoteCcy(p.pair)} · {poolName(p)} · ${fmt(p.liquidity.nav, 0)}</option>)}
    </select>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export function UnderwriterDashboard({ go }: { go: Go }) {
  const { all, stakes, yours } = useMyBook();
  const positions = usePoolPositions(all);
  let committed = 0, reserved = 0, earned = 0, hedges = 0;
  const releases = new Map<string, number>();
  for (const p of all) {
    const s = stakes.get(poolRef(p));
    const value = Number(s?.value ?? 0);
    if (value <= 0) continue;
    const share = value / (Number(p.liquidity.nav) || 1);
    committed += value;
    reserved += Number(p.liquidity.reserved) * share;
    earned += Number(s!.shares) * (sharePrice(p) - 1);
    hedges += p.activePositions;
    releasesOf(positions.get(poolRef(p)) ?? [], share).forEach((v, k) => releases.set(k, (releases.get(k) ?? 0) + v));
  }
  const available = committed - reserved;
  const upcoming = Array.from(releases.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(0, 4);
  const usage = committed > 0 ? reserved / committed : 0;

  return (
    <>
      <div className="bx-grid bx-stats">
        <StatCard label="Capital committed" value={`$${fmt(committed, 0)}`} sub="USDC" icon={<CircleDollarSign />} />
        <StatCard label="Capital reserved" value={`$${fmt(reserved, 0)}`} sub={pct(usage, 0)} icon={<Lock />} tone="a" />
        <StatCard label="Available capacity" value={`$${fmt(available, 0)}`} sub={pct(1 - usage, 0)} icon={<PieChart />} tone="g" />
        <StatCard label="Premium earned" value={`$${fmt(earned)}`} sub={committed > 0 ? `+${pct(earned / committed, 1)}` : undefined} subTone="up" icon={<BarChart3 />} tone="g" />
        <StatCard label="Active hedges" value={hedges} icon={<FileText />} />
      </div>
      <div className="bx-grid bx-two" style={{ marginTop: 14 }}>
        <Card title="Capital usage">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="bx-bar" style={{ flex: 1 }}><i style={{ width: `${usage * 100}%`, background: 'var(--bx-teal)' }} /></div>
            <b>{pct(usage, 0)}</b>
          </div>
          <div className="bx-legend">
            <div><div className="k"><i style={{ background: 'var(--bx-teal)' }} />Reserved</div><div className="v">${fmt(reserved, 0)}</div></div>
            <div><div className="k"><i style={{ background: '#cfe7e3' }} />Available</div><div className="v">${fmt(available, 0)}</div></div>
          </div>
        </Card>
        <Card title="Upcoming capital releases" action={<button className="bx-link" onClick={() => go('u-risk')}>View all →</button>}>
          {upcoming.length ? upcoming.map(([day, amount]) => (
            <div className="bx-release" key={day}>
              <span className="a"><CalendarDays />${fmt(amount, 0)} in {Math.max(0, Math.ceil((new Date(day).getTime() - Date.now()) / 86_400_000))} days</span>
              <span className="bx-muted">{shortDate(day)}</span>
            </div>
          )) : <div className="bx-empty">No capital is reserved right now.</div>}
        </Card>
      </div>
      <Card title="Your pools" action={<button className="bx-btn primary small" onClick={() => go('u-create')}>Create Pool</button>} className="bx-mt">
        {!yours.length ? <div className="bx-empty">You have no capital committed yet. Create a pool, or add liquidity from My Pools.</div> : <PoolTable pools={yours} stakes={stakes} go={go} />}
      </Card>
    </>
  );
}

function PoolTable({ pools, stakes, go, onAdd }: { pools: CurrencyPool[]; stakes: Map<string, Stake | undefined>; go: Go; onAdd?: (p: CurrencyPool) => void }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 4 }}>
      <table className="bx-table">
        <thead><tr><th>Pool</th><th className="num">Liquidity</th><th className="num">Available</th><th className="num">In use</th><th className="num bx-hide-sm">Share value</th><th className="num">Your capital</th><th /></tr></thead>
        <tbody>
          {pools.map((p) => {
            const nav = Number(p.liquidity.nav);
            return (
              <tr key={poolRef(p)}>
                <td><Ccy pair={p.pair}>{poolName(p)}</Ccy><div className="sub">{p.tenors.filter((t) => t.active).map((t) => `${t.tenorDays}d`).join(' · ')}</div></td>
                <td className="num">${fmt(nav, 0)}</td>
                <td className="num">${fmt(p.liquidity.capacity, 0)}</td>
                <td className="num">{pct(nav > 0 ? Number(p.liquidity.reserved) / nav : 0, 0)}</td>
                <td className="num bx-hide-sm">{sharePrice(p).toFixed(4)}</td>
                <td className="num">${fmt(stakes.get(poolRef(p))?.value ?? 0)}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {onAdd && p.allowExternalLp && <button className="bx-btn primary small" onClick={() => onAdd(p)}>Add Liquidity</button>}{' '}
                  <button className="bx-btn ghost small" onClick={() => go('u-risk', poolRef(p))}>Manage</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── My Pools and Add Liquidity ───────────────────────────────────────────────

export function MyPools({ go }: { go: Go }) {
  const { pools, all, stakes, yours } = useMyBook();
  const others = all.filter((p) => !yours.includes(p));
  const [adding, setAdding] = useState<CurrencyPool | null>(null);
  if (pools.isLoading) return <Loading />;
  return (
    <>
      {adding && <AddLiquidity pool={adding} onClose={() => setAdding(null)} />}
      <Card title="Your pools" action={<button className="bx-btn primary small" onClick={() => go('u-create')}>Create Pool</button>}>
        {!yours.length ? <div className="bx-empty">You have no pools yet.</div> : <PoolTable pools={yours} stakes={stakes} go={go} onAdd={setAdding} />}
      </Card>
      {others.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Card title="Open to new capital"><PoolTable pools={others} stakes={stakes} go={go} onAdd={setAdding} /></Card>
        </div>
      )}
    </>
  );
}

function FundingNetwork({ value, onChange }: { value: string | null; onChange: (k: string) => void }) {
  const chains = useChains();
  const balances = useUsdcBalances();
  const hub = chains.data?.activeLiquidityHub;
  const funding = (chains.data?.chains ?? []).filter((c) => c.capabilities.funding);
  useEffect(() => { if (!value && hub) onChange(hub); }, [hub, value, onChange]);
  return (
    <div className="bx-field">
      <label>Funding network</label>
      <select className="bx-select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {funding.map((c) => <option key={c.key} value={c.key}>{c.name}{c.key === hub ? ' (Recommended)' : ''} · ${fmt(usdcOn(balances.data?.rows, c.key))} USDC</option>)}
      </select>
      {value && hub && value !== hub
        ? <span className="bx-muted">Funds will be routed to the active liquidity hub ({chains.data?.chains.find((c) => c.key === hub)?.name}).</span>
        : <span className="bx-muted">This is the active liquidity hub. No routing needed.</span>}
    </div>
  );
}

function AddLiquidity({ pool, onClose }: { pool: CurrencyPool; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chains = useChains();
  const balances = useUsdcBalances();
  const [network, setNetwork] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const hub = chains.data?.activeLiquidityHub;
  const have = usdcOn(balances.data?.rows, network ?? hub);
  async function add() {
    setBusy('Preparing...');
    try {
      if (network && hub && network !== hub) await routeFunding({ network, amount, hubName: chains.data?.chains.find((c) => c.key === hub)?.name });
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/deposits/prepare`, { amount });
      await signAndSend(transactions, (m) => setBusy(m));
      toast({ title: 'Liquidity added', description: `$${fmt(amount)} committed to ${poolName(pool)}.` });
      for (const k of ['v2-pools', 'v2-lp', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    } catch (e) {
      toast({ title: 'Not added', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }
  return (
    <div style={{ marginBottom: 14 }}>
      <Card title={<>Add Liquidity · <Ccy pair={pool.pair}>{poolName(pool)}</Ccy></>} action={<button className="bx-link" onClick={onClose}>Cancel</button>}>
        <div className="bx-grid bx-two">
          <div>
            <div className="bx-field">
              <label>Amount (USDC)</label>
              <input className="bx-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
              <span className="bx-muted">Available on this network: ${fmt(have)}</span>
            </div>
            <FundingNetwork value={network} onChange={setNetwork} />
          </div>
          <div className="bx-note">You earn premiums from {exposureLabel(pool.pair, pool.direction === 'down' ? 'down' : 'up').title.toLowerCase()} protection and pay out if it happens. All of this pool's tenors share your capital.</div>
        </div>
        <div className="bx-actions"><button className="bx-btn primary" disabled={!!busy || !(Number(amount) > 0) || Number(amount) > have} onClick={add}>{busy ? <><Spin /> {busy}</> : 'Add Liquidity'}</button></div>
      </Card>
    </div>
  );
}

// ── Create Pool ──────────────────────────────────────────────────────────────

type TenorDraft = { tenorDays: number; offerPct: string; active: boolean };
const CAPITAL_CHIPS = [100, 250, 500, 1000];

function useFair(pair: string | null, direction: Direction, days: number[]) {
  return useQuery({
    queryKey: ['v2-fair', pair, direction, days.join(',')],
    enabled: Boolean(pair) && days.length > 0,
    queryFn: () => api<{ rows: { tenorDays: number; fairRateE6: number | null }[] }>(`/api/v2/fair?pair=${encodeURIComponent(pair!)}&direction=${direction}&tenors=${days.join(',')}`),
    staleTime: 60_000,
  });
}

export function CreatePoolWizard({ go }: { go: Go }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chains = useChains();
  const balances = useUsdcBalances();
  const setup = useQuery({ queryKey: ['v2-pool-setup'], queryFn: () => api<{ chain: string; pairs: string[]; creationFee: string }>('/api/v2/pools/setup') });
  const [step, setStep] = useState(0);
  const exposures = useMemo(() => (setup.data?.pairs ?? []).flatMap((pair) => (['up', 'down'] as Direction[]).map((d) => `${pair}:${d}`)), [setup.data]);
  const [exposureKey, setExposureKey] = useState('');
  useEffect(() => { if (!exposureKey && exposures[0]) setExposureKey(exposures[0]); }, [exposures, exposureKey]);
  const [pair, direction] = (exposureKey || ':up').split(':') as [string, Direction];
  const [amount, setAmount] = useState('500');
  const [network, setNetwork] = useState<string | null>(null);
  const [tenors, setTenors] = useState<TenorDraft[]>([3, 7, 14, 30].map((d) => ({ tenorDays: d, offerPct: '', active: true })));
  const [newDays, setNewDays] = useState('');
  const [openOn, setOpenOn] = useState(true);
  const [cappedOn, setCappedOn] = useState(true);
  const [minCap, setMinCap] = useState('3');
  const [maxCap, setMaxCap] = useState('20');
  const [openMax, setOpenMax] = useState('30');
  const [busy, setBusy] = useState<string | null>(null);
  const fair = useFair(pair || null, direction, tenors.map((t) => t.tenorDays));
  const fairOf = (d: number) => fair.data?.rows.find((r) => r.tenorDays === d)?.fairRateE6 ?? null;

  // Default offer: 115% of fair, filled once fair prices arrive.
  useEffect(() => {
    setTenors((ts) => ts.map((t) => {
      const f = fairOf(t.tenorDays);
      return t.offerPct || !f ? t : { ...t, offerPct: ((f / 1e6) * 1.15 * 100).toFixed(2) };
    }));
  }, [fair.data]);

  const markupOf = (t: TenorDraft) => {
    const f = fairOf(t.tenorDays);
    return f && Number(t.offerPct) > 0 ? Math.round(((Number(t.offerPct) / 100) / (f / 1e6)) * 10000) : 11500;
  };
  const hub = chains.data?.activeLiquidityHub;
  const hubName = chains.data?.chains.find((c) => c.key === hub)?.name;
  const fee = Number(setup.data?.creationFee ?? 0);
  const total = Number(amount || 0) + fee;
  const have = usdcOn(balances.data?.rows, network ?? hub);
  const tenorProblem = !tenors.some((t) => t.active) ? 'Turn on at least one tenor' : tenors.some((t) => markupOf(t) < MARKUP_MIN || markupOf(t) > MARKUP_MAX) ? 'Each offer must be 90% to 500% of the fair price' : null;
  const structProblem = !openOn && !cappedOn ? 'Offer at least one protection type' : Number(maxCap) > 0 && Number(minCap) > Number(maxCap) ? 'The smallest cap must be below the largest' : null;
  const capitalProblem = !(Number(amount) >= 10) ? 'Commit at least $10' : total > have ? `You need $${fmt(total)} USDC on this network` : null;

  async function create() {
    setBusy('Preparing...');
    try {
      if (network && hub && network !== hub) await routeFunding({ network, amount: String(total), hubName });
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/pools/prepare', {
        pair, direction, allowExternalLp: true, initialLiquidity: amount,
        structures: { open: openOn, capped: cappedOn, minCapDistanceBps: Math.round(Number(minCap) * 100), maxCapDistanceBps: Math.round(Number(maxCap) * 100), openMaxPayoutBps: Math.round(Number(openMax) * 100) },
        tenors: tenors.map((t) => ({ tenorDays: t.tenorDays, active: t.active, markupBps: markupOf(t) })),
      });
      await signAndSend(transactions, (m) => setBusy(m));
      toast({ title: 'Pool created', description: `${exposureLabel(pair, direction).title} pool is live.` });
      for (const k of ['v2-pools', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
      go('u-pools');
    } catch (e) {
      toast({ title: 'Pool not created', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  const summary = (
    <Card title="Pool summary">
      {pair && <div style={{ marginBottom: 10 }}><Ccy pair={pair}>{exposureLabel(pair, direction).title} pool</Ccy></div>}
      <div className="bx-rows">
        <Row l="Liquidity" v={`$${fmt(amount)} USDC`} />
        <Row l="Funding network" v={chains.data?.chains.find((c) => c.key === (network ?? hub))?.name ?? '-'} />
        <Row l="Active liquidity hub" v={hubName ?? '-'} />
        <Row l="Tenors" v={tenors.filter((t) => t.active).map((t) => `${t.tenorDays}d`).join(', ') || '-'} />
        <Row l="Protection" v={[cappedOn && 'Capped', openOn && 'Open'].filter(Boolean).join(' and ') || '-'} />
        <Row l="Creation fee" v={`$${fmt(fee)}`} />
        <Row l="Total" v={`$${fmt(total)}`} total />
      </div>
      <p className="bx-note" style={{ marginTop: 12 }}>You can fund from any supported network. BlockFinaX will route the funds automatically.</p>
    </Card>
  );

  if (setup.isLoading) return <Loading />;
  return (
    <>
      <Steps labels={['Currency & Capital', 'Tenor Configuration', 'Protection Structures', 'Review']} current={step} />
      <div className="bx-grid bx-wide">
        <div>
          {step === 0 && (
            <Card>
              <div className="bx-field">
                <label>Underwrite</label>
                <select className="bx-select" value={exposureKey} onChange={(e) => setExposureKey(e.target.value)}>
                  {exposures.map((k) => { const [p, d] = k.split(':') as [string, Direction]; return <option key={k} value={k}>{quoteCcy(p)} · {exposureLabel(p, d).title}</option>; })}
                </select>
                {pair && <span className="bx-muted">You pay out if the {ccyName(pair)} {exposureLabel(pair, direction).verb} past what buyers chose, and earn their premiums otherwise.</span>}
              </div>
              <div className="bx-field">
                <label>Commit liquidity (USDC)</label>
                <input className="bx-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                <div className="bx-chips">{CAPITAL_CHIPS.map((c) => <button key={c} className={`bx-chip${Number(amount) === c ? ' on' : ''}`} onClick={() => setAmount(String(c))}>${c.toLocaleString()}</button>)}</div>
              </div>
              <FundingNetwork value={network} onChange={setNetwork} />
              {capitalProblem && <p className="bx-error">{capitalProblem}</p>}
              <div className="bx-actions"><button className="bx-btn primary" disabled={!!capitalProblem} onClick={() => setStep(1)}>Continue <ArrowRight /></button></div>
            </Card>
          )}
          {step === 1 && (
            <Card title="Set your pricing for each tenor">
              <table className="bx-table">
                <thead><tr><th>Tenor</th><th className="num">Model fair price</th><th className="num">Your offer</th><th className="num">Difference</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {tenors.map((t, i) => {
                    const f = fairOf(t.tenorDays);
                    const diff = f && Number(t.offerPct) > 0 ? Math.round((Number(t.offerPct) / 100 - f / 1e6) * 10000) : null;
                    return (
                      <tr key={t.tenorDays}>
                        <td><b>{t.tenorDays} days</b></td>
                        <td className="num">{f ? pct(f / 1e6) : fair.isLoading ? '...' : '-'}</td>
                        <td className="num"><input className="bx-input" style={{ width: 90, textAlign: 'right', padding: '6px 8px' }} value={t.offerPct} onChange={(e) => setTenors((ts) => ts.map((x, j) => j === i ? { ...x, offerPct: e.target.value.replace(/[^0-9.]/g, '') } : x))} /> %</td>
                        <td className="num" style={{ color: diff !== null && diff >= 0 ? 'var(--bx-green)' : 'var(--bx-red)' }}>{diff === null ? '-' : `${diff >= 0 ? '+' : ''}${diff} bps`}</td>
                        <td><Toggle on={t.active} onChange={(v) => setTenors((ts) => ts.map((x, j) => j === i ? { ...x, active: v } : x))} /></td>
                        <td className="num"><button className="bx-link" onClick={() => setTenors((ts) => ts.filter((_, j) => j !== i))} title="Remove"><Trash2 style={{ width: 15 }} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="bx-note" style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="bx-field" style={{ margin: 0 }}><label>Add custom tenor (days)</label><input className="bx-input" style={{ width: 120 }} inputMode="numeric" value={newDays} onChange={(e) => setNewDays(e.target.value.replace(/\D/g, ''))} /></div>
                <button className="bx-btn primary small" disabled={!(Number(newDays) >= 1 && Number(newDays) <= 365) || tenors.some((t) => t.tenorDays === Number(newDays))}
                  onClick={() => { setTenors((ts) => [...ts, { tenorDays: Number(newDays), offerPct: '', active: true }].sort((a, b) => a.tenorDays - b.tenorDays)); setNewDays(''); }}>Add Tenor</button>
              </div>
              <p className="bx-muted" style={{ marginTop: 10 }}>BlockFinaX calculates the fair price; you choose the offer. All tenors share this pool's liquidity.</p>
              {tenorProblem && <p className="bx-error">{tenorProblem}</p>}
              <div className="bx-actions"><button className="bx-btn ghost" onClick={() => setStep(0)}>Back</button><button className="bx-btn primary" disabled={!!tenorProblem} onClick={() => setStep(2)}>Continue <ArrowRight /></button></div>
            </Card>
          )}
          {step === 2 && (
            <Card title="Protection structures">
              <div className="bx-grid bx-two">
                <div className={`bx-option${cappedOn ? ' on' : ''}`}>
                  <div className="t"><Toggle on={cappedOn} onChange={setCappedOn} /> Capped Protection</div>
                  <div className="d">Hedgers choose a cap between your boundaries.</div>
                  {cappedOn && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <div className="bx-field" style={{ margin: 0 }}><label>Smallest cap (%)</label><input className="bx-input" value={minCap} onChange={(e) => setMinCap(e.target.value.replace(/[^0-9.]/g, ''))} /></div>
                      <div className="bx-field" style={{ margin: 0 }}><label>Largest cap (%)</label><input className="bx-input" value={maxCap} onChange={(e) => setMaxCap(e.target.value.replace(/[^0-9.]/g, ''))} /></div>
                    </div>
                  )}
                </div>
                <div className={`bx-option${openOn ? ' on' : ''}`}>
                  <div className="t"><Toggle on={openOn} onChange={setOpenOn} /> Open Protection</div>
                  <div className="d">Pays the whole move, up to your maximum payout.</div>
                  {openOn && <div className="bx-field" style={{ marginTop: 10, marginBottom: 0 }}><label>Maximum payout (% of amount)</label><input className="bx-input" value={openMax} onChange={(e) => setOpenMax(e.target.value.replace(/[^0-9.]/g, ''))} /></div>}
                </div>
              </div>
              {structProblem && <p className="bx-error">{structProblem}</p>}
              <div className="bx-actions"><button className="bx-btn ghost" onClick={() => setStep(1)}>Back</button><button className="bx-btn primary" disabled={!!structProblem} onClick={() => setStep(3)}>Continue <ArrowRight /></button></div>
            </Card>
          )}
          {step === 3 && (
            <Card title="Review">
              <div className="bx-rows">
                <Row l="Underwrite" v={exposureLabel(pair, direction).title} />
                <Row l="Committed liquidity" v={`$${fmt(amount)} USDC`} />
                {tenors.filter((t) => t.active).map((t) => <Row key={t.tenorDays} l={`${t.tenorDays}-day offer`} v={`${t.offerPct}%`} />)}
                {cappedOn && <Row l="Capped Protection" v={`caps ${minCap}% to ${maxCap}%`} />}
                {openOn && <Row l="Open Protection" v={`max payout ${openMax}%`} />}
                <Row l="Creation fee" v={`$${fmt(fee)}`} />
                <Row l="Network fees" v="Covered by BlockFinaX" good />
                <Row l="Total" v={`$${fmt(total)} USDC`} total />
              </div>
              <div className="bx-actions"><button className="bx-btn ghost" onClick={() => setStep(2)}>Back</button><button className="bx-btn primary" disabled={!!busy} onClick={create}>{busy ? <><Spin /> {busy}</> : 'Create Pool'}</button></div>
            </Card>
          )}
        </div>
        {summary}
      </div>
    </>
  );
}

// ── Tenor Pricing ────────────────────────────────────────────────────────────

export function TenorPricing({ focus }: { focus: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { pools, yours, isCreator } = useMyBook();
  const editable = yours.filter(isCreator);
  const [ref, setRef] = useState<string | null>(focus);
  useEffect(() => { if ((!ref || !editable.some((p) => poolRef(p) === ref)) && editable[0]) setRef(poolRef(editable[0])); }, [editable, ref]);
  const pool = editable.find((p) => poolRef(p) === ref) ?? null;
  const direction: Direction = pool?.direction === 'down' ? 'down' : 'up';
  const [extra, setExtra] = useState<number[]>([]);
  const days = pool ? Array.from(new Set([...pool.tenors.map((t) => t.tenorDays), ...extra])).sort((a, b) => a - b) : [];
  const fair = useFair(pool?.pair ?? null, direction, days);
  const fairOf = (d: number) => fair.data?.rows.find((r) => r.tenorDays === d)?.fairRateE6 ?? null;
  const [offers, setOffers] = useState<Record<number, string>>({});
  const [newDays, setNewDays] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => { setOffers({}); setExtra([]); }, [ref]);

  async function save(tenorDays: number, active: boolean, markupBps: number) {
    if (!pool) return;
    setBusy(tenorDays);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/tenors/prepare`, { tenorDays, active, markupBps });
      await signAndSend(transactions, () => {});
      toast({ title: `${tenorDays}-day tenor saved` });
      setExtra((x) => x.filter((d) => d !== tenorDays));
      setOffers((o) => { const n = { ...o }; delete n[tenorDays]; return n; });
      void qc.invalidateQueries({ queryKey: ['v2-pools'] });
    } catch (e) {
      toast({ title: 'Not saved', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (pools.isLoading) return <Loading />;
  if (!editable.length) return <Card><div className="bx-empty">Tenor pricing is set by a pool's creator. Create a pool to set your own prices.</div></Card>;
  return (
    <Card title={<PoolPicker pools={editable} value={ref} onChange={setRef} />} action={<span className="bx-muted">All tenors share this pool's liquidity</span>}>
      <div style={{ overflowX: 'auto' }}>
        <table className="bx-table">
          <thead><tr><th>Tenor</th><th className="num">Model fair price</th><th className="num">Your offer</th><th className="num">Difference</th><th>Status</th><th /></tr></thead>
          <tbody>
            {days.map((d) => {
              const t = pool?.tenors.find((x) => x.tenorDays === d);
              const f = fairOf(d);
              const markup = t?.markupBps ?? 11500;
              const offer = offers[d] ?? (f ? ((f / 1e6) * (markup / 10000) * 100).toFixed(2) : '');
              const newMarkup = f && Number(offer) > 0 ? Math.round(((Number(offer) / 100) / (f / 1e6)) * 10000) : markup;
              const diff = f && Number(offer) > 0 ? Math.round((Number(offer) / 100 - f / 1e6) * 10000) : null;
              const valid = newMarkup >= MARKUP_MIN && newMarkup <= MARKUP_MAX;
              const changed = !t || newMarkup !== t.markupBps;
              return (
                <tr key={d}>
                  <td><b>{d} days</b></td>
                  <td className="num">{f ? pct(f / 1e6) : fair.isLoading ? '...' : '-'}</td>
                  <td className="num"><input className="bx-input" style={{ width: 90, textAlign: 'right', padding: '6px 8px' }} value={offer} onChange={(e) => setOffers((o) => ({ ...o, [d]: e.target.value.replace(/[^0-9.]/g, '') }))} /> %</td>
                  <td className="num" style={{ color: diff !== null && diff >= 0 ? 'var(--bx-green)' : 'var(--bx-red)' }}>{diff === null ? '-' : `${diff >= 0 ? '+' : ''}${diff} bps`}</td>
                  <td>{t ? <Toggle on={t.active} disabled={busy === d} onChange={(v) => save(d, v, t.markupBps)} /> : <Tag tone="amber">New</Tag>}</td>
                  <td className="num">{busy === d ? <Spin /> : changed ? <button className="bx-btn primary small" disabled={!valid} onClick={() => save(d, t ? t.active : true, newMarkup)}>{t ? 'Save' : 'Add'}</button> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="bx-muted">Offers must be 90% to 500% of the fair price. BlockFinaX recalculates fair prices as the market moves.</p>
      <div className="bx-note" style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="bx-field" style={{ margin: 0 }}><label>Add custom tenor (days)</label><input className="bx-input" style={{ width: 120 }} inputMode="numeric" value={newDays} onChange={(e) => setNewDays(e.target.value.replace(/\D/g, ''))} /></div>
        <button className="bx-btn primary small" disabled={!(Number(newDays) >= 1 && Number(newDays) <= 365) || days.includes(Number(newDays))} onClick={() => { setExtra((x) => [...x, Number(newDays)]); setNewDays(''); }}>Add Tenor</button>
      </div>
    </Card>
  );
}

// ── Risk & Exposure ──────────────────────────────────────────────────────────

export function RiskExposure({ focus }: { focus: string | null }) {
  const { pools, all } = useMyBook();
  const [ref, setRef] = useState<string | null>(focus);
  useEffect(() => { if ((!ref || !all.some((p) => poolRef(p) === ref)) && all[0]) setRef(poolRef(all[0])); }, [all, ref]);
  const pool = all.find((p) => poolRef(p) === ref) ?? null;
  const positions = usePoolPositions(pool ? [pool] : []).get(ref ?? '') ?? [];
  const [editing, setEditing] = useState(false);
  if (pools.isLoading) return <Loading />;
  if (!pool) return <Card><div className="bx-empty">No pools yet.</div></Card>;
  const nav = Number(pool.liquidity.nav);
  const reserved = Number(pool.liquidity.reserved);
  const available = Number(pool.liquidity.capacity);
  const held = Math.max(nav - reserved - available, 0);
  const byTenor = new Map<number, number>();
  const byType = { capped: 0, open: 0 };
  for (const p of positions) { byTenor.set(p.tenorDays, (byTenor.get(p.tenorDays) ?? 0) + Number(p.maxPayout)); byType[p.structure] += Number(p.maxPayout); }
  const releases = Array.from(releasesOf(positions).entries()).sort(([a], [b]) => a.localeCompare(b));
  const colors = ['#0d9488', '#2563eb', '#7c3aed', '#d97706', '#64748b', '#0891b2'];
  const bar = (parts: { label: string; v: number; c: string }[]) => {
    const total = parts.reduce((s, p) => s + p.v, 0) || 1;
    return (
      <>
        <div className="bx-bar">{parts.map((p) => <i key={p.label} style={{ width: `${(p.v / total) * 100}%`, background: p.c }} />)}</div>
        <div className="bx-legend">{parts.map((p) => <div key={p.label}><div className="k"><i style={{ background: p.c }} />{p.label}</div><div className="v">${fmt(p.v, 0)}</div></div>)}</div>
      </>
    );
  };
  return (
    <>
      <div className="bx-card" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <PoolPicker pools={all} value={ref} onChange={setRef} />
        <button className="bx-btn ghost small" onClick={() => setEditing((v) => !v)}>{editing ? 'Close settings' : 'Protection settings'}</button>
      </div>
      {editing && <ProtectionSettings pool={pool} />}
      <div className="bx-grid bx-stats" style={{ marginTop: 14 }}>
        <StatCard label="Total liquidity" value={`$${fmt(nav, 0)}`} icon={<CircleDollarSign />} />
        <StatCard label="Reserved liquidity" value={`$${fmt(reserved, 0)}`} sub={pct(nav ? reserved / nav : 0, 0)} icon={<Lock />} tone="a" />
        <StatCard label="Available liquidity" value={`$${fmt(available, 0)}`} icon={<PieChart />} tone="g" />
        <StatCard label="Premiums being earned" value={`$${fmt(pool.liquidity.deferredPremium)}`} icon={<Hourglass />} />
      </div>
      <div className="bx-grid bx-two" style={{ marginTop: 14 }}>
        <Card title="Liquidity">{bar([{ label: 'Reserved', v: reserved, c: '#d97706' }, { label: 'Available', v: available, c: '#0d9488' }, { label: 'Held back', v: held, c: '#cbd5e1' }])}</Card>
        <Card title="Active exposure by protection type">{positions.length ? bar([{ label: 'Capped', v: byType.capped, c: '#2563eb' }, { label: 'Open', v: byType.open, c: '#7c3aed' }]) : <div className="bx-empty">No active cover.</div>}</Card>
        <Card title="Active exposure by tenor">{byTenor.size ? bar(Array.from(byTenor.entries()).sort(([a], [b]) => a - b).map(([d, v], i) => ({ label: `${d} days`, v, c: colors[i % colors.length] }))) : <div className="bx-empty">No active cover.</div>}</Card>
        <Card title="Upcoming capital releases">
          {releases.length ? releases.map(([day, amount]) => (
            <div className="bx-release" key={day}><span className="a"><CalendarDays />${fmt(amount, 0)}</span><span className="bx-muted">{shortDate(day)}</span></div>
          )) : <div className="bx-empty">Nothing reserved right now.</div>}
        </Card>
      </div>
    </>
  );
}

function ProtectionSettings({ pool }: { pool: CurrencyPool }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isCreator } = useMyBook();
  const [open, setOpen] = useState(pool.structures.open);
  const [capped, setCapped] = useState(pool.structures.capped);
  const [minCap, setMinCap] = useState(String(pool.structures.minCapDistanceBps / 100));
  const [maxCap, setMaxCap] = useState(String(pool.structures.maxCapDistanceBps / 100));
  const [openMax, setOpenMax] = useState(String(pool.structures.openMaxPayoutBps / 100));
  const [busy, setBusy] = useState(false);
  const allowed = isCreator(pool);
  async function save() {
    setBusy(true);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/structures/prepare`, {
        open, capped, minCapDistanceBps: Math.round(Number(minCap) * 100), maxCapDistanceBps: Math.round(Number(maxCap) * 100), openMaxPayoutBps: Math.round(Number(openMax) * 100),
      });
      await signAndSend(transactions, () => {});
      toast({ title: 'Protection settings saved' });
      void qc.invalidateQueries({ queryKey: ['v2-pools'] });
    } catch (e) {
      toast({ title: 'Not saved', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }
  return (
    <div style={{ marginTop: 14 }}>
      <Card title="Protection settings">
        {!allowed && <p className="bx-note warn">Only the pool's creator can change these.</p>}
        <div className="bx-grid bx-two">
          <div className={`bx-option${capped ? ' on' : ''}`}>
            <div className="t"><Toggle on={capped} disabled={!allowed} onChange={setCapped} /> Capped Protection</div>
            {capped && <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <div className="bx-field" style={{ margin: 0 }}><label>Smallest cap (%)</label><input className="bx-input" disabled={!allowed} value={minCap} onChange={(e) => setMinCap(e.target.value.replace(/[^0-9.]/g, ''))} /></div>
              <div className="bx-field" style={{ margin: 0 }}><label>Largest cap (%)</label><input className="bx-input" disabled={!allowed} value={maxCap} onChange={(e) => setMaxCap(e.target.value.replace(/[^0-9.]/g, ''))} /></div>
            </div>}
          </div>
          <div className={`bx-option${open ? ' on' : ''}`}>
            <div className="t"><Toggle on={open} disabled={!allowed} onChange={setOpen} /> Open Protection</div>
            {open && <div className="bx-field" style={{ marginTop: 10, marginBottom: 0 }}><label>Maximum payout (% of amount)</label><input className="bx-input" disabled={!allowed} value={openMax} onChange={(e) => setOpenMax(e.target.value.replace(/[^0-9.]/g, ''))} /></div>}
          </div>
        </div>
        {allowed && <div className="bx-actions"><button className="bx-btn primary" disabled={busy || (!open && !capped)} onClick={save}>{busy ? <Spin /> : 'Save settings'}</button></div>}
      </Card>
    </div>
  );
}

// ── Withdraw capital ─────────────────────────────────────────────────────────

export function UnderwriterWithdraw({ focus }: { focus: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { pools, all, stakes } = useMyBook();
  const invested = all.filter((p) => Number(stakes.get(poolRef(p))?.value ?? 0) > 0);
  const [ref, setRef] = useState<string | null>(focus);
  useEffect(() => { if ((!ref || !invested.some((p) => poolRef(p) === ref)) && invested[0]) setRef(poolRef(invested[0])); }, [invested, ref]);
  const pool = invested.find((p) => poolRef(p) === ref) ?? null;
  const stake = pool ? stakes.get(poolRef(pool)) : undefined;
  const withdrawals = useQuery({
    queryKey: ['v2-withdrawals'],
    queryFn: async () => (await api<{ withdrawals: Withdrawal[] }>('/api/v2/withdrawals')).withdrawals,
    refetchInterval: 30_000,
  });
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function request() {
    if (!pool) return;
    setBusy('request');
    try {
      const shares = (Number(amount) / sharePrice(pool)).toFixed(7);
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/withdrawals/prepare`, { shares });
      await signAndSend(transactions, () => {});
      toast({ title: 'Withdrawal requested', description: 'Your capital is released when the cover it backs has ended.' });
      setAmount('');
      for (const k of ['v2-withdrawals', 'v2-lp', 'v2-pools']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast({ title: 'Not requested', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }
  async function complete(w: Withdrawal) {
    setBusy(`w${w.requestId}`);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/withdrawals/${w.chain}/${w.requestId}/execute/prepare`, {});
      await signAndSend(transactions, () => {});
      toast({ title: 'Capital withdrawn', description: 'The USDC is in your account.' });
      for (const k of ['v2-withdrawals', 'v2-lp', 'v2-pools', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast({ title: 'Not withdrawn', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (pools.isLoading) return <Loading />;
  const poolOf = (w: Withdrawal) => all.find((p) => p.poolId === w.poolId && p.chain === w.chain);
  return (
    <div className="bx-grid bx-wide">
      <Card title="Request a withdrawal">
        {!invested.length ? <div className="bx-empty">You have no capital in a pool.</div> : (
          <>
            <div className="bx-field"><label>Pool</label><PoolPicker pools={invested} value={ref} onChange={setRef} /></div>
            <div className="bx-field">
              <label>Amount (USDC)</label>
              <input className="bx-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
              <span className="bx-muted">Your capital in this pool: ${fmt(stake?.value)}</span>
            </div>
            <p className="bx-note">Capital backing active protection is released when that protection ends. You can withdraw once your release date arrives.</p>
            <div className="bx-actions"><button className="bx-btn primary" disabled={!!busy || !(Number(amount) > 0) || Number(amount) > Number(stake?.value ?? 0)} onClick={request}>{busy === 'request' ? <Spin /> : 'Request withdrawal'}</button></div>
          </>
        )}
      </Card>
      <Card title="Your withdrawals">
        {withdrawals.isLoading ? <Loading /> : !(withdrawals.data ?? []).length ? <div className="bx-empty">No withdrawals yet.</div> : (withdrawals.data ?? []).map((w) => {
          const p = poolOf(w);
          const value = Number(w.shares) * (p ? sharePrice(p) : 1);
          const ready = w.status === 'pending' && w.unlockAt <= Date.now() / 1000;
          return (
            <div className="bx-release" key={`${w.chain}-${w.requestId}`}>
              <span className="a">{p ? <Ccy pair={p.pair}>${fmt(value)}</Ccy> : `$${fmt(value)}`}</span>
              <span>{w.status === 'executed' ? <Tag tone="grey">Withdrawn</Tag> : w.status === 'cancelled' ? <Tag tone="grey">Cancelled</Tag> : ready
                ? <button className="bx-btn primary small" disabled={busy === `w${w.requestId}`} onClick={() => complete(w)}>{busy === `w${w.requestId}` ? <Spin /> : 'Withdraw'}</button>
                : <Tag tone="amber">Releases {dateOf(w.unlockAt)}</Tag>}</span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
