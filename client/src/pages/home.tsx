/**
 * Home — 2026 redesign
 *
 * Visual chrome reworked, business logic intact:
 *   - RiftWalletCard: cross-chain Rift balances + send (kept)
 *   - RiftHistoryCard: Rift tx history (kept)
 *   - On-platform balance card with selected-chain native + token balances
 *   - Alerts: claimable payouts, expiring positions, unclaimed LP premiums,
 *     active events when user has nothing
 *   - Live FX rates, hedge positions snapshot, market events
 *
 * Brand logo, brand colors, all data wiring unchanged.
 */

import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { BottomNav } from '@/components/bottom-nav';
import { TermsGate } from '@/components/terms-gate';
import { AppHeader } from '@/components/app-header';
import { BackupWarningBanner } from '@/components/wallet/backup-warning-banner';
import { RiftWalletCard } from '@/components/wallet/rift-wallet-card';
import { useRiftBalances } from '@/hooks/use-rift-balances';
import { RiftHistoryCard } from '@/components/wallet/rift-history-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useWallet } from '@/hooks/use-wallet';
import { useTransactions } from '@/hooks/use-transactions';
import { getNetworkById } from '@/lib/networks';
import { fetchCryptoPrices, getBnbPrice } from '@/lib/price-service';
import {
  hedgeContract,
  type HedgeEventData,
  type HedgePositionData,
  type HedgeLpDepositData,
} from '@/lib/hedge-contract';
import logoPath from '@/assets/logo.png';
import {
  Shield,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertTriangle,
  ArrowRight,
  DollarSign,
  Activity,
  Sparkles,
  Copy,
  Users,
  ChevronRight,
  BarChart3,
} from 'lucide-react';
import { fmtUsd, QuickAction, BfxMark } from '@/components/ui/bfx';
import { useUnifiedActivity, ActivityRowView } from '@/components/wallet/rift-activity';

type FXRate = {
  pair: string;
  rate: number;
  source: string;
  timestamp: number;
  lastUpdated: string;
  change24h?: number;
};

