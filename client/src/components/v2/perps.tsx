/**
 * Perps: a standard perpetual futures screen. Market bar, chart, order book and trades,
 * order form with leverage, account panel, and positions with liquidation price and the
 * auto-deleveraging lights.
 *
 * Orders are signed in the browser by a trading key the passkey approves once (it can
 * place and cancel orders, never withdraw). The key lives in this browser only.
 */
import { Buffer } from 'buffer';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CandlestickChart, ChevronDown, ChevronRight, KeyRound, ShieldCheck, X } from 'lucide-react';
import { Keypair } from '@stellar/stellar-sdk';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import { orderDigest, orderToJson, priceFromNumber, sizeFromNumber, toHex, type PerpOrder, type TimeInForce } from '@shared/perps';
import { fmt, signAndSend, useUsdcBalances } from './shared';
import { Flag, Spin } from './ui';
import './perps.css';

(globalThis as any).Buffer ??= Buffer;

interface MarketView {
  id: number; symbol: string; pair: string; name: string; base: string; quote: string; decimals: number; status: number;
  index: number; mark: number; weekend: boolean; change24h: number; volume24h: number; high24h: number; low24h: number;
  openInterest: number; oiCap: number; maxLeverage: number; maintBps: number; fundingLast: number; fundingPredicted: number;
  nextFundingAt: number; lastTrade: number | null;
}
interface Level { price: number; size: number; count: number; vault: number }
interface BookView { bids: Level[]; asks: Level[]; trades: { price: number; size: number; takerBuy: boolean; t: number }[]; mark: number; index: number }
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
interface PositionView {
  market: number; pair: string; symbol: string; size: number; entry: number; mark: number; notional: number; upnl: number; roe: number;
  liquidationPrice: number | null; margin: number; fundingOwed: number; adl: number; settled: boolean;
  realized?: { total: number; closing: number; fees: number; funding: number } | null;
}
interface AccountView {
  wallet: string; key: { approved: boolean; expiry: number } | null;
  onChain: { collateral: number; value: number; initial: number; maintenance: number; withdrawable: number };
  equity: number; initial: number; maintenance: number; notional: number; available: number;
  positions: PositionView[];
  openOrders: { hash: string; market: number; pair: string; isBuy: boolean; price: number; size: number; remaining: number; tif: string; reduceOnly: boolean }[];
  fills: { id: number; market: number; pair: string; side: 'buy' | 'sell'; role: string; price: number; size: number; status: string; tx: string | null; at: string }[];
  orderHistory: { hash: string; market: number; pair: string; isBuy: boolean; price: number; size: number; filled: number; tif: string; status: string; at: string }[];
  funding: { market: number; pair: string; rate: number; at: string; tx: string | null }[];
}
interface PerpConfig { enabled: boolean; running?: boolean; contractId?: string; explorer?: string; insurance?: number; vault?: { address: string; equity: number | null }; fees?: { takerBps: number; makerBps: number } }

const KEY_PREFIX = 'bfx:perp-key:';
function storedKey(wallet: string | undefined): Keypair | null {
  if (!wallet) return null;
  try { const s = localStorage.getItem(KEY_PREFIX + wallet); return s ? Keypair.fromSecret(s) : null; } catch { return null; }
}
function saveKey(wallet: string, kp: Keypair) {
  try { localStorage.setItem(KEY_PREFIX + wallet, kp.secret()); } catch { /* storage blocked: the key lasts this visit only */ }
}
const keyHex = (kp: Keypair) => toHex(new Uint8Array(kp.rawPublicKey()));

