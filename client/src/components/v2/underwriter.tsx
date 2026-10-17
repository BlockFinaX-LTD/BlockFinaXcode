/**
 * Underwriter: "How do you want your capital exposed?"
 *
 * Dashboard: capital committed, reserved and available, premium earned, active hedges,
 * upcoming capital releases. Pools you are in, with Manage (tenors, protection settings,
 * risk view), Add Liquidity and Withdraw. Create Pool asks the exposure, the amount and
 * the funding network; any network other than the liquidity hub is routed by BlockFinaX.
 *
 * All tenors share the pool's liquidity. BlockFinaX computes the fair price; the
 * underwriter sets the offer (stored on chain as a markup on fair).
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, PlusCircle, Settings2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { CurrencyPool, ProtectionPosition } from '@shared/domain/types';
import { api } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import { usePasskeySession } from '@/lib/identity';
import {
  Advanced, Flag, Line, SplitBar, Stat, ccyName, dateOf, exposureLabel, fmt, pct, poolRef, routeFunding, signAndSend,
  useChains, usePools, useUsdcBalances, usdcOn, type Direction,
} from './shared';

const MARKUP_MIN = 9000;
const MARKUP_MAX = 50000;

type Stake = { shares: string; value: string };
type Withdrawal = { chain: string; requestId: number; poolId: number; shares: string; unlockAt: number; status: string };

function sharePrice(p: CurrencyPool) {
  return Number(p.totalShares) > 0 ? Number(p.liquidity.nav) / Number(p.totalShares) : 1;
}

function useStakes(pools: CurrencyPool[]) {
  const results = useQueries({
    queries: pools.map((p) => ({
      queryKey: ['v2-lp', poolRef(p)],
      queryFn: () => api<Stake>(`/api/v2/pools/${encodeURIComponent(poolRef(p))}/lp`),
      refetchInterval: 30_000,
    })),
  });
  return new Map(pools.map((p, i) => [poolRef(p), results[i].data]));
}

function usePositions(pool: CurrencyPool | null) {
  return useQuery({
    queryKey: ['v2-pool-positions', pool ? poolRef(pool) : null],
    enabled: Boolean(pool),
    queryFn: async () => (await api<{ positions: ProtectionPosition[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool!))}/positions`)).positions,
    refetchInterval: 30_000,
  });
}

function useWithdrawals() {
  return useQuery({
    queryKey: ['v2-withdrawals'],
    queryFn: async () => (await api<{ withdrawals: Withdrawal[] }>('/api/v2/withdrawals')).withdrawals,
    refetchInterval: 30_000,
  });
}

/** Capital each pool releases by date, from the expiry of the cover it has sold. */
function releasesOf(positions: ProtectionPosition[]) {
  const byDay = new Map<string, number>();
  for (const p of positions) {
    const day = new Date(p.expiry * 1000).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(p.maxPayout));
  }
  return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, amount]) => ({ day, amount }));
}

export function Underwriter() {
  const [screen, setScreen] = useState<{ kind: 'home' } | { kind: 'create' } | { kind: 'manage'; ref: string }>({ kind: 'home' });
  const pools = usePools();
  if (screen.kind === 'create') return <CreatePool onDone={() => setScreen({ kind: 'home' })} />;
  if (screen.kind === 'manage') {
    const pool = (pools.data ?? []).find((p) => poolRef(p) === screen.ref) ?? null;
    return <ManagePool pool={pool} onBack={() => setScreen({ kind: 'home' })} />;
  }
  return <UnderwriterDashboard onCreate={() => setScreen({ kind: 'create' })} onManage={(ref) => setScreen({ kind: 'manage', ref })} />;
}

// ── Dashboard ────────────────────────────────────────────────────────────────

