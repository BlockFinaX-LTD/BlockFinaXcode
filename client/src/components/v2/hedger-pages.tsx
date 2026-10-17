/**
 * Hedger pages: Home, Protect (currency page with a docked Protect panel), My
 * protections and Rates. BlockFinaX picks the pool and network; the chain stays out
 * of sight except under Advanced details.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronUp, Percent, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { CurrencyPool, ProtectionPosition, ProtectionQuote, SettlementResult } from '@shared/domain/types';
import { api } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import {
  ccyName, dateIn, dateOf, exposureLabel, fmt, fmtRate, pairName, pct, poolRef, quoteCcy, signAndSend, useChains, useDebounced, usePools,
  useUsdcBalances, usdcOn, type Direction,
} from './shared';
import { Flag, Loading, Spin, Sum, Tag } from './ui';
import type { Go, Target } from './workspace';
import { RateCoverPanel, RateMarkets, RateProtections } from './rate-pages';

type Hedge = { position: ProtectionPosition; pair: string; settlement: SettlementResult };

function useHedges() {
  return useQuery({
    queryKey: ['v2-hedges'],
    queryFn: async () => (await api<{ hedges: Hedge[] }>('/api/v2/hedges')).hedges,
    refetchInterval: 30_000,
  });
}

function useSpot(pair: string | null) {
  return useQuery({
    queryKey: ['v2-spot', pair],
    enabled: Boolean(pair),
    queryFn: async () => Number((await api<{ spot: string }>(`/api/v2/spot?pair=${encodeURIComponent(pair!)}`)).spot),
    refetchInterval: 60_000,
  });
}


/** The rates watchlist (live rate, change since the last daily close), from one request. */
function useWatchlist() {
  return useQuery({
    queryKey: ['v2-rates'],
    queryFn: async () => (await api<{ rates: { pair: string; spot: number | null; change: number | null }[] }>('/api/v2/rates')).rates,
    refetchInterval: 60_000,
  });
}

/** Rate and change for specific pairs (falls back to a spot read for pairs off the watchlist). */
function useRates(pairs: string[]) {
  const list = useWatchlist();
  const missing = pairs.filter((p) => !(list.data ?? []).some((r) => r.pair === p));
  const spots = useQueries({ queries: missing.map((p) => ({ queryKey: ['v2-spot', p], queryFn: async () => Number((await api<{ spot: string }>(`/api/v2/spot?pair=${encodeURIComponent(p)}`)).spot), refetchInterval: 60_000 })) });
  return pairs.map((pair) => {
    const row = list.data?.find((r) => r.pair === pair);
    if (row) return { pair, spot: row.spot ?? undefined, change: row.change };
    const i = missing.indexOf(pair);
    return { pair, spot: spots[i]?.data, change: null as number | null };
  });
}

const daysLeft = (expiry: number) => Math.max(0, Math.ceil((expiry - Date.now() / 1000) / 86_400));

function payoutToday(p: ProtectionPosition, spot: number | undefined) {
  if (!spot) return null;
  const strike = Number(p.strike), cap = Number(p.cap), entry = Number(p.spot);
  const moved = p.direction === 'up' ? Math.min(spot, cap) - strike : strike - Math.max(spot, cap);
  return Math.max(0, Math.min(Number(p.maxPayout), (Number(p.notional) * moved) / entry));
}

function ChangeText({ change }: { change: number | null }) {
  if (change === null) return <span className="muted">-</span>;
  return <span className={`num ${change >= 0 ? 'up' : 'down'}`} style={{ fontWeight: 600 }}>{change >= 0 ? '+' : ''}{(change * 100).toFixed(2)}%</span>;
}

// ── Markets: open pools a hedger can buy from ────────────────────────────────

/**
 * A pool's price per tenor: BlockFinaX's fair price on a reference cover (protection
 * 2% from today, capped 10% beyond) times the pool's markup, plus its hedger fee.
 */
function usePoolOffers(pool: CurrencyPool) {
  const direction = pool.direction === 'down' ? 'down' : 'up';
  const tenors = pool.tenors.filter((t) => t.active).sort((a, b) => a.tenorDays - b.tenorDays);
  // Priced at the closest strike this pool sells: its most protective cover.
  const distance = pool.structures.minStrikeDistanceBps ?? 0;
  const fair = useQuery({
    queryKey: ['v2-fair', pool.pair, direction, tenors.map((t) => t.tenorDays).join(','), distance],
    enabled: tenors.length > 0,
    queryFn: () => api<{ reference: { strike: string }; rows: { tenorDays: number; fairRateE6: number | null }[] }>(`/api/v2/fair?pair=${encodeURIComponent(pool.pair)}&direction=${direction}&tenors=${tenors.map((t) => t.tenorDays).join(',')}&distance=${distance}`),
    staleTime: 60_000,
  });
  const feeRate = pool.fees.hedgerFeeRateE6 / 1e6;
  const rows = tenors.map((t) => {
    const f = fair.data?.rows.find((r) => r.tenorDays === t.tenorDays)?.fairRateE6 ?? null;
    const price = f === null ? null : (f / 1e6) * (t.markupBps / 10000);
    return { tenorDays: t.tenorDays, price, per1000: price === null ? null : 1000 * price * (1 + feeRate) };
  });
  const priced = rows.filter((r) => r.price !== null);
  const cheapest = priced.length ? priced.reduce((a, b) => (b.price! < a.price! ? b : a)) : null;
  return { rows, from: cheapest?.price ?? null, fromDays: cheapest?.tenorDays ?? null, loading: fair.isLoading, distance, strike: fair.data?.reference.strike ?? null };
}

const startsLabel = (bps: number) => (bps === 0 ? "from today's rate" : `from ${bps / 100}% away`);

const MARKET_COLS = { gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr) 128px' };

