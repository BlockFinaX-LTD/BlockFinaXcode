/**
 * Cover — rebuilt to the new design (app/Cover.html).
 *
 * Five tabs: Buy cover / Underwrite / Create pool / My cover / My
 * pools. The first three mirror the design; the last two preserve the existing
 * claim / withdraw / settings functionality in the same visual language.
 *
 * Every data path and mutation is unchanged from the previous implementation:
 * hedgeContract reads, buyProtection / deposit / createEvent / setPoolSettings /
 * claimPayout / claimPremiums / withdrawCapital, the
 * pricing-engine quote, activity logging, mainnet guard, and ?event=&action=
 * deep-linking + share links.
 */
import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useIdentity as useRift, usesPasskeyWallet } from '@/lib/identity';
import { CoverV2 } from '@/components/hedge/cover-v2';
import { AppShell } from '@/components/app-shell';
import { useWallet } from '@/hooks/use-wallet';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Shield, ShieldCheck, Layers, PlusCircle, Plus, Search, ArrowUpDown, X,
  ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Check, ChevronDown,
  ChevronRight, Banknote, Wheat, CircleDollarSign, Info, Loader2, Award, Wallet,
} from 'lucide-react';
import {
  hedgeContract, getUsdcAddress, getUsdtAddress,
  type HedgeEventData, type HedgePositionData, type HedgeLpDepositData, type HedgeFeeConfig,
} from '@/lib/hedge-contract';
import { fmtRate } from '@/lib/format-rate';
import { chargedRateFor } from '@/lib/purchase-quote';
import { PremiumExplainer } from '@/components/hedge/premium-explainer';
import { walletManager } from '@/lib/wallet';
import { ethers } from 'ethers';
import { mainnetGuard } from '@/lib/mainnet-guard';
import { explainTxError } from '@/lib/tx-errors';
import { getNetworkById, DEFAULT_NETWORK, NETWORKS } from '@/lib/networks';
import { CoverDetail } from '@/components/hedge/cover-detail';
import { UnderwriterDetail } from '@/components/hedge/underwriter-detail';
import { buildPayoutModel } from '@/lib/payout-model';
import { RateHistory } from '@/components/hedge/rate-history';
import { FlagSvg, CommoditySvg, CoinSvg, KNOWN_FLAGS } from '@/components/app-glyphs';

type AssetClass = 'all' | 'fx' | 'commodity' | 'crypto';
type CoverView = 'buy' | 'lp' | 'create' | 'mypos' | 'mypools';

function getAssetClass(pair: string): 'fx' | 'commodity' | 'crypto' {
  const cryptoPairs = ['BTC/USD', 'ETH/USD', 'BNB/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'];
  const commodityPairs = ['XAU/USD', 'XAG/USD', 'XPT/USD', 'XPD/USD', 'XTI/USD', 'XBR/USD', 'XNG/USD', 'XCO/USD', 'XCF/USD', 'XWH/USD', 'XSG/USD'];
  if (cryptoPairs.includes(pair)) return 'crypto';
  if (commodityPairs.includes(pair)) return 'commodity';
  return 'fx';
}

const COMMODITY_NAMES: Record<string, string> = {
  'XAU/USD': 'Gold', 'XAG/USD': 'Silver', 'XPT/USD': 'Platinum', 'XPD/USD': 'Palladium',
  'XTI/USD': 'WTI Oil', 'XBR/USD': 'Brent Oil', 'XNG/USD': 'Nat. Gas',
  'XCO/USD': 'Cocoa', 'XCF/USD': 'Coffee', 'XWH/USD': 'Wheat', 'XSG/USD': 'Sugar',
};
const COMMODITY_IC: Record<string, string> = {
  'XAU/USD': 'gold', 'XTI/USD': 'oil', 'XBR/USD': 'oil', 'XCO/USD': 'cocoa', 'XWH/USD': 'wheat',
};

function legs(pair: string): { base: string; quote: string } {
  const [base, quote] = (pair || '').split('/');
  return { base: base || '', quote: quote || '' };
}
function codeOf(pair: string): string {
  const { base, quote } = legs(pair);
  return quote === 'USD' ? base : quote;
}
function unitOf(pair: string): string {
  const { quote } = legs(pair);
  return quote || 'USD';
}
function fmtMoney(n: number): string { return '$' + Math.round(n).toLocaleString('en-US'); }
// Cents-precise — use for claimable amounts so a real sub-dollar value never
// renders as "$0" (which made it look like there was nothing to claim).
function fmtUsd2(n: number): string { return '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// fmtRate now lives in @/lib/format-rate, shared with the explainer.
// Smallest amount worth a claim/withdraw tx — below this we treat it as nothing.
const CLAIM_DUST = 0.01;
function fmtK(n: number): string { return n >= 1000 ? '$' + (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : '$' + Math.round(n); }
function pairLabel(pair: string): string {
  const cls = getAssetClass(pair);
  if (cls === 'commodity') return COMMODITY_NAMES[pair] || pair;
  return pair.replace('/', ' / ');
}

// Flag / commodity glyph for an event's underlying, in the design's `.mkt-fl`.
function MarketFlag({ pair, className = '' }: { pair: string; className?: string }) {
  const cls = getAssetClass(pair);
  if (cls === 'commodity') {
    return <span className={`mkt-fl cmd ${className}`}><CommoditySvg ic={COMMODITY_IC[pair] || 'gold'} /></span>;
  }
  const code = codeOf(pair);
  return <span className={`mkt-fl ${className}`}><FlagSvg code={KNOWN_FLAGS.includes(code) ? code : code} /></span>;
}

function daysToExpiry(d: Date): number {
  return Math.max(0.01, (d.getTime() - Date.now()) / 86400000);
}
/**
 * The line under a pool's pair, when there is anything worth saying.
 *
 * Pools carry a free-text name typed at creation, and it is shown directly
 * beneath the pair the pool actually settles on. Most of the time it just
 * repeats the pair, which is noise. Occasionally it contradicts it: event #2 is
 * a USD/GHS pool someone named "USD/KES", so the card read as Ghana cedi on one
 * line and Kenyan shilling on the next.
 *
 * That is worse than noise. An underwriter scanning the list could believe they
 * are taking shilling exposure on a pool that settles on the cedi, and the name
 * is the part they would remember.
 *
 * So a name that names any pair other than the real one is dropped, and a name
 * that merely repeats the pair is dropped as redundant. What survives is the
 * part that was actually informative, like "7 Days" or "POOL". The underlying
 * is the truth here and it is already on the line above.
 */
function poolSubtitle(name: string | null | undefined, underlying: string): string | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;

  const claimed = raw.match(/\b[A-Z]{3}\s*\/\s*[A-Z]{3}\b/);
  if (claimed && claimed[0].replace(/\s/g, "") !== underlying.replace(/\s/g, "")) return null;

  // Strip the pair itself and any leftover separators, leaving the note.
  const rest = raw
    .replace(/\b[A-Z]{3}\s*\/\s*[A-Z]{3}\b/g, "")
    .replace(/^[\s\-–—:,.]+|[\s\-–—:,.]+$/g, "")
    .trim();
  return rest || null;
}

/**
 * Newest at the top, in every list.
 *
 * Position ids rise with each purchase, so they order by when the cover was
 * bought, which is what someone scanning a list means by newest. Sorting by
 * expiry instead would put a pool bought yesterday below one bought last month
 * that happens to run longer.
 */
/** The cap the chart shades and the cards quote, from one model. */
/**
 * The payout curve for one position.
 *
 * `maxPayout` here means the CEILING of the contract, not what the position
 * happened to receive. Passing the realised figure was the bug behind the
 * unreadable chart labels: `p.payoutAmount` is zero on cover that expired
 * without triggering, which makes buildPayoutModel compute
 * `maxPriceMove = 0`, hence `cap = strike + 0`, hence a cap sitting exactly on
 * the strike. The chart then drew both lines on top of each other and printed
 * "MAX $0" over "strike 11.2600".
 *
 * It also silently marked the whole model `valid: false`, so every payout
 * figure derived from it on an expired position was coming out of an invalid
 * model rather than a real one.
 *
 * The ceiling is a contract term, so it comes from the event's own payout cap:
 * notional x the distance from strike to cap, scaled by the rate the pool was
 * struck at. The realised amount is only the fallback, for Diamonds with no
 * range getter where payoutCap reads back zero.
 */
function maxPayoutFor(p: HedgePositionData, ev: HedgeEventData): number {
  if (ev.payoutCap > 0 && ev.initialRate > 0 && ev.strike > 0) {
    return (p.notional * Math.abs(ev.payoutCap - ev.strike)) / ev.initialRate;
  }
  return p.payoutAmount;
}

function payoutModelFor(p: HedgePositionData, ev: HedgeEventData) {
  return buildPayoutModel({
    notional: p.notional,
    initialRate: ev.initialRate,
    maxPayout: maxPayoutFor(p, ev),
    strike: ev.strike,
    strikeAbove: ev.strikeAbove,
    totalCost: p.premiumPaid + p.platformFeePaid,
  });
}

function byNewest<T extends { id: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.id - a.id);
}

/**
 * When a position ends, said the way a person would say it.
 *
 * The cards showed the pool's name underneath the pair, which for most pools is
 * the pair again. Repeating it told the reader nothing, while the one thing
 * they want at a glance, whether this is still running and for how much longer,
 * was not on the card at all.
 *
 * Past and future read differently on purpose. "Expired 3 days ago" is a fact
 * about something finished; "expires in 3 days" is a countdown on money still
 * at risk.
 *
 * Rounds rather than truncates. Flooring a countdown understates it by up to a
 * whole unit, so a cover with 23 hours and 59 minutes left reads "expires in 23
 * hours" and one with 45 minutes left reads "44 minutes". Every position hits
 * that, because the gap to expiry is essentially never a whole number of units.
 */
function expiryNarration(d: Date | null | undefined): string | null {
  if (!d) return null;
  const ms = new Date(d).getTime();
  if (Number.isNaN(ms)) return null;

  const diff = ms - Date.now();
  const past = diff < 0;
  const say = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

  // Each unit is rounded before its band is tested, so a value that rounds up
  // onto a boundary is promoted instead of being reported as "60 minutes".
  const mins = Math.round(Math.abs(diff) / 60000);
  const hours = Math.round(mins / 60);
  const days = Math.round(mins / 1440);
  const months = Math.round(mins / 43200);

  const span =
    mins < 1 ? null
    : mins < 60 ? say(mins, "minute")
    : hours < 24 ? say(hours, "hour")
    : days < 30 ? say(days, "day")
    : say(months, "month");

  if (span === null) return past ? "expired just now" : "expires any moment";
  return past ? `expired ${span} ago` : `expires in ${span}`;
}