function UnderwriterDashboard({ onCreate, onManage }: { onCreate: () => void; onManage: (ref: string) => void }) {
  const pools = usePools();
  const all = pools.data ?? [];
  const stakes = useStakes(all);
  const { session } = usePasskeySession();
  const mine = new Set((session?.accounts ?? []).map((a) => a.address));

  const positions = useQueries({
    queries: all.map((p) => ({
      queryKey: ['v2-pool-positions', poolRef(p)],
      queryFn: async () => (await api<{ positions: ProtectionPosition[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(p))}/positions`)).positions,
      refetchInterval: 60_000,
    })),
  });

  let committed = 0, reserved = 0, earned = 0, hedges = 0;
  const releases = new Map<string, number>();
  all.forEach((p, i) => {
    const s = stakes.get(poolRef(p));
    const value = Number(s?.value ?? 0);
    if (value <= 0) return;
    const nav = Number(p.liquidity.nav) || 1;
    const share = value / nav;
    committed += value;
    reserved += Number(p.liquidity.reserved) * share;
    earned += Number(s!.shares) * (sharePrice(p) - 1);
    hedges += p.activePositions;
    for (const r of releasesOf(positions[i].data ?? [])) releases.set(r.day, (releases.get(r.day) ?? 0) + r.amount * share);
  });
  const upcoming = Array.from(releases.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(0, 4);
  const yours = all.filter((p) => Number(stakes.get(poolRef(p))?.value ?? 0) > 0 || mine.has(p.creator));
  const others = all.filter((p) => !yours.includes(p));

  return (
    <section className="cv-view on">
      <div className="pool-card">
        <div className="pool-stats">
          <Stat label="Capital committed" value={`${fmt(committed)} USDC`} />
          <Stat label="Reserved" value={fmt(reserved)} sub="backing active cover" />
          <Stat label="Available" value={fmt(committed - reserved)} />
        </div>
        <div className="pool-stats">
          <Stat label="Premium earned" value={`${fmt(earned)} USDC`} />
          <Stat label="Active hedges" value={hedges} />
          <Stat label="Next release" value={upcoming[0] ? `${fmt(upcoming[0][1])} on ${new Date(upcoming[0][0]).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : '-'} />
        </div>
        {upcoming.length > 1 && (
          <div className="brk" style={{ marginTop: 8 }}>
            {upcoming.map(([day, amount]) => <Line key={day} l={`Released ${new Date(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`} v={`${fmt(amount)} USDC`} />)}
          </div>
        )}
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onCreate}><PlusCircle /> Create Pool</button>
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '18px 0 8px' }}>Your pools</h3>
      {pools.isLoading && <p className="send-note"><Loader2 className="spin" /> Loading...</p>}
      {!pools.isLoading && !yours.length && <p className="send-note">You have no capital committed yet. Create a pool or add liquidity to one below.</p>}
      {yours.map((p) => <PoolRow key={poolRef(p)} p={p} stake={stakes.get(poolRef(p))} onManage={() => onManage(poolRef(p))} />)}

      {others.length > 0 && <h3 style={{ fontSize: 15, fontWeight: 600, margin: '18px 0 8px' }}>Open to new capital</h3>}
      {others.map((p) => <PoolRow key={poolRef(p)} p={p} onManage={() => onManage(poolRef(p))} />)}
    </section>
  );
}

function PoolRow({ p, stake, onManage }: { p: CurrencyPool; stake?: Stake; onManage: () => void }) {
  const nav = Number(p.liquidity.nav);
  const used = nav > 0 ? Number(p.liquidity.reserved) / nav : 0;
  return (
    <div className="pool-card">
      <div className="pool-top">
        <Flag pair={p.pair} />
        <div className="pt-nm">
          <div className="a">{p.direction === 'both' ? `${ccyName(p.pair)}, both directions` : exposureLabel(p.pair, p.direction).title}</div>
          <div className="b">{p.tenors.filter((t) => t.active).map((t) => `${t.tenorDays}d`).join(' · ')}</div>
        </div>
        <div className="pool-apr"><div className="v">{fmt(nav, 0)}</div><div className="l">USDC in pool</div></div>
      </div>
      <div className="pool-stats">
        <Stat label="Available" value={fmt(p.liquidity.capacity, 0)} />
        <Stat label="In use" value={pct(used, 0)} />
        <Stat label="Share value" value={sharePrice(p).toFixed(4)} />
        {stake && Number(stake.value) > 0 ? <Stat label="Your capital" value={fmt(stake.value)} /> : <Stat label="Active hedges" value={p.activePositions} />}
      </div>
      <button className="btn-sm2 primary" onClick={onManage}><Settings2 /> Manage</button>
    </div>
  );
}

// ── Manage pool ──────────────────────────────────────────────────────────────

function ManagePool({ pool, onBack }: { pool: CurrencyPool | null; onBack: () => void }) {
  const [tab, setTab] = useState<'overview' | 'tenors' | 'settings' | 'liquidity'>('overview');
  const { session } = usePasskeySession();
  if (!pool) return <section className="cv-view on"><p className="send-note"><Loader2 className="spin" /> Loading pool...</p></section>;
  const isCreator = (session?.accounts ?? []).some((a) => a.address === pool.creator);
  return (
    <section className="cv-view on">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button className="sheet-x" onClick={onBack}><ArrowLeft /></button>
        <Flag pair={pool.pair} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{pool.direction === 'both' ? ccyName(pool.pair) : exposureLabel(pool.pair, pool.direction).title}</div>
          <div style={{ fontSize: 12, color: 'var(--tx-3)' }}>{fmt(pool.liquidity.nav, 0)} USDC · {pool.activePositions} active hedges</div>
        </div>
      </div>
      <div className="assettog cv-sub">
        <button className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>Risk</button>
        <button className={tab === 'liquidity' ? 'on' : ''} onClick={() => setTab('liquidity')}>Liquidity</button>
        {isCreator && <button className={tab === 'tenors' ? 'on' : ''} onClick={() => setTab('tenors')}>Tenors</button>}
        {isCreator && <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Protection</button>}
      </div>
      {tab === 'overview' && <RiskView pool={pool} />}
      {tab === 'liquidity' && <LiquidityPanel pool={pool} />}
      {tab === 'tenors' && <TenorTable pool={pool} />}
      {tab === 'settings' && <ProtectionSettings pool={pool} />}
    </section>
  );
}

function RiskView({ pool }: { pool: CurrencyPool }) {
  const positions = usePositions(pool);
  const list = positions.data ?? [];
  const byTenor = new Map<number, number>();
  const byType = { open: 0, capped: 0 };
  for (const p of list) {
    byTenor.set(p.tenorDays, (byTenor.get(p.tenorDays) ?? 0) + Number(p.maxPayout));
    byType[p.structure] += Number(p.maxPayout);
  }
  const releases = releasesOf(list);
  const colors = ['#2457d6', '#5b8def', '#93b4f5', '#c7d7fa', '#7a8ba8', '#a9b7cc'];
  return (
    <>
      <div className="pool-card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Liquidity</div>
        <SplitBar parts={[
          { label: 'Reserved', value: Number(pool.liquidity.reserved), color: '#2457d6' },
          { label: 'Available', value: Number(pool.liquidity.capacity), color: '#7fd1ae' },
          { label: 'Held back', value: Math.max(Number(pool.liquidity.nav) - Number(pool.liquidity.reserved) - Number(pool.liquidity.capacity), 0), color: '#c9ced8' },
        ]} />
        <div className="pool-stats" style={{ marginTop: 10 }}>
          <Stat label="Total liquidity" value={fmt(pool.liquidity.nav)} />
          <Stat label="Premiums being earned" value={fmt(pool.liquidity.deferredPremium)} />
        </div>
      </div>
      <div className="pool-card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Active exposure by tenor</div>
        {byTenor.size ? <SplitBar parts={Array.from(byTenor.entries()).sort(([a], [b]) => a - b).map(([d, v], i) => ({ label: `${d} days`, value: v, color: colors[i % colors.length] }))} /> : <p className="send-note">No active cover.</p>}
      </div>
      <div className="pool-card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Active exposure by protection type</div>
        {list.length ? <SplitBar parts={[{ label: 'Capped', value: byType.capped, color: '#2457d6' }, { label: 'Open', value: byType.open, color: '#e0a03a' }]} /> : <p className="send-note">No active cover.</p>}
      </div>
      <div className="pool-card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Upcoming capital releases</div>
        {releases.length ? <div className="brk">{releases.map((r) => <Line key={r.day} l={new Date(r.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} v={`${fmt(r.amount)} USDC`} />)}</div> : <p className="send-note">Nothing reserved right now.</p>}
      </div>
    </>
  );
}

function TenorTable({ pool }: { pool: CurrencyPool }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const direction: Direction = pool.direction === 'down' ? 'down' : 'up';
  const days = pool.tenors.map((t) => t.tenorDays);
  const [extra, setExtra] = useState<number[]>([]);
  const all = Array.from(new Set([...days, ...extra])).sort((a, b) => a - b);
  const fair = useQuery({
    queryKey: ['v2-fair', pool.pair, direction, all.join(',')],
    queryFn: () => api<{ rows: { tenorDays: number; fairRateE6: number | null }[] }>(`/api/v2/fair?pair=${encodeURIComponent(pool.pair)}&direction=${direction}&tenors=${all.join(',')}`),
  });
  const fairOf = (d: number) => fair.data?.rows.find((r) => r.tenorDays === d)?.fairRateE6 ?? null;
  const [offers, setOffers] = useState<Record<number, string>>({});
  const [newDays, setNewDays] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  async function save(tenorDays: number, active: boolean, markupBps: number) {
    setBusy(tenorDays);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/tenors/prepare`, { tenorDays, active, markupBps });
      await signAndSend(transactions, () => {});
      toast({ title: `${tenorDays}-day tenor saved` });
      setExtra((x) => x.filter((d) => d !== tenorDays));
      void qc.invalidateQueries({ queryKey: ['v2-pools'] });
    } catch (e) {
      toast({ title: 'Not saved', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  return (
    <div className="pool-card">
      <p className="send-note" style={{ marginTop: 0 }}>BlockFinaX calculates the fair price. You set your offer. All tenors share this pool's liquidity.</p>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--tx-3)', textAlign: 'left' }}>
            <th style={{ padding: '6px 4px' }}>Tenor</th><th style={{ textAlign: 'right' }}>Fair price</th><th style={{ textAlign: 'right' }}>Your offer</th><th style={{ textAlign: 'right' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {all.map((d) => {
            const t = pool.tenors.find((x) => x.tenorDays === d);
            const f = fairOf(d);
            const markup = t?.markupBps ?? 11500;
            const offerPct = offers[d] ?? (f ? ((f / 1e6) * (markup / 10000) * 100).toFixed(2) : '');
            const newMarkup = f && Number(offerPct) > 0 ? Math.round(((Number(offerPct) / 100) / (f / 1e6)) * 10000) : markup;
            const valid = newMarkup >= MARKUP_MIN && newMarkup <= MARKUP_MAX;
            const changed = !t || newMarkup !== t.markupBps;
            return (
              <tr key={d} style={{ borderTop: '1px solid var(--line, #e6e8ee)' }}>
                <td style={{ padding: '8px 4px' }}>{d} days</td>
                <td style={{ textAlign: 'right' }}>{f === null ? (fair.isLoading ? '...' : '-') : pct(f / 1e6)}</td>
                <td style={{ textAlign: 'right' }}>
                  <input className="input" style={{ width: 80, textAlign: 'right', padding: '4px 6px', display: 'inline-block' }} inputMode="decimal" value={offerPct}
                    onChange={(e) => setOffers((o) => ({ ...o, [d]: e.target.value.replace(/[^0-9.]/g, '') }))} />%
                </td>
                <td style={{ textAlign: 'right' }}>
                  {busy === d ? <Loader2 className="spin" /> : changed ? (
                    <button className="btn-sm2 primary" disabled={!valid} onClick={() => save(d, true, newMarkup)}>{t ? 'Save' : 'Add'}</button>
                  ) : (
                    <button className="btn-sm2" onClick={() => save(d, !t!.active, t!.markupBps)}>{t!.active ? 'ON' : 'OFF'}</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="send-note">Your offer must be between 90% and 500% of the fair price.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input className="input" inputMode="numeric" placeholder="Days, e.g. 4" value={newDays} onChange={(e) => setNewDays(e.target.value.replace(/\D/g, ''))} />
        <button className="btn btn-ghost" disabled={!(Number(newDays) >= 1 && Number(newDays) <= 365) || all.includes(Number(newDays))}
          onClick={() => { setExtra((x) => [...x, Number(newDays)]); setNewDays(''); }}>Add tenor</button>
      </div>
    </div>
  );
}

function ProtectionSettings({ pool }: { pool: CurrencyPool }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(pool.structures.open);
  const [capped, setCapped] = useState(pool.structures.capped);
  const [minCap, setMinCap] = useState(String(pool.structures.minCapDistanceBps / 100));
  const [maxCap, setMaxCap] = useState(String(pool.structures.maxCapDistanceBps / 100));
  const [openMax, setOpenMax] = useState(String(pool.structures.openMaxPayoutBps / 100));
  const [busy, setBusy] = useState(false);
  const problem = !open && !capped ? 'Offer at least one protection type' : Number(minCap) > Number(maxCap) && Number(maxCap) > 0 ? 'The smallest cap must be below the largest' : null;

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
    <div className="pool-card">
      <div className="field">
        <label>Protection offered</label>
        <div className="rtabs">
          <button className={capped ? 'on' : ''} onClick={() => setCapped((v) => !v)}>Capped</button>
          <button className={open ? 'on' : ''} onClick={() => setOpen((v) => !v)}>Open</button>
        </div>
      </div>
      {capped && (
        <div className="field">
          <label>Cap boundaries (% beyond the strike)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" inputMode="decimal" value={minCap} onChange={(e) => setMinCap(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Smallest" />
            <input className="input" inputMode="decimal" value={maxCap} onChange={(e) => setMaxCap(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Largest (0 = none)" />
          </div>
          <p className="send-note">Buyers choose a cap between these. 0 for the largest means no limit.</p>
        </div>
      )}
      {open && (
        <div className="field">
          <label>Open Protection maximum payout (% of amount protected)</label>
          <input className="input" inputMode="decimal" value={openMax} onChange={(e) => setOpenMax(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
      )}
      {problem && <p className="send-note">{problem}</p>}
      <button className="btn btn-primary" disabled={busy || !!problem} onClick={save}>{busy ? <Loader2 className="spin" /> : 'Save settings'}</button>
    </div>
  );
}

function FundingNetwork({ value, onChange }: { value: string | null; onChange: (k: string) => void }) {
  const chains = useChains();
  const balances = useUsdcBalances();
  const hub = chains.data?.activeLiquidityHub;
  const funding = (chains.data?.chains ?? []).filter((c) => c.capabilities.funding);
  useEffect(() => { if (!value && hub) onChange(hub); }, [hub, value, onChange]);
  return (
    <div className="field">
      <label>Funding network</label>
      <div className="rtabs" style={{ flexWrap: 'wrap' }}>
        {funding.map((c) => (
          <button key={c.key} className={value === c.key ? 'on' : ''} onClick={() => onChange(c.key)}>{c.name} · {fmt(usdcOn(balances.data?.rows, c.key))} USDC</button>
        ))}
      </div>
      {value && hub && value !== hub && <p className="send-note">BlockFinaX will route the funds automatically.</p>}
    </div>
  );
}

function LiquidityPanel({ pool }: { pool: CurrencyPool }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chains = useChains();
  const balances = useUsdcBalances();
  const stake = useQuery({ queryKey: ['v2-lp', poolRef(pool)], queryFn: () => api<Stake>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/lp`) });
  const withdrawals = useWithdrawals();
  const [mode, setMode] = useState<'add' | 'withdraw'>('add');
  const [network, setNetwork] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const hub = chains.data?.activeLiquidityHub;
  const price = sharePrice(pool);
  const mine = (withdrawals.data ?? []).filter((w) => w.poolId === pool.poolId && w.chain === pool.chain && w.status === 'pending');

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    try { await work(); } catch (e) {
      toast({ title: 'Not completed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  const add = () => run('Adding...', async () => {
    if (network && hub && network !== hub) await routeFunding({ network, amount, hubName: chains.data?.chains.find((c) => c.key === hub)?.name });
    const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/deposits/prepare`, { amount });
    await signAndSend(transactions, (m) => setBusy(m));
    toast({ title: 'Liquidity added', description: `${fmt(amount)} USDC committed.` });
    setAmount('');
    for (const k of ['v2-pools', 'v2-lp', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
  });

  const withdraw = () => run('Requesting...', async () => {
    const shares = (Number(amount) / price).toFixed(7);
    const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/withdrawals/prepare`, { shares });
    await signAndSend(transactions, (m) => setBusy(m));
    toast({ title: 'Withdrawal requested', description: 'Your capital is released when the cover it backs has ended.' });
    setAmount('');
    for (const k of ['v2-withdrawals', 'v2-lp', 'v2-pools']) void qc.invalidateQueries({ queryKey: [k] });
  });

  const complete = (w: Withdrawal) => run(`w${w.requestId}`, async () => {
    const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/withdrawals/${w.chain}/${w.requestId}/execute/prepare`, {});
    await signAndSend(transactions, () => {});
    toast({ title: 'Withdrawn', description: 'The USDC is in your wallet.' });
    for (const k of ['v2-withdrawals', 'v2-lp', 'v2-pools', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
  });

  const available = mode === 'add' ? usdcOn(balances.data?.rows, network ?? hub) : Number(stake.data?.value ?? 0);
  return (
    <div className="pool-card">
      <div className="pool-stats">
        <Stat label="Your capital" value={`${fmt(stake.data?.value)} USDC`} />
        <Stat label="Share value" value={price.toFixed(4)} />
      </div>
      <div className="rtabs" style={{ marginTop: 8 }}>
        <button className={mode === 'add' ? 'on' : ''} onClick={() => setMode('add')}>Add Liquidity</button>
        <button className={mode === 'withdraw' ? 'on' : ''} onClick={() => setMode('withdraw')}>Withdraw</button>
      </div>
      {mode === 'add' && <FundingNetwork value={network} onChange={setNetwork} />}
      <div className="field">
        <label>Amount (USDC) · available {fmt(available)}</label>
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
      </div>
      {mode === 'withdraw' && <p className="send-note">Withdrawals have a notice period: capital backing active cover is released once that cover ends.</p>}
      <button className="btn btn-primary" disabled={!!busy || !(Number(amount) > 0) || Number(amount) > available || (mode === 'add' && !pool.allowExternalLp)}
        onClick={mode === 'add' ? add : withdraw}>
        {busy && !busy.startsWith('w') ? <><Loader2 className="spin" /> {busy}</> : mode === 'add' ? 'Add Liquidity' : 'Request withdrawal'}
      </button>
      {mine.length > 0 && (
        <div className="brk" style={{ marginTop: 12 }}>
          {mine.map((w) => {
            const ready = w.unlockAt <= Date.now() / 1000;
            return (
              <div key={w.requestId} className="brk-line">
                <span className="l">{fmt(Number(w.shares) * price)} USDC · {ready ? 'ready' : `releases ${dateOf(w.unlockAt)}`}</span>
                <span className="v">{ready ? <button className="btn-sm2 primary" disabled={busy === `w${w.requestId}`} onClick={() => complete(w)}>Withdraw</button> : 'Pending'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Create pool ──────────────────────────────────────────────────────────────

const DEFAULT_TENORS = [3, 7, 14, 30];

function CreatePool({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chains = useChains();
  const balances = useUsdcBalances();
  const setup = useQuery({ queryKey: ['v2-pool-setup'], queryFn: () => api<{ chain: string; pairs: string[]; creationFee: string }>('/api/v2/pools/setup') });
  const [exposure, setExposure] = useState<{ pair: string; direction: Direction } | null>(null);
  const [amount, setAmount] = useState('500');
  const [network, setNetwork] = useState<string | null>(null);
  const [offerMarkup, setOfferMarkup] = useState('115');
  const [busy, setBusy] = useState<string | null>(null);
  const exposures = useMemo(() => (setup.data?.pairs ?? []).flatMap((pair) => (['up', 'down'] as Direction[]).map((direction) => ({ pair, direction }))), [setup.data]);
  useEffect(() => { if (!exposure && exposures[0]) setExposure(exposures[0]); }, [exposures, exposure]);

  const hub = chains.data?.activeLiquidityHub;
  const fee = Number(setup.data?.creationFee ?? 0);
  const total = Number(amount || 0) + fee;
  const have = usdcOn(balances.data?.rows, network ?? hub);
  const markupBps = Math.round(Number(offerMarkup) * 100);
  const problem = !exposure ? 'Choose what to underwrite' : !(Number(amount) >= 10) ? 'Commit at least 10 USDC'
    : !(markupBps >= MARKUP_MIN && markupBps <= MARKUP_MAX) ? 'Offer must be 90% to 500% of fair' : total > have ? `You need ${fmt(total)} USDC on this network` : null;

  async function create() {
    if (!exposure) return;
    setBusy('Preparing...');
    try {
      if (network && hub && network !== hub) await routeFunding({ network, amount: String(total), hubName: chains.data?.chains.find((c) => c.key === hub)?.name });
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/pools/prepare', {
        pair: exposure.pair, direction: exposure.direction, allowExternalLp: true, initialLiquidity: amount,
        structures: { open: true, capped: true, minCapDistanceBps: 300, maxCapDistanceBps: 2000, openMaxPayoutBps: 3000 },
        tenors: DEFAULT_TENORS.map((d) => ({ tenorDays: d, active: true, markupBps })),
      });
      await signAndSend(transactions, (m) => setBusy(m));
      toast({ title: 'Pool created', description: 'Open Manage to set tenors and prices.' });
      for (const k of ['v2-pools', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
      onDone();
    } catch (e) {
      toast({ title: 'Pool not created', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  return (
    <section className="cv-view on">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button className="sheet-x" onClick={onDone}><ArrowLeft /></button>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Create Pool</div>
      </div>
      <div className="field">
        <label>Currency to underwrite</label>
        <div style={{ display: 'grid', gap: 8 }}>
          {exposures.map((x) => {
            const l = exposureLabel(x.pair, x.direction);
            const on = exposure?.pair === x.pair && exposure.direction === x.direction;
            return (
              <button key={`${x.pair}:${x.direction}`} className="payway" onClick={() => setExposure(x)} style={on ? { outline: '2px solid var(--blue)' } : undefined}>
                <span className="pwic"><Flag pair={x.pair} /></span>
                <span className="pwc"><span className="t">{l.title}</span><span className="s">You pay out if the {ccyName(x.pair)} {l.verb}; you earn premiums otherwise</span></span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="field">
        <label>Amount of USDC to commit</label>
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
      </div>
      <FundingNetwork value={network} onChange={setNetwork} />
      <Advanced>
        <Line l="Starting offer (% of fair price)" v={<input className="input" style={{ width: 80, textAlign: 'right', padding: '4px 6px' }} value={offerMarkup} onChange={(e) => setOfferMarkup(e.target.value.replace(/[^0-9.]/g, ''))} />} />
        <Line l="Starting tenors" v={DEFAULT_TENORS.map((d) => `${d}d`).join(', ')} />
        <Line l="Protection" v="Open and Capped" />
        <Line l="Creation fee" v={`${fmt(fee)} USDC`} />
      </Advanced>
      <div className="brk" style={{ marginTop: 10 }}>
        <Line l="Committed capital" v={`${fmt(amount)} USDC`} />
        <Line l="Creation fee" v={`${fmt(fee)} USDC`} />
        <Line l="Network fees" v="Covered by BlockFinaX" good />
        <Line l="Total" v={`${fmt(total)} USDC`} total />
      </div>
      {problem && <p className="send-note">{problem}</p>}
      <button className="btn btn-primary" disabled={!!busy || !!problem} onClick={create}>{busy ? <><Loader2 className="spin" /> {busy}</> : 'Create Pool'}</button>
      <p className="send-note">You can add tenors, set prices and change protection settings from Manage afterwards.</p>
    </section>
  );
}
