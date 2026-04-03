import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { BottomNav } from '@/components/bottom-nav';
import { TermsGate } from '@/components/terms-gate';
import { AppHeader } from '@/components/app-header';
import { BackupWarningBanner, BACKUP_SKIPPED_KEY } from '@/components/wallet/backup-warning-banner';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useWallet } from '@/hooks/use-wallet';
import { useTransactions } from '@/hooks/use-transactions';
import { getNetworkById } from '@/lib/networks';
import { fetchCryptoPrices, getBnbPrice } from '@/lib/price-service';
import { hedgeContract, type HedgeEventData, type HedgePositionData, type HedgeLpDepositData } from '@/lib/hedge-contract';
import logoPath from "@/assets/logo.png";
import {
  Home as HomeIcon,
  Wallet as WalletIcon,
  Shield,
  Send,
  ArrowDownLeft,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertTriangle,
  ArrowRight,
  DollarSign,
  Activity,
  BarChart3,
  RefreshCw,
  Menu,
  ListChecks,
  User,
  Copy,
  Users,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const BACKUP_MNEMONIC_KEY = 'bfx_pending_backup';

type FXRate = { pair: string; rate: number; source: string; timestamp: number; lastUpdated: string; change24h?: number };

export default function HomePage() {
  const [, setLocation] = useLocation();
  const { isUnlocked, lockWallet, walletExists, isLoading, wallet, settings } = useWallet();
  const { formatCurrency } = useTransactions(settings.selectedNetworkId);
  const { toast } = useToast();

  // Resolve selected network so we can query the correct chain
  const selectedNetwork = getNetworkById(settings.selectedNetworkId);
  const selectedChainId = selectedNetwork?.chainId;
  const walletAddress = wallet?.address;

  // Live prices for native token valuation
  const [ethPrice, setEthPrice] = useState<number>(0);
  const [bnbPrice, setBnbPrice] = useState<number>(getBnbPrice() ?? 0);
  useEffect(() => {
    fetchCryptoPrices().then(prices => {
      if (prices?.eth) setEthPrice(prices.eth);
      if (prices?.bnb) setBnbPrice(prices.bnb);
    });
  }, []);

  // Direct query for native balance of the selected network (matches wallet-dashboard approach)
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

  // Direct query for token (USDC/USDT) balances of the selected network
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

  // Compute wallet value for the selected network
  const nativeSym = nativeBalanceQuery.data?.symbol ?? selectedNetwork?.symbol ?? 'ETH';
  const nativeBalance = parseFloat(nativeBalanceQuery.data?.balance ?? '0');
  const nativePrice = nativeSym === 'BNB' ? bnbPrice : ethPrice;
  const nativeUsd = nativeBalance * nativePrice;
  const tokenUsd = (tokenBalanceQuery.data?.balances ?? []).reduce(
    (sum: number, t: any) => sum + (t.usdValue || 0), 0
  );
  const totalValue = nativeUsd + tokenUsd;
  const isLoadingBalance = nativeBalanceQuery.isLoading || tokenBalanceQuery.isLoading;

  const [backupMnemonic, setBackupMnemonic] = useState<string | null>(null);
  const [showBackup, setShowBackup] = useState(false);
  const [backupCopied, setBackupCopied] = useState(false);

  // Check if a new wallet was just created and needs its seed phrase backed up
  useEffect(() => {
    const pending = sessionStorage.getItem(BACKUP_MNEMONIC_KEY);
    if (pending) {
      setBackupMnemonic(pending);
      setShowBackup(true);
    }
  }, []);

  const handleSkipBackup = () => {
    // User closed without saving — keep a flag so we can show the warning banner
    if (wallet?.address) {
      localStorage.setItem(BACKUP_SKIPPED_KEY(wallet.address), '1');
    }
    sessionStorage.removeItem(BACKUP_MNEMONIC_KEY);
    setShowBackup(false);
  };

  const handleDismissBackup = () => {
    // User confirmed they saved it — clear the skipped flag permanently
    if (wallet?.address) {
      localStorage.removeItem(BACKUP_SKIPPED_KEY(wallet.address));
    }
    sessionStorage.removeItem(BACKUP_MNEMONIC_KEY);
    setShowBackup(false);
  };

  const handleCopyMnemonic = async () => {
    if (!backupMnemonic) return;
    await navigator.clipboard.writeText(backupMnemonic);
    setBackupCopied(true);
    setTimeout(() => setBackupCopied(false), 2000);
  };

  const { data: referralCode } = useQuery<{ code: string; currentUses: number }>({
    queryKey: ['/api/referrals/codes', wallet?.address],
    queryFn: () => fetch(`/api/referrals/codes/${wallet?.address}`).then(r => r.json()),
    enabled: !!wallet?.address,
  });

  const referralLink = referralCode?.code
    ? `${window.location.origin}/create-wallet?ref=${referralCode.code}`
    : null;

  const copyReferralLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      toast({ title: "Referral link copied!", description: "Share it to earn tokens for every friend who joins." });
    });
  };

  const [positions, setPositions] = useState<HedgePositionData[]>([]);
  const [deposits, setDeposits] = useState<HedgeLpDepositData[]>([]);
  const [events, setEvents] = useState<HedgeEventData[]>([]);
  const [hedgeLoading, setHedgeLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllRates, setShowAllRates] = useState(false);

  const { data: fxData } = useQuery<{ rates: Record<string, FXRate>; pairs: string[] }>({
    queryKey: ["/api/fx/rates"],
    refetchInterval: 5 * 60 * 1000,
  });

  const loadHedgeData = async () => {
    if (!wallet?.address) { setHedgeLoading(false); return; }
    try {
      const [pos, dep, ev] = await Promise.all([
        hedgeContract.getPositionsByWallet(wallet.address),
        hedgeContract.getDepositsByWallet(wallet.address),
        hedgeContract.getAllEvents(),
      ]);
      setPositions(pos);
      setDeposits(dep);
      setEvents(ev);
    } catch (error) {
      console.error('Failed to load hedge data:', error);
    } finally {
      setHedgeLoading(false);
    }
  };

  useEffect(() => { loadHedgeData(); }, [wallet?.address]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadHedgeData();
    setRefreshing(false);
  };

  useEffect(() => {
    if (!isLoading) {
      if (!walletExists()) {
        setLocation('/wallet');
      } else if (!isUnlocked) {
        setLocation('/unlock-wallet');
      }
    }
  }, [isUnlocked, walletExists, isLoading, setLocation]);

  const activePositions = useMemo(() => positions.filter(p => p.status === 'active' || p.status === 'claimable'), [positions]);
  const claimablePositions = useMemo(() => positions.filter(p => p.status === 'claimable'), [positions]);
  const activeDeposits = useMemo(() => deposits.filter(d => !d.withdrawn), [deposits]);
  const unclaimedPremiums = useMemo(() => activeDeposits.reduce((sum, d) => sum + (d.premiumsEarned - d.premiumsClaimed), 0), [activeDeposits]);
  const totalHedgeExposure = useMemo(() => activePositions.reduce((sum, p) => sum + p.notional, 0), [activePositions]);
  const totalLpDeposited = useMemo(() => activeDeposits.reduce((sum, d) => sum + d.amount, 0), [activeDeposits]);
  const totalClaimablePayout = useMemo(() => claimablePositions.reduce((sum, p) => sum + p.payoutAmount, 0), [claimablePositions]);

  const openEvents = useMemo(() => events.filter(e => e.status === 'open'), [events]);
  const expiringEvents = useMemo(() => {
    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    return openEvents.filter(e => e.expiryDate.getTime() - now < threeDays && e.expiryDate.getTime() > now);
  }, [openEvents]);

  const alerts = useMemo(() => {
    const items: { type: 'warning' | 'success' | 'info'; message: string; action?: () => void; actionLabel?: string }[] = [];
    if (claimablePositions.length > 0) {
      items.push({
        type: 'success',
        message: `${claimablePositions.length} hedge payout${claimablePositions.length > 1 ? 's' : ''} ready to claim`,
        action: () => setLocation('/hedge'),
        actionLabel: 'Claim',
      });
    }
    if (unclaimedPremiums > 0.01) {
      items.push({
        type: 'success',
        message: `$${unclaimedPremiums.toFixed(2)} in unclaimed LP premiums`,
        action: () => setLocation('/hedge'),
        actionLabel: 'Collect',
      });
    }
    if (expiringEvents.length > 0) {
      const myExpiringPositions = activePositions.filter(p => expiringEvents.some(e => e.id === p.eventId));
      if (myExpiringPositions.length > 0) {
        items.push({
          type: 'warning',
          message: `${myExpiringPositions.length} hedge position${myExpiringPositions.length > 1 ? 's' : ''} expiring within 3 days`,
          action: () => setLocation('/hedge'),
          actionLabel: 'View',
        });
      }
    }
    if (openEvents.length > 0 && activePositions.length === 0 && activeDeposits.length === 0) {
      items.push({
        type: 'info',
        message: `${openEvents.length} active hedge event${openEvents.length > 1 ? 's' : ''} available`,
        action: () => setLocation('/hedge'),
        actionLabel: 'Explore',
      });
    }
    return items;
  }, [claimablePositions, unclaimedPremiums, expiringEvents, activePositions, activeDeposits, openEvents, setLocation]);

  const recentActivity = useMemo(() => {
    const items: { type: string; description: string; amount: string; date: Date | null; pair?: string }[] = [];
    positions.slice(0, 5).forEach(p => {
      const ev = events.find(e => e.id === p.eventId);
      items.push({
        type: 'hedge',
        description: `Bought ${ev?.underlying || 'FX'} protection`,
        amount: `$${p.notional.toFixed(2)}`,
        date: p.createdAt,
        pair: ev?.underlying,
      });
    });
    deposits.slice(0, 5).forEach(d => {
      const ev = events.find(e => e.id === d.eventId);
      items.push({
        type: 'deposit',
        description: `LP deposit to ${ev?.name || 'pool'}`,
        amount: `$${d.amount.toFixed(2)}`,
        date: d.createdAt,
        pair: ev?.underlying,
      });
    });
    return items.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0)).slice(0, 6);
  }, [positions, deposits, events]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <img src={logoPath} alt="BlockFinaX Logo" className="w-24 h-16 object-contain mx-auto mb-4" />
          <div className="text-lg font-semibold mb-2">Loading BlockFinaX...</div>
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

      {/* Seed phrase backup reminder — shown once right after wallet creation */}
      <Dialog open={showBackup} onOpenChange={(open) => { if (!open) handleSkipBackup(); }}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <div className="h-12 w-12 rounded-full bg-amber-50 dark:bg-amber-950 flex items-center justify-center mx-auto mb-2">
              <Shield className="h-6 w-6 text-amber-500" />
            </div>
            <DialogTitle className="text-center">Back up your secret phrase</DialogTitle>
            <DialogDescription className="text-center">
              Write these 12 words down in order and keep them somewhere safe. They are the only way to recover your wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2 my-4">
            {(backupMnemonic || '').split(' ').map((word, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-muted rounded-lg px-2 py-2">
                <span className="text-[10px] text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                <span className="text-sm font-mono font-medium">{word}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="outline" className="w-full" onClick={handleCopyMnemonic}>
              <Copy className="h-4 w-4 mr-2" />
              {backupCopied ? 'Copied!' : 'Copy all words'}
            </Button>
            <Button className="w-full" onClick={handleDismissBackup}>
              I've saved my secret phrase
            </Button>
            <Button variant="ghost" className="w-full text-muted-foreground text-sm" onClick={handleSkipBackup}>
              Skip for now
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Persistent backup warning for users who skipped saving their secret phrase */}
      <BackupWarningBanner />

      <main className="flex-1 pb-20">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

          {/* Portfolio Overview */}
          <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-background border-primary/20">
            <CardContent className="pt-5 pb-4">
              <p className="text-sm text-muted-foreground mb-1">On-Platform Balance</p>
              {isLoadingBalance || hedgeLoading ? (
                <Skeleton className="h-9 w-40 mb-3" />
              ) : (
                <h2 className="text-3xl font-bold tracking-tight mb-3">
                  {formatCurrency(portfolioValue)}
                </h2>
              )}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-background/60 rounded-lg py-2 px-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Wallet</p>
                  <div className="text-sm font-semibold mt-0.5">
                    {isLoadingBalance ? <Skeleton className="h-4 w-12 mx-auto" /> : formatCurrency(totalValue)}
                  </div>
                </div>
                <div className="bg-background/60 rounded-lg py-2 px-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">LP Deposited</p>
                  <div className="text-sm font-semibold mt-0.5">
                    {hedgeLoading ? <Skeleton className="h-4 w-12 mx-auto" /> : `$${totalLpDeposited.toFixed(2)}`}
                  </div>
                </div>
                <div className={`bg-background/60 rounded-lg py-2 px-1 ${totalClaimablePayout > 0 ? 'ring-1 ring-emerald-400/50' : ''}`}>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Claimable</p>
                  <div className={`text-sm font-semibold mt-0.5 ${totalClaimablePayout > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                    {hedgeLoading ? <Skeleton className="h-4 w-12 mx-auto" /> : `$${totalClaimablePayout.toFixed(2)}`}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              className="flex flex-col items-center gap-1.5 h-auto py-3 hover:bg-primary/5 hover:border-primary/30"
              onClick={() => setLocation('/hedge')}
            >
              <Shield className="h-5 w-5 text-blue-600" />
              <span className="text-[11px] font-medium">Hedge</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col items-center gap-1.5 h-auto py-3 hover:bg-primary/5 hover:border-primary/30"
              onClick={() => setLocation('/hedge')}
            >
              <DollarSign className="h-5 w-5 text-amber-600" />
              <span className="text-[11px] font-medium">Earn LP</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col items-center gap-1.5 h-auto py-3 hover:bg-primary/5 hover:border-primary/30"
              onClick={copyReferralLink}
              disabled={!referralLink}
            >
              <Users className="h-5 w-5 text-emerald-500" />
              <span className="text-[11px] font-medium">Refer</span>
            </Button>
          </div>

          {/* Referral Banner */}
          {referralLink && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Invite friends, earn tokens</p>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 truncate">{referralLink}</p>
              </div>
              <Button size="sm" variant="outline" className="shrink-0 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 h-8 text-xs hover:bg-emerald-100 dark:hover:bg-emerald-900"
                onClick={copyReferralLink}>
                <Copy className="h-3.5 w-3.5 mr-1" /> Copy
              </Button>
            </div>
          )}

          {/* Alerts */}
          {alerts.length > 0 && (
            <div className="space-y-2">
              {alerts.map((alert, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    alert.type === 'success' ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800' :
                    alert.type === 'warning' ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800' :
                    'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {alert.type === 'success' ? <DollarSign className="h-4 w-4 text-green-600" /> :
                     alert.type === 'warning' ? <AlertTriangle className="h-4 w-4 text-amber-600" /> :
                     <Activity className="h-4 w-4 text-blue-600" />}
                    <span className="text-sm">{alert.message}</span>
                  </div>
                  {alert.action && (
                    <Button size="sm" variant="ghost" onClick={alert.action} className="text-xs h-7 px-2">
                      {alert.actionLabel} <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* FX Rates */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Live FX Rates
                </CardTitle>
                {fxData?.rates && Object.keys(fxData.rates).length > 6 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setShowAllRates(!showAllRates)}
                  >
                    {showAllRates ? 'Show Less' : `All Rates (${Object.keys(fxData.rates).length})`}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {fxData?.rates ? (() => {
                const PRIMARY_PAIRS = ['USD/GHS', 'USD/NGN', 'USD/KES', 'USD/ZAR', 'USD/XOF', 'EUR/GHS'];
                const entries = Object.entries(fxData.rates);
                const primaryEntries = entries.filter(([key, rate]) => PRIMARY_PAIRS.includes(rate.pair || key));
                const otherEntries = entries.filter(([key, rate]) => !PRIMARY_PAIRS.includes(rate.pair || key));
                const displayEntries = showAllRates ? [...primaryEntries, ...otherEntries] : primaryEntries;

                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {displayEntries.map(([key, rate]) => {
                      const pair = rate.pair || key;
                      const [base, quote] = pair.split('/');
                      const isPrimary = PRIMARY_PAIRS.includes(pair);
                      const change = rate.change24h;
                      const hasChange = change !== undefined && change !== null;
                      const isPositive = hasChange && change >= 0;
                      return (
                        <div
                          key={key}
                          className={`flex items-center justify-between p-2.5 rounded-lg transition-colors cursor-pointer ${
                            isPrimary
                              ? 'bg-primary/5 border border-primary/15 hover:bg-primary/10'
                              : 'bg-muted/50 hover:bg-muted/80'
                          }`}
                          onClick={() => setLocation('/hedge')}
                        >
                          <div>
                            <span className="text-xs font-medium">{base}/{quote}</span>
                            {hasChange && (
                              <div className={`flex items-center gap-0.5 mt-0.5 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                                {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                <span className="text-[10px] font-semibold">
                                  {isPositive ? '+' : ''}{change.toFixed(2)}%
                                </span>
                              </div>
                            )}
                            {!hasChange && (
                              <span className="text-[10px] text-muted-foreground mt-0.5 block">--</span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-semibold">{rate.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })() : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Hedge Overview + Activity side by side on desktop */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Hedge Summary */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Shield className="h-4 w-4 text-blue-600" />
                    Hedge Positions
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setLocation('/hedge')}>
                    View All <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {hedgeLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : activePositions.length === 0 && activeDeposits.length === 0 ? (
                  <div className="text-center py-6">
                    <Shield className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No active hedge positions</p>
                    <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={() => setLocation('/hedge')}>
                      Start Hedging
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activePositions.length > 0 && (
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                        <div>
                          <p className="text-xs text-muted-foreground">Active Hedges</p>
                          <p className="text-sm font-semibold">{activePositions.length} position{activePositions.length > 1 ? 's' : ''}</p>
                        </div>
                        <p className="text-sm font-bold">${totalHedgeExposure.toFixed(2)}</p>
                      </div>
                    )}
                    {activeDeposits.length > 0 && (
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                        <div>
                          <p className="text-xs text-muted-foreground">LP Deposits</p>
                          <p className="text-sm font-semibold">{activeDeposits.length} deposit{activeDeposits.length > 1 ? 's' : ''}</p>
                        </div>
                        <p className="text-sm font-bold">${totalLpDeposited.toFixed(2)}</p>
                      </div>
                    )}
                    {unclaimedPremiums > 0.01 && (
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-green-50 dark:bg-green-950/30">
                        <div>
                          <p className="text-xs text-muted-foreground">Unclaimed Premiums</p>
                          <p className="text-sm font-semibold text-green-600">${unclaimedPremiums.toFixed(2)}</p>
                        </div>
                        <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setLocation('/hedge')}>
                          Claim
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    Recent Activity
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setLocation('/wallet?tab=history')}>
                    View All <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {hedgeLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : recentActivity.length === 0 ? (
                  <div className="text-center py-6">
                    <Activity className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No recent activity</p>
                    <p className="text-xs text-muted-foreground mt-1">Your hedge and LP transactions will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {recentActivity.map((item, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-2.5">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                            item.type === 'hedge' ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-amber-100 dark:bg-amber-900/40'
                          }`}>
                            {item.type === 'hedge' ?
                              <Shield className="h-4 w-4 text-blue-600" /> :
                              <DollarSign className="h-4 w-4 text-amber-600" />
                            }
                          </div>
                          <div>
                            <p className="text-xs font-medium">{item.description}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {item.date ? item.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                              {item.pair && ` · ${item.pair}`}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs font-semibold">{item.amount}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Market Snapshot */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                  Hedge Market
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  {openEvents.length} Active Event{openEvents.length !== 1 ? 's' : ''}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {hedgeLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : openEvents.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">No active hedge events right now</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {openEvents.slice(0, 3).map(event => {
                    const currentRate = fxData?.rates?.[event.underlying]?.rate;
                    const daysLeft = Math.max(0, Math.ceil((event.expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
                    return (
                      <div
                        key={event.id}
                        className="flex items-center justify-between p-3 rounded-lg border hover:border-primary/30 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => setLocation(`/hedge?event=${event.id}`)}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{event.name}</span>
                            {daysLeft <= 3 && (
                              <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-600">
                                <Clock className="h-3 w-3 mr-0.5" /> {daysLeft}d left
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                            <span>{event.underlying}</span>
                            <span>Strike: {event.strike.toLocaleString()}</span>
                            <span>Pool: ${event.totalLiquidity.toFixed(0)}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          {currentRate && (
                            <p className="text-sm font-semibold">
                              {currentRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground">
                            {Math.round(event.utilization * 100)}% utilized
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {openEvents.length > 3 && (
                    <Button variant="ghost" className="w-full text-xs h-8" onClick={() => setLocation('/hedge')}>
                      View all {openEvents.length} events <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Bottom Navigation */}
      <BottomNav />
    </div>
    </TermsGate>
  );
}
