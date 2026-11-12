/**
 * Hedger pages: Home, Protect (currency page with a docked Protect panel), My
 * protections and Rates. BlockFinaX picks the pool and network; the chain stays out
 * of sight except under Advanced details.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronUp, LineChart as ChartIcon, Percent, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { CurrencyPool, ProtectionPosition, ProtectionQuote, SettlementResult } from '@shared/domain/types';
import { durationsOffered, saleMarkup } from '@shared/domain/durations';
import { api } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import {
  ccyName, dateIn, dateOf, endsAt, exposureLabel, fmt, fmtRate, pairName, pct, poolRef, quoteCcy, signAndSend, useChains, useDebounced, usePools,
  useUsdcBalances, usdcOn, useIsDemo, openContactSales, remember, remembered, type Direction,
} from './shared';
import { usePasskeySession } from '@/lib/identity';
import { AssetClassTabs, CoverName, Flag, hint, RefRate, Loading, Note, SHOW_INTEREST_RATES, Spin, Sum, Tag, Toggle, useAssetClass } from './ui';
import type { Go, Target } from './workspace';
import { RateCoverPanel, RateMarkets, RateProtections, useRateProtections } from './rate-pages';
import { MyQuoteRequests, RequestQuoteModal } from './rfq';
import { useActingOrganisation } from '@/lib/use-acting-organisation';
import { isOffered, poolForSale } from '@shared/domain/offered-directions';

type Hedge = { position: ProtectionPosition; pair: string; settlement: SettlementResult };

function useHedges() {
  // Remembered per person and per account they act for, so a business never shows personal cover.
  const { session } = usePasskeySession();
  const acting = useActingOrganisation();
  const key = `hedges:${session?.user.id ?? 'anon'}:${acting?.id ?? 'me'}`;
  return useQuery({
    queryKey: ['v2-hedges', key],
    queryFn: async () => remember(key, (await api<{ hedges: Hedge[] }>('/api/v2/hedges')).hedges),
    ...remembered<Hedge[]>(key),
    refetchInterval: 30_000,
    // Show the list already loaded while it refreshes; it changes only on purchase, fixing or claim.
    staleTime: 20_000,
    placeholderData: (previous) => previous,
  });
}

function useSpot(pair: string | null) {
  return useQuery({
    queryKey: ['v2-spot', pair],
    enabled: Boolean(pair),
    queryFn: async () => remember(`spot:${pair}`, Number((await api<{ spot: string }>(`/api/v2/spot?pair=${encodeURIComponent(pair!)}`)).spot)),
    ...remembered<number>(`spot:${pair}`),
    refetchInterval: 60_000,
  });
}


/** The rates watchlist (live rate, change since the last daily close), from one request. */
function useWatchlist() {
  return useQuery({
    queryKey: ['v2-rates'],
    queryFn: async () => remember('rates', (await api<{ rates: { pair: string; spot: number | null; change: number | null }[] }>('/api/v2/rates')).rates),
    ...remembered<{ pair: string; spot: number | null; change: number | null }[]>('rates'),
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

// ── Markets: one per currency, every pool behind it ─────────────────────────

/**
 * A market is a currency pair. Buyers never choose a pool: the server fills each order
 * from the cheapest pools first, across several when one cannot take it all.
 */
interface Market { pair: string; pools: CurrencyPool[]; directions: Direction[]; capacity: number }

function useMarkets() {
  const pools = usePools();
  const open = (pools.data ?? []).filter((p) => p.acceptingHedges && poolForSale(p.direction) && Number(p.liquidity.capacity) > 0 && p.tenors.some((t) => t.active));
  const byPair = new Map<string, CurrencyPool[]>();
  for (const p of open) byPair.set(p.pair, [...(byPair.get(p.pair) ?? []), p]);
  const markets: Market[] = Array.from(byPair.entries()).map(([pair, ps]) => ({
    pair, pools: ps,
    directions: (['up', 'down'] as Direction[]).filter((d) => isOffered(d) && ps.some((p) => p.direction === d || p.direction === 'both')),
    capacity: ps.reduce((sum, p) => sum + Number(p.liquidity.capacity), 0),
  }));
  return { pools, markets };
}

/**
 * The cover Markets prices: where protection starts (bps from today's rate) and how far
 * beyond it the payout stops growing. By default cover from today's rate with a 10% limit,
 * the same cover the buying panel starts on; once the buyer changes the panel, the list
 * follows it, so the two prices never disagree.
 */
export interface MarketTerms { distanceBps: number; limitBps: number; fromPanel: boolean }
const DEFAULT_TERMS: MarketTerms = { distanceBps: 0, limitBps: 1_000, fromPanel: false };
/** The duration the headline price is for: common supplier payment terms. */
const HEADLINE_DAYS = 30;

function termsLabel(t: MarketTerms) {
  const start = t.distanceBps === 0 ? "today's rate" : `${t.distanceBps / 100}% from today's rate`;
  return `Prices for cover starting at ${start}, with a ${t.limitBps / 100}% limit${t.fromPanel ? ', as set in the panel' : ''}.`;
}

/**
 * A market's price per duration and side: BlockFinaX's fair price on that cover times the
 * cheapest pool's markup for it, as the contract applies it. A pool whose closest strike is
 * further than the cover asked for cannot sell it and is left out.
 */
type FairTable = { reference: { strike: string }; rows: { tenorDays: number; fairRateE6: number | null }[] };
function useSideOffers(market: Market, direction: Direction, terms: MarketTerms) {
  const pools = market.pools.filter((p) => p.direction === direction || p.direction === 'both');
  const on = market.directions.includes(direction) && pools.length > 0;
  // Never closer than every pool allows.
  const closest = pools.length ? Math.min(...pools.map((p) => p.structures.minStrikeDistanceBps ?? 0)) : 0;
  const distance = Math.max(terms.distanceBps, closest);
  const sellers = pools.filter((p) => (p.structures.minStrikeDistanceBps ?? 0) <= distance);
  // Listed durations, plus the headline duration where a pool sells any day around it.
  const days = new Set(sellers.flatMap((p) => durationsOffered(p).days));
  if (sellers.some((p) => { const r = durationsOffered(p).range; return r && r.minDays <= HEADLINE_DAYS && r.maxDays >= HEADLINE_DAYS; })) days.add(HEADLINE_DAYS);
  const tenors = Array.from(days).sort((a, b) => a - b);
  const limit = terms.limitBps;
  const fairKey = `fair:${market.pair}:${direction}:${tenors.join(',')}:${distance}:${limit}`;
  const fair = useQuery({
    queryKey: ['v2-fair', market.pair, direction, tenors.join(','), distance, limit],
    enabled: on && tenors.length > 0,
    queryFn: async () => remember(fairKey, await api<FairTable>(`/api/v2/fair?pair=${encodeURIComponent(market.pair)}&direction=${direction}&tenors=${tenors.join(',')}&distance=${distance}&limit=${limit}`)),
    ...remembered<FairTable>(fairKey),
    staleTime: 60_000,
  });
  const rows = on ? tenors.map((tenorDays) => {
    const f = fair.data?.rows.find((r) => r.tenorDays === tenorDays)?.fairRateE6 ?? null;
    const markups = sellers.map((p) => saleMarkup(p, tenorDays, direction)).filter((m): m is number => m !== null);
    const price = f === null || !markups.length ? null : (f / 1e6) * (Math.min(...markups) / 10000);
    return { tenorDays, price };
  }) : [];
  return { rows, loading: on && fair.isLoading, distance, strike: fair.data?.reference.strike ?? null };
}

function useMarketOffers(market: Market, terms: MarketTerms) {
  const up = useSideOffers(market, 'up', terms);
  const down = useSideOffers(market, 'down', terms);
  // The headline: the 30-day price (Up cover first, the side most buyers need), else the
  // duration nearest 30 days. Never the cheapest short duration, which almost nobody buys.
  const near = (rows: { tenorDays: number; price: number | null }[]) => rows.filter((r) => r.price !== null)
    .sort((a, b) => Math.abs(a.tenorDays - HEADLINE_DAYS) - Math.abs(b.tenorDays - HEADLINE_DAYS))[0] ?? null;
  const head = near(up.rows) ?? near(down.rows);
  return { up, down, headline: head?.price ?? null, headlineDays: head?.tenorDays ?? null, loading: up.loading || down.loading };
}

/** The durations a market sells: any day in the widest range, otherwise the listed ones. */
function durationsLabel(market: Market) {
  let range: { minDays: number; maxDays: number } | null = null;
  const days = new Set<number>();
  for (const p of market.pools) {
    const o = durationsOffered(p);
    if (o.range) range = range ? { minDays: Math.min(range.minDays, o.range.minDays), maxDays: Math.max(range.maxDays, o.range.maxDays) } : o.range;
    o.days.forEach((d) => days.add(d));
  }
  if (range) return range.minDays === range.maxDays ? `${range.minDays} days` : `Any day, ${range.minDays} to ${range.maxDays}`;
  return days.size ? `${Array.from(days).sort((a, b) => a - b).join(', ')} days` : '-';
}

const MARKET_COLS = { gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr) 110px' };

const isPhone = () => window.innerWidth < 860;

function MarketRow({ market, go, expandable = true, action = 'Buy cover', selectOnClick = false, focused = false, chart, terms = DEFAULT_TERMS }: {
  market: Market; go: Go; expandable?: boolean; action?: string; terms?: MarketTerms;
  /** Clicking the row chooses the market (Markets) rather than only opening its prices. */
  selectOnClick?: boolean;
  /** The market chosen on Markets: shown open, without its Select button. */
  focused?: boolean;
  /** On the chosen market: the rate chart switch, shown in place of Select. */
  chart?: { on: boolean; toggle: () => void };
}) {
  // On a phone the buying form sits below, so the chosen market stays closed to keep it in view.
  const opensWhenChosen = focused && !isPhone();
  const [open, setOpen] = useState(opensWhenChosen);
  useEffect(() => { if (selectOnClick) setOpen(opensWhenChosen); }, [opensWhenChosen, selectOnClick]);
  const offers = useMarketOffers(market, terms);
  const pair = market.pair;
  const buy = (days?: number, direction?: Direction) => go('h-protect', { pair, buy: true, days, direction });
  const spot = useSpot(pair);
  const both = market.directions.length > 1;
  const sides = ([['up', offers.up], ['down', offers.down]] as const).filter(([d]) => market.directions.includes(d));
  const SUB = { gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 0.8fr) 58px' };
  return (
    <>
      <div className={`bx-li bx-li-market${expandable || selectOnClick ? ' click' : ''}`} style={MARKET_COLS} onClick={() => (selectOnClick && !focused ? buy() : expandable && setOpen((o) => !o))}>
        <div className="bx-who"><Flag pair={pair} /><div style={{ minWidth: 0 }}><div className="t"><CoverName pair={pair} direction={both ? 'both' : market.directions[0] ?? 'up'} /></div><div className="d"><RefRate /> <span className="num">{spot.data ? fmtRate(spot.data) : '...'}</span></div></div></div>
        <div className="r"><div className="num" style={{ fontWeight: 600 }}>${fmt(market.capacity, 0)}</div><div className="muted" style={{ fontSize: 12 }}>available</div></div>
        <div className="r"><div className="num" style={{ fontWeight: 600 }}>{offers.headline === null ? (offers.loading ? '...' : '-') : pct(offers.headline)}</div><div className="muted" style={{ fontSize: 12 }}>{offers.headlineDays ? `for ${offers.headlineDays} ${offers.headlineDays === 1 ? 'day' : 'days'}` : 'price'}</div></div>
        <div className="r bx-hide-sm" style={{ fontSize: 13 }}>{durationsLabel(market)}</div>
        <div className="r" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
          {!focused && <button className="bx-btn small" onClick={(e) => { e.stopPropagation(); buy(); }}>{isPhone() ? 'Buy' : action}</button>}
          {focused && chart && (
            <button className={`bx-icon-btn bx-chart-toggle${chart.on ? ' on' : ''}`} aria-pressed={chart.on} aria-label={chart.on ? 'Hide rate chart' : 'Show rate chart'} title={chart.on ? 'Hide rate chart' : 'Show rate chart'}
              onClick={(e) => { e.stopPropagation(); chart.toggle(); }}><ChartIcon /></button>
          )}
          {expandable && (open ? <ChevronUp size={16} className="muted" /> : <ChevronDown size={16} className="muted" />)}
        </div>
      </div>
      {open && (
        <div style={{ background: '#f8f9fb', borderRadius: 12, padding: '6px 14px 10px', margin: '0 0 10px' }}>
          <div className="muted" style={{ fontSize: 12, paddingTop: 8 }}>{termsLabel(terms)}</div>
          {/* Up and Down cover side by side; stacked on phones. */}
          <div className={`bx-sides${sides.length > 1 ? ' two' : ''}`}>
            {sides.map(([d, side]) => (
              <div key={d} className="bx-side-col">
                <div style={{ fontSize: 13, fontWeight: 600, padding: '8px 0 2px' }}>{exposureLabel(pair, d).kind} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{exposureLabel(pair, d).who}</span></div>
                <div className="bx-list-h" style={SUB}><span>{hint("Length")}</span><span className="r">{hint("Ends")}</span><span className="r">{hint("Price")}</span><span /></div>
                {side.rows.map((r) => (
                  <div key={r.tenorDays} className="bx-li bx-li-tenor bx-li-slim click" style={SUB}
                    onClick={() => { if (isPhone()) setOpen(false); buy(r.tenorDays, d); }}>
                    <span style={{ fontWeight: 600 }}>{r.tenorDays} {r.tenorDays === 1 ? 'day' : 'days'}</span>
                    <span className="r">{dateIn(r.tenorDays)}</span>
                    <span className="r num">{r.price === null ? (side.loading ? '...' : '-') : pct(r.price)}</span>
                    <span className="r"><button className="bx-btn ghost small" onClick={(e) => { e.stopPropagation(); if (isPhone()) setOpen(false); buy(r.tenorDays, d); }}>Buy</button></span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, paddingTop: 8 }}>The best price across every pool. Cover that starts further from today's rate, or has a closer limit, costs less. Your exact price, including the BlockFinaX fee, is shown before you buy.</div>
        </div>
      )}
    </>
  );
}

function MarketHeader() {
  return <div className="bx-list-h" style={MARKET_COLS}><span>{hint("Cover")}</span><span className="r">{hint("Liquidity")}</span><span className="r">{hint("Premium")}</span><span className="r">{hint("Durations")}</span><span /></div>;
}

/**
 * The currencies on sale, at the top of Markets. Choosing one shows only that market, open,
 * and loads it into the buying panel beside it; All markets brings the list back.
 */
function MarketList({ go, selected, chart, terms = DEFAULT_TERMS }: { go: Go; selected: string | null; chart?: { on: boolean; toggle: () => void }; terms?: MarketTerms }) {
  const { pools, markets } = useMarkets();
  const acting = useActingOrganisation();
  const chosen = selected ? markets.find((m) => m.pair === selected) ?? null : null;
  const shown = chosen ? [chosen] : markets;
  return (
    <div className="bx-card">
      <div className="bx-card-h" style={{ flexWrap: 'wrap' }}>
        <div><h2>Markets</h2><div className="sub">{chosen ? 'Set your terms. Your exact price is shown before you buy.' : 'Choose a currency to price your protection.'}</div></div>
        {chosen && markets.length > 1 && (
          <button className="bx-link" onClick={() => go('h-protect', { buy: false })}>All markets</button>
        )}
      </div>
      {pools.isLoading ? <Loading /> : !shown.length ? <div className="bx-empty">No cover is on sale right now.</div> : (
        <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 600 }}>
          <MarketHeader />
          {shown.map((m) => <MarketRow key={m.pair} market={m} go={go} action="Select" selectOnClick focused={m === chosen} chart={m === chosen ? chart : undefined} terms={m === chosen ? terms : DEFAULT_TERMS} />)}
        </div></div>
      )}
      {!chosen && !acting && (
        <div className="bx-hint" style={{ marginTop: 12 }}>
          Don't see what you need? <button className="bx-link" onClick={() => go('h-protect', { rfq: true })}>Request a quote</button>
        </div>
      )}
    </div>
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
          <div className="bx-strip">
            <div><div className="k">{hint("Protected exposure")}</div><div className="v num">${fmt(exposure, 0)}</div></div>
            <div><div className="k">{hint("Active protections")}</div><div className="v num">{active.length + rateActive.length}</div></div>
            <div><div className="k">{hint("Next expiry")}</div><div className="v num">{next ? `${daysLeft(next)} days` : '-'}</div>{next && <div className="s">{dateOf(next)}</div>}</div>
          </div>
        </div>

        <div className="bx-card">
          <div className="bx-card-h" style={{ flexWrap: 'wrap' }}><h2>Your protections</h2><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><AssetClassTabs small value={protClass} onChange={setProtClass} /><button className="bx-link" onClick={() => go('h-protections')}>View all</button></div></div>
          {protClass === 'ir' ? <RateProtections go={go} embedded /> : hedges.isLoading ? <Loading /> : !active.length ? (
            <div className="bx-empty">Nothing protected yet. <button className="bx-link" onClick={() => go('h-protect', { buy: true })}>Protect an exposure</button></div>
          ) : (
            <>
              <div className="bx-list-h" style={cols}><span>{hint("Exposure")}</span><span className="r">{hint("Protected")}</span><span className="r">{hint("Expires")}</span><span className="r">{hint("Payout today")}</span></div>
              {active.map(({ position: p, pair, settlement: s }) => (
                <div key={s.position} className="bx-li click" style={cols} onClick={() => go('pair', { pair, position: markKey(p) })}>
                  <div className="bx-who">
                    <Flag pair={pair} />
                    <div style={{ minWidth: 0 }}>
                      <div className="t"><CoverName pair={pair} direction={p.direction} /></div>
                      <div className="d">Covered {p.direction === 'up' ? 'above' : 'below'} {fmtRate(p.strike)}{p.structure === 'capped' ? `, up to ${fmtRate(p.cap)}` : ''} {quoteCcy(pair)}{p.structure === 'open' ? ', no limit' : ''}</div>
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
          <p>Protect a dollar payment you make, or dollar income you receive, against the rate moving the wrong way. Pay a premium in USDC, and get paid if it does.</p>
          <button onClick={() => go('h-protect', { buy: true })}>Get started</button>
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
  const { pools, markets } = useMarkets();
  const [assetClass, setAssetClass] = useAssetClass();
  return (
    <div className="bx-card">
      <div className="bx-card-h" style={{ flexWrap: 'wrap' }}><h2>Available cover</h2><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><AssetClassTabs small value={assetClass} onChange={setAssetClass} /><button className="bx-link" onClick={() => go('h-markets')}>All markets</button></div></div>
      {assetClass === 'ir' ? <RateMarkets go={go} embedded limit={5} /> : pools.isLoading ? <Loading /> : !markets.length ? <div className="bx-empty">No cover is on sale right now.</div> : (
        <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 700 }}>
          <MarketHeader />
          {markets.slice(0, 5).map((m) => <MarketRow key={m.pair} market={m} go={go} />)}
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
  /** What the position pays at a given expiry rate, and its maximum. */
  payout?: (rate: number) => number;
  maxPayout?: number;
}

const toSec = (t: string) => Date.parse(t.length === 10 ? `${t}T12:00:00Z` : t) / 1000;

/** One protection drawn on a chart: where it starts paying, where it stops, and whose side it is. */
export interface ChartProtection {
  strike: number;
  /** null for Open cover with no visible cap. */
  cap: number | null;
  /** `pay`: a hedger is paid in the band. `risk`: an underwriter pays in the band. */
  tone: 'pay' | 'risk';
}

/**
 * Price chart scaled to the price itself, so the period's moves are visible. One protection
 * overlay: the strike, the band where it pays, and the limit, labelled together. When the band
 * sits beyond the visible prices, a strip on that edge says where it is instead of flattening
 * the price line to fit it.
 */
export function RateChart({ points, loading, label, unit, protection = null, keepStrike = false }: {
  points: { t: string; v: number }[]; loading: boolean; label?: string; unit?: string;
  protection?: ChartProtection | null;
  /** Stretch the scale to show the strike even when it is far from today's prices (a chosen position). */
  keepStrike?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) {
    return <div className="bx-chart"><div className="bx-empty">{loading ? 'Loading chart...' : 'Not enough data for this range yet.'}</div></div>;
  }
  const VW = 800, VH = 260, PL = 8, PR = 72;
  const values = points.map((p) => p.v);
  const dLo = Math.min(...values), dHi = Math.max(...values);
  const span = dHi - dLo || Math.abs(dHi) * 0.004 || 1;
  // A level stretches the scale only when it is just beyond the prices (a quarter of their range).
  const near = (v: number | null | undefined) => v !== null && v !== undefined && Number.isFinite(v) && v >= dLo - span * 0.25 && v <= dHi + span * 0.25;
  const pull = protection ? [protection.strike, protection.cap].filter(near) as number[] : [];
  if (protection && keepStrike && Number.isFinite(protection.strike)) pull.push(protection.strike);
  const lo0 = Math.min(dLo, ...pull), hi0 = Math.max(dHi, ...pull);
  const pad = (hi0 - lo0) * 0.08 || Math.abs(hi0) * 0.002 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  // Protection beyond the visible prices gets its own strip of space for its label.
  const bandEnds = protection ? [protection.strike, protection.cap ?? protection.strike] : [];
  const offTop = bandEnds.length > 0 && Math.min(...bandEnds) > hi;
  const offBottom = bandEnds.length > 0 && Math.max(...bandEnds) < lo;
  const PT = offTop ? 34 : 14, PB = offBottom ? 34 : 14;
  const iw = VW - PL - PR, ih = VH - PT - PB;
  const x = (i: number) => PL + (i / (values.length - 1)) * iw;
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * ih;
  const clampY = (v: number) => Math.min(PT + ih, Math.max(PT, y(v)));
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(values.length - 1).toFixed(1)} ${PT + ih} L${PL} ${PT + ih} Z`;
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * k) / 4);
  const dp = decimalsFor((hi - lo) / 4);
  const rising = values[values.length - 1] >= values[0];
  const stroke = '#1f5fe0';
  const inside = (v: number | null | undefined) => v !== null && v !== undefined && Number.isFinite(v) && v >= lo && v <= hi;

  const onMove = (clientX: number, el: SVGSVGElement) => {
    const box = el.getBoundingClientRect();
    if (!box.width) return;
    const vx = ((clientX - box.left) / box.width) * VW;
    const i = Math.round(((vx - PL) / iw) * (values.length - 1));
    setHover(Math.max(0, Math.min(values.length - 1, i)));
  };
  const h = hover === null ? null : points[hover];

  // The protection band: from the strike to the limit (or to the edge for Open cover).
  const band = (() => {
    if (!protection) return null;
    const { strike: k, cap: c } = protection;
    const up = c !== null ? c > k : k >= values[values.length - 1];
    const far = c ?? (up ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    const top = Math.max(k, far), bot = Math.min(k, far);
    const color = protection.tone === 'risk' ? '#e23b57' : '#12a05a';
    const visible = top >= lo && bot <= hi;
    const offAbove = bot > hi, offBelow = top < lo;
    const last = values[values.length - 1];
    const pct = (((up ? k : k) - last) / last) * 100;
    const text = `${protection.tone === 'risk' ? 'Pool pays' : 'Pays'} from ${fmtAxis(k, dp)}${c !== null ? ` to ${fmtAxis(c, dp)}` : ''}`;
    return { k, c, top, bot, color, visible, offAbove, offBelow, pct, text };
  })();

  return (
    <>
    {band && (
      <span className="bx-protect-tag" style={{ borderColor: band.color, color: band.color }}>
        <i style={{ background: '#e0a03a' }} />{band.text}
        {(band.offAbove || band.offBelow) && <b> {band.offAbove ? '↑' : '↓'} {Math.abs(band.pct).toFixed(1)}% {band.offAbove ? 'above' : 'below'} today</b>}
      </span>
    )}
    <div className="bx-chart">
      {h && (
        <div className="bx-chart-read">
          <span className="num" style={{ fontWeight: 600 }}>{fmtAxis(h.v, Math.max(dp, 2))}{unit ? ` ${unit}` : ''}</span>
          <span className="muted">{fmtWhen(h.t)}</span>
        </div>
      )}
      <svg
        role="img" aria-label={`${label ?? 'Rate'} over the selected period, ${rising ? 'rising' : 'falling'}${band ? `; ${band.text}` : ''}`}
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
        {band?.visible && (
          <rect x={PL} y={clampY(band.top)} width={iw} height={Math.max(0, clampY(band.bot) - clampY(band.top))} fill={band.color} opacity="0.1" />
        )}
        {band && (band.offAbove || band.offBelow) && (
          <rect x={PL} y={band.offAbove ? 4 : VH - 10} width={iw} height={6} fill={band.color} opacity="0.55" />
        )}
        <path d={area} fill="url(#bx-chart-fill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {band && inside(band.c) && <line x1={PL} y1={y(band.c!)} x2={VW - PR} y2={y(band.c!)} stroke={band.color} strokeWidth="1.2" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />}
        {band && inside(band.k) && <line x1={PL} y1={y(band.k)} x2={VW - PR} y2={y(band.k)} stroke="#e0a03a" strokeWidth="1.6" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
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
    </div>
    </>
  );
}

// ── Pair page: one pair's chart with your positions on it ───────────────────

/** A hedger's protection as a chart mark: the band where it pays them. */
export function hedgeMark(p: ProtectionPosition, label: string): ChartMark {
  const n = Number(p.notional), k = Number(p.strike), c = Number(p.cap), entry = Number(p.spot), up = p.direction === 'up';
  // The contract's formula: amount x (min(rate, cap) - strike) / rate when bought, and the mirror for falling cover.
  const payout = (r: number) => Math.max(0, up ? Math.min(r, c) - k : k - Math.max(r, c)) * n / entry;
  return { key: `${p.ref.chain}:${p.ref.contract}:${p.ref.id}`, label, tone: 'pay', strike: k, cap: c, entry, from: p.createdAt, to: p.expiry, payout, maxPayout: payout(c) };
}

/** The same protection seen by an underwriter: the band where their pool pays. */
export function riskMark(p: ProtectionPosition, label: string): ChartMark {
  return { ...hedgeMark(p, label), tone: 'risk' };
}

const markKey = (p: ProtectionPosition) => `${p.ref.chain}:${p.ref.contract}:${p.ref.id}`;

/** Claim a settled payout: one signature, then refresh balances and protections. */
function useClaimPayout() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
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
  return { busy, claim };
}
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

export function PairPage({ go, pair, role, focus: initialFocus }: { go: Go; pair: string; role: 'hedger' | 'underwriter'; focus?: string }) {
  const [range, setRange] = useState<Range>('1M');
  const chart = useChart(pair, range);
  const spot = useSpot(pair);
  const hedges = useHedges();
  const under = useUnderwrittenOn(pair, role === 'underwriter');
  const [focus, setFocus] = useState<string | null>(initialFocus ?? null);
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
  // An ended cover shows what it paid (and a claim button), not "if it ended today".
  const focusedSettlement = role === 'hedger' ? mineHedges.find((h) => markKey(h.position) === focus)?.settlement ?? null : null;
  const ended = focusedSettlement !== null && focusedSettlement.status !== 'pending';
  const { busy: claiming, claim } = useClaimPayout();
  // Running and finished cover are listed apart; start on the group of the cover that was opened.
  const runningCount = mineHedges.filter((h) => h.settlement.status === 'pending').length;
  const endedCount = mineHedges.length - runningCount;
  const [listView, setListView] = useState<'active' | 'ended' | null>(null);
  const listShowing = listView ?? (ended ? 'ended' : runningCount || !endedCount ? 'active' : 'ended');

  return (
    <main className="bx-main">
      <section className="bx-full">
        <div className="bx-card">
          <button className="bx-link bx-back" onClick={() => go(role === 'hedger' ? 'h-protections' : 'u-pools')}>
            <ChevronLeft aria-hidden="true" /> {role === 'hedger' ? 'My protections' : 'Pools'}
          </button>
          <div className="bx-dense-head">
            <Flag pair={pair} />
            <div><div className="bx-dense-name">{ccyName(pair)}</div><div className="muted">{pair}</div></div>
            <div className="bx-dense-spot">
              <span className="num">{spot.data ? fmtRate(spot.data) : '...'}</span>
              <span className="muted">{ccy} per 1 USD</span>
              <ChangeText change={periodChange} /><span className="muted">{range === 'MAX' ? 'all time' : range === 'YTD' ? 'this year' : range}</span>
            </div>
          </div>
          {(() => {
            const m = marks.find((x) => x.key === focus) ?? (marks.length === 1 ? marks[0] : null);
            return <RateChart points={points} loading={chart.isLoading} label={`${pair} · ${range}`} unit={ccy} protection={m ? { strike: m.strike, cap: m.cap, tone: m.tone } : null} keepStrike={Boolean(focusedPos)} />;
          })()}
          <div className="bx-ranges" role="group" aria-label="Chart range">
            {RANGES.map((r) => <button key={r} className={range === r ? 'on' : ''} aria-pressed={range === r} onClick={() => setRange(r)}>{r}</button>)}
          </div>
          {focusedPos && ended && focusedSettlement && (
            <div className="bx-payline">
              <span>Ended {dateOf(focusedPos.expiry)}{focusedSettlement.settlementPrice ? <> at <b className="num">{fmtRate(focusedSettlement.settlementPrice)}</b></> : null}</span>
              <span>Payout: <b className="num" style={{ color: 'var(--green)' }}>${fmt(focusedSettlement.netPayout)}</b></span>
              {focusedSettlement.status === 'settled_claimable'
                ? <button className="bx-btn small" disabled={claiming === focusedSettlement.position} onClick={() => claim(focusedSettlement.position)}>{claiming === focusedSettlement.position ? <Spin /> : 'Receive payout'}</button>
                : <span className="muted">{focusedSettlement.status === 'claimed' ? 'Paid to your account' : 'No payout was due'}</span>}
            </div>
          )}
          {focusedPos && !ended && (() => {
            const m = marks.find((x) => x.key === focus);
            if (!m?.payout) return null;
            const cost = Number(focusedPos.premium) + Number(focusedPos.fee);
            const n = Number(focusedPos.notional), entry = Number(focusedPos.spot), k = Number(focusedPos.strike);
            const breakeven = focusedPos.direction === 'up' ? k + (cost * entry) / n : k - (cost * entry) / n;
            const today = spot.data ? m.payout(spot.data) : null;
            return (
              <div className="bx-payline">
                <span>{role === 'hedger' ? 'If it ended today' : 'Your pool would pay today'}: <b className="num" style={{ color: role === 'hedger' ? 'var(--green)' : 'var(--red)' }}>${fmt(today ?? 0)}</b></span>
                <span>Cover type: <b>{focusedPos.structure === 'open' ? 'Open' : 'Limited'}</b></span>
                <span>{role === 'hedger' ? 'Most it can pay' : 'Most your pool can pay'}: <b className="num">${fmt(m.maxPayout ?? 0)}</b> at {fmtRate(focusedPos.cap)}</span>
                {role === 'hedger'
                  ? <span>Breaks even after premium at <b className="num">{fmtRate(breakeven)}</b></span>
                  : <span>Premium earned: <b className="num">${fmt(focusedPos.premium)}</b></span>}
              </div>
            );
          })()}
        </div>

        <div className="bx-card">
          <div className="bx-card-h" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div><h2>{role === 'hedger' ? 'Your protections on this pair' : 'Protection your pools back on this pair'}</h2><div className="sub">Select one to show it on the chart.</div></div>
            {role === 'hedger' && mineHedges.length > 0 && (
              <div className="bx-seg small" role="group" aria-label="Show">
                <button className={listShowing === 'active' ? 'on' : ''} aria-pressed={listShowing === 'active'} onClick={() => setListView('active')}>Active <span className="muted">{runningCount}</span></button>
                <button className={listShowing === 'ended' ? 'on' : ''} aria-pressed={listShowing === 'ended'} onClick={() => setListView('ended')}>Ended <span className="muted">{endedCount}</span></button>
              </div>
            )}
          </div>
          {(role === 'hedger' ? hedges.isLoading : under.loading) ? <Loading /> : marks.length === 0 ? (
            <div className="bx-empty">{role === 'hedger' ? 'You have no protection on this pair.' : 'Your pools have no running protection on this pair.'}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 600 }}>
              <div className="bx-list-h" style={POS_COLS}><span>{hint('Protection')}</span><span className="r">{hint('Protected')}</span><span className="r">{hint('Strike')}</span><span className="r">{hint('Expires')}</span></div>
              {(role === 'hedger' ? mineHedges.filter((h) => (h.settlement.status === 'pending') === (listShowing === 'active')).map((h) => ({ pos: h.position, title: exposureLabel(pair, h.position.direction).title, status: h.settlement.status }))
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
                    <div className="r"><div className="num">{dateOf(pos.expiry)}</div><div style={{ fontSize: 12 }}>{status === 'pending' ? <span className="up">Active</span> : status === 'settled_claimable' ? <span className="up">Payout ready</span> : <span className="muted">Ended</span>}</div></div>
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

const QUICK_DAYS: [number, string][] = [7, 14, 30, 60, 90].map((d) => [d, `${d} days`]);
const DAY_MS = 86_400_000;
const utcDay = (ms: number) => Math.floor(ms / DAY_MS);
const isoDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** "Protect until" a date, for pools that sell any day in a range. */
function ProtectUntil({ days, range, onChange }: { days: number | null; range: { minDays: number; maxDays: number }; onChange: (d: number) => void }) {
  const today = utcDay(Date.now());
  const picked = days ? today + days : null;
  const weekday = picked !== null ? (picked + 3) % 7 : -1; // Monday is 0
  return (
    <div className="bx-until">
      <input
        className="bx-input num"
        type="date"
        style={{ maxWidth: 220 }}
        min={isoDay(today + range.minDays)}
        max={isoDay(today + range.maxDays)}
        value={picked !== null ? isoDay(picked) : ''}
        onChange={(ev) => {
          const d = utcDay(Date.parse(ev.target.value)) - today;
          if (Number.isFinite(d) && d >= range.minDays && d <= range.maxDays) onChange(d);
        }}
        aria-label="Protect until"
      />
      <div className="bx-pills wrap" style={{ marginTop: 8 }}>
        {QUICK_DAYS.filter(([d]) => d >= range.minDays && d <= range.maxDays).map(([d, label]) => (
          <button key={d} className={`bx-pill${d === days ? ' on' : ''}`} onClick={() => onChange(d)}>{label}</button>
        ))}
      </div>
      {weekday >= 5 && <div className="bx-hint" style={{ marginTop: 6 }}>Markets are closed at weekends, so this cover ends on Monday.</div>}
    </div>
  );
}

export function ProtectPage({ go, pair: initialPair, target }: { go: Go; pair: string | null; target?: Target }) {
  const demo = useIsDemo();
  const { toast } = useToast();
  const qc = useQueryClient();
  const pools = usePools();
  const hedgesAll = useHedges();
  const chains = useChains();
  const balances = useUsdcBalances();

  const available = useMemo(() => (pools.data ?? []).filter((p) => p.acceptingHedges && poolForSale(p.direction) && Number(p.liquidity.capacity) > 0), [pools.data]);
  const pairs = useMemo(() => Array.from(new Set(available.map((p) => p.pair))), [available]);
  const setup = useQuery({ queryKey: ['v2-pool-setup'], queryFn: () => api<{ pairs: string[] }>('/api/v2/pools/setup'), staleTime: 300_000 });
  const rfqPairs = setup.data?.pairs ?? pairs;
  const [pair, setPair] = useState<string | null>(initialPair);
  useEffect(() => { if (initialPair) setPair(initialPair); }, [initialPair]);
  useEffect(() => { if ((!pair || !pairs.includes(pair)) && pairs[0]) setPair(pairs[0]); }, [pairs, pair]);
  const directions = useMemo(() => {
    const ds = new Set(available.filter((p) => p.pair === pair).map((p) => p.direction));
    return (['up', 'down'] as Direction[]).filter((d) => isOffered(d) && (ds.has(d) || ds.has('both')));
  }, [available, pair]);
  const [direction, setDirection] = useState<Direction>(target?.direction ?? 'up');
  useEffect(() => { if (target?.direction) setDirection(target.direction); }, [target?.direction]);
  useEffect(() => { if (directions.length && !directions.includes(direction)) setDirection(directions[0]); }, [directions, direction]);
  const [rfqOpen, setRfqOpen] = useState(Boolean(target?.rfq));
  useEffect(() => { if (target?.rfq) setRfqOpen(true); }, [target?.rfq]);
  const acting = useActingOrganisation();
  const viewOnly = acting?.role === 'viewer';
  // Markets shows only its list until someone means to buy: a market chosen, a duration's Buy,
  // or a Protect button. Buyers never choose a pool: every order is filled at the best price.
  const [buying, setBuying] = useState(Boolean(target?.pool || target?.buy));
  useEffect(() => { setBuying(Boolean(target?.pool || target?.buy)); }, [target]);
  // Choosing a pool from the list: on phones the buying panel sits below it, so bring it into view.
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if ((target?.pool || target?.buy) && window.innerWidth < 860) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [target]);
  const matching = available.filter((p) => p.pair === pair && (p.direction === direction || p.direction === 'both'));

  const [range, setRange] = useState<Range>('1M');
  const spot = useSpot(pair);
  const chart = useChart(pair, range);
  const points = chart.data ?? [];
  // Every range now ends on the live rate (the server puts it as today's point on daily
  // charts), so the change runs from the first point to the rate quotes are priced at.
  const periodChange = points.length >= 2
    ? (range.endsWith('H') && spot.data ? spot.data : points[points.length - 1].v) / points[0].v - 1
    : null;

  const options = useQuery({
    queryKey: ['v2-options', pair, direction],
    enabled: Boolean(pair),
    queryFn: () => api<{ anyDay?: { minDays: number; maxDays: number } | null; tenors: { tenorDays: number; open: boolean; capped: boolean }[] }>(`/api/v2/options?pair=${encodeURIComponent(pair!)}&direction=${direction}`),
  });
  // No default: buyers enter their own amount, usually an invoice.
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState<number | null>(target?.days ?? null);
  useEffect(() => { if (target?.days) setDays(target.days); }, [target?.days]);
  // Every pool on this market and side combined.
  const tenorList = options.data?.tenors ?? [];
  // Pools that sell any day in a range: the date picker replaces the duration buttons.
  const dayRange = options.data?.anyDay ?? null;
  const inRange = (d: number | null) => Boolean(dayRange && d && d >= dayRange.minDays && d <= dayRange.maxDays);
  useEffect(() => {
    if (dayRange) {
      if (!inRange(days)) setDays(Math.min(Math.max(30, dayRange.minDays), dayRange.maxDays));
      return;
    }
    if (tenorList.length && !tenorList.some((t) => t.tenorDays === days)) setDays((tenorList.find((t) => t.tenorDays >= 14) ?? tenorList[0]).tenorDays);
  }, [tenorList.map((t) => t.tenorDays).join(','), days, dayRange?.minDays, dayRange?.maxDays]);
  const rangeStructures = { open: matching.some((p) => p.structures.open), capped: matching.some((p) => p.structures.capped) };
  const tenor = tenorList.find((t) => t.tenorDays === days)
    ?? (inRange(days) ? { tenorDays: days!, open: rangeStructures.open, capped: rangeStructures.capped } : undefined);

  const pool = matching[0];
  const capMin = (pool?.structures.minCapDistanceBps ?? 300) / 100;
  const capMax = (pool?.structures.maxCapDistanceBps || 2000) / 100;
  const sign = direction === 'up' ? 1 : -1;
  // The closest strike any pool sells, set by their underwriters.
  const minStartPct = Math.min(...(matching.length ? matching.map((p) => p.structures.minStrikeDistanceBps ?? 0) : [0])) / 100;
  const startChoices = Array.from(new Set([minStartPct, minStartPct + 2, minStartPct + 5].map((v) => Math.round(v * 100) / 100)));
  // The strike, typed either as a % from today's rate or as a rate. Whichever the user typed
  // last stays fixed when the live rate moves; the other follows.
  const [pctText, setPctText] = useState('0');
  // The rate chart shows beside the buying form only when asked for (remembered per viewer).
  const [showChart, setShowChart] = useState(() => { try { return localStorage.getItem('bfx:buy-chart') === '1'; } catch { return false; } });
  const chartRef = useRef<HTMLDivElement | null>(null);
  const toggleChart = () => {
    const next = !showChart;
    setShowChart(next);
    try { localStorage.setItem('bfx:buy-chart', next ? '1' : '0'); } catch { /* storage unavailable */ }
    // On phones the chart sits above the form: bring it into view.
    if (next && window.innerWidth < 860) setTimeout(() => chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const [checking, setChecking] = useState(false);
  // Until the buyer changes it, protection starts at the closest rate the pool allows.
  const [strikeTouched, setStrikeTouched] = useState(false);
  const [rateText, setRateText] = useState('');
  const [anchor, setAnchor] = useState<'pct' | 'rate'>('pct');
  const rateDp = (v: number) => (v >= 100 ? 2 : 4);
  // A strike can be set to 0.0001% (hundredths of a basis point), so percentages keep 4 decimals.
  const roundPct = (v: number) => Math.round(v * 10_000) / 10_000;
  const rateFromPct = (pctV: number) => (spot.data ? spot.data * (1 + (sign * pctV) / 100) : null);
  const pctFromRate = (r: number) => (spot.data ? (sign * (r / spot.data - 1)) * 100 : null);
  useEffect(() => {
    if (!spot.data) return;
    if (anchor === 'pct') {
      const r = rateFromPct(Number(pctText));
      if (r && Number.isFinite(r)) setRateText(r.toFixed(rateDp(r)));
    } else {
      const v = pctFromRate(Number(rateText));
      if (v !== null && Number.isFinite(v)) setPctText(String(roundPct(v)));
    }
  }, [spot.data, direction]);
  // A pool's closest strike may be further than the current entry: move up to it.
  useEffect(() => { if (!strikeTouched || Number(pctText) < minStartPct) choosePct(minStartPct, false); }, [minStartPct]);
  function choosePct(v: number, byBuyer = true) {
    if (byBuyer) setStrikeTouched(true);
    setAnchor('pct');
    setPctText(String(v));
    const r = rateFromPct(v);
    if (r) setRateText(r.toFixed(rateDp(r)));
  }
  function typePct(text: string) {
    const clean = text.replace(/[^0-9.]/g, '');
    setStrikeTouched(true);
    setAnchor('pct');
    setPctText(clean);
    const r = rateFromPct(Number(clean));
    if (clean !== '' && r && Number.isFinite(r)) setRateText(r.toFixed(rateDp(r)));
  }
  function typeRate(text: string) {
    const clean = text.replace(/[^0-9.]/g, '');
    setStrikeTouched(true);
    setAnchor('rate');
    setRateText(clean);
    const v = pctFromRate(Number(clean));
    if (clean !== '' && v !== null && Number.isFinite(v)) setPctText(String(roundPct(v)));
  }
  const startPct = Number(pctText);
  // The contracts accept a strike between today's rate and 2x (rising) or 0.5x (falling) it.
  const maxStartPct = direction === 'up' ? 99 : 49;
  const strikeError = !spot.data ? null
    : pctText === '' || rateText === '' ? 'Enter a strike'
    : !Number.isFinite(startPct) ? 'Enter a number'
    : anchor === 'pct' && (pctText.split('.')[1]?.length ?? 0) > 4 ? 'Set the strike to at most 4 decimal places'
    : startPct < 0 ? `The strike must be ${direction === 'up' ? 'above' : 'below'} today's rate for this cover`
    : startPct < minStartPct ? `The closest strike on sale is ${minStartPct}% from today's rate`
    : startPct > maxStartPct ? `The strike can be at most ${maxStartPct}% from today's rate`
    : null;
  const [capPct, setCapPct] = useState(10);
  useEffect(() => { setCapPct((c) => Math.min(Math.max(c, capMin), capMax)); }, [capMin, capMax]);
  const [structure, setStructure] = useState<'capped' | 'open'>('capped');
  useEffect(() => { if (tenor && !tenor[structure]) setStructure(tenor.capped ? 'capped' : 'open'); }, [tenor, structure]);
  const strike = spot.data && !strikeError ? (anchor === 'rate' ? Number(rateText) : spot.data * (1 + (sign * startPct) / 100)) : null;
  // The list beside the panel prices the cover set here, once the buyer changes it.
  const panelTerms: MarketTerms = !strikeError && Number.isFinite(startPct) && (strikeTouched || capPct !== 10)
    ? { distanceBps: Math.max(0, Math.round(startPct * 100)), limitBps: Math.round(capPct * 100), fromPanel: true }
    : DEFAULT_TERMS;
  const listKey = useDebounced(JSON.stringify(panelTerms), 400);
  const listTerms = useMemo(() => JSON.parse(listKey) as MarketTerms, [listKey]);
  const cap = strike ? strike * (1 + (sign * capPct) / 100) : null;

  // A strike set as a percentage is sent as one, so the server measures it from the rate it prices at.
  const base = pair && days && strike && Number(amount) > 0 ? {
    pair, notional: amount, tenorDays: days, direction, strike: strike.toFixed(6),
    // In basis points with up to two decimals: 0.02% is 2, 0.0015% is 0.15.
    ...(anchor === 'rate' ? {} : { strikeDistanceBps: Math.round(startPct * 10_000) / 100 }),
  } : null;
  const cappedReq = useDebounced(base && cap && tenor?.capped ? JSON.stringify({ ...base, structure: 'capped', cap: cap.toFixed(6), capDistanceBps: Math.round(capPct * 100) }) : null, 350);
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

  // Before reviewing: does the user's verification cover this? On mainnet, if not, the
  // verification form opens (from the API helper) before any balance or signing step.
  async function review() {
    if (!e) return;
    setChecking(true);
    try {
      await api('/api/v2/verification/check', { cashUsd: Number(e.totalCost), exposureUsd: Number(e.maxPayout) });
      setMode('review');
    } catch (err) {
      if ((err as { code?: string }).code !== 'VERIFICATION_REQUIRED') toast({ title: 'Could not review', description: (err as Error).message, variant: 'destructive' });
    } finally { setChecking(false); }
  }

  // Request a quote works from personal accounts only, for now.
  const rfqModal = rfqOpen && pair && !acting ? (
    <RequestQuoteModal
      pairs={rfqPairs}
      draft={{ pair, direction, notional: amount, tenorDays: days ?? 30, strike, cap, reason: chosen.error ? (chosen.error as Error).message : undefined }}
      onClose={() => setRfqOpen(false)}
    />
  ) : null;

  if (!buying) {
    return (
      <main className="bx-main">
        <section className="bx-full"><MarketList go={go} selected={null} /></section>
        {rfqModal}
      </main>
    );
  }

  return (
    <main className="bx-main bx-dense">
      <section className="bx-col">
        {showChart && <div className="bx-card" ref={chartRef}>
          <div className="bx-dense-head">
            <Flag pair={pair} />
            <div><div className="bx-dense-name">{name}</div><div className="muted">{pair}</div></div>
            <div className="bx-dense-spot">
              <span className="num">{spot.data ? fmtRate(spot.data) : '...'}</span>
              <span className="muted">{ccy} per 1 USD</span>
              <ChangeText change={periodChange} /><span className="muted">{range === 'MAX' ? 'all time' : range === 'YTD' ? 'this year' : range}</span>
            </div>
            {pairs.length > 1 && (
              <select className="bx-select" style={{ marginLeft: 'auto', width: 'auto' }} aria-label="Currency" value={pair} onChange={(ev) => setPair(ev.target.value)}>
                {pairs.map((p) => <option key={p} value={p}>{ccyName(p)} ({p})</option>)}
              </select>
            )}
          </div>
          <RateChart points={points} loading={chart.isLoading} label={`${pair} · ${range}`} unit={ccy}
            protection={strike ? { strike, cap: structure === 'capped' ? cap : null, tone: 'pay' } : null} />
          <div className="bx-ranges" role="group" aria-label="Chart range">
            {RANGES.map((r) => <button key={r} className={range === r ? 'on' : ''} aria-pressed={range === r} onClick={() => setRange(r)}>{r}</button>)}
          </div>
        </div>}

        <MarketList go={go} selected={pair} chart={{ on: showChart, toggle: toggleChart }} terms={listTerms} />
        <div className="bx-card bx-hide-sm">
          <h2 style={{ marginBottom: 14 }}>How protection works</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 20 }}>
            {[
              ['Choose your cover', 'Pick an amount, how long you need it, and where protection starts.'],
              ['Pay once in USDC', 'The premium is the whole cost. Network fees are covered.'],
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

      <aside className="bx-aside" aria-label="Protect" ref={panelRef}>
        <div className="bx-panel bx-buy">
          {mode === 'done' ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <CheckCircle2 style={{ width: 48, height: 48, color: 'var(--green)' }} />
              <h3 style={{ fontSize: 15, margin: '10px 0 4px' }}>Your exposure is protected</h3>
              <p className="muted">${fmt(amount, 0)} of USD {exposureLabel(pair, direction).flow} protected until {days ? dateIn(days) : ''}.</p>
              {demo && (
                <div className="bx-demo-done">
                  This was a demo with test USDC. To protect real payments, <button className="bx-link" onClick={() => openContactSales('protect-done')}>talk to our sales team</button>.
                </div>
              )}
              <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
                <button className="bx-btn block" onClick={() => go('h-home')}>Go to home</button>
                <button className="bx-btn ghost block" onClick={() => setMode('build')}>Protect another</button>
              </div>
            </div>
          ) : mode === 'review' && e ? (
            <>
              <div><div style={{ fontSize: 15, fontWeight: 600 }}>Review protection</div><div className="muted" style={{ fontSize: 13, marginTop: 2 }}>You are protecting ${fmt(e.notional, 0)} of {ccy} exposure.</div></div>
              <div className="bx-sums" style={{ borderTop: 0, paddingTop: 0 }}>
                <Sum l="Current rate" v={<span className="num">{fmtRate(e.spot)}</span>} />
                <Sum l="Protection starts" v={<span className="num">{fmtRate(e.strike)}</span>} />
                <Sum l="Protection type" v={e.structure === 'open' ? 'Open' : 'Limited'} />
                {e.structure === 'capped' && <Sum l="Protection limit" v={<span className="num">{fmtRate(e.cap)}</span>} />}
                <Sum l="Duration" v={`${e.tenorDays} days`} />
                <Sum l="Expiry" v={endsAt(e.tenorDays)} />
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
                  <Sum l={chosen.data?.legs ? 'Pools' : 'Pool'} v={chosen.data?.legs ? `Filled from ${chosen.data.legs.length} pools, cheapest first` : `${e.pool.contract.slice(0, 6)}...${e.pool.contract.slice(-4)} · ${e.pool.id}`} />
                </div>
              </details>
              {e.warning && <div className="bx-warn" role="note">{e.warning}</div>}
              {onHub < Number(e.totalCost) && <p className="bx-error">Your balance (${fmt(onHub)}) is too low. Add funds first.</p>}
              <button className="bx-btn block" disabled={!!busy} onClick={confirm}>{busy ? <><Spin /> {busy}</> : left < 5 ? 'Refresh price' : 'Confirm protection'}</button>
              <button className="bx-btn ghost block" disabled={!!busy} onClick={() => setMode('build')}>Back</button>
              <div className="bx-hint">{left < 5 ? 'This price has expired. Tap Refresh price, then Confirm protection.' : `Price held for ${left} seconds · approve with your passkey`}</div>
            </>
          ) : (
            <>
              <div className="bx-buy-title">
                <div style={{ fontSize: 16, fontWeight: 600 }}><CoverName pair={pair} direction={direction} /></div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}><RefRate /> <span className="num">{spot.data ? fmtRate(spot.data) : '...'}</span> {ccy} per USD</div>
              </div>
              <div className="bx-field" style={{ margin: 0 }}>
                <label htmlFor="bx-amount" className="bx-label" style={{ margin: 0 }}>How much?</label>
                <span className="bx-input-unit"><span style={{ paddingLeft: 12 }}>$</span><input id="bx-amount" className="bx-input num" inputMode="decimal" aria-label="Amount to protect in USD" placeholder="Amount in USD, e.g. 25,000" value={amount} onChange={(ev) => setAmount(ev.target.value.replace(/[^0-9.]/g, ''))} /></span>
              </div>
              <div>
                <span className="bx-label">Until when?</span>
                {dayRange ? (
                  <ProtectUntil days={days} range={dayRange} onChange={setDays} />
                ) : (
                  <div className="bx-pills wrap">
                    {tenorList.map((t) => <button key={t.tenorDays} className={`bx-pill${t.tenorDays === days ? ' on' : ''}`} onClick={() => setDays(t.tenorDays)}>{t.tenorDays} {t.tenorDays === 1 ? 'day' : 'days'}</button>)}
                  </div>
                )}
                {days && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{days} {days === 1 ? 'day' : 'days'} from now · ends {endsAt(days)}</div>}
              </div>

              {/* Strike, cover type, limit and pool: always shown, the panel is compact enough. */}
              <div className="bx-adjust">
                <div className="bx-adjust-body">
                  {directions.length > 1 && (
                    <div>
                      <span className="bx-label">What do you need to protect?</span>
                      <div className="bx-seg">
                        {directions.map((d) => <button key={d} className={direction === d ? 'on' : ''} title={exposureLabel(pair, d).cover} onClick={() => setDirection(d)}>{d === 'up' ? 'A dollar payment I make' : 'Dollar income I receive'}</button>)}
                      </div>
                    </div>
                  )}
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
                    <div className="bx-start-row">
                      <div className="bx-pills" style={{ marginTop: 8 }}>
                        {startChoices.map((m) => <button key={m} className={`bx-pill${startPct === m ? ' on' : ''}`} onClick={() => choosePct(m)}>{m === 0 ? "Today's rate" : `${m}%`}</button>)}
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Further from today's rate costs less.</div>
                    </div>
                  </div>
                  <div>
                    <span className="bx-label">{hint("Cover type")}</span>
                    <div className="bx-choice">
                      {tenor?.capped !== false && <button className={structure === 'capped' ? 'on' : ''} onClick={() => setStructure('capped')}><div className="t">Limited</div><div className="p num">{capped.data ? `$${fmt(capped.data.economic.totalCost)}` : capped.isFetching ? '...' : '-'}</div></button>}
                      {tenor?.open !== false && <button className={structure === 'open' ? 'on' : ''} onClick={() => setStructure('open')}><div className="t">Open</div><div className="p num">{open.data ? `$${fmt(open.data.economic.totalCost)}` : open.isFetching ? '...' : '-'}</div></button>}
                    </div>
                  </div>
                  {structure === 'capped' && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><label htmlFor="bx-cap" className="muted">Protection limit</label><span className="num" style={{ fontWeight: 600 }}>{cap ? fmtRate(cap) : '-'}</span></div>
                      <input id="bx-cap" className="bx-range" type="range" min={capMin} max={capMax} step={1} value={capPct} onChange={(ev) => setCapPct(Number(ev.target.value))} />
                      <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>Closer limit: cheaper</span><span>Wider limit: more protection</span></div>
                    </div>
                  )}
                </div>
              </div>

              {!(Number(amount) > 0) ? (
                <div className="bx-quote"><div className="bx-quote-note" style={{ margin: 0 }}>Enter an amount to see your price.</div></div>
              ) : <div className="bx-quote" aria-live="polite">
                <div className="bx-quote-row"><span>Premium</span><b className="num">{e ? pct(e.offerRateE6 / 1e6) : chosen.isFetching ? '...' : '-'}</b></div>
                <div className="bx-quote-row"><span>You pay</span><b className="num">{e ? `$${fmt(e.totalCost)}` : chosen.isFetching ? '...' : '-'}</b></div>
                <div className="bx-quote-row"><span>Pays up to</span><b className="num">{e ? `$${fmt(e.maxPayout)}` : chosen.isFetching ? '...' : '-'}</b></div>
                {strike && (
                  <div className="bx-quote-note">
                    If {pair} {direction === 'up' ? 'rises above' : 'falls below'} <span className="num">{fmtRate(strike)}</span> at the end date
                    {structure === 'capped' && cap ? <>; the payout stops growing at <span className="num">{fmtRate(cap)}</span>.</> : ", up to the pool's maximum payout."}
                  </div>
                )}
                {e?.warning && <div className="bx-warn" role="note">{e.warning}</div>}
              </div>}

              {(strikeError || chosen.error) && (
                <div>
                  <p className="bx-error" style={{ margin: 0 }}>{strikeError ?? (chosen.error as Error).message}</p>
                  {chosen.error && !strikeError && <div className="bx-hint" style={{ textAlign: 'left', marginTop: 6 }}>No pool can price this. <button className="bx-link" onClick={() => setRfqOpen(true)}>Request a quote</button> and approved underwriters can make you an offer.</div>}
                </div>
              )}
              <button className="bx-btn block" disabled={!e || checking || viewOnly} onClick={review}>{checking ? <Spin /> : null} {viewOnly ? 'Viewers cannot buy cover' : 'Review protection'}</button>
              <div className="bx-hint">
                {e ? `Price held for ${left} seconds · ` : ''}{acting ? `approve for ${acting.name} with your passkey` : 'approve with your passkey'}
                {!chosen.error && !acting && <> · <button className="bx-link" style={{ fontSize: 'inherit' }} onClick={() => setRfqOpen(true)}>Request a quote</button></>}
              </div>
            </>
          )}
        </div>
      </aside>
      {rfqModal}
    </main>
  );
}

// ── My protections ───────────────────────────────────────────────────────────

export function MyProtections({ go }: { go: Go }) {
  const hedges = useHedges();
  const all = hedges.data ?? [];
  const rates = useRates(Array.from(new Set(all.map((h) => h.pair))));
  const spotOf = (pair: string) => rates.find((r) => r.pair === pair)?.spot;
  const { busy, claim } = useClaimPayout();
  const cols = { gridTemplateColumns: 'minmax(0, 2.2fr) repeat(4, minmax(0, 1fr))' };
  const [assetClass, setAssetClass] = useAssetClass();
  // Running cover first, soonest to end at the top; ended cover most recent first.
  const running = all.filter((h) => h.settlement.status === 'pending').sort((x, y) => Number(x.position.expiry) - Number(y.position.expiry));
  const ended = all.filter((h) => h.settlement.status !== 'pending').sort((x, y) => Number(y.position.expiry) - Number(x.position.expiry));
  const [view, setView] = useState<'active' | 'ended' | null>(null);
  const showing = view ?? (running.length || !ended.length ? 'active' : 'ended');
  const rows = showing === 'active' ? running : ended;
  return (
    <main className="bx-main">
      <section className="bx-full">
        <MyQuoteRequests />
        <AssetClassTabs value={assetClass} onChange={setAssetClass} />
        {assetClass === 'ir' ? <RateProtections go={go} /> : <div className="bx-card">
          <div className="bx-card-h" style={{ justifyContent: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            {/* With protections, the two tabs are the heading: the menu already says Protections. */}
            {!all.length && <h2>{SHOW_INTEREST_RATES ? 'FX protections' : 'My protections'}</h2>}
            {all.length > 0 && (
              <div className="bx-seg small" role="group" aria-label="My protections">
                <button className={showing === 'active' ? 'on' : ''} aria-pressed={showing === 'active'} onClick={() => setView('active')}>Active <span className="muted">{running.length}</span></button>
                <button className={showing === 'ended' ? 'on' : ''} aria-pressed={showing === 'ended'} onClick={() => setView('ended')}>Ended <span className="muted">{ended.length}</span></button>
              </div>
            )}
          </div>
          {hedges.isLoading ? <Loading /> : !all.length ? <div className="bx-empty">You have not bought protection yet.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 720 }}>
                {!rows.length ? <div className="bx-empty">{showing === 'active' ? 'No cover is running right now.' : 'No cover has ended yet.'}</div> : (
                  <div className={`bx-prot-group${showing === 'ended' ? ' ended' : ''}`}>
                    <div className="bx-list-h" style={cols}><span>{hint("Exposure")}</span><span className="r">{hint("Protected")}</span><span className="r">{hint("Expiry")}</span><span className="r">{hint("Payout")}</span><span className="r">{hint("Status")}</span></div>
                    {rows.map(({ position: p, pair, settlement: s }) => {
                      const active = s.status === 'pending';
                      const payout = active ? payoutToday(p, spotOf(pair)) : Number(s.netPayout);
                      return (
                        <div key={s.position} className="bx-li click" style={cols} role="button" tabIndex={0} onClick={() => go('pair', { pair, position: markKey(p) })} onKeyDown={(e) => { if (e.key === 'Enter') go('pair', { pair, position: markKey(p) }); }}>
                          <div className="bx-who"><Flag pair={pair} /><div style={{ minWidth: 0 }}><div className="t"><CoverName pair={pair} direction={p.direction} /></div><div className="d">From {fmtRate(p.strike)}{p.structure === 'capped' ? ` to ${fmtRate(p.cap)}` : ''} {quoteCcy(pair)}{p.structure === 'open' ? ', no limit' : ''}</div></div></div>
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
                )}
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
  const covered = useMemo(() => new Set((pools.data ?? []).filter((p) => p.acceptingHedges && poolForSale(p.direction)).map((p) => p.pair)), [pools.data]);
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
                ? <button className="bx-btn small" onClick={(e) => { e.stopPropagation(); go('h-protect', { pair: r.pair, buy: true }); }}>Protect</button>
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
                <h2 style={{ fontSize: 22, margin: '4px 0' }} className="num">{latest ? pctText(id, latest) : '-'}</h2>
                <div style={{ fontSize: 14 }}>
                  <BpChange bp={bpBetween(d.latest, d.previous)} /> <span className="muted">vs previous business day · for {latest ? dayLabel(latest.observationDate) : '-'}</span>
                </div>
              </div>
              <BenchmarkState r={d} />
            </div>
            <RateChart points={points} loading={history.isLoading} label={`${id} · ${range}`} unit="%" />
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
