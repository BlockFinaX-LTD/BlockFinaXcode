/**
 * Underwriter pages: "How do you want your capital exposed?"
 * Home, My pools, Create pool, Pool (tenor pricing, protection settings, docked
 * Add liquidity / Withdraw panel), Risk and exposure, Withdraw.
 * All tenors share one pool's liquidity. BlockFinaX computes the fair price; the
 * underwriter sets the offer, stored on chain as a markup on fair (90% to 500%).
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { CurrencyPool, ProtectionPosition } from '@shared/domain/types';
import { api } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import { usePasskeySession } from '@/lib/identity';
import {
  ccyName, dateOf, exposureLabel, fmt, pct, poolRef, routeFunding, signAndSend, useChains, usePools, useUsdcBalances,
  usdcOn, type Direction,
} from './shared';
import { Flag, hint, Loading, Note, Spin, Steps, Sum, Tag, Toggle } from './ui';
import type { Go } from './workspace';
import { isOffered } from '@shared/domain/offered-directions';

const MARKUP_MIN = 9000;
const MARKUP_MAX = 50000;
/** Per-hedge underwriting (current Stellar pools): each underwriter's own balances in USDC. */
type LpAccount = { free: string; reserved: string; earned: string; paid: string; pendingWithdraw: string; withdrawable: string; backing: boolean; maxTenorDays: number };
type Stake = { shares: string; value: string; account?: LpAccount };
type Withdrawal = { chain: string; contract?: string; requestId: number; poolId: number; shares: string; unlockAt: number; status: string };

/** A withdrawal's USDC amount: share-based on legacy pools, already USDC on current ones. */
const withdrawalUsd = (w: Withdrawal, p: CurrencyPool | undefined) => Number(w.shares) * (p?.legacy ? sharePrice(p) : 1);

const sharePrice = (p: CurrencyPool) => (Number(p.totalShares) > 0 ? Number(p.liquidity.nav) / Number(p.totalShares) : 1);
const poolName = (p: CurrencyPool) => (p.direction === 'both' ? `${ccyName(p.pair)}, both directions` : exposureLabel(p.pair, p.direction).cover) + (p.legacy ? ' (earlier contract)' : '');
const shortDate = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const inDays = (d: string) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000));

function useStakes(pools: CurrencyPool[]) {
  const qs = useQueries({ queries: pools.map((p) => ({ queryKey: ['v2-lp', poolRef(p)], queryFn: () => api<Stake>(`/api/v2/pools/${encodeURIComponent(poolRef(p))}/lp`), refetchInterval: 30_000 })) });
  return new Map(pools.map((p, i) => [poolRef(p), qs[i].data]));
}

