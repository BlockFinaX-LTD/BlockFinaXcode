import { isWalletSandbox } from "@/lib/wallet-environment";
/**
 * Home — rebuilt to the new design (app/Home.html).
 *
 * Layout, UI/UX and search match the design 1:1; all data is live:
 *   - Balance + Wallet/Pools split: Rift cross-chain balances + hedge LP
 *   - Live rates: /api/fx/rates (FX / Commodities), refetched every 30s
 *   - Liquidity positions: hedgeContract LP deposits
 *   - Recent activity: unified Rift + hedge feed
 *   - Send / Receive: design sheets wired to real Rift rails
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { V3UpgradeGate } from '@/components/wallet/v3-upgrade-gate';
import { AppSendSheet, AppReceiveSheet } from '@/components/app-transfer-sheets';
import { useWallet } from '@/hooks/use-wallet';
import { useRiftBalances } from '@/hooks/use-rift-balances';
import { useUnifiedActivity, type ActivityRow, explorerUrl } from '@/components/wallet/rift-activity';
import {
  hedgeContract, type HedgeEventData, type HedgeLpDepositData, type HedgePositionData,
} from '@/lib/hedge-contract';
import { FlagSvg, CommoditySvg, CoinSvg, NetSvg, coinKeyForSymbol, netKeyForChain, KNOWN_FLAGS } from '@/components/app-glyphs';
import { RateHistory } from '@/components/hedge/rate-history';
import logoPath from '@/assets/logo.png';
import {
  Eye, EyeOff, ArrowUp, ArrowDown, Shield, TrendingUp, Gift, ArrowRight, RefreshCw,
  ArrowDownLeft, ArrowUpRight, Plus, X, ExternalLink, ChevronLeft, ChevronRight,
} from 'lucide-react';

type FXRate = { pair: string; rate: number; change24h?: number };
type FXResponse = {
  rates: Record<string, FXRate>;
  pairs?: string[];
  pairsWithClass?: Array<{ pair: string; assetClass: string }>;
};

const CURRENCY_NAMES: Record<string, string> = {
  NGN: 'Nigerian naira', GHS: 'Ghanaian cedi', KES: 'Kenyan shilling',
  ZAR: 'South African rand', EGP: 'Egyptian pound', XOF: 'West African CFA',
  EUR: 'Euro', GBP: 'British pound',
};

function fmt2(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function decimalsFor(px: number) {
  return px > 100 ? 2 : px > 10 ? 2 : 4;
}
function timeAgo(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}
function shortHash(h?: string) {
  if (!h) return '';
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

// Shimmer placeholder for a `.list` / `.row` while data loads.
function RowSkeleton() {
  return (
    <div className="row">
      <div className="skel" style={{ width: 38, height: 38, borderRadius: '50%', flex: '0 0 auto' }} />
      <div className="r-main">
        <div className="skel" style={{ height: 13, width: 80, borderRadius: 5 }} />
        <div className="skel" style={{ height: 10, width: 130, borderRadius: 5, marginTop: 6 }} />
      </div>
      <div className="r-side"><div className="skel" style={{ height: 14, width: 56, borderRadius: 6 }} /></div>
    </div>
  );
}

// Rift sometimes returns a tx reference that is ALREADY a full explorer URL.
// In that case link to it as-is (don't prepend a base) and show just the 0x hash;
// otherwise build the explorer URL from the bare hash.
function txLink(chain: string, rawHash?: string): { href: string; short: string } {
  if (!rawHash) return { href: '', short: '' };
  if (/^https?:\/\//i.test(rawHash)) {
    const m = rawHash.match(/0x[a-fA-F0-9]{6,}/);
    const hash = m ? m[0] : rawHash.split('/').pop() || rawHash;
    return { href: rawHash, short: shortHash(hash) };
  }
  return { href: explorerUrl(chain, rawHash), short: shortHash(rawHash) };
}

export default function HomePage() {
  const [, setLocation] = useLocation();
  const { isUnlocked, walletExists, isLoading, wallet } = useWallet();

  const [sendOpen, setSendOpen] = useState(false);
  const [rcvOpen, setRcvOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [rateGroup, setRateGroup] = useState<'fx' | 'cmd'>('fx');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);

  // ── Auth gate ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && !walletExists()) setLocation('/auth');
  }, [isLoading, walletExists, setLocation]);

  // ── Cross-chain balances (Rift) ────────────────────────────────────────
  const { balances: riftBalances, isLoading: riftLoading, refreshAll: refreshBalances } = useRiftBalances();
  const walletTotal = useMemo(
    () => riftBalances.reduce((s, b) => s + (Number(b.amount) || 0), 0),
    [riftBalances],
  );
  const assetCount = useMemo(
    () => riftBalances.filter((b) => Number(b.amount) > 0).length,
    [riftBalances],
  );

  // ── Hedge data: deposits (pools) + positions ───────────────────────────
  const [deposits, setDeposits] = useState<HedgeLpDepositData[]>([]);
  const [positions, setPositions] = useState<HedgePositionData[]>([]);
  const [events, setEvents] = useState<HedgeEventData[]>([]);
  // The rate the user tapped in Live rates. Rows did nothing at all before:
  // no handler, so a tap on a market simply fell through.
  const [rateDetail, setRateDetail] = useState<{ pair: string; name: string; px: number; code: string; ic?: string } | null>(null);
  const [hedgeLoading, setHedgeLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!wallet?.address) { setHedgeLoading(false); return; }
    setHedgeLoading(true);
    // Watchdog: a stalled chain/explorer read must never leave the section
    // spinning forever — show whatever resolved after 12s at the latest.
    const watchdog = setTimeout(() => { if (!cancelled) setHedgeLoading(false); }, 12_000);
    (async () => {
      const [depR, posR, evR] = await Promise.allSettled([
        hedgeContract.getDepositsByWallet(wallet.address),
        hedgeContract.getPositionsByWallet(wallet.address),
        hedgeContract.getAllEvents(),
      ]);
      if (cancelled) return;
      if (depR.status === 'fulfilled') setDeposits(depR.value); else console.error('deposits load failed', depR.reason);
      if (posR.status === 'fulfilled') setPositions(posR.value);
      if (evR.status === 'fulfilled') setEvents(evR.value);
      setHedgeLoading(false);
    })();
    return () => { cancelled = true; clearTimeout(watchdog); };
  }, [wallet?.address, reloadNonce]);

  /**
   * Pull both halves of the balance again.
   *
   * The number on this page is wallet balances plus on-chain positions, read
   * from two independent sources, so refreshing one would leave the other
   * stale and the total still wrong. allSettled rather than all: a failing
   * chain read must not stop the wallet half from updating.
   *
   * The minimum delay is deliberate. A cached response can return in
   * milliseconds, and a spinner that vanishes before it is seen reads as a
   * button that did nothing.
   */
  const refreshEverything = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setReloadNonce((n) => n + 1);
    try {
      await Promise.allSettled([
        refreshBalances(),
        new Promise((r) => setTimeout(r, 600)),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, refreshBalances]);

  const eventsById = useMemo(() => {
    const m = new Map<number, HedgeEventData>();
    events.forEach((e) => m.set(e.id, e));
    return m;
  }, [events]);

  const activeDeposits = useMemo(() => deposits.filter((d) => !d.withdrawn), [deposits]);
  const poolsTotal = useMemo(() => activeDeposits.reduce((s, d) => s + d.amount, 0), [activeDeposits]);
  const activePositions = useMemo(
    () => positions.filter((p) => p.status === 'active' || p.status === 'claimable'),
    [positions],
  );
  const totalBalance = walletTotal + poolsTotal;

  // ── FX rates, straight from the oracle, refetched every 30s ────────────
  const { data: fxData } = useQuery<FXResponse>({
    queryKey: ['/api/fx/rates'],
    refetchInterval: 30 * 1000,
  });

  const baseRates = useMemo(() => {
    const classOf = new Map<string, string>();
    (fxData?.pairsWithClass || []).forEach((p) => classOf.set(p.pair, p.assetClass));
    const all = fxData?.rates ? Object.values(fxData.rates) : [];
    const fx: any[] = [], cmd: any[] = [];
    all.forEach((r) => {
      const [base, quote] = r.pair.split('/');
      const ac = classOf.get(r.pair);
      const isCmd = ac === 'commodity' || ['XAU', 'XAG', 'BRENT', 'WTI', 'COCOA'].includes(base);
      const code = quote === 'USD' ? base : quote;
      const entry = {
        pair: r.pair, base, quote, code,
        name: isCmd ? `${base} spot` : (CURRENCY_NAMES[code] || `${base}/${quote}`),
        px: r.rate, d: r.change24h ?? 0,
        ic: base === 'XAU' ? 'gold' : base === 'BRENT' || base === 'WTI' ? 'oil' : base === 'COCOA' ? 'cocoa' : undefined,
      };
      (isCmd ? cmd : fx).push(entry);
    });
    return { fx: fx.slice(0, 6), cmd: cmd.slice(0, 6) };
  }, [fxData]);

  /**
   * The rates exactly as the oracle reported them.
   *
   * This used to add a random number to every price every 2.2 seconds, to make
   * the list feel live between refetches. It made the list show prices that
   * never existed, and not evenly: `Math.random() - 0.48` has a mean of +0.02
   * rather than 0, so it pushed upward, averaging +0.25% and reaching +1.18%
   * within a single five minute window.
   *
   * The direction is what makes it indefensible. Upward on USD/GHS is the cedi
   * weakening, which is the direction that makes cover look more necessary.
   * Nobody intended that, and no amount of intent makes invented prices
   * acceptable on a product being shown to the Bank of Ghana.
   *
   * The liveness is real now instead: the query above refetches every 30
   * seconds, so the number changes when the market does and not otherwise.
   */
  const displayRates = rateGroup === 'fx' ? baseRates.fx : baseRates.cmd;

  // ── Activity ───────────────────────────────────────────────────────────
  const { rows: activityRows, loading: activityLoading } = useUnifiedActivity(wallet?.address, 50);
  const recentActivity = useMemo(() => activityRows.slice(0, 5), [activityRows]);
  const HISTORY_PAGE_SIZE = 8;
  const historyPages = Math.max(1, Math.ceil(activityRows.length / HISTORY_PAGE_SIZE));

  // ── Referral (refer banner link target) ────────────────────────────────
  const { data: referralCode } = useQuery<{ code: string }>({
    queryKey: ['/api/referrals/codes', wallet?.address],
    queryFn: () => fetch(`/api/referrals/codes/${wallet?.address}`).then((r) => r.json()),
    enabled: !!wallet?.address,
  });

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#050505' }}>
        <div style={{ textAlign: 'center' }}>
          <img src={logoPath} alt="BlockFinaX" style={{ width: 56, height: 56, objectFit: 'contain', margin: '0 auto 10px' }} />
          <div style={{ fontSize: 13, color: '#7a7a7a' }}>Loading BlockFinaX…</div>
        </div>
      </div>
    );
  }
  if (!walletExists()) return null;

  const balStr = (n: number) => {
    const [int, cents] = fmt2(n).split('.');
    return { int, cents: `.${cents}` };
  };
  const bal = balStr(totalBalance);

  return (
    <AppShell active="home">
      <V3UpgradeGate />
      {/* balance + side */}
      <div className="topgrid reveal in">
        <div className={`balance${hidden ? ' hidden' : ''}`}>
          <div className="bal-top">
            <span className="bal-k">Total balance</span>
            <button className="eye" aria-label="Hide balance" onClick={() => setHidden((h) => !h)}>
              <span className="ic-on"><Eye /></span><span className="ic-off"><EyeOff /></span>
            </button>
            <button
              className="eye"
              aria-label="Refresh balance"
              title="Refresh balance"
              onClick={refreshEverything}
              disabled={refreshing}
              style={{ marginLeft: 2 }}
            >
              {/* One icon that spins rather than swapping to a spinner: the
                  glyph staying put makes it read as this button working,
                  rather than as something else appearing.

                  `.spin` is the app's existing rule in app-extra.css. Writing
                  a fresh animation here named a keyframe that does not exist,
                  which fails silently: no error, and no rotation either. */}
              <RefreshCw
                className={refreshing ? 'spin' : undefined}
                style={{ width: 15, height: 15, opacity: refreshing ? 0.65 : 1 }}
              />
            </button>
          </div>
          <div className="bal-num">
            <span className="cur">$</span>
            <span className="int">{hidden ? '••••••' : (riftLoading && hedgeLoading ? '—' : bal.int)}</span>
            <span className="cents">{hidden ? '' : (riftLoading && hedgeLoading ? '' : bal.cents)}</span>
          </div>
          <div className="quick">
            <button className="qa" onClick={() => setSendOpen(true)}><span className="qi"><ArrowUp /></span><span className="ql">Send</span></button>
            <button className="qa" onClick={() => setRcvOpen(true)}><span className="qi"><ArrowDown /></span><span className="ql">Receive</span></button>
            <button className="qa" onClick={() => setLocation('/hedge')}><span className="qi"><Shield /></span><span className="ql">Cover</span></button>
          </div>
        </div>
        <div className="side-stack">
          <div className="split-card wallet">
            <div className="sk">Wallet</div>
            <div className="sv tnum">{hidden ? '•••••' : `$${fmt2(walletTotal)}`}</div>
            <div className="ss">{assetCount} asset{assetCount === 1 ? '' : 's'}</div>
          </div>
          <div className="split-card pool">
            <div className="sk">Pools</div>
            <div className="sv tnum">{hidden ? '•••••' : `$${fmt2(poolsTotal)}`}</div>
            <div className="ss">{activePositions.length} active position{activePositions.length === 1 ? '' : 's'}</div>
          </div>
        </div>
      </div>

      {/* refer */}
      <div className="refer reveal in">
        <span className="ri"><Gift /></span>
        <div className="rc">
          <div className="rt">Refer &amp; earn</div>
          <div className="rs">{isWalletSandbox ? 'Referral rewards are not configured in this test environment.' : 'Invite a friend — you both get 50 points in rewards.'}</div>
        </div>
        <button className="rx" onClick={() => setLocation('/tasks?tab=referrals')}>
          Invite <ArrowRight />
        </button>
      </div>

      {/* main grid */}
      <div className="maingrid reveal in">
        <div className="col">
          {/* live rates */}
          <div className="sec">
            <div className="sec-h">
              <h2>{isWalletSandbox ? 'Test rates' : 'Live rates'}</h2>
              <div className="seg">
                <button className={rateGroup === 'fx' ? 'on' : ''} onClick={() => setRateGroup('fx')}>FX</button>
                <button className={rateGroup === 'cmd' ? 'on' : ''} onClick={() => setRateGroup('cmd')}>Commodities</button>
              </div>
            </div>
            <div className="rates">
              {displayRates.length === 0 ? (
                <div className="rate"><div className="rk"><div className="p">No rates</div><div className="s">Check back shortly</div></div></div>
              ) : displayRates.map((r) => (
                <div
                  className="rate"
                  key={r.pair}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setRateDetail({ pair: r.pair, name: r.name, px: r.px, code: r.code, ic: r.ic })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setRateDetail({ pair: r.pair, name: r.name, px: r.px, code: r.code, ic: r.ic });
                    }
                  }}
                >
                  {r.ic
                    ? <span className="ico"><CommoditySvg ic={r.ic} /></span>
                    : <span className="ico flag"><FlagSvg code={KNOWN_FLAGS.includes(r.code) ? r.code : r.code} /></span>}
                  <div className="rk"><div className="p">{r.pair}</div><div className="s">{r.name}</div></div>
                  <div className="rv">
                    <div className="px tnum">{r.px.toLocaleString('en-US', { minimumFractionDigits: decimalsFor(r.px), maximumFractionDigits: decimalsFor(r.px) })}</div>
                    {!!r.d && <div className="d" style={{ color: r.d >= 0 ? 'var(--green)' : 'var(--red)' }}>{r.d >= 0 ? '+' : ''}{r.d.toFixed(2)}%</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* liquidity positions */}
          <div className="sec">
            <div className="sec-h">
              <h2>Liquidity positions</h2>
              <a className="more" onClick={() => setLocation('/hedge?tab=mypools')}>Manage <ArrowRight /></a>
            </div>
            <div className="list">
              {hedgeLoading ? (
                <>{[0, 1, 2].map((i) => <RowSkeleton key={i} />)}</>
              ) : activeDeposits.length === 0 ? (
                <div className="row" style={{ cursor: 'pointer' }} onClick={() => setLocation('/hedge?tab=provide')}>
                  <span className="actico"><Plus /></span>
                  <div className="r-main"><div className="r1">No positions yet</div><div className="r2">Provide liquidity to earn premium</div></div>
                  <div className="r-side"><ArrowRight /></div>
                </div>
              ) : activeDeposits.map((d) => {
                const ev = eventsById.get(d.eventId);
                const pair = ev?.underlying || `Event #${d.eventId}`;
                const sub = ev ? `Cover pool · ${ev.name}` : 'Cover pool';
                return (
                  <div className="row" key={d.id} style={{ cursor: 'pointer' }} onClick={() => setLocation(`/hedge?tab=mypools`)}>
                    <span className="coin"><CoinSvg token="usdc" /><span className="net"><NetSvg net="base" /></span></span>
                    <div className="r-main"><div className="r1">{pair}</div><div className="r2">{sub}</div></div>
                    <div className="r-side"><div className="v1 tnum">${fmt2(d.amount)}</div></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="col">
          {/* recent activity */}
          <div className="sec">
            <div className="sec-h">
              <h2>Recent activity</h2>
              <a className="more" onClick={() => { setHistoryPage(0); setHistoryOpen(true); }} style={{ cursor: 'pointer' }}>History <ArrowRight /></a>
            </div>
            <div className="list act">
              {activityLoading && recentActivity.length === 0 ? (
                <>{[0, 1, 2, 3].map((i) => <RowSkeleton key={i} />)}</>
              ) : recentActivity.length === 0 ? (
                <div className="row">
                  <span className="actico"><TrendingUp /></span>
                  <div className="r-main"><div className="r1">No activity yet</div><div className="r2">Cover, payments &amp; pool actions show here</div></div>
                </div>
              ) : recentActivity.map((row, i) => <ActivityItem key={`${row.hash}-${i}`} row={row} />)}
            </div>
          </div>
        </div>
      </div>

      {/* CTA pair */}
      <div className="ctapair reveal in">
        <button className="btn btn-ghost" onClick={() => setLocation('/hedge')}><Shield /> Buy cover</button>
        <button className="btn btn-primary" onClick={() => setLocation('/hedge?tab=provide')}><TrendingUp /> Start earning</button>
      </div>

      <AppSendSheet open={sendOpen} onClose={() => setSendOpen(false)} />
      <AppReceiveSheet open={rcvOpen} onClose={() => setRcvOpen(false)} />

      {/* ===== FULL ACTIVITY HISTORY (paginated) ===== */}
      {/* Rate detail. Opened from a Live rates row.

          It shows history rather than jumping straight to Cover because there
          is not always cover to jump to: every pool on the book is settled
          right now, so a navigation would have landed on an empty list for
          every market and looked as broken as the dead row it replaced. The
          chart is true whether or not anything is open to buy, and the button
          appears only when there is something behind it. */}
      <div className={`sheet-scrim${rateDetail ? ' on' : ''}`} onClick={() => setRateDetail(null)} />
      <div className={`sheet${rateDetail ? ' on' : ''}`} role="dialog" aria-modal="true">
        <div className="grab" />
        <div className="sheet-h">
          <h3>{rateDetail?.pair || 'Rate'}</h3>
          <button className="sheet-x" onClick={() => setRateDetail(null)}><X /></button>
        </div>
        {rateDetail && (
          <>
            <div className="sum-pre" style={{ marginBottom: 4 }}>
              <div className="pair-line">
                {rateDetail.ic
                  ? <span className="ico"><CommoditySvg ic={rateDetail.ic} /></span>
                  : <span className="ico flag"><FlagSvg code={rateDetail.code} /></span>}
                <div>
                  <div className="pl-nm">{rateDetail.name}</div>
                  <div className="pl-sub tnum">
                    {rateDetail.px.toLocaleString('en-US', {
                      minimumFractionDigits: decimalsFor(rateDetail.px),
                      maximumFractionDigits: decimalsFor(rateDetail.px),
                    })}
                  </div>
                </div>
              </div>
              <RateHistory pair={rateDetail.pair} />
            </div>

            {(() => {
              const open = events.filter(
                // 'open', not 'active': an event's statuses are open/expired/
                // settled. The compiler caught this, which is the only reason
                // it is not silently reporting no cover on every pair forever.
                (e) => e.underlying === rateDetail.pair && e.status === 'open',
              );
              return open.length > 0 ? (
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 14 }}
                  onClick={() => { setRateDetail(null); setLocation(`/hedge?q=${encodeURIComponent(rateDetail.pair)}`); }}
                >
                  <Shield /> {open.length === 1 ? 'View the cover available' : `View ${open.length} pools`}
                </button>
              ) : (
                <p className="hint" style={{ marginTop: 14 }}>
                  No cover is open on {rateDetail.pair} at the moment.
                </p>
              );
            })()}
          </>
        )}
      </div>

      <div className={`sheet-scrim${historyOpen ? ' on' : ''}`} onClick={() => setHistoryOpen(false)} />
      <div className={`sheet${historyOpen ? ' on' : ''}`} role="dialog" aria-modal="true">
        <div className="grab" />
        <div className="sheet-h"><h3>Activity history</h3><button className="sheet-x" onClick={() => setHistoryOpen(false)}><X /></button></div>
        {activityRows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--tx-3)', fontSize: 13 }}>
            {activityLoading ? 'Loading…' : 'No activity yet'}
          </div>
        ) : (
          <>
            <div className="list act" style={{ marginBottom: 14 }}>
              {activityRows
                .slice(historyPage * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE)
                .map((row, i) => <ActivityItem key={`${row.hash}-${historyPage}-${i}`} row={row} />)}
            </div>
            {historyPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <button className="btn btn-ghost" style={{ flex: 1, height: 42 }} disabled={historyPage === 0} onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft /> Prev
                </button>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>
                  {historyPage + 1} / {historyPages}
                </span>
                <button className="btn btn-ghost" style={{ flex: 1, height: 42 }} disabled={historyPage >= historyPages - 1} onClick={() => setHistoryPage((p) => Math.min(historyPages - 1, p + 1))}>
                  Next <ChevronRight />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

// ── Activity row in the design's `.act` style ────────────────────────────
function ActivityItem({ row }: { row: ActivityRow }) {
  const { href, short } = txLink(row.chain, row.hash);
  let icon = <TrendingUp />;
  let title = 'Activity';
  let sub = '';
  let amount = '';
  if (row.kind === 'transfer') {
    const inbound = row.direction === 'receive';
    icon = inbound ? <ArrowDownLeft /> : <ArrowUpRight />;
    title = inbound ? `Received ${row.token || ''}`.trim() : `Sent ${row.token || ''}`.trim();
    sub = inbound ? `From ${shortHash(row.counterparty)}` : `To ${shortHash(row.counterparty)}`;
    amount = `${inbound ? '+' : '-'}${row.amount != null ? fmt2(row.amount) : ''} ${row.token || ''}`.trim();
  } else {
    const labels: Record<string, string> = {
      buy_protection: 'Bought cover', lp_deposit: 'Pool deposit', claim_payout: 'Payout claimed',
      claim_premiums: 'Premiums claimed', withdraw_lp: 'Withdrew liquidity', create_event: 'Created pool',
      recover_expired: 'Recovered capital', toggle_pool: 'Updated pool', settle_event: 'Pool settled',
      reward_payout: 'Reward payout',
    };
    icon = row.actionType === 'buy_protection' ? <Shield /> : <TrendingUp />;
    title = labels[row.actionType] || 'Hedge action';
    sub = row.metadata?.eventName || (row.token ? `${row.token}` : 'On-chain');
    if (row.amount != null) amount = `${fmt2(row.amount)} ${row.token || 'USDC'}`;
  }
  const inner = (
    <>
      <span className="actico">{icon}</span>
      <div className="r-main">
        <div className="r1">{title}</div>
        <div className="r2">{sub}{short ? <> · <span className="hash" title="View on explorer">{short}</span></> : null}</div>
      </div>
      <div className="r-side">
        <div className="v1 tnum">{amount}</div>
        <div className="v2">{timeAgo(row.timestamp)}</div>
      </div>
    </>
  );
  return href
    ? <a className="row" href={href} target="_blank" rel="noopener noreferrer">{inner}</a>
    : <div className="row">{inner}</div>;
}
