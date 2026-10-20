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
import { AssetClassTabs, Flag, hint, Loading, SHOW_INTEREST_RATES, Spin, Sum, Tag, Toggle, useAssetClass } from './ui';
import type { Go, Target } from './workspace';
import { RateCoverPanel, RateMarkets, RateProtections, useRateProtections } from './rate-pages';

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
          <div className="bx-list-h" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 96px' }}><span>{hint("Length")}</span><span className="r">{hint("Ends")}</span><span className="r">{hint("Price")}</span><span className="r">{hint("Cost per $1,000")}</span><span /></div>
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
  return <div className="bx-list-h" style={MARKET_COLS}><span>{hint("Cover")}</span><span className="r">{hint("Liquidity")}</span><span className="r">{hint("Premium")}</span><span className="r">{hint("Lengths")}</span><span /></div>;
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
  const [assetClass, setAssetClass] = useAssetClass();
  return (
    <main className="bx-main">
      <section className="bx-full">
        <AssetClassTabs value={assetClass} onChange={setAssetClass} />
        {assetClass === 'ir' ? <RateMarkets go={go} /> : <div className="bx-card">
          <div className="bx-card-h" style={{ flexWrap: 'wrap' }}>
            <div><h2>{SHOW_INTEREST_RATES ? 'FX cover' : 'Markets'}</h2><div className="sub">Open pools you can buy currency cover from. Choose a pool to see its price for each length.</div></div>
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
        </div>}
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
  const rateProtections = useRateProtections();
  const rateActive = (rateProtections.data ?? []).filter((p) => p.status === 'active');
  const [protClass, setProtClass] = useAssetClass();
  const [ratesClass, setRatesClass] = useAssetClass();
  const watchRows = [...(watch.data ?? [])].sort((a, b) => Number(pairs.includes(b.pair)) - Number(pairs.includes(a.pair))).slice(0, 6);
  const exposure = active.reduce((s, h) => s + Number(h.position.notional), 0) + rateActive.reduce((s, p) => s + Number(p.notional), 0);
  const expiries = [...active.map((h) => h.position.expiry), ...rateActive.map((p) => p.expiry)];
  const next = expiries.length ? Math.min(...expiries) : null;
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
            <div><div className="k">{hint("Protected exposure")}</div><div className="v num">${fmt(exposure, 0)}</div></div>
            <div><div className="k">{hint("Active protections")}</div><div className="v num">{active.length + rateActive.length}</div></div>
            <div><div className="k">{hint("Next expiry")}</div><div className="v num">{next ? `${daysLeft(next)} days` : '-'}</div>{next && <div className="s">{dateOf(next)}</div>}</div>
          </div>
        </div>

        <div className="bx-card">
          <div className="bx-card-h" style={{ flexWrap: 'wrap' }}><h2>Your protections</h2><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><AssetClassTabs small value={protClass} onChange={setProtClass} /><button className="bx-link" onClick={() => go('h-protections')}>View all</button></div></div>
          {protClass === 'ir' ? <RateProtections go={go} embedded /> : hedges.isLoading ? <Loading /> : !active.length ? (
            <div className="bx-empty">Nothing protected yet. <button className="bx-link" onClick={() => go('h-protect')}>Protect an exposure</button></div>
          ) : (
            <>
              <div className="bx-list-h" style={cols}><span>{hint("Exposure")}</span><span className="r">{hint("Protected")}</span><span className="r">{hint("Expires")}</span><span className="r">{hint("Payout today")}</span></div>
              {active.map(({ position: p, pair, settlement: s }) => (
                <div key={s.position} className="bx-li click" style={cols} onClick={() => go('pair', { pair, position: markKey(p) })}>
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
          <div className="bx-card-h"><h2>Rates</h2><button className="bx-link" onClick={() => go('h-rates', { rates: ratesClass })}>All rates</button></div>
          <div style={{ marginBottom: 8 }}><AssetClassTabs small value={ratesClass} onChange={setRatesClass} /></div>
          {ratesClass === 'fx' ? (watch.isLoading ? <Loading /> : watchRows.map((r) => (
            <div key={r.pair} className="bx-mini" style={{ cursor: 'pointer' }} onClick={() => go('pair', { pair: r.pair })}>
              <Flag pair={r.pair} />
              <div className="grow"><div className="t">{r.pair}</div><div className="d">{pairName(r.pair)}</div></div>
              <div style={{ textAlign: 'right' }}><div className="num t">{r.spot ? fmtRate(r.spot) : '-'}</div><div style={{ fontSize: 12 }}><ChangeText change={r.change} /></div></div>
            </div>
          ))) : benchmarks.isLoading ? <Loading /> : !(benchmarks.data ?? []).length ? <div className="bx-empty">No benchmarks yet.</div> : (benchmarks.data ?? []).map((b) => (
            <div key={b.id} className="bx-mini" style={{ cursor: 'pointer' }} role="button" tabIndex={0} aria-label={`Open ${b.id}`}
              onClick={() => go('h-rates', { rates: 'ir', benchmark: b.id })}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('h-rates', { rates: 'ir', benchmark: b.id }); } }}>
              <span className="bx-ic"><Percent aria-hidden="true" /></span>
              <div className="grow"><div className="t">{b.id}</div><div className="d">{kindLabel(b)}</div></div>
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
  const [assetClass, setAssetClass] = useAssetClass();
  return (
    <div className="bx-card">
      <div className="bx-card-h" style={{ flexWrap: 'wrap' }}><h2>Available cover</h2><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><AssetClassTabs small value={assetClass} onChange={setAssetClass} /><button className="bx-link" onClick={() => go('h-markets')}>All markets</button></div></div>
      {assetClass === 'ir' ? <RateMarkets go={go} embedded limit={5} /> : pools.isLoading ? <Loading /> : !open.length ? <div className="bx-empty">No cover is on sale right now.</div> : (
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

/** Decimal places that keep neighbouring axis labels distinct for a given step. */
function decimalsFor(step: number) {
  if (!(step > 0)) return 2;
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
}

const fmtAxis = (v: number, dp: number) => v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

function fmtWhen(t: string) {
  const d = new Date(t.length === 10 ? `${t}T12:00:00Z` : t);
  if (Number.isNaN(d.getTime())) return t;
  return t.length === 10
    ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** A position drawn on a pair's chart. `pay`: where a hedger is paid. `risk`: where an underwriter pays. */
export interface ChartMark {
  key: string;
  label: string;
  tone: 'pay' | 'risk';
  strike: number;
  cap: number | null;
  /** The rate when the position was opened. */
  entry?: number;
  /** Unix seconds: opened and expiry. */
  from?: number;
  to?: number;
}

const toSec = (t: string) => Date.parse(t.length === 10 ? `${t}T12:00:00Z` : t) / 1000;
const shortDay = (sec: number) => new Date(sec * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * Price chart in the classic wallet's style: scaled to the price itself so small moves show,
 * the axis on the right, a BlockFinaX watermark behind the line, and a readout on hover.
 *
 * Positions are drawn on top. The focused one shows its strike, cap, the band where it pays
 * (green for a hedger, red for an underwriter), the rate it was opened at, when it was opened
 * and when it expires; the rest show a faint strike line. Strikes and caps far from the price
 * never stretch the scale; they are pinned to the edge as tags so the history keeps its shape.
 */
function RateChart({ points, loading, strike, cap, label, unit, marks = [], focus, fit = false }: {
  points: { t: string; v: number }[]; loading: boolean; strike: number | null; cap: number | null; label?: string; unit?: string;
  marks?: ChartMark[]; focus?: string | null;
  /** Fit the focused position's strike and cap into the scale, even when far from the price. */
  fit?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) {
    return <div className="bx-chart"><div className="bx-empty">{loading ? 'Loading chart...' : 'Not enough data for this range yet.'}</div></div>;
  }
  const VW = 800, VH = 260, PL = 8, PR = 72, PT = 14, PB = 14;
  const iw = VW - PL - PR, ih = VH - PT - PB;
  const values = points.map((p) => p.v);
  const dLo = Math.min(...values), dHi = Math.max(...values);
  const span = dHi - dLo || Math.abs(dHi) * 0.01;
  const focused = marks.find((m) => m.key === focus) ?? (focus === undefined && marks.length === 1 ? marks[0] : null);
  // Levels count toward the scale only when they sit close to where the price has been.
  const near = (v: number | null | undefined, k = 0.6) => v !== null && v !== undefined && Number.isFinite(v) && v >= dLo - span * k && v <= dHi + span * k;
  const pull = fit && focused
    ? ([focused.strike, focused.cap, focused.entry].filter((v) => v !== null && v !== undefined && Number.isFinite(v)) as number[])
    : ([strike, focused?.strike, focused?.entry].filter((v) => near(v, focused ? 1.5 : 0.6)) as number[]);
  const lo0 = Math.min(dLo, ...pull), hi0 = Math.max(dHi, ...pull);
  const pad = (hi0 - lo0) * 0.12 || Math.abs(hi0) * 0.002 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  const x = (i: number) => PL + (i / (values.length - 1)) * iw;
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * ih;
  const clampY = (v: number) => Math.min(PT + ih, Math.max(PT, y(v)));
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(values.length - 1).toFixed(1)} ${PT + ih} L${PL} ${PT + ih} Z`;
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * k) / 4);
  const dp = decimalsFor((hi - lo) / 4);
  const rising = values[values.length - 1] >= values[0];
  const stroke = '#1f5fe0';
  const t0 = toSec(points[0].t), t1 = toSec(points[points.length - 1].t);
  const xAt = (sec: number) => (sec < t0 || sec > t1 ? null : PL + ((sec - t0) / Math.max(1, t1 - t0)) * iw);

  const inside = (v: number | null | undefined) => v !== null && v !== undefined && Number.isFinite(v) && v >= lo && v <= hi;
  const edgeTag = (v: number | null | undefined, name: string, slot = 0) => {
    if (v === null || v === undefined || !Number.isFinite(v) || inside(v)) return null;
    const above = v > hi;
    return (
      <span key={name} className="bx-strike-tag" style={above ? { top: 4 + slot * 24 } : { bottom: 4 + slot * 24 }}>
        {name} {fmtAxis(v, dp)} {above ? '↑' : '↓'}
      </span>
    );
  };

  const onMove = (clientX: number, el: SVGSVGElement) => {
    const box = el.getBoundingClientRect();
    if (!box.width) return;
    const vx = ((clientX - box.left) / box.width) * VW;
    const i = Math.round(((vx - PL) / iw) * (values.length - 1));
    setHover(Math.max(0, Math.min(values.length - 1, i)));
  };
  const h = hover === null ? null : points[hover];
  const zone = focused?.tone === 'risk' ? '#e23b57' : '#12a05a';
  const fx = focused?.from !== undefined ? xAt(focused.from) : null;
  const tx = focused?.to !== undefined ? xAt(focused.to) : null;

  return (
    <div className="bx-chart">
      {h && (
        <div className="bx-chart-read">
          <span className="num" style={{ fontWeight: 600 }}>{fmtAxis(h.v, Math.max(dp, 2))}{unit ? ` ${unit}` : ''}</span>
          <span className="muted">{fmtWhen(h.t)}</span>
        </div>
      )}
      <svg
        role="img" aria-label={`${label ?? 'Rate'} over the selected period, ${rising ? 'rising' : 'falling'}${focused ? `, with ${focused.label} marked` : ''}`}
        viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" style={{ touchAction: 'pan-y' }}
        onMouseMove={(e) => onMove(e.clientX, e.currentTarget)} onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => e.touches[0] && onMove(e.touches[0].clientX, e.currentTarget)}
        onTouchMove={(e) => e.touches[0] && onMove(e.touches[0].clientX, e.currentTarget)}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          <linearGradient id="bx-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v, k) => (
          <line key={k} x1={PL} y1={y(v)} x2={VW - PR} y2={y(v)} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        ))}
        {/* The focused position's band: where it pays (hedger) or where the pool pays (underwriter). */}
        {focused && (() => {
          const top = clampY(Math.max(focused.strike, focused.cap ?? (focused.strike > (focused.entry ?? focused.strike) ? hi : lo)));
          const bot = clampY(Math.min(focused.strike, focused.cap ?? (focused.strike > (focused.entry ?? focused.strike) ? hi : lo)));
          const left = fx ?? PL;
          return <rect x={left} y={top} width={Math.max(0, VW - PR - left)} height={Math.max(0, bot - top)} fill={zone} opacity="0.1" />;
        })()}
        <path d={area} fill="url(#bx-chart-fill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {/* Other positions: a faint strike line each. */}
        {marks.filter((m) => m !== focused && inside(m.strike)).map((m) => (
          <line key={m.key} x1={PL} y1={y(m.strike)} x2={VW - PR} y2={y(m.strike)} stroke={m.tone === 'risk' ? '#e23b57' : '#12a05a'} strokeWidth="1" strokeDasharray="2 6" opacity="0.5" vectorEffect="non-scaling-stroke" />
        ))}
        {focused && inside(focused.cap) && <line x1={PL} y1={y(focused.cap!)} x2={VW - PR} y2={y(focused.cap!)} stroke={zone} strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />}
        {focused && inside(focused.entry) && <line x1={PL} y1={y(focused.entry!)} x2={VW - PR} y2={y(focused.entry!)} stroke="#9aa2af" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />}
        {focused && inside(focused.strike) && <line x1={PL} y1={y(focused.strike)} x2={VW - PR} y2={y(focused.strike)} stroke="#e0a03a" strokeWidth="1.6" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
        {fx !== null && <line x1={fx} y1={PT} x2={fx} y2={PT + ih} stroke="#9aa2af" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        {tx !== null && <line x1={tx} y1={PT} x2={tx} y2={PT + ih} stroke={zone} strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        {inside(cap) && <line x1={PL} y1={y(cap!)} x2={VW - PR} y2={y(cap!)} stroke="#9aa2af" strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />}
        {inside(strike) && <line x1={PL} y1={y(strike!)} x2={VW - PR} y2={y(strike!)} stroke="#e0a03a" strokeWidth="1.5" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} y1={PT} x2={x(hover)} y2={PT + ih} stroke="#9aa2af" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          </g>
        )}
      </svg>
      {/* HTML overlays: crisp text and round dots, unaffected by the stretched viewBox. */}
      <div className="bx-chart-mark" aria-hidden="true">
        <div className="b">BlockFinaX</div>
        {label && <div className="s">{label} · blockfinax.com</div>}
      </div>
      <div className="bx-chart-axis" aria-hidden="true">
        {ticks.map((v, k) => <span key={k} style={{ top: `${(y(v) / VH) * 100}%` }}>{fmtAxis(v, dp)}</span>)}
      </div>
      <span className="bx-chart-dot" style={{ left: `${(x(hover ?? values.length - 1) / VW) * 100}%`, top: `${(y(values[hover ?? values.length - 1]) / VH) * 100}%` }} />
      {inside(strike) && <span className="bx-strike-tag" style={{ top: `calc(${(y(strike!) / VH) * 100}% - 22px)`, right: 76 }}>Strike {fmtAxis(strike!, dp)}</span>}
      {edgeTag(strike, 'Strike')}
      {focused && inside(focused.strike) && <span className="bx-strike-tag" style={{ top: `calc(${(y(focused.strike) / VH) * 100}% - 22px)`, right: 76 }}>Strike {fmtAxis(focused.strike, dp)}</span>}
      {focused && inside(focused.cap) && <span className="bx-level-tag" style={{ top: `calc(${(y(focused.cap!) / VH) * 100}% - 22px)`, right: 76, color: zone }}>{focused.tone === 'risk' ? 'Max you pay' : 'Max payout'} {fmtAxis(focused.cap!, dp)}</span>}
      {focused && inside(focused.entry) && <span className="bx-level-tag" style={{ top: `calc(${(y(focused.entry!) / VH) * 100}% + 4px)`, left: 8 }}>{focused.tone === 'risk' ? 'Backed at' : 'Bought at'} {fmtAxis(focused.entry!, dp)}</span>}
      {focused && (() => {
        // Off-chart levels are stacked in value order, so the higher one is shown higher.
        const levels = [{ v: focused.strike, n: 'Strike' }, { v: focused.cap, n: focused.tone === 'risk' ? 'Max you pay' : 'Max payout' }]
          .filter((l) => l.v !== null && Number.isFinite(l.v as number) && !inside(l.v));
        const above = levels.filter((l) => (l.v as number) > hi).sort((a, b) => (b.v as number) - (a.v as number));
        const below = levels.filter((l) => (l.v as number) < lo).sort((a, b) => (a.v as number) - (b.v as number));
        return [...above.map((l, i) => edgeTag(l.v, l.n, i)), ...below.map((l, i) => edgeTag(l.v, l.n, i))];
      })()}
      {focused && fx !== null && <span className="bx-level-tag" style={{ bottom: 2, left: `calc(${(fx / VW) * 100}% + 4px)` }}>{focused.tone === 'risk' ? 'Backed' : 'Bought'} {shortDay(focused.from!)}</span>}
      {focused?.to !== undefined && (tx !== null
        ? <span className="bx-level-tag" style={{ bottom: 2, left: `calc(${(tx / VW) * 100}% + 4px)`, color: zone }}>Expires {shortDay(focused.to)}</span>
        : focused.to > t1 && <span className="bx-level-tag" style={{ bottom: 2, right: 76, color: zone }}>Expires {shortDay(focused.to)} →</span>)}
    </div>
  );
}

// ── Pair page: one pair's chart with your positions on it ───────────────────

/** A hedger's protection as a chart mark: the band where it pays them. */
export function hedgeMark(p: ProtectionPosition, label: string): ChartMark {
  return { key: `${p.ref.chain}:${p.ref.contract}:${p.ref.id}`, label, tone: 'pay', strike: Number(p.strike), cap: Number(p.cap), entry: Number(p.spot), from: p.createdAt, to: p.expiry };
}

/** The same protection seen by an underwriter: the band where their pool pays. */
export function riskMark(p: ProtectionPosition, label: string): ChartMark {
  return { ...hedgeMark(p, label), tone: 'risk' };
}

const markKey = (p: ProtectionPosition) => `${p.ref.chain}:${p.ref.contract}:${p.ref.id}`;
const POS_COLS = { gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(0, 1fr))' };

type Stake = { value: string; account?: { reserved: string } };

/** Protections backed by pools of this pair where the signed-in user has money. */
function useUnderwrittenOn(pair: string, enabled: boolean) {
  const pools = usePools();
  const ofPair = (pools.data ?? []).filter((p) => p.pair === pair);
  const stakes = useQueries({ queries: ofPair.map((p) => ({ queryKey: ['v2-lp', poolRef(p)], enabled, queryFn: () => api<Stake>(`/api/v2/pools/${encodeURIComponent(poolRef(p))}/lp`) })) });
  const mine = ofPair.filter((_, i) => Number(stakes[i].data?.value ?? 0) > 0 || Number(stakes[i].data?.account?.reserved ?? 0) > 0);
  const positions = useQueries({ queries: mine.map((p) => ({ queryKey: ['v2-pool-positions', poolRef(p)], enabled, queryFn: async () => (await api<{ positions: ProtectionPosition[] }>(`/api/v2/pools/${encodeURIComponent(poolRef(p))}/positions`)).positions })) });
  return { pools: mine, rows: mine.flatMap((pool, i) => (positions[i].data ?? []).map((pos) => ({ pool, pos }))), loading: pools.isLoading || stakes.some((q) => q.isLoading) };
}

/**
 * What a protection pays at each possible rate at expiry, with the contract's formula:
 * rising cover pays amount x (min(rate, cap) - strike) / rate when bought; falling cover the mirror.
 * Hedgers see the payout and, dashed, the result after the premium they paid; underwriters see
 * the same curve as what their pool pays, and the premium they earned.
 */
function PayoffChart({ pos, spot, tone, ccy }: { pos: ProtectionPosition; spot: number | null; tone: 'pay' | 'risk'; ccy: string }) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const up = pos.direction === 'up';
  const n = Number(pos.notional), k = Number(pos.strike), c = Number(pos.cap), entry = Number(pos.spot);
  const cost = Number(pos.premium) + Number(pos.fee);
  const payout = (r: number) => Math.max(0, up ? Math.min(r, c) - k : k - Math.max(r, c)) * n / entry;
  const max = payout(up ? c : c);
  // Rates from a little before the protection to a little past the cap, including today's rate.
  const width = Math.abs(c - k) || k * 0.05;
  const ends = [k, c, ...(spot ? [spot] : []), entry];
  const r0 = Math.min(...ends) - width * 0.25, r1 = Math.max(...ends) + width * 0.25;
  const VW = 800, VH = 220, PL = 8, PR = 80, PT = 16, PB = 26;
  const iw = VW - PL - PR, ih = VH - PT - PB;
  const yMax = Math.max(max, cost) * 1.1 || 1;
  const yMin = tone === 'pay' ? -cost * 1.3 : 0;
  const x = (r: number) => PL + ((r - r0) / (r1 - r0)) * iw;
  const y = (v: number) => PT + (1 - (v - yMin) / (yMax - yMin)) * ih;
  const xs = Array.from({ length: 121 }, (_, i) => r0 + ((r1 - r0) * i) / 120);
  const curve = xs.map((r, i) => `${i ? 'L' : 'M'}${x(r).toFixed(1)} ${y(payout(r)).toFixed(1)}`).join(' ');
  const net = xs.map((r, i) => `${i ? 'L' : 'M'}${x(r).toFixed(1)} ${y(payout(r) - cost).toFixed(1)}`).join(' ');
  const color = tone === 'risk' ? '#e23b57' : '#12a05a';
  const dp = r1 - r0 < 1 ? 4 : r1 - r0 < 50 ? 2 : 0;
  const breakeven = up ? k + (cost * entry) / n : k - (cost * entry) / n;
  const today = spot ? payout(spot) : null;
  const hr = hoverX === null ? null : r0 + ((hoverX - PL) / iw) * (r1 - r0);
  const onMove = (clientX: number, el: SVGSVGElement) => {
    const box = el.getBoundingClientRect();
    if (!box.width) return;
    setHoverX(Math.min(PL + iw, Math.max(PL, ((clientX - box.left) / box.width) * VW)));
  };
  const pctX = (r: number) => `${(x(r) / VW) * 100}%`;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>{tone === 'pay' ? 'What this protection pays at expiry' : 'What your pool pays at expiry'}</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {hr !== null
            ? <>At {fmtRate(hr)} {ccy}: <b className="num" style={{ color }}>${fmt(payout(hr))}</b>{tone === 'pay' ? <> · after premium <b className="num">{payout(hr) - cost >= 0 ? '+' : ''}${fmt(payout(hr) - cost)}</b></> : null}</>
            : today !== null ? <>If it ended today: <b className="num" style={{ color }}>${fmt(today)}</b></> : null}
        </span>
      </div>
      <div className="bx-chart" style={{ height: 220, marginTop: 10 }}>
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" role="img" aria-label={`Payout from $0 below ${fmtRate(k)} to $${fmt(max)} at ${fmtRate(c)} ${ccy}`}
          onMouseMove={(e) => onMove(e.clientX, e.currentTarget)} onMouseLeave={() => setHoverX(null)}
          onTouchStart={(e) => e.touches[0] && onMove(e.touches[0].clientX, e.currentTarget)} onTouchMove={(e) => e.touches[0] && onMove(e.touches[0].clientX, e.currentTarget)} onTouchEnd={() => setHoverX(null)}>
          <line x1={PL} y1={y(0)} x2={VW - PR} y2={y(0)} stroke="var(--line-2)" vectorEffect="non-scaling-stroke" />
          <rect x={Math.min(x(k), x(c))} y={PT} width={Math.abs(x(c) - x(k))} height={ih} fill={color} opacity="0.07" />
          <path d={`${curve} L${x(r1)} ${y(0)} L${x(r0)} ${y(0)} Z`} fill={color} opacity="0.12" />
          <path d={curve} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {tone === 'pay' && <path d={net} fill="none" stroke="var(--muted)" strokeWidth="1.3" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />}
          <line x1={x(k)} y1={PT} x2={x(k)} y2={PT + ih} stroke="#e0a03a" strokeWidth="1.4" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
          <line x1={x(c)} y1={PT} x2={x(c)} y2={PT + ih} stroke={color} strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          {spot && <line x1={x(spot)} y1={PT} x2={x(spot)} y2={PT + ih} stroke="#1f5fe0" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />}
          {hoverX !== null && <line x1={hoverX} y1={PT} x2={hoverX} y2={PT + ih} stroke="#9aa2af" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className="bx-level-tag" style={{ top: `${(y(max) / VH) * 100}%`, right: 0, transform: 'translateY(-50%)', color }}>${fmt(max, 0)}</span>
        <span className="bx-level-tag" style={{ top: `${(y(0) / VH) * 100}%`, right: 0, transform: 'translateY(-50%)' }}>$0</span>
        {tone === 'pay' && <span className="bx-level-tag" style={{ top: `${(y(-cost) / VH) * 100}%`, right: 0, transform: 'translateY(-50%)' }}>-${fmt(cost, 0)}</span>}
        <span className="bx-level-tag" style={{ bottom: 0, left: pctX(k), transform: 'translateX(-50%)', color: '#c58312' }}>Strike {fmtRate(k)}</span>
        <span className="bx-level-tag" style={{ bottom: 0, left: pctX(c), transform: 'translateX(-50%)', color }}>{tone === 'pay' ? 'Max payout' : 'Max you pay'} {fmtRate(c)}</span>
        {spot && <span className="bx-level-tag" style={{ top: 0, left: pctX(spot), transform: 'translateX(-50%)', color: '#1f5fe0' }}>Today {fmtRate(spot)}</span>}
      </div>
      <div className="bx-legend" style={{ marginTop: 8 }}>
        <span><i style={{ background: color }} />{tone === 'pay' ? 'Payout' : 'Your pool pays'}</span>
        {tone === 'pay' && <span><i style={{ background: 'var(--muted)' }} />After premium (breaks even at {fmtRate(breakeven)})</span>}
        <span><i style={{ background: '#1f5fe0' }} />Today's rate</span>
        {tone === 'risk' && <span>Premium earned by underwriters: ${fmt(Number(pos.premium))}</span>}
      </div>
    </div>
  );
}

export function PairPage({ go, pair, role, focus: initialFocus }: { go: Go; pair: string; role: 'hedger' | 'underwriter'; focus?: string }) {
  const [range, setRange] = useState<Range>('1M');
  const chart = useChart(pair, range);
  const spot = useSpot(pair);
  const hedges = useHedges();
  const under = useUnderwrittenOn(pair, role === 'underwriter');
  const [focus, setFocus] = useState<string | null>(initialFocus ?? null);
  const [fit, setFit] = useState(false);
  useEffect(() => { if (initialFocus) setFocus(initialFocus); }, [initialFocus]);
  const ccy = quoteCcy(pair);
  const points = chart.data ?? [];
  const periodChange = points.length >= 2 ? (range.endsWith('H') && spot.data ? spot.data : points[points.length - 1].v) / points[0].v - 1 : null;

  const mineHedges = (hedges.data ?? []).filter((h) => h.pair === pair);
  const marks: ChartMark[] = role === 'hedger'
    ? mineHedges.map((h) => hedgeMark(h.position, exposureLabel(pair, h.position.direction).title))
    : under.rows.map(({ pool, pos }) => riskMark(pos, exposureLabel(pair, pool.direction === 'both' ? pos.direction : pool.direction).cover));
  const activeKeys = role === 'hedger'
    ? mineHedges.filter((h) => h.settlement.status === 'pending').map((h) => markKey(h.position))
    : under.rows.map((r) => markKey(r.pos));
  useEffect(() => { if (!focus && activeKeys[0]) setFocus(activeKeys[0]); }, [activeKeys.join(',')]);
  const allPositions = role === 'hedger' ? mineHedges.map((h) => h.position) : under.rows.map((r) => r.pos);
  const focusedPos = allPositions.find((p) => markKey(p) === focus) ?? null;

  return (
    <main className="bx-main">
      <section className="bx-full">
        <div className="bx-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <Flag pair={pair} large />
            <div><div style={{ fontSize: 22, fontWeight: 600 }}>{ccyName(pair)}</div><div className="muted">{pair}</div></div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {role === 'hedger'
                ? <button className="bx-btn" onClick={() => go('h-protect', { pair })}>Protect</button>
                : <button className="bx-btn" onClick={() => go('u-pools')}>Provide liquidity</button>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
            <span className="num" style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em' }}>{spot.data ? fmtRate(spot.data) : '...'}</span>
            <span className="muted">{ccy} per 1 USD</span>
            <ChangeText change={periodChange} /><span className="muted" style={{ fontSize: 13 }}>{range === 'MAX' ? 'all time' : range === 'YTD' ? 'this year' : range}</span>
          </div>
          <RateChart points={points} loading={chart.isLoading} strike={null} cap={null} label={`${pair} · ${range}`} unit={ccy} marks={marks} focus={focus} fit={fit} />
          <div className="bx-ranges" role="group" aria-label="Chart range">
            {RANGES.map((r) => <button key={r} className={range === r ? 'on' : ''} aria-pressed={range === r} onClick={() => setRange(r)}>{r}</button>)}
          </div>
          {marks.length > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13 }}>
              <Toggle on={fit} onChange={setFit} label="Show full protection" /> Show full protection (zoom out to the strike and cap)
            </label>
          )}
          {marks.length > 0 && (
            <div className="bx-legend">
              <span><i style={{ background: '#e0a03a' }} />Strike</span>
              <span><i style={{ background: role === 'hedger' ? '#12a05a' : '#e23b57', opacity: 0.35 }} />{role === 'hedger' ? 'Where you get paid' : 'Where your pool pays'}</span>
              <span><i style={{ background: '#9aa2af' }} />{role === 'hedger' ? 'Bought' : 'Backed'}</span>
            </div>
          )}
        </div>

        {focusedPos && (
          <div className="bx-card">
            <PayoffChart pos={focusedPos} spot={spot.data ?? null} tone={role === 'hedger' ? 'pay' : 'risk'} ccy={ccy} />
          </div>
        )}

        <div className="bx-card">
          <div className="bx-card-h"><div><h2>{role === 'hedger' ? 'Your protections on this pair' : 'Protection your pools back on this pair'}</h2><div className="sub">Select one to show it on the chart.</div></div></div>
          {(role === 'hedger' ? hedges.isLoading : under.loading) ? <Loading /> : marks.length === 0 ? (
            <div className="bx-empty">{role === 'hedger' ? 'You have no protection on this pair.' : 'Your pools have no running protection on this pair.'}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 600 }}>
              <div className="bx-list-h" style={POS_COLS}><span>{hint('Protection')}</span><span className="r">{hint('Protected')}</span><span className="r">{hint('Strike')}</span><span className="r">{hint('Expires')}</span></div>
              {(role === 'hedger' ? mineHedges.map((h) => ({ pos: h.position, title: `${exposureLabel(pair, h.position.direction).title} · ${h.position.structure === 'open' ? 'Open' : 'Capped'}`, status: h.settlement.status }))
                : under.rows.map(({ pool, pos }) => ({ pos, title: `${exposureLabel(pair, pool.direction === 'both' ? pos.direction : pool.direction).cover} · pool ${pool.poolId}${pool.legacy ? ' (earlier contract)' : ''}`, status: 'pending' }))
              ).map(({ pos, title, status }) => {
                const k = markKey(pos);
                return (
                  <div key={k} className={`bx-li click${focus === k ? ' sel' : ''}`} style={POS_COLS} role="button" tabIndex={0} aria-pressed={focus === k}
                    onClick={() => setFocus(k)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocus(k); } }}>
                    <div className="bx-who"><span className="bx-ic" style={{ color: role === 'hedger' ? 'var(--green)' : 'var(--red)' }}><Shield aria-hidden="true" /></span>
                      <div style={{ minWidth: 0 }}><div className="t">{title}</div><div className="d">{role === 'hedger' ? 'Bought' : 'Sold'} at {fmtRate(pos.spot)} · covered to {fmtRate(pos.cap)} {ccy}</div></div></div>
                    <div className="r num" style={{ fontWeight: 600 }}>${fmt(pos.notional, 0)}</div>
                    <div className="r num">{fmtRate(pos.strike)}</div>
                    <div className="r"><div className="num">{dateOf(pos.expiry)}</div><div style={{ fontSize: 12 }}>{status === 'pending' ? <span className="up">Active</span> : <span className="muted">Ended</span>}</div></div>
                  </div>
                );
              })}
            </div></div>
          )}
        </div>
      </section>
    </main>
  );
}

export function ProtectPage({ go, pair: initialPair, target }: { go: Go; pair: string | null; target?: Target }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pools = usePools();
  const hedgesAll = useHedges();
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
  // The strike, typed either as a % from today's rate or as a rate. Whichever the user typed
  // last stays fixed when the live rate moves; the other follows.
  const [pctText, setPctText] = useState('2');
  const [rateText, setRateText] = useState('');
  const [anchor, setAnchor] = useState<'pct' | 'rate'>('pct');
  const rateDp = (v: number) => (v >= 100 ? 2 : 4);
  const rateFromPct = (pctV: number) => (spot.data ? spot.data * (1 + (sign * pctV) / 100) : null);
  const pctFromRate = (r: number) => (spot.data ? (sign * (r / spot.data - 1)) * 100 : null);
  useEffect(() => {
    if (!spot.data) return;
    if (anchor === 'pct') {
      const r = rateFromPct(Number(pctText));
      if (r && Number.isFinite(r)) setRateText(r.toFixed(rateDp(r)));
    } else {
      const v = pctFromRate(Number(rateText));
      if (v !== null && Number.isFinite(v)) setPctText(String(Math.round(v * 100) / 100));
    }
  }, [spot.data, direction]);
  // A pool's closest strike may be further than the current entry: move up to it.
  useEffect(() => { if (Number(pctText) < minStartPct) choosePct(minStartPct); }, [minStartPct]);
  function choosePct(v: number) {
    setAnchor('pct');
    setPctText(String(v));
    const r = rateFromPct(v);
    if (r) setRateText(r.toFixed(rateDp(r)));
  }
  function typePct(text: string) {
    const clean = text.replace(/[^0-9.]/g, '');
    setAnchor('pct');
    setPctText(clean);
    const r = rateFromPct(Number(clean));
    if (clean !== '' && r && Number.isFinite(r)) setRateText(r.toFixed(rateDp(r)));
  }
  function typeRate(text: string) {
    const clean = text.replace(/[^0-9.]/g, '');
    setAnchor('rate');
    setRateText(clean);
    const v = pctFromRate(Number(clean));
    if (clean !== '' && v !== null && Number.isFinite(v)) setPctText(String(Math.round(v * 100) / 100));
  }
  const startPct = Number(pctText);
  // The contracts accept a strike between today's rate and 2x (rising) or 0.5x (falling) it.
  const maxStartPct = direction === 'up' ? 99 : 49;
  const strikeError = !spot.data ? null
    : pctText === '' || rateText === '' ? 'Enter a strike'
    : !Number.isFinite(startPct) ? 'Enter a number'
    : startPct < 0 ? `The strike must be ${direction === 'up' ? 'above' : 'below'} today's rate for this cover`
    : startPct < minStartPct ? `This pool's closest strike is ${minStartPct}% from today's rate`
    : startPct > maxStartPct ? `The strike can be at most ${maxStartPct}% from today's rate`
    : null;
  const [capPct, setCapPct] = useState(10);
  useEffect(() => { setCapPct((c) => Math.min(Math.max(c, capMin), capMax)); }, [capMin, capMax]);
  const [structure, setStructure] = useState<'capped' | 'open'>('capped');
  useEffect(() => { if (tenor && !tenor[structure]) setStructure(tenor.capped ? 'capped' : 'open'); }, [tenor, structure]);
  const strike = spot.data && !strikeError ? (anchor === 'rate' ? Number(rateText) : spot.data * (1 + (sign * startPct) / 100)) : null;
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
          <RateChart points={points} loading={chart.isLoading} strike={strike} cap={structure === 'capped' ? cap : null} label={`${pair} · ${range}`} unit={ccy}
            marks={(hedgesAll.data ?? []).filter((h) => h.pair === pair && h.settlement.status === 'pending').map((h) => hedgeMark(h.position, exposureLabel(pair, h.position.direction).title))} focus={null} />
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
                <span className="bx-label">{hint("How long")}</span>
                <div className="bx-pills wrap">
                  {tenorList.map((t) => <button key={t.tenorDays} className={`bx-pill${t.tenorDays === days ? ' on' : ''}`} onClick={() => setDays(t.tenorDays)}>{t.tenorDays} days</button>)}
                </div>
                {days && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Ends {dateIn(days)}</div>}
              </div>
              <div>
                <span className="bx-label">{hint("Protection starts")}</span>
                <div className="bx-strike-in">
                  <label className="bx-field" style={{ margin: 0 }}>
                    <span>% from today's rate</span>
                    <span className="bx-input-unit"><input className="bx-input num" inputMode="decimal" aria-label="Strike, percent from today's rate" value={pctText} onChange={(ev) => typePct(ev.target.value)} /><span>%</span></span>
                  </label>
                  <label className="bx-field" style={{ margin: 0 }}>
                    <span>Strike rate</span>
                    <span className="bx-input-unit"><input className="bx-input num" inputMode="decimal" aria-label={`Strike rate, ${ccy} per USD`} value={rateText} onChange={(ev) => typeRate(ev.target.value)} /><span>{ccy}</span></span>
                  </label>
                </div>
                <div className="bx-pills" style={{ marginTop: 8 }}>
                  {startChoices.map((m) => <button key={m} className={`bx-pill${startPct === m ? ' on' : ''}`} onClick={() => choosePct(m)}>{m === 0 ? "Today's rate" : `${m}%`}</button>)}
                </div>
                {!spot.data ? null : strikeError
                  ? <div className="bx-error" style={{ marginTop: 6 }}>{strikeError}</div>
                  : <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Pays if the rate {direction === 'up' ? 'rises above' : 'falls below'} {fmtRate(strike ?? 0)} {ccy}. Further away costs less.</div>}
              </div>
              <div>
                <span className="bx-label">{hint("Cover type")}</span>
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
  const [assetClass, setAssetClass] = useAssetClass();
  return (
    <main className="bx-main">
      <section className="bx-full">
        <AssetClassTabs value={assetClass} onChange={setAssetClass} />
        {assetClass === 'ir' ? <RateProtections go={go} /> : <div className="bx-card">
          <div className="bx-card-h"><h2>{SHOW_INTEREST_RATES ? 'FX protections' : 'My protections'}</h2><button className="bx-btn small" onClick={() => go('h-protect')}>Protect an exposure</button></div>
          {hedges.isLoading ? <Loading /> : !all.length ? <div className="bx-empty">You have not bought protection yet.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 720 }}>
                <div className="bx-list-h" style={cols}><span>{hint("Exposure")}</span><span className="r">{hint("Protected")}</span><span className="r">{hint("Expiry")}</span><span className="r">{hint("Payout")}</span><span className="r">{hint("Status")}</span></div>
                {all.map(({ position: p, pair, settlement: s }) => {
                  const active = s.status === 'pending';
                  const payout = active ? payoutToday(p, spotOf(pair)) : Number(s.netPayout);
                  return (
                    <div key={s.position} className="bx-li click" style={cols} role="button" tabIndex={0} onClick={() => go('pair', { pair, position: markKey(p) })} onKeyDown={(e) => { if (e.key === 'Enter') go('pair', { pair, position: markKey(p) }); }}>
                      <div className="bx-who"><Flag pair={pair} /><div style={{ minWidth: 0 }}><div className="t">{exposureLabel(pair, p.direction).title} · {p.structure === 'open' ? 'Open' : 'Capped'}</div><div className="d">From {fmtRate(p.strike)}{p.structure === 'capped' ? ` to ${fmtRate(p.cap)}` : ''} {quoteCcy(pair)}</div></div></div>
                      <div className="r num" style={{ fontWeight: 600 }}>${fmt(p.notional, 0)}</div>
                      <div className="r"><div className="num">{dateOf(p.expiry)}</div><div className="muted" style={{ fontSize: 12 }}>{active ? `${daysLeft(p.expiry)} days` : 'ended'}</div></div>
                      <div className="r num" style={{ fontWeight: 600 }}>${fmt(payout ?? 0)}<div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{active ? 'if it ended today' : ''}</div></div>
                      <div className="r">
                        {active ? <Tag tone="green">Active</Tag> : s.status === 'settled_claimable'
                          ? <button className="bx-btn small" disabled={busy === s.position} onClick={(e) => { e.stopPropagation(); claim(s.position); }}>{busy === s.position ? <Spin /> : 'Receive payout'}</button>
                          : s.status === 'claimed' ? <Tag tone="grey">Paid</Tag> : <Tag tone="grey">Expired</Tag>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>}
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
  type: string; decimals: number;
  expected: { observationDate: string; expectedAt: string }; latest: Fixing | null; previous: Fixing | null; notice?: string;
};
type BenchmarkDetail = BenchmarkRow & {
  registry: { website?: string; publicationTime?: string; timeZone: string; dayCountBasis: number; decimals: number; source: string; fallbackSource?: string; observationConvention: string };
};

const ADMINISTRATOR: Record<string, string> = {
  FEDERAL_RESERVE_BANK_OF_NEW_YORK: 'Federal Reserve Bank of New York', CENTRAL_BANK_OF_KENYA: 'Central Bank of Kenya',
  CENTRAL_BANK_OF_NIGERIA: 'Central Bank of Nigeria', BANK_OF_GHANA: 'Bank of Ghana', EUROPEAN_CENTRAL_BANK: 'European Central Bank',
  BANK_OF_ENGLAND: 'Bank of England',
};
const adminName = (code: string) => ADMINISTRATOR[code] ?? code;
const DECIMALS: Record<string, number> = {};
const kindLabel = (r: { type: string; currency: string }) => `${r.currency} ${r.type === 'POLICY' ? 'policy rate' : 'overnight rate'}`;
const SOURCE_NAME: Record<string, string> = {
  NEW_YORK_FED_API: 'New York Fed Markets API', NEW_YORK_FED_SEARCH: 'New York Fed Markets API (search)', CBK_KESONIA_TABLE: 'Central Bank of Kenya website',
  NEW_YORK_FED_EFFR_API: 'New York Fed Markets API', ECB_DATA_API: 'ECB Data Portal', CBN_NOFR_API: 'Central Bank of Nigeria website',
  BOG_INTERBANK_TABLE: 'Bank of Ghana website', BOG_POLICY_TABLE: 'Bank of Ghana policy rate history', CBK_CBR_TABLE: 'Central Bank of Kenya website',
  BOE_IADB_BANK_RATE: 'Bank of England database',
};
const STELLAR_TX = 'https://stellar.expert/explorer/testnet/tx/';
const isTxHash = (tx: string) => /^[0-9a-f]{64}$/.test(tx);
const dayLabel = (iso: string) => dateOf(Date.parse(`${iso}T12:00:00Z`) / 1000);
const pctText = (id: string, f: Fixing) => `${Number(f.ratePercent).toFixed(DECIMALS[id] ?? 2)}%`;

function useBenchmarks() {
  return useQuery({
    queryKey: ['v2-benchmarks'],
    enabled: SHOW_INTEREST_RATES,
    queryFn: async () => {
      const rows = (await api<{ benchmarks: BenchmarkRow[] }>('/api/v2/benchmarks')).benchmarks;
      for (const r of rows) DECIMALS[r.id] = r.decimals;
      return rows;
    },
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
        <div><h2>{SHOW_INTEREST_RATES ? 'FX rates' : 'Rates'}</h2><div className="sub">Live exchange rates for the currencies BlockFinaX customers trade in. Change is over the last 24 hours.</div></div>
        <input className="bx-input" style={{ maxWidth: 260 }} aria-label="Search FX rates" placeholder="Search currency" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {watch.isLoading ? <Loading /> : !rows.length ? <div className="bx-empty">No currency matches.</div> : (
        <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 620 }}>
          <div className="bx-list-h" style={cols}><span>Currency</span><span className="r">{hint("Rate")}</span><span className="r">{hint("Change")}</span><span /></div>
          {rows.map((r) => (
            <div key={r.pair} className="bx-li click" style={cols} role="button" tabIndex={0} onClick={() => go('pair', { pair: r.pair })} onKeyDown={(e) => { if (e.key === 'Enter') go('pair', { pair: r.pair }); }}>
              <div className="bx-who"><Flag pair={r.pair} /><div><div className="t">{pairName(r.pair)}</div><div className="d">{r.pair} · 1 {r.pair.split('/')[0]} in {quoteCcy(r.pair)}</div></div></div>
              <div className="r num" style={{ fontWeight: 600 }}>{r.spot ? fmtRate(r.spot) : '-'}</div>
              <div className="r"><ChangeText change={r.change} /></div>
              <div className="r">{covered.has(r.pair)
                ? <button className="bx-btn small" onClick={(e) => { e.stopPropagation(); go('h-protect', { pair: r.pair }); }}>Protect</button>
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
        <div><h2>Interest rates</h2><div className="sub">Official overnight rates and central bank policy rates, read from each administrator and agreed on chain by the oracle nodes. Change is against the previous business day. Select a rate for its history.</div></div>
      </div>
      {q.isLoading ? <Loading /> : q.isError ? <div className="bx-empty">Interest rates are unavailable right now.</div> : !rows.length ? <div className="bx-empty">No benchmarks are in use here yet.</div> : (
        <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 700 }}>
          <div className="bx-list-h" style={cols}><span>Benchmark</span><span className="r">{hint("Rate")}</span><span className="r">{hint("Change")}</span><span className="r">For business day</span><span className="r">{hint("Status")}</span></div>
          {rows.map((r) => (
            <div
              key={r.id} className="bx-li click" style={cols} role="button" tabIndex={0} aria-label={`Open ${r.id}`}
              onClick={() => open(r.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(r.id); } }}
            >
              <div className="bx-who"><div><div className="t">{r.id} <span className="muted" style={{ fontWeight: 400 }}>· {r.currency}</span></div><div className="d">{r.name} · {adminName(r.administrator)}</div></div></div>
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
            <RateChart points={points} loading={history.isLoading} strike={null} cap={null} label={`${id} · ${range}`} unit="%" />
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

      {d && (
        <div className="bx-card" style={{ marginTop: 16 }}>
          <div className="bx-card-h"><h2>About {id}</h2></div>
          <Sum l="Administrator" v={adminName(d.administrator)} />
          <Sum l="Type" v={d.type === 'POLICY' ? 'Central bank policy rate' : 'Overnight market rate'} />
          <Sum l="Published" v={d.type === 'POLICY' ? 'When the central bank decides; recorded each weekday after 17:00 local time' : `Business days around ${d.registry.publicationTime} (${d.registry.timeZone.replace('_', ' ')})`} />
          <Sum l="Each value is for" v={d.registry.observationConvention === 'PREVIOUS_BUSINESS_DAY' ? 'The previous business day' : d.type === 'POLICY' ? 'The rate in force that day' : 'The same business day'} />
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

export function RatesPage({ go, target }: { go: Go; target?: Target }) {
  const [tab, setTabState] = useAssetClass();
  const setTab = (t: RatesTab) => {
    setTabState(t);
    setBenchmark(null);
  };
  const [benchmark, setBenchmark] = useState<string | null>(SHOW_INTEREST_RATES ? target?.benchmark ?? null : null);
  // Arriving from Home: open the asked-for tab and benchmark.
  useEffect(() => {
    if (target?.rates) setTab(target.rates);
    if (target?.benchmark) setBenchmark(target.benchmark);
  }, [target]);
  return (
    <main className="bx-main">
      <section className="bx-full">
        <AssetClassTabs value={tab} onChange={setTab} />
        {tab === 'fx' ? <FxRates go={go} />
          : benchmark ? <BenchmarkPage id={benchmark} back={() => setBenchmark(null)} />
          : <InterestRates open={setBenchmark} />}
      </section>
    </main>
  );
}