export default function HomePage() {
  const [, setLocation] = useLocation();
  const { isUnlocked, walletExists, isLoading, wallet, settings } = useWallet();
  const { formatCurrency } = useTransactions(settings.selectedNetworkId);
  const { toast } = useToast();

  const selectedNetwork = getNetworkById(settings.selectedNetworkId);
  const selectedChainId = selectedNetwork?.chainId;
  const walletAddress = wallet?.address;

  // Live native-token prices (for native USD value)
  const [ethPrice, setEthPrice] = useState<number>(0);
  const [bnbPrice, setBnbPrice] = useState<number>(getBnbPrice() ?? 0);
  useEffect(() => {
    fetchCryptoPrices().then((prices) => {
      if (prices?.eth) setEthPrice(prices.eth);
      if (prices?.bnb) setBnbPrice(prices.bnb);
    });
  }, []);

  // Native + ERC-20 balances on the selected chain (unchanged data source)
  const nativeBalanceQuery = useQuery({
    queryKey: ['/api/wallet', walletAddress, 'native-balance', selectedChainId],
    queryFn: async () => {
      const res = await fetch(`/api/wallet/${walletAddress}/native-balance?networkId=${selectedChainId}`);
      if (!res.ok) return { balance: '0', symbol: selectedNetwork?.symbol || 'ETH' };
      return res.json() as Promise<{ balance: string; symbol: string }>;
    },
    enabled: !!walletAddress && !!selectedChainId,
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const tokenBalanceQuery = useQuery({
    queryKey: ['/api/wallet', walletAddress, 'token-balances', selectedChainId],
    queryFn: async () => {
      const res = await fetch(`/api/wallet/${walletAddress}/token-balances?networkId=${selectedChainId}`);
      if (!res.ok) return { balances: [] as any[] };
      return res.json() as Promise<{ balances: any[] }>;
    },
    enabled: !!walletAddress && !!selectedChainId,
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const nativeSym = nativeBalanceQuery.data?.symbol ?? selectedNetwork?.symbol ?? 'ETH';
  const nativeBalance = parseFloat(nativeBalanceQuery.data?.balance ?? '0');
  const nativePrice = nativeSym === 'BNB' ? bnbPrice : ethPrice;
  const nativeUsd = nativeBalance * nativePrice;
  const tokenUsd = (tokenBalanceQuery.data?.balances ?? []).reduce(
    (sum: number, t: any) => sum + (t.usdValue || 0),
    0,
  );
  const onChainTotalValue = nativeUsd + tokenUsd;

  // ── Cross-chain truth ────────────────────────────────────────────────
  // The per-chain RPC query above only sees the currently-selected network.
  // If the user has balances on other chains (BSC / Base) they show
  // as $0 here even though the funds exist. The Rift SDK exposes balances
  // across every chain the wallet has touched — sum that for the headline
  // number, and only fall back to the per-chain on-chain RPC view when the
  // Rift SDK hasn't loaded yet.
  const { balances: riftBalances, isLoading: riftLoading } = useRiftBalances();
  const riftTotal = riftBalances.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const hasRiftTotal = !riftLoading && riftBalances.length > 0;
  const totalValue = hasRiftTotal ? riftTotal : onChainTotalValue;
  const isLoadingBalance =
    nativeBalanceQuery.isLoading || tokenBalanceQuery.isLoading || riftLoading;

  // Referral
  const { data: referralCode } = useQuery<{ code: string; currentUses: number }>({
    queryKey: ['/api/referrals/codes', wallet?.address],
    queryFn: () => fetch(`/api/referrals/codes/${wallet?.address}`).then((r) => r.json()),
    enabled: !!wallet?.address,
  });
  const referralLink = referralCode?.code
    ? `${window.location.origin}/create-wallet?ref=${referralCode.code}`
    : null;
  const copyReferralLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      toast({
        title: 'Referral link copied!',
        description: 'Share it to earn tokens for every friend who joins.',
      });
    });
  };

  // Hedge state (same wiring as before)
  const [positions, setPositions] = useState<HedgePositionData[]>([]);
  const [deposits, setDeposits] = useState<HedgeLpDepositData[]>([]);
  const [events, setEvents] = useState<HedgeEventData[]>([]);
  const [hedgeLoading, setHedgeLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllRates, setShowAllRates] = useState(false);

  const { data: fxData } = useQuery<{ rates: Record<string, FXRate>; pairs: string[] }>({
    queryKey: ['/api/fx/rates'],
    refetchInterval: 5 * 60 * 1000,
  });

  const loadHedgeData = async () => {
    if (!wallet?.address) {
      setHedgeLoading(false);
      return;
    }
    try {
      const [pos, dep, ev] = await Promise.all([
        hedgeContract.getPositionsByWallet(wallet.address),
        hedgeContract.getDepositsByWallet(wallet.address),
        hedgeContract.getAllEvents(),
      ]);
      setPositions(pos);
      setDeposits(dep);
      setEvents(ev);
    } catch (err) {
      console.error('Failed to load hedge data:', err);
    } finally {
      setHedgeLoading(false);
    }
  };

  useEffect(() => {
    loadHedgeData();
  }, [wallet?.address]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadHedgeData();
    nativeBalanceQuery.refetch();
    tokenBalanceQuery.refetch();
    setRefreshing(false);
  };

  useEffect(() => {
    if (!isLoading) {
      if (!walletExists()) setLocation('/wallet');
      else if (!isUnlocked) setLocation('/auth');
    }
  }, [isUnlocked, walletExists, isLoading, setLocation]);

  // Derived sets (unchanged)
  const activePositions = useMemo(
    () => positions.filter((p) => p.status === 'active' || p.status === 'claimable'),
    [positions],
  );
  const claimablePositions = useMemo(
    () => positions.filter((p) => p.status === 'claimable'),
    [positions],
  );
  const activeDeposits = useMemo(() => deposits.filter((d) => !d.withdrawn), [deposits]);
  const unclaimedPremiums = useMemo(
    () => activeDeposits.reduce((sum, d) => sum + (d.premiumsEarned - d.premiumsClaimed), 0),
    [activeDeposits],
  );
  const totalHedgeExposure = useMemo(
    () => activePositions.reduce((sum, p) => sum + p.notional, 0),
    [activePositions],
  );
  const totalLpDeposited = useMemo(
    () => activeDeposits.reduce((sum, d) => sum + d.amount, 0),
    [activeDeposits],
  );
  const totalClaimablePayout = useMemo(
    () => claimablePositions.reduce((sum, p) => sum + p.payoutAmount, 0),
    [claimablePositions],
  );

  const openEvents = useMemo(() => events.filter((e) => e.status === 'open'), [events]);
  const expiringEvents = useMemo(() => {
    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    return openEvents.filter((e) => e.expiryDate.getTime() - now < threeDays && e.expiryDate.getTime() > now);
  }, [openEvents]);

  const alerts = useMemo(() => {
    const items: { type: 'warning' | 'success' | 'info'; message: string; action?: () => void; actionLabel?: string }[] = [];
    if (claimablePositions.length > 0) {
      items.push({
        type: 'success',
        message: `${claimablePositions.length} cover payout${claimablePositions.length > 1 ? 's' : ''} ready to claim`,
        action: () => setLocation('/hedge'),
        actionLabel: 'Claim',
      });
    }
    if (unclaimedPremiums > 0.01) {
      items.push({
        type: 'success',
        message: `${fmtUsd(unclaimedPremiums)} in unclaimed premium`,
        action: () => setLocation('/hedge'),
        actionLabel: 'Collect',
      });
    }
    if (expiringEvents.length > 0) {
      const myExpiringPositions = activePositions.filter((p) =>
        expiringEvents.some((e) => e.id === p.eventId),
      );
      if (myExpiringPositions.length > 0) {
        items.push({
          type: 'warning',
          message: `${myExpiringPositions.length} cover position${myExpiringPositions.length > 1 ? 's' : ''} expiring within 3 days`,
          action: () => setLocation('/hedge'),
          actionLabel: 'View',
        });
      }
    }
    if (openEvents.length > 0 && activePositions.length === 0 && activeDeposits.length === 0) {
      items.push({
        type: 'info',
        message: `${openEvents.length} active cover pool${openEvents.length > 1 ? 's' : ''} available`,
        action: () => setLocation('/hedge'),
        actionLabel: 'Explore',
      });
    }
    return items;
  }, [claimablePositions, unclaimedPremiums, expiringEvents, activePositions, activeDeposits, openEvents, setLocation]);

  // Unified activity feed (Rift sends + Rift deposits + BlockFinaX hedge actions).
  // Each row carries a tx hash so it deep-links to the right block explorer.
  const { rows: activityRows, loading: activityLoading } = useUnifiedActivity(wallet?.address, 12);
  const recentActivity = useMemo(() => activityRows.slice(0, 6), [activityRows]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <img src={logoPath} alt="BlockFinaX" className="w-16 h-16 object-contain mx-auto mb-3" />
          <div className="text-sm font-medium text-muted-foreground">Loading BlockFinaX…</div>
        </div>
      </div>
    );
  }

  if (!walletExists() || !isUnlocked) return null;

  const portfolioValue = totalValue + totalLpDeposited + totalClaimablePayout;

  return (
    <TermsGate walletAddress={wallet?.address}>
      <div className="min-h-screen flex flex-col bg-background">
        <AppHeader onRefresh={handleRefresh} refreshing={refreshing} />

        <BackupWarningBanner />

        <main className="flex-1 pb-28">
          <div className="max-w-2xl mx-auto px-4 pt-5 pb-6 space-y-5">
            {/* ── Rift smart wallet card (cross-chain balances + send) ──── */}
            <RiftWalletCard />

            {/* ── On-platform portfolio (selected chain) ──────────────── */}
            <Card className="relative overflow-hidden rounded-3xl bfx-hero-brand border-0">
              <div className="absolute inset-0 bfx-hero-brand-dotgrid opacity-50 pointer-events-none" />
              <BfxMark
                size={200}
                className="absolute -right-12 -top-14 pointer-events-none"
                primary="rgba(255,255,255,0.05)"
                accent="rgba(255,255,255,0.10)"
              />
              <CardContent className="relative px-6 pt-6 pb-5">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/70 font-semibold mb-5">
                  On-platform balance
                </p>
                {isLoadingBalance || hedgeLoading ? (
                  <Skeleton className="h-10 w-44 mb-6 bg-white/10" />
                ) : (
                  <h2 className="bfx-display text-[42px] font-semibold tracking-tight mb-6 text-white leading-none">
                    {formatCurrency(portfolioValue)}
                  </h2>
                )}
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl py-2.5 px-3">
                    <p className="text-[9.5px] text-white/55 uppercase tracking-[0.1em] font-semibold">Wallet</p>
                    <div className="text-[14px] font-semibold font-mono-data text-white mt-1 truncate tabular-nums">
                      {isLoadingBalance ? <Skeleton className="h-4 w-12 bg-white/10" /> : formatCurrency(totalValue)}
                    </div>
                  </div>
                  <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl py-2.5 px-3">
                    <p className="text-[9.5px] text-white/55 uppercase tracking-[0.1em] font-semibold">In pools</p>
                    <div className="text-[14px] font-semibold font-mono-data text-white mt-1 truncate tabular-nums">
                      {hedgeLoading ? <Skeleton className="h-4 w-12 bg-white/10" /> : fmtUsd(totalLpDeposited)}
                    </div>
                  </div>
                  <div
                    className={`rounded-2xl py-2.5 px-3 border transition-colors ${
                      totalClaimablePayout > 0
                        ? 'bg-emerald-400/12 border-emerald-300/40'
                        : 'bg-white/[0.06] border-white/[0.08]'
                    }`}
                  >
                    <p
                      className={`text-[9.5px] uppercase tracking-[0.1em] font-semibold ${
                        totalClaimablePayout > 0 ? 'text-emerald-200' : 'text-white/55'
                      }`}
                    >
                      Claimable
                    </p>
                    <div
                      className={`text-[14px] font-semibold font-mono-data mt-1 truncate tabular-nums ${
                        totalClaimablePayout > 0 ? 'text-emerald-200' : 'text-white'
                      }`}
                    >
                      {hedgeLoading ? <Skeleton className="h-4 w-12 bg-white/10" /> : fmtUsd(totalClaimablePayout)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Quick actions ───────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-2">
              <QuickAction
                tone="primary"
                icon={<Shield className="h-4 w-4" strokeWidth={1.9} />}
                label="Buy cover"
                onClick={() => setLocation('/hedge')}
              />
              <QuickAction
                tone="amber"
                icon={<DollarSign className="h-4 w-4" strokeWidth={1.9} />}
                label="Earn"
                onClick={() => setLocation('/hedge?tab=provider')}
              />
              <QuickAction
                tone="emerald"
                icon={<Users className="h-4 w-4" strokeWidth={1.9} />}
                label="Refer"
                onClick={copyReferralLink}
                disabled={!referralLink}
              />
            </div>

            {/* ── Referral banner ─────────────────────────────────────── */}
            {referralLink && (
              <button
                type="button"
                onClick={() => setLocation('/rewards?tab=referrals')}
                className="w-full text-left rounded-2xl border border-gray-100 dark:border-border/40 bg-card hover:border-primary/30 hover:shadow-[0_2px_8px_-2px_rgba(26,68,128,0.12)] transition-all active:scale-[0.99] px-4 py-3.5 flex items-center justify-between gap-3 group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 inline-flex items-center justify-center shrink-0 shadow-[0_4px_12px_-4px_rgba(16,185,129,0.5)]">
                    <Users className="h-4.5 w-4.5 text-white" strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold tracking-tight leading-tight">
                      Invite friends · Earn{' '}
                      <span className="text-emerald-600 dark:text-emerald-400">50 points</span> each
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      Tap to share your code on WhatsApp, X, Telegram or email
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              </button>
            )}

            {/* ── Alerts ────────────────────────────────────────────── */}
            {alerts.length > 0 && (
              <div className="space-y-2">
                {alerts.map((alert, i) => {
                  const tone = alert.type === 'success'
                    ? { wrap: 'bg-emerald-50/70 dark:bg-emerald-500/5 border-emerald-100 dark:border-emerald-500/20', icon: 'text-emerald-600 bg-emerald-100/80 dark:bg-emerald-500/10', btn: 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-500/10' }
                    : alert.type === 'warning'
                    ? { wrap: 'bg-amber-50/70 dark:bg-amber-500/5 border-amber-100 dark:border-amber-500/20', icon: 'text-amber-600 bg-amber-100/80 dark:bg-amber-500/10', btn: 'text-amber-700 dark:text-amber-300 hover:bg-amber-100/70 dark:hover:bg-amber-500/10' }
                    : { wrap: 'bg-blue-50/70 dark:bg-blue-500/5 border-blue-100 dark:border-blue-500/20', icon: 'text-blue-600 bg-blue-100/80 dark:bg-blue-500/10', btn: 'text-blue-700 dark:text-blue-300 hover:bg-blue-100/70 dark:hover:bg-blue-500/10' };
                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-2xl border ${tone.wrap}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className={`h-7 w-7 rounded-full inline-flex items-center justify-center ${tone.icon}`}>
                          {alert.type === 'success' ? (
                            <Sparkles className="h-3.5 w-3.5" />
                          ) : alert.type === 'warning' ? (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          ) : (
                            <Activity className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <span className="text-sm font-medium leading-tight">{alert.message}</span>
                      </div>
                      {alert.action && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={alert.action}
                          className={`text-xs h-7 px-2.5 rounded-lg font-semibold ${tone.btn}`}
                        >
                          {alert.actionLabel} <ArrowRight className="h-3 w-3 ml-1" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Rift transaction history (cross-chain) ─────────────── */}
            <RiftHistoryCard />

            {/* ── Live FX rates ──────────────────────────────────────── */}
            <Card className="rounded-2xl border-gray-100 dark:border-border/40 shadow-none">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-full bg-primary/10 inline-flex items-center justify-center">
                      <BarChart3 className="h-3.5 w-3.5 text-primary" />
                    </span>
                    <CardTitle className="text-[15px] font-semibold tracking-tight">
                      Live FX rates
                    </CardTitle>
                  </div>
                  {fxData?.rates && Object.keys(fxData.rates).length > 6 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 px-2.5 rounded-lg font-semibold text-muted-foreground hover:text-foreground"
                      onClick={() => setShowAllRates(!showAllRates)}
                    >
                      {showAllRates ? 'Show less' : `All (${Object.keys(fxData.rates).length})`}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {fxData?.rates ? (() => {
                  const PRIMARY_PAIRS = ['USD/GHS', 'USD/NGN', 'USD/KES', 'USD/ZAR', 'USD/XOF', 'EUR/GHS'];
                  const entries = Object.entries(fxData.rates);
                  const primaryEntries = entries.filter(
                    ([key, rate]) => PRIMARY_PAIRS.includes(rate.pair || key),
                  );
                  const otherEntries = entries.filter(
                    ([key, rate]) => !PRIMARY_PAIRS.includes(rate.pair || key),
                  );
                  const displayEntries = showAllRates ? [...primaryEntries, ...otherEntries] : primaryEntries;

                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {displayEntries.map(([key, rate]) => {
                        const pair = rate.pair || key;
                        const [base, quote] = pair.split('/');
                        const change = rate.change24h;
                        const hasChange = change !== undefined && change !== null;
                        const isPositive = hasChange && change >= 0;
                        return (
                          <button
                            key={key}
                            onClick={() => setLocation('/hedge')}
                            className="group flex flex-col p-3 rounded-2xl border border-gray-100 dark:border-border/40 bg-card hover:border-primary/30 hover:shadow-[0_2px_8px_-2px_rgba(26,68,128,0.12)] transition-all text-left active:scale-[0.98]"
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                {base}/{quote}
                              </span>
                              {hasChange && (
                                <span
                                  className={`inline-flex items-center gap-0.5 text-[10px] font-semibold font-mono-data tabular-nums px-1.5 py-0.5 rounded-md ${
                                    isPositive
                                      ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/10'
                                      : 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-500/10'
                                  }`}
                                >
                                  {isPositive ? (
                                    <TrendingUp className="h-2.5 w-2.5" strokeWidth={2.4} />
                                  ) : (
                                    <TrendingDown className="h-2.5 w-2.5" strokeWidth={2.4} />
                                  )}
                                  {isPositive ? '+' : ''}
                                  {change.toFixed(2)}%
                                </span>
                              )}
                            </div>
                            <span className="text-[15px] font-semibold font-mono-data tabular-nums tracking-tight">
                              {rate.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })() : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <Skeleton key={i} className="h-12 rounded-xl" />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Cover positions + activity ────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="rounded-2xl border-gray-100 dark:border-border/40 shadow-none">
                <CardHeader className="pb-3 pt-5 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="h-7 w-7 rounded-full bg-primary/10 inline-flex items-center justify-center">
                        <Shield className="h-3.5 w-3.5 text-primary" />
                      </span>
                      <CardTitle className="text-[15px] font-semibold tracking-tight">
                        Cover positions
                      </CardTitle>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 px-2.5 rounded-lg font-semibold text-muted-foreground hover:text-foreground"
                      onClick={() => setLocation('/hedge')}
                    >
                      View all <ChevronRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {hedgeLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : activePositions.length === 0 && activeDeposits.length === 0 ? (
                    <div className="text-center py-6">
                      <div className="h-10 w-10 rounded-full bg-primary/10 mx-auto mb-2.5 flex items-center justify-center">
                        <Shield className="h-5 w-5 text-primary" />
                      </div>
                      <p className="text-sm font-medium">No active cover</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                        Protect FX, commodity &amp; crypto exposure.
                      </p>
                      <Button
                        size="sm"
                        className="text-xs h-8 rounded-lg"
                        onClick={() => setLocation('/hedge')}
                      >
                        Browse pools <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {activePositions.length > 0 && (
                        <div className="flex items-center justify-between p-2.5 rounded-xl bg-primary/5">
                          <div>
                            <p className="text-xs text-muted-foreground">As buyer</p>
                            <p className="text-sm font-semibold">
                              {activePositions.length} position{activePositions.length > 1 ? 's' : ''}
                            </p>
                          </div>
                          <p className="text-sm font-bold font-mono-data">{fmtUsd(totalHedgeExposure)}</p>
                        </div>
                      )}
                      {activeDeposits.length > 0 && (
                        <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/5">
                          <div>
                            <p className="text-xs text-muted-foreground">As provider</p>
                            <p className="text-sm font-semibold">
                              {activeDeposits.length} pool{activeDeposits.length > 1 ? 's' : ''}
                            </p>
                          </div>
                          <p className="text-sm font-bold font-mono-data">{fmtUsd(totalLpDeposited)}</p>
                        </div>
                      )}
                      {unclaimedPremiums > 0.01 && (
                        <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/5">
                          <div>
                            <p className="text-xs text-muted-foreground">Unclaimed premium</p>
                            <p className="text-sm font-semibold text-emerald-600 font-mono-data">
                              {fmtUsd(unclaimedPremiums)}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-7"
                            onClick={() => setLocation('/hedge')}
                          >
                            Claim
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-gray-100 dark:border-border/40 shadow-none">
                <CardHeader className="pb-3 pt-5 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="h-7 w-7 rounded-full bg-primary/10 inline-flex items-center justify-center">
                        <Activity className="h-3.5 w-3.5 text-primary" />
                      </span>
                      <CardTitle className="text-[15px] font-semibold tracking-tight">
                        Recent activity
                      </CardTitle>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 px-2.5 rounded-lg font-semibold text-muted-foreground hover:text-foreground"
                      onClick={() => setLocation('/wallet?tab=activity')}
                    >
                      View all <ChevronRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="px-0 pb-2">
                  {activityLoading && recentActivity.length === 0 ? (
                    <div className="px-5 pb-3 space-y-2">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : recentActivity.length === 0 ? (
                    <div className="text-center py-6 px-5">
                      <div className="h-10 w-10 rounded-full bg-muted/60 mx-auto mb-2.5 flex items-center justify-center">
                        <Activity className="h-5 w-5 text-muted-foreground/60" />
                      </div>
                      <p className="text-sm font-medium">No recent activity</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                        Cover, payments &amp; pool actions show up here.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-8 rounded-lg"
                        onClick={() => setLocation('/hedge')}
                      >
                        Explore cover <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100 dark:divide-border/40">
                      {recentActivity.map((row, i) => (
                        <ActivityRowView key={`${row.hash}-${row.kind}-${i}`} row={row} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Cover market snapshot ─────────────────────────────── */}
            <Card className="rounded-2xl border-gray-100 dark:border-border/40 shadow-none">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-full bg-emerald-100 dark:bg-emerald-500/10 inline-flex items-center justify-center">
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    </span>
                    <CardTitle className="text-[15px] font-semibold tracking-tight">
                      Cover market
                    </CardTitle>
                  </div>
                  <Badge variant="outline" className="text-[10px] rounded-full border-gray-200 dark:border-border/60 font-mono-data">
                    {openEvents.length} pool{openEvents.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {hedgeLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : openEvents.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground">No active cover pools right now</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {openEvents.slice(0, 3).map((event) => {
                      const currentRate = fxData?.rates?.[event.underlying]?.rate;
                      const daysLeft = Math.max(
                        0,
                        Math.ceil((event.expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
                      );
                      return (
                        <button
                          key={event.id}
                          className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-gray-100 dark:border-border/40 hover:border-primary/30 hover:bg-primary/[0.02] hover:shadow-[0_2px_8px_-2px_rgba(26,68,128,0.12)] transition-all cursor-pointer text-left active:scale-[0.99]"
                          onClick={() => setLocation(`/hedge?event=${event.id}`)}
                        >
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-semibold truncate tracking-tight">
                                {event.name}
                              </span>
                              {daysLeft <= 3 && (
                                <Badge variant="outline" className="text-[9px] rounded-full border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold">
                                  <Clock className="h-2.5 w-2.5 mr-0.5" /> {daysLeft}d
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground font-mono-data tabular-nums">
                              <span className="font-semibold text-foreground/70">{event.underlying}</span>
                              <span className="text-muted-foreground/50">·</span>
                              <span>Strike {event.strike.toLocaleString()}</span>
                              <span className="text-muted-foreground/50">·</span>
                              <span>Pool ${event.totalLiquidity.toFixed(0)}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            {currentRate && (
                              <p className="text-[14px] font-semibold font-mono-data tabular-nums tracking-tight">
                                {currentRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </p>
                            )}
                            <p className="text-[10px] text-muted-foreground font-mono-data tabular-nums mt-0.5">
                              {Math.round(event.utilization * 100)}% utilized
                            </p>
                          </div>
                        </button>
                      );
                    })}
                    {openEvents.length > 3 && (
                      <Button
                        variant="ghost"
                        className="w-full text-xs h-9 rounded-xl font-semibold text-primary hover:bg-primary/5"
                        onClick={() => setLocation('/hedge')}
                      >
                        View all {openEvents.length} pools <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>

        <BottomNav />
      </div>
    </TermsGate>
  );
}