function MarketRow({ pool, go, expandable = true }: { pool: CurrencyPool; go: Go; expandable?: boolean }) {
  const [open, setOpen] = useState(false);
  const offers = usePoolOffers(pool);
  const direction = pool.direction === 'down' ? 'down' : 'up';
  const label = exposureLabel(pool.pair, pool.direction === 'both' ? 'up' : pool.direction);
  const buy = (days?: number) => go('h-protect', { pair: pool.pair, direction, pool: poolRef(pool), days });
  const types = [pool.structures.capped && 'Capped', pool.structures.open && 'Open'].filter(Boolean).join(' + ');
  return (
    <>
      <div className={`bx-li${expandable ? ' click' : ''}`} style={MARKET_COLS} onClick={() => expandable && setOpen((o) => !o)}>
        <div className="bx-who"><Flag pair={pool.pair} /><div style={{ minWidth: 0 }}><div className="t">{label.title}</div><div className="d">{pool.pair} · {types} · {startsLabel(offers.distance)}</div></div></div>
        <div className="r"><div className="num" style={{ fontWeight: 600 }}>${fmt(pool.liquidity.capacity, 0)}</div><div className="muted" style={{ fontSize: 12 }}>available</div></div>
        <div className="r"><div className="num" style={{ fontWeight: 600 }}>{offers.from === null ? (offers.loading ? '...' : '-') : pct(offers.from)}</div><div className="muted" style={{ fontSize: 12 }}>{offers.fromDays ? `for ${offers.fromDays} days` : 'price'}</div></div>
        <div className="r" style={{ fontSize: 13 }}>{pool.tenors.filter((t) => t.active).map((t) => t.tenorDays).sort((a, b) => a - b).join(', ')} days</div>
        <div className="r" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button className="bx-btn small" onClick={(e) => { e.stopPropagation(); buy(); }}>Buy cover</button>
          {expandable && (open ? <ChevronUp size={16} className="muted" /> : <ChevronDown size={16} className="muted" />)}
        </div>
      </div>
      {open && (
        <div style={{ background: '#f8f9fb', borderRadius: 12, padding: '6px 14px 10px', margin: '0 0 10px' }}>
          <div className="bx-list-h" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 96px' }}><span>Length</span><span className="r">Ends</span><span className="r">Price</span><span className="r">Cost per $1,000</span><span /></div>
          {offers.rows.map((r) => (
            <div key={r.tenorDays} className="bx-li" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 96px', padding: '10px 0' }}>
              <span style={{ fontWeight: 600 }}>{r.tenorDays} days</span>
              <span className="r">{dateIn(r.tenorDays)}</span>
              <span className="r num">{r.price === null ? '-' : pct(r.price)}</span>
              <span className="r num">{r.per1000 === null ? '-' : `$${fmt(r.per1000)}`}</span>
              <span className="r"><button className="bx-btn ghost small" onClick={() => buy(r.tenorDays)}>Buy</button></span>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 12, paddingTop: 6 }}>Prices are for this pool's closest cover: starting {offers.distance === 0 ? "at today's rate" : `${offers.distance / 100}% from today`}{offers.strike ? ` (${fmtRate(offers.strike)} ${quoteCcy(pool.pair)})` : ''}, capped 10% beyond, including the BlockFinaX fee. Cover starting further away costs less. Your exact price is shown before you buy.</div>
        </div>
      )}
    </>
  );
}

function MarketHeader() {
  return <div className="bx-list-h" style={MARKET_COLS}><span>Cover</span><span className="r">Liquidity</span><span className="r">Premium</span><span className="r">Lengths</span><span /></div>;
}

function useOpenPools() {
  const pools = usePools();
  const open = (pools.data ?? []).filter((p) => p.acceptingHedges && Number(p.liquidity.capacity) > 0 && p.tenors.some((t) => t.active));
  return { pools, open };
}

export function MarketsPage({ go }: { go: Go }) {
  const { pools, open } = useOpenPools();
  const pairs = Array.from(new Set(open.map((p) => p.pair)));
  const [filter, setFilter] = useState<string>('all');
  const shown = open.filter((p) => filter === 'all' || p.pair === filter);
  return (
    <main className="bx-main">
      <section className="bx-full">
        <div className="bx-card">
          <div className="bx-card-h" style={{ flexWrap: 'wrap' }}>
            <div><h2>Markets</h2><div className="sub">Open pools you can buy cover from. Choose a pool to see its price for each length.</div></div>
            <div className="bx-seg" style={{ width: 'auto' }}>
              <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
              {pairs.map((p) => <button key={p} className={filter === p ? 'on' : ''} onClick={() => setFilter(p)}>{ccyName(p)}</button>)}
            </div>
          </div>
          {pools.isLoading ? <Loading /> : !shown.length ? <div className="bx-empty">No cover is on sale right now.</div> : (
            <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 760 }}>
              <MarketHeader />
              {shown.map((p) => <MarketRow key={poolRef(p)} pool={p} go={go} />)}
            </div></div>
          )}
        </div>
        <RateMarkets go={go} />
      </section>
    </main>
  );
}

// ── Home ─────────────────────────────────────────────────────────────────────