function usePoolPositions(pools: CurrencyPool[]) {
  const qs = useQueries({ queries: pools.map((p) => ({ queryKey: ['v2-pool-positions', poolRef(p)], queryFn: async () => (await api<{ positions: ProtectionPosition[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(p))}/positions`)).positions, refetchInterval: 60_000 })) });
  return new Map(pools.map((p, i) => [poolRef(p), qs[i].data ?? []]));
}

function releasesOf(positions: ProtectionPosition[], share = 1) {
  const byDay = new Map<string, number>();
  for (const p of positions) {
    const day = new Date(p.expiry * 1000).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(p.maxPayout) * share);
  }
  return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function useBook() {
  const pools = usePools();
  const all = pools.data ?? [];
  const stakes = useStakes(all);
  const { session } = usePasskeySession();
  const mine = new Set((session?.accounts ?? []).map((a) => a.address));
  const isCreator = (p: CurrencyPool) => mine.has(p.creator);
  const yours = all.filter((p) => Number(stakes.get(poolRef(p))?.value ?? 0) > 0 || isCreator(p));
  return { pools, all, stakes, yours, isCreator };
}

/** Fair price per tenor, for cover starting `distanceBps` from today (the pool's closest strike). */
function useFair(pair: string | null, direction: Direction, days: number[], distanceBps = 0) {
  return useQuery({
    queryKey: ['v2-fair', pair, direction, days.join(','), distanceBps],
    enabled: Boolean(pair) && days.length > 0,
    queryFn: () => api<{ rows: { tenorDays: number; fairRateE6: number | null }[] }>(`/api/v2/fair?pair=${encodeURIComponent(pair!)}&direction=${direction}&tenors=${days.join(',')}&distance=${distanceBps}`),
    staleTime: 60_000,
  });
}

function PoolPicker({ pools, value, onChange }: { pools: CurrencyPool[]; value: string | null; onChange: (ref: string) => void }) {
  return (
    <select className="bx-select" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Pool" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {pools.map((p) => <option key={poolRef(p)} value={poolRef(p)}>{poolName(p)} · ${fmt(p.liquidity.nav, 0)}</option>)}
    </select>
  );
}

const POOL_COLS = { gridTemplateColumns: 'minmax(0, 2.2fr) repeat(4, minmax(0, 1fr))' };

function PoolRows({ pools, stakes, go }: { pools: CurrencyPool[]; stakes: Map<string, Stake | undefined>; go: Go }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 640 }}>
        <div className="bx-list-h" style={POOL_COLS}><span>{hint("Pool")}</span><span className="r">{hint("Liquidity")}</span><span className="r">{hint("In use")}</span><span className="r">{hint("Your premiums")}</span><span className="r">{hint("Your capital")}</span></div>
        {pools.map((p) => {
          const nav = Number(p.liquidity.nav);
          const used = nav > 0 ? Number(p.liquidity.reserved) / nav : 0;
          const growth = sharePrice(p) - 1;
          return (
            <div key={poolRef(p)} className="bx-li click" style={POOL_COLS} onClick={() => go('u-pool', { pool: poolRef(p) })}>
              <div className="bx-who"><Flag pair={p.pair} /><div style={{ minWidth: 0 }}><div className="t">{poolName(p)}</div><div className="d">{p.tenors.filter((t) => t.active).map((t) => t.tenorDays).join(', ')} days · {[p.structures.capped && 'Capped', p.structures.open && 'Open'].filter(Boolean).join(' and ')}</div></div></div>
              <div className="r num" style={{ fontWeight: 600 }}>${fmt(nav, 0)}</div>
              <div className="r"><div className="num" style={{ fontWeight: 600 }}>{pct(used, 0)}</div><div className="bx-bar thin" style={{ width: 64, marginLeft: 'auto', marginTop: 6 }}><i style={{ width: `${used * 100}%`, background: 'var(--blue)' }} /></div></div>
              {stakes.get(poolRef(p))?.account
                ? <div className="r num up" style={{ fontWeight: 600 }}>+${fmt(stakes.get(poolRef(p))!.account!.earned)}<div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>paid out ${fmt(stakes.get(poolRef(p))!.account!.paid)}</div></div>
                : <div className="r num" style={{ fontWeight: 600 }}>{sharePrice(p).toFixed(4)}<div className={growth >= 0 ? 'up' : 'down'} style={{ fontSize: 12 }}>{growth >= 0 ? '+' : ''}{pct(growth)}</div></div>}
              <div className="r num" style={{ fontWeight: 600 }}>${fmt(stakes.get(poolRef(p))?.value ?? 0)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Home ─────────────────────────────────────────────────────────────────────

export function UnderwriterHome({ go }: { go: Go }) {
  const { pools, all, stakes, yours } = useBook();
  const positions = usePoolPositions(all);
  let committed = 0, reserved = 0, earned = 0, hedges = 0;
  const releases = new Map<string, number>();
  const byTenor = new Map<number, number>();
  for (const p of all) {
    const s = stakes.get(poolRef(p));
    const value = Number(s?.value ?? 0);
    if (value <= 0) continue;
    const share = value / (Number(p.liquidity.nav) || 1);
    committed += value;
    if (s?.account) {
      // Exact: this underwriter's own reserve and the premiums paid to them.
      reserved += Number(s.account.reserved);
      earned += Number(s.account.earned) - Number(s.account.paid);
    } else {
      reserved += Number(p.liquidity.reserved) * share;
      earned += Number(s!.shares) * (sharePrice(p) - 1);
    }
    hedges += p.activePositions;
    for (const pos of positions.get(poolRef(p)) ?? []) byTenor.set(pos.tenorDays, (byTenor.get(pos.tenorDays) ?? 0) + Number(pos.maxPayout) * share);
    for (const [d, v] of releasesOf(positions.get(poolRef(p)) ?? [], share)) releases.set(d, (releases.get(d) ?? 0) + v);
  }
  const available = committed - reserved;
  const used = committed > 0 ? reserved / committed : 0;
  const upcoming = Array.from(releases.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(0, 4);
  const tenorRows = Array.from(byTenor.entries()).sort(([a], [b]) => a - b);
  const tenorMax = Math.max(1, ...tenorRows.map(([, v]) => v));

  return (
    <main className="bx-main">
      <section className="bx-col">
        <div className="bx-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div className="bx-hero-k">Capital committed</div>
              <div className="bx-hero-v num">${fmt(committed)}</div>
              <div className="sub">USDC across {yours.length} pool{yours.length === 1 ? '' : 's'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="bx-hero-k">Premium earned</div>
              <div className={`num ${earned >= 0 ? 'up' : 'down'}`} style={{ fontSize: 28, fontWeight: 600, marginTop: 10 }}>{earned >= 0 ? '+' : ''}${fmt(earned)}</div>
              <div className="num up" style={{ fontSize: 13, fontWeight: 600 }}>{committed > 0 ? `${earned >= 0 ? '+' : ''}${pct(earned / committed)} on capital` : ''}</div>
            </div>
          </div>
          <div style={{ marginTop: 24 }}>
            <div className="bx-bar"><i style={{ width: `${used * 100}%`, background: 'var(--blue)' }} /><i style={{ width: `${(1 - used) * 100}%`, background: '#bcd0ff' }} /></div>
            <div className="bx-strip" style={{ borderTop: 0, paddingTop: 0, marginTop: 16 }}>
              <div><div className="k"><span className="bx-dot" style={{ background: 'var(--blue)' }} />Reserved</div><div className="v num">${fmt(reserved, 0)}</div></div>
              <div><div className="k"><span className="bx-dot" style={{ background: '#bcd0ff' }} />Available</div><div className="v num">${fmt(available, 0)}</div></div>
              <div><div className="k">{hint("Active hedges")}</div><div className="v num">{hedges}</div></div>
            </div>
          </div>
        </div>
        <div className="bx-card">
          <div className="bx-card-h"><h2>Your pools</h2><button className="bx-link" onClick={() => go('u-pools')}>All pools</button></div>
          {pools.isLoading ? <Loading /> : !yours.length ? <div className="bx-empty">No capital committed yet. <button className="bx-link" onClick={() => go('u-create')}>Create a pool</button> or <button className="bx-link" onClick={() => go('u-pools')}>add to one</button>.</div> : <PoolRows pools={yours} stakes={stakes} go={go} />}
        </div>
      </section>
      <aside className="bx-aside">
        <div className="bx-card tight">
          <h2 style={{ marginBottom: 4 }}>Upcoming capital releases</h2>
          {!upcoming.length ? <div className="bx-empty">No capital is reserved right now.</div> : upcoming.map(([day, amount]) => (
            <div key={day} className="bx-mini"><span className="bx-ic"><CalendarDays aria-hidden="true" /></span><div className="grow"><div className="t num">${fmt(amount, 0)}</div><div className="d">in {inDays(day)} days</div></div><span className="muted" style={{ fontSize: 13 }}>{shortDate(day)}</span></div>
          ))}
        </div>
        <div className="bx-card tight">
          <h2 style={{ marginBottom: 12 }}>Exposure by tenor</h2>
          {!tenorRows.length ? <div className="bx-empty">No active cover.</div> : tenorRows.map(([d, v]) => (
            <div key={d} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{d} days</span><span className="num" style={{ fontWeight: 600 }}>${fmt(v, 0)}</span></div>
              <div className="bx-bar thin" style={{ marginTop: 6 }}><i style={{ width: `${(v / tenorMax) * 100}%`, background: 'var(--blue)' }} /></div>
            </div>
          ))}
        </div>
        <div className="bx-cta dark">
          <h3>Underwrite a new currency</h3>
          <p>Commit USDC to one currency risk, set your price per tenor, and earn the premiums hedgers pay.</p>
          <button onClick={() => go('u-create')}>Create pool</button>
        </div>
      </aside>
    </main>
  );
}

// ── My pools ─────────────────────────────────────────────────────────────────

export function MyPools({ go }: { go: Go }) {
  const { pools, all, stakes, yours } = useBook();
  const others = all.filter((p) => !yours.includes(p));
  if (pools.isLoading) return <main className="bx-main"><section className="bx-full"><Loading /></section></main>;
  return (
    <main className="bx-main">
      <section className="bx-full">
        <div className="bx-card">
          <div className="bx-card-h"><h2>Your pools</h2><button className="bx-btn small" onClick={() => go('u-create')}>Create pool</button></div>
          {!yours.length ? <div className="bx-empty">You have no pools yet.</div> : <PoolRows pools={yours} stakes={stakes} go={go} />}
        </div>
        {others.length > 0 && (
          <div className="bx-card">
            <div className="bx-card-h"><h2>Open to new capital</h2><span className="muted" style={{ fontSize: 13 }}>Choose a pool to add liquidity</span></div>
            <PoolRows pools={others} stakes={stakes} go={go} />
          </div>
        )}
      </section>
    </main>
  );
}

// ── Pool page ────────────────────────────────────────────────────────────────

export function PoolPage({ go, poolRef: initial }: { go: Go; poolRef: string | null }) {
  const { pools, all, isCreator } = useBook();
  const [ref, setRef] = useState<string | null>(initial);
  useEffect(() => { if (initial) setRef(initial); }, [initial]);
  useEffect(() => { if ((!ref || !all.some((p) => poolRef(p) === ref)) && all[0]) setRef(poolRef(all.find(isCreator) ?? all[0])); }, [all, ref]);
  const pool = all.find((p) => poolRef(p) === ref) ?? null;
  if (pools.isLoading) return <main className="bx-main"><section className="bx-full"><Loading /></section></main>;
  if (!pool) return <main className="bx-main"><section className="bx-full"><div className="bx-card"><div className="bx-empty">No pools yet. <button className="bx-link" onClick={() => go('u-create')}>Create the first one</button>.</div></div></section></main>;
  const nav = Number(pool.liquidity.nav);
  const growth = sharePrice(pool) - 1;
  const creator = isCreator(pool);
  return (
    <main className="bx-main">
      <section className="bx-col">
        <div className="bx-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <Flag pair={pool.pair} large />
            <div><div style={{ fontSize: 22, fontWeight: 600 }}>{poolName(pool)} pool</div><div className="muted">Pays hedgers if {pool.pair} {pool.direction === 'down' ? 'falls below' : 'rises past'} their strike</div></div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
<button className="bx-btn ghost small" onClick={() => go('pair', { pair: pool.pair })}>Chart and positions</button>
              <Tag tone={pool.acceptingHedges ? 'green' : 'grey'}>{pool.acceptingHedges ? 'Accepting hedges' : 'Paused'}</Tag>
              {all.length > 1 && <PoolPicker pools={all} value={ref} onChange={setRef} />}
            </div>
          </div>
          <div className="bx-strip">
            <div><div className="k">{hint("Liquidity")}</div><div className="v num">${fmt(nav, 0)}</div></div>
            <div><div className="k">{hint("Available")}</div><div className="v num">${fmt(pool.liquidity.capacity, 0)}</div></div>
            <div><div className="k">{hint("In use")}</div><div className="v num">{pct(nav ? Number(pool.liquidity.reserved) / nav : 0, 0)}</div></div>
            <div><div className="k">{hint("Return")}</div><div className={`v num ${growth >= 0 ? 'up' : 'down'}`}>{growth >= 0 ? '+' : ''}{pct(growth)}</div></div>
            <div><div className="k">{hint("Active hedges")}</div><div className="v num">{pool.activePositions}</div></div>
          </div>
        </div>
        <TenorPricing pool={pool} editable={creator} />
        <ProtectionSettings pool={pool} editable={creator} />
      </section>
      <aside className="bx-aside" aria-label="Liquidity"><LiquidityPanel pool={pool} /></aside>
    </main>
  );
}

function TenorPricing({ pool, editable }: { pool: CurrencyPool; editable: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const direction: Direction = pool.direction === 'down' ? 'down' : 'up';
  const [extra, setExtra] = useState<number[]>([]);
  const days = Array.from(new Set([...pool.tenors.map((t) => t.tenorDays), ...extra])).sort((a, b) => a - b);
  const fair = useFair(pool.pair, direction, days, pool.structures.minStrikeDistanceBps ?? 0);
  const fairOf = (d: number) => fair.data?.rows.find((r) => r.tenorDays === d)?.fairRateE6 ?? null;
  const [offers, setOffers] = useState<Record<number, string>>({});
  const [newDays, setNewDays] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const sold = new Map<number, number>();
  for (const p of usePoolPositions([pool]).get(poolRef(pool)) ?? []) sold.set(p.tenorDays, (sold.get(p.tenorDays) ?? 0) + Number(p.maxPayout));
  useEffect(() => { setOffers({}); setExtra([]); }, [pool.ref.id]);
  const cols = { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr) 72px' };

  async function save(tenorDays: number, active: boolean, markupBps: number) {
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

  return (
    <div className="bx-card">
      <div className="bx-card-h" style={{ alignItems: 'flex-end' }}>
        <div><h2>Tenor pricing</h2><div className="sub">BlockFinaX calculates the fair price. {editable ? 'You set your offer.' : "The pool's creator sets the offer."} All tenors share this pool's liquidity.</div></div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 640 }}>
          <div className="bx-list-h" style={cols}><span>{hint("Tenor")}</span><span className="r">{hint("Fair price")}</span><span className="r">{hint("Offer")}</span><span className="r">{hint("Difference")}</span><span className="r">{hint("Active cover")}</span><span className="r">On</span></div>
          {days.map((d) => {
            const t = pool.tenors.find((x) => x.tenorDays === d);
            const f = fairOf(d);
            const markup = t?.markupBps ?? 11500;
            const offer = offers[d] ?? (f ? ((f / 1e6) * (markup / 10000) * 100).toFixed(2) : '');
            const newMarkup = f && Number(offer) > 0 ? Math.round(((Number(offer) / 100) / (f / 1e6)) * 10000) : markup;
            const diff = f && Number(offer) > 0 ? Math.round((Number(offer) / 100 - f / 1e6) * 10000) : null;
            const valid = newMarkup >= MARKUP_MIN && newMarkup <= MARKUP_MAX;
            const changed = !t || newMarkup !== t.markupBps;
            return (
              <div key={d} className="bx-li" style={cols}>
                <span style={{ fontWeight: 600 }}>{d} days</span>
                <span className="r num" style={{ color: 'var(--text-2)' }}>{f ? pct(f / 1e6) : fair.isLoading ? '...' : '-'}</span>
                <span className="r">{editable ? <label className="bx-mini-input"><input aria-label={`Offer for ${d} days`} value={offer} onChange={(e) => setOffers((o) => ({ ...o, [d]: e.target.value.replace(/[^0-9.]/g, '') }))} /><span className="muted">%</span></label> : <span className="num" style={{ fontWeight: 600 }}>{offer}%</span>}</span>
                <span className={`r num ${diff !== null && diff >= 0 ? 'up' : 'down'}`} style={{ fontWeight: 600 }}>{diff === null ? '-' : `${diff >= 0 ? '+' : ''}${diff} bps`}</span>
                <span className="r num">${fmt(sold.get(d) ?? 0, 0)}</span>
                <span className="r">{busy === d ? <Spin /> : editable && changed ? <button className="bx-btn small" disabled={!valid} onClick={() => save(d, t ? t.active : true, newMarkup)}>{t ? 'Save' : 'Add'}</button>
                  : t ? <Toggle label={`${d}-day tenor`} on={t.active} disabled={!editable} onChange={(v) => save(d, v, t.markupBps)} /> : null}</span>
              </div>
            );
          })}
          {editable && (
            <div className="bx-li" style={{ ...cols, background: '#f7f9fc', borderRadius: 10, borderTop: 0, marginTop: 8, padding: '12px' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input className="bx-input num" aria-label="New tenor in days" style={{ width: 64, padding: '6px 8px' }} value={newDays} onChange={(e) => setNewDays(e.target.value.replace(/\D/g, ''))} placeholder="4" /><span className="muted">days</span></label>
              <span className="r muted" style={{ gridColumn: 'span 4' }}>Add any tenor from 1 to 365 days, then set its offer above.</span>
              <span className="r"><button className="bx-btn small" disabled={!(Number(newDays) >= 1 && Number(newDays) <= 365) || days.includes(Number(newDays))} onClick={() => { setExtra((x) => [...x, Number(newDays)]); setNewDays(''); }}>Add</button></span>
            </div>
          )}
        </div>
      </div>
      {editable && <div className="sub" style={{ marginTop: 10 }}>Offers must be 90% to 500% of the fair price.</div>}
    </div>
  );
}

function ProtectionSettings({ pool, editable }: { pool: CurrencyPool; editable: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(pool.structures.open);
  const [capped, setCapped] = useState(pool.structures.capped);
  const [minCap, setMinCap] = useState(String(pool.structures.minCapDistanceBps / 100));
  const [maxCap, setMaxCap] = useState(String(pool.structures.maxCapDistanceBps / 100));
  const [openMax, setOpenMax] = useState(String(pool.structures.openMaxPayoutBps / 100));
  const [minStrike, setMinStrike] = useState(String((pool.structures.minStrikeDistanceBps ?? 0) / 100));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMinStrike(String((pool.structures.minStrikeDistanceBps ?? 0) / 100));
    setOpen(pool.structures.open); setCapped(pool.structures.capped);
    setMinCap(String(pool.structures.minCapDistanceBps / 100)); setMaxCap(String(pool.structures.maxCapDistanceBps / 100)); setOpenMax(String(pool.structures.openMaxPayoutBps / 100));
  }, [pool.ref.id]);
  const dirty = open !== pool.structures.open || capped !== pool.structures.capped || Number(minCap) * 100 !== pool.structures.minCapDistanceBps
    || Number(maxCap) * 100 !== pool.structures.maxCapDistanceBps || Number(openMax) * 100 !== pool.structures.openMaxPayoutBps
    || Math.round(Number(minStrike) * 100) !== (pool.structures.minStrikeDistanceBps ?? 0);
  async function save() {
    setBusy(true);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/structures/prepare`, {
        open, capped, minCapDistanceBps: Math.round(Number(minCap) * 100), maxCapDistanceBps: Math.round(Number(maxCap) * 100), openMaxPayoutBps: Math.round(Number(openMax) * 100),
        minStrikeDistanceBps: Math.round(Number(minStrike) * 100),
      });
      await signAndSend(transactions, () => {});
      toast({ title: 'Protection settings saved' });
      void qc.invalidateQueries({ queryKey: ['v2-pools'] });
    } catch (e) {
      toast({ title: 'Not saved', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }
  const box = { border: '1px solid var(--line-2)', borderRadius: 12, padding: 16 } as const;
  return (
    <div className="bx-card">
      <div className="bx-card-h"><h2>Protection settings</h2>{editable && dirty && <button className="bx-btn small" disabled={busy || (!open && !capped)} onClick={save}>{busy ? <Spin /> : 'Save settings'}</button>}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: 8 }}>
        <div style={box}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontWeight: 600 }}>Capped Protection</span><Toggle label="Capped Protection" on={capped} disabled={!editable} onChange={setCapped} /></div>
          <div className="sub" style={{ margin: '6px 0 12px' }}>Hedgers choose a cap within your boundaries.</div>
          {capped && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="bx-field" style={{ margin: 0 }}><span>{hint("Smallest cap (%)")}</span><input className="bx-input num" disabled={!editable} value={minCap} onChange={(e) => setMinCap(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
            <label className="bx-field" style={{ margin: 0 }}><span>{hint("Largest cap (%)")}</span><input className="bx-input num" disabled={!editable} value={maxCap} onChange={(e) => setMaxCap(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
          </div>}
        </div>
        <div style={box}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontWeight: 600 }}>Open Protection</span><Toggle label="Open Protection" on={open} disabled={!editable} onChange={setOpen} /></div>
          <div className="sub" style={{ margin: '6px 0 12px' }}>Pays the whole move, up to your maximum.</div>
          {open && <label className="bx-field" style={{ margin: 0 }}><span>{hint("Maximum payout, % of amount")}</span><input className="bx-input num" disabled={!editable} value={openMax} onChange={(e) => setOpenMax(e.target.value.replace(/[^0-9.]/g, ''))} /></label>}
        </div>
      </div>
      <label className="bx-field" style={{ marginTop: 16, marginBottom: 0, maxWidth: 360 }}>
        <span>{hint("Closest strike allowed (% from today's rate)")}</span>
        <input className="bx-input num" disabled={!editable} value={minStrike} onChange={(e) => setMinStrike(e.target.value.replace(/[^0-9.]/g, ''))} />
        <span className="muted" style={{ fontSize: 12 }}>0 lets buyers start cover at today's rate. A higher number only sells cover that starts further away, which is less likely to pay out.</span>
      </label>
    </div>
  );
}

function FundingSelect({ value, onChange }: { value: string | null; onChange: (k: string) => void }) {
  const chains = useChains();
  const balances = useUsdcBalances();
  const hub = chains.data?.activeLiquidityHub;
  const funding = (chains.data?.chains ?? []).filter((c) => c.capabilities.funding);
  useEffect(() => { if (!value && hub) onChange(hub); }, [hub, value, onChange]);
  return (
    <div>
      <label htmlFor="bx-fund" className="bx-label">Fund from</label>
      <select id="bx-fund" className="bx-select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {funding.map((c) => <option key={c.key} value={c.key}>{c.name} · ${fmt(usdcOn(balances.data?.rows, c.key))} available</option>)}
      </select>
      {value && hub && value !== hub && <div style={{ marginTop: 10 }}><Note>BlockFinaX will route the funds automatically. No bridging needed.</Note></div>}
    </div>
  );
}

/** One underwriter's money in a per-hedge pool. */
function LpBreakdown({ account }: { account: LpAccount }) {
  return (
    <div className="bx-sums" style={{ borderTop: 0 }}>
      <Sum l="Free (withdraw any time)" v={<span className="num">${fmt(account.free)}</span>} />
      <Sum l="Reserved for protection you back" v={<span className="num">${fmt(account.reserved)}</span>} />
      <Sum l="Premiums paid to you" v={<span className="num up">+${fmt(account.earned)}</span>} />
      <Sum l="Payouts you covered" v={<span className="num">${fmt(account.paid)}</span>} />
    </div>
  );
}

/** Whether this underwriter's free money backs new sales, and the longest protection it backs. */
function BackingPreferences({ pool, account, tenors }: { pool: CurrencyPool; account: LpAccount; tenors: number[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function save(backing: boolean, maxTenorDays: number) {
    setBusy(true);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/preferences/prepare`, { backing, maxTenorDays });
      await signAndSend(transactions, () => {});
      toast({ title: 'Preferences saved' });
      void qc.invalidateQueries({ queryKey: ['v2-lp'] });
    } catch (e) {
      toast({ title: 'Not saved', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }
  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div><div style={{ fontWeight: 600, fontSize: 14 }}>Back new protection</div><div className="muted" style={{ fontSize: 12 }}>Off: your free money backs no new sales. Protection you already back keeps its reserve.</div></div>
        <Toggle on={account.backing} disabled={busy} label="Back new protection" onChange={(v) => save(v, account.maxTenorDays)} />
      </div>
      <label className="bx-field" style={{ marginTop: 12, marginBottom: 0 }}>
        <span>{hint("Longest protection I back")}</span>
        <select className="bx-select" disabled={busy || !account.backing} value={account.maxTenorDays} onChange={(e) => save(true, Number(e.target.value))}>
          <option value={0}>Any length the pool offers</option>
          {tenors.map((d) => <option key={d} value={d}>Up to {d} days</option>)}
        </select>
      </label>
    </div>
  );
}

function LiquidityPanel({ pool, initialMode = 'add' }: { pool: CurrencyPool; initialMode?: 'add' | 'withdraw' }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chains = useChains();
  const balances = useUsdcBalances();
  const stake = useQuery({ queryKey: ['v2-lp', poolRef(pool)], queryFn: () => api<Stake>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/lp`) });
  const withdrawals = useQuery({ queryKey: ['v2-withdrawals'], queryFn: async () => (await api<{ withdrawals: Withdrawal[] }>('/api/v2/withdrawals')).withdrawals, refetchInterval: 30_000 });
  const [mode, setMode] = useState<'add' | 'withdraw'>(initialMode);
  const [network, setNetwork] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const hub = chains.data?.activeLiquidityHub;
  const hubName = chains.data?.chains.find((c) => c.key === hub)?.name;
  const price = sharePrice(pool);
  const mine = Number(stake.data?.value ?? 0);
  const acct = stake.data?.account;
  const available = mode === 'add' ? usdcOn(balances.data?.rows, network ?? hub) : acct ? Number(acct.withdrawable) : mine;
  const pending = (withdrawals.data ?? []).filter((w) => w.poolId === pool.poolId && w.chain === pool.chain && (!w.contract || w.contract === pool.ref.contract) && w.status === 'pending');
  const after = mode === 'add' ? mine + Number(amount || 0) : Math.max(0, mine - Number(amount || 0));
  const navAfter = Number(pool.liquidity.nav) + (mode === 'add' ? Number(amount || 0) : -Number(amount || 0));

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    try { await work(); } catch (e) {
      toast({ title: 'Not completed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }
  const submit = () => run(mode === 'add' ? 'Adding...' : 'Requesting...', async () => {
    if (mode === 'add') {
      if (network && hub && network !== hub) await routeFunding({ network, amount, hubName });
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/deposits/prepare`, { amount });
      await signAndSend(transactions, (m) => setBusy(m));
      toast({ title: 'Liquidity added', description: `$${fmt(amount)} committed to ${poolName(pool)}.` });
    } else {
      const shares = acct ? Number(amount).toFixed(7) : (Number(amount) / price).toFixed(7);
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/withdrawals/prepare`, { shares });
      await signAndSend(transactions, (m) => setBusy(m));
      toast({ title: 'Withdrawal requested', description: acct ? 'Your free money is ready to withdraw now.' : 'Your capital is released when the cover it backs has ended.' });
    }
    setAmount('');
    for (const k of ['v2-pools', 'v2-lp', 'v2-usdc-all', 'v2-withdrawals']) void qc.invalidateQueries({ queryKey: [k] });
  });
  const complete = (w: Withdrawal) => run(`w${w.requestId}`, async () => {
    const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/withdrawals/${w.chain}/${w.requestId}/execute/prepare${w.contract ? `?contract=${w.contract}` : ''}`, {});
    await signAndSend(transactions, () => {});
    toast({ title: 'Capital withdrawn', description: 'The USDC is in your account.' });
    for (const k of ['v2-withdrawals', 'v2-lp', 'v2-pools', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
  });

  return (
    <div className="bx-panel">
      <div className="bx-seg">
        <button className={mode === 'add' ? 'on' : ''} onClick={() => { setMode('add'); setAmount(''); }}>Add liquidity</button>
        <button className={mode === 'withdraw' ? 'on' : ''} onClick={() => { setMode('withdraw'); setAmount(''); }}>Withdraw</button>
      </div>
      <div className="bx-big">
        <label htmlFor="bx-liq">Amount (USDC)</label>
        <input id="bx-liq" inputMode="decimal" value={`$${amount}`} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        <div className="bx-pills" style={{ marginTop: 8 }}>
          {[0.25, 0.5, 0.75, 1].map((f) => <button key={f} className="bx-pill" onClick={() => setAmount((Math.floor(available * f * 100) / 100).toString())}>{f === 1 ? 'Max' : `${f * 100}%`}</button>)}
        </div>
      </div>
      {mode === 'add' ? <FundingSelect value={network} onChange={setNetwork} /> : <Note>{acct ? 'You can withdraw your free money now. Money reserved for protection you back returns to free when that protection ends.' : 'Capital backing active protection is released when that protection ends.'}</Note>}
      {acct && <LpBreakdown account={acct} />}
      <div className="bx-sums">
        <Sum l="Available" v={<span className="num">${fmt(available)}</span>} />
        <Sum l="Your capital after" v={<span className="num">${fmt(after)}</span>} />
        <Sum l="Share of pool" v={<span className="num">{navAfter > 0 ? pct(after / navAfter, 1) : '-'}</span>} />
        <Sum l="Network fees" v="Covered" good />
      </div>
      <button className="bx-btn block" disabled={!!busy || !(Number(amount) > 0) || Number(amount) > available || (mode === 'add' && !pool.allowExternalLp)} onClick={submit}>
        {busy && !busy.startsWith('w') ? <><Spin /> {busy}</> : mode === 'add' ? 'Add liquidity' : 'Request withdrawal'}
      </button>
      {mode === 'add' && !pool.allowExternalLp && <div className="bx-hint">{pool.legacy ? 'This pool is on an earlier contract and takes no new money.' : 'This pool is closed to new underwriters.'}</div>}
      {acct && <BackingPreferences pool={pool} account={acct} tenors={pool.tenors.filter((t) => t.active).map((t) => t.tenorDays)} />}
      {pending.length > 0 && (
        <div className="bx-sums">
          {pending.map((w) => {
            const ready = w.unlockAt <= Date.now() / 1000;
            return <Sum key={w.requestId} l={`$${fmt(withdrawalUsd(w, pool))} ${ready ? 'ready' : `releases ${dateOf(w.unlockAt)}`}`} v={ready ? <button className="bx-btn small" disabled={busy === `w${w.requestId}`} onClick={() => complete(w)}>{busy === `w${w.requestId}` ? <Spin /> : 'Withdraw'}</button> : <Tag tone="amber">Pending</Tag>} />;
          })}
        </div>
      )}
    </div>
  );
}

// ── Create pool ──────────────────────────────────────────────────────────────

type TenorDraft = { tenorDays: number; offerPct: string; active: boolean };

export function CreatePool({ go }: { go: Go }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chains = useChains();
  const balances = useUsdcBalances();
  const setup = useQuery({ queryKey: ['v2-pool-setup'], queryFn: () => api<{ chain: string; pairs: string[]; creationFee: string }>('/api/v2/pools/setup') });
  const [step, setStep] = useState(0);
  const exposures = useMemo(() => (setup.data?.pairs ?? []).flatMap((pair) => (['up', 'down'] as Direction[]).filter(isOffered).map((d) => `${pair}:${d}`)), [setup.data]);
  const [key, setKey] = useState('');
  useEffect(() => { if (!key && exposures[0]) setKey(exposures[0]); }, [exposures, key]);
  const [pair, direction] = (key || ':up').split(':') as [string, Direction];
  const [amount, setAmount] = useState('500');
  const [network, setNetwork] = useState<string | null>(null);
  const [tenors, setTenors] = useState<TenorDraft[]>([3, 7, 14, 30].map((d) => ({ tenorDays: d, offerPct: '', active: true })));
  const [newDays, setNewDays] = useState('');
  // Which durations businesses can buy: any day (the default), up to a maximum, or only the listed ones.
  const [durMode, setDurMode] = useState<'any' | 'up-to' | 'specific'>('any');
  const [durMin, setDurMin] = useState('1');
  const [durMax, setDurMax] = useState('60');
  const [openOn, setOpenOn] = useState(true);
  const [cappedOn, setCappedOn] = useState(true);
  const [minCap, setMinCap] = useState('3');
  const [maxCap, setMaxCap] = useState('20');
  const [openMax, setOpenMax] = useState('30');
  const [minStrike, setMinStrike] = useState('0');
  const [busy, setBusy] = useState<string | null>(null);
  const fair = useFair(pair || null, direction, tenors.map((t) => t.tenorDays), Math.round(Number(minStrike || 0) * 100));
  const fairOf = (d: number) => fair.data?.rows.find((r) => r.tenorDays === d)?.fairRateE6 ?? null;
  useEffect(() => {
    setTenors((ts) => ts.map((t) => { const f = fairOf(t.tenorDays); return t.offerPct || !f ? t : { ...t, offerPct: ((f / 1e6) * 1.15 * 100).toFixed(2) }; }));
  }, [fair.data]);
  useEffect(() => { setTenors((ts) => ts.map((t) => ({ ...t, offerPct: '' }))); }, [key]);
  const markupOf = (t: TenorDraft) => { const f = fairOf(t.tenorDays); return f && Number(t.offerPct) > 0 ? Math.round(((Number(t.offerPct) / 100) / (f / 1e6)) * 10000) : 11500; };
  const hub = chains.data?.activeLiquidityHub;
  const hubName = chains.data?.chains.find((c) => c.key === hub)?.name;
  const fee = Number(setup.data?.creationFee ?? 0);
  const total = Number(amount || 0) + fee;
  const have = usdcOn(balances.data?.rows, network ?? hub);
  const problems = [
    !(Number(amount) >= 10) ? 'Commit at least $10' : total > have ? `You need $${fmt(total)} USDC on this network` : null,
    !tenors.some((t) => t.active) ? 'Turn on at least one tenor' : tenors.some((t) => markupOf(t) < MARKUP_MIN || markupOf(t) > MARKUP_MAX) ? 'Each offer must be 90% to 500% of the fair price' : null,
    !openOn && !cappedOn ? 'Offer at least one protection type' : Number(maxCap) > 0 && Number(minCap) > Number(maxCap) ? 'The smallest cap must be below the largest' : !(Number(minStrike) >= 0 && Number(minStrike) <= 50) ? 'Closest strike must be 0% to 50%' : null,
    null,
  ];

  async function create() {
    setBusy('Preparing...');
    try {
      if (network && hub && network !== hub) await routeFunding({ network, amount: String(total), hubName });
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/pools/prepare', {
        pair, direction, allowExternalLp: true, initialLiquidity: amount,
        structures: { open: openOn, capped: cappedOn, minCapDistanceBps: Math.round(Number(minCap) * 100), maxCapDistanceBps: Math.round(Number(maxCap) * 100), openMaxPayoutBps: Math.round(Number(openMax) * 100), minStrikeDistanceBps: Math.round(Number(minStrike) * 100) },
        tenors: tenors.map((t) => ({ tenorDays: t.tenorDays, active: t.active, markupBps: markupOf(t) })),
      });
      await signAndSend(transactions, (m) => setBusy(m));
      // New pools sell any day up to the protocol maximum; anything else is a second approval.
      if (durMode !== 'any' || Number(durMin) > 1) {
        setBusy('Setting durations...');
        const mine = (await api<{ pools: CurrencyPool[] }>('/api/v2/pools')).pools
          .filter((p) => p.pair === pair && p.direction === direction && !p.legacy)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (mine) {
          const rule = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(mine))}/durations/prepare`, {
            mode: durMode, minDays: Math.max(1, Math.round(Number(durMin) || 1)), maxDays: Math.round(Number(durMax) || 0),
          });
          await signAndSend(rule.transactions, (m) => setBusy(m));
        }
      }
      toast({ title: 'Pool created', description: `Your ${exposureLabel(pair, direction).cover} pool is live.` });
      for (const k of ['v2-pools', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
      go('u-pools');
    } catch (e) {
      toast({ title: 'Pool not created', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (setup.isLoading) return <main className="bx-main"><section className="bx-full"><Loading /></section></main>;
  const box = { border: '1px solid var(--line-2)', borderRadius: 12, padding: 16 } as const;
  const tcols = { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr) 56px 36px' };
  return (
    <main className="bx-main">
      <section className="bx-col">
        <div className="bx-card">
          <h2 style={{ marginBottom: 14 }}>Create pool</h2>
          <Steps labels={['Currency and capital', 'Tenors', 'Protection', 'Review']} current={step} />
        </div>
        <div className="bx-card">
          {step === 0 && (
            <>
              <label className="bx-field"><span>{hint("Underwrite")}</span>
                <select className="bx-select" value={key} onChange={(e) => setKey(e.target.value)}>
                  {exposures.map((k) => { const [p, d] = k.split(':') as [string, Direction]; return <option key={k} value={k}>{exposureLabel(p, d).cover} ({p})</option>; })}
                </select>
              </label>
              {pair && <div className="sub" style={{ marginTop: -8, marginBottom: 16 }}>You pay out if the {ccyName(pair)} {exposureLabel(pair, direction).verb} past what buyers chose, and earn their premiums otherwise.</div>}
              <label className="bx-field"><span>{hint("Commit liquidity (USDC)")}</span><input className="bx-input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
              <div className="bx-pills" style={{ marginBottom: 16, marginTop: -8 }}>{[100, 250, 500, 1000].map((c) => <button key={c} className={`bx-pill${Number(amount) === c ? ' on' : ''}`} onClick={() => setAmount(String(c))}>${c.toLocaleString()}</button>)}</div>
              <FundingSelect value={network} onChange={setNetwork} />
            </>
          )}
          {step === 1 && (
            <>
              <h2>Durations and prices</h2>
              <span className="bx-label" style={{ marginTop: 8 }}>Which durations can businesses buy?</span>
              <div className="bx-seg" style={{ marginBottom: 8 }}>
                <button className={durMode === 'any' ? 'on' : ''} onClick={() => setDurMode('any')}>Any day</button>
                <button className={durMode === 'up-to' ? 'on' : ''} onClick={() => setDurMode('up-to')}>Up to a maximum</button>
                <button className={durMode === 'specific' ? 'on' : ''} onClick={() => setDurMode('specific')}>Only these durations</button>
              </div>
              {durMode !== 'specific' && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                  <label className="bx-mini-input">Shortest <input aria-label="Shortest duration in days" value={durMin} onChange={(e) => setDurMin(e.target.value.replace(/\D/g, ''))} /><span className="muted">days</span></label>
                  {durMode === 'up-to' && <label className="bx-mini-input">Longest <input aria-label="Longest duration in days" value={durMax} onChange={(e) => setDurMax(e.target.value.replace(/\D/g, ''))} /><span className="muted">days</span></label>}
                </div>
              )}
              <div className="sub" style={{ marginBottom: 8 }}>
                {durMode === 'specific'
                  ? 'Businesses can buy only the durations below. BlockFinaX calculates the fair price; you choose the offer.'
                  : `Businesses pick any end date${durMode === 'up-to' ? ` up to ${durMax || '?'} days` : ' up to 90 days'}. The durations below are your price points; prices in between are filled in smoothly.`}
                {' '}All durations share this pool's liquidity.
              </div>
              <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 560 }}>
                <div className="bx-list-h" style={tcols}><span>{hint("Tenor")}</span><span className="r">{hint("Fair price")}</span><span className="r">{hint("Your offer")}</span><span className="r">{hint("Difference")}</span><span className="r">On</span><span /></div>
                {tenors.map((t, i) => {
                  const f = fairOf(t.tenorDays);
                  const diff = f && Number(t.offerPct) > 0 ? Math.round((Number(t.offerPct) / 100 - f / 1e6) * 10000) : null;
                  return (
                    <div key={t.tenorDays} className="bx-li" style={tcols}>
                      <span style={{ fontWeight: 600 }}>{t.tenorDays} days</span>
                      <span className="r num">{f ? pct(f / 1e6) : fair.isLoading ? '...' : '-'}</span>
                      <span className="r"><label className="bx-mini-input"><input aria-label={`Offer for ${t.tenorDays} days`} value={t.offerPct} onChange={(e) => setTenors((ts) => ts.map((x, j) => (j === i ? { ...x, offerPct: e.target.value.replace(/[^0-9.]/g, '') } : x)))} /><span className="muted">%</span></label></span>
                      <span className={`r num ${diff !== null && diff >= 0 ? 'up' : 'down'}`} style={{ fontWeight: 600 }}>{diff === null ? '-' : `${diff >= 0 ? '+' : ''}${diff} bps`}</span>
                      <span className="r"><Toggle label={`${t.tenorDays}-day tenor`} on={t.active} onChange={(v) => setTenors((ts) => ts.map((x, j) => (j === i ? { ...x, active: v } : x)))} /></span>
                      <span className="r"><button className="bx-link" aria-label={`Remove ${t.tenorDays} days`} onClick={() => setTenors((ts) => ts.filter((_, j) => j !== i))}><Trash2 size={15} /></button></span>
                    </div>
                  );
                })}
              </div></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                <input className="bx-input num" style={{ width: 90 }} aria-label="New tenor in days" placeholder="Days" value={newDays} onChange={(e) => setNewDays(e.target.value.replace(/\D/g, ''))} />
                <button className="bx-btn ghost small" disabled={!(Number(newDays) >= 1 && Number(newDays) <= 365) || tenors.some((t) => t.tenorDays === Number(newDays))} onClick={() => { setTenors((ts) => [...ts, { tenorDays: Number(newDays), offerPct: '', active: true }].sort((a, b) => a.tenorDays - b.tenorDays)); setNewDays(''); }}>Add tenor</button>
              </div>
            </>
          )}
          {step === 2 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <div style={box}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontWeight: 600 }}>Capped Protection</span><Toggle label="Capped Protection" on={cappedOn} onChange={setCappedOn} /></div>
                <div className="sub" style={{ margin: '6px 0 12px' }}>Hedgers choose a cap within your boundaries.</div>
                {cappedOn && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label className="bx-field" style={{ margin: 0 }}><span>{hint("Smallest cap (%)")}</span><input className="bx-input num" value={minCap} onChange={(e) => setMinCap(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
                  <label className="bx-field" style={{ margin: 0 }}><span>{hint("Largest cap (%)")}</span><input className="bx-input num" value={maxCap} onChange={(e) => setMaxCap(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
                </div>}
              </div>
              <div style={box}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontWeight: 600 }}>Open Protection</span><Toggle label="Open Protection" on={openOn} onChange={setOpenOn} /></div>
                <div className="sub" style={{ margin: '6px 0 12px' }}>Pays the whole move, up to your maximum.</div>
                {openOn && <label className="bx-field" style={{ margin: 0 }}><span>{hint("Maximum payout, % of amount")}</span><input className="bx-input num" value={openMax} onChange={(e) => setOpenMax(e.target.value.replace(/[^0-9.]/g, ''))} /></label>}
              </div>
              <label className="bx-field" style={{ ...box, margin: 0 }}>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>Closest strike allowed</span>
                <span className="sub" style={{ margin: '0 0 6px' }}>How close to today's rate cover may start. 0% sells cover from today's rate.</span>
                <input className="bx-input num" value={minStrike} onChange={(e) => setMinStrike(e.target.value.replace(/[^0-9.]/g, ''))} />
              </label>
            </div>
          )}
          {step === 3 && (
            <div className="bx-sums" style={{ borderTop: 0 }}>
              <Sum l="Underwrite" v={exposureLabel(pair, direction).cover} />
              <Sum l="Committed liquidity" v={<span className="num">${fmt(amount)}</span>} />
              {tenors.filter((t) => t.active).map((t) => <Sum key={t.tenorDays} l={`${t.tenorDays}-day offer`} v={<span className="num">{t.offerPct}%</span>} />)}
              {cappedOn && <Sum l="Capped Protection" v={`caps ${minCap}% to ${maxCap}%`} />}
              {openOn && <Sum l="Open Protection" v={`max payout ${openMax}%`} />}
              <Sum l="Closest strike allowed" v={Number(minStrike) === 0 ? "Today's rate" : `${minStrike}% from today`} />
            </div>
          )}
          {problems[step] && <p className="bx-error" style={{ marginTop: 12 }}>{problems[step]}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            {step > 0 && <button className="bx-btn ghost" disabled={!!busy} onClick={() => setStep((s) => s - 1)}>Back</button>}
            {step < 3
              ? <button className="bx-btn" disabled={!!problems[step]} onClick={() => setStep((s) => s + 1)}>Continue</button>
              : <button className="bx-btn" disabled={!!busy || problems.some(Boolean)} onClick={create}>{busy ? <><Spin /> {busy}</> : 'Create pool'}</button>}
          </div>
        </div>
      </section>
      <aside className="bx-aside">
        <div className="bx-panel">
          <div style={{ fontSize: 16, fontWeight: 600 }}>Pool summary</div>
          {pair && <div className="bx-who"><Flag pair={pair} /><div><div className="t">{exposureLabel(pair, direction).cover}</div><div className="d">{pair}</div></div></div>}
          <div className="bx-sums">
            <Sum l="Liquidity" v={<span className="num">${fmt(amount)}</span>} />
            <Sum l="Funding network" v={chains.data?.chains.find((c) => c.key === (network ?? hub))?.name ?? '-'} />
            <Sum l="Active liquidity hub" v={hubName ?? '-'} />
            <Sum l="Tenors" v={tenors.filter((t) => t.active).map((t) => `${t.tenorDays}d`).join(', ') || '-'} />
            <Sum l="Protection" v={[cappedOn && 'Capped', openOn && 'Open'].filter(Boolean).join(' and ') || '-'} />
            <Sum l="Creation fee" v={<span className="num">${fmt(fee)}</span>} />
            <Sum l="Network fees" v="Covered" good />
            <Sum l="Total" v={<span className="num">${fmt(total)}</span>} total />
          </div>
          <Note>You can fund from any supported network. BlockFinaX will route the funds automatically.</Note>
        </div>
      </aside>
    </main>
  );
}

// ── Risk and exposure ────────────────────────────────────────────────────────

export function RiskPage({ go, poolRef: initial }: { go: Go; poolRef: string | null }) {
  const { pools, all } = useBook();
  const [ref, setRef] = useState<string | null>(initial);
  useEffect(() => { if ((!ref || !all.some((p) => poolRef(p) === ref)) && all[0]) setRef(poolRef(all[0])); }, [all, ref]);
  const pool = all.find((p) => poolRef(p) === ref) ?? null;
  const positions = usePoolPositions(pool ? [pool] : []).get(ref ?? '') ?? [];
  if (pools.isLoading) return <main className="bx-main"><section className="bx-full"><Loading /></section></main>;
  if (!pool) return <main className="bx-main"><section className="bx-full"><div className="bx-card"><div className="bx-empty">No pools yet.</div></div></section></main>;
  const nav = Number(pool.liquidity.nav), reserved = Number(pool.liquidity.reserved), available = Number(pool.liquidity.capacity);
  const held = Math.max(nav - reserved - available, 0);
  const byTenor = new Map<number, number>();
  const byType = { capped: 0, open: 0 };
  for (const p of positions) { byTenor.set(p.tenorDays, (byTenor.get(p.tenorDays) ?? 0) + Number(p.maxPayout)); byType[p.structure] += Number(p.maxPayout); }
  const releases = releasesOf(positions);
  const colors = ['#1f5fe0', '#5b8def', '#93b4f5', '#0f1729', '#9aa2af', '#c9d8ff'];
  const Bar = ({ parts }: { parts: { label: string; v: number; c: string }[] }) => {
    const t = parts.reduce((s, p) => s + p.v, 0) || 1;
    return (
      <>
        <div className="bx-bar">{parts.map((p) => <i key={p.label} style={{ width: `${(p.v / t) * 100}%`, background: p.c }} />)}</div>
        <div className="bx-strip" style={{ borderTop: 0, paddingTop: 0, marginTop: 14 }}>{parts.map((p) => <div key={p.label}><div className="k"><span className="bx-dot" style={{ background: p.c }} />{p.label}</div><div className="v num">${fmt(p.v, 0)}</div></div>)}</div>
      </>
    );
  };
  return (
    <main className="bx-main">
      <section className="bx-col">
        <div className="bx-card">
          <div className="bx-card-h"><div className="bx-who"><Flag pair={pool.pair} /><div><div className="t">{poolName(pool)}</div><div className="d">{pool.pair}</div></div></div>{all.length > 1 && <PoolPicker pools={all} value={ref} onChange={setRef} />}</div>
          <div style={{ marginTop: 16 }}><Bar parts={[{ label: 'Reserved', v: reserved, c: '#1f5fe0' }, { label: 'Available', v: available, c: '#bcd0ff' }, { label: 'Held back', v: held, c: '#dfe3ea' }]} /></div>
        </div>
        <div className="bx-card"><h2 style={{ marginBottom: 14 }}>Active exposure by tenor</h2>{byTenor.size ? <Bar parts={Array.from(byTenor.entries()).sort(([a], [b]) => a - b).map(([d, v], i) => ({ label: `${d} days`, v, c: colors[i % colors.length] }))} /> : <div className="bx-empty">No active cover.</div>}</div>
        <div className="bx-card"><h2 style={{ marginBottom: 14 }}>Active exposure by protection type</h2>{positions.length ? <Bar parts={[{ label: 'Capped', v: byType.capped, c: '#1f5fe0' }, { label: 'Open', v: byType.open, c: '#0f1729' }]} /> : <div className="bx-empty">No active cover.</div>}</div>
      </section>
      <aside className="bx-aside">
        <div className="bx-card tight">
          <h2 style={{ marginBottom: 4 }}>Upcoming capital releases</h2>
          {!releases.length ? <div className="bx-empty">Nothing reserved right now.</div> : releases.map(([day, amount]) => (
            <div key={day} className="bx-mini"><span className="bx-ic"><CalendarDays aria-hidden="true" /></span><div className="grow"><div className="t num">${fmt(amount, 0)}</div><div className="d">in {inDays(day)} days</div></div><span className="muted" style={{ fontSize: 13 }}>{shortDate(day)}</span></div>
          ))}
        </div>
        <button className="bx-btn ghost" onClick={() => go('u-pool', { pool: poolRef(pool) })}>Open pool</button>
      </aside>
    </main>
  );
}

// ── Withdraw ─────────────────────────────────────────────────────────────────

export function WithdrawCapital({ go, poolRef: initial }: { go: Go; poolRef: string | null }) {
  const { pools, all, stakes } = useBook();
  const invested = all.filter((p) => Number(stakes.get(poolRef(p))?.value ?? 0) > 0);
  const [ref, setRef] = useState<string | null>(initial);
  useEffect(() => { if ((!ref || !invested.some((p) => poolRef(p) === ref)) && invested[0]) setRef(poolRef(invested[0])); }, [invested, ref]);
  const pool = invested.find((p) => poolRef(p) === ref) ?? null;
  const withdrawals = useQuery({ queryKey: ['v2-withdrawals'], queryFn: async () => (await api<{ withdrawals: Withdrawal[] }>('/api/v2/withdrawals')).withdrawals, refetchInterval: 30_000 });
  const poolOf = (w: Withdrawal) => all.find((p) => p.poolId === w.poolId && p.chain === w.chain && (!w.contract || p.ref.contract === w.contract));
  const cols = { gridTemplateColumns: 'minmax(0, 2fr) repeat(2, minmax(0, 1fr))' };
  if (pools.isLoading) return <main className="bx-main"><section className="bx-full"><Loading /></section></main>;
  return (
    <main className="bx-main">
      <section className="bx-col">
        <div className="bx-card">
          <div className="bx-card-h"><h2>Your withdrawals</h2></div>
          {withdrawals.isLoading ? <Loading /> : !(withdrawals.data ?? []).length ? <div className="bx-empty">No withdrawals yet.</div> : (
            <>
              <div className="bx-list-h" style={cols}><span>{hint("Pool")}</span><span className="r">Amount</span><span className="r">{hint("Status")}</span></div>
              {(withdrawals.data ?? []).map((w) => {
                const p = poolOf(w);
                return (
                  <div key={`${w.chain}-${w.requestId}`} className="bx-li" style={cols}>
                    <div className="bx-who">{p && <Flag pair={p.pair} />}<div className="t">{p ? poolName(p) : `Pool ${w.poolId}`}</div></div>
                    <div className="r num" style={{ fontWeight: 600 }}>${fmt(withdrawalUsd(w, p))}</div>
                    <div className="r">{w.status === 'executed' ? <Tag tone="grey">Withdrawn</Tag> : w.status === 'cancelled' ? <Tag tone="grey">Cancelled</Tag> : w.unlockAt <= Date.now() / 1000 ? <Tag tone="green">Ready</Tag> : <Tag tone="amber">Releases {dateOf(w.unlockAt)}</Tag>}</div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </section>
      <aside className="bx-aside">
        {!invested.length ? <div className="bx-card tight"><div className="bx-empty">You have no capital in a pool.</div></div> : (
          <>
            {invested.length > 1 && <PoolPicker pools={invested} value={ref} onChange={setRef} />}
            {pool && <LiquidityPanel pool={pool} initialMode="withdraw" />}
            {pool && <button className="bx-btn ghost" onClick={() => go('u-pool', { pool: poolRef(pool) })}>Open pool</button>}
          </>
        )}
      </aside>
    </main>
  );
}