function expiryLabel(d: Date): string {
  const days = daysToExpiry(d);
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}H`;
  return `${Math.round(days)}D`;
}
// Comprehensive pool card for the Provide-liquidity grid (no APR — premium rate
// is the honest, directly-comparable number; APR annualised from a sub-day pool
// is meaningless).
function PoolCard({ ev, onAdd, onOpen, rate }: { ev: HedgeEventData; onAdd: () => void; onOpen: () => void; rate?: number }) {
  const util = Math.round(ev.utilization * 100);
  return (
    <div className="pool-card">
      <div className="pool-top" style={{ cursor: 'pointer' }} onClick={onOpen}>
        <MarketFlag pair={ev.underlying} />
        <div className="pt-nm">
          <div className="a">{pairLabel(ev.underlying)}</div>
          <div className="b">{ev.strikeAbove ? 'Rate rises past' : 'Rate falls below'} {ev.strike.toLocaleString()}</div>
        </div>
        <div className="pool-apr"><div className="v">{fmtRate(rate ?? ev.premiumRate)}</div><div className="l">Premium</div></div>
      </div>
      <div className="pool-stats">
        <div className="pool-stat"><div className="l">Pool size</div><div className="v tnum">{fmtK(ev.totalLiquidity)}</div></div>
        <div className="pool-stat"><div className="l">Available</div><div className="v tnum">{fmtK(ev.availableCapacity)}</div></div>
        <div className="pool-stat"><div className="l">Strike</div><div className="v tnum">{ev.strike.toLocaleString()}</div></div>
        <div className="pool-stat"><div className="l">Expires in</div><div className="v tnum">{expiryLabel(ev.expiryDate)}</div></div>
      </div>
      <div className="pool-cap"><div className="row1"><span>Capacity · {ev.lpCount} LP · {ev.hedgerCount} hedger{ev.hedgerCount === 1 ? '' : 's'}</span><span>{util}% used</span></div><div className="liqbar"><i style={{ width: `${util}%` }} /></div></div>
      <button className="btn-sm2 primary" onClick={onAdd}>Underwrite</button>
    </div>
  );
}

// Blue loading state shown inside a sheet while a deep-linked market's data
// is still being read from chain.
function SheetLoading() {
  return (
    <div style={{ padding: '20px 0 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <Loader2 className="spin" style={{ width: 26, height: 26, color: 'var(--blue)' }} />
      <div style={{ fontSize: 13, color: 'var(--tx-3)' }}>Loading market…</div>
      <div className="skel" style={{ height: 54, width: '100%', borderRadius: 13 }} />
      <div className="skel" style={{ height: 86, width: '100%', borderRadius: 13 }} />
      <div className="skel" style={{ height: 44, width: '100%', borderRadius: 13 }} />
    </div>
  );
}

// Shimmer placeholders while chain data loads.
function PoolCardSkeleton() {
  return (
    <div className="pool-card">
      <div className="pool-top">
        <div className="skel" style={{ width: 38, height: 38, borderRadius: '50%', flex: '0 0 auto' }} />
        <div className="pt-nm" style={{ flex: 1 }}>
          <div className="skel" style={{ height: 14, width: 100, borderRadius: 5 }} />
          <div className="skel" style={{ height: 10, width: 130, borderRadius: 5, marginTop: 6 }} />
        </div>
        <div className="skel" style={{ height: 30, width: 48, borderRadius: 7 }} />
      </div>
      <div className="pool-stats">
        <div className="skel" style={{ height: 42, borderRadius: 9 }} /><div className="skel" style={{ height: 42, borderRadius: 9 }} />
        <div className="skel" style={{ height: 42, borderRadius: 9 }} /><div className="skel" style={{ height: 42, borderRadius: 9 }} />
      </div>
      <div className="skel" style={{ height: 8, borderRadius: 4, margin: '14px 0' }} />
      <div className="skel" style={{ height: 38, borderRadius: 10 }} />
    </div>
  );
}
/** Per-pool totals from /api/hedge/pool-stats, derived from the indexed event log. */
interface PoolStatRow {
  chainId: number;
  poolId: number;
  liquidity: string;
  exposure: string;
  premiums: string;
  lpCount: number;
  hedgerCount: number;
}

/** Row shape returned by /api/hedge/events/open (the ChainSync mirror of on-chain pools). */
interface DbHedgeEvent {
  onChainEventId: number;
  chainId: number;
  name?: string;
  description?: string;
  underlying: string;
  strike: string | number;
  premiumRate: string | number;
  payoutRate?: string | number;
  expiryDate: string;
  status: string;
  settlementPrice?: string | number | null;
  triggered?: boolean | null;
  poolOpen?: boolean | null;
  allowExternalLp?: boolean | null;
  createdBy: string;
  creatorEarnings?: string | number | null;
  createdAt?: string | null;
  settledAt?: string | null;
}

/**
 * Rebuild a HedgeEventData from the DB mirror for pools the Diamond refuses to
 * return. Terms (strike, premium, expiry, status) are exact — they were synced
 * from chain. Live pool balances are not mirrored, so liquidity/exposure/counts
 * come back as 0 and `fromMirror` marks the row so the UI can be honest that
 * those figures are unavailable rather than genuinely zero.
 */
function dbEventToHedgeEvent(e: DbHedgeEvent): HedgeEventData & { fromMirror: true } {
  const n = (v: string | number | null | undefined) => (v == null ? 0 : typeof v === 'number' ? v : parseFloat(v) || 0);
  const status = (['open', 'settled', 'expired'].includes(e.status) ? e.status : 'open') as 'open' | 'settled' | 'expired';
  return {
    id: e.onChainEventId,
    creator: e.createdBy,
    name: e.name || e.underlying,
    underlying: e.underlying,
    strike: n(e.strike),
    premiumRate: n(e.premiumRate),
    expiryDate: new Date(e.expiryDate),
    status,
    poolOpen: e.poolOpen ?? true,
    allowExternalLp: e.allowExternalLp ?? true,
    initialRate: 0,
    strikeAbove: true,
    settlementPrice: n(e.settlementPrice),
    triggered: !!e.triggered,
    creatorEarnings: n(e.creatorEarnings),
    totalLiquidity: 0,
    totalExposure: 0,
    totalPremiums: 0,
    totalMaxPayout: 0,
    lpCount: 0,
    hedgerCount: 0,
    createdAt: e.createdAt ? new Date(e.createdAt) : null,
    settledAt: e.settledAt ? new Date(e.settledAt) : null,
    availableCapacity: 0,
    utilization: 0,
    // Fraction, not a percentage — consumers compute `notional * payoutPercent`.
    // The DB stores payout_rate the same way (0.10 = 10%), so pass it straight through.
    payoutPercent: n(e.payoutRate),
    // The mirror carries terms, not range geometry. Zero means "no cap known",
    // and payoutPercent above comes from the DB's own payout_rate rather than
    // being derived from one.
    payoutCap: 0,
    paymentToken: '',
    description: e.description,
    fromMirror: true,
  };
}

function RowSkeleton() {
  return (
    <div className="row">
      <div className="skel" style={{ width: 38, height: 38, borderRadius: '50%', flex: '0 0 auto' }} />
      <div className="r-main">
        <div className="skel" style={{ height: 13, width: 90, borderRadius: 5 }} />
        <div className="skel" style={{ height: 10, width: 140, borderRadius: 5, marginTop: 6 }} />
      </div>
      <div className="r-side"><div className="skel" style={{ height: 32, width: 64, borderRadius: 9 }} /></div>
    </div>
  );
}

/**
 * The passkey-wallet build trades on the currency-pool model through /api/v2 (the
 * liquidity hub, signed quotes, passkey approval). Production keeps the screen below.
 */
export default function Hedge() {
  if (usesPasskeyWallet) {
    return (
      <AppShell active="cover" greeting={{ title: 'Cover', subtitle: 'Protect against currency moves, or earn by underwriting' }}>
        <CoverV2 />
      </AppShell>
    );
  }
  return <LegacyHedge />;
}

function LegacyHedge() {
  const { wallet, settings, updateSettings } = useWallet();
  const { getAccessToken } = useRift();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const selectedNetworkId = settings?.selectedNetworkId ?? DEFAULT_NETWORK.id;
  const selectedNetwork = getNetworkById(selectedNetworkId) ?? DEFAULT_NETWORK;
  const activeChainId = selectedNetwork.chainId;
  const activeUsdcAddress = getUsdcAddress(activeChainId);
  const activeUsdtAddress = getUsdtAddress(activeChainId);

  hedgeContract.setChain(activeChainId);

  // ── Wallet balances for the active chain ────────────────────────────────
  const { data: usdcBalance } = useQuery<string>({
    queryKey: ['/hedge/usdc-balance', wallet?.address, activeChainId],
    queryFn: () => hedgeContract.getTokenBalance(activeUsdcAddress, wallet!.address),
    enabled: !!wallet?.address,
    refetchInterval: 30_000, staleTime: 20_000,
  });
  const { data: usdtBalance } = useQuery<string>({
    queryKey: ['/hedge/usdt-balance', wallet?.address, activeChainId],
    queryFn: () => hedgeContract.getTokenBalance(activeUsdtAddress, wallet!.address),
    enabled: !!wallet?.address && !!activeUsdtAddress,
    refetchInterval: 30_000, staleTime: 20_000,
  });

  // ── View + filters ──────────────────────────────────────────────────────
  const [view, setView] = useState<CoverView>('buy');
  const [buyAsset, setBuyAsset] = useState<AssetClass>('all');
  const [buySearch, setBuySearch] = useState('');
  const [buySort, setBuySort] = useState<'prem-asc' | 'prem-desc' | 'liq-desc' | 'exp-asc'>('prem-asc');
  const [lpAsset, setLpAsset] = useState<AssetClass>('all');
  const [lpSort, setLpSort] = useState<'prem-desc' | 'util-desc' | 'cap-desc'>('prem-desc');
  const [myPoolsFilter, setMyPoolsFilter] = useState<'live' | 'ended'>('live');
  const [hasAutoSwitched, setHasAutoSwitched] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<HedgeEventData | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // Settled/expired cover opens a read-only breakdown. Previously these rows
  // showed only a status badge, so a hedger could not see what they paid, what
  // the strike was, or why a position expired without paying out.
  const [posDetail, setPosDetail] = useState<HedgePositionData | null>(null);
  // Which pools price at the moment of purchase. Chosen at creation and
  // immutable, so it is cached per event id and never re-read.
  const [dynamicById, setDynamicById] = useState<Record<number, boolean>>({});
  const [premiumInfoFor, setPremiumInfoFor] = useState<number | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [lpOpen, setLpOpen] = useState(false);
  // A deep-linked market (from search / share link) whose data is still loading.
  const [pendingDeep, setPendingDeep] = useState<{ id: number; action: string | null } | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [notional, setNotional] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [pairPickerOpen, setPairPickerOpen] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  const [customUnit, setCustomUnit] = useState<'hours' | 'days'>('days');
  const [customValue, setCustomValue] = useState('');

  const shortenAddress = (addr: string) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '');

  const { data: selectedEventTokenBalance } = useQuery<string>({
    queryKey: ['/hedge/token-balance', selectedEvent?.paymentToken, wallet?.address],
    queryFn: async () => {
      if (!selectedEvent?.paymentToken || !wallet?.address) return '0';
      return hedgeContract.getTokenBalance(selectedEvent.paymentToken, wallet.address);
    },
    enabled: !!(selectedEvent?.paymentToken && wallet?.address && (buyOpen || lpOpen)),
    refetchInterval: 10_000,
  });
  const eventTokenSymbol = selectedEvent?.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT';
  const tokenBalanceNum = parseFloat(selectedEventTokenBalance ?? '0');

  const [newEvent, setNewEvent] = useState({
    name: '', description: '', assetClass: 'fx' as 'fx' | 'commodity' | 'crypto',
    underlying: 'USD/GHS', strike: '', payoutCap: '', premiumRate: '',
    expiryHours: '720', initialLiquidity: '', poolOpen: true, allowExternalLp: true,
    direction: 'up' as 'up' | 'down',
    paymentCurrency: 'USDC' as 'USDC' | 'USDT',
    overrideAcknowledged: false, selfPriced: false,
    // How this pool prices cover for its whole life. Fixed by default, which is
    // how every pool has behaved until now, and immutable once created.
    dynamicPricing: false,
  });

  useEffect(() => {
    if (activeChainId === 56 && activeUsdtAddress) setNewEvent((p) => ({ ...p, paymentCurrency: 'USDT' }));
    else if (!activeUsdtAddress && newEvent.paymentCurrency === 'USDT') setNewEvent((p) => ({ ...p, paymentCurrency: 'USDC' }));
  }, [activeChainId, activeUsdtAddress]);

  // ── pricing-engine quote (v8) ───────────────────────────────────────────
  const [pricingQuote, setPricingQuote] = useState<import('@/lib/pricing-quote').QuoteResponse | null>(null);
  const [pricingQuoteLoading, setPricingQuoteLoading] = useState(false);
  const [pricingQuoteError, setPricingQuoteError] = useState<string | null>(null);

  useEffect(() => {
    setPricingQuote(null);
    setPricingQuoteError(null);
    const strikeNum = parseFloat(newEvent.strike);
    const payoutCapNum = parseFloat(newEvent.payoutCap);
    const liquidityNum = parseFloat(newEvent.initialLiquidity);
    const expiryHoursNum = parseInt(newEvent.expiryHours, 10);
    if (!Number.isFinite(strikeNum) || strikeNum <= 0) return;
    if (!Number.isFinite(payoutCapNum) || payoutCapNum <= 0) return;
    if (!Number.isFinite(liquidityNum) || liquidityNum <= 0) return;
    if (!Number.isFinite(expiryHoursNum) || expiryHoursNum <= 0) return;
    if (!wallet?.address) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setPricingQuoteLoading(true);
      setPricingQuoteError(null);
      const { fetchPricingQuote } = await import('@/lib/pricing-quote');
      const expiryUnixSeconds = Math.floor(Date.now() / 1000) + expiryHoursNum * 60 * 60;
      // The engine's first call can time out while its upstream vol/rate source
      // warms — subsequent calls are served from cache. Retry a few times before
      // surfacing an error so the recommended premium reliably lands.
      let lastErr: any = null;
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const result = await fetchPricingQuote({
            pair: newEvent.underlying, strike: strikeNum, payoutCap: payoutCapNum,
            expiryUnixSeconds, notional: liquidityNum, strikeAbove: newEvent.direction === 'up',
            chainId: activeChainId, diamondAddress: hedgeContract.activeDiamond, creator: wallet.address,
          });
          if (cancelled) return;
          setPricingQuote(result);
          setPricingQuoteError(null);
          setPricingQuoteLoading(false);
          return;
        } catch (err: any) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 1300));
        }
      }
      if (cancelled) return;
      setPricingQuote(null);
      setPricingQuoteError(lastErr?.message || 'Pricing engine unavailable');
      setPricingQuoteLoading(false);
    }, 450);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [newEvent.underlying, newEvent.strike, newEvent.payoutCap, newEvent.expiryHours, newEvent.initialLiquidity, newEvent.direction, wallet?.address, activeChainId]);

  const userPremiumNum = parseFloat(newEvent.premiumRate);
  const suggestedPctRate = pricingQuote ? pricingQuote.premiumRate * 100 : null;
  const isPremiumBelowSuggested = !!(suggestedPctRate !== null && Number.isFinite(userPremiumNum) && userPremiumNum > 0 && userPremiumNum < suggestedPctRate * 0.9);


  useEffect(() => {
    if (suggestedPctRate !== null && Number.isFinite(suggestedPctRate) && suggestedPctRate > 0) {
      const next = suggestedPctRate.toFixed(3);
      setNewEvent((prev) => (prev.premiumRate === next ? prev : { ...prev, premiumRate: next }));
    }
  }, [suggestedPctRate]);

  const [events, setEvents] = useState<HedgeEventData[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  /**
   * What the load is doing, in words.
   *
   * Skeletons say something is happening and nothing about what, so a slow
   * network and a broken one look identical — you wait, and then decide the app
   * is broken. Naming the stage costs nothing and turns a blank wait into a
   * report. loadSlow follows it: past six seconds the wait is no longer normal,
   * and saying so is better than leaving someone to conclude it themselves.
   */
  const [loadStage, setLoadStage] = useState('');
  const [loadSlow, setLoadSlow] = useState(false);
  const [txStep, setTxStep] = useState('');

  /**
   * Report a failure the way it should be reported: a specific title, a next
   * step, and the raw text in the console for support rather than on screen.
   * Every mutation below used the same "Transaction Failed" heading, which
   * told the customer only that something they already knew had happened.
   */
  const toastTxError = (error: unknown) => {
    const { title, message, detail } = explainTxError(error);
    if (detail) console.error(`[hedge] ${title}:`, detail, error);
    toast({ title, description: message, variant: 'destructive' });
  };


  const [feeConfig, setFeeConfig] = useState<HedgeFeeConfig | null>(null);
  const [myPositions, setMyPositions] = useState<HedgePositionData[]>([]);
  const [myDeposits, setMyDeposits] = useState<HedgeLpDepositData[]>([]);

  const loadEvents = async () => {
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      setEventsLoading(true);
      setLoadSlow(false);
      setLoadStage(`Reading pools from ${selectedNetwork.name}\u2026`);
      slowTimer = setTimeout(() => setLoadSlow(true), 6000);
      const data = await hedgeContract.getAllEvents();
      setLoadStage('Checking pool balances\u2026');
      try {
        const dbRes = await fetch('/api/hedge/events/open');
        if (dbRes.ok) {
          const dbEvents: DbHedgeEvent[] = await dbRes.json();
          const mine = dbEvents.filter((e) => e.chainId === activeChainId && e.onChainEventId != null);

          const descMap = new Map(mine.filter((e) => e.description).map((e) => [e.onChainEventId, e.description]));
          data.forEach((e) => { if (descMap.has(e.id)) e.description = descMap.get(e.id); });

          // Fill the gaps the contract could not answer. Several pools on the
          // deployed Diamond revert on getHedgeEventCore/Stats, so reading only
          // from chain silently drops them — including live ones — and the
          // market looks empty. ChainSync mirrors every pool into the DB, so
          // anything missing from the chain read is rebuilt from that mirror
          // and flagged `fromMirror` so the UI can say the figures are not live.
          const onChainIds = new Set(data.map((e) => e.id));
          const missing = mine
            .filter((e) => !onChainIds.has(e.onChainEventId))
            .map(dbEventToHedgeEvent);
          if (missing.length > 0) {
            console.warn(`[Hedge] ${missing.length} pool(s) unreadable on chain — showing DB mirror: #${missing.map((m) => m.id).join(', #')}`);

            // The mirror carries terms but not balances, so a mirrored pool
            // would show $0 liquidity — which reads as "empty pool" to a buyer
            // or underwriter. Fill the balances from the indexed event log,
            // which matches the contract exactly where both are readable.
            try {
              const statsRes = await fetch('/api/hedge/pool-stats');
              if (statsRes.ok) {
                const stats: PoolStatRow[] = await statsRes.json();
                const byPool = new Map(
                  stats.filter((s) => s.chainId === activeChainId).map((s) => [s.poolId, s])
                );
                for (const ev of missing) {
                  const s = byPool.get(ev.id);
                  if (!s) continue;
                  ev.totalLiquidity = parseFloat(s.liquidity) || 0;
                  ev.totalExposure = parseFloat(s.exposure) || 0;
                  ev.totalPremiums = parseFloat(s.premiums) || 0;
                  ev.lpCount = s.lpCount;
                  ev.hedgerCount = s.hedgerCount;
                  ev.totalMaxPayout = ev.totalExposure * (ev.payoutPercent || 0);
                  ev.availableCapacity = Math.max(0, ev.totalLiquidity - ev.totalMaxPayout);
                  ev.utilization = ev.totalLiquidity > 0
                    ? Math.min(1, ev.totalMaxPayout / ev.totalLiquidity)
                    : 0;
                }
              }
            } catch { /* balances stay 0 if the log index is unavailable */ }

            data.push(...missing);
          }
        }
      } catch { /* description + mirror are both best-effort */ }
      setEvents(data);
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      if (slowTimer) clearTimeout(slowTimer);
      setEventsLoading(false);
      setLoadStage('');
      setLoadSlow(false);
    }
  };

  // Fee rates and bases are governable. Read the active contract config for
  // the selected chain; if that read fails, keep fees unavailable and block
  // purchase rather than quoting from a stale deployment assumption.
  const loadFeeConfig = async () => {
    setFeeConfig(null);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Fee config timeout')), 8000));
        const config = await Promise.race([hedgeContract.getFeeConfig(), timeout]);
        setFeeConfig(config);
        return;
      } catch (error) {
        console.warn(`Fee config read failed (attempt ${attempt + 1}/3):`, error);
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    console.error('[Hedge] Fee config unavailable — buy/quote disabled until it loads');
  };
  const loadPositions = async () => {
    if (!wallet?.address) return;
    try { setMyPositions(await hedgeContract.getPositionsByWallet(wallet.address)); }
    catch (error) { console.error('Failed to load positions:', error); }
  };
  const loadDeposits = async () => {
    if (!wallet?.address) return;
    try { setMyDeposits(await hedgeContract.getDepositsByWallet(wallet.address)); }
    catch (error) { console.error('Failed to load deposits:', error); }
  };

  useEffect(() => {
    hedgeContract.setChain(activeChainId);
    setEvents([]); setMyPositions([]); setMyDeposits([]);
    loadEvents(); loadFeeConfig();
    if (wallet?.address) { loadPositions(); loadDeposits(); }
  }, [activeChainId]);
  useEffect(() => { if (wallet?.address) loadPositions(); }, [wallet?.address]);
  useEffect(() => { if (wallet?.address) loadDeposits(); }, [wallet?.address]);

  useEffect(() => {
    if (!eventsLoading && events.length === 0 && !hasAutoSwitched && activeChainId !== 8453) {
      const baseNetwork = NETWORKS.find((n) => n.chainId === 8453);
      if (baseNetwork) { setHasAutoSwitched(true); updateSettings({ selectedNetworkId: baseNetwork.id }); }
    }
  }, [eventsLoading, events.length, activeChainId]);

  type FXRate = { pair: string; rate: number; source: string; timestamp: number; lastUpdated: string };
  const { data: fxData } = useQuery<{ rates: Record<string, FXRate>; pairs: string[]; pairsWithClass: Array<{ pair: string; assetClass: string }> }>({
    queryKey: ['/api/fx/rates'],
    refetchInterval: 5 * 60 * 1000,
  });
  /**
   * Is this a pool anyone should be allowed to sell?
   *
   * premiumRate is immutable on-chain — no setter exists — so a bad premium
   * cannot be corrected after createEvent. The only check here caught premiums
   * that were too *low*; event 10 was created at 3.0% against a strike and cap
   * worth 2.681%, so it charged more than it could ever pay and both its
   * hedgers lost money the moment they bought. Nothing looked at that direction.
   *
   * Server decides. The endpoint runs the same checks the engine would, and the
   * form blocks on a refusal rather than warning about it, because there is no
   * fixing it afterwards.
   */
  const [premiumCheck, setPremiumCheck] = useState<{ ok: boolean; reason?: string; warning?: string; leverage?: number } | null>(null);
  useEffect(() => {
    const strike = parseFloat(newEvent.strike);
    const cap = parseFloat(newEvent.payoutCap);
    const rate = parseFloat(newEvent.premiumRate) / 100;
    const spot = fxData?.rates[newEvent.underlying]?.rate;
    const hours = parseInt(newEvent.expiryHours, 10);
    if (!Number.isFinite(strike) || !Number.isFinite(cap) || !Number.isFinite(rate) || rate <= 0 || !spot || !Number.isFinite(hours) || hours <= 0) {
      setPremiumCheck(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/pricing/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pair: newEvent.underlying, premiumRate: rate, strike, payoutCap: cap, spot,
            strikeAbove: strike > spot,
            expiryUnixSeconds: Math.floor(Date.now() / 1000) + hours * 3600,
          }),
        });
        const j = await res.json();
        if (!cancelled) setPremiumCheck(res.ok ? j : null);
      } catch {
        // The engine being unreachable must not block pool creation — the
        // on-chain guards still apply and an LP should not be stranded by our
        // outage. It only means this particular check did not run.
        if (!cancelled) setPremiumCheck(null);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [newEvent.strike, newEvent.payoutCap, newEvent.premiumRate, newEvent.underlying, newEvent.expiryHours, fxData]);

  const fetchEventDetails = async (id: number) => {
    const local = events.find((e) => e.id === id);
    if (local) setSelectedEvent(local);
    try {
      const data = await hedgeContract.getEvent(id);
      if (local?.description && !data.description) data.description = local.description;
      setSelectedEvent(data);
      return data;
    } catch (err) {
      console.warn('[fetchEventDetails] chain read failed, using cached data:', err);
      return local ?? null;
    }
  };

  // Deep-link on mount: ?tab=, ?q= (shell search), ?event=&action= (share /
  // search click). For ?event we open the relevant sheet IMMEDIATELY in a
  // loading state — chain reads take a moment, and a modal that popped in later
  // with no feedback felt broken.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const q = params.get('q');
    const eventId = params.get('event');
    const action = params.get('action');
    if (tab === 'provide') setView('lp');
    else if (tab === 'mypools') setView('mypools');
    else if (tab === 'mypos') setView('mypos');
    if (q) { setBuySearch(q); setView('buy'); }
    if (eventId && !Number.isNaN(parseInt(eventId))) {
      const id = parseInt(eventId);
      setPendingDeep({ id, action });
      if (action === 'lp') { setView('lp'); setLpOpen(true); }
      else if (action === 'buy') { setView('buy'); setBuyOpen(true); }
      else { setDetailOpen(true); }
    }
    if (tab || q || eventId) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  // Live deep-link while already on this page: the shell search fires this so a
  // click works even though wouter won't remount the route (so the mount effect
  // above never re-runs). Opens the loading sheet immediately, same as a fresh nav.
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (typeof d.id !== 'number') return;
      const action: string | null = d.action ?? null;
      setPendingDeep({ id: d.id, action });
      if (action === 'lp') { setView('lp'); setLpOpen(true); }
      else if (action === 'buy') { setView('buy'); setBuyOpen(true); }
      else { setDetailOpen(true); }
      try { window.history.replaceState({}, '', '/hedge'); } catch { /* ignore */ }
      window.scrollTo(0, 0);
    };
    window.addEventListener('bfx:open-market', handler as EventListener);
    return () => window.removeEventListener('bfx:open-market', handler as EventListener);
  }, []);

  // Resolve the pending deep-linked market once the chain read finishes; this
  // swaps the loading skeleton in the open sheet for the real data.
  useEffect(() => {
    if (!pendingDeep || eventsLoading) return;
    const ev = events.find((e) => e.id === pendingDeep.id);
    if (ev) {
      setSelectedEvent(ev);
      setPendingDeep(null);
      fetchEventDetails(ev.id); // background refresh with full on-chain detail
    } else if (events.length > 0) {
      setDetailOpen(false); setBuyOpen(false); setLpOpen(false);
      setPendingDeep(null);
      toast({ title: 'Market unavailable', description: `Pool #${pendingDeep.id} isn't open on ${selectedNetwork.name}.`, variant: 'destructive' });
    }
  }, [pendingDeep, eventsLoading, events]);

  const copyShareLink = (eventId: number, action: 'buy' | 'lp') => {
    const url = `${window.location.origin}/hedge?event=${eventId}&action=${action}`;
    navigator.clipboard.writeText(url)
      .then(() => toast({ title: 'Link copied!', description: `Share this ${action === 'buy' ? 'hedge' : 'LP deposit'} link with others.` }))
      .catch(() => toast({ title: 'Copy failed', description: url, variant: 'destructive' }));
  };

  const recordActivity = async (payload: { actionType: string; txHash: string; onChainEventId?: number | null; amount?: string | number | null; token?: string | null; metadata?: Record<string, any> | null }) => {
    if (!wallet?.address || !payload.txHash) return;
    try {
      // The endpoint is Rift-authenticated and derives the wallet from the token,
      // then RPC-verifies reward-bearing actions. Send the bearer token.
      const accessToken = await getAccessToken().catch(() => null);
      await fetch('/api/hedge/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ chainId: activeChainId, ...payload }),
      });
    } catch (e) { console.warn('[activity] record failed (non-blocking):', e); }
  };

  // ── Mutations (unchanged) ───────────────────────────────────────────────
  const buyProtectionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEvent) throw new Error('No event selected');
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error('Wallet signer not available. Please unlock your wallet.');

      /**
       * A dynamic pool needs a price signed for this buyer, at the moment of
       * buying. The panel above already shows an unsigned quote, but that one
       * is bound to nobody and may be minutes old; a signature lasts 120
       * seconds and the contract binds it to msg.sender, so it is fetched here
       * rather than reused.
       *
       * Asked for on every purchase. buyProtection ignores it on a fixed pool,
       * and deciding here which kind of pool this is would duplicate a judgement
       * the contract already enforces.
       */
      setTxStep('Getting the current price...');
      const { fetchPurchaseQuote } = await import('@/lib/purchase-quote');
      const q = await fetchPurchaseQuote({
        chainId: activeChainId,
        eventId: selectedEvent.id,
        notional: parseFloat(notional),
        buyer: signer.address,
      });
      const quote = q.ok && q.attestation
        ? {
            premiumRate: BigInt(Math.round(q.premiumRate * 1e6)),
            quoteTimestamp: BigInt(q.attestation.quoteTimestamp),
            quoteNonce: q.attestation.quoteNonce,
            signature: q.attestation.signature,
          }
        : null;

      const txHash = await hedgeContract.buyProtection(signer, selectedEvent.id, notional, setTxStep, quote);
      await recordActivity({
        actionType: 'buy_protection', txHash, onChainEventId: selectedEvent.id, amount: notional,
        token: selectedEvent.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT',
        metadata: { eventName: selectedEvent.name, underlying: selectedEvent.underlying, strike: selectedEvent.strike, premiumRate: selectedEvent.premiumRate },
      });
    },
    onSuccess: async () => {
      setTxStep(''); await loadEvents(); await loadPositions();
      if (selectedEvent) await fetchEventDetails(selectedEvent.id);
      toast({ title: 'Protection Purchased', description: `Notional: $${parseFloat(notional).toLocaleString()} — on-chain transaction confirmed` });
      setBuyOpen(false); setNotional('');
    },
    onError: (error: any) => { setTxStep(''); toastTxError(error); },
  });

  const depositMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEvent) throw new Error('No event selected');
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error('Wallet signer not available. Please unlock your wallet.');
      const txHash = await hedgeContract.deposit(signer, selectedEvent.id, depositAmount, setTxStep);
      await recordActivity({
        actionType: 'lp_deposit', txHash, onChainEventId: selectedEvent.id, amount: depositAmount,
        token: selectedEvent.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT',
        metadata: { eventName: selectedEvent.name, underlying: selectedEvent.underlying, strike: selectedEvent.strike },
      });
    },
    onSuccess: async () => {
      setTxStep(''); await loadEvents(); await loadDeposits();
      if (selectedEvent) await fetchEventDetails(selectedEvent.id);
      toast({ title: 'Liquidity Deposited', description: `$${parseFloat(depositAmount).toLocaleString()} ${eventTokenSymbol} deposited on-chain` });
      setLpOpen(false); setDepositAmount('');
    },
    onError: (error: any) => { setTxStep(''); toastTxError(error); },
  });

  const createEventMutation = useMutation({
    mutationFn: async () => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error('Wallet signer not available. Please unlock your wallet.');
      const expiryDate = new Date();
      expiryDate.setTime(expiryDate.getTime() + Math.max(1, parseInt(newEvent.expiryHours)) * 60 * 60 * 1000);
      const currentFxRate = fxData?.rates[newEvent.underlying]?.rate;
      if (!currentFxRate) throw new Error('Cannot fetch current FX rate for ' + newEvent.underlying);
      const strikePrice = parseFloat(newEvent.strike);
      const strikeAbove = newEvent.direction === 'up';
      if (strikeAbove && strikePrice <= currentFxRate) throw new Error('Strike must be above the current rate (' + currentFxRate.toFixed(4) + ') for an upward hedge.');
      if (!strikeAbove && strikePrice >= currentFxRate) throw new Error('Strike must be below the current rate (' + currentFxRate.toFixed(4) + ') for a downward hedge.');
      const paymentTokenAddr = newEvent.paymentCurrency === 'USDT' && activeUsdtAddress ? activeUsdtAddress : activeUsdcAddress;
      const payoutCapNum = parseFloat(newEvent.payoutCap || '0') || 0;
      const signature = '0x';
      const quoteTimestamp = 0;
      const quoteNonce: string = ethers.ZeroHash;
      const signedInitialRate: number = currentFxRate;
      const { eventId: newEventId, txHash: createTxHash } = await hedgeContract.createEvent(signer, {
        name: newEvent.name, underlying: newEvent.underlying, strike: strikePrice, payoutCap: payoutCapNum,
        premiumRate: parseFloat(newEvent.premiumRate) / 100, expiryDate, allowExternalLp: newEvent.allowExternalLp,
        initialLiquidity: newEvent.initialLiquidity || '0', initialRate: signedInitialRate, strikeAbove,
        paymentToken: paymentTokenAddr, dynamicPricing: newEvent.dynamicPricing,
        signature, quoteTimestamp, quoteNonce,
      }, setTxStep);
      await recordActivity({
        actionType: 'create_event', txHash: createTxHash, onChainEventId: newEventId,
        amount: newEvent.initialLiquidity || '0', token: newEvent.paymentCurrency,
        metadata: { eventName: newEvent.name, underlying: newEvent.underlying, strike: parseFloat(newEvent.strike), premiumRate: parseFloat(newEvent.premiumRate) / 100, expiryHours: newEvent.expiryHours, direction: newEvent.direction },
      });
      if (newEvent.poolOpen && newEventId) {
        setTxStep('Opening pool...');
        const toggleTxHash = await hedgeContract.setPoolSettings(signer, newEventId, true, newEvent.allowExternalLp, setTxStep);
        await recordActivity({ actionType: 'toggle_pool', txHash: toggleTxHash, onChainEventId: newEventId, metadata: { eventName: newEvent.name, poolOpen: true, allowExternalLp: newEvent.allowExternalLp } });
      }
      if (newEventId && newEvent.description.trim()) {
        try {
          await fetch(`/api/hedge/events/chain/${activeChainId}/${newEventId}/description`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: newEvent.description.trim() }),
          });
        } catch { /* non-critical */ }
      }
    },
    onSuccess: async () => {
      setTxStep(''); await loadEvents();
      toast({ title: 'Event Created', description: newEvent.poolOpen ? 'Event created and pool is open for hedgers!' : 'Event created. Open the pool from My pools when ready.' });
      setView('mypools');
      setNewEvent({ name: '', description: '', assetClass: 'fx', underlying: 'USD/GHS', strike: '', payoutCap: '', premiumRate: '', expiryHours: '720', initialLiquidity: '', poolOpen: true, allowExternalLp: true, direction: 'up', paymentCurrency: 'USDC', overrideAcknowledged: false, selfPriced: false, dynamicPricing: false });
    },
    onError: (error: any) => { setTxStep(''); console.error('[createEvent] Failed:', error); toastTxError(error); },
  });

  const togglePoolMutation = useMutation({
    mutationFn: async ({ eventId, poolOpen, allowExternalLp }: { eventId: number; poolOpen?: boolean; allowExternalLp?: boolean }) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error('Wallet signer not available.');
      const event = events.find((e) => e.id === eventId);
      const nextPoolOpen = typeof poolOpen === 'boolean' ? poolOpen : (event?.poolOpen ?? true);
      const nextAllowLp = typeof allowExternalLp === 'boolean' ? allowExternalLp : (event?.allowExternalLp ?? true);
      const txHash = await hedgeContract.setPoolSettings(signer, eventId, nextPoolOpen, nextAllowLp, setTxStep);
      await recordActivity({ actionType: 'toggle_pool', txHash, onChainEventId: eventId, metadata: { eventName: event?.name, poolOpen: nextPoolOpen, allowExternalLp: nextAllowLp } });
    },
    onSuccess: async () => { setTxStep(''); await loadEvents(); toast({ title: 'Updated', description: 'Pool settings changed' }); },
    onError: (error: any) => { setTxStep(''); toastTxError(error); },
  });

  const claimMutation = useMutation({
    mutationFn: async (positionId: number) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error('Wallet signer not available.');
      const position = myPositions.find((p) => p.id === positionId);
      const event = position ? events.find((e) => e.id === position.eventId) : null;
      const txHash = await hedgeContract.claimPayout(signer, positionId, setTxStep);
      await recordActivity({ actionType: 'claim_payout', txHash, onChainEventId: position?.eventId ?? null, amount: position?.payoutAmount ?? null, token: event?.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT', metadata: { positionId, eventName: event?.name, underlying: event?.underlying } });
    },
    onSuccess: async () => { setTxStep(''); await loadPositions(); toast({ title: 'Payout Claimed', description: 'Funds have been sent to your wallet' }); },
    onError: (error: any) => { setTxStep(''); toastTxError(error); },
  });

  const withdrawMutation = useMutation({
    mutationFn: async (depositId: number) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error('Wallet signer not available.');
      const dep = myDeposits.find((d) => d.id === depositId);
      const event = dep ? events.find((e) => e.id === dep.eventId) : null;
      const txHash = await hedgeContract.withdrawCapital(signer, depositId, setTxStep);
      await recordActivity({ actionType: 'withdraw_lp', txHash, onChainEventId: dep?.eventId ?? null, amount: dep?.amount ?? null, token: event?.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT', metadata: { depositId, eventName: event?.name, underlying: event?.underlying } });
    },
    onSuccess: async () => { setTxStep(''); await loadDeposits(); await loadEvents(); toast({ title: 'Liquidity Withdrawn', description: 'Funds returned to your wallet' }); },
    onError: (error: any) => { setTxStep(''); toastTxError(error); },
  });

  const claimPremiumsMutation = useMutation({
    mutationFn: async (depositId: number) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error('Wallet signer not available.');
      const dep = myDeposits.find((d) => d.id === depositId);
      const event = dep ? events.find((e) => e.id === dep.eventId) : null;
      const claimable = dep ? (dep.pendingPremiums ?? dep.premiumsEarned - dep.premiumsClaimed) : null;
      const txHash = await hedgeContract.claimPremiums(signer, depositId, setTxStep);
      await recordActivity({ actionType: 'claim_premiums', txHash, onChainEventId: dep?.eventId ?? null, amount: claimable, token: event?.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT', metadata: { depositId, eventName: event?.name, underlying: event?.underlying } });
    },
    onSuccess: async () => { setTxStep(''); await loadDeposits(); toast({ title: 'Premiums Claimed', description: 'Premiums sent to your wallet' }); },
    onError: (error: any) => { setTxStep(''); toastTxError(error); },
  });

  // Creator loyalty earnings (separate from LP premiums) — withdrawable by the
  // pool creator once the pool has accrued earnings.
  const withdrawEarningsMutation = useMutation({
    mutationFn: async (eventId: number) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error('Wallet signer not available.');
      const event = events.find((e) => e.id === eventId);
      const txHash = await hedgeContract.withdrawCreatorEarnings(signer, eventId, setTxStep);
      await recordActivity({ actionType: 'claim_premiums', txHash, onChainEventId: eventId, amount: event?.creatorEarnings ?? null, token: event?.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT', metadata: { eventName: event?.name, underlying: event?.underlying, kind: 'creator_earnings' } });
    },
    onSuccess: async () => { setTxStep(''); await loadEvents(); toast({ title: 'Earnings Claimed', description: 'Creator earnings sent to your wallet' }); },
    onError: (error: any) => { setTxStep(''); toastTxError(error); },
  });

  // ── Derived for the buy/LP sheets ───────────────────────────────────────
  /**
   * Which pricing basis the pools on screen use, read from the chain.
   *
   * Not derivable from anything already loaded: the event getters do not return
   * it, and inferring it from a rate that happens to differ would call a fixed
   * pool dynamic the moment a rounding difference appeared.
   */
  useEffect(() => {
    const wanted: number[] = [];
    if (selectedEvent && dynamicById[selectedEvent.id] === undefined) wanted.push(selectedEvent.id);
    if (posDetail && dynamicById[posDetail.eventId] === undefined) wanted.push(posDetail.eventId);
    // Every open pool, because the browse cards show a premium too and a card
    // advertising a rate nobody is charged is the worst place for this to be
    // wrong. Settled pools are skipped; nothing can be bought in them.
    events.forEach((e) => {
      if (e.status === 'open' && dynamicById[e.id] === undefined && wanted.indexOf(e.id) < 0) wanted.push(e.id);
    });
    if (!wanted.length) return;
    let live = true;
    Promise.all(wanted.map((id) => hedgeContract.isDynamicallyPriced(id).then((d) => [id, d] as const)))
      .then((pairs) => {
        if (!live) return;
        setDynamicById((prev) => {
          const next = { ...prev };
          pairs.forEach(([id, d]) => { next[id] = d; });
          return next;
        });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [selectedEvent, posDetail, dynamicById, events]);

  /**
   * The rate a dynamic pool is actually charging, for the surfaces that browse
   * rather than buy.
   *
   * The cards, the market rows and the detail header all rendered
   * `ev.premiumRate`, which on a dynamic pool is the rate the creator opened at
   * and not the rate anyone pays. Event 14 listed 0.501% while the engine was
   * quoting 0.3625%, so the whole list was advertising a price that did not
   * exist. Worse, the buy sheet showed the opening rate above the amount box
   * and the charged rate in the breakdown twenty lines below it.
   *
   * Quoted at a nominal notional, which is exact: the rate does not depend on
   * size. Refreshed with the events themselves rather than on a timer.
   */
  const [liveRateById, setLiveRateById] = useState<Record<number, number>>({});
  useEffect(() => {
    const wanted = events.filter((e) => e.status === 'open' && dynamicById[e.id] === true);
    if (!wanted.length) return;
    let live = true;
    const ctl = new AbortController();
    (async () => {
      const { fetchPurchaseQuote } = await import('@/lib/purchase-quote');
      const got: Array<readonly [number, number]> = [];
      for (const e of wanted) {
        const q = await fetchPurchaseQuote(
          { chainId: activeChainId, eventId: e.id, notional: 1000 },
          ctl.signal,
        );
        if (q.ok) got.push([e.id, q.premiumRate] as const);
      }
      if (!live || !got.length) return;
      setLiveRateById((prev) => {
        const next = { ...prev };
        got.forEach(([id, r]) => { next[id] = r; });
        return next;
      });
    })().catch(() => {});
    return () => { live = false; ctl.abort(); };
  }, [events, dynamicById, activeChainId]);

  /**
   * What to show as "the premium" anywhere a pool is displayed rather than
   * bought. The live rate when there is one, the pool's own rate otherwise,
   * which is exactly right for a fixed pool and the honest fallback for a
   * dynamic one whose quote has not landed.
   */
  const displayRate = (ev: HedgeEventData): number => {
    const live = liveRateById[ev.id];
    return typeof live === 'number' && live > 0 ? live : ev.premiumRate;
  };

  const selectedIsDynamic = selectedEvent ? dynamicById[selectedEvent.id] === true : false;


  /**
   * What this cover is worth today, beside what the pool charges.
   *
   * Advisory only. `premiumCalc` above is still what the buyer pays, because
   * the contract takes the pool's stored rate and has no field for anything
   * else. This exists so the gap is visible instead of silent: a buyer with ten
   * days left of a thirty day pool is paying for thirty, and nothing on the
   * screen said so.
   *
   * Debounced, because it re-prices from chain on every keystroke otherwise,
   * and abandoned quietly on failure. A pricing engine that is down must never
   * be able to stop a purchase.
   */
  const [livePrice, setLivePrice] = useState<import('@/lib/purchase-quote').PurchaseQuote | null>(null);
  useEffect(() => {
    const n = parseFloat(notional);
    if (!buyOpen || !selectedEvent || !Number.isFinite(n) || n <= 0) { setLivePrice(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      const { fetchPurchaseQuote } = await import('@/lib/purchase-quote');
      const q = await fetchPurchaseQuote(
        { chainId: activeChainId, eventId: selectedEvent.id, notional: n },
        ctl.signal,
      );
      if (!ctl.signal.aborted) setLivePrice(q.ok ? q : null);
    }, 400);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [buyOpen, selectedEvent, notional, activeChainId]);
  // The rate this purchase is actually charged at, which is not the stored one
  // on a dynamic pool. The rule lives in purchase-quote.ts so it can be tested;
  // it also feeds the balance check, the buy button and the confirm text below.
  const chargedRate = selectedEvent
    ? chargedRateFor(selectedIsDynamic, selectedEvent.premiumRate, livePrice)
    : 0;
  const premiumCalc = selectedEvent && notional ? parseFloat(notional) * chargedRate : 0;

  // null until the live on-chain rate loads — never assume a rate.
  const hedgerFeeRate = feeConfig ? feeConfig.hedgerFeeRate : null;
  const feeKnown = hedgerFeeRate !== null;
  // On the premium, matching the deployed facet and hedge-contract.ts. Charging
  // this against the notional is what quoted $500 on a $10,000 cover.
  const hedgerFeeCalc = notional && feeKnown ? premiumCalc * hedgerFeeRate : 0;
  const totalCostCalc = premiumCalc + hedgerFeeCalc;
  const currentRate = selectedEvent ? fxData?.rates[selectedEvent.underlying]?.rate || 0 : 0;
  // Now derived from the event's own payoutCap in formatEvent, so nothing to
  // reconstruct here. This briefly recovered the rate as totalMaxPayout /
  // totalExposure, which worked but only for pools that already had a position
  // — on the belief that payoutCap had no getter. getHedgeEventRange returns
  // it and is live on both Diamonds.
  const payoutPercent = selectedEvent ? selectedEvent.payoutPercent : 0;
  const predeterminedPayout = selectedEvent && notional ? parseFloat(notional) * payoutPercent : 0;
  // The claim fee, from the chain rather than a literal. This was × 0.99 — a 1%
  // deduction — while the deployed config charges 2% on Base, so the headline
  // "max payout if triggered" promised more than a claim would pay. Overstating
  // a premium is a bad quote; overstating a payout is a bad promise.
  const payoutFeeRate = feeConfig ? feeConfig.hedgerPayoutFeeRate : null;
  const netPredeterminedPayout =
    predeterminedPayout > 0 ? predeterminedPayout * (1 - (payoutFeeRate ?? 0)) : 0;

  // The pool has to be able to cover the payout it would owe, and the contract
  // enforces that — reverting with "Insufficient pool liquidity for payout".
  //
  // This sheet quoted a premium, a fee and a total for any notional typed into
  // it and never once asked whether the pool could take the position. On a pool
  // with $93 of spare capacity a $10,000 notional looked entirely buyable, and
  // stayed looking buyable through the token approval and the gas, until the
  // simulation rejected it. The capacity was already on the event; nothing read
  // it. The comparison is against the gross payout, since that is what the pool
  // reserves — the claim fee is taken from the hedger's side of it.
  const availableCapacity = selectedEvent ? selectedEvent.availableCapacity : 0;
  const maxNotionalForPool =
    selectedEvent && payoutPercent > 0 ? availableCapacity / payoutPercent : 0;
  const exceedsCapacity = predeterminedPayout > availableCapacity;

  // ── Mainnet guard wrappers (unchanged) ──────────────────────────────────
  const guardedBuyProtection = () => {
    if (!selectedEvent) return;
    if (!wallet) { toast({ title: 'Wallet locked', description: 'Please unlock your wallet to buy protection.', variant: 'destructive' }); return; }
    const paymentAmount = totalCostCalc;
    const chainCheck = mainnetGuard.validateChainId(activeChainId);
    if (!chainCheck.allowed) { toast({ title: 'Network error', description: chainCheck.reason, variant: 'destructive' }); return; }
    const txCheck = mainnetGuard.validateTransaction(paymentAmount, wallet.address);
    if (!txCheck.allowed) { toast({ title: 'Transaction blocked', description: txCheck.reason, variant: 'destructive' }); return; }
    if (txCheck.requiresConfirmation) {
      const notionalNum = parseFloat(notional) || 0;
      setConfirmMessage(`You are paying $${paymentAmount.toFixed(2)} ${eventTokenSymbol} (premium + fee) to buy $${notionalNum.toLocaleString()} notional coverage on ${selectedNetwork.name}. This uses real funds and cannot be reversed.`);
      setPendingAction(() => () => { buyProtectionMutation.mutate(); mainnetGuard.recordTransaction(wallet.address, paymentAmount); });
      setConfirmDialogOpen(true);
      return;
    }
    buyProtectionMutation.mutate();
    mainnetGuard.recordTransaction(wallet.address, paymentAmount);
  };

  const guardedDeposit = () => {
    if (!selectedEvent) return;
    if (!wallet) { toast({ title: 'Wallet locked', description: 'Please unlock your wallet to deposit.', variant: 'destructive' }); return; }
    const amount = parseFloat(depositAmount) || 0;
    const chainCheck = mainnetGuard.validateChainId(activeChainId);
    if (!chainCheck.allowed) { toast({ title: 'Network error', description: chainCheck.reason, variant: 'destructive' }); return; }
    const txCheck = mainnetGuard.validateTransaction(amount, wallet.address);
    if (!txCheck.allowed) { toast({ title: 'Transaction blocked', description: txCheck.reason, variant: 'destructive' }); return; }
    if (txCheck.requiresConfirmation) {
      setConfirmMessage(`You are depositing $${amount.toFixed(2)} ${eventTokenSymbol} as liquidity on ${selectedNetwork.name}. This uses real funds and cannot be reversed.`);
      setPendingAction(() => () => { depositMutation.mutate(); mainnetGuard.recordTransaction(wallet.address, amount); });
      setConfirmDialogOpen(true);
      return;
    }
    depositMutation.mutate();
    mainnetGuard.recordTransaction(wallet.address, amount);
  };

  // ── Derived lists ───────────────────────────────────────────────────────
  const myAddr = wallet?.address?.toLowerCase() || '';
  /**
   * Buyable markets: open, and not expired by date.
   *
   * Your own pools used to be filtered out here. Nothing in the contract asks
   * for that: simulating buyProtection from the creator's address and from a
   * stranger's returns the identical revert, "Event not open", so the creator
   * is not treated differently on chain. It was a UI rule.
   *
   * And it blocked a real case. A business that creates a pool to attract
   * underwriters usually has the exposure it is trying to hedge in the first
   * place, and an underwriter may want to lay off part of the risk they are
   * carrying. Both are legitimate, and both were unreachable.
   */
  const openMarkets = useMemo(
    () => events.filter((e) => e.status === 'open' && e.expiryDate.getTime() > Date.now()),
    [events],
  );

  const buyList = useMemo(() => {
    let list = openMarkets.filter((e) => buyAsset === 'all' || getAssetClass(e.underlying) === buyAsset);
    const q = buySearch.toLowerCase().trim();
    if (q) {
      const qn = q.replace(/[\s/]/g, '');
      list = list.filter((e) => {
        const dir = e.strikeAbove ? 'rises rise up' : 'falls fall down';
        const hay = `${e.underlying} ${e.name} ${pairLabel(e.underlying)} ${dir}`.toLowerCase();
        return hay.includes(q) || hay.replace(/[\s/]/g, '').includes(qn);
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (buySort === 'prem-asc') return a.premiumRate - b.premiumRate;
      if (buySort === 'prem-desc') return b.premiumRate - a.premiumRate;
      if (buySort === 'liq-desc') return b.availableCapacity - a.availableCapacity;
      if (buySort === 'exp-asc') return a.expiryDate.getTime() - b.expiryDate.getTime();
      return 0;
    });
    return sorted;
  }, [openMarkets, buyAsset, buySearch, buySort]);

  const lpList = useMemo(() => {
    let list = events.filter((e) => e.status === 'open' && e.expiryDate.getTime() > Date.now() && (lpAsset === 'all' || getAssetClass(e.underlying) === lpAsset));
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (lpSort === 'prem-desc') return b.premiumRate - a.premiumRate;
      if (lpSort === 'util-desc') return b.utilization - a.utilization;
      if (lpSort === 'cap-desc') return b.availableCapacity - a.availableCapacity;
      return 0;
    });
    return sorted;
  }, [events, lpAsset, lpSort]);

  const myEvents = useMemo(() => events.filter((e) => e.creator.toLowerCase() === myAddr), [events, myAddr]);
  const activeDeposits = useMemo(() => myDeposits.filter((d) => !d.withdrawn), [myDeposits]);

  /**
   * Premiums still owed on deposits whose capital has already come out.
   *
   * These exist because withdrawCapital used to mark a deposit withdrawn
   * without paying the premiums it had earned, and claimPremiums then refused
   * forever. It cost $165.59 across nine deposits before the contract was
   * fixed. The money was never gone, only unreachable, and both the payment
   * and the view now report it correctly.
   *
   * Deliberately its own section rather than folded into the list above, which
   * is about live underwriting. And deliberately self-clearing: it renders only
   * while something is owed, so once these are claimed it disappears on its own
   * rather than needing to be taken out later.
   */
  const owedAfterWithdrawal = useMemo(
    () => myDeposits.filter((d) => d.withdrawn && (d.pendingPremiums ?? 0) > 0),
    [myDeposits],
  );
  const owedTotal = useMemo(
    () => owedAfterWithdrawal.reduce((a, d) => a + (d.pendingPremiums ?? 0), 0),
    [owedAfterWithdrawal],
  );
  const activePositions = useMemo(
    () => byNewest(myPositions.filter((p) => p.status === 'active')),
    [myPositions],
  );
  // A winning position can be reported as either 'claimable' (1) or 'settled_win'
  // (4) depending on contract version — both are claimable until `claimed`.
  const claimablePositions = useMemo(
    () => byNewest(myPositions.filter((p) => (p.status === 'claimable' || p.status === 'settled_win') && !p.claimed && p.payoutAmount >= CLAIM_DUST)),
    [myPositions],
  );
  const historyPositions = useMemo(() => {
    const claimSet = new Set(claimablePositions.map((p) => p.id));
    return byNewest(myPositions.filter((p) => p.status !== 'active' && !claimSet.has(p.id)));
  }, [myPositions, claimablePositions]);

  // ── helpers for opening sheets ──────────────────────────────────────────
  const openDetail = (ev: HedgeEventData) => { setSelectedEvent(ev); setNotional(''); setDepositAmount(''); setDetailOpen(true); };
  const openBuy = (ev: HedgeEventData) => { setSelectedEvent(ev); setNotional(''); setDetailOpen(false); setBuyOpen(true); };
  const openLp = (ev: HedgeEventData) => { setSelectedEvent(ev); setDepositAmount(''); setDetailOpen(false); setLpOpen(true); };

  // ── create form helpers ─────────────────────────────────────────────────
  const createPairs = useMemo(() => {
    const list = fxData?.pairsWithClass || [];
    return list.filter((p) => p.assetClass === newEvent.assetClass);
  }, [fxData, newEvent.assetClass]);
  const createRate = fxData?.rates[newEvent.underlying]?.rate;
  const createUnit = unitOf(newEvent.underlying);
  const seedNum = parseFloat(newEvent.initialLiquidity.replace(/,/g, '')) || 0;
  const creationFee = feeConfig?.creationFee ?? 2;

  const DURATIONS: Array<{ label: string; hours: number }> = [
    { label: '24 hours', hours: 24 }, { label: '3 days', hours: 72 }, { label: '7 days', hours: 168 },
    { label: '14 days', hours: 336 }, { label: '30 days', hours: 720 }, { label: '60 days', hours: 1440 }, { label: '90 days', hours: 2160 },
  ];
  const durationLabel = DURATIONS.find((d) => String(d.hours) === newEvent.expiryHours)?.label || `${newEvent.expiryHours}h`;

  if (!wallet) {
    return (
      <AppShell active="cover" greeting={{ title: 'Cover', subtitle: 'Protect against currency moves — or earn by underwriting' }}>
        <div style={{ display: 'grid', placeItems: 'center', padding: '60px 0' }}>
          <div className="create-card" style={{ maxWidth: 380, textAlign: 'center' }}>
            <span className="t-ico" style={{ margin: '0 auto 12px' }}><Shield /></span>
            <h3 style={{ fontSize: 18, fontWeight: 600 }}>Sign in required</h3>
            <p className="cc-sub" style={{ marginTop: 6 }}>Sign in to buy cover or underwrite pools.</p>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setLocation('/auth')}><Wallet /> Sign in</button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="cover" greeting={{ title: 'Cover', subtitle: 'Protect against currency moves — or earn by underwriting' }}>
      <div className="page-head">
        <div className="ph-l">
          <h1>Cover marketplace</h1>
          <p>A peer-to-peer market for currency protection. Underwriters lock USDC to sell cover; hedgers buy protection that pays out when a rate touches its strike.</p>
        </div>
      </div>

      {/* View tabs — three intents rather than five destinations.
          Underwriting an existing pool and creating a new one are both
          supply-side actions, and "my cover"/"my pools" are both portfolio,
          so each pair shares a tab with a segmented control beneath it.
          The underlying view names are unchanged so ?tab= deep links and the
          post-creation redirect keep working. */}
      <div className="cv-tabs">
        <button className={view === 'buy' ? 'on' : ''} onClick={() => setView('buy')}><ShieldCheck /> Buy cover</button>
        <button className={view === 'lp' || view === 'create' ? 'on' : ''} onClick={() => setView('lp')}><Layers /> Underwrite</button>
        <button className={view === 'mypos' || view === 'mypools' ? 'on' : ''} onClick={() => setView('mypos')}><Shield /> Portfolio</button>
      </div>

      {eventsLoading && loadStage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 2px', fontSize: 13, color: 'var(--tx-3)' }}>
          <Loader2 className="spin" style={{ width: 14, height: 14 }} />
          <span>{loadStage}</span>
          {loadSlow && (
            <span style={{ color: 'var(--amber)' }}>· slower than usual, the network is taking its time</span>
          )}
        </div>
      )}

      {(view === 'lp' || view === 'create') && (
        <div className="assettog cv-sub">
          <button className={view === 'lp' ? 'on' : ''} onClick={() => setView('lp')}><Layers /> Open pools</button>
          <button className={view === 'create' ? 'on' : ''} onClick={() => setView('create')}><PlusCircle /> Create pool</button>
        </div>
      )}

      {(view === 'mypos' || view === 'mypools') && (
        <div className="assettog cv-sub">
          <button className={view === 'mypos' ? 'on' : ''} onClick={() => setView('mypos')}><Shield /> My cover</button>
          <button className={view === 'mypools' ? 'on' : ''} onClick={() => setView('mypools')}><Award /> My pools</button>
        </div>
      )}

      {/* ===== BUY ===== */}
      {view === 'buy' && (
        <section className="cv-view on">
          <div className="filterbar">
            <div className="assettog">
              {(['all', 'fx', 'commodity'] as AssetClass[]).map((a) => (
                <button key={a} className={buyAsset === a ? 'on' : ''} onClick={() => setBuyAsset(a)}>{a === 'all' ? 'All' : a === 'fx' ? 'FX' : 'Commodities'}</button>
              ))}
            </div>
            <div className="fsearch"><Search /><input placeholder="Search pair, e.g. USD/NGN" value={buySearch} onChange={(e) => setBuySearch(e.target.value)} /></div>
            <label className="fsort"><ArrowUpDown />
              <select value={buySort} onChange={(e) => setBuySort(e.target.value as any)}>
                <option value="prem-asc">Premium: low to high</option>
                <option value="prem-desc">Premium: high to low</option>
                <option value="liq-desc">Liquidity: high to low</option>
                <option value="exp-asc">Expiry: soonest</option>
              </select>
            </label>
          </div>
          <div className="mkt">
            <div className="mkt-scroll">
              <div className="mkt-h">
                <span>Market</span><span>Direction</span><span>Strike</span><span>Premium</span><span>Available</span><span className="last">Action</span>
              </div>
              <div>
                {eventsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div className="mkt-row" key={`sk${i}`} style={{ cursor: 'default' }}>
                      <div className="mkt-mk">
                        <div className="skel" style={{ width: 36, height: 36, borderRadius: '50%', flex: '0 0 auto' }} />
                        <div className="mkt-nm" style={{ width: '100%' }}>
                          <div className="skel" style={{ height: 13, width: 90, borderRadius: 5 }} />
                          <div className="skel" style={{ height: 10, width: 130, borderRadius: 5, marginTop: 6 }} />
                        </div>
                      </div>
                      <div className="mkt-col"><div className="skel" style={{ height: 22, width: 64, borderRadius: 7 }} /></div>
                      <div className="mkt-col"><div className="skel" style={{ height: 14, width: 50, borderRadius: 5 }} /></div>
                      <div className="mkt-col"><div className="skel" style={{ height: 14, width: 40, borderRadius: 5 }} /></div>
                      <div className="mkt-act"><div className="skel" style={{ height: 38, width: 92, borderRadius: 10 }} /><div className="skel" style={{ height: 38, width: 58, borderRadius: 10 }} /></div>
                    </div>
                  ))
                ) : buyList.length === 0 ? (
                  <div className="empty">No covers match your filters.</div>
                ) : buyList.map((ev) => (
                  <div className="mkt-row" key={ev.id} onClick={() => openDetail(ev)}>
                    <div className="mkt-mk"><MarketFlag pair={ev.underlying} /><div className="mkt-nm">
                      <div className="a">
                        {pairLabel(ev.underlying)}
                        {/* Marked, not hidden. Buying into a pool you created
                            is allowed and sometimes sensible, but it should be
                            a choice you can see you are making. */}
                        {ev.creator.toLowerCase() === myAddr && (
                          <span style={{
                            marginLeft: 7, fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '.05em',
                            padding: '2px 6px', borderRadius: 4, verticalAlign: 'middle',
                            border: '1px solid color-mix(in oklab, var(--blue) 40%, var(--border))',
                            color: 'var(--blue)',
                          }}>YOUR POOL</span>
                        )}
                      </div>
                      <div className="b">{ev.name} · {expiryLabel(ev.expiryDate)}</div></div></div>
                    <div className="mkt-col"><span className="k">Direction</span><span className="dir"><span className="da">{ev.strikeAbove ? <ArrowUpRight /> : <ArrowDownRight />}</span>{ev.strikeAbove ? 'Rises' : 'Falls'}</span></div>
                    <div className="mkt-col"><span className="k">Strike</span><span className="mkt-v">{ev.strike.toLocaleString()}</span></div>
                    <div className="mkt-col"><span className="k">Premium</span><span className="mkt-v">{fmtRate(displayRate(ev))}</span></div>
                    {/* Capacity a buyer can actually draw on. Without this the
                        table gave no indication whether a pool could fill the
                        cover being requested. */}
                    <div className="mkt-col">
                      <span className="k">Available</span>
                      <span className="mkt-v">{fmtK(ev.availableCapacity)}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--tx-4)', marginTop: 2 }}>of {fmtK(ev.totalLiquidity)} pool</span>
                    </div>
                    <div className="mkt-act">
                      <button className="btn-sm2 primary" onClick={(e) => { e.stopPropagation(); openBuy(ev); }}>Buy cover</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===== PROVIDE LIQUIDITY ===== */}
      {view === 'lp' && (
        <section className="cv-view on">
          <div className="filterbar">
            <div className="assettog">
              {(['all', 'fx', 'commodity'] as AssetClass[]).map((a) => (
                <button key={a} className={lpAsset === a ? 'on' : ''} onClick={() => setLpAsset(a)}>{a === 'all' ? 'All' : a === 'fx' ? 'FX' : 'Commodities'}</button>
              ))}
            </div>
            <label className="fsort"><ArrowUpDown />
              <select value={lpSort} onChange={(e) => setLpSort(e.target.value as any)}>
                <option value="prem-desc">Premium: high to low</option>
                <option value="util-desc">Utilization: high to low</option>
                <option value="cap-desc">Capacity: most room</option>
              </select>
            </label>
          </div>
          <div className="pool-grid">
            {eventsLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div className="pool-card" key={`sk${i}`}>
                  <div className="pool-top">
                    <div className="skel" style={{ width: 38, height: 38, borderRadius: '50%', flex: '0 0 auto' }} />
                    <div className="pt-nm" style={{ flex: 1 }}>
                      <div className="skel" style={{ height: 14, width: 100, borderRadius: 5 }} />
                      <div className="skel" style={{ height: 10, width: 130, borderRadius: 5, marginTop: 6 }} />
                    </div>
                    <div className="skel" style={{ height: 30, width: 48, borderRadius: 7 }} />
                  </div>
                  <div className="pool-stats">
                    <div className="skel" style={{ height: 42, borderRadius: 9 }} /><div className="skel" style={{ height: 42, borderRadius: 9 }} />
                    <div className="skel" style={{ height: 42, borderRadius: 9 }} /><div className="skel" style={{ height: 42, borderRadius: 9 }} />
                  </div>
                  <div className="skel" style={{ height: 8, borderRadius: 4, margin: '14px 0' }} />
                  <div className="skel" style={{ height: 38, borderRadius: 10 }} />
                </div>
              ))
            ) : lpList.length === 0 ? (
              <div className="empty">No open pools right now.</div>
            ) : lpList.map((ev) => (
              <PoolCard key={ev.id} ev={ev} rate={displayRate(ev)} onAdd={() => openLp(ev)} onOpen={() => openDetail(ev)} />
            ))}
          </div>
        </section>
      )}

      {/* ===== CREATE ===== */}
      {view === 'create' && (
        <section className="cv-view on">
          <div className="create-wrap">
            <div className="create-col">
              {/* 1. Event */}
              <div className="create-card">
                <div className="cc-title"><span className="n">1</span> Event</div>
                <div className="cc-sub">Name your protection event and pick the asset class.</div>
                <div className="field">
                  <label>Asset class</label>
                  <div className="seg2">
                    <button className={newEvent.assetClass === 'fx' ? 'on' : ''} onClick={() => setNewEvent((p) => ({ ...p, assetClass: 'fx' }))}><Banknote /> FX</button>
                    <button className={newEvent.assetClass === 'commodity' ? 'on' : ''} onClick={() => setNewEvent((p) => ({ ...p, assetClass: 'commodity' }))}><Wheat /> Commodity</button>
                    <button className={newEvent.assetClass === 'crypto' ? 'on' : ''} onClick={() => setNewEvent((p) => ({ ...p, assetClass: 'crypto' }))}><CircleDollarSign /> Crypto</button>
                  </div>
                </div>
                <div className="field"><label>Event name</label><input className="input" placeholder="e.g. Naira 30-day downside cover" value={newEvent.name} onChange={(e) => setNewEvent((p) => ({ ...p, name: e.target.value }))} /></div>
                <div className="field">
                  <label>{newEvent.assetClass === 'fx' ? 'Currency pair' : 'Market'}</label>
                  <button className="select" onClick={() => setPairPickerOpen(true)}>
                    <MarketFlag pair={newEvent.underlying} className="" /><span className="lab">{pairLabel(newEvent.underlying)}</span><span className="chev"><ChevronDown /></span>
                  </button>
                  <p className="hint" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>{newEvent.assetClass === 'commodity' ? 'Current price' : 'Current rate'}</span>
                    <strong style={{ color: 'var(--tx)', fontFamily: 'var(--mono)' }}>
                      {createRate != null
                        ? `${newEvent.assetClass === 'commodity' ? '$' : ''}${createRate.toLocaleString(undefined, { maximumFractionDigits: 4 })}${newEvent.assetClass === 'commodity' ? '' : ' ' + createUnit}`
                        : '—'}
                    </strong>
                  </p>
                </div>
                <div className="field"><label>Description <span style={{ color: 'var(--tx-4)', textTransform: 'none', letterSpacing: 0 }}>— optional</span></label><textarea className="textarea" placeholder="What is this cover for? Who is it useful to?" value={newEvent.description} onChange={(e) => setNewEvent((p) => ({ ...p, description: e.target.value }))} /></div>
              </div>

              {/* 2. Terms */}
              <div className="create-card">
                <div className="cc-title"><span className="n">2</span> Terms</div>
                <div className="cc-sub">Define when the cover pays and how much.</div>
                <div className="field">
                  <label>Hedge direction</label>
                  <div className="seg2">
                    <button className={`up ${newEvent.direction === 'up' ? 'on' : ''}`} onClick={() => setNewEvent((p) => ({ ...p, direction: 'up' }))}><TrendingUp /> Rate rises</button>
                    <button className={`down ${newEvent.direction === 'down' ? 'on' : ''}`} onClick={() => setNewEvent((p) => ({ ...p, direction: 'down' }))}><TrendingDown /> Rate falls</button>
                  </div>
                  <p className="hint">{newEvent.direction === 'up' ? 'Pays hedgers if the rate rises past the strike (local currency weakens).' : 'Pays hedgers if the rate falls below the strike (local currency strengthens).'}</p>
                </div>
                <div className="frow">
                  <div className="field"><label>Strike price</label><div className="inwrap"><input className="input" inputMode="decimal" placeholder={createRate ? createRate.toFixed(2) : '1,650'} value={newEvent.strike} onChange={(e) => setNewEvent((p) => ({ ...p, strike: e.target.value }))} /><span className="suffix">{createUnit}</span></div></div>
                  <div className="field"><label>Payout cap</label><div className="inwrap"><input className="input" inputMode="decimal" placeholder="1,850" value={newEvent.payoutCap} onChange={(e) => setNewEvent((p) => ({ ...p, payoutCap: e.target.value }))} /><span className="suffix">{createUnit}</span></div></div>
                </div>
                <p className="hint">Set the cap beyond the strike. Payout grows linearly between strike and cap, then flattens — this bounds the maximum LP loss.{createRate ? ` Current rate: ${createRate.toLocaleString()}.` : ''}</p>
                <div className="frow" style={{ marginTop: 14 }}>
                  <div className="field"><label>Premium rate</label><div className="inwrap"><input className="input" inputMode="decimal" placeholder="2.5" value={newEvent.premiumRate} onChange={(e) => setNewEvent((p) => ({ ...p, premiumRate: e.target.value }))} /><span className="suffix">%</span></div>
                    {pricingQuoteLoading && <p className="hint">Computing fair-value quote…</p>}
                    {pricingQuoteError && <p className="hint" style={{ color: 'var(--red)' }}>{pricingQuoteError}</p>}
                  </div>
                  <div className="field"><label>Duration</label><button className="select" onClick={() => setDurationOpen(true)}><span className="lab">{durationLabel}</span><span className="chev"><ChevronDown /></span></button></div>
                </div>
                {premiumCheck?.ok === false && (
                  <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--red)', background: 'color-mix(in oklab, var(--red) 8%, transparent)' }}>
                    <p className="hint" style={{ color: 'var(--red)', margin: 0 }}>{premiumCheck.reason}</p>
                  </div>
                )}
                {premiumCheck?.ok && premiumCheck.warning && (
                  <p className="hint" style={{ marginTop: 10, color: 'var(--amber)' }}>{premiumCheck.warning}</p>
                )}
                {isPremiumBelowSuggested && (
                  <div style={{ marginTop: 10 }}>
                    <p className="hint" style={{ color: 'var(--amber)' }}>Your premium is more than 10% below the engine's suggested {suggestedPctRate?.toFixed(2)}%. You may be underwriting below fair value.</p>
                    <label className="toggle-row" style={{ cursor: 'pointer' }}>
                      <div className="ts">I understand and accept the risk of underwriting at a below-fair price.</div>
                      <input type="checkbox" checked={newEvent.overrideAcknowledged} onChange={(e) => setNewEvent((p) => ({ ...p, overrideAcknowledged: e.target.checked }))} />
                    </label>
                  </div>
                )}
              </div>

              {/* 3. Liquidity */}
              <div className="create-card">
                <div className="cc-title"><span className="n">3</span> Liquidity &amp; settings</div>
                <div className="cc-sub">Seed the pool and choose who can participate.</div>
                <div className="frow">
                  <div className="field"><label>Payment currency</label>
                    <div className="seg2">
                      <button className={newEvent.paymentCurrency === 'USDC' ? 'on' : ''} onClick={() => setNewEvent((p) => ({ ...p, paymentCurrency: 'USDC' }))}>USDC</button>
                      {activeUsdtAddress && <button className={newEvent.paymentCurrency === 'USDT' ? 'on' : ''} onClick={() => setNewEvent((p) => ({ ...p, paymentCurrency: 'USDT' }))}>USDT</button>}
                    </div>
                  </div>
                  <div className="field"><label>Initial liquidity</label><div className="inwrap"><input className="input" inputMode="decimal" placeholder="1,000" value={newEvent.initialLiquidity} onChange={(e) => setNewEvent((p) => ({ ...p, initialLiquidity: e.target.value }))} /><span className="suffix">{newEvent.paymentCurrency}</span></div></div>
                </div>
                <p className="hint">Minimum 10 {newEvent.paymentCurrency}. This is your seed collateral and first LP position.</p>
                <div style={{ marginTop: 10 }}>
                  <div className="toggle-row"><div><div className="tt">Open pool to hedgers</div><div className="ts">List on the marketplace so anyone can buy cover.</div></div><div className={`switch${newEvent.poolOpen ? ' on' : ''}`} onClick={() => setNewEvent((p) => ({ ...p, poolOpen: !p.poolOpen }))} /></div>
                  <div className="toggle-row"><div><div className="tt">Allow external LPs</div><div className="ts">Let other liquidity providers add collateral to your pool.</div></div><div className={`switch${newEvent.allowExternalLp ? ' on' : ''}`} onClick={() => setNewEvent((p) => ({ ...p, allowExternalLp: !p.allowExternalLp }))} /></div>
                  {/* Chosen here and never again: the contract has no setter,
                      because how a pool prices is one of its terms and an LP
                      who funded it on that basis must not have it changed
                      under them. It also decides which entry point buyers use,
                      so they cannot pick whichever price is cheaper. */}
                  <div className="toggle-row">
                    <div>
                      <div className="tt">Price it as time passes</div>
                      <div className="ts">
                        {newEvent.dynamicPricing
                          ? 'Each buyer pays what the cover is worth on the day, priced from the volatility your premium implies. Costs less with little time left, more once the rate nears the strike.'
                          : 'Every buyer pays your premium for the pool\'s whole life, so someone buying on the last day pays the same as someone buying on the first.'}
                      </div>
                      <div className="ts" style={{ marginTop: 4, color: 'var(--tx-4)' }}>
                        This cannot be changed after the pool is created.
                      </div>
                    </div>
                    <div className={`switch${newEvent.dynamicPricing ? ' on' : ''}`} onClick={() => setNewEvent((p) => ({ ...p, dynamicPricing: !p.dynamicPricing }))} /></div>
                </div>
              </div>
            </div>

            {/* summary */}
            <aside className="summary">
              <h3>Cost breakdown</h3>
              <div className="sum-pre">
                <div className="pair-line"><MarketFlag pair={newEvent.underlying} className="" /><div><div className="pl-nm">{pairLabel(newEvent.underlying)}</div><div className="pl-sub">{newEvent.direction === 'up' ? 'Rate rises' : 'Rate falls'} · {durationLabel}</div></div></div>
              </div>
              <div className="sum-line"><span className="l">Initial liquidity</span><span className="v">{seedNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {newEvent.paymentCurrency}</span></div>
              <div className="sum-line"><span className="l">Event creation fee</span><span className="v">${creationFee.toFixed(2)}</span></div>
              <div className="sum-line total"><span className="l">Total required</span><span className="v">{(seedNum + creationFee).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {newEvent.paymentCurrency}</span></div>
              <button className="btn btn-primary"
                disabled={createEventMutation.isPending || seedNum < 10 || !newEvent.name.trim() || !newEvent.strike || !newEvent.payoutCap || !newEvent.premiumRate || (isPremiumBelowSuggested && !newEvent.overrideAcknowledged) || premiumCheck?.ok === false}
                onClick={() => createEventMutation.mutate()}>
                {createEventMutation.isPending ? <><Loader2 className="spin" /> {txStep || 'Creating…'}</> : <><Check /> Create event</>}
              </button>
              <p className="fineprint">You'll be the underwriter and first LP. Funds stay in the pool's smart contract until settlement.</p>
            </aside>
          </div>
        </section>
      )}

      {/* ===== MY POSITIONS ===== */}
      {view === 'mypos' && (
        <section className="cv-view on">
          {eventsLoading ? (
            <div className="pool-grid" style={{ gridTemplateColumns: '1fr' }}>{[0, 1].map((i) => <PoolCardSkeleton key={i} />)}</div>
          ) : myPositions.length === 0 ? (
            <div className="empty">No cover positions yet. Buy cover to protect your exposure.</div>
          ) : (
            <div className="pool-grid" style={{ gridTemplateColumns: '1fr' }}>
              {claimablePositions.map((p) => {
                const ev = events.find((e) => e.id === p.eventId);
                // Same claim fee as the quote card, from the chain not a literal.
                const gross = p.payoutAmount; const net = gross * (1 - (payoutFeeRate ?? 0));
                return (
                  <div className="pool-card" key={`c${p.id}`} style={{ borderColor: 'color-mix(in oklab,var(--green) 35%,var(--border))' }}>
                    <div className="pool-top"><MarketFlag pair={ev?.underlying || ''} /><div className="pt-nm"><div className="a">{pairLabel(ev?.underlying || `#${p.eventId}`)}</div><div className="b">Position #{p.id} · payout ready</div></div>
                      <div className="pool-apr"><div className="v" style={{ color: 'var(--green)' }}>{fmtMoney(net)}</div><div className="l">Claimable</div></div></div>
                    <div className="brk"><div className="brk-line"><span className="l">Gross payout</span><span className="v">{fmtMoney(gross)}</span></div><div className="brk-line"><span className="l">Claim fee{payoutFeeRate !== null ? ` (${(payoutFeeRate * 100).toFixed(1)}%)` : ''}</span><span className="v">-{fmtMoney(gross - net)}</span></div></div>
                    <button className="btn-sm2 primary" disabled={claimMutation.isPending} onClick={() => claimMutation.mutate(p.id)}>{claimMutation.isPending ? 'Claiming…' : `Claim ${fmtUsd2(net)}`}</button>
                  </div>
                );
              })}
              {activePositions.map((p) => {
                const ev = events.find((e) => e.id === p.eventId);
                return (
                  <div className="pool-card" key={`a${p.id}`}>
                    <div className="pool-top"><MarketFlag pair={ev?.underlying || ''} /><div className="pt-nm"><div className="a">{pairLabel(ev?.underlying || `#${p.eventId}`)}</div><div className="b">{expiryNarration(ev?.expiryDate) ?? `Event #${p.eventId}`}</div></div>
                      <div className="pool-apr"><div className="v">{fmtMoney(p.notional)}</div><div className="l">Notional</div></div></div>
                    <div className="pool-stats">
                      <div className="pool-stat"><div className="l">Premium paid</div><div className="v tnum">{fmtUsd2(p.premiumPaid)}</div></div>
                      <div className="pool-stat"><div className="l">Max payout</div><div className="v tnum">{fmtMoney(p.payoutAmount)}</div></div>
                    </div>
                    {ev && (
                      <div style={{ marginTop: 8 }}>
                        {/* Closed by default: a chart and three cards opened
                            on every position turns the list into a wall. */}
                        <CoverDetail
                          notional={p.notional}
                          totalCost={p.premiumPaid + p.platformFeePaid}
                          maxPayout={p.payoutAmount}
                          strike={ev.strike}
                          initialRate={ev.initialRate}
                          strikeAbove={ev.strikeAbove}
                          underlying={ev.underlying}
                          currentRate={fxData?.rates[ev.underlying]?.rate || 0}
                          settled={ev.status !== 'open'}
                          settlementPrice={ev.settlementPrice}
                          actualPayout={p.payoutAmount}
                          boughtOn={p.createdAt ? p.createdAt.toISOString().slice(0, 10) : undefined}
                          cap={payoutModelFor(p, ev).cap}
                          maxPayoutLabel={fmtMoney(maxPayoutFor(p, ev))}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {historyPositions.length > 0 && (
                <div className="list">
                  {historyPositions.map((p) => {
                    const ev = events.find((e) => e.id === p.eventId);
                    const label = p.status === 'claimed' ? 'Claimed' : p.status === 'settled_win' ? 'Won' : 'Expired';
                    // These have all run their course, so the narration here is
                    // always the past form. It answers "how long ago was this?"
                    // without making the reader open the row.
                    const ended = expiryNarration(ev?.expiryDate);
                    return (
                      <div
                        className="row"
                        key={`h${p.id}`}
                        style={{ cursor: 'pointer' }}
                        role="button"
                        tabIndex={0}
                        onClick={() => setPosDetail(p)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPosDetail(p); } }}
                      >
                        <MarketFlag pair={ev?.underlying || ''} />
                        <div className="r-main"><div className="r1">{pairLabel(ev?.underlying || `#${p.eventId}`)}</div><div className="r2">Position #{p.id} · {fmtMoney(p.notional)} notional{ended ? ` · ${ended}` : ''}</div></div>
                        <div className="r-side" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`st ${p.status === 'expired' ? 'pend' : 'ok'}`}>{label}</span>
                          <ChevronRight style={{ width: 15, height: 15, color: 'var(--tx-4)', flex: '0 0 auto' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ===== MY POOLS ===== */}
      {view === 'mypools' && (
        <section className="cv-view on">
          {eventsLoading ? (
            <div className="pool-grid">{[0, 1].map((i) => <PoolCardSkeleton key={i} />)}</div>
          ) : myEvents.length === 0 && activeDeposits.length === 0 && owedAfterWithdrawal.length === 0 ? (
            /* Every affected LP has withdrawn everything, so without the third
               clause this empty state would hide the one thing they came for. */
            <div className="empty">You haven't created pools or underwritten cover yet.</div>
          ) : (
            <>
              {myEvents.length > 0 && (() => {
                const now = Date.now();
                const isLive = (e: HedgeEventData) => e.status === 'open' && e.expiryDate.getTime() > now;
                const live = myEvents.filter(isLive).sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
                const ended = myEvents.filter((e) => !isLive(e)).sort((a, b) => b.expiryDate.getTime() - a.expiryDate.getTime());
                const shown = myPoolsFilter === 'live' ? live : ended;
                return (
                  <>
                    <div className="filterbar">
                      <div className="assettog">
                        <button className={myPoolsFilter === 'live' ? 'on' : ''} onClick={() => setMyPoolsFilter('live')}>Live ({live.length})</button>
                        <button className={myPoolsFilter === 'ended' ? 'on' : ''} onClick={() => setMyPoolsFilter('ended')}>Ended ({ended.length})</button>
                      </div>
                    </div>
                    {shown.length === 0 ? (
                      <div className="empty">No {myPoolsFilter} pools.</div>
                    ) : (
                      <div className="pool-grid">
                        {shown.map((ev) => {
                          const util = Math.round(ev.utilization * 100);
                          const live2 = isLive(ev);
                          return (
                            <div className="pool-card" key={ev.id}>
                              <div className="pool-top"><MarketFlag pair={ev.underlying} /><div className="pt-nm"><div className="a">{pairLabel(ev.underlying)}</div>{poolSubtitle(ev.name, ev.underlying) && <div className="b">{poolSubtitle(ev.name, ev.underlying)}</div>}</div>
                                <div className="pool-apr"><div className="v">{fmtRate(displayRate(ev))}</div><div className="l">Premium</div></div></div>
                              <div className="pool-stats">
                                <div className="pool-stat"><div className="l">Pool size</div><div className="v tnum">{fmtK(ev.totalLiquidity)}</div></div>
                                <div className="pool-stat"><div className="l">{live2 ? 'Expires in' : 'Status'}</div><div className="v tnum">{live2 ? expiryLabel(ev.expiryDate) : (ev.status === 'open' ? 'Expired' : ev.status)}</div></div>
                                <div className="pool-stat"><div className="l">Hedgers</div><div className="v tnum">{ev.hedgerCount}</div></div>
                                <div className="pool-stat"><div className="l">Premiums earned</div><div className="v tnum">{fmtMoney(ev.totalPremiums)}</div></div>
                              </div>
                              <div className="pool-cap"><div className="row1"><span>Capacity · loyalty {fmtMoney(ev.creatorEarnings)}</span><span>{util}% used</span></div><div className="liqbar"><i style={{ width: `${util}%` }} /></div></div>
                              {live2 && (
                                <>
                                  <div className="toggle-row"><div><div className="tt">Open to hedgers</div></div><div className={`switch${ev.poolOpen ? ' on' : ''}`} onClick={() => togglePoolMutation.mutate({ eventId: ev.id, poolOpen: !ev.poolOpen })} /></div>
                                  <div className="toggle-row"><div><div className="tt">Allow external LPs</div></div><div className={`switch${ev.allowExternalLp ? ' on' : ''}`} onClick={() => togglePoolMutation.mutate({ eventId: ev.id, allowExternalLp: !ev.allowExternalLp })} /></div>
                                  <button className="btn-sm2 primary" style={{ marginTop: 12 }} onClick={() => openLp(ev)}>Underwrite</button>
                                </>
                              )}
                              {(() => {
                                const myDep = activeDeposits.find((d) => d.eventId === ev.id);
                                const settledOnChain = ev.status === 'settled' || ev.status === 'expired';
                                if (!myDep || !settledOnChain) return null;
                                return (
                                  <button className="btn-sm2 ghost" style={{ marginTop: 12 }} disabled={withdrawMutation.isPending} onClick={() => withdrawMutation.mutate(myDep.id)}>
                                    {withdrawMutation.isPending ? 'Withdrawing…' : 'Withdraw capital'}
                                  </button>
                                );
                              })()}
                              {ev.creatorEarnings >= CLAIM_DUST
                                ? <button className="btn-sm2 primary" style={{ marginTop: 8 }} disabled={withdrawEarningsMutation.isPending} onClick={() => withdrawEarningsMutation.mutate(ev.id)}>{withdrawEarningsMutation.isPending ? 'Claiming…' : `Claim earnings ${fmtUsd2(ev.creatorEarnings)}`}</button>
                                : (!live2 && <div className="hint" style={{ marginTop: 8 }}>No earnings to claim</div>)}

                              {/* A creator seeds the pool, so they are an
                                  underwriter in it and carry the same risk.
                                  Shown only when they actually hold a deposit:
                                  a creator who put in nothing has nothing at
                                  stake, and a chart of exposure they do not
                                  have would be fiction. */}
                              {(() => {
                                const myDep = activeDeposits.find((dd) => dd.eventId === ev.id);
                                if (!myDep) return null;
                                return (
                                  <UnderwriterDetail
                                    amount={myDep.amount}
                                    premiumsEarned={myDep.premiumsEarned}
                                    totalLiquidity={ev.totalLiquidity}
                                    totalMaxPayout={ev.totalMaxPayout}
                                    underlying={ev.underlying}
                                    strike={ev.strike}
                                    strikeAbove={ev.strikeAbove}
                                    initialRate={ev.initialRate}
                                    payoutCap={ev.payoutCap}
                                    currentRate={fxData?.rates[ev.underlying]?.rate || 0}
                                    settled={ev.status !== 'open'}
                                    settlementPrice={ev.settlementPrice}
                                  />
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}

              {owedAfterWithdrawal.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div className="sec-h"><h2>Premiums you have not taken</h2></div>
                  <div
                    style={{
                      borderRadius: 12, border: '1px solid var(--green)',
                      background: 'color-mix(in oklab, var(--green) 8%, var(--card))',
                      padding: '14px 16px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ fontSize: 13, color: 'var(--tx-2)' }}>
                        Earned on pools you have already withdrawn from
                      </span>
                      <span className="tnum" style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>
                        {fmtUsd2(owedTotal)}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--tx-3)', margin: '8px 0 0', lineHeight: 1.55 }}>
                      Withdrawing your capital used to end your claim on the premiums it had earned.
                      That is fixed, and this is what you were owed. Claim it whenever you like, it does
                      not expire.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                      {owedAfterWithdrawal.map((d) => {
                        const ev = events.find((e) => e.id === d.eventId);
                        return (
                          <div
                            key={d.id}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              gap: 10, padding: '9px 11px', borderRadius: 9,
                              border: '1px solid var(--border)', background: 'var(--card)',
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>
                                {ev ? pairLabel(ev.underlying) : `Pool ${d.eventId}`}
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--tx-4)' }}>
                                {fmtUsd2(d.amount)} underwritten · deposit {d.id}
                              </div>
                            </div>
                            <span className="tnum" style={{ fontSize: 14, fontWeight: 600, color: 'var(--green)' }}>
                              {fmtUsd2(d.pendingPremiums ?? 0)}
                            </span>
                            <button
                              className="btn-sm2 primary"
                              disabled={claimPremiumsMutation.isPending}
                              onClick={() => claimPremiumsMutation.mutate(d.id)}
                            >
                              {claimPremiumsMutation.isPending ? <Loader2 className="spin" /> : 'Claim'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {activeDeposits.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div className="sec-h"><h2>My underwriting</h2></div>
                  <div className="list">
                    {activeDeposits.map((d) => {
                      const ev = events.find((e) => e.id === d.eventId);
                      // Premium is claimable from the moment a hedger pays,
                      // so ask the contract what it will pay rather than
                      // subtracting two fields it only fills in at settlement.
                      // The stored difference stays as the fallback for
                      // Diamonds without the getter.
                      const claimable = d.pendingPremiums ?? (d.premiumsEarned - d.premiumsClaimed);
                      // Principal is only withdrawable once the event is SETTLED on-chain
                      // (the oracle runs settleEvent at expiry). Gating on the
                      // calendar date alone would surface a button that reverts before
                      // settlement completes, so we trust the on-chain status only.
                      const settledOnChain = ev ? (ev.status === 'settled' || ev.status === 'expired') : false;
                      const pendingSettlement = ev ? (ev.status === 'open' && ev.expiryDate.getTime() <= Date.now()) : false;
                      // How long it has actually been waiting.
                      //
                      // "settling…" was shown for the whole window between expiry and
                      // settlement, however long that ran. It describes a process that is
                      // under way, and the settler had in fact done nothing for hours —
                      // so the one word standing between an LP and their capital was
                      // reassuring them that it was in hand. Past an hour it says what is
                      // true instead, and that the money is not at risk, because the next
                      // thought after "this is stuck" is "is it gone".
                      const hoursWaiting = ev && pendingSettlement
                        ? (Date.now() - ev.expiryDate.getTime()) / 3_600_000
                        : 0;
                      const settlementOverdue = pendingSettlement && hoursWaiting >= 1;
                      return (
                        <div className="row" key={d.id}>
                          <span className="coin"><CoinSvg token="usdc" /></span>
                          <div className="r-main"><div className="r1">{pairLabel(ev?.underlying || `#${d.eventId}`)}</div><div className="r2">{fmtMoney(d.amount)} deposited{claimable >= CLAIM_DUST ? ` · ${fmtUsd2(claimable)} premium ready` : ''}{settledOnChain ? ' · ready to withdraw' : settlementOverdue ? ` · awaiting settlement (${Math.floor(hoursWaiting)}h)` : pendingSettlement ? ' · settling…' : ''}</div>
                            {settlementOverdue && (
                              <div className="r2" style={{ color: 'var(--amber)' }}>
                                Expired, but not settled on-chain yet — your {fmtMoney(d.amount)} is safe and
                                becomes withdrawable the moment it settles. We've been alerted.
                              </div>
                            )}
                            {/* The same chart and cards a hedger gets, read from
                                this side: the band that pays them is the band
                                that draws on this deposit, so it is red here
                                and the figures are scaled to this LP's share
                                of the pool rather than the pool's own totals. */}
                            {ev && (
                              <UnderwriterDetail
                                amount={d.amount}
                                premiumsEarned={d.premiumsEarned}
                                totalLiquidity={ev.totalLiquidity}
                                totalMaxPayout={ev.totalMaxPayout}
                                underlying={ev.underlying}
                                strike={ev.strike}
                                strikeAbove={ev.strikeAbove}
                                initialRate={ev.initialRate}
                                payoutCap={ev.payoutCap}
                                currentRate={fxData?.rates[ev.underlying]?.rate || 0}
                                settled={ev.status !== 'open'}
                                settlementPrice={ev.settlementPrice}
                              />
                            )}
                          </div>
                          <div className="r-side" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            {claimable >= CLAIM_DUST && <button className="btn-sm2 primary" disabled={claimPremiumsMutation.isPending} onClick={() => claimPremiumsMutation.mutate(d.id)}>Claim {fmtUsd2(claimable)}</button>}
                            {settledOnChain && <button className="btn-sm2 ghost" disabled={withdrawMutation.isPending} onClick={() => withdrawMutation.mutate(d.id)}>Withdraw</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ===== DETAILS SHEET ===== */}
      {/* ===== SETTLED COVER DETAIL ===== */}
      <div className={`sheet-scrim${posDetail ? ' on' : ''}`} onClick={() => setPosDetail(null)} />
      <div className={`sheet${posDetail ? ' on' : ''}`}>
        <div className="grab" />
        <div className="sheet-h"><h3>Cover details</h3><button className="sheet-x" onClick={() => setPosDetail(null)}><X /></button></div>
        {posDetail ? (() => {
          const p = posDetail;
          const ev = events.find((e) => e.id === p.eventId);
          const totalCost = p.premiumPaid + p.platformFeePaid;
          // The contract's own reserved figure, not a re-derivation.
          //
          // This was notional × payoutPercent, and payoutPercent is
          // (strike − initialRate) / initialRate — the distance from spot to
          // strike, which is not a payout rate and does not involve the cap.
          // On position #7 it showed $129 against the $306.86 the contract
          // actually reserved and would pay: the hedger was told they held
          // 58% less protection than they had bought. payoutAmount is read
          // from the chain into every position already and is authoritative;
          // nothing needed computing.
          const maxPayout = p.payoutAmount;
          const won = p.status === 'claimed' || p.status === 'settled_win';
          const net = won ? p.payoutAmount - totalCost : -totalCost;
          const label = p.status === 'claimed' ? 'Claimed' : p.status === 'settled_win' ? 'Won — unclaimed' : 'Expired';

          // Plain-English outcome. An expired position paying nothing is the
          // normal, correct result of a hedge that was not needed — say so
          // rather than leaving a bare "Expired" badge to look like a failure.
          const outcome = won
            ? `${ev ? `${ev.underlying} settled ${ev.strikeAbove ? 'above' : 'below'} ${ev.strike.toLocaleString()}` : 'The rate settled past the strike'}, so this cover paid out ${fmtUsd2(p.payoutAmount)}.`
            : ev
              ? `The rate never ${ev.strikeAbove ? 'rose past' : 'fell below'} ${ev.strike.toLocaleString()} ${unitOf(ev.underlying)} before expiry, so no payout was due. The ${fmtUsd2(totalCost)} you paid was the cost of being protected.`
              : `This cover expired without a payout. The ${fmtUsd2(totalCost)} you paid was the cost of being protected.`;

          return (
            <>
              <div className="det-head">
                <MarketFlag pair={ev?.underlying || ''} />
                <div className="det-hn">
                  <div className="a">{pairLabel(ev?.underlying || `#${p.eventId}`)}</div>
                  <div className="b">{ev?.name || `Event #${p.eventId}`} · Position #{p.id}</div>
                </div>
                <div className="det-apr">
                  <div className="v" style={{ color: won ? 'var(--green)' : 'var(--tx-3)' }}>{won ? fmtUsd2(p.payoutAmount) : '—'}</div>
                  <div className="l">{won ? 'Paid out' : 'No payout'}</div>
                </div>
              </div>

              <p className="det-cond">{outcome}</p>

              {/* The same chart and cards the live positions get, with the
                  settled rate marked, so an ended position demonstrates its
                  outcome rather than only describing it. */}
              {ev && (
                <CoverDetail
                  notional={p.notional}
                  totalCost={totalCost}
                  maxPayout={maxPayout}
                  strike={ev.strike}
                  initialRate={ev.initialRate}
                  strikeAbove={ev.strikeAbove}
                  underlying={ev.underlying}
                  currentRate={fxData?.rates[ev.underlying]?.rate || 0}
                  settled
                  settlementPrice={ev.settlementPrice}
                  actualPayout={won ? p.payoutAmount : 0}
                  boughtOn={p.createdAt ? p.createdAt.toISOString().slice(0, 10) : undefined}
                  cap={payoutModelFor(p, ev).cap}
                  maxPayoutLabel={fmtMoney(maxPayoutFor(p, ev))}
                />
              )}

              <div className="det-grid">
                <div className="det-stat"><div className="l">Status</div><div className="v">{label}</div></div>
                <div className="det-stat"><div className="l">Notional covered</div><div className="v">{fmtUsd2(p.notional)}</div></div>
                <div className="det-stat"><div className="l">Premium paid</div><div className="v">{fmtUsd2(p.premiumPaid)}</div></div>
                {/* The rate this position was actually bought at. On a
                    dynamically priced pool it is not the pool's stored rate,
                    and until now nothing on screen showed the difference. */}
                {p.notional > 0 && (
                  <div className="det-stat">
                    <div className="l">
                      Rate you paid
                      <button
                        type="button"
                        aria-label="How this premium was set"
                        onClick={() => setPremiumInfoFor(p.eventId)}
                        style={{ border: 'none', background: 'transparent', color: 'var(--tx-4)', cursor: 'pointer', padding: '0 0 0 4px', verticalAlign: 'middle', display: 'inline-flex' }}
                      >
                        <Info style={{ width: 12, height: 12 }} />
                      </button>
                    </div>
                    <div className="v">
                      {fmtRate(p.premiumPaid / p.notional)}
                      {ev && Math.abs(p.premiumPaid / p.notional - ev.premiumRate) > 1e-7 && (
                        <span style={{ color: 'var(--tx-4)', fontWeight: 400 }}> vs {fmtRate(ev.premiumRate)} listed</span>
                      )}
                    </div>
                  </div>
                )}
                <div className="det-stat"><div className="l">Platform fee</div><div className="v">{fmtUsd2(p.platformFeePaid)}</div></div>
                <div className="det-stat"><div className="l">Total cost</div><div className="v">{fmtUsd2(totalCost)}</div></div>
                <div className="det-stat"><div className="l">Payout received</div><div className="v">{fmtUsd2(p.payoutAmount)}</div></div>
                <div className="det-stat"><div className="l">Net result</div><div className="v" style={{ color: net >= 0 ? 'var(--green)' : 'var(--tx)' }}>{net >= 0 ? '+' : '−'}{fmtUsd2(Math.abs(net))}</div></div>
                <div className="det-stat"><div className="l">Bought</div><div className="v">{p.createdAt ? p.createdAt.toLocaleDateString() : '—'}</div></div>
                {ev && <>
                  <div className="det-stat"><div className="l">Direction</div><div className="v">{ev.strikeAbove ? 'Rate rises' : 'Rate falls'}</div></div>
                  <div className="det-stat"><div className="l">Strike</div><div className="v">{ev.strike.toLocaleString()} {unitOf(ev.underlying)}</div></div>
                  <div className="det-stat"><div className="l">Expired</div><div className="v">{expiryLabel(ev.expiryDate)}</div></div>
                  <div className="det-stat"><div className="l">Max payout</div><div className="v">{fmtUsd2(maxPayout)}</div></div>
                  {ev.settlementPrice > 0 && (
                    <div className="det-stat"><div className="l">Settlement rate</div><div className="v">{ev.settlementPrice.toLocaleString()} {unitOf(ev.underlying)}</div></div>
                  )}
                  <div className="det-stat"><div className="l">Triggered</div><div className="v">{ev.triggered ? 'Yes' : 'No'}</div></div>
                </>}
              </div>

              {!ev && (
                <p style={{ fontSize: 12, color: 'var(--tx-3)', marginTop: 12 }}>
                  Pool #{p.eventId} could not be loaded, so strike and settlement details are unavailable for this position.
                </p>
              )}
            </>
          );
        })() : null}
      </div>

      <div className={`sheet-scrim${detailOpen ? ' on' : ''}`} onClick={() => setDetailOpen(false)} />
      <div className={`sheet${detailOpen ? ' on' : ''}`}>
        <div className="grab" />
        <div className="sheet-h"><h3>Market details</h3><button className="sheet-x" onClick={() => setDetailOpen(false)}><X /></button></div>
        {selectedEvent ? (() => {
          const ev = selectedEvent; const util = Math.round(ev.utilization * 100);
          return (
            <>
              <div className="det-head">
                <MarketFlag pair={ev.underlying} />
                <div className="det-hn"><div className="a">{pairLabel(ev.underlying)}</div><div className="b">{ev.name}</div></div>
                <div className="det-apr"><div className="v">{fmtRate(displayRate(ev))}</div><div className="l">Premium</div></div>
              </div>
              <p className="det-cond">{ev.strikeAbove ? 'Pays out if the rate settles above ' : 'Pays out if the rate settles below '}{ev.strike.toLocaleString()} {unitOf(ev.underlying)} at expiry. What matters is where the rate finishes, not whether it touched the strike along the way.</p>
              {/*
                The market's own history, with this pool's terms on it.

                A grid of six numbers tells you the terms and nothing about
                whether they are likely, which is the question someone opens a
                market to answer.

                Read from whichever side this person is already on. Holding a
                deposit here makes the band their exposure and it is drawn red;
                holding cover, or holding nothing and browsing to buy, makes it
                the zone that pays and it is drawn green. The same picture
                cannot mean the same thing to both.
              */}
              {(() => {
                const myDep = myDeposits.find((d) => d.eventId === ev.id && !d.withdrawn);
                const myPos = myPositions.find((pp) => pp.eventId === ev.id && pp.status === 'active');
                const asLp = !!myDep && !myPos;
                const live = fxData?.rates[ev.underlying]?.rate || 0;
                const capRate = ev.payoutCap && ev.payoutCap > 0 ? ev.payoutCap : undefined;
                return (
                  <RateHistory
                    pair={ev.underlying}
                    strike={ev.strike}
                    strikeAbove={ev.strikeAbove}
                    cap={capRate}
                    maxPayoutLabel={capRate ? fmtK(ev.totalMaxPayout) : undefined}
                    markRate={live}
                    markLabel="now"
                    perspective={asLp ? 'underwriter' : 'hedger'}
                    initialRange="6m"
                  />
                );
              })()}

              <div className="det-grid">
                <div className="det-stat"><div className="l">Direction</div><div className="v">{ev.strikeAbove ? 'Rate rises' : 'Rate falls'}</div></div>
                <div className="det-stat"><div className="l">Strike</div><div className="v">{ev.strike.toLocaleString()} {unitOf(ev.underlying)}</div></div>
                <div className="det-stat">
                  <div className="l">
                    Premium
                    <button
                      type="button"
                      aria-label="How this premium is set"
                      onClick={() => setPremiumInfoFor(ev.id)}
                      style={{ border: 'none', background: 'transparent', color: 'var(--tx-4)', cursor: 'pointer', padding: '0 0 0 4px', verticalAlign: 'middle', display: 'inline-flex' }}
                    >
                      <Info style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                  <div className="v">{fmtRate(displayRate(ev))}</div>
                </div>
                <div className="det-stat"><div className="l">Expiry</div><div className="v">{expiryLabel(ev.expiryDate)}</div></div>
                <div className="det-stat"><div className="l">Available liquidity</div><div className="v">{fmtMoney(ev.availableCapacity)}</div></div>
                <div className="det-stat"><div className="l">Pool size</div><div className="v">{fmtMoney(ev.totalLiquidity)}</div></div>
              </div>
              <div className="det-cap-bar"><div className="row1"><span>Capacity</span><span>{util}% used</span></div><div className="liqbar"><i style={{ width: `${util}%` }} /></div></div>

              <div className="det-actions">
                <button className="btn btn-ghost" onClick={() => openLp(ev)}><Layers /> Underwrite</button>
                <button className="btn btn-primary" onClick={() => openBuy(ev)}><ShieldCheck /> Buy cover</button>
              </div>
            </>
          );
        })() : <SheetLoading />}
      </div>

      {/* ===== BUY SHEET ===== */}
      <div className={`sheet-scrim${buyOpen ? ' on' : ''}`} onClick={() => setBuyOpen(false)} />
      <div className={`sheet${buyOpen ? ' on' : ''}`}>
        <div className="grab" />
        <div className="sheet-h"><h3>Buy cover</h3><button className="sheet-x" onClick={() => setBuyOpen(false)}><X /></button></div>
        {selectedEvent ? (
          <>
            <div className="sum-pre" style={{ marginBottom: 16 }}>
              <div className="pair-line"><MarketFlag pair={selectedEvent.underlying} /><div><div className="pl-nm">{pairLabel(selectedEvent.underlying)}</div><div className="pl-sub">{selectedEvent.strikeAbove ? 'Rate rises past ' : 'Rate falls below '}{selectedEvent.strike.toLocaleString()} · {expiryLabel(selectedEvent.expiryDate)}</div></div></div>
              <RateHistory
                pair={selectedEvent.underlying}
                strike={selectedEvent.strike}
                strikeAbove={selectedEvent.strikeAbove}
              />
            </div>
            {/* Said once, where the money actually moves. Buying cover in
                your own pool is permitted and can be the right call, but the
                premium largely returns to you as the underwriter, so the net
                effect is the platform fee plus a genuine transfer of risk to
                whichever other LPs are in the pool. Worth knowing before you
                sign rather than after. */}
            {selectedEvent.creator.toLowerCase() === myAddr && (
              <p className="hint" style={{ marginBottom: 12, color: 'var(--tx-3)' }}>
                You created this pool. The premium goes into it, so most of it comes back to you
                as an underwriter and the cover is only as useful as the share of the pool other
                LPs are funding.
              </p>
            )}
            <div className="field">
              <label>Notional to cover</label>
              <div className="amount">
                <div className="arow"><input inputMode="decimal" placeholder="0" value={notional} onChange={(e) => setNotional(e.target.value)} /><span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--tx-3)' }}>USD</span></div>
                <div className="abot"><span className="usd">Premium {fmtRate(chargedRate)}</span><span className="bal">Available {fmtMoney(selectedEvent.availableCapacity)}</span></div>
              </div>
              <div className="notrow">{[10000, 50000, 100000].map((n) => <button key={n} onClick={() => setNotional(String(n))}>${n / 1000}k</button>)}</div>
            </div>
            <div className="payout-card">
              <div className="pc-l">Max payout if triggered</div>
              <div className="pc-v">{fmtMoney(netPredeterminedPayout)}</div>
              <div className="pc-s">{notional
                ? payoutFeeRate !== null
                  ? `Net of the ${(payoutFeeRate * 100).toFixed(1)}% claim fee. Scales linearly from the strike toward the cap.`
                  : 'Scales linearly from the strike toward the cap.'
                : 'Pays out when the rate moves from strike toward the cap.'}</div>
            </div>
            <div className="brk">
              {/* Cents, not whole dollars. fmtMoney rounds, so a premium of
                  $14.99 and one of $15.03 both rendered "$15" and a
                  dynamically priced pool looked identical to a fixed one. */}
              <div className="brk-line">
                <span className="l">
                  Premium ({fmtRate(chargedRate)} of notional)
                  <button
                    type="button"
                    aria-label="How this premium is set"
                    onClick={() => setPremiumInfoFor(selectedEvent.id)}
                    style={{ border: 'none', background: 'transparent', color: 'var(--tx-4)', cursor: 'pointer', padding: '0 0 0 5px', verticalAlign: 'middle', display: 'inline-flex' }}
                  >
                    <Info style={{ width: 13, height: 13 }} />
                  </button>
                </span>
                <span className="v">{fmtUsd2(premiumCalc)}</span>
              </div>
              {/* The second figure used to restate the fee as a share of the
                  premium, because the fee was being quoted on notional and at a
                  1% premium that made it 500% of what it was a fee on. Now that
                  the basis is the premium, the label says so and the restatement
                  has nothing left to reveal. */}
              <div className="brk-line">
                <span className="l">
                  {hedgerFeeRate !== null ? `Platform fee (${(hedgerFeeRate * 100).toFixed(2)}% of premium)` : 'Platform fee'}
                </span>
                <span className="v">{feeKnown ? fmtUsd2(hedgerFeeCalc) : 'unavailable'}</span>
              </div>
              <div className="brk-line total"><span className="l">You pay</span><span className="v">{fmtUsd2(totalCostCalc)}</span></div>
            </div>

            {/*
                On a fixed pool this is advisory: what the cover is worth today
                beside what the pool asks, never in place of the charged figure.

                On a dynamic pool the live rate IS the charged figure, so the
                comparison flips. The interesting number becomes the opening
                rate the underwriter set, and the panel's old copy ("you are
                charged the pool rate above") was simply false there.
            */}
            {livePrice && selectedIsDynamic && Math.abs(livePrice.premiumRate - selectedEvent.premiumRate) > 1e-7 && (
              <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--card)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>Pool opened at</span>
                  <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--tx-2)' }}>
                    {fmtRate(selectedEvent.premiumRate)}
                  </span>
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--tx-4)', margin: '6px 0 0', lineHeight: 1.5 }}>
                  {(() => {
                    const days = livePrice.breakdown.daysRemaining;
                    const left = days >= 1.5 ? `${Math.round(days)} days` : days >= 1 ? 'a day' : 'hours';
                    return livePrice.premiumRate < selectedEvent.premiumRate
                      ? `This pool prices at the moment you buy. With ${left} left you are charged ${fmtRate(livePrice.premiumRate)}, below the rate it opened at.`
                      : `This pool prices at the moment you buy. With ${left} left and the rate nearer the strike you are charged ${fmtRate(livePrice.premiumRate)}, above the rate it opened at.`;
                  })()}
                  {' '}
                  <button
                    type="button"
                    onClick={() => setPremiumInfoFor(selectedEvent.id)}
                    style={{ border: 'none', background: 'transparent', color: 'var(--tx-2)', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}
                  >
                    What moves it
                  </button>
                </p>
              </div>
            )}
            {livePrice && !selectedIsDynamic && Math.abs(livePrice.premiumRate - selectedEvent.premiumRate) / selectedEvent.premiumRate >= 0.1 && (
              <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--card)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>Worth today</span>
                  <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--tx-2)' }}>
                    {fmtRate(livePrice.premiumRate)} · {fmtUsd2(livePrice.premiumUsd)}
                  </span>
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--tx-4)', margin: '6px 0 0', lineHeight: 1.5 }}>
                  {(() => {
                    const days = livePrice.breakdown.daysRemaining;
                    const left = days >= 1.5 ? `${Math.round(days)} days` : days >= 1 ? 'a day' : 'hours';
                    return livePrice.premiumRate < selectedEvent.premiumRate
                      ? `With ${left} left this cover is worth less than the pool's rate. This pool charges one rate for its whole life, so you pay the rate above.`
                      : `With ${left} left and the rate nearer the strike this cover is worth more than the pool's rate. This pool charges one rate for its whole life, so you pay the rate above.`;
                  })()}
                  {' '}
                  <button
                    type="button"
                    onClick={() => setPremiumInfoFor(selectedEvent.id)}
                    style={{ border: 'none', background: 'transparent', color: 'var(--tx-2)', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}
                  >
                    Why
                  </button>
                </p>
              </div>
            )}
            {tokenBalanceNum > 0 && <p className="hint" style={{ marginBottom: 12 }}>Balance {fmtMoney(tokenBalanceNum)} {eventTokenSymbol}</p>}
            {exceedsCapacity && notional && (
              <p className="hint" style={{ marginBottom: 12, color: 'var(--red)' }}>
                This pool can only cover {fmtMoney(availableCapacity)} of payout right now, and this
                position would need {fmtMoney(predeterminedPayout)}. The most you can cover here is{' '}
                {fmtMoney(Math.floor(maxNotionalForPool))}.
              </p>
            )}
            <button className="btn btn-primary" disabled={buyProtectionMutation.isPending || !notional || parseFloat(notional) < 10 || totalCostCalc > tokenBalanceNum || !feeKnown || exceedsCapacity} onClick={guardedBuyProtection}>
              {buyProtectionMutation.isPending ? <><Loader2 className="spin" /> {txStep || 'Buying…'}</> : <><ShieldCheck /> Buy protection</>}
            </button>
          </>
        ) : <SheetLoading />}
      </div>

      {/* ===== LP SHEET ===== */}
      <div className={`sheet-scrim${lpOpen ? ' on' : ''}`} onClick={() => setLpOpen(false)} />
      <div className={`sheet${lpOpen ? ' on' : ''}`}>
        <div className="grab" />
        <div className="sheet-h"><h3>Underwrite cover</h3><button className="sheet-x" onClick={() => setLpOpen(false)}><X /></button></div>
        {selectedEvent ? (() => {
          const amt = parseFloat(depositAmount) || 0;
          const share = amt > 0 ? (amt / (selectedEvent.totalLiquidity + amt)) * 100 : 0;
          return (
            <>
              <div className="sum-pre" style={{ marginBottom: 16 }}>
                <div className="pair-line"><MarketFlag pair={selectedEvent.underlying} /><div><div className="pl-nm">{pairLabel(selectedEvent.underlying)}</div><div className="pl-sub">Cover pool · {expiryLabel(selectedEvent.expiryDate)}</div></div></div>
              </div>
              <div className="field">
                <label>Deposit amount</label>
                <div className="amount">
                  <div className="arow"><input inputMode="decimal" placeholder="0.00" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} /><button className="max" onClick={() => setDepositAmount(String(tokenBalanceNum))}>MAX</button></div>
                  <div className="abot"><span className="usd">≈ ${amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span className="bal">Balance {fmtMoney(tokenBalanceNum)} {eventTokenSymbol}</span></div>
                </div>
              </div>
              <div className="brk">
                <div className="brk-line"><span className="l">Premium rate</span><span className="v">{fmtRate(displayRate(selectedEvent))}</span></div>
                <div className="brk-line"><span className="l">Your pool share</span><span className="v">{share.toFixed(2)}%</span></div>
                <div className="brk-line total"><span className="l">Pool size after deposit</span><span className="v">{fmtMoney(selectedEvent.totalLiquidity + amt)}</span></div>
              </div>
              <p className="hint" style={{ marginBottom: 14 }}>You earn a pro-rata share of every premium paid into this pool. Principal and premiums are withdrawable after settlement.</p>
              <button className="btn btn-primary" disabled={depositMutation.isPending || amt <= 0 || amt > tokenBalanceNum} onClick={guardedDeposit}>
                {depositMutation.isPending ? <><Loader2 className="spin" /> {txStep || 'Depositing…'}</> : <><Layers /> Underwrite</>}
              </button>
            </>
          );
        })() : <SheetLoading />}
      </div>

      {/* ===== PAIR PICKER ===== */}
      <div className={`picker${pairPickerOpen ? ' on' : ''}`}>
        <div className="grab" />
        <div className="sheet-h"><h3>{newEvent.assetClass === 'fx' ? 'Select pair' : 'Select market'}</h3><button className="sheet-x" onClick={() => setPairPickerOpen(false)}><X /></button></div>
        <div>
          {createPairs.length === 0 ? (
            <div className="empty">No {newEvent.assetClass} markets available.</div>
          ) : createPairs.map((p) => (
            <button key={p.pair} className="pick-row" onClick={() => { setNewEvent((s) => ({ ...s, underlying: p.pair })); setPairPickerOpen(false); }}>
              <MarketFlag pair={p.pair} /><div className="pm"><div className="a">{pairLabel(p.pair)}</div><div className="b">{unitOf(p.pair)}{fxData?.rates[p.pair] ? ` · ${fxData.rates[p.pair].rate.toLocaleString()}` : ''}</div></div>
            </button>
          ))}
        </div>
      </div>

      {/* ===== DURATION PICKER ===== */}
      <div className={`picker${durationOpen ? ' on' : ''}`}>
        <div className="grab" />
        <div className="sheet-h"><h3>Select duration</h3><button className="sheet-x" onClick={() => setDurationOpen(false)}><X /></button></div>
        <div>
          {DURATIONS.map((d) => (
            <button key={d.hours} className="pick-row" onClick={() => { setNewEvent((s) => ({ ...s, expiryHours: String(d.hours) })); setDurationOpen(false); }}>
              <div className="pm"><div className="a">{d.label}</div></div>
            </button>
          ))}
          <div className="frow" style={{ padding: '10px 8px' }}>
            <div className="field"><label>Custom</label><div className="inwrap"><input className="input" inputMode="numeric" placeholder="e.g. 5" value={customValue} onChange={(e) => setCustomValue(e.target.value)} /><span className="suffix">{customUnit}</span></div></div>
            <div className="field"><label>Unit</label><div className="seg2"><button className={customUnit === 'hours' ? 'on' : ''} onClick={() => setCustomUnit('hours')}>Hours</button><button className={customUnit === 'days' ? 'on' : ''} onClick={() => setCustomUnit('days')}>Days</button></div></div>
          </div>
          <button className="btn btn-primary" disabled={!customValue} onClick={() => {
            const v = parseInt(customValue, 10);
            if (Number.isFinite(v) && v > 0) { setNewEvent((s) => ({ ...s, expiryHours: String(customUnit === 'days' ? v * 24 : v) })); setDurationOpen(false); setCustomValue(''); }
          }}>Set duration</button>
        </div>
      </div>

      {/* ===== HOW THIS PREMIUM IS SET ===== */}
      {(() => {
        if (premiumInfoFor == null) return null;
        // Whichever copy of the event is to hand. The buy and detail sheets
        // hold a fresher one than the list, so prefer it.
        const ev =
          (selectedEvent && selectedEvent.id === premiumInfoFor ? selectedEvent : null) ||
          events.find((e) => e.id === premiumInfoFor) ||
          null;
        if (!ev) return null;
        const pos = posDetail && posDetail.eventId === premiumInfoFor ? posDetail : null;
        return (
          <PremiumExplainer
            open
            onClose={() => setPremiumInfoFor(null)}
            storedRate={ev.premiumRate}
            dynamic={dynamicById[premiumInfoFor] === true}
            // Only meaningful for the pool actually being quoted. Where there is
            // none, the panel fetches its own at a nominal size, since the rate
            // does not depend on how much is being bought.
            quote={selectedEvent && selectedEvent.id === premiumInfoFor ? livePrice : null}
            chainId={activeChainId}
            eventId={premiumInfoFor}
            paidRate={pos && pos.notional > 0 ? pos.premiumPaid / pos.notional : null}
            underlying={ev.underlying}
            strike={ev.strike}
            strikeAbove={ev.strikeAbove}
            createdAt={ev.createdAt}
            expiryDate={ev.expiryDate}
            hedgerFeeRate={hedgerFeeRate}
          />
        );
      })()}

      {/* ===== MAINNET CONFIRM ===== */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Transaction</AlertDialogTitle>
            <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPendingAction(null); setConfirmDialogOpen(false); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { pendingAction?.(); setPendingAction(null); setConfirmDialogOpen(false); }}>Confirm &amp; Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