export function HedgerHome({ go }: { go: Go }) {
  const balances = useUsdcBalances();
  const hedges = useHedges();
  const pools = usePools();
  const all = hedges.data ?? [];
  const active = all.filter((h) => h.settlement.status === 'pending');
  const pairs = useMemo(() => Array.from(new Set((pools.data ?? []).map((p) => p.pair))), [pools.data]);
  const rates = useRates(pairs);
  const spotOf = (pair: string) => rates.find((r) => r.pair === pair)?.spot;
  const watch = useWatchlist();
  const benchmarks = useBenchmarks();
  const watchRows = [...(watch.data ?? [])].sort((a, b) => Number(pairs.includes(b.pair)) - Number(pairs.includes(a.pair))).slice(0, 6);
  const exposure = active.reduce((s, h) => s + Number(h.position.notional), 0);
  const next = active.length ? Math.min(...active.map((h) => h.position.expiry)) : null;
  const activity = [...all].sort((a, b) => b.position.createdAt - a.position.createdAt).slice(0, 4);
  const cols = { gridTemplateColumns: 'minmax(0, 2.2fr) repeat(3, minmax(0, 1fr))' };

  return (
    <main className="bx-main">
      <section className="bx-col">
        <div className="bx-card">
          <div className="bx-hero-k">Your balance</div>
          <div className="bx-hero-v num">${fmt(balances.data?.total)}</div>
          <div className="sub">USDC · network fees covered by BlockFinaX</div>
          <div className="bx-strip">
            <div><div className="k">Protected exposure</div><div className="v num">${fmt(exposure, 0)}</div></div>
            <div><div className="k">Active protections</div><div className="v num">{active.length}</div></div>
            <div><div className="k">Next expiry</div><div className="v num">{next ? `${daysLeft(next)} days` : '-'}</div>{next && <div className="s">{dateOf(next)}</div>}</div>
          </div>
        </div>

        <div className="bx-card">
          <div className="bx-card-h"><h2>Your protections</h2><button className="bx-link" onClick={() => go('h-protections')}>View all</button></div>
          {hedges.isLoading ? <Loading /> : !active.length ? (
            <div className="bx-empty">Nothing protected yet. <button className="bx-link" onClick={() => go('h-protect')}>Protect an exposure</button></div>
          ) : (
            <>
              <div className="bx-list-h" style={cols}><span>Exposure</span><span className="r">Protected</span><span className="r">Expires</span><span className="r">Payout today</span></div>
              {active.map(({ position: p, pair, settlement: s }) => (
                <div key={s.position} className="bx-li click" style={cols} onClick={() => go('h-protections')}>
                  <div className="bx-who">
                    <Flag pair={pair} />
                    <div style={{ minWidth: 0 }}>
                      <div className="t">{exposureLabel(pair, p.direction).title} · {p.structure === 'open' ? 'Open' : 'Capped'}</div>
                      <div className="d">Covered {p.direction === 'up' ? 'above' : 'below'} {fmtRate(p.strike)}{p.structure === 'capped' ? `, up to ${fmtRate(p.cap)}` : ''} {quoteCcy(pair)}</div>
                    </div>
                  </div>
                  <div className="r num" style={{ fontWeight: 600 }}>${fmt(p.notional, 0)}</div>
                  <div className="r"><div className="num">{dateOf(p.expiry)}</div><div className="muted" style={{ fontSize: 12 }}>{daysLeft(p.expiry)} days</div></div>
                  <div className="r"><div className="num" style={{ fontWeight: 600 }}>${fmt(payoutToday(p, spotOf(pair)) ?? 0)}</div><div className="up" style={{ fontSize: 12, fontWeight: 600 }}>Active</div></div>
                </div>
              ))}
            </>
          )}
        </div>
        <AvailableCover go={go} />
      </section>

      <aside className="bx-aside">
        <div className="bx-cta">
          <h3>Protect an exposure</h3>
          <p>Lock in today's rate for a payment or receivable. Pay a premium in USDC, and get paid if the rate moves against you.</p>
          <button onClick={() => go('h-protect')}>Get started</button>
        </div>
        <div className="bx-card tight">
          <div className="bx-card-h"><h2>Rates</h2><button className="bx-link" onClick={() => go('h-rates')}>All rates</button></div>
          <div className="bx-card-h" style={{ marginTop: 4 }}><span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>FX rates</span><button className="bx-link" style={{ fontSize: 12 }} onClick={() => go('h-rates', { rates: 'fx' })}>See all</button></div>
          {watch.isLoading ? <Loading /> : watchRows.map((r) => (
            <div key={r.pair} className="bx-mini" style={{ cursor: 'pointer' }} onClick={() => go(pairs.includes(r.pair) ? 'h-protect' : 'h-rates', pairs.includes(r.pair) ? { pair: r.pair } : undefined)}>
              <Flag pair={r.pair} />
              <div className="grow"><div className="t">{r.pair}</div><div className="d">{pairName(r.pair)}</div></div>
              <div style={{ textAlign: 'right' }}><div className="num t">{r.spot ? fmtRate(r.spot) : '-'}</div><div style={{ fontSize: 12 }}><ChangeText change={r.change} /></div></div>
            </div>
          ))}
          <div className="bx-card-h" style={{ marginTop: 16 }}><span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Interest rates</span><button className="bx-link" style={{ fontSize: 12 }} onClick={() => go('h-rates', { rates: 'ir' })}>See all</button></div>
          {benchmarks.isLoading ? <Loading /> : !(benchmarks.data ?? []).length ? <div className="bx-empty">No benchmarks yet.</div> : (benchmarks.data ?? []).map((b) => (
            <div key={b.id} className="bx-mini" style={{ cursor: 'pointer' }} role="button" tabIndex={0} aria-label={`Open ${b.id}`}
              onClick={() => go('h-rates', { rates: 'ir', benchmark: b.id })}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('h-rates', { rates: 'ir', benchmark: b.id }); } }}>
              <span className="bx-ic"><Percent aria-hidden="true" /></span>
              <div className="grow"><div className="t">{b.id}</div><div className="d">{b.currency} overnight rate</div></div>
              <div style={{ textAlign: 'right' }}><div className="num t">{b.latest ? pctText(b.id, b.latest) : '-'}</div><div style={{ fontSize: 12 }}><BpChange bp={bpBetween(b.latest, b.previous)} /></div></div>
            </div>
          ))}
        </div>
        <div className="bx-card tight">
          <h2 style={{ marginBottom: 4 }}>Recent activity</h2>
          {!activity.length ? <div className="bx-empty">No activity yet.</div> : activity.map(({ position: p, pair, settlement: s }) => (
            <div key={s.position} className="bx-mini">
              <span className="bx-ic"><Shield aria-hidden="true" /></span>
              <div className="grow"><div className="t">{s.status === 'claimed' ? 'Payout received' : 'Bought'} · {exposureLabel(pair, p.direction).title}</div><div className="d">{dateOf(p.createdAt)}</div></div>
              <div className={`num t ${s.status === 'claimed' ? 'up' : ''}`}>{s.status === 'claimed' ? `+$${fmt(s.netPayout)}` : `-$${fmt(Number(p.premium) + Number(p.fee))}`}</div>
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}

function AvailableCover({ go }: { go: Go }) {
  const { pools, open } = useOpenPools();
  return (
    <div className="bx-card">
      <div className="bx-card-h"><h2>Available cover</h2><button className="bx-link" onClick={() => go('h-markets')}>All markets</button></div>
      {pools.isLoading ? <Loading /> : !open.length ? <div className="bx-empty">No cover is on sale right now.</div> : (
        <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 700 }}>
          <MarketHeader />
          {open.slice(0, 5).map((p) => <MarketRow key={poolRef(p)} pool={p} go={go} />)}
        </div></div>
      )}
    </div>
  );
}

// ── Protect ──────────────────────────────────────────────────────────────────

