/**
 * Cover — rebuilt to the new design (app/Cover.html).
 *
 * Five tabs: Buy cover / Provide liquidity / Create pool / My positions / My
 * pools. The first three mirror the design; the last two preserve the existing
 * claim / withdraw / settings functionality in the same visual language.
 *
 * Every data path and mutation is unchanged from the previous implementation:
 * hedgeContract reads, buyProtection / deposit / createEvent / setPoolSettings /
 * claimPayout / claimPremiums / withdrawCapital / recoverExpiredPayouts, the
 * pricing-engine quote, activity logging, mainnet guard, and ?event=&action=
 * deep-linking + share links.
 */
import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
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
import { walletManager } from '@/lib/wallet';
import { ethers } from 'ethers';
import { mainnetGuard } from '@/lib/mainnet-guard';
import { getNetworkById, DEFAULT_NETWORK, NETWORKS } from '@/lib/networks';
import { PayoutScenarios } from '@/components/hedge/payout-scenarios';
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
function expiryLabel(d: Date): string {
  const days = daysToExpiry(d);
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}H`;
  return `${Math.round(days)}D`;
}
// Comprehensive pool card for the Provide-liquidity grid (no APR — premium rate
// is the honest, directly-comparable number; APR annualised from a sub-day pool
// is meaningless).
function PoolCard({ ev, onAdd, onOpen }: { ev: HedgeEventData; onAdd: () => void; onOpen: () => void }) {
  const util = Math.round(ev.utilization * 100);
  return (
    <div className="pool-card">
      <div className="pool-top" style={{ cursor: 'pointer' }} onClick={onOpen}>
        <MarketFlag pair={ev.underlying} />
        <div className="pt-nm">
          <div className="a">{pairLabel(ev.underlying)}</div>
          <div className="b">{ev.strikeAbove ? 'Rate rises past' : 'Rate falls below'} {ev.strike.toLocaleString()}</div>
        </div>
        <div className="pool-apr"><div className="v">{(ev.premiumRate * 100).toFixed(1)}%</div><div className="l">Premium</div></div>
      </div>
      <div className="pool-stats">
        <div className="pool-stat"><div className="l">Pool size</div><div className="v tnum">{fmtK(ev.totalLiquidity)}</div></div>
        <div className="pool-stat"><div className="l">Available</div><div className="v tnum">{fmtK(ev.availableCapacity)}</div></div>
        <div className="pool-stat"><div className="l">Strike</div><div className="v tnum">{ev.strike.toLocaleString()}</div></div>
        <div className="pool-stat"><div className="l">Expires in</div><div className="v tnum">{expiryLabel(ev.expiryDate)}</div></div>
      </div>
      <div className="pool-cap"><div className="row1"><span>Capacity · {ev.lpCount} LP · {ev.hedgerCount} hedger{ev.hedgerCount === 1 ? '' : 's'}</span><span>{util}% used</span></div><div className="liqbar"><i style={{ width: `${util}%` }} /></div></div>
      <button className="btn-sm2 primary" onClick={onAdd}>Add liquidity</button>
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

export default function Hedge() {
  const { wallet, settings, updateSettings } = useWallet();
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
  const [txStep, setTxStep] = useState('');

  const friendlyError = (error: any): string => {
    const raw: string = error?.reason || error?.data?.message || error?.message || 'Transaction failed';
    if (raw.includes('replacement fee too low')) return 'A previous transaction is still pending. Retrying automatically...';
    if (raw.includes('insufficient funds')) return 'Not enough ETH (gas) in your wallet to pay network fees.';
    if (raw.includes('user rejected') || raw.includes('User denied')) return 'Transaction was cancelled.';
    if (raw.includes('nonce too low') || raw.includes('nonce has already been used')) return 'Nonce conflict — please wait a moment and try again.';
    if (raw.toLowerCase().includes('allowance') || raw.toLowerCase().includes('exceeds allowance') || raw.toLowerCase().includes('transfer amount exceeds')) return 'Token approval not yet confirmed on-chain. Please wait a moment and try again.';
    const isRevert = raw.includes('execution reverted') || raw.includes('transaction would revert') || raw.includes('Contract simulation failed');
    if (raw.includes('Pool closed')) return 'This event pool is currently closed to new hedgers.';
    if (raw.includes('Insufficient liquidity')) return 'Not enough liquidity in this pool for that notional amount.';
    if (raw.includes('Event expired')) return 'This event has already expired.';
    if (raw.includes('Event not found')) return 'Event not found on-chain. It may have been created on a different network.';
    if (raw.includes('Fees not initialized')) return 'Contract fees not yet configured. Please try again shortly.';
    if (raw.includes('Payment token not whitelisted')) return 'This chain only accepts USDT as payment. Please select USDT and try again.';
    if (isRevert) return 'The contract rejected the transaction. Check your inputs and try again.';
    return raw;
  };

  const [feeConfig, setFeeConfig] = useState<HedgeFeeConfig | null>(null);
  const [myPositions, setMyPositions] = useState<HedgePositionData[]>([]);
  const [myDeposits, setMyDeposits] = useState<HedgeLpDepositData[]>([]);

  const loadEvents = async () => {
    try {
      setEventsLoading(true);
      const data = await hedgeContract.getAllEvents();
      try {
        const dbRes = await fetch('/api/hedge/events/open');
        if (dbRes.ok) {
          const dbEvents: Array<{ onChainEventId: number; chainId: number; description?: string }> = await dbRes.json();
          const descMap = new Map(dbEvents.filter((e) => e.chainId === activeChainId && e.description).map((e) => [e.onChainEventId, e.description]));
          data.forEach((e) => { if (descMap.has(e.id)) e.description = descMap.get(e.id); });
        }
      } catch { /* description optional */ }
      setEvents(data);
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setEventsLoading(false);
    }
  };

  const DEFAULT_FEE_CONFIG = { creationFee: 2, hedgerFeeRate: 0.005, hedgerPayoutFeeRate: 0.01, lpProfitFeeRate: 0.01, creatorLoyaltyRate: 0.005 };
  const loadFeeConfig = async () => {
    setFeeConfig(DEFAULT_FEE_CONFIG);
    try {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Fee config timeout')), 8000));
      const config = await Promise.race([hedgeContract.getFeeConfig(), timeout]);
      setFeeConfig(config);
    } catch (error) {
      console.warn('Fee config RPC call timed out; using defaults:', error);
    }
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
      await fetch('/api/hedge/activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: wallet.address, chainId: activeChainId, ...payload }),
      });
    } catch (e) { console.warn('[activity] record failed (non-blocking):', e); }
  };

  // ── Mutations (unchanged) ───────────────────────────────────────────────
  const buyProtectionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEvent) throw new Error('No event selected');
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error('Wallet signer not available. Please unlock your wallet.');
      const txHash = await hedgeContract.buyProtection(signer, selectedEvent.id, notional, setTxStep);
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
    onError: (error: any) => { setTxStep(''); toast({ title: 'Transaction Failed', description: friendlyError(error), variant: 'destructive' }); },
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
    onError: (error: any) => { setTxStep(''); toast({ title: 'Transaction Failed', description: friendlyError(error), variant: 'destructive' }); },
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
        paymentToken: paymentTokenAddr, signature, quoteTimestamp, quoteNonce,
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
      setNewEvent({ name: '', description: '', assetClass: 'fx', underlying: 'USD/GHS', strike: '', payoutCap: '', premiumRate: '', expiryHours: '720', initialLiquidity: '', poolOpen: true, allowExternalLp: true, direction: 'up', paymentCurrency: 'USDC', overrideAcknowledged: false, selfPriced: false });
    },
    onError: (error: any) => { setTxStep(''); console.error('[createEvent] Failed:', error); toast({ title: 'Transaction Failed', description: friendlyError(error), variant: 'destructive' }); },
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
    onError: (error: any) => { setTxStep(''); toast({ title: 'Transaction Failed', description: friendlyError(error), variant: 'destructive' }); },
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
    onError: (error: any) => { setTxStep(''); toast({ title: 'Transaction Failed', description: friendlyError(error), variant: 'destructive' }); },
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
    onError: (error: any) => { setTxStep(''); toast({ title: 'Transaction Failed', description: friendlyError(error), variant: 'destructive' }); },
  });

  const recoverExpiredMutation = useMutation({
    mutationFn: async (eventId: number) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error('Wallet signer not available.');
      const event = events.find((e) => e.id === eventId);
      const txHash = await hedgeContract.recoverExpiredPayouts(signer, eventId, setTxStep);
      await recordActivity({ actionType: 'recover_expired', txHash, onChainEventId: eventId, metadata: { eventName: event?.name, underlying: event?.underlying } });
    },
    onSuccess: async () => { setTxStep(''); await loadEvents(); await loadDeposits(); toast({ title: 'Event Recovered', description: 'Event marked expired on-chain. You can now withdraw your liquidity.' }); },
    onError: (error: any) => { setTxStep(''); toast({ title: 'Recovery Failed', description: friendlyError(error), variant: 'destructive' }); },
  });

  const claimPremiumsMutation = useMutation({
    mutationFn: async (depositId: number) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error('Wallet signer not available.');
      const dep = myDeposits.find((d) => d.id === depositId);
      const event = dep ? events.find((e) => e.id === dep.eventId) : null;
      const claimable = dep ? dep.premiumsEarned - dep.premiumsClaimed : null;
      const txHash = await hedgeContract.claimPremiums(signer, depositId, setTxStep);
      await recordActivity({ actionType: 'claim_premiums', txHash, onChainEventId: dep?.eventId ?? null, amount: claimable, token: event?.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT', metadata: { depositId, eventName: event?.name, underlying: event?.underlying } });
    },
    onSuccess: async () => { setTxStep(''); await loadDeposits(); toast({ title: 'Premiums Claimed', description: 'Premiums sent to your wallet' }); },
    onError: (error: any) => { setTxStep(''); toast({ title: 'Transaction Failed', description: friendlyError(error), variant: 'destructive' }); },
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
    onError: (error: any) => { setTxStep(''); toast({ title: 'Transaction Failed', description: friendlyError(error), variant: 'destructive' }); },
  });

  // ── Derived for the buy/LP sheets ───────────────────────────────────────
  const premiumCalc = selectedEvent && notional ? parseFloat(notional) * selectedEvent.premiumRate : 0;
  const hedgerFeeRate = feeConfig?.hedgerFeeRate || 0.005;
  const hedgerFeeCalc = notional ? parseFloat(notional) * hedgerFeeRate : 0;
  const totalCostCalc = premiumCalc + hedgerFeeCalc;
  const currentRate = selectedEvent ? fxData?.rates[selectedEvent.underlying]?.rate || 0 : 0;
  const payoutPercent = selectedEvent ? selectedEvent.payoutPercent : 0;
  const predeterminedPayout = selectedEvent && notional ? parseFloat(notional) * payoutPercent : 0;
  const netPredeterminedPayout = predeterminedPayout > 0 ? predeterminedPayout * 0.99 : 0;

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
  // Buyable markets: open, not expired by date, and not your own pools.
  const openMarkets = useMemo(
    () => events.filter((e) => e.status === 'open' && e.expiryDate.getTime() > Date.now() && e.creator.toLowerCase() !== myAddr),
    [events, myAddr],
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
  const activePositions = useMemo(() => myPositions.filter((p) => p.status === 'active'), [myPositions]);
  // A winning position can be reported as either 'claimable' (1) or 'settled_win'
  // (4) depending on contract version — both are claimable until `claimed`.
  const claimablePositions = useMemo(
    () => myPositions.filter((p) => (p.status === 'claimable' || p.status === 'settled_win') && !p.claimed),
    [myPositions],
  );
  const historyPositions = useMemo(() => {
    const claimSet = new Set(claimablePositions.map((p) => p.id));
    return myPositions.filter((p) => p.status !== 'active' && !claimSet.has(p.id));
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
        <button className="btn btn-primary" onClick={() => setView('create')}><Plus /> Create pool</button>
      </div>

      {/* view tabs */}
      <div className="cv-tabs">
        <button className={view === 'buy' ? 'on' : ''} onClick={() => setView('buy')}><ShieldCheck /> Buy cover</button>
        <button className={view === 'lp' ? 'on' : ''} onClick={() => setView('lp')}><Layers /> Provide liquidity</button>
        <button className={view === 'create' ? 'on' : ''} onClick={() => setView('create')}><PlusCircle /> Create pool</button>
        <button className={view === 'mypos' ? 'on' : ''} onClick={() => setView('mypos')}><Shield /> My cover</button>
        <button className={view === 'mypools' ? 'on' : ''} onClick={() => setView('mypools')}><Award /> My pools</button>
      </div>

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
                <span>Market</span><span>Direction</span><span>Strike</span><span>Premium</span><span className="last">Action</span>
              </div>
              <div>
                {eventsLoading ? (
                  <div className="empty">Loading markets…</div>
                ) : buyList.length === 0 ? (
                  <div className="empty">No covers match your filters.</div>
                ) : buyList.map((ev) => (
                  <div className="mkt-row" key={ev.id} onClick={() => openDetail(ev)}>
                    <div className="mkt-mk"><MarketFlag pair={ev.underlying} /><div className="mkt-nm"><div className="a">{pairLabel(ev.underlying)}</div><div className="b">{ev.name} · {expiryLabel(ev.expiryDate)}</div></div></div>
                    <div className="mkt-col"><span className="k">Direction</span><span className="dir"><span className="da">{ev.strikeAbove ? <ArrowUpRight /> : <ArrowDownRight />}</span>{ev.strikeAbove ? 'Rises' : 'Falls'}</span></div>
                    <div className="mkt-col"><span className="k">Strike</span><span className="mkt-v">{ev.strike.toLocaleString()}</span></div>
                    <div className="mkt-col"><span className="k">Premium</span><span className="mkt-v">{(ev.premiumRate * 100).toFixed(1)}%</span></div>
                    <div className="mkt-act">
                      <button className="btn-sm2 ghost" onClick={(e) => { e.stopPropagation(); openLp(ev); }}>Underwrite</button>
                      <button className="btn-sm2 primary" onClick={(e) => { e.stopPropagation(); openBuy(ev); }}>Buy</button>
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
              <div className="empty">Loading pools…</div>
            ) : lpList.length === 0 ? (
              <div className="empty">No open pools right now.</div>
            ) : lpList.map((ev) => (
              <PoolCard key={ev.id} ev={ev} onAdd={() => openLp(ev)} onOpen={() => openDetail(ev)} />
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
                disabled={createEventMutation.isPending || seedNum < 10 || !newEvent.name.trim() || !newEvent.strike || !newEvent.payoutCap || !newEvent.premiumRate || (isPremiumBelowSuggested && !newEvent.overrideAcknowledged)}
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
          {myPositions.length === 0 ? (
            <div className="empty">No cover positions yet. Buy cover to protect your exposure.</div>
          ) : (
            <div className="pool-grid" style={{ gridTemplateColumns: '1fr' }}>
              {claimablePositions.map((p) => {
                const ev = events.find((e) => e.id === p.eventId);
                const gross = p.payoutAmount; const net = gross * 0.99;
                return (
                  <div className="pool-card" key={`c${p.id}`} style={{ borderColor: 'color-mix(in oklab,var(--green) 35%,var(--border))' }}>
                    <div className="pool-top"><MarketFlag pair={ev?.underlying || ''} /><div className="pt-nm"><div className="a">{pairLabel(ev?.underlying || `#${p.eventId}`)}</div><div className="b">Position #{p.id} · payout ready</div></div>
                      <div className="pool-apr"><div className="v" style={{ color: 'var(--green)' }}>{fmtMoney(net)}</div><div className="l">Claimable</div></div></div>
                    <div className="brk"><div className="brk-line"><span className="l">Gross payout</span><span className="v">{fmtMoney(gross)}</span></div><div className="brk-line"><span className="l">Claim fee (1%)</span><span className="v">-{fmtMoney(gross * 0.01)}</span></div></div>
                    <button className="btn-sm2 primary" disabled={claimMutation.isPending} onClick={() => claimMutation.mutate(p.id)}>{claimMutation.isPending ? 'Claiming…' : `Claim ${fmtMoney(net)}`}</button>
                  </div>
                );
              })}
              {activePositions.map((p) => {
                const ev = events.find((e) => e.id === p.eventId);
                return (
                  <div className="pool-card" key={`a${p.id}`}>
                    <div className="pool-top"><MarketFlag pair={ev?.underlying || ''} /><div className="pt-nm"><div className="a">{pairLabel(ev?.underlying || `#${p.eventId}`)}</div><div className="b">{ev?.name || `Event #${p.eventId}`}</div></div>
                      <div className="pool-apr"><div className="v">{fmtMoney(p.notional)}</div><div className="l">Notional</div></div></div>
                    <div className="pool-stats">
                      <div className="pool-stat"><div className="l">Premium paid</div><div className="v tnum">{fmtMoney(p.premiumPaid)}</div></div>
                      <div className="pool-stat"><div className="l">Max payout</div><div className="v tnum">{fmtMoney(p.notional * (ev?.payoutPercent || 0))}</div></div>
                    </div>
                    {ev && (
                      <div style={{ marginTop: 8 }}>
                        <PayoutScenarios
                          notional={p.notional}
                          totalCost={p.premiumPaid + p.platformFeePaid}
                          maxPayout={p.notional * (ev.payoutPercent || 0)}
                          strike={ev.strike}
                          initialRate={ev.initialRate}
                          strikeAbove={ev.strikeAbove}
                          underlying={ev.underlying}
                          currentRate={fxData?.rates[ev.underlying]?.rate || 0}
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
                    return (
                      <div className="row" key={`h${p.id}`}>
                        <MarketFlag pair={ev?.underlying || ''} />
                        <div className="r-main"><div className="r1">{pairLabel(ev?.underlying || `#${p.eventId}`)}</div><div className="r2">Position #{p.id} · {fmtMoney(p.notional)} notional</div></div>
                        <div className="r-side"><span className={`st ${p.status === 'expired' ? 'pend' : 'ok'}`}>{label}</span></div>
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
          {myEvents.length === 0 && activeDeposits.length === 0 ? (
            <div className="empty">You haven't created pools or provided liquidity yet.</div>
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
                          const expired = ev.expiryDate.getTime() <= now && ev.status === 'open';
                          return (
                            <div className="pool-card" key={ev.id}>
                              <div className="pool-top"><MarketFlag pair={ev.underlying} /><div className="pt-nm"><div className="a">{pairLabel(ev.underlying)}</div><div className="b">{ev.name}</div></div>
                                <div className="pool-apr"><div className="v">{(ev.premiumRate * 100).toFixed(1)}%</div><div className="l">Premium</div></div></div>
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
                                  <button className="btn-sm2 primary" style={{ marginTop: 12 }} onClick={() => openLp(ev)}>Add liquidity</button>
                                </>
                              )}
                              {expired && <button className="btn-sm2 ghost" style={{ marginTop: 12 }} disabled={recoverExpiredMutation.isPending} onClick={() => recoverExpiredMutation.mutate(ev.id)}>{recoverExpiredMutation.isPending ? 'Recovering…' : 'Recover capital'}</button>}
                              {ev.creatorEarnings > 0.01 && <button className="btn-sm2 primary" style={{ marginTop: 8 }} disabled={withdrawEarningsMutation.isPending} onClick={() => withdrawEarningsMutation.mutate(ev.id)}>{withdrawEarningsMutation.isPending ? 'Claiming…' : `Claim earnings ${fmtMoney(ev.creatorEarnings)}`}</button>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}

              {activeDeposits.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div className="sec-h"><h2>My liquidity</h2></div>
                  <div className="list">
                    {activeDeposits.map((d) => {
                      const ev = events.find((e) => e.id === d.eventId);
                      const claimable = d.premiumsEarned - d.premiumsClaimed;
                      // Principal is only withdrawable once the event is SETTLED on-chain
                      // (the oracle runs settleEvent — one-touch or at expiry). Gating on the
                      // calendar date alone would surface a button that reverts before
                      // settlement completes, so we trust the on-chain status only.
                      const settledOnChain = ev ? (ev.status === 'settled' || ev.status === 'expired') : false;
                      const pendingSettlement = ev ? (ev.status === 'open' && ev.expiryDate.getTime() <= Date.now()) : false;
                      return (
                        <div className="row" key={d.id}>
                          <span className="coin"><CoinSvg token="usdc" /></span>
                          <div className="r-main"><div className="r1">{pairLabel(ev?.underlying || `#${d.eventId}`)}</div><div className="r2">{fmtMoney(d.amount)} deposited{claimable > 0.01 ? ` · ${fmtMoney(claimable)} premium ready` : ''}{settledOnChain ? ' · ready to withdraw' : pendingSettlement ? ' · settling…' : ''}</div></div>
                          <div className="r-side" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            {claimable > 0.01 && <button className="btn-sm2 primary" disabled={claimPremiumsMutation.isPending} onClick={() => claimPremiumsMutation.mutate(d.id)}>Claim</button>}
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
                <div className="det-apr"><div className="v">{(ev.premiumRate * 100).toFixed(1)}%</div><div className="l">Premium</div></div>
              </div>
              <p className="det-cond">{ev.strikeAbove ? 'Pays out if the rate rises past ' : 'Pays out if the rate falls below '}{ev.strike.toLocaleString()} {unitOf(ev.underlying)} before expiry. Settlement is one-touch — the event triggers the moment the rate touches the strike.</p>
              <div className="det-grid">
                <div className="det-stat"><div className="l">Direction</div><div className="v">{ev.strikeAbove ? 'Rate rises' : 'Rate falls'}</div></div>
                <div className="det-stat"><div className="l">Strike</div><div className="v">{ev.strike.toLocaleString()} {unitOf(ev.underlying)}</div></div>
                <div className="det-stat"><div className="l">Premium</div><div className="v">{(ev.premiumRate * 100).toFixed(1)}%</div></div>
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
            </div>
            <div className="field">
              <label>Notional to cover</label>
              <div className="amount">
                <div className="arow"><input inputMode="decimal" placeholder="0" value={notional} onChange={(e) => setNotional(e.target.value)} /><span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--tx-3)' }}>USD</span></div>
                <div className="abot"><span className="usd">Premium {(selectedEvent.premiumRate * 100).toFixed(1)}%</span><span className="bal">Available {fmtMoney(selectedEvent.availableCapacity)}</span></div>
              </div>
              <div className="notrow">{[10000, 50000, 100000].map((n) => <button key={n} onClick={() => setNotional(String(n))}>${n / 1000}k</button>)}</div>
            </div>
            <div className="payout-card">
              <div className="pc-l">Max payout if triggered</div>
              <div className="pc-v">{fmtMoney(netPredeterminedPayout)}</div>
              <div className="pc-s">{notional ? 'Net of the 1% claim fee. Scales linearly from the strike toward the cap.' : 'Pays out when the rate moves from strike toward the cap.'}</div>
            </div>
            <div className="brk">
              <div className="brk-line"><span className="l">Premium ({(selectedEvent.premiumRate * 100).toFixed(1)}% of notional)</span><span className="v">{fmtMoney(premiumCalc)}</span></div>
              <div className="brk-line"><span className="l">Platform fee ({(hedgerFeeRate * 100).toFixed(1)}% of notional)</span><span className="v">{fmtMoney(hedgerFeeCalc)}</span></div>
              <div className="brk-line total"><span className="l">You pay</span><span className="v">{fmtMoney(totalCostCalc)}</span></div>
            </div>
            {tokenBalanceNum > 0 && <p className="hint" style={{ marginBottom: 12 }}>Balance {fmtMoney(tokenBalanceNum)} {eventTokenSymbol}</p>}
            <button className="btn btn-primary" disabled={buyProtectionMutation.isPending || !notional || parseFloat(notional) < 10 || totalCostCalc > tokenBalanceNum} onClick={guardedBuyProtection}>
              {buyProtectionMutation.isPending ? <><Loader2 className="spin" /> {txStep || 'Buying…'}</> : <><ShieldCheck /> Buy protection</>}
            </button>
          </>
        ) : <SheetLoading />}
      </div>

      {/* ===== LP SHEET ===== */}
      <div className={`sheet-scrim${lpOpen ? ' on' : ''}`} onClick={() => setLpOpen(false)} />
      <div className={`sheet${lpOpen ? ' on' : ''}`}>
        <div className="grab" />
        <div className="sheet-h"><h3>Provide liquidity</h3><button className="sheet-x" onClick={() => setLpOpen(false)}><X /></button></div>
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
                <div className="brk-line"><span className="l">Premium rate</span><span className="v">{(selectedEvent.premiumRate * 100).toFixed(1)}%</span></div>
                <div className="brk-line"><span className="l">Your pool share</span><span className="v">{share.toFixed(2)}%</span></div>
                <div className="brk-line total"><span className="l">Pool size after deposit</span><span className="v">{fmtMoney(selectedEvent.totalLiquidity + amt)}</span></div>
              </div>
              <p className="hint" style={{ marginBottom: 14 }}>You earn a pro-rata share of every premium paid into this pool. Principal and premiums are withdrawable after settlement.</p>
              <button className="btn btn-primary" disabled={depositMutation.isPending || amt <= 0 || amt > tokenBalanceNum} onClick={guardedDeposit}>
                {depositMutation.isPending ? <><Loader2 className="spin" /> {txStep || 'Depositing…'}</> : <><Layers /> Add liquidity</>}
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
