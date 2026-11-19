/**
 * Underwriter pages: "How do you want your capital exposed?"
 * Home, Pools (all pools, and My pools), Create pool, Pool (tenor pricing, protection settings, docked
 * Add liquidity / Withdraw panel), Risk and exposure, Withdraw.
 * All tenors share one pool's liquidity. BlockFinaX computes the fair price; the
 * underwriter sets the offer, stored on chain as a markup on fair, from 90% up to the
 * pair's ceiling (2x unless the protocol owner set another, never above 3x).
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronDown, ChevronLeft, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { CurrencyPool, ProtectionPosition } from '@shared/domain/types';
import { api } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import { usePasskeySession } from '@/lib/identity';
import {
  ccyName, dateOf, exposureLabel, fmt, pct, poolRef, routeFunding, signAndSend, useChains, usePools, useUsdcBalances,
  usdcOn, type Direction, withCommas } from './shared';
import { CoverName, Flag, hint, Loading, Note, Spin, Steps, Sum, Tag, Toggle } from './ui';
import './underwrite.css';
import { MAX_PAYOUT_PCT, PairRateChart } from './hedger-pages';
import type { Go } from './workspace';
import { isOffered } from '@shared/domain/offered-directions';
import { DEFAULT_MARKUP_CEILING_BPS, durationsOffered, saleMarkup } from '@shared/domain/durations';

const MARKUP_MIN = 9000;
/** The most a pool on `pair` may charge, from any pool the server has read on that pair. */
const ceilingFor = (pools: CurrencyPool[] | undefined, pair: string) =>
  pools?.find((p) => p.pair === pair && p.markupCeilingBps)?.markupCeilingBps ?? DEFAULT_MARKUP_CEILING_BPS;
const times = (bps: number) => `${(bps / 10000).toFixed(bps % 1000 === 0 ? 1 : 2)}x`;
const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
/** A pool's own name for a side, or both. */
const coverOf = (pair: string, d: Direction | 'both') => (d === 'both' ? `${pair} Up and Down cover` : exposureLabel(pair, d).cover);
/** Per-hedge underwriting (current Stellar pools): each underwriter's own balances in USDC. */
type LpAccount = { free: string; reserved: string; earned: string; paid: string; pendingWithdraw: string; withdrawable: string; backing: boolean; maxTenorDays: number; minTenorDays?: number };
type Stake = { shares: string; value: string; account?: LpAccount };
type Withdrawal = { chain: string; contract?: string; requestId: number; poolId: number; shares: string; unlockAt: number; status: string };

/** A withdrawal's USDC amount: share-based on legacy pools, already USDC on current ones. */
const withdrawalUsd = (w: Withdrawal, p: CurrencyPool | undefined) => Number(w.shares) * (p?.legacy ? sharePrice(p) : 1);

const sharePrice = (p: CurrencyPool) => (Number(p.totalShares) > 0 ? Number(p.liquidity.nav) / Number(p.totalShares) : 1);
const poolName = (p: CurrencyPool) => (p.direction === 'both' ? `${p.pair} Up and Down cover` : exposureLabel(p.pair, p.direction).cover) + (p.legacy ? ' (earlier contract)' : '');
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