const RANGES = ['1H', '6H', '24H', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX'] as const;
type Range = (typeof RANGES)[number];

/** Chart points: intraday ranges from live-rate snapshots, longer ones from daily closes. */
function useChart(pair: string | null, range: Range) {
  return useQuery({
    queryKey: ['v2-chart', pair, range],
    enabled: Boolean(pair),
    queryFn: async () => (await api<{ points: { t: string; v: number }[] }>(`/api/v2/chart?pair=${encodeURIComponent(pair!)}&range=${range}`)).points,
    staleTime: range.endsWith('H') ? 60_000 : 600_000,
    refetchInterval: range.endsWith('H') ? 120_000 : false,
  });
}
const AMOUNTS = [500, 1000, 5000, 10000];

function RateChart({ points, loading, strike, cap }: { points: { t: string; v: number }[]; loading: boolean; strike: number | null; cap: number | null }) {
  if (points.length < 2) {
    return <div className="bx-chart"><div className="bx-empty">{loading ? 'Loading chart...' : 'Not enough data for this range yet.'}</div></div>;
  }
  const values = points.map((c) => c.v);
  const marks = [strike, cap].filter((v): v is number => v !== null);
  const lo = Math.min(...values, ...marks), hi = Math.max(...values, ...marks);
  const span = hi - lo || 1;
  const y = (v: number) => 228 - ((v - lo) / span) * 216;
  const x = (i: number) => (i / (values.length - 1)) * 800;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const rising = values[values.length - 1] >= values[0];
  return (
    <div className="bx-chart">
      <svg role="img" aria-label={`Rate over the selected period, ${rising ? 'rising' : 'falling'}`} viewBox="0 0 800 240" preserveAspectRatio="none">
        {[60, 120, 180].map((g) => <line key={g} x1="0" y1={g} x2="800" y2={g} stroke="#eceef2" strokeDasharray="4 6" />)}
        <path d={`${line} L800 240 L0 240 Z`} fill="#1f5fe0" fillOpacity="0.07" />
        <path d={line} fill="none" stroke="#1f5fe0" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {strike !== null && <line x1="0" y1={y(strike)} x2="800" y2={y(strike)} stroke="#e0a03a" strokeWidth="1.5" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
        {cap !== null && <line x1="0" y1={y(cap)} x2="800" y2={y(cap)} stroke="#9aa2af" strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />}
      </svg>
      {strike !== null && <span className="bx-strike-tag" style={{ top: `calc(${(y(strike) / 240) * 100}% - 22px)` }}>Your strike {fmtRate(strike)}</span>}
    </div>
  );
}

export function ProtectPage({ go, pair: initialPair, target }: { go: Go; pair: string | null; target?: Target }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pools = usePools();
  const chains = useChains();
  const balances = useUsdcBalances();

  const available = useMemo(() => (pools.data ?? []).filter((p) => p.acceptingHedges && Number(p.liquidity.capacity) > 0), [pools.data]);
  const pairs = useMemo(() => Array.from(new Set(available.map((p) => p.pair))), [available]);
  const [pair, setPair] = useState<string | null>(initialPair);
  useEffect(() => { if (initialPair) setPair(initialPair); }, [initialPair]);
  useEffect(() => { if ((!pair || !pairs.includes(pair)) && pairs[0]) setPair(pairs[0]); }, [pairs, pair]);
  const directions = useMemo(() => {
    const ds = new Set(available.filter((p) => p.pair === pair).map((p) => p.direction));
    return (['up', 'down'] as Direction[]).filter((d) => ds.has(d) || ds.has('both'));
  }, [available, pair]);
  const [direction, setDirection] = useState<Direction>(target?.direction ?? 'up');
  useEffect(() => { if (target?.direction) setDirection(target.direction); }, [target?.direction]);
  useEffect(() => { if (directions.length && !directions.includes(direction)) setDirection(directions[0]); }, [directions, direction]);
  // The pool to buy from: one chosen in Markets, or null for the best price.
  const [poolChoice, setPoolChoice] = useState<string | null>(target?.pool ?? null);
  useEffect(() => { setPoolChoice(target?.pool ?? null); }, [target?.pool]);
  const matching = available.filter((p) => p.pair === pair && (p.direction === direction || p.direction === 'both'));
  useEffect(() => { if (poolChoice && !matching.some((p) => poolRef(p) === poolChoice)) setPoolChoice(null); }, [poolChoice, matching]);

  const [range, setRange] = useState<Range>('1M');
  const spot = useSpot(pair);
  const chart = useChart(pair, range);
  const points = chart.data ?? [];
  // Intraday ranges share the live rate's source, so measure from the live rate; daily
  // ranges measure close to close so two providers are never compared.
  const periodChange = points.length >= 2
    ? (range.endsWith('H') && spot.data ? spot.data : points[points.length - 1].v) / points[0].v - 1
    : null;

  const options = useQuery({
    queryKey: ['v2-options', pair, direction],
    enabled: Boolean(pair),
    queryFn: () => api<{ tenors: { tenorDays: number; open: boolean; capped: boolean }[] }>(`/api/v2/options?pair=${encodeURIComponent(pair!)}&direction=${direction}`),
  });
  const [amount, setAmount] = useState('1000');
  const [days, setDays] = useState<number | null>(target?.days ?? null);
  useEffect(() => { if (target?.days) setDays(target.days); }, [target?.days]);
  const chosenPool = matching.find((p) => poolRef(p) === poolChoice) ?? null;
  // A chosen pool offers its own lengths and cover types; otherwise all pools combined.
  const tenorList = chosenPool
    ? chosenPool.tenors.filter((t) => t.active).map((t) => ({ tenorDays: t.tenorDays, open: chosenPool.structures.open, capped: chosenPool.structures.capped })).sort((a, b) => a.tenorDays - b.tenorDays)
    : options.data?.tenors ?? [];
  useEffect(() => {
    if (tenorList.length && !tenorList.some((t) => t.tenorDays === days)) setDays((tenorList.find((t) => t.tenorDays >= 14) ?? tenorList[0]).tenorDays);
  }, [tenorList.map((t) => t.tenorDays).join(','), days]);
  const tenor = tenorList.find((t) => t.tenorDays === days);

  const pool = chosenPool ?? matching[0];
  const capMin = (pool?.structures.minCapDistanceBps ?? 300) / 100;
  const capMax = (pool?.structures.maxCapDistanceBps || 2000) / 100;
  const sign = direction === 'up' ? 1 : -1;
  // The closest strike the pool(s) allow, set by their underwriters.
  const minStartPct = (chosenPool ? chosenPool.structures.minStrikeDistanceBps ?? 0 : Math.min(...(matching.length ? matching.map((p) => p.structures.minStrikeDistanceBps ?? 0) : [0]))) / 100;
  const startChoices = Array.from(new Set([minStartPct, minStartPct + 2, minStartPct + 5].map((v) => Math.round(v * 100) / 100)));
  const [startPct, setStartPct] = useState(2);
  useEffect(() => { if (!startChoices.includes(startPct)) setStartPct(startChoices[0]); }, [startChoices.join(','), startPct]);
  const [capPct, setCapPct] = useState(10);
  useEffect(() => { setCapPct((c) => Math.min(Math.max(c, capMin), capMax)); }, [capMin, capMax]);
  const [structure, setStructure] = useState<'capped' | 'open'>('capped');
  useEffect(() => { if (tenor && !tenor[structure]) setStructure(tenor.capped ? 'capped' : 'open'); }, [tenor, structure]);
  const strike = spot.data ? spot.data * (1 + (sign * startPct) / 100) : null;
  const cap = strike ? strike * (1 + (sign * capPct) / 100) : null;

  const base = pair && days && strike && Number(amount) > 0 ? { pair, notional: amount, tenorDays: days, direction, strike: strike.toFixed(6), ...(poolChoice ? { pool: poolChoice } : {}) } : null;
  const cappedReq = useDebounced(base && cap && tenor?.capped ? JSON.stringify({ ...base, structure: 'capped', cap: cap.toFixed(6) }) : null, 350);
  const openReq = useDebounced(base && tenor?.open ? JSON.stringify({ ...base, structure: 'open' }) : null, 350);
  const [refresh, setRefresh] = useState(0);
  const q = (req: string | null) => ({ queryKey: ['v2-quote', req, refresh], enabled: Boolean(req), retry: false, queryFn: () => api<ProtectionQuote>('/api/v2/quotes', JSON.parse(req!)) });
  const capped = useQuery(q(cappedReq));
  const open = useQuery(q(openReq));
  const chosen = structure === 'capped' ? capped : open;
  const e = chosen.data?.economic;
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
  const [mode, setMode] = useState<'build' | 'review' | 'done'>('build');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setMode((m) => (m === 'done' ? m : 'build')); }, [pair, direction]);

  async function confirm() {
    const quote = chosen.data;
    if (!quote) return;
    if (left < 5) { setRefresh((n) => n + 1); return; }
    if (onHub < Number(quote.economic.totalCost)) {
      toast({ title: 'Not enough USDC', description: `This needs $${fmt(quote.economic.totalCost)} USDC. Add funds first.`, variant: 'destructive' });
      return;
    }
    setBusy('Preparing...');
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/hedges/prepare', { quote });
      await signAndSend(transactions, (m) => setBusy(m));
      setMode('done');
      for (const k of ['v2-hedges', 'v2-pools', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (err) {
      toast({ title: 'Protection not placed', description: (err as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (pools.isLoading) return <main className="bx-main"><section className="bx-full"><Loading /></section></main>;
  if (!pair) return <main className="bx-main"><section className="bx-full"><div className="bx-card"><div className="bx-empty">No protection is on sale right now. Please check back soon.</div></div></section></main>;
  const ccy = quoteCcy(pair);
  const name = ccyName(pair);

  return (
    <main className="bx-main">
      <section className="bx-col">
        <div className="bx-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <Flag pair={pair} large />
            <div><div style={{ fontSize: 22, fontWeight: 600 }}>{name}</div><div className="muted">{pair}</div></div>
            {pairs.length > 1 && (
              <select className="bx-select" style={{ marginLeft: 'auto', width: 'auto' }} aria-label="Currency" value={pair} onChange={(ev) => setPair(ev.target.value)}>
                {pairs.map((p) => <option key={p} value={p}>{ccyName(p)} ({p})</option>)}
              </select>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
            <span className="num" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em' }}>{spot.data ? fmtRate(spot.data) : '...'}</span>
            <span className="muted">{ccy} per 1 USD</span>
            <ChangeText change={periodChange} /><span className="muted" style={{ fontSize: 13 }}>{range === 'MAX' ? 'all time' : range === 'YTD' ? 'this year' : range}</span>
          </div>
          <RateChart points={points} loading={chart.isLoading} strike={strike} cap={structure === 'capped' ? cap : null} />
          <div className="bx-ranges" role="group" aria-label="Chart range">
            {RANGES.map((r) => <button key={r} className={range === r ? 'on' : ''} aria-pressed={range === r} onClick={() => setRange(r)}>{r}</button>)}
          </div>
        </div>

        <div className="bx-card">
          <h2 style={{ marginBottom: 14 }}>How protection works</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 20 }}>
            {[
              ['Choose your cover', 'Pick an amount, how long you need it, and where protection starts.'],
              ['Pay once in USDC', 'The premium is the whole cost. Network fees are covered by BlockFinaX.'],
              ['Get paid if it moves', `If the ${name} ${direction === 'up' ? 'weakens' : 'strengthens'} past your strike at expiry, you receive the difference.`],
            ].map(([t, d], i) => (
              <div key={t}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--blue-soft)', color: 'var(--blue)', display: 'grid', placeItems: 'center', fontWeight: 700 }}>{i + 1}</div>
                <div style={{ fontWeight: 600, marginTop: 10 }}>{t}</div>
                <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: '4px 0 0' }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="bx-aside" aria-label="Protect">
        <div className="bx-panel">
          {mode === 'done' ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <CheckCircle2 style={{ width: 48, height: 48, color: 'var(--green)' }} />
              <h3 style={{ fontSize: 18, margin: '10px 0 4px' }}>Your exposure is protected</h3>
              <p className="muted">${fmt(amount, 0)} of USD {exposureLabel(pair, direction).flow} protected until {days ? dateIn(days) : ''}.</p>
              <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
                <button className="bx-btn block" onClick={() => go('h-home')}>Go to home</button>
                <button className="bx-btn ghost block" onClick={() => setMode('build')}>Protect another</button>
              </div>
            </div>
          ) : mode === 'review' && e ? (
            <>
              <div><div style={{ fontSize: 18, fontWeight: 600 }}>Review protection</div><div className="muted" style={{ fontSize: 13, marginTop: 2 }}>You are protecting ${fmt(e.notional, 0)} of {ccy} exposure.</div></div>
              <div className="bx-sums" style={{ borderTop: 0, paddingTop: 0 }}>
                <Sum l="Current rate" v={<span className="num">{fmtRate(e.spot)}</span>} />
                <Sum l="Protection starts" v={<span className="num">{fmtRate(e.strike)}</span>} />
                <Sum l="Protection type" v={e.structure === 'open' ? 'Open' : 'Capped'} />
                {e.structure === 'capped' && <Sum l="Maximum protected rate" v={<span className="num">{fmtRate(e.cap)}</span>} />}
                <Sum l="Duration" v={`${e.tenorDays} days`} />
                <Sum l="Expiry" v={dateIn(e.tenorDays)} />
                <Sum l="Most you can receive" v={<span className="num">${fmt(e.maxPayout)}</span>} />
                <Sum l="Premium" v={<span className="num">{pct(e.offerRateE6 / 1e6)} (${fmt(e.premium)})</span>} />
                <Sum l="Execution cost" v={<span className="num">${fmt(e.hedgerFee)}</span>} />
                <Sum l="Network fees" v="Covered" good />
                <Sum l="Total" v={<span className="num">${fmt(e.totalCost)}</span>} total />
              </div>
              <details>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Advanced details</summary>
                <div style={{ marginTop: 6 }}>
                  <Sum l="Fair price" v={pct(e.fairRateE6 / 1e6, 3)} />
                  <Sum l="Settlement network" v={chains.data?.chains.find((c) => c.key === e.executionChain)?.name ?? e.executionChain} />
                  <Sum l="Pool" v={`${e.pool.contract.slice(0, 6)}...${e.pool.contract.slice(-4)} · ${e.pool.id}`} />
                </div>
              </details>
              {onHub < Number(e.totalCost) && <p className="bx-error">Your balance (${fmt(onHub)}) is too low. Add funds first.</p>}
              <button className="bx-btn block" disabled={!!busy} onClick={confirm}>{busy ? <><Spin /> {busy}</> : left < 5 ? 'Refresh price' : 'Confirm protection'}</button>
              <button className="bx-btn ghost block" disabled={!!busy} onClick={() => setMode('build')}>Back</button>
              <div className="bx-hint">Price held for {left} seconds · approve with your passkey</div>
            </>
          ) : (
            <>
              {directions.length > 1 && (
                <div className="bx-seg">
                  {directions.map((d) => <button key={d} className={direction === d ? 'on' : ''} onClick={() => setDirection(d)}>{exposureLabel(pair, d).kind}</button>)}
                </div>
              )}
              {matching.length > 0 && (
                <div>
                  <label htmlFor="bx-pool" className="bx-label">Buying from</label>
                  <select id="bx-pool" className="bx-select" value={poolChoice ?? ''} onChange={(ev) => setPoolChoice(ev.target.value || null)}>
                    <option value="">Best price across pools</option>
                    {matching.map((p) => <option key={poolRef(p)} value={poolRef(p)}>Pool {p.poolId} · ${fmt(p.liquidity.capacity, 0)} available · {startsLabel(p.structures.minStrikeDistanceBps ?? 0)}</option>)}
                  </select>
                </div>
              )}
              <div className="bx-big">
                <label htmlFor="bx-amount">Amount to protect (USD)</label>
                <input id="bx-amount" inputMode="decimal" value={`$${amount}`} onChange={(ev) => setAmount(ev.target.value.replace(/[^0-9.]/g, ''))} />
                <div className="bx-pills" style={{ marginTop: 8 }}>
                  {AMOUNTS.map((a) => <button key={a} className={`bx-pill${Number(amount) === a ? ' on' : ''}`} onClick={() => setAmount(String(a))}>{a >= 1000 ? `$${a / 1000}K` : `$${a}`}</button>)}
                </div>
              </div>
              <div>
                <span className="bx-label">How long</span>
                <div className="bx-pills wrap">
                  {tenorList.map((t) => <button key={t.tenorDays} className={`bx-pill${t.tenorDays === days ? ' on' : ''}`} onClick={() => setDays(t.tenorDays)}>{t.tenorDays} days</button>)}
                </div>
                {days && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Ends {dateIn(days)}</div>}
              </div>
              <div>
                <span className="bx-label">Protection starts</span>
                <div className="bx-seg">
                  {startChoices.map((m) => <button key={m} className={startPct === m ? 'on' : ''} onClick={() => setStartPct(m)}>{m === 0 ? "Today's rate" : `${m}% away`}</button>)}
                </div>
              </div>
              <div>
                <span className="bx-label">Cover type</span>
                <div className="bx-choice">
                  {tenor?.capped !== false && <button className={structure === 'capped' ? 'on' : ''} onClick={() => setStructure('capped')}><div className="t">Capped</div><div className="p num">{capped.data ? `$${fmt(capped.data.economic.totalCost)}` : capped.isFetching ? '...' : '-'}</div></button>}
                  {tenor?.open !== false && <button className={structure === 'open' ? 'on' : ''} onClick={() => setStructure('open')}><div className="t">Open</div><div className="p num">{open.data ? `$${fmt(open.data.economic.totalCost)}` : open.isFetching ? '...' : '-'}</div></button>}
                </div>
              </div>
              {structure === 'capped' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><label htmlFor="bx-cap" className="muted">Maximum protected rate</label><span className="num" style={{ fontWeight: 600 }}>{cap ? fmtRate(cap) : '-'}</span></div>
                  <input id="bx-cap" className="bx-range" type="range" min={capMin} max={capMax} step={1} value={capPct} onChange={(ev) => setCapPct(Number(ev.target.value))} />
                  <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>Lower cap: cheaper</span><span>Higher cap: more protection</span></div>
                </div>
              )}
              <div className="bx-sums">
                <Sum l={`Protection starts ${direction === 'up' ? 'above' : 'below'}`} v={<span className="num">{strike ? fmtRate(strike) : '-'}</span>} />
                <Sum l="Most you can receive" v={<span className="num">{e ? `$${fmt(e.maxPayout)}` : '-'}</span>} />
                <Sum l="Premium" v={<span className="num">{e ? `$${fmt(e.premium)}` : '-'}</span>} />
                <Sum l="Execution cost" v={<span className="num">{e ? `$${fmt(e.hedgerFee)}` : '-'}</span>} />
                <Sum l="Network fees" v="Covered" good />
                <Sum l="Total" v={<span className="num">{e ? `$${fmt(e.totalCost)}` : chosen.isFetching ? '...' : '-'}</span>} total />
              </div>
              {chosen.error && <p className="bx-error">{(chosen.error as Error).message}</p>}
              <button className="bx-btn block" disabled={!e} onClick={() => setMode('review')}>Review protection</button>
              <div className="bx-hint">{e ? `Price held for ${left} seconds · ` : ''}approve with your passkey</div>
            </>
          )}
        </div>
      </aside>
    </main>
  );
}

// ── My protections ───────────────────────────────────────────────────────────

export function MyProtections({ go }: { go: Go }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const hedges = useHedges();
  const all = hedges.data ?? [];
  const rates = useRates(Array.from(new Set(all.map((h) => h.pair))));
  const spotOf = (pair: string) => rates.find((r) => r.pair === pair)?.spot;
  const [busy, setBusy] = useState<string | null>(null);
  const cols = { gridTemplateColumns: 'minmax(0, 2.2fr) repeat(4, minmax(0, 1fr))' };
  async function claim(ref: string) {
    setBusy(ref);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/hedges/${encodeURIComponent(ref)}/claim/prepare`, {});
      await signAndSend(transactions, () => {});
      toast({ title: 'Payout received', description: 'The USDC is in your account.' });
      for (const k of ['v2-hedges', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (err) {
      toast({ title: 'Not received', description: (err as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }
  return (
    <main className="bx-main">
      <section className="bx-full">
        <div className="bx-card">
          <div className="bx-card-h"><h2>My protections</h2><button className="bx-btn small" onClick={() => go('h-protect')}>Protect an exposure</button></div>
          {hedges.isLoading ? <Loading /> : !all.length ? <div className="bx-empty">You have not bought protection yet.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 720 }}>
                <div className="bx-list-h" style={cols}><span>Exposure</span><span className="r">Protected</span><span className="r">Expiry</span><span className="r">Payout</span><span className="r">Status</span></div>
                {all.map(({ position: p, pair, settlement: s }) => {
                  const active = s.status === 'pending';
                  const payout = active ? payoutToday(p, spotOf(pair)) : Number(s.netPayout);
                  return (
                    <div key={s.position} className="bx-li" style={cols}>
                      <div className="bx-who"><Flag pair={pair} /><div style={{ minWidth: 0 }}><div className="t">{exposureLabel(pair, p.direction).title} · {p.structure === 'open' ? 'Open' : 'Capped'}</div><div className="d">From {fmtRate(p.strike)}{p.structure === 'capped' ? ` to ${fmtRate(p.cap)}` : ''} {quoteCcy(pair)}</div></div></div>
                      <div className="r num" style={{ fontWeight: 600 }}>${fmt(p.notional, 0)}</div>
                      <div className="r"><div className="num">{dateOf(p.expiry)}</div><div className="muted" style={{ fontSize: 12 }}>{active ? `${daysLeft(p.expiry)} days` : 'ended'}</div></div>
                      <div className="r num" style={{ fontWeight: 600 }}>${fmt(payout ?? 0)}<div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{active ? 'if it ended today' : ''}</div></div>
                      <div className="r">
                        {active ? <Tag tone="green">Active</Tag> : s.status === 'settled_claimable'
                          ? <button className="bx-btn small" disabled={busy === s.position} onClick={() => claim(s.position)}>{busy === s.position ? <Spin /> : 'Receive payout'}</button>
                          : s.status === 'claimed' ? <Tag tone="grey">Paid</Tag> : <Tag tone="grey">Expired</Tag>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <RateProtections />
      </section>
    </main>
  );
}

// ── Rates ────────────────────────────────────────────────────────────────────
// Two asset classes: FX rates and interest rates. Interest-rate rows open a benchmark page.

type Fixing = {
  observationDate: string; ratePercent: string; rateMicroPercent: number; status: string; locked: boolean;
  source: string; onChain: { round: number; tx: string } | null;
};
type BenchmarkRow = {
  id: string; name: string; currency: string; administrator: string; licensing: string; state: 'PUBLISHED' | 'PENDING' | 'DELAYED';
  expected: { observationDate: string; expectedAt: string }; latest: Fixing | null; previous: Fixing | null; notice?: string;
};
type BenchmarkDetail = BenchmarkRow & {
  registry: { website?: string; publicationTime?: string; timeZone: string; dayCountBasis: number; decimals: number; source: string; fallbackSource?: string; observationConvention: string };
};

const ADMINISTRATOR: Record<string, string> = { SOFR: 'Federal Reserve Bank of New York', KESONIA: 'Central Bank of Kenya' };
const SOURCE_NAME: Record<string, string> = {
  NEW_YORK_FED_API: 'New York Fed Markets API', NEW_YORK_FED_SEARCH: 'New York Fed Markets API (search)', CBK_KESONIA_TABLE: 'Central Bank of Kenya website',
};
const STELLAR_TX = 'https://stellar.expert/explorer/testnet/tx/';
const isTxHash = (tx: string) => /^[0-9a-f]{64}$/.test(tx);
const dayLabel = (iso: string) => dateOf(Date.parse(`${iso}T12:00:00Z`) / 1000);
const pctText = (id: string, f: Fixing) => `${Number(f.ratePercent).toFixed(id === 'SOFR' ? 2 : 4)}%`;

function useBenchmarks() {
  return useQuery({
    queryKey: ['v2-benchmarks'],
    queryFn: async () => (await api<{ benchmarks: BenchmarkRow[] }>('/api/v2/benchmarks')).benchmarks,
    refetchInterval: 60_000,
  });
}

function BpChange({ bp }: { bp: number | null }) {
  if (bp === null) return <span className="muted">-</span>;
  return <span className={`num ${bp > 0 ? 'up' : bp < 0 ? 'down' : 'muted'}`} style={{ fontWeight: 600 }}>{bp > 0 ? '+' : ''}{bp.toFixed(2)} bp</span>;
}

const bpBetween = (a: Fixing | null | undefined, b: Fixing | null | undefined) => (a && b ? (a.rateMicroPercent - b.rateMicroPercent) / 10_000 : null);

function FixingStatus({ f }: { f: Fixing }) {
  const tag = f.onChain ? <Tag tone="green">On chain</Tag> : !f.locked ? <Tag tone="amber">Open for correction</Tag> : <Tag tone="blue">Locked</Tag>;
  if (f.onChain && isTxHash(f.onChain.tx)) {
    return <a href={STELLAR_TX + f.onChain.tx} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>{tag}</a>;
  }
  return tag;
}

function BenchmarkState({ r }: { r: BenchmarkRow }) {
  if (r.state === 'DELAYED') return <Tag tone="amber">Delayed</Tag>;
  if (!r.latest) return <Tag tone="grey">Waiting</Tag>;
  return <FixingStatus f={r.latest} />;
}

function FxRates({ go }: { go: Go }) {
  const pools = usePools();
  const covered = useMemo(() => new Set((pools.data ?? []).filter((p) => p.acceptingHedges).map((p) => p.pair)), [pools.data]);
  const watch = useWatchlist();
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const rows = (watch.data ?? [])
    .filter((r) => !term || `${r.pair} ${pairName(r.pair)}`.toLowerCase().includes(term))
    .sort((a, b) => Number(covered.has(b.pair)) - Number(covered.has(a.pair)));
  const cols = { gridTemplateColumns: 'minmax(0, 2fr) repeat(2, minmax(0, 1fr)) 150px' };
  return (
    <div className="bx-card">
      <div className="bx-card-h" style={{ flexWrap: 'wrap' }}>
        <div><h2>FX rates</h2><div className="sub">Live exchange rates for the currencies BlockFinaX customers trade in. Change is over the last 24 hours.</div></div>
        <input className="bx-input" style={{ maxWidth: 260 }} aria-label="Search FX rates" placeholder="Search currency" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {watch.isLoading ? <Loading /> : !rows.length ? <div className="bx-empty">No currency matches.</div> : (
        <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 620 }}>
          <div className="bx-list-h" style={cols}><span>Currency</span><span className="r">Rate</span><span className="r">Change</span><span /></div>
          {rows.map((r) => (
            <div key={r.pair} className="bx-li" style={cols}>
              <div className="bx-who"><Flag pair={r.pair} /><div><div className="t">{pairName(r.pair)}</div><div className="d">{r.pair} · 1 {r.pair.split('/')[0]} in {quoteCcy(r.pair)}</div></div></div>
              <div className="r num" style={{ fontWeight: 600 }}>{r.spot ? fmtRate(r.spot) : '-'}</div>
              <div className="r"><ChangeText change={r.change} /></div>
              <div className="r">{covered.has(r.pair)
                ? <button className="bx-btn small" onClick={() => go('h-protect', { pair: r.pair })}>Protect</button>
                : <span className="muted" style={{ fontSize: 12 }}>No cover yet</span>}</div>
            </div>
          ))}
        </div></div>
      )}
    </div>
  );
}

function InterestRates({ open }: { open: (id: string) => void }) {
  const q = useBenchmarks();
  const rows = q.data ?? [];
  const cols = { gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(0, 1fr)) 160px' };
  const notices = Array.from(new Set(rows.map((r) => r.notice).filter(Boolean) as string[]));
  return (
    <div className="bx-card">
      <div className="bx-card-h">
        <div><h2>Interest rates</h2><div className="sub">Official overnight benchmarks, read from each central bank and agreed on chain by the oracle nodes. Change is against the previous business day. Select a benchmark for its history.</div></div>
      </div>
      {q.isLoading ? <Loading /> : q.isError ? <div className="bx-empty">Interest rates are unavailable right now.</div> : !rows.length ? <div className="bx-empty">No benchmarks are in use here yet.</div> : (
        <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 700 }}>
          <div className="bx-list-h" style={cols}><span>Benchmark</span><span className="r">Rate</span><span className="r">Change</span><span className="r">For business day</span><span className="r">Status</span></div>
          {rows.map((r) => (
            <div
              key={r.id} className="bx-li click" style={cols} role="button" tabIndex={0} aria-label={`Open ${r.id}`}
              onClick={() => open(r.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(r.id); } }}
            >
              <div className="bx-who"><div><div className="t">{r.id} <span className="muted" style={{ fontWeight: 400 }}>· {r.currency}</span></div><div className="d">{r.name} · {ADMINISTRATOR[r.id] ?? r.administrator}</div></div></div>
              <div className="r num" style={{ fontWeight: 600 }}>{r.latest ? pctText(r.id, r.latest) : '-'}</div>
              <div className="r"><BpChange bp={bpBetween(r.latest, r.previous)} /></div>
              <div className="r num">{r.latest ? dayLabel(r.latest.observationDate) : '-'}</div>
              <div className="r"><BenchmarkState r={r} /></div>
            </div>
          ))}
        </div></div>
      )}
      {notices.map((n) => <p key={n} className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>{n}</p>)}
    </div>
  );
}

const IR_RANGES = [{ k: '1M', days: 31 }, { k: '3M', days: 92 }, { k: '6M', days: 183 }, { k: '1Y', days: 366 }] as const;

function BenchmarkPage({ id, back }: { id: string; back: () => void }) {
  const [range, setRange] = useState<(typeof IR_RANGES)[number]['k']>('3M');
  const detail = useQuery({
    queryKey: ['v2-benchmark', id],
    queryFn: () => api<BenchmarkDetail>(`/api/v2/benchmarks/${id}`),
    refetchInterval: 60_000,
  });
  const days = IR_RANGES.find((r) => r.k === range)!.days;
  const history = useQuery({
    queryKey: ['v2-benchmark-obs', id],
    // One year of fixings serves every range; ranges filter it locally.
    queryFn: async () => {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10);
      return (await api<{ observations: Fixing[] }>(`/api/v2/benchmarks/${id}/observations?from=${from}&to=${to}`)).observations;
    },
    refetchInterval: 300_000,
  });
  const all = history.data ?? [];
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const shown = all.filter((o) => o.observationDate >= since);
  const points = shown.map((o) => ({ t: o.observationDate, v: o.rateMicroPercent / 1_000_000 }));
  const d = detail.data;
  const latest = d?.latest ?? null;
  const first = shown[0];
  const rangeBp = latest && first ? bpBetween(latest, first) : null;
  const recent = [...all].reverse().slice(0, 15);
  const cols = { gridTemplateColumns: 'minmax(0, 1.4fr) repeat(2, minmax(0, 1fr)) 160px' };

  return (
    <>
      <button className="bx-link" onClick={back} style={{ marginBottom: 12 }}>← Interest rates</button>
      <div className="bx-card">
        {detail.isLoading || !d ? <Loading /> : (
          <>
            <div className="bx-card-h" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <div className="muted" style={{ fontSize: 13 }}>{d.name} · {d.currency}</div>
                <h2 style={{ fontSize: 32, margin: '4px 0' }} className="num">{latest ? pctText(id, latest) : '-'}</h2>
                <div style={{ fontSize: 14 }}>
                  <BpChange bp={bpBetween(d.latest, d.previous)} /> <span className="muted">vs previous business day · for {latest ? dayLabel(latest.observationDate) : '-'}</span>
                </div>
              </div>
              <BenchmarkState r={d} />
            </div>
            <RateChart points={points} loading={history.isLoading} strike={null} cap={null} />
            <div className="bx-ranges" role="group" aria-label="Chart range">
              {IR_RANGES.map((r) => <button key={r.k} className={range === r.k ? 'on' : ''} aria-pressed={range === r.k} onClick={() => setRange(r.k)}>{r.k}</button>)}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              {shown.length < 2 ? 'History builds up as the oracle records each business day.'
                : <>Over {range}: <BpChange bp={rangeBp} /> across {shown.length} business days.</>}
            </div>
          </>
        )}
      </div>

      <RateCoverPanel benchmark={id} />

      <div className="bx-card" style={{ marginTop: 16 }}>
        <div className="bx-card-h"><div><h2>Recent fixings</h2><div className="sub">Each value is the official rate for one business day. It locks after the administrator's correction window, then goes on chain.</div></div></div>
        {history.isLoading ? <Loading /> : !recent.length ? <div className="bx-empty">No fixings recorded yet.</div> : (
          <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 560 }}>
            <div className="bx-list-h" style={cols}><span>Business day</span><span className="r">Rate</span><span className="r">Change</span><span className="r">Status</span></div>
            {recent.map((o, i) => (
              <div key={o.observationDate} className="bx-li" style={cols}>
                <div className="num">{dayLabel(o.observationDate)}</div>
                <div className="r num" style={{ fontWeight: 600 }}>{pctText(id, o)}</div>
                <div className="r"><BpChange bp={bpBetween(o, recent[i + 1])} /></div>
                <div className="r"><FixingStatus f={o} /></div>
              </div>
            ))}
          </div></div>
        )}
      </div>

      {d && (
        <div className="bx-card" style={{ marginTop: 16 }}>
          <div className="bx-card-h"><h2>About {id}</h2></div>
          <Sum l="Administrator" v={ADMINISTRATOR[id] ?? d.administrator} />
          <Sum l="Published" v={d.registry.publicationTime ? `Business days around ${d.registry.publicationTime} (${d.registry.timeZone.replace('_', ' ')})` : 'On decision'} />
          <Sum l="Each value is for" v={d.registry.observationConvention === 'PREVIOUS_BUSINESS_DAY' ? 'The previous business day' : 'The publication day'} />
          <Sum l="Precision" v={`${d.registry.decimals} decimal places`} />
          <Sum l="Day count" v={`Actual/${d.registry.dayCountBasis}`} />
          <Sum l="Source" v={SOURCE_NAME[d.registry.source] ?? d.registry.source} />
          {d.registry.website && (
            <Sum l="Official page" v={<a className="bx-link" href={d.registry.website} target="_blank" rel="noreferrer">{new URL(d.registry.website).hostname.replace(/^www\./, '')} ↗</a>} />
          )}
          <Sum l="Data licence" v={d.licensing === 'CLEARED' ? 'Cleared for use' : 'Testnet only, being confirmed with the administrator'} />
          {d.notice && <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>{d.notice}</p>}
        </div>
      )}
    </>
  );
}

type RatesTab = 'fx' | 'ir';
const TAB_KEY = 'bfx-rates-tab';

export function RatesPage({ go, target }: { go: Go; target?: Target }) {
  const [tab, setTabState] = useState<RatesTab>(() => {
    try { return (localStorage.getItem(TAB_KEY) as RatesTab) === 'ir' ? 'ir' : 'fx'; } catch { return 'fx'; }
  });
  const setTab = (t: RatesTab) => {
    setTabState(t);
    setBenchmark(null);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable */ }
  };
  const [benchmark, setBenchmark] = useState<string | null>(target?.benchmark ?? null);
  // Arriving from Home: open the asked-for tab and benchmark.
  useEffect(() => {
    if (target?.rates) setTab(target.rates);
    if (target?.benchmark) setBenchmark(target.benchmark);
  }, [target]);
  return (
    <main className="bx-main">
      <section className="bx-full">
        <div className="bx-seg" role="tablist" aria-label="Asset class" style={{ maxWidth: 360, marginBottom: 16 }}>
          <button role="tab" aria-selected={tab === 'fx'} className={tab === 'fx' ? 'on' : ''} onClick={() => setTab('fx')}>FX rates</button>
          <button role="tab" aria-selected={tab === 'ir'} className={tab === 'ir' ? 'on' : ''} onClick={() => setTab('ir')}>Interest rates</button>
        </div>
        {tab === 'fx' ? <FxRates go={go} />
          : benchmark ? <BenchmarkPage id={benchmark} back={() => setBenchmark(null)} />
          : <InterestRates open={setBenchmark} />}
      </section>
    </main>
  );
}