const px = (v: number | null | undefined, dp: number) => (v == null || !Number.isFinite(v) ? '-' : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const usd = (v: number | null | undefined, dp = 2) => (v == null || !Number.isFinite(v) ? '-' : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const signed = (v: number, dp = 2) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const pctS = (v: number, dp = 2) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;
const compact = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);

function useCountdown(to: number | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!to) return '--:--';
  const s = Math.max(0, Math.floor((to - now) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function PerpsPage() {
  const config = useQuery({ queryKey: ['perps-config'], queryFn: () => api<PerpConfig>('/api/perps/config'), refetchInterval: 30_000 });
  const markets = useQuery({ queryKey: ['perps-markets'], queryFn: () => api<{ markets: MarketView[] }>('/api/perps/markets'), refetchInterval: 3000, enabled: config.data?.enabled === true });
  const [marketId, setMarketId] = useState<number>(() => { try { return Number(localStorage.getItem('bfx:perp-market')) || 1; } catch { return 1; } });
  const market = markets.data?.markets.find((m) => m.id === marketId) ?? markets.data?.markets[0];
  useEffect(() => { try { localStorage.setItem('bfx:perp-market', String(marketId)); } catch { /* ignore */ } }, [marketId]);
  useEffect(() => {
    const pick = (e: Event) => { const id = Number((e as CustomEvent).detail); if (id) setMarketId(id); };
    window.addEventListener('bfx:perp-market', pick);
    return () => window.removeEventListener('bfx:perp-market', pick);
  }, []);

  const book = useQuery({ queryKey: ['perps-book', market?.id], queryFn: () => api<BookView>(`/api/perps/markets/${market!.id}/book`), refetchInterval: 1500, enabled: !!market });
  const [wallet, setWallet] = useState<string | undefined>();
  const [kp, setKp] = useState<Keypair | null>(null);
  const account = useQuery({
    queryKey: ['perps-account', kp ? keyHex(kp) : null],
    queryFn: () => api<AccountView>(`/api/perps/account${kp ? `?key=${keyHex(kp)}` : ''}`),
    refetchInterval: 3000, enabled: config.data?.enabled === true, retry: false,
  });
  useEffect(() => {
    const w = account.data?.wallet;
    if (w && w !== wallet) { setWallet(w); setKp(storedKey(w)); }
  }, [account.data?.wallet, wallet]);

  const [priceClick, setPriceClick] = useState<number | null>(null);
  // Phones: the chart opens on a tap (Binance style), so the first screen is form and book.
  const [showChart, setShowChart] = useState(false);
  const [showFunding, setShowFunding] = useState(false);
  // Long or Short tapped in the phone chart view: close the chart and open the form on that side.
  const [sideReq, setSideReq] = useState<{ side: 'buy' | 'sell'; at: number } | null>(null);
  const trade = (side: 'buy' | 'sell') => { setSideReq({ side, at: Date.now() }); setShowChart(false); window.scrollTo({ top: 0 }); };

  if (config.isLoading) return <div className="bx-empty"><Spin /> Loading perps...</div>;
  if (!config.data?.enabled) return <div className="bx-card"><div className="bx-empty">Perps are not available on this network yet.</div></div>;
  if (!market) return <div className="bx-empty"><Spin /> Loading markets...</div>;

  return (
    <div className={`px-wrap${showChart ? ' px-chartmode' : ''}`}>
      <MarketBar markets={markets.data?.markets ?? []} market={market} onPick={setMarketId} chartOpen={showChart} onChart={() => setShowChart(!showChart)} onFunding={() => setShowFunding(true)} />
      <div className="px-grid">
        <section className={`px-panel px-chart ${showChart ? '' : 'px-hide-sm'}`}><Chart market={market} /></section>
        <section className="px-panel px-book">
          <BookPanel market={market} book={book.data} onPrice={setPriceClick} showTrades={false} onFunding={() => setShowFunding(true)} />
        </section>
        <aside className="px-side">
          <OrderForm market={market} account={account.data} kp={kp} priceClick={priceClick} sideReq={sideReq}
            onKey={(k) => { if (wallet) { saveKey(wallet, k); setKp(k); } }} accountError={account.error as Error | null} />
          <AccountPanel account={account.data} kp={kp} config={config.data} market={market} onForget={() => { if (wallet) { try { localStorage.removeItem(KEY_PREFIX + wallet); } catch { /* ignore */ } setKp(null); } }} />
        </aside>
        <section className="px-panel px-bottom"><BottomTabs account={account.data} markets={markets.data?.markets ?? []} kp={kp} /></section>
      </div>
      <div className="px-foot">
        <span>Testnet, test USDC only.</span>
        <span>Index: {market.weekend ? 'held at the last business-day rate (weekend mode)' : 'live rate service'}.</span>
        {config.data.contractId && <a href={`${config.data.explorer}/contract/${config.data.contractId}`} target="_blank" rel="noreferrer">Clearinghouse on Stellar</a>}
        <span>Insurance fund {usd(config.data.insurance, 0)}</span>
        {config.data.vault?.equity != null && <span>Liquidity vault {usd(config.data.vault.equity, 0)}</span>}
      </div>
      {showFunding && <FundingSheet market={market} explorer={config.data.explorer} onClose={() => setShowFunding(false)} />}
      {showChart && (
        <div className="px-lsbar">
          <button className="buy" onClick={() => trade('buy')}>Long</button>
          <button className="sell" onClick={() => trade('sell')}>Short</button>
        </div>
      )}
    </div>
  );
}

// ── Market bar ────────────────────────────────────────────────────────────────

function MarketBar({ markets, market, onPick, chartOpen, onChart, onFunding }: { markets: MarketView[]; market: MarketView; onPick: (id: number) => void; chartOpen: boolean; onChart: () => void; onFunding: () => void }) {
  const [open, setOpen] = useState(false);
  const countdown = useCountdown(market.nextFundingAt);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const up = market.change24h >= 0;
  return (
    <div className="px-panel px-bar">
      <div className="px-pick" ref={ref}>
        <button className="px-pick-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Flag pair={market.pair} /><span className="px-sym">{market.base}{market.quote}-PERP</span><span className="px-lev">{market.maxLeverage}x</span><ChevronDown size={16} />
        </button>
        {open && (
          <div className="px-menu" role="listbox">
            <div className="px-menu-h"><span>Market</span><span>Mark</span><span>24h</span><span>Funding</span></div>
            {markets.map((m) => (
              <button key={m.id} className={`px-menu-row${m.id === market.id ? ' on' : ''}`} onClick={() => { onPick(m.id); setOpen(false); }}>
                <span className="px-mm"><Flag pair={m.pair} /><b>{m.base}{m.quote}</b><small>{m.maxLeverage}x</small></span>
                <span className="num">{px(m.mark, m.decimals)}</span>
                <span className={`num ${m.change24h >= 0 ? 'up' : 'down'}`}>{pctS(m.change24h)}</span>
                <span className="num">{(m.fundingPredicted * 100).toFixed(4)}%</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Phones: 24h change under the market name and a chart button beside it (Binance style). */}
      <span className={`px-mchange num ${up ? 'up' : 'down'}`}>{pctS(market.change24h)}</span>
      <button className={`px-chartbtn${chartOpen ? ' on' : ''}`} onClick={onChart} aria-label={chartOpen ? 'Hide chart' : 'Show chart'} aria-pressed={chartOpen}><CandlestickChart size={20} /></button>
      <div className="px-stat px-x-sm"><div className="k">Mark</div><div className="v num">{px(market.mark, market.decimals)}</div></div>
      <div className="px-stat px-x-sm"><div className="k" title="The official rate the market tracks">Index</div><div className="v num">{px(market.index, market.decimals)}</div></div>
      <div className="px-stat px-x-sm"><div className="k">24h change</div><div className={`v num ${up ? 'up' : 'down'}`}>{pctS(market.change24h)}</div></div>
      <div className="px-stat px-x-sm"><div className="k">24h volume</div><div className="v num">{compact(market.volume24h)}</div></div>
      <div className="px-stat px-x-sm"><div className="k">Open interest</div><div className="v num">{compact(market.openInterest)}</div></div>
      <button className="px-stat px-x-sm px-fundbtn" onClick={onFunding} title="See how funding works and its recent history"><div className="k">Funding / countdown</div>
        <div className="v num"><span className={market.fundingPredicted >= 0 ? 'up' : 'down'}>{(market.fundingPredicted * 100).toFixed(4)}%</span> <span className="muted">{countdown}</span></div></button>
      {market.weekend && <span className="px-pill amber" title="Official rates do not fix at weekends. The index holds at Friday's rate and funding is interest only.">Weekend mode</span>}
      {market.status === 2 && <span className="px-pill amber">Reduce-only</span>}
    </div>
  );
}

// ── Chart ─────────────────────────────────────────────────────────────────────

const INTERVALS: [number, string][] = [[1, '1m'], [5, '5m'], [15, '15m'], [30, '30m'], [60, '1h'], [120, '2h'], [240, '4h'], [1440, '1D'], [10080, '1W'], [43200, '1M'], [0, 'MAX']];

/**
 * Candle chart that fills its panel. Drag sideways to move through history, scroll (or pinch) to
 * zoom, double-click to reset. Timeframes sit underneath. BlockFinaX tint and watermark behind.
 */
function Chart({ market }: { market: MarketView }) {
  const [interval, setIntervalMin] = useState(1440);
  const candles = useQuery({ queryKey: ['perps-candles', market.id, interval], queryFn: () => api<{ candles: Candle[]; source?: 'market' | 'mark' | 'official' }>(`/api/perps/markets/${market.id}/candles?i=${interval}`), refetchInterval: 10_000 });
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 700, h: 380 });
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: Math.max(320, el.clientHeight) }));
    ro.observe(el); setSize({ w: el.clientWidth, h: Math.max(320, el.clientHeight) });
    return () => ro.disconnect();
  }, []);
  const all = candles.data?.candles ?? [];
  const W = size.w, H = size.h, padR = 74, padB = 24, padT = 12;
  const [count, setCount] = useState<number | null>(null); // candles shown; null = fit
  const [end, setEnd] = useState(0); // candles hidden on the right (0 = latest)
  useEffect(() => { setCount(null); setEnd(0); }, [interval, market.id]);
  const shown = Math.min(all.length, Math.max(15, count ?? Math.floor((W - padR) / 9)));
  const maxEnd = Math.max(0, all.length - shown);
  const e = Math.min(end, maxEnd);
  const data = all.slice(Math.max(0, all.length - e - shown), all.length - e);
  const step = (W - padR) / Math.max(1, data.length);

  // Drag to pan
  const drag = useRef<{ x: number; end: number } | null>(null);
  const onDown = (ev: React.PointerEvent) => { drag.current = { x: ev.clientX, end: e }; (ev.target as Element).setPointerCapture?.(ev.pointerId); };
  const onMove = (ev: React.PointerEvent) => {
    if (drag.current) { setEnd(Math.max(0, Math.min(maxEnd, drag.current.end + Math.round((ev.clientX - drag.current.x) / step)))); setHover(null); return; }
    const r = box.current?.getBoundingClientRect(); if (!r) return;
    const i = Math.floor((ev.clientX - r.left) / step);
    setHover(i >= 0 && i < data.length ? i : null);
  };
  const onUp = () => { drag.current = null; };
  // Wheel to zoom (needs a non-passive listener to stop the page scrolling)
  useEffect(() => {
    const el = box.current; if (!el) return;
    const wheel = (ev: WheelEvent) => {
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) { setEnd((x) => Math.max(0, Math.min(maxEnd, x - Math.round(ev.deltaX / 12)))); ev.preventDefault(); return; }
      ev.preventDefault();
      setCount((c) => Math.max(15, Math.min(all.length || 15, Math.round((c ?? shown) * (ev.deltaY > 0 ? 1.12 : 0.89)))));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [all.length, shown, maxEnd]);
  const [hover, setHover] = useState<number | null>(null);
  // Candles unless the viewer picks Line (useful for thinly traded currencies).
  const [style, setStyle] = useState<'candles' | 'line'>('candles');
  const asLine = style === 'line';

  const view = useMemo(() => {
    if (!data.length) return null;
    let lo = Math.min(...data.map((c) => c.l)), hi = Math.max(...data.map((c) => c.h));
    if (e === 0) { lo = Math.min(lo, market.mark); hi = Math.max(hi, market.mark); }
    if (hi - lo < hi * 0.0005) { hi *= 1.0005; lo *= 0.9995; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const y = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
    const ticks = Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 6);
    return { y, ticks };
  }, [data, H, market.mark, e]);
  const h = hover != null ? data[hover] : null;
  const label = (t: number) => {
    const d = new Date(t);
    if (interval >= 10080 || interval === 0) return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    return interval >= 1440 ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
  return (
    <div className="px-chart-in">
      <div className="px-chart-h">
        <span className="num px-ohlc">{h ? <>O <b>{px(h.o, market.decimals)}</b> H <b>{px(h.h, market.decimals)}</b> L <b>{px(h.l, market.decimals)}</b> C <b className={h.c >= h.o ? 'up' : 'down'}>{px(h.c, market.decimals)}</b> <span className="muted">{new Date(h.t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: interval >= 10080 || interval === 0 ? 'numeric' : undefined, hour: interval > 0 && interval < 1440 ? '2-digit' : undefined, minute: interval > 0 && interval < 1440 ? '2-digit' : undefined })}</span></> : <span className="muted">{candles.data?.source === 'market' ? `${market.pair} market quotes, delayed` : candles.data?.source === 'official' ? `${market.pair} daily rate` : `${market.pair} mark price`} · dashed line is mark</span>}</span>
        {e > 0 && <button className="px-latest" onClick={() => setEnd(0)}>Latest →</button>}
      </div>
      <div ref={box} className="px-chart-svg" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { onUp(); setHover(null); }} onDoubleClick={() => { setCount(null); setEnd(0); }}>
        <div className="px-watermark" aria-hidden="true">BlockFinaX</div>
        {!view ? <div className="bx-empty">{candles.isLoading ? 'Loading chart...' : 'The chart fills in as the market runs.'}</div> : (
          <svg width={W} height={H} role="img" aria-label={`${market.pair} candles`}>
            {view.ticks.map((t) => (
              <g key={t}><line x1={0} x2={W - padR} y1={view.y(t)} y2={view.y(t)} className="px-grid-l" />
                <text x={W - padR + 6} y={view.y(t) + 4} className="px-axis">{px(t, market.decimals)}</text></g>
            ))}
            {asLine && (() => {
              const pts = data.map((c, i) => `${(i * step + step / 2).toFixed(1)},${view.y(c.c).toFixed(1)}`);
              const first = data[0], last = data[data.length - 1];
              const up = last.c >= first.o;
              return (
                <g className={up ? 'px-lu' : 'px-ld'}>
                  <polygon points={`${step / 2},${H - padB} ${pts.join(' ')} ${(data.length - 1) * step + step / 2},${H - padB}`} className="px-larea" />
                  <polyline points={pts.join(' ')} className="px-lline" />
                </g>
              );
            })()}
            {!asLine && data.map((c, i) => {
              const x = i * step + step / 2, up = c.c >= c.o;
              const bw = Math.max(1, step * 0.66);
              const y1 = view.y(Math.max(c.o, c.c)), y2 = view.y(Math.min(c.o, c.c));
              return (
                <g key={c.t} className={up ? 'px-cu' : 'px-cd'} opacity={hover == null || hover === i ? 1 : 0.85}>
                  <line x1={x} x2={x} y1={view.y(c.h)} y2={view.y(c.l)} />
                  <rect x={x - bw / 2} y={y1} width={bw} height={Math.max(1, y2 - y1)} />
                </g>
              );
            })}
            {hover != null && <line x1={hover * step + step / 2} x2={hover * step + step / 2} y1={padT} y2={H - padB} className="px-cross" />}
            {(() => { const yy = view.y(market.mark); return yy > padT && yy < H - padB ? (
              <g><line x1={0} x2={W - padR} y1={yy} y2={yy} className="px-markline" />
                <rect x={W - padR + 2} y={yy - 9} width={padR - 4} height={18} rx={4} className="px-marktag" />
                <text x={W - padR + 6} y={yy + 4} className="px-marktxt">{px(market.mark, market.decimals)}</text></g>
            ) : null; })()}
            {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 7)) === 0).map((c) => {
              const i = data.indexOf(c);
              return <text key={c.t} x={i * step + step / 2} y={H - 6} className="px-axis" textAnchor="middle">{label(c.t)}</text>;
            })}
          </svg>
        )}
      </div>
      <div className="px-chart-f">
        <div className="px-ivs">{INTERVALS.map(([m, l]) => <button key={m} className={interval === m ? 'on' : ''} onClick={() => setIntervalMin(m)}>{l}</button>)}</div>
        <div className="px-style" role="group" aria-label="Chart style">
          <button className={!asLine ? 'on' : ''} onClick={() => setStyle('candles')}>Candles</button>
          <button className={asLine ? 'on' : ''} onClick={() => setStyle('line')}>Line</button>
        </div>
        <span className="muted px-hint-s">Drag to move · scroll to zoom</span>
      </div>
    </div>
  );
}