/** Each pool's history: premiums from all cover it sold, payouts, and how many covers. */
type PoolStats = { premiums: number; paid: number; sold: number; premiums30: number; paid30: number };
/** Past results only: premiums minus payouts, as a share of the pool. Never annualised, never a forecast. */
const compactUsd = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));
const PAST_NOTE = 'Past premiums minus payouts, as a share of the pool. Not a forecast: a large rate move can mean losses.';
const returnOf = (net: number, nav: number) => (nav > 0 ? net / nav : null);
function usePoolStats(pools: CurrencyPool[]) {
  const qs = useQueries({ queries: pools.map((p) => ({ queryKey: ['v2-pool-history', poolRef(p)], queryFn: async () => (await api<{ positions: ProtectionPosition[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(p))}/positions?all=1`)).positions, staleTime: 60_000 })) });
  return new Map(pools.map((p, i): [string, PoolStats | undefined] => {
    const rows = qs[i].data;
    if (!rows) return [poolRef(p), undefined];
    const since = Date.now() / 1000 - 30 * 86_400;
    return [poolRef(p), {
      premiums: rows.reduce((a, r) => a + Number(r.premium), 0),
      paid: rows.reduce((a, r) => a + Number(r.payout || 0), 0),
      sold: rows.length,
      premiums30: rows.filter((r) => r.createdAt >= since).reduce((a, r) => a + Number(r.premium), 0),
      paid30: rows.filter((r) => r.expiry >= since && r.expiry <= Date.now() / 1000).reduce((a, r) => a + Number(r.payout || 0), 0),
    }];
  }));
}

/** What each pool charges today for 30-day cover from today's rate: fair price times its markup. */
function use30DayPrices(pools: CurrencyPool[]) {
  const keys = Array.from(new Set(pools.map((p) => `${p.pair}|${p.direction === 'down' ? 'down' : 'up'}`)));
  const qs = useQueries({ queries: keys.map((k) => {
    const [pair, d] = k.split('|');
    return { queryKey: ['v2-fair', pair, d, '30', 0, MAX_PAYOUT_PCT], queryFn: () => api<{ rows: { tenorDays: number; fairRateE6: number | null }[] }>(`/api/v2/fair?pair=${encodeURIComponent(pair)}&direction=${d}&tenors=30&distance=0&limit=${MAX_PAYOUT_PCT * 100}`), staleTime: 300_000 };
  }) });
  const fair = new Map(keys.map((k, i) => [k, qs[i].data?.rows[0]?.fairRateE6 ?? null]));
  return new Map(pools.map((p): [string, number | null] => {
    const d = p.direction === 'down' ? 'down' : 'up';
    const f = fair.get(`${p.pair}|${d}`);
    const m = saleMarkup(p, 30, d);
    return [poolRef(p), f && m ? (f / 1e6) * (m / 10_000) : null];
  }));
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
    queryFn: () => api<{ rows: { tenorDays: number; fairRateE6: number | null }[] }>(`/api/v2/fair?pair=${encodeURIComponent(pair!)}&direction=${direction}&tenors=${days.join(',')}&distance=${distanceBps}&limit=${MAX_PAYOUT_PCT * 100}`),
    staleTime: 60_000,
  });
}

function PoolPicker({ pools, value, onChange }: { pools: CurrencyPool[]; value: string | null; onChange: (ref: string) => void }) {
  return (
    <select className="bx-select" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Pool" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {pools.map((p) => <option key={poolRef(p)} value={poolRef(p)}>{poolName(p)}</option>)}
    </select>
  );
}

const POOL_COLS = { gridTemplateColumns: 'minmax(0, 2fr) repeat(5, minmax(0, 1fr))' };

/** Pools as a buyer of risk sees them: room to sell, today's price, what they have earned, and your stake. */
function PoolRows({ pools, stakes, onPick, selected }: { pools: CurrencyPool[]; stakes: Map<string, Stake | undefined>; onPick: (ref: string) => void; selected?: string | null }) {
  const stats = usePoolStats(pools);
  const prices = use30DayPrices(pools);
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 760 }}>
        <div className="bx-list-h" style={POOL_COLS}><span>{hint('Pool')}</span><span className="r">Available to sell</span><span className="r">In use</span><span className="r">30-day price</span><span className="r" title={PAST_NOTE}>Return so far</span><span className="r">{hint('Your capital')}</span></div>
        {pools.map((p) => {
          const nav = Number(p.liquidity.nav);
          const used = nav > 0 ? Number(p.liquidity.reserved) / nav : 0;
          const st = stats.get(poolRef(p));
          const price = prices.get(poolRef(p));
          const mine = Number(stakes.get(poolRef(p))?.value ?? 0);
          return (
            <div key={poolRef(p)} className={`bx-li bx-li-m click${selected === poolRef(p) ? ' ux-sel' : ''}`} style={POOL_COLS} onClick={() => onPick(poolRef(p))}>
              <div className="bx-who"><Flag pair={p.pair} /><div style={{ minWidth: 0 }}><div className="t"><CoverName pair={p.pair} direction={p.direction} />{p.legacy ? ' (earlier contract)' : ''}</div><div className="d">${fmt(nav, 0)} pool{p.acceptingHedges ? '' : ' · paused'}</div></div></div>
              <div className="r num" style={{ fontWeight: 600 }}>${fmt(p.liquidity.capacity, 0)}</div>
              <div className="r"><div className="num" style={{ fontWeight: 600 }}>{pct(used, 0)}</div><div className="bx-bar thin" style={{ width: 64, marginLeft: 'auto', marginTop: 6 }}><i style={{ width: `${used * 100}%`, background: 'var(--blue)' }} /></div></div>
              <div className="r num" style={{ fontWeight: 600 }}>{price != null ? pct(price) : '-'}</div>
              {(() => {
                const r = st ? returnOf(st.premiums - st.paid, nav) : null;
                return <div className="r num"><span className={r == null ? 'muted' : r > 0 ? 'up' : r < 0 ? 'down' : 'muted'} style={{ fontWeight: 600 }}>{!st ? '...' : st.sold === 0 ? 'No sales yet' : r == null ? '-' : `${r >= 0 ? '+' : ''}${pct(r)}`}</span><div className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{st && st.sold > 0 ? `$${fmt(st.premiums, 0)} in · $${fmt(st.paid, 0)} out` : ''}</div></div>;
              })()}
              <div className={`r num${mine > 0 ? '' : ' muted'}`} style={{ fontWeight: 600 }}>${fmt(mine)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Underwrite: one screen ───────────────────────────────────────────────────

export type DeskTab = 'mine' | 'all' | 'withdrawals';

/**
 * Everything an underwriter does, on one screen like Buy cover: your totals across pools,
 * the chosen pool's numbers, its risk or pricing, and Add liquidity / Withdraw on the right.
 * The tabs underneath hold your pools, every pool, quote requests and withdrawals.
 */
export function UnderwriteDesk({ go, poolRef: initial, tab: initialTab }: { go: Go; poolRef: string | null; tab?: DeskTab }) {
  const { pools, all, stakes, yours, isCreator } = useBook();
  // No pool open until one is clicked: the list first, then the pool's own view.
  // The open pool and the My pools page survive a refresh (this browser tab only).
  const keep = (() => { try { return JSON.parse(sessionStorage.getItem('bfx:uw-view') ?? 'null') as { ref: string | null; mine: boolean } | null; } catch { return null; } })();
  const [ref, setRef] = useState<string | null>(initial ?? keep?.ref ?? null);
  useEffect(() => { if (initial) setRef(initial); }, [initial]);
  const capitalIn = (p: CurrencyPool) => Number(stakes.get(poolRef(p))?.value ?? 0);
  const touched = (p: CurrencyPool) => { const a = stakes.get(poolRef(p))?.account; return capitalIn(p) > 0 || isCreator(p) || Number(a?.earned ?? 0) > 0 || Number(a?.paid ?? 0) > 0; };
  const myActive = all.filter((p) => capitalIn(p) > 0);
  const myEnded = all.filter((p) => touched(p) && capitalIn(p) <= 0);
  const [minePage, setMinePage] = useState(Boolean(keep?.mine));
  const [mineTab, setMineTab] = useState<'active' | 'ended'>('active');
  useEffect(() => { try { sessionStorage.setItem('bfx:uw-view', JSON.stringify({ ref, mine: minePage })); } catch { /* storage blocked */ } }, [ref, minePage]);
  const fallback = yours[0] ?? [...all].filter((p) => p.acceptingHedges && !p.legacy).sort((a, b) => Number(b.liquidity.capacity) - Number(a.liquidity.capacity))[0] ?? all[0];
  const pool = all.find((p) => poolRef(p) === ref) ?? fallback ?? null;
  const market = pool ? all.filter((p) => p.pair === pool.pair && p.direction === pool.direction && ((p.acceptingHedges && !p.legacy) || poolRef(p) === poolRef(pool))).sort((a, b) => Number(b.liquidity.capacity) - Number(a.liquidity.capacity)) : [];
  const [tab, setTab] = useState<DeskTab | null>(initialTab ?? null);
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);
  const showing: DeskTab = tab ?? (yours.length ? 'mine' : 'all');
  const positionsAll = usePoolPositions(pool ? [pool] : []);
  const withdrawals = useQuery({ queryKey: ['v2-withdrawals'], queryFn: async () => (await api<{ withdrawals: Withdrawal[] }>('/api/v2/withdrawals')).withdrawals, refetchInterval: 30_000 });

  // Your totals across every pool you fund.
  let committed = 0, earned = 0;
  for (const p of all) {
    const st = stakes.get(poolRef(p));
    const value = Number(st?.value ?? 0);
    if (value <= 0) continue;
    committed += value;
    earned += st?.account ? Number(st.account.earned) - Number(st.account.paid) : Number(st!.shares) * (sharePrice(p) - 1);
  }
  const open = (r: string) => { setRef(r); setMinePage(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  if (pools.isLoading) return <main className="bx-main bx-desk"><section className="bx-full"><Loading /></section></main>;

  return (
    <main className="bx-main bx-desk ux">
      <div className="ux-sum">
        <div className="ux-sum-t"><b>Underwriting</b><span className="muted">{yours.length} pool{yours.length === 1 ? '' : 's'}</span></div>
        <div className="ux-k"><span>{hint('Capital committed')}</span><b className="num">${fmt(committed)}</b></div>
        <div className="ux-k"><span>{hint('Premium earned')}</span><b className={`num ${earned > 0 ? 'up' : ''}`}>{earned > 0 ? '+' : ''}${fmt(earned)}</b></div>
        <div className="ux-k"><span>{hint('Return')}</span><b className="num">{committed > 0 ? pct(earned / committed) : '-'}</b></div>
        <button className={`ux-mybtn${minePage ? ' on' : ''}`} onClick={() => { setMinePage(true); setMineTab('active'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          My pools <span className="num">{myActive.length + myEnded.length}</span>
        </button>
        <button className="bx-btn small ux-create" onClick={() => go('u-create')}>Create pool</button>
      </div>

      {minePage ? (
        <section className="bx-full">
          <div className="bx-card ux-flash">
            <button className="ux-backbtn" onClick={() => setMinePage(false)}><ChevronLeft aria-hidden="true" /> Back</button>
            <h2 className="ux-page-h">My pools</h2>
            <div className="ux-tabs">
              <button className={mineTab === 'active' ? 'on' : ''} onClick={() => setMineTab('active')}>Active <span className="muted">{myActive.length}</span></button>
              <button className={mineTab === 'ended' ? 'on' : ''} onClick={() => setMineTab('ended')}>Ended <span className="muted">{myEnded.length}</span></button>
            </div>
            {mineTab === 'active' && (myActive.length ? <PoolRows pools={myActive} stakes={stakes} onPick={open} /> : <div className="bx-empty">You have no money in a pool right now. Pick one from the pool menu and add liquidity, or create a pool.</div>)}
            {mineTab === 'ended' && (myEnded.length ? <PoolRows pools={myEnded} stakes={stakes} onPick={open} /> : <div className="bx-empty">No ended pools. Pools you fully withdraw from appear here.</div>)}
            <div className="ux-past muted">{PAST_NOTE}</div>
          </div>
        </section>
      ) : !pool ? (
        <section className="bx-full"><div className="bx-card"><div className="bx-empty">No pools yet. <button className="bx-link" onClick={() => go('u-create')}>Create the first one</button>.</div></div></section>
      ) : (
        <PoolDetail key={poolRef(pool)} pool={pool} market={all} mine={yours} stakes={stakes} isCreator={isCreator(pool)} onPick={open}
          withdrawals={(withdrawals.data ?? []).filter((w) => w.poolId === pool.poolId && w.chain === pool.chain && (!w.contract || w.contract === pool.ref.contract))} withdrawalsLoading={withdrawals.isLoading} />
      )}
    </main>
  );
}

/** The pool's money in one row: what is reserved, what can still be sold, and cover running. */
function PoolStrip({ pool }: { pool: CurrencyPool; running?: number }) {
  const st = usePoolStats([pool]).get(poolRef(pool));
  const price = use30DayPrices([pool]).get(poolRef(pool));
  const nav = Number(pool.liquidity.nav);
  const all = st ? returnOf(st.premiums - st.paid, nav) : null;
  const last30 = st ? returnOf(st.premiums30 - st.paid30, nav) : null;
  const tone = (r: number | null) => (r == null ? '' : r > 0 ? 'up' : r < 0 ? 'down' : '');
  const show = (r: number | null) => (st ? (r == null ? '-' : `${r >= 0 ? '+' : ''}${pct(r)}`) : '...');
  return (
    <>
      <div className="ux-strip">
        <div><span>Available to sell</span><b className="num">${fmt(pool.liquidity.capacity, 0)}</b></div>
        <div><span>{hint('Reserved')}</span><b className="num">${fmt(pool.liquidity.reserved, 0)}</b></div>
        <div><span>30-day price</span><b className="num">{price != null ? pct(price) : '-'}</b></div>
        <div><span>Premiums earned</span><b className="num">{st ? `$${fmt(st.premiums, 0)}` : '...'}</b><small className="muted">{st ? `paid out $${fmt(st.paid, 0)}` : ''}</small></div>
        <div><span>Return so far</span><b className={`num ${tone(all)}`}>{show(all)}</b></div>
        <div><span>Last 30 days</span><b className={`num ${tone(last30)}`}>{show(last30)}</b></div>
      </div>
      <div className="ux-past muted">{PAST_NOTE}</div>
    </>
  );
}

/** Every cover this pool backs, like the positions table on Trade and Buy cover. */
/**
 * The pool's price for each duration and what $10,000 of cover costs.
 */
function PoolPrices({ pool }: { pool: CurrencyPool }) {
  const direction: Direction = pool.direction === 'down' ? 'down' : 'up';
  const listed = pool.tenors.filter((t) => t.active).map((t) => t.tenorDays);
  const days = pool.durations?.mode === 'specific' || !pool.durations ? listed : Array.from(new Set([7, 14, 30, 60, 90, ...listed])).filter((d) => d <= 90).sort((a, b) => a - b);
  const fair = useFair(pool.pair, direction, days);
  if (!days.length) return <div className="bx-empty">This pool sells no durations right now.</div>;
  return (
    <div className="ux-table">
      <table>
        <thead><tr><th>Duration</th><th>Price</th></tr></thead>
        <tbody>{days.map((d) => {
          const f = fair.data?.rows.find((r) => r.tenorDays === d)?.fairRateE6 ?? null;
          const m = saleMarkup(pool, d, direction);
          const price = f && m ? (f / 1e6) * (m / 10_000) : null;
          return (
            <tr key={d}>
              <td><b>{d} days</b></td>
              <td className="num">{price != null ? pct(price) : fair.isLoading ? '...' : '-'}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}


/**
 * Everything about one pool, opened from the Open pools list: its prices and terms, every cover
 * it has sold, and the underwriters behind it. Add liquidity / Withdraw stays on the right.
 */
function PoolDetail({ pool, market, mine: minePools, stakes, onPick, isCreator, withdrawals, withdrawalsLoading }: {
  pool: CurrencyPool; market: CurrencyPool[]; mine: CurrencyPool[]; stakes: Map<string, Stake | undefined>; onPick: (ref: string) => void; isCreator: boolean;
  withdrawals: Withdrawal[]; withdrawalsLoading: boolean;
}) {
  const [tab, setTab] = useState<'prices' | 'bought' | 'lps' | 'withdrawals' | 'settings'>('prices');
  const [allCover, setAllCover] = useState(false);
  const explorer = `https://stellar.expert/explorer/${String(pool.chain).includes('testnet') ? 'testnet' : 'public'}`;
  const onChain = (a: string) => `${explorer}/${a.startsWith('C') ? 'contract' : 'account'}/${a}`;
  const { session } = usePasskeySession();
  const mine = new Set((session?.accounts ?? []).map((a) => a.address));
  const history = useQuery({ queryKey: ['v2-pool-history', poolRef(pool)], queryFn: async () => (await api<{ positions: ProtectionPosition[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/positions?all=1`)).positions, staleTime: 60_000 });
  const lps = useQuery({ queryKey: ['v2-pool-lps', poolRef(pool)], queryFn: async () => (await api<{ lps: { address: string; free: string; reserved: string; earned: string; paid: string }[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/lps`)).lps, staleTime: 60_000 });
  const bought = [...(history.data ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const lpRows = (lps.data ?? []).map((l) => ({ ...l, capital: Number(l.free) + Number(l.reserved) })).filter((l) => l.capital > 0 || Number(l.earned) > 0).sort((a, b) => b.capital - a.capital);
  const lpTotal = lpRows.reduce((a, l) => a + l.capital, 0);
  const short = (a: string) => (mine.has(a) ? 'You' : `${a.slice(0, 4)}...${a.slice(-4)}`);
  const day = (u: number) => new Date(u * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const state = (p: ProtectionPosition) => (p.status === 'active' ? (p.expiry > Date.now() / 1000 ? 'Running' : 'Settling') : Number(p.payout) > 0 ? 'Paid out' : 'Ended');
  if (allCover) {
    return (
      <section className="bx-full">
        <div className="bx-card ux-flash">
          <button className="ux-backbtn" onClick={() => setAllCover(false)}><ChevronLeft aria-hidden="true" /> Back to pool</button>
          <div className="ux-pool-title"><Flag pair={pool.pair} large /><div><b>Cover bought · {poolName(pool)} · ${fmt(pool.liquidity.nav, 0)} pool</b><div className="muted">{bought.length} covers. Each buyer's address opens on the Stellar explorer.</div></div></div>
          <div className="ux-table">
            <table>
              <thead><tr><th>Bought</th><th>Buyer</th><th>Amount</th><th>Premium</th><th>Starts at</th><th>Pays up to</th><th>Duration</th><th>Ends</th><th>Status</th><th>Paid</th></tr></thead>
              <tbody>{bought.map((p) => (
                <tr key={p.positionId}>
                  <td className="num">{day(p.createdAt)}</td>
                  <td className="num"><a className="ux-addr" href={onChain(p.hedger)} target="_blank" rel="noreferrer" title={p.hedger}>{mine.has(p.hedger) ? 'You' : `${p.hedger.slice(0, 4)}...${p.hedger.slice(-4)}`} ↗</a></td>
                  <td className="num">${fmt(p.notional, 0)}</td>
                  <td className="num up">${fmt(p.premium)}</td>
                  <td className="num">{Number(p.strike).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="num">${fmt(p.maxPayout, 0)}</td>
                  <td>{p.tenorDays} day{p.tenorDays === 1 ? '' : 's'}</td>
                  <td className="num">{day(p.expiry)}</td>
                  <td>{state(p)}</td>
                  <td className="num">{Number(p.payout) > 0 ? `$${fmt(p.payout)}` : '-'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }
  return (
    <>
      <section className="bx-col">
        <div className="bx-card ux-flash">
          <PoolSwitcher pool={pool} all={market} mine={minePools} stakes={stakes} isCreator={isCreator} onPick={onPick} />
          <PoolStrip pool={pool} />
        </div>
        <div className="bx-card ux-chart"><PairRateChart pair={pool.pair} /></div>
        <div className="bx-card">
          <div className="ux-tabs">
            <button className={tab === 'prices' ? 'on' : ''} onClick={() => setTab('prices')}>Prices</button>
            <button className={tab === 'bought' ? 'on' : ''} onClick={() => setTab('bought')}>Cover bought <span className="muted">{bought.length}</span></button>
            <button className={tab === 'lps' ? 'on' : ''} onClick={() => setTab('lps')}>Liquidity providers <span className="muted">{lpRows.length}</span></button>
            <button className={tab === 'withdrawals' ? 'on' : ''} onClick={() => setTab('withdrawals')}>My withdrawals</button>
            {isCreator && <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Settings</button>}
          </div>
          {tab === 'withdrawals' && <WithdrawalList withdrawals={withdrawals} loading={withdrawalsLoading} all={[pool]} />}
          {tab === 'settings' && isCreator && (
            <div className="ux-pricing">
              <TenorPricing pool={pool} editable />
              <ProtectionSettings pool={pool} editable />
            </div>
          )}
          {tab === 'prices' && (
            <>
              <PoolPrices pool={pool} />
              <div className="ux-terms">
                <span>Each cover pays the full move, up to {MAX_PAYOUT_PCT}% of its amount</span>
                <span>Durations: {pool.durations && pool.durations.mode !== 'specific' ? 'any day, 1 to 90' : 'only the listed ones'}</span>
                <span>Closest strike: {(pool.structures.minStrikeDistanceBps ?? 0) === 0 ? "today's rate" : `${(pool.structures.minStrikeDistanceBps ?? 0) / 100}% from today's rate`}</span>
              </div>
            </>
          )}
          {tab === 'bought' && (history.isLoading ? <Loading /> : !bought.length ? <div className="bx-empty">No cover sold yet.</div> : (
            <div className="ux-table">
              <table>
                <thead><tr><th>Bought</th><th>Amount</th><th>Premium</th><th>Duration</th><th>Ends</th><th>Status</th></tr></thead>
                <tbody>{bought.slice(0, 5).map((p) => (
                  <tr key={p.positionId}>
                    <td className="num">{day(p.createdAt)}</td>
                    <td className="num">${fmt(p.notional, 0)}</td>
                    <td className="num up">${fmt(p.premium)}</td>
                    <td>{p.tenorDays} day{p.tenorDays === 1 ? '' : 's'}</td>
                    <td className="num">{day(p.expiry)}</td>
                    <td>{state(p)}</td>
                  </tr>
                ))}</tbody>
              </table>
              {bought.length > 5 && <button className="ux-viewall" onClick={() => { setAllCover(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>View all {bought.length} →</button>}
            </div>
          ))}
          {tab === 'lps' && (lps.isLoading ? <Loading /> : !lpRows.length ? <div className="bx-empty">No underwriter details for this pool.</div> : (
            <div className="ux-table">
              <table>
                <thead><tr><th>Underwriter</th><th>Capital</th><th>Share</th><th>Reserved</th><th>Premiums earned</th></tr></thead>
                <tbody>{lpRows.map((l) => (
                  <tr key={l.address}>
                    <td className="num"><b>{short(l.address)}</b>{l.address === pool.creator ? <span className="muted"> · creator</span> : null}</td>
                    <td className="num">${fmt(l.capital, 0)}</td>
                    <td className="num">{lpTotal > 0 ? pct(l.capital / lpTotal, 1) : '-'}</td>
                    <td className="num">${fmt(l.reserved, 0)}</td>
                    <td className="num up">${fmt(l.earned)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}
        </div>
      </section>
      <aside className="bx-aside" aria-label="Liquidity">
        <LiquidityPanel key={poolRef(pool)} pool={pool} />
        <TakeOverCard pool={pool} />
      </aside>
    </>
  );
}

/** The pool's name as a dropdown of every open pool in the same market (pair and side). */
function PoolSwitcher({ pool, all, mine: minePools, stakes, isCreator, onPick }: { pool: CurrencyPool; all: CurrencyPool[]; mine: CurrencyPool[]; stakes: Map<string, Stake | undefined>; isCreator: boolean; onPick: (ref: string) => void }) {
  const [openMenu, setOpenMenu] = useState(false);
  const live = all.filter((p) => (p.acceptingHedges && !p.legacy) || poolRef(p) === poolRef(pool));
  const prices = use30DayPrices(live);
  const myCapital = Number(stakes.get(poolRef(pool))?.value ?? 0);
  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.ux-switch')) setOpenMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenu]);
  const markets = Array.from(new Set(live.map((p) => `${p.pair} ${p.direction === 'down' ? 'Down' : p.direction === 'both' ? 'Both' : 'Up'}`)));
  const marketOf = (p: CurrencyPool) => `${p.pair} ${p.direction === 'down' ? 'Down' : p.direction === 'both' ? 'Both' : 'Up'}`;
  const row = (p: CurrencyPool) => (
    <button key={poolRef(p)} role="option" aria-selected={poolRef(p) === poolRef(pool)} className={`ux-switch-row${poolRef(p) === poolRef(pool) ? ' on' : ''}`} onClick={() => { onPick(poolRef(p)); setOpenMenu(false); }}>
      <span><Flag pair={p.pair} /> <b>{marketOf(p)} · ${fmt(p.liquidity.nav, 0)}</b></span>
      <span className="num">${fmt(p.liquidity.capacity, 0)}</span>
      <span className="num">{prices.get(poolRef(p)) != null ? pct(prices.get(poolRef(p))!) : '-'}</span>
    </button>
  );
  return (
    <div className="ux-switch">
      <button className="ux-switch-btn" aria-expanded={openMenu} onClick={() => setOpenMenu(!openMenu)}>
        <Flag pair={pool.pair} large />
        <span className="ux-switch-t"><b>{poolName(pool)} · ${fmt(pool.liquidity.nav, 0)} pool</b><span className="muted">{pool.acceptingHedges ? 'Selling cover' : 'Paused'}{isCreator ? ' · your pool' : ''}{myCapital > 0 ? ` · your capital $${fmt(myCapital)}` : ''} · switch pool</span></span>
        <ChevronDown size={18} />
      </button>
      {openMenu && (
        <div className="ux-switch-menu" role="listbox">
          <div className="ux-switch-h"><span>Pool</span><span>Available</span><span>30-day price</span></div>
          {minePools.length > 0 && <><div className="ux-switch-g">My pools</div>{minePools.map(row)}</>}
          {markets.map((m) => (
            <div key={m}>
              <div className="ux-switch-g">{m} cover</div>
              {live.filter((p) => marketOf(p) === m).sort((a, b) => Number(b.liquidity.capacity) - Number(a.liquidity.capacity)).map(row)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WithdrawalList({ withdrawals, loading, all }: { withdrawals?: Withdrawal[]; loading: boolean; all: CurrencyPool[] }) {
  const poolOf = (w: Withdrawal) => all.find((p) => p.poolId === w.poolId && p.chain === w.chain && (!w.contract || p.ref.contract === w.contract));
  const cols = { gridTemplateColumns: 'minmax(0, 2fr) repeat(2, minmax(0, 1fr))' };
  if (loading) return <Loading />;
  if (!(withdrawals ?? []).length) return <div className="bx-empty">No withdrawals yet. Withdraw from a pool with the panel on the right.</div>;
  return (
    <>
      <div className="bx-list-h" style={cols}><span>{hint('Pool')}</span><span className="r">Amount</span><span className="r">{hint('Status')}</span></div>
      {(withdrawals ?? []).map((w) => {
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
  );
}

function TenorPricing({ pool, editable }: { pool: CurrencyPool; editable: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const all = usePools();
  const direction: Direction = pool.direction === 'down' ? 'down' : 'up';
  const MARKUP_MAX = pool.markupCeilingBps ?? ceilingFor(all.data, pool.pair);
  // Where this pool is filled among every pool selling the same cover: cheapest first.
  const rivals = (all.data ?? []).filter((p) => poolRef(p) !== poolRef(pool) && !p.legacy && p.pair === pool.pair && p.acceptingHedges
    && Number(p.liquidity.capacity) > 0 && (p.direction === direction || p.direction === 'both'));
  const rankOf = (d: number, markup: number) => {
    const theirs = rivals.map((p) => saleMarkup(p, d, direction)).filter((m): m is number => m !== null);
    const cheaper = theirs.filter((m) => m < markup).length;
    return { rank: cheaper + 1, of: theirs.length + 1, best: theirs.length ? Math.min(...theirs) : null };
  };
  // An underwriter's own view of how much the currency moves, turned into offers.
  const [vol, setVol] = useState('');
  const [view, setView] = useState<{ rows: { tenorDays: number; fairRateE6: number | null; marketVol?: number | null; markupBps?: number | null; capped?: boolean }[] } | null>(null);
  const [viewBusy, setViewBusy] = useState(false);
  const [extra, setExtra] = useState<number[]>([]);
  const days = Array.from(new Set([...pool.tenors.map((t) => t.tenorDays), ...extra])).sort((a, b) => a - b);
  const fair = useFair(pool.pair, direction, days, pool.structures.minStrikeDistanceBps ?? 0);
  const fairOf = (d: number) => fair.data?.rows.find((r) => r.tenorDays === d)?.fairRateE6 ?? null;
  const [offers, setOffers] = useState<Record<number, string>>({});
  const [newDays, setNewDays] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const sold = new Map<number, number>();
  for (const p of usePoolPositions([pool]).get(poolRef(pool)) ?? []) sold.set(p.tenorDays, (sold.get(p.tenorDays) ?? 0) + Number(p.maxPayout));
  useEffect(() => { setOffers({}); setExtra([]); setView(null); }, [pool.ref.id]);
  const cols = { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 150px' };
  const marketVol = view?.rows.find((r) => r.marketVol)?.marketVol ?? null;
  async function priceFromView() {
    setViewBusy(true);
    try {
      const v = await api<NonNullable<typeof view>>(`/api/v2/fair?pair=${encodeURIComponent(pool.pair)}&direction=${direction}&tenors=${days.join(',')}&distance=${pool.structures.minStrikeDistanceBps ?? 0}&vol=${Number(vol)}`);
      setView(v);
      const next: Record<number, string> = {};
      for (const r of v.rows) if (r.fairRateE6 && r.markupBps) next[r.tenorDays] = ((r.fairRateE6 / 1e6) * (r.markupBps / 10000) * 100).toFixed(2);
      setOffers(next);
    } catch (e) {
      toast({ title: 'Could not price your view', description: (e as Error).message, variant: 'destructive' });
    } finally { setViewBusy(false); }
  }
  const range = durationsOffered(pool).range;

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
        <div><h2>Pricing</h2><div className="sub">BlockFinaX calculates the fair price. {editable ? 'You set your offer.' : "The pool's creator sets the offer."} All tenors share this pool's liquidity.{range ? ` This pool sells any day from ${range.minDays} to ${range.maxDays}; the durations below are price points, and prices between them are blended.` : ''}</div></div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 640 }}>
          <div className="bx-list-h bx-ptab" style={cols}><span>{hint("Duration")}</span><span className="r">{hint("Fair price")}</span><span className="r">{hint("Offer")}</span><span className="r">{hint("Difference")}</span><span className="r">Filled</span><span className="r">{hint("Active cover")}</span><span className="r">On</span></div>
          {days.map((d) => {
            const t = pool.tenors.find((x) => x.tenorDays === d);
            const f = fairOf(d);
            const markup = t?.markupBps ?? 11500;
            const offer = offers[d] ?? (f ? ((f / 1e6) * (markup / 10000) * 100).toFixed(2) : '');
            const newMarkup = f && Number(offer) > 0 ? Math.round(((Number(offer) / 100) / (f / 1e6)) * 10000) : markup;
            const diff = f && Number(offer) > 0 ? Math.round((Number(offer) / 100 - f / 1e6) * 10000) : null;
            const valid = newMarkup >= MARKUP_MIN && newMarkup <= MARKUP_MAX;
            // Only an offer the creator typed counts as a change: the shown offer is rounded, so
            // working back from it would differ slightly from the stored markup on every row.
            const edited = offers[d] !== undefined;
            const changed = !t || (edited && newMarkup !== t.markupBps);
            return (
              <div key={d} className="bx-li bx-ptab" style={cols}>
                <span style={{ fontWeight: 600 }}>{d} {d === 1 ? 'day' : 'days'}</span>
                <span className="r num" style={{ color: 'var(--text-2)' }}>{f ? pct(f / 1e6) : fair.isLoading ? '...' : '-'}</span>
                <span className="r">{editable ? <label className="bx-mini-input"><input aria-label={`Offer for ${d} days`} value={offer} onChange={(e) => setOffers((o) => ({ ...o, [d]: e.target.value.replace(/[^0-9.]/g, '') }))} /><span className="muted">%</span></label> : <span className="num" style={{ fontWeight: 600 }}>{offer}%</span>}</span>
                <span className={`r num ${diff !== null && diff >= 0 ? 'up' : 'down'}`} style={{ fontWeight: 600 }}>{diff === null ? '-' : `${diff >= 0 ? '+' : ''}${diff} bps`}</span>
                {(() => {
                  const r = rankOf(d, Math.min(newMarkup, MARKUP_MAX));
                  const beat = r.rank > 1 && r.best !== null && f ? `Offer ${((f / 1e6) * (r.best / 10000) * 100).toFixed(2)}% or less to be filled first` : undefined;
                  return <span className="r num" title={beat} style={{ color: r.rank === 1 ? 'var(--green)' : undefined }}>{r.of === 1 ? 'Only pool' : `${ordinal(r.rank)} of ${r.of}`}</span>;
                })()}
                <span className="r num">${fmt(sold.get(d) ?? 0, 0)}</span>
                <span className="r" style={{ display: 'inline-flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {busy === d ? <Spin /> : <>
                    {editable && changed && <button className="bx-btn small" disabled={!valid} onClick={() => save(d, t ? t.active : true, newMarkup)}>{t ? 'Save' : 'Add'}</button>}
                    {t && <Toggle label={`${d}-day tenor`} on={t.active} disabled={!editable} onChange={(v) => save(d, v, t.markupBps)} />}
                  </>}
                </span>
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
    </div>
  );
}

/**
 * Two-way pools: a limit and a price for each side, and the balance between them. One-way
 * pools see only their side's limit.
 */
function SideTerms({ pool, editable }: { pool: CurrencyPool; editable: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const st = pool.sideTerms;
  const [upMax, setUpMax] = useState(st?.upMaxReserve ?? '0');
  const [downMax, setDownMax] = useState(st?.downMaxReserve ?? '0');
  const [upPct, setUpPct] = useState(String((st?.upMarkupBps ?? 10000) / 100));
  const [downPct, setDownPct] = useState(String((st?.downMarkupBps ?? 10000) / 100));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setUpMax(st?.upMaxReserve ?? '0'); setDownMax(st?.downMaxReserve ?? '0');
    setUpPct(String((st?.upMarkupBps ?? 10000) / 100)); setDownPct(String((st?.downMarkupBps ?? 10000) / 100));
  }, [pool.ref.id, st?.upMaxReserve, st?.downMaxReserve, st?.upMarkupBps, st?.downMarkupBps]);
  const positions = usePoolPositions([pool]).get(poolRef(pool)) ?? [];
  if (!st) return null;
  const two = pool.direction === 'both';
  const sides = (two ? ['up', 'down'] : [pool.direction]) as Direction[];
  const held = { up: Number(pool.sideReserved?.up ?? 0), down: Number(pool.sideReserved?.down ?? 0) };
  // What running cover would pay if the rate moved this far from where each was bought.
  const payIf = (side: Direction, move: number) => positions.filter((p) => p.direction === side && p.status === 'active').reduce((sum, p) => {
    const spot = Number(p.spot), k = Number(p.strike), c = Number(p.cap), n = Number(p.notional);
    const rate = side === 'up' ? spot * (1 + move) : spot * (1 - move);
    const gain = side === 'up' ? Math.min(rate, c) - k : k - Math.max(rate, c);
    return sum + (gain > 0 ? (n * gain) / spot : 0);
  }, 0);
  const bps = (v: string) => Math.round(Number(v) * 100);
  const valid = [upMax, downMax].every((v) => Number(v) >= 0) && [upPct, downPct].every((v) => bps(v) >= 9000 && bps(v) <= 30000);
  const dirty = upMax !== st.upMaxReserve || downMax !== st.downMaxReserve || bps(upPct) !== st.upMarkupBps || bps(downPct) !== st.downMarkupBps;
  async function save() {
    setBusy(true);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/sides/prepare`, {
        upMaxReserve: upMax || '0', downMaxReserve: downMax || '0', upMarkupBps: bps(upPct), downMarkupBps: bps(downPct),
      });
      await signAndSend(transactions, () => {});
      toast({ title: 'Side terms saved' });
      void qc.invalidateQueries({ queryKey: ['v2-pools'] });
    } catch (e) {
      toast({ title: 'Not saved', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }
  const cols = { gridTemplateColumns: two ? 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1.4fr) minmax(0, 1fr)' };
  return (
    <div className="bx-card">
      <div className="bx-card-h">
        <div><h2>{two ? 'Each side' : 'Sales limit'}</h2><div className="sub">{two
          ? 'This pool sells both Up and Down cover. When the rate moves sharply one way, premiums from cover sold the other way help pay. Limit and price each side here.'
          : 'The most this pool will have set aside for running cover at once. 0 means no limit beyond the money in the pool.'}</div></div>
        {editable && dirty && <button className="bx-btn small" disabled={busy || !valid} onClick={save}>{busy ? <Spin /> : 'Save'}</button>}
      </div>
      <div className="bx-list-h bx-kv" style={cols}><span /> {sides.map((d) => <span key={d} className="r">{exposureLabel(pool.pair, d).kind}</span>)}</div>
      <div className="bx-li bx-kv" style={cols}><span>Set aside now</span>{sides.map((d) => <span key={d} className="r num">${fmt(held[d], 0)}</span>)}</div>
      <div className="bx-li bx-kv" style={cols}><span>Most to set aside (0 = no limit)</span>{sides.map((d) => (
        <span key={d} className="r">{editable ? <label className="bx-mini-input"><span className="muted">$</span><input aria-label={`Limit for ${exposureLabel(pool.pair, d).kind}`} value={d === 'up' ? upMax : downMax} onChange={(e) => (d === 'up' ? setUpMax : setDownMax)(e.target.value.replace(/[^0-9.]/g, ''))} /></label> : <span className="num">{Number(d === 'up' ? upMax : downMax) > 0 ? `$${fmt(d === 'up' ? upMax : downMax, 0)}` : 'No limit'}</span>}</span>
      ))}</div>
      {two && <div className="bx-li bx-kv" style={cols}><span>Price, % of your tenor offer</span>{sides.map((d) => (
        <span key={d} className="r">{editable ? <label className="bx-mini-input"><input aria-label={`Price for ${exposureLabel(pool.pair, d).kind}`} value={d === 'up' ? upPct : downPct} onChange={(e) => (d === 'up' ? setUpPct : setDownPct)(e.target.value.replace(/[^0-9.]/g, ''))} /><span className="muted">%</span></label> : <span className="num">{d === 'up' ? upPct : downPct}%</span>}</span>
      ))}</div>}
      {[0.1, 0.3].map((m) => (
        <div key={m} className="bx-li bx-kv" style={cols}><span>Pays out if the rate moves {m * 100}%</span>{sides.map((d) => <span key={d} className="r num">${fmt(payIf(d, m), 0)}</span>)}</div>
      ))}
      <div className="sub" style={{ marginTop: 8 }}>Moves are measured from the rate each cover was bought at.{two ? ' A side priced at 120% charges 1.2 times your tenor offer for that side, up to the pair ceiling.' : ''}</div>
    </div>
  );
}

/**
 * One kind of cover on every pool: the full move, up to MAX_PAYOUT_PCT of the amount. The only setting
 * left is how close to today's rate cover may start. Saving also moves an older pool that
 * still sells Limited cover, or another maximum, onto the standard terms.
 */
function ProtectionSettings({ pool, editable }: { pool: CurrencyPool; editable: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [minStrike, setMinStrike] = useState(String((pool.structures.minStrikeDistanceBps ?? 0) / 100));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMinStrike(String((pool.structures.minStrikeDistanceBps ?? 0) / 100)); }, [pool.ref.id]);
  const standard = pool.structures.open && !pool.structures.capped && pool.structures.openMaxPayoutBps === MAX_PAYOUT_PCT * 100;
  const dirty = !standard || Math.round(Number(minStrike) * 100) !== (pool.structures.minStrikeDistanceBps ?? 0);
  async function save() {
    setBusy(true);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/structures/prepare`, {
        open: true, capped: false, minCapDistanceBps: pool.structures.minCapDistanceBps, maxCapDistanceBps: pool.structures.maxCapDistanceBps,
        openMaxPayoutBps: MAX_PAYOUT_PCT * 100, minStrikeDistanceBps: Math.round(Number(minStrike) * 100),
      });
      await signAndSend(transactions, () => {});
      toast({ title: 'Settings saved' });
      void qc.invalidateQueries({ queryKey: ['v2-pools'] });
    } catch (e) {
      toast({ title: 'Not saved', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }
  return (
    <div className="bx-card">
      <div className="bx-card-h"><h2>Cover</h2>{editable && dirty && <button className="bx-btn small" disabled={busy} onClick={save}>{busy ? <Spin /> : 'Save settings'}</button>}</div>
      <div className="cp-rule">Cover from this pool pays the full move, up to {MAX_PAYOUT_PCT}% of the amount.</div>
      {!standard && <Note>This pool still has older cover terms. Saving moves it to the standard terms above. Cover already sold keeps its own terms.</Note>}
      <div className="cp-line" style={{ marginTop: 8 }}>
        <span />
        <span className="cp-k">{hint('Closest strike allowed')} <span className="muted">from today's rate</span></span>
        <span className="cp-vals"><label className="cp-pct"><input aria-label="Closest strike allowed" className="num" disabled={!editable} value={minStrike} onChange={(e) => setMinStrike(e.target.value.replace(/[^0-9.]/g, ''))} /><span>%</span></label></span>
      </div>
    </div>
  );
}

function FundingSelect({ value, onChange }: { value: string | null; onChange: (k: string) => void }) {
  const chains = useChains();
  const balances = useUsdcBalances();
  const hub = chains.data?.activeLiquidityHub;
  const funding = (chains.data?.chains ?? []).filter((c) => c.key === hub);
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

/** Whether this underwriter's free money backs new sales, and the durations it backs. */
function BackingPreferences({ pool, account }: { pool: CurrencyPool; account: LpAccount }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { range, days } = durationsOffered(pool);
  // Pools selling any day get round-number choices inside their range; others their listed durations.
  const choices = range ? [1, 3, 7, 14, 21, 30, 45, 60, 90].filter((d) => d >= range.minDays && d <= range.maxDays) : days;
  const min = account.minTenorDays ?? 0;
  const max = account.maxTenorDays;
  async function save(backing: boolean, maxTenorDays: number, minTenorDays = min) {
    if (maxTenorDays > 0 && minTenorDays > maxTenorDays) {
      toast({ title: 'Not saved', description: 'The shortest duration must not be longer than the longest.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/preferences/prepare`, { backing, maxTenorDays, minTenorDays });
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
        <Toggle on={account.backing} disabled={busy} label="Back new protection" onChange={(v) => save(v, max)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <label className="bx-field" style={{ margin: 0 }}>
          <span>{hint("Shortest protection I back")}</span>
          <select className="bx-select" disabled={busy || !account.backing} value={min} onChange={(e) => save(true, max, Number(e.target.value))}>
            <option value={0}>No minimum</option>
            {choices.map((d) => <option key={d} value={d}>From {d} days</option>)}
          </select>
        </label>
        <label className="bx-field" style={{ margin: 0 }}>
          <span>{hint("Longest protection I back")}</span>
          <select className="bx-select" disabled={busy || !account.backing} value={max} onChange={(e) => save(true, Number(e.target.value))}>
            <option value={0}>No maximum</option>
            {choices.map((d) => <option key={d} value={d}>Up to {d} days</option>)}
          </select>
        </label>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Change these any time. Money already backing protection stays until that protection ends.</div>
    </div>
  );
}

/**
 * Shown only when this underwriter may take over the pool: its creator has no money left
 * in it and this underwriter has the most. The pool's settings then become theirs.
 */
function TakeOverCard({ pool }: { pool: CurrencyPool }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const status = useQuery({
    queryKey: ['v2-takeover', poolRef(pool)],
    queryFn: () => api<{ supported: boolean; eligible: boolean; reason: string | null }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/takeover`),
    staleTime: 60_000,
  });
  if (!status.data?.eligible) return null;
  async function takeOver() {
    setBusy(true);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(pool))}/takeover/prepare`, {});
      await signAndSend(transactions, () => {});
      toast({ title: 'You now manage this pool', description: 'You can set its durations, prices and protection settings.' });
      for (const k of ['v2-pools', 'v2-takeover']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast({ title: 'Not taken over', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }
  return (
    <div className="bx-card tight" style={{ marginTop: 16 }}>
      <h2>Manage this pool</h2>
      <div className="sub">The pool's creator has left it, and you have the most money in it. You can take over its durations, prices and protection settings. Anything the creator earned before is paid to them, not to you.</div>
      <button className="bx-btn block" style={{ marginTop: 14 }} disabled={busy} onClick={takeOver}>{busy ? <Spin /> : null} Take over this pool</button>
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
        <input id="bx-liq" inputMode="decimal" value={`$${withCommas(amount)}`} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        <div className="bx-pills" style={{ marginTop: 8 }}>
          {[0.25, 0.5, 0.75, 1].map((f) => <button key={f} className="bx-pill" onClick={() => setAmount((Math.floor(available * f * 100) / 100).toString())}>{f === 1 ? 'Max' : `${f * 100}%`}</button>)}
        </div>
      </div>
      {mode === 'add' ? <FundingSelect value={network} onChange={setNetwork} /> : <Note>{acct ? 'You can withdraw your free money now. Money reserved for protection you back returns to free when that protection ends.' : 'Capital backing active protection is released when that protection ends.'}</Note>}
      {acct && <LpBreakdown account={acct} />}
      <div className="bx-sums">
        {mode === 'withdraw' && <Sum l="Available to withdraw" v={<span className="num">${fmt(available)}</span>} />}
        <Sum l="Your capital after" v={<span className="num">${fmt(after)}</span>} />
        <Sum l="Share of pool" v={<span className="num">{navAfter > 0 ? pct(after / navAfter, 1) : '-'}</span>} />
        <Sum l="Network fees" v="Covered" good />
      </div>
      <button className="bx-btn block" disabled={!!busy || !(Number(amount) > 0) || Number(amount) > available || (mode === 'add' && !pool.allowExternalLp)} onClick={submit}>
        {busy && !busy.startsWith('w') ? <><Spin /> {busy}</> : mode === 'add' ? 'Add liquidity' : 'Request withdrawal'}
      </button>
      {mode === 'add' && !pool.allowExternalLp && <div className="bx-hint">{pool.legacy ? 'This pool is on an earlier contract and takes no new money.' : 'This pool is closed to new underwriters.'}</div>}
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
  const allPools = usePools();
  const exposures = useMemo(() => (setup.data?.pairs ?? []).flatMap((pair) => {
    const ds = (['up', 'down'] as Direction[]).filter(isOffered);
    return ds.map((d) => `${pair}:${d}`);
  }), [setup.data]);
  const [key, setKey] = useState('');
  useEffect(() => { if (!key && exposures[0]) setKey(exposures[0]); }, [exposures, key]);
  const [pair, side] = (key || ':up').split(':') as [string, Direction | 'both'];
  // One side per pool: to back both, create two pools.
  const sides: (Direction | 'both')[] = (['up', 'down'] as Direction[]).filter(isOffered);
  // A two-way pool lists one offer per duration for both sides; it is priced on Up cover.
  const direction: Direction = side === 'down' ? 'down' : 'up';
  const MARKUP_MAX = ceilingFor(allPools.data, pair);
  const [amount, setAmount] = useState('500');
  const [network, setNetwork] = useState<string | null>(null);
  const [tenors, setTenors] = useState<TenorDraft[]>([3, 7, 14, 30].map((d) => ({ tenorDays: d, offerPct: '', active: true })));
  const [newDays, setNewDays] = useState('');
  // Which durations businesses can buy: any day (the default), up to a maximum, or only the listed ones.
  const [durMode, setDurMode] = useState<'any' | 'up-to' | 'specific'>('any');
  const [durMin, setDurMin] = useState('1');
  const [durMax, setDurMax] = useState('60');
  // Every pool sells one kind of cover: the full move, up to MAX_PAYOUT_PCT of the amount.
  const openOn = true, cappedOn = false;
  const [minCap, setMinCap] = useState('3');
  const [maxCap, setMaxCap] = useState('20');
  const openMax = String(MAX_PAYOUT_PCT);
  const [minStrike, setMinStrike] = useState('0');
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [agreed, setAgreed] = useState(false);
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
    !tenors.some((t) => t.active) ? 'Turn on at least one tenor' : tenors.some((t) => markupOf(t) < MARKUP_MIN || markupOf(t) > MARKUP_MAX) ? `Each offer must be 90% of the fair price up to ${times(MARKUP_MAX)} (the ${pair} ceiling)` : null,
    !openOn && !cappedOn ? 'Offer at least one protection type' : Number(maxCap) > 0 && Number(minCap) > Number(maxCap) ? 'The smallest limit must be below the largest' : !(Number(minStrike) >= 0 && Number(minStrike) <= 50) ? 'Closest strike must be 0% to 50%' : null,
    null,
  ];

  async function create() {
    setBusy('Preparing...');
    try {
      if (network && hub && network !== hub) await routeFunding({ network, amount: String(total), hubName });
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/pools/prepare', {
        pair, direction: side, allowExternalLp: true, initialLiquidity: amount,
        structures: { open: openOn, capped: cappedOn, minCapDistanceBps: Math.round(Number(minCap) * 100), maxCapDistanceBps: Math.round(Number(maxCap) * 100), openMaxPayoutBps: Math.round(Number(openMax) * 100), minStrikeDistanceBps: Math.round(Number(minStrike) * 100) },
        tenors: tenors.map((t) => ({ tenorDays: t.tenorDays, active: t.active, markupBps: markupOf(t) })),
      });
      await signAndSend(transactions, (m) => setBusy(m));
      // New pools sell any day up to the protocol maximum; anything else is a second approval.
      if (durMode !== 'any' || Number(durMin) > 1) {
        setBusy('Setting durations...');
        const mine = (await api<{ pools: CurrencyPool[] }>('/api/v2/pools')).pools
          .filter((p) => p.pair === pair && p.direction === side && !p.legacy)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (mine) {
          const rule = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(mine))}/durations/prepare`, {
            mode: durMode, minDays: Math.max(1, Math.round(Number(durMin) || 1)), maxDays: Math.round(Number(durMax) || 0),
          });
          await signAndSend(rule.transactions, (m) => setBusy(m));
        }
      }
      toast({ title: 'Pool created', description: `Your ${coverOf(pair, side)} pool is live.` });
      for (const k of ['v2-pools', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
      go('u-pools');
    } catch (e) {
      toast({ title: 'Pool not created', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (setup.isLoading) return <main className="bx-main bx-desk"><section className="bx-full"><Loading /></section></main>;
  const box = { border: '1px solid var(--line-2)', borderRadius: 12, padding: 16 } as const;
  const tcols = { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr) 56px 36px' };
  const problem = problems.find(Boolean) ?? null;
  const active = tenors.filter((t) => t.active);
  const review = reviewing && (
    <div className="bx-modal-bg" onClick={() => !busy && setReviewing(false)}>
      <div className="bx-modal cp-review" role="dialog" aria-modal="true" aria-label="Review pool terms" onClick={(e) => e.stopPropagation()}>
        <h2>Review your pool</h2>
        <div className="cp-r-head"><Flag pair={pair} /><b>{coverOf(pair, side)}</b></div>
        <div className="cp-r-grid">
          <span>You commit</span><b className="num">${fmt(amount)}</b>
          <span>Creation fee</span><b className="num">${fmt(fee)}</b>
          <span>Total from your wallet</span><b className="num">${fmt(total)}</b>
          <span>Durations</span><b>{durMode === 'any' ? 'Any day, 1 to 90' : 'Only ' + active.map((t) => t.tenorDays + 'd').join(', ')}</b>
          <span>Your prices</span><b>{active.map((t) => t.tenorDays + 'd ' + t.offerPct + '%').join(' · ')}</b>
          <span>Each cover pays</span><b>The full move, up to {MAX_PAYOUT_PCT}% of its amount</b>
          <span>Closest strike</span><b>{Number(minStrike) === 0 ? "From today's rate" : minStrike + "% from today's rate"}</b>
        </div>
        <div className="cp-r-risk">
          <b>What you agree to</b>
          <ul>
            <li>If the dollar {side === 'up' ? 'rises' : 'falls'} against the {ccyName(pair)} past a buyer's starting rate, your pool pays them, up to {MAX_PAYOUT_PCT}% of their cover amount.</li>
            <li>When cover is sold, {MAX_PAYOUT_PCT}% of its amount is locked from your pool until that cover ends. Locked money cannot be withdrawn.</li>
            <li>You can lose some or all of the money you commit. Premiums are your only income.</li>
            <li>The ${fmt(fee)} creation fee is not refunded.</li>
          </ul>
        </div>
        <label className="cp-r-agree"><input id="cp-agree" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I have read these terms and understand I can lose the money I commit.</label>
        <div className="cp-r-btns">
          <button className="bx-btn ghost" disabled={!!busy} onClick={() => setReviewing(false)}>Back</button>
          <button className="bx-btn" disabled={!agreed || !!busy} onClick={async () => { await create(); setReviewing(false); }}>{busy ? <><Spin /> {busy}</> : <>Confirm and create · ${fmt(total)}</>}</button>
        </div>
      </div>
    </div>
  );
  const pctIn = (v: string, set: (x: string) => void, label: string) => (
    <label className="cp-pct"><input aria-label={label} className="num" value={v} onChange={(e) => set(e.target.value.replace(/[^0-9.]/g, ''))} /><span>%</span></label>
  );
  return (
    <main className="bx-main bx-desk">
      <section className="bx-full">
        <div className="bx-card cp">
          <div className="cp-head">
            <button className="bx-link bx-back" onClick={() => go('u-home')}><ChevronLeft aria-hidden="true" /> Underwrite</button>
            <h2 className="cp-title">Create pool</h2>
          </div>
          <div className="cp-wrap"><div className="cp-stack">
            <div className="cp-col">
              <label className="bx-field"><span>{hint("Currency pair")}</span>
                <select className="bx-select" value={pair} onChange={(e) => setKey(`${e.target.value}:${side}`)}>
                  {(setup.data?.pairs ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <div className="bx-seg cp-side">
                {sides.map((d) => <button key={d} className={side === d ? 'on' : ''} onClick={() => setKey(`${pair}:${d}`)}>{d === 'up' ? 'Up cover' : 'Down cover'}</button>)}
              </div>
              <label className="bx-field"><span>{hint("Commit liquidity (USDC)")}</span><input className="bx-input num" inputMode="decimal" value={withCommas(amount)} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
            </div>

            <div className="cp-col cp-set">
              <div className="cp-row">
                <span className="cp-k">{hint('Durations')}</span>
                <div className="bx-seg small cp-seg">
                  <button className={durMode === 'any' ? 'on' : ''} onClick={() => setDurMode('any')}>Any day</button>
                  <button className={durMode === 'specific' ? 'on' : ''} onClick={() => setDurMode('specific')}>Only listed</button>
                </div>
              </div>

              <table className="cp-table">
                <thead><tr><th>{hint('Tenor')}</th><th>{hint('Fair price')}</th><th>{hint('Your offer')}</th><th>On</th><th /></tr></thead>
                <tbody>
                  {tenors.map((t, i) => {
                    const f = fairOf(t.tenorDays);
                    return (
                      <tr key={t.tenorDays}>
                        <td><b>{t.tenorDays}d</b></td>
                        <td className="num">{f ? pct(f / 1e6) : fair.isLoading ? '...' : '-'}</td>
                        <td><label className="cp-pct"><input aria-label={`Offer for ${t.tenorDays} days`} className="num" value={t.offerPct} onChange={(e) => setTenors((ts) => ts.map((x, j) => (j === i ? { ...x, offerPct: e.target.value.replace(/[^0-9.]/g, '') } : x)))} /><span>%</span></label></td>
                        <td><Toggle label={`${t.tenorDays}-day tenor`} on={t.active} onChange={(v) => setTenors((ts) => ts.map((x, j) => (j === i ? { ...x, active: v } : x)))} /></td>
                        <td><button className="bx-link" aria-label={`Remove ${t.tenorDays} days`} onClick={() => setTenors((ts) => ts.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="cp-add">
                <input className="num" aria-label="New tenor in days" placeholder="Days" value={newDays} onChange={(e) => setNewDays(e.target.value.replace(/\D/g, ''))} />
                <button className="bx-btn ghost small" disabled={!(Number(newDays) >= 1 && Number(newDays) <= 365) || tenors.some((t) => t.tenorDays === Number(newDays))} onClick={() => { setTenors((ts) => [...ts, { tenorDays: Number(newDays), offerPct: '', active: true }].sort((a, b) => a.tenorDays - b.tenorDays)); setNewDays(''); }}>Add tenor</button>
              </div>

              <div className="cp-rule">Cover from this pool pays the full move, up to {MAX_PAYOUT_PCT}% of the amount.</div>
              <div className="cp-line">
                <span />
                <span className="cp-k">{hint('Closest strike allowed')} <span className="muted">from today's rate</span></span>
                <span className="cp-vals">{pctIn(minStrike, setMinStrike, 'Closest strike allowed')}</span>
              </div>
            </div>
            <div className="cp-col cp-end">
              <div className="cp-total"><span>${fmt(amount)} liquidity + ${fmt(fee)} creation fee</span><b className="num">${fmt(total)}</b></div>
              {problem && <p className="bx-error">{problem}</p>}
              <button className="bx-btn block" disabled={!!busy || Boolean(problem)} onClick={() => { setAgreed(false); setReviewing(true); }}>{busy ? <><Spin /> {busy}</> : 'Create pool'}</button>
              <div className="cp-foot muted">Paid from your wallet (${fmt(have)} available). Network fees are covered.</div>
            </div>
          </div>
          <div className="cp-chart">{pair && <PairRateChart pair={pair} />}<div className="cp-chart-note muted">{side === 'up' ? `You pay out if the dollar rises against the ${ccyName(pair)} past what buyers chose.` : side === 'down' ? `You pay out if the dollar falls against the ${ccyName(pair)} past what buyers chose.` : ''}</div></div>
          </div>
        </div>
      </section>
      {review}
    </main>
  );
}