// ── Order book and trades ─────────────────────────────────────────────────────

function BookPanel({ market, book, onPrice, showTrades, onFunding }: { market: MarketView; book?: BookView; onPrice: (p: number) => void; showTrades: boolean; onFunding: () => void }) {
  const fundCountdown = useCountdown(market.nextFundingAt);
  const [tab, setTab] = useState<'book' | 'trades'>('book');
  const t = showTrades ? 'trades' : tab;
  const asks = (book?.asks ?? []).slice(0, 11).reverse();
  const bids = (book?.bids ?? []).slice(0, 11);
  const max = Math.max(1, ...[...asks, ...bids].map((l) => l.size * l.price));
  let cumA = 0; const asksCum = [...(book?.asks ?? []).slice(0, 11)].map((l) => (cumA += l.size * l.price)).reverse();
  let cumB = 0; const bidsCum = bids.map((l) => (cumB += l.size * l.price));
  const maxCum = Math.max(1, cumA, cumB);
  const best = { bid: bids[0]?.price, ask: book?.asks[0]?.price };
  const spread = best.bid && best.ask ? best.ask - best.bid : null;
  void max;
  return (
    <div className="px-book-in">
      <div className="px-ob-fund" role="button" tabIndex={0} onClick={onFunding} onKeyDown={(e) => { if (e.key === 'Enter') onFunding(); }}><span>Funding / countdown ›</span><b className="num"><span className={market.fundingPredicted >= 0 ? 'up' : 'down'}>{(market.fundingPredicted * 100).toFixed(4)}%</span> / {fundCountdown}</b></div>
      <div className="px-tabs bx-hide-sm">
        <button className={t === 'book' ? 'on' : ''} onClick={() => setTab('book')}>Order book</button>
        <button className={t === 'trades' ? 'on' : ''} onClick={() => setTab('trades')}>Trades</button>
      </div>
      {t === 'book' ? (
        <div className="px-ob">
          <div className="px-ob-h"><span>Price</span><span>Size ({market.base})</span><span>Total</span></div>
          <div className="px-ob-side asks">{asks.map((l, i) => (
            <button key={`a${l.price}`} className="px-ob-row ask" onClick={() => onPrice(l.price)}>
              <i style={{ width: `${(asksCum[i] / maxCum) * 100}%` }} />
              <span className="num">{px(l.price, market.decimals)}</span><span className="num">{px(l.size * l.price, 0)}</span><span className="num">{compact(asksCum[i])}</span>
            </button>
          ))}</div>
          <div className="px-ob-mid">
            <span className="num">{px(market.mark, market.decimals)}</span>
            <span className="muted">Spread {spread != null ? `${px(spread, market.decimals)} (${((spread / market.mark) * 100).toFixed(3)}%)` : '-'}</span>
          </div>
          <div className="px-ob-side bids">{bids.map((l, i) => (
            <button key={`b${l.price}`} className="px-ob-row bid" onClick={() => onPrice(l.price)}>
              <i style={{ width: `${(bidsCum[i] / maxCum) * 100}%` }} />
              <span className="num">{px(l.price, market.decimals)}</span><span className="num">{px(l.size * l.price, 0)}</span><span className="num">{compact(bidsCum[i])}</span>
            </button>
          ))}</div>
          <div className="px-ob-note muted">Sizes in USD notional. The liquidity vault quotes on published rules.</div>
        </div>
      ) : (
        <div className="px-ob">
          <div className="px-ob-h"><span>Price</span><span>Size (USD)</span><span>Time</span></div>
          {(book?.trades ?? []).length === 0 && <div className="bx-empty">No trades yet.</div>}
          {(book?.trades ?? []).map((tr, i) => (
            <div key={i} className={`px-ob-row ${tr.takerBuy ? 'bid' : 'ask'}`}>
              <span className="num">{px(tr.price, market.decimals)}</span><span className="num">{px(tr.size * tr.price, 0)}</span>
              <span className="num muted">{new Date(tr.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Order form ────────────────────────────────────────────────────────────────

async function sendOrder(kp: Keypair, contractId: string, wallet: string, m: MarketView, a: { isBuy: boolean; price: number; units: number; tif: TimeInForce; reduceOnly: boolean }) {
  const now = Math.floor(Date.now() / 1000);
  const order: PerpOrder = {
    account: wallet, key: keyHex(kp), market: m.id, isBuy: a.isBuy,
    price: priceFromNumber(Number(a.price.toFixed(m.decimals))), size: sizeFromNumber(a.units),
    nonce: BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)),
    expiry: BigInt(now + (a.tif === 'ioc' ? 120 : 28 * 86_400)), reduceOnly: a.reduceOnly,
  };
  const digest = orderDigest(contractId, order);
  const sig = toHex(new Uint8Array(kp.sign(Buffer.from(digest))));
  return api<{ hash: string; status: string; filled: number; fills: { price: number; size: number }[] }>('/api/perps/orders', { order: orderToJson(order), sig, tif: a.tif });
}

function OrderForm({ market, account, kp, priceClick, sideReq, onKey, accountError }: {
  market: MarketView; account?: AccountView; kp: Keypair | null; priceClick: number | null; sideReq?: { side: 'buy' | 'sell'; at: number } | null; onKey: (k: Keypair) => void; accountError: Error | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['perps-config'], queryFn: () => api<PerpConfig>('/api/perps/config') });
  const takerBps = config.data?.fees?.takerBps ?? 5, makerBps = config.data?.fees?.makerBps ?? 0;
  const [type, setType] = useState<'market' | 'limit'>('market');
  const [side, setSide] = useState<'buy' | 'sell'>(sideReq?.side ?? 'buy');
  useEffect(() => { if (sideReq) setSide(sideReq.side); }, [sideReq?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [lev, setLev] = useState(Math.min(3, market.maxLeverage));
  const [showLev, setShowLev] = useState(false);
  const [price, setPrice] = useState('');
  const [sizeUsd, setSizeUsd] = useState('');
  const [pctFill, setPctFill] = useState(0);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [tif, setTif] = useState<TimeInForce>('gtc');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setLev((l) => Math.min(l, market.maxLeverage)); setPrice(''); }, [market.id, market.maxLeverage]);
  useEffect(() => { if (priceClick != null) { setType('limit'); setPrice(String(priceClick)); } }, [priceClick]);

  const pos = account?.positions.find((p) => p.market === market.id);
  const isBuy = side === 'buy';
  const refPrice = type === 'limit' && Number(price) > 0 ? Number(price) : market.mark;
  const available = account?.available ?? 0;
  const maxUsd = Math.max(0, available * lev * 0.98);
  const notional = Number(sizeUsd) || 0;
  const units = notional / refPrice;
  const margin = notional / lev;
  const fee = type === 'market' ? notional * 0.0005 : 0;
  const keyOk = !!kp && account?.key?.approved === true;
  const hasMoney = (account?.onChain.collateral ?? 0) > 0;
  const balances = useUsdcBalances();
  const walletUsdc = balances.data?.total ?? 0;

  // Estimated liquidation price for the position after this order (this market only).
  const estLiq = useMemo(() => {
    if (!account || !notional) return null;
    const cur = pos?.size ?? 0;
    const d = isBuy ? units : -units;
    const next = cur + d;
    if (Math.abs(next) < 1e-9) return null;
    const mm = market.maintBps / 10_000;
    const otherValue = account.equity - (pos ? pos.upnl : 0) - fee;
    const entry = cur === 0 || Math.sign(cur) === Math.sign(d) ? ((Math.abs(cur) * (pos?.entry ?? 0)) + units * refPrice) / Math.abs(next) : (Math.sign(next) === Math.sign(cur) ? pos!.entry : refPrice);
    const othersMaint = account.maintenance - (pos ? pos.notional * mm : 0);
    const p = (othersMaint - otherValue + next * entry) / (next - Math.abs(next) * mm);
    return p > 0 && Number.isFinite(p) ? p : null;
  }, [account, notional, units, isBuy, pos, market.maintBps, refPrice, fee]);

  const enable = async () => {
    try {
      const k = kp ?? Keypair.random();
      if (!kp) onKey(k);
      setBusy('Approve with your passkey');
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/perps/prepare/approve-key', { key: keyHex(k), days: 90 });
      await signAndSend(transactions, (m) => setBusy(m));
      setBusy('Waiting for the network');
      for (let i = 0; i < 20; i++) {
        const a = await api<AccountView>(`/api/perps/account?key=${keyHex(k)}`);
        if (a.key?.approved) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      await qc.invalidateQueries({ queryKey: ['perps-account'] });
      toast({ title: 'Trading enabled', description: 'Orders on this device are now signed by a trading key that cannot withdraw.' });
    } catch (e) {
      toast({ title: 'Trading not enabled', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const submit = async () => {
    if (!kp || !account || !config.data?.contractId) return;
    if (!(notional > 0)) { toast({ title: 'Enter a size', variant: 'destructive' }); return; }
    if (type === 'limit' && !(Number(price) > 0)) { toast({ title: 'Enter a limit price', variant: 'destructive' }); return; }
    setBusy('Placing order');
    try {
      const limit = type === 'market' ? market.mark * (isBuy ? 1.02 : 0.98) : Number(price);
      const r = await sendOrder(kp, config.data.contractId, account.wallet, market, { isBuy, price: limit, units, tif: type === 'market' ? 'ioc' : tif, reduceOnly });
      const what = `${isBuy ? 'Long' : 'Short'} ${market.base}${market.quote}`;
      if (r.filled > 0) {
        const avg = r.fills.reduce((s, f) => s + f.price * f.size, 0) / r.fills.reduce((s, f) => s + f.size, 0);
        toast({ title: `${what}: filled`, description: `${usd(r.filled * avg)} at ${px(avg, market.decimals)}${r.status === 'open' ? ', the rest is resting on the book' : ''}. Settling on Stellar.` });
      } else if (r.status === 'open') toast({ title: `${what}: order placed`, description: `Resting at ${px(Number(price), market.decimals)}.` });
      else toast({ title: 'Not filled', description: 'No liquidity at that price. Nothing was traded.' });
      setSizeUsd(''); setPctFill(0);
      await qc.invalidateQueries({ queryKey: ['perps-account'] });
      await qc.invalidateQueries({ queryKey: ['perps-book'] });
    } catch (e) {
      toast({ title: 'Order refused', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const setFromPct = (p: number) => { setPctFill(p); setSizeUsd(p > 0 ? String(Math.floor((maxUsd * p) / 100)) : ''); };

  if (accountError) return <div className="px-panel px-form"><div className="bx-empty">{/personal/.test(accountError.message) ? 'Perps are for personal accounts for now. Switch to your personal account in the account menu.' : 'Sign in to trade.'}</div></div>;

  return (
    <div className="px-panel px-form">
      <div className="px-form-top">
        <span className="px-chip">Cross</span>
        <button className="px-chip lev" onClick={() => setShowLev(!showLev)}>{lev}x</button>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>Max {market.maxLeverage}x</span>
      </div>
      {showLev && (
        <div className="px-lev-box">
          <div className="px-lev-row"><span>Leverage</span><b className="num">{lev}x</b></div>
          <input id="px-lev" type="range" min={1} max={market.maxLeverage} step={1} value={lev} onChange={(e) => setLev(Number(e.target.value))} aria-label="Leverage" />
          <div className="muted" style={{ fontSize: 12 }}>Sets the most you can open with your margin. Maintenance margin on {market.pair} is {(market.maintBps / 100).toFixed(1)}%.</div>
        </div>
      )}
      <div className="px-side-toggle">
        <button className={`buy${isBuy ? ' on' : ''}`} onClick={() => setSide('buy')}>Buy / Long</button>
        <button className={`sell${!isBuy ? ' on' : ''}`} onClick={() => setSide('sell')}>Sell / Short</button>
      </div>
      <div className="px-seg">
        <button className={type === 'market' ? 'on' : ''} onClick={() => setType('market')}>Market</button>
        <button className={type === 'limit' ? 'on' : ''} onClick={() => setType('limit')}>Limit</button>
      </div>
      <div className="px-kv px-x-sm"><span>Perps balance</span><b className="num">{usd(account?.onChain.collateral ?? 0)}</b></div>
      <div className="px-kv"><span>Available to trade</span><b className="num">{usd(available)}</b></div>
      <div className="px-kv px-x-sm"><span>In your wallet</span><b className="num">{usd(walletUsdc)}{walletUsdc > 0 && !hasMoney && <button className="px-link inline" onClick={() => document.getElementById('px-deposit-btn')?.click()}>Move to perps</button>}</b></div>
      <div className="px-kv px-x-sm"><span>Current position</span><b className={`num ${pos ? (pos.size > 0 ? 'up' : 'down') : ''}`}>{pos ? `${pos.size > 0 ? 'Long' : 'Short'} ${usd(pos.notional, 0)}` : '-'}</b></div>
      {type === 'limit' && (
        <label className="px-in"><span>Price ({market.quote})</span>
          <input id="px-price" className="num" inputMode="decimal" value={price} placeholder={px(market.mark, market.decimals)} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} />
          <button className="px-mini" onClick={() => setPrice(market.mark.toFixed(market.decimals))}>Mark</button>
        </label>
      )}
      <label className="px-in"><span>Size</span>
        <input id="px-size" className="num" inputMode="decimal" value={sizeUsd} placeholder="0" onChange={(e) => { setSizeUsd(e.target.value.replace(/[^0-9.]/g, '')); setPctFill(0); }} />
        <span className="px-unit">USD</span>
      </label>
      <input id="px-pct" type="range" min={0} max={100} step={1} value={pctFill} disabled={maxUsd <= 0} onChange={(e) => setFromPct(Number(e.target.value))} aria-label="Share of what you can open" className="px-pct" />
      <div className="px-pct-l muted"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
      <div className="px-opts">
        <label><input id="px-ro" type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} /> Reduce only</label>
        {type === 'limit' && (
          <select id="px-tif" value={tif} onChange={(e) => setTif(e.target.value as TimeInForce)} aria-label="Time in force">
            <option value="gtc">Good till cancelled</option>
            <option value="ioc">Immediate or cancel</option>
            <option value="alo">Post only</option>
          </select>
        )}
      </div>

      {!account ? <button className="px-cta" disabled><Spin /> Loading account</button>
        : !keyOk ? <button className="px-cta blue" disabled={!!busy} onClick={enable}>{busy ? <><Spin /> {busy}</> : <><KeyRound size={16} /> Enable trading</>}</button>
        : !hasMoney ? <button className="px-cta blue" onClick={() => { const b = document.getElementById('px-deposit-btn'); b?.click(); b?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Deposit USDC to trade</button>
        : <button className={`px-cta ${isBuy ? 'buy' : 'sell'}`} disabled={!!busy} onClick={submit}>{busy ? <><Spin /> {busy}</> : `${isBuy ? 'Buy / Long' : 'Sell / Short'} ${market.base}${market.quote}`}</button>}

      <div className="px-sum">
        <div><span>Liquidation price</span><b className="num">{estLiq ? px(estLiq, market.decimals) : '-'}</b></div>
        <div className="px-x-sm"><span>Order value</span><b className="num">{notional ? usd(notional) : '-'}</b></div>
        <div><span>Margin required</span><b className="num">{notional ? usd(margin) : '-'}</b></div>
        {type === 'market' && <div className="px-x-sm"><span>Slippage limit</span><b className="num">2.00%</b></div>}
        <div><span>Fees</span><b className="num">{type === 'market' ? `${(takerBps / 100).toFixed(3)}% taker` : `${(makerBps / 100).toFixed(3)}% maker`}{notional ? ` · ${usd(notional * ((type === 'market' ? takerBps : makerBps) / 10_000))}` : ''}</b></div>
      </div>
      {!keyOk && account && <div className="px-hint"><ShieldCheck size={14} /> Your passkey approves a trading key once. It can place and cancel orders, but can never withdraw your USDC.</div>}
      {notional > maxUsd && keyOk && <div className="px-hint warn">Above what your margin allows at {lev}x ({usd(maxUsd, 0)}).</div>}
    </div>
  );
}

// ── Account panel: deposit and withdraw ──────────────────────────────────────

function AccountPanel({ account, kp, config, market, onForget }: { account?: AccountView; kp: Keypair | null; config: PerpConfig; market: MarketView; onForget: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const balances = useUsdcBalances();
  const [mode, setMode] = useState<null | 'deposit' | 'withdraw'>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const walletUsdc = balances.data?.total ?? 0;
  const run = async () => {
    const n = Number(amount);
    if (!(n > 0)) return;
    setBusy('Preparing');
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/perps/prepare/${mode}`, { amount: n });
      await signAndSend(transactions, (m) => setBusy(m));
      setBusy('Waiting for the network');
      const before = account?.onChain.collateral ?? 0;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const a = await api<AccountView>('/api/perps/account');
        if (Math.abs(a.onChain.collateral - before) > 0.000001) break;
      }
      await api('/api/perps/sync', {});
      await qc.invalidateQueries({ queryKey: ['perps-account'] });
      await qc.invalidateQueries({ queryKey: ['v2-usdc-all'] });
      toast({ title: mode === 'deposit' ? 'Deposited to perps' : 'Withdrawn to your wallet', description: `${usd(n)} USDC.` });
      setMode(null); setAmount('');
    } catch (e) {
      toast({ title: mode === 'deposit' ? 'Deposit failed' : 'Withdrawal failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  };
  const upnl = account?.positions.reduce((s, p) => s + p.upnl, 0) ?? 0;
  const ratio = account && account.equity > 0 ? account.maintenance / account.equity : 0;
  const lev = account && account.equity > 0 ? account.notional / account.equity : 0;
  void config; void market;
  return (
    <div className="px-panel px-acct">
      <div className="px-acct-h"><b>Account</b>
        <div className="px-acct-btns">
          <button id="px-deposit-btn" className={`px-mini${mode === 'deposit' ? ' on' : ''}`} onClick={() => setMode(mode === 'deposit' ? null : 'deposit')}>Deposit</button>
          <button className={`px-mini${mode === 'withdraw' ? ' on' : ''}`} onClick={() => setMode(mode === 'withdraw' ? null : 'withdraw')}>Withdraw</button>
        </div>
      </div>
      {mode && (
        <div className="px-move">
          <div className="px-kv"><span>{mode === 'deposit' ? 'In your wallet' : 'Withdrawable'}</span><b className="num">{usd(mode === 'deposit' ? walletUsdc : account?.onChain.withdrawable ?? 0)}</b></div>
          <label className="px-in"><span>Amount</span>
            <input id="px-move-amt" className="num" inputMode="decimal" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
            <button className="px-mini" onClick={() => setAmount(String(Math.floor(((mode === 'deposit' ? walletUsdc : account?.onChain.withdrawable ?? 0)) * 100) / 100))}>Max</button>
          </label>
          <button className="px-cta blue" disabled={!!busy || !(Number(amount) > 0)} onClick={run}>{busy ? <><Spin /> {busy}</> : mode === 'deposit' ? 'Deposit USDC' : 'Withdraw USDC'}</button>
          <div className="muted" style={{ fontSize: 12 }}>{mode === 'deposit' ? 'USDC moves from your wallet into the clearinghouse contract, where it backs your positions. Network fees are covered.' : 'Margin in use by open positions stays in the contract.'}</div>
        </div>
      )}
      <div className="px-kv"><span>Account equity</span><b className="num">{usd(account?.equity)}</b></div>
      <div className="px-kv"><span>Balance</span><b className="num">{usd(account?.onChain.collateral)}</b></div>
      <div className="px-kv"><span>Unrealised PnL</span><b className={`num ${upnl >= 0 ? 'up' : 'down'}`}>{account ? signed(upnl) : '-'}</b></div>
      <div className="px-kv"><span>Margin used</span><b className="num">{usd(account?.initial)}</b></div>
      <div className="px-kv"><span>Maintenance margin</span><b className="num">{usd(account?.maintenance)}</b></div>
      <div className="px-kv"><span title="Maintenance margin as a share of equity. Liquidation at 100%.">Cross margin ratio</span><b className={`num ${ratio > 0.7 ? 'down' : ''}`}>{(ratio * 100).toFixed(2)}%</b></div>
      <div className="px-kv"><span>Cross account leverage</span><b className="num">{lev.toFixed(2)}x</b></div>
      {kp && account?.key?.approved && <button className="px-link" onClick={onForget}>Forget the trading key on this device</button>}
    </div>
  );
}


// ── Funding sheet: opened from the funding rate at the top ───────────────────

function FundingSheet({ market, explorer, onClose }: { market: MarketView; explorer?: string; onClose: () => void }) {
  const hist = useQuery({ queryKey: ['perps-funding', market.id], queryFn: () => api<{ funding: { rate: number; at: string; tx: string | null }[] }>(`/api/perps/markets/${market.id}/funding`), refetchInterval: 60_000 });
  const countdown = useCountdown(market.nextFundingAt);
  const rate = market.fundingPredicted;
  return (
    <div className="px-sheet-bg" onClick={onClose}>
      <div className="px-sheet px-fsheet" role="dialog" aria-modal="true" aria-label="Funding" onClick={(e) => e.stopPropagation()}>
        <i className="px-sheet-grab" aria-hidden="true" />
        <h3>Funding · {market.base}{market.quote}</h3>
        <div className="px-sheet-row total"><span>Next hourly rate</span><b className={`num ${rate >= 0 ? 'up' : 'down'}`}>{(rate * 100).toFixed(4)}%</b></div>
        <div className="px-sheet-row"><span>Paid in</span><b className="num">{countdown}</b></div>
        <p className="px-sheet-note">Every hour, longs and shorts pay each other to keep the perp close to the official rate. {rate >= 0 ? 'Right now longs pay shorts.' : 'Right now shorts pay longs.'} BlockFinaX takes no part of it.</p>
        <div className="px-fhist">
          <div className="px-fhist-h"><span>Time</span><span>Hourly rate</span><span>Who paid</span></div>
          {hist.isLoading && <div className="muted px-fhist-empty"><Spin /> Loading</div>}
          {hist.data && !hist.data.funding.length && <div className="muted px-fhist-empty">No funding paid yet on this market.</div>}
          {hist.data?.funding.map((f, i) => (
            <div key={i} className="px-fhist-row">
              <span className="num muted">{new Date(f.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <span className={`num ${f.rate >= 0 ? 'up' : 'down'}`}>{(f.rate * 100).toFixed(4)}%</span>
              <span>{f.tx && explorer ? <a href={`${explorer}/tx/${f.tx}`} target="_blank" rel="noreferrer">{f.rate >= 0 ? 'Longs' : 'Shorts'}</a> : (f.rate >= 0 ? 'Longs' : 'Shorts')}</span>
            </div>
          ))}
        </div>
        <button className="px-pcard-close" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

// ── Positions, orders, history ────────────────────────────────────────────────

function AdlLights({ n }: { n: number }) {
  return <span className="px-adl" title={`Auto-deleveraging queue: ${n} of 5. More lights means earlier in the queue if the insurance fund ever runs out.`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? `on l${n}` : ''} />)}</span>;
}

function BottomTabs({ account, markets, kp }: { account?: AccountView; markets: MarketView[]; kp: Keypair | null }) {
  const [tab, setTab] = useState<'positions' | 'orders' | 'trades' | 'funding' | 'history'>('positions');
  const [pnlSheet, setPnlSheet] = useState<number | null>(null);
  // Cross margin ratio for the whole account; with no equity left it is past 100% (liquidation).
  const ratio = account ? (account.equity > 0 ? account.maintenance / account.equity : Infinity) : 0;
  // 7: the sheet belongs to one open position; close it when that position goes or the tab changes.
  useEffect(() => { setPnlSheet(null); }, [tab]);
  useEffect(() => {
    if (pnlSheet != null && !account?.positions.some((x) => x.market === pnlSheet)) setPnlSheet(null);
  }, [account, pnlSheet]);
  const { toast } = useToast();
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['perps-config'], queryFn: () => api<PerpConfig>('/api/perps/config') });
  const [busy, setBusy] = useState<string | null>(null);
  const dec = (id: number) => markets.find((m) => m.id === id)?.decimals ?? 2;
  // The leverage the position's margin is worked out from (Binance's "Cross 20X"):
  // value = margin x this. The contract sets margin at the market's maximum leverage.
  const posLev = (market: number) => {
    const m = markets.find((x) => x.id === market);
    return m ? `${m.maxLeverage}x` : null;
  };
  const close = async (p: PositionView) => {
    const m = markets.find((x) => x.id === p.market);
    if (!kp || !account || !m || !config.data?.contractId) return;
    setBusy(`close-${p.market}`);
    try {
      const isBuy = p.size < 0;
      const r = await sendOrder(kp, config.data.contractId, account.wallet, m, { isBuy, price: m.mark * (isBuy ? 1.02 : 0.98), units: Math.abs(p.size), tif: 'ioc', reduceOnly: true });
      toast({ title: r.filled > 0 ? `${p.pair} position closed` : 'Not closed', description: r.filled > 0 ? 'Settling on Stellar.' : 'No liquidity at that price.' });
      await qc.invalidateQueries({ queryKey: ['perps-account'] });
    } catch (e) {
      toast({ title: 'Close refused', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  };
  const cancel = async (hash?: string) => {
    try {
      await api('/api/perps/orders/cancel', hash ? { hash } : { all: true });
      await qc.invalidateQueries({ queryKey: ['perps-account'] });
    } catch (e) { toast({ title: 'Cancel failed', description: (e as Error).message, variant: 'destructive' }); }
  };
  const n = (x?: unknown[]) => (x?.length ? ` (${x.length})` : '');
  // Phones show each row as a card: copy the column headings onto the cells as labels.
  const tablesRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    tablesRef.current?.querySelectorAll('table').forEach((t) => {
      const heads = Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '');
      t.querySelectorAll('tbody tr').forEach((tr) => Array.from(tr.children).forEach((td, i) => { (td as HTMLElement).dataset.label = heads[i] ?? ''; }));
    });
  });

  return (
    <div ref={tablesRef}>
      <div className="px-tabs">
        <button className={tab === 'positions' ? 'on' : ''} onClick={() => setTab('positions')}>Positions{n(account?.positions)}</button>
        <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>Open orders{n(account?.openOrders)}</button>
        <button className={tab === 'trades' ? 'on' : ''} onClick={() => setTab('trades')}>Trade history</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Order history</button>
      </div>
      <div className="px-table">
        {tab === 'positions' && (
          !account?.positions.length ? <div className="bx-empty">No open positions.</div> : (<>
            <table className="px-pos-table">
              <thead><tr><th>Market</th><th title="Position size in USD: margin x leverage">Size (USD)</th><th>Entry</th><th>Mark</th><th>PnL (ROE)</th><th>Liq. price</th><th>Margin</th><th>Funding</th><th title="Auto-deleveraging queue">ADL</th><th /></tr></thead>
              <tbody>{account.positions.map((p) => (
                <tr key={p.market}>
                  <td><span className={`px-side-bar ${p.size > 0 ? 'long' : 'short'}`} /><b>{p.pair}</b> <span className={p.size > 0 ? 'up' : 'down'}>{p.size > 0 ? 'Long' : 'Short'}</span>{posLev(p.market) && <span className="px-poslev" title="Margin is the position's value divided by this leverage">{posLev(p.market)}</span>}{!p.settled && <span className="px-pill tiny" title="Filled; settling on Stellar">settling</span>}</td>
                  <td className="num">{usd(p.notional)}</td>
                  <td className="num">{px(p.entry, dec(p.market))}</td>
                  <td className="num">{px(p.mark, dec(p.market))}</td>
                  <td className={`num ${p.upnl >= 0 ? 'up' : 'down'}`}>{signed(p.upnl)} ({pctS(p.roe)})</td>
                  <td className="num">{px(p.liquidationPrice, dec(p.market))}</td>
                  <td className="num">{usd(p.margin)}</td>
                  <td className={`num ${p.fundingOwed > 0 ? 'down' : 'up'}`}>{p.fundingOwed ? signed(-p.fundingOwed) : '$0.00'}</td>
                  <td><AdlLights n={p.adl} /></td>
                  <td><button className="px-mini" disabled={busy !== null || !kp} onClick={() => close(p)}>{busy === `close-${p.market}` ? <Spin /> : 'Close'}</button></td>
                </tr>
              ))}</tbody>
            </table>
            {/* Phones: one card per position, laid out like Binance. */}
            <div className="px-pos-cards">{account.positions.map((p) => {
              return (
                <div key={p.market} className="px-pcard">
                  <div className="px-pcard-h">
                    <span className={`px-side-bar ${p.size > 0 ? 'long' : 'short'}`} />
                    <b>{p.pair}</b><span className={`px-pdir ${p.size > 0 ? 'up' : 'down'}`}>{p.size > 0 ? 'Long' : 'Short'}</span><span className="px-ptag">Perp</span>
                    {posLev(p.market) && <span className="px-ptag">Cross {posLev(p.market)}</span>}
                    <AdlLights n={p.adl} />
                    {!p.settled && <span className="px-pill tiny">settling</span>}
                  </div>
                  <div className="px-pcard-pnl">
                    <div><span>PnL (USD)</span><b className={`num ${p.upnl >= 0 ? 'up' : 'down'}`}>{signed(p.upnl)}</b></div>
                    <div className="r"><span>ROE</span><b className={`num ${p.roe >= 0 ? 'up' : 'down'}`}>{pctS(p.roe)}</b></div>
                  </div>
                  <div className="px-pcard-grid">
                    <div><span>Size (USD)</span><b className="num">{px(p.notional, 2)}</b></div>
                    <div><span>Margin (USD)</span><b className="num">{px(p.margin, 2)}</b></div>
                    <div className="r"><span>Margin ratio</span><b className={`num ${ratio > 0.7 ? 'down' : 'up'}`}>{Number.isFinite(ratio) ? `${(ratio * 100).toFixed(2)}%` : '>100%'}</b></div>
                    <div><span>Entry price</span><b className="num">{px(p.entry, dec(p.market))}</b></div>
                    <div><span>Mark price</span><b className="num">{px(p.mark, dec(p.market))}</b></div>
                    <div className="r"><span>Liq. price</span><b className="num">{p.liquidationPrice != null ? px(p.liquidationPrice, dec(p.market)) : '-'}</b></div>
                  </div>
                  <button className="px-pcard-row" onClick={() => setPnlSheet(p.market)}>
                    <span>Realized PnL (USD)</span>
                    <b className={`num ${(p.realized?.total ?? 0) >= 0 ? 'up' : 'down'}`}>{p.realized ? signed(p.realized.total) : '-'} <ChevronRight size={15} className="muted" /></b>
                  </button>
                  <button className="px-pcard-close" disabled={busy !== null || !kp} onClick={() => close(p)}>{busy === `close-${p.market}` ? <Spin /> : 'Close'}</button>
                </div>
              );
            })}</div>
            {pnlSheet != null && (() => {
              const p = account.positions.find((x) => x.market === pnlSheet);
              const r = p?.realized;
              if (!p) return null;
              const line = (label: string, v: number | undefined, note?: string) => (
                <div className="px-sheet-row"><span>{label}{note && <small>{note}</small>}</span><b className="num">{usd(v)}</b></div>
              );
              return (
                <div className="px-sheet-bg" onClick={() => setPnlSheet(null)}>
                  <div className="px-sheet" role="dialog" aria-modal="true" aria-label="Realized PnL" onClick={(e) => e.stopPropagation()}>
                    <i className="px-sheet-grab" aria-hidden="true" />
                    <h3>Realized PnL</h3>
                    <div className="px-sheet-row total"><span>Realized PnL</span><b className={`num ${(r?.total ?? 0) >= 0 ? 'up' : 'down'}`}>{usd(r?.total)}</b></div>
                    {line('Closing PnL', r?.closing, 'from parts of this position already closed')}
                    {line('Funding fee', r?.funding)}
                    {line('Trading fee', r?.fees)}
                    <p className="px-sheet-note">{r ? <>For your {p.pair} {p.size > 0 ? 'long' : 'short'} since it was opened.</> : <>Not available for this position: part of it changed through a liquidation or an emergency close.</>} Funding not yet settled: {p.fundingOwed ? signed(-p.fundingOwed) : '$0.00'}.</p>
                    <button className="px-pcard-close" onClick={() => setPnlSheet(null)}>Done</button>
                  </div>
                </div>
              );
            })()}
          </>
          )
        )}
        {tab === 'orders' && (
          !account?.openOrders.length ? <div className="bx-empty">No open orders.</div> : (
            <table>
              <thead><tr><th>Market</th><th>Side</th><th>Price</th><th>Size</th><th>Filled</th><th>Type</th><th><button className="px-mini" onClick={() => cancel()}>Cancel all</button></th></tr></thead>
              <tbody>{account.openOrders.map((o) => (
                <tr key={o.hash}>
                  <td><b>{o.pair}</b></td><td className={o.isBuy ? 'up' : 'down'}>{o.isBuy ? 'Buy' : 'Sell'}{o.reduceOnly ? ' · reduce only' : ''}</td>
                  <td className="num">{px(o.price, dec(o.market))}</td><td className="num">{usd(o.size * o.price, 0)}</td>
                  <td className="num">{(((o.size - o.remaining) / o.size) * 100).toFixed(0)}%</td><td>{o.tif === 'alo' ? 'Post only' : o.tif === 'ioc' ? 'IOC' : 'GTC'}</td>
                  <td><button className="px-mini" onClick={() => cancel(o.hash)}><X size={13} /> Cancel</button></td>
                </tr>
              ))}</tbody>
            </table>
          )
        )}
        {tab === 'trades' && (
          !account?.fills.length ? <div className="bx-empty">No trades yet.</div> : (
            <table>
              <thead><tr><th>Time</th><th>Market</th><th>Side</th><th>Price</th><th>Size</th><th>Role</th><th>Settlement</th></tr></thead>
              <tbody>{account.fills.map((f) => (
                <tr key={f.id}>
                  <td className="num muted">{new Date(f.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td><b>{f.pair}</b></td><td className={f.side === 'buy' ? 'up' : 'down'}>{f.side === 'buy' ? 'Buy' : 'Sell'}</td>
                  <td className="num">{px(f.price, dec(f.market))}</td><td className="num">{usd(f.size * f.price)}</td><td>{f.role === 'taker' ? 'Taker' : 'Maker'}</td>
                  <td>{f.status === 'settled' && f.tx ? <a href={`${config.data?.explorer}/tx/${f.tx}`} target="_blank" rel="noreferrer">Settled</a> : f.status === 'failed' ? <span className="down">Refused on chain</span> : <span className="muted">Settling</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          )
        )}
        {tab === 'history' && (
          !account?.orderHistory.length ? <div className="bx-empty">No orders yet.</div> : (
            <table>
              <thead><tr><th>Time</th><th>Market</th><th>Side</th><th>Price</th><th>Size</th><th>Filled</th><th>Status</th></tr></thead>
              <tbody>{account.orderHistory.map((o) => (
                <tr key={o.hash}>
                  <td className="num muted">{new Date(o.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td><b>{o.pair}</b></td><td className={o.isBuy ? 'up' : 'down'}>{o.isBuy ? 'Buy' : 'Sell'}</td>
                  <td className="num">{px(o.price, dec(o.market))}</td><td className="num">{usd(o.size * o.price, 0)}</td>
                  <td className="num">{((o.filled / o.size) * 100).toFixed(0)}%</td><td style={{ textTransform: 'capitalize' }}>{o.status}</td>
                </tr>
              ))}</tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
