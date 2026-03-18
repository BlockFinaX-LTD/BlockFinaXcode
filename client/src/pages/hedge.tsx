import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";

type AssetClass = 'all' | 'fx' | 'commodity' | 'crypto';

function getAssetClass(pair: string): 'fx' | 'commodity' | 'crypto' {
  const cryptoPairs = ['BTC/USD','ETH/USD','BNB/USD','SOL/USD','XRP/USD','ADA/USD'];
  const commodityPairs = ['XAU/USD','XAG/USD','XPT/USD','XPD/USD','XTI/USD','XBR/USD','XNG/USD','XCO/USD','XCF/USD','XWH/USD','XSG/USD'];
  if (cryptoPairs.includes(pair)) return 'crypto';
  if (commodityPairs.includes(pair)) return 'commodity';
  return 'fx';
}

const COMMODITY_NAMES: Record<string, string> = {
  'XAU/USD': 'Gold', 'XAG/USD': 'Silver', 'XPT/USD': 'Platinum', 'XPD/USD': 'Palladium',
  'XTI/USD': 'WTI Oil', 'XBR/USD': 'Brent Oil', 'XNG/USD': 'Nat. Gas',
  'XCO/USD': 'Cocoa', 'XCF/USD': 'Coffee', 'XWH/USD': 'Wheat', 'XSG/USD': 'Sugar',
};

const ASSET_CLASS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  fx: { label: 'FX', color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500/30' },
  commodity: { label: 'Commodity', color: 'text-amber-400', bg: 'bg-amber-500/20 border-amber-500/30' },
  crypto: { label: 'Crypto', color: 'text-purple-400', bg: 'bg-purple-500/20 border-purple-500/30' },
};
import { BottomNav } from '@/components/bottom-nav';
import { AppHeader } from '@/components/app-header';
import { useWallet } from "@/hooks/use-wallet";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Shield, TrendingUp, TrendingDown, DollarSign, Clock, AlertTriangle, CheckCircle2, 
  Plus, ArrowLeft, Wallet, BarChart3, Users, Lock, Unlock, Award,
  Activity, PieChart, RefreshCw, ChevronDown, ChevronUp, ToggleLeft, ToggleRight,
  LockKeyhole, Globe, Settings, Share2, ExternalLink
} from "lucide-react";
import { Link } from "wouter";
import { hedgeContract, type HedgeEventData, type HedgePositionData, type HedgeLpDepositData, type HedgeFeeConfig } from "@/lib/hedge-contract";
import { walletManager } from "@/lib/wallet";

function CountdownTimer({ expiryDate, className }: { expiryDate: Date; className?: string }) {
  const calc = () => {
    const ms = expiryDate.getTime() - Date.now();
    if (ms <= 0) return { label: 'Expired', urgent: true, warning: false };
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const label = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
    return { label, urgent: ms < 3600000, warning: ms < 86400000 };
  };
  const [tick, setTick] = useState(calc());
  useEffect(() => {
    const id = setInterval(() => setTick(calc()), 1000);
    return () => clearInterval(id);
  }, [expiryDate]);
  const color = tick.urgent ? 'text-red-400' : tick.warning ? 'text-amber-400' : 'text-foreground';
  return <span className={`font-mono tabular-nums ${color} ${className ?? ''}`}>{tick.label}</span>;
}

export default function Hedge() {
  const { wallet } = useWallet();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("hedger");
  const [assetClassFilter, setAssetClassFilter] = useState<AssetClass>('all');
  const [selectedEvent, setSelectedEvent] = useState<HedgeEventData | null>(null);
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [createEventDialogOpen, setCreateEventDialogOpen] = useState(false);
  const [notional, setNotional] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const [fxOracleOpen, setFxOracleOpen] = useState(false);
  const [ratesTab, setRatesTab] = useState<'fx' | 'commodity' | 'crypto'>('fx');
  const [creatorProfileOpen, setCreatorProfileOpen] = useState(false);
  const [viewingCreator, setViewingCreator] = useState("");
  const [durationOpen, setDurationOpen] = useState(false);
  const [customUnit, setCustomUnit] = useState<'hours' | 'days'>('hours');
  const [customValue, setCustomValue] = useState("");

  const shortenAddress = (addr: string) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  const getCreatorStats = (creatorAddr: string) => {
    const creatorEvents = events.filter(e => e.creator.toLowerCase() === creatorAddr.toLowerCase());
    const totalPremiums = creatorEvents.reduce((sum, e) => sum + e.totalPremiums, 0);
    const totalLiquidity = creatorEvents.reduce((sum, e) => sum + e.totalLiquidity, 0);
    const totalHedgers = creatorEvents.reduce((sum, e) => sum + e.hedgerCount, 0);
    const activeEvents = creatorEvents.filter(e => e.status === "open").length;
    const settledEvents = creatorEvents.filter(e => e.status === "settled" || e.status === "expired").length;
    const loyaltyEarnings = creatorEvents.reduce((sum, e) => sum + e.creatorEarnings, 0);
    return { creatorEvents, totalPremiums, totalLiquidity, totalHedgers, activeEvents, settledEvents, loyaltyEarnings };
  };

  const openCreatorProfile = (addr: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setViewingCreator(addr);
    setCreatorProfileOpen(true);
  };

  const [newEvent, setNewEvent] = useState({
    name: "", description: "", assetClass: "fx" as "fx" | "commodity" | "crypto",
    underlying: "USD/GHS", strike: "", premiumRate: "",
    expiryHours: "24", initialLiquidity: "", poolOpen: true, allowExternalLp: true,
    direction: "up" as "up" | "down"
  });

  const [events, setEvents] = useState<HedgeEventData[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [feeConfig, setFeeConfig] = useState<HedgeFeeConfig | null>(null);

  const loadEvents = async () => {
    try {
      setEventsLoading(true);
      const data = await hedgeContract.getAllEvents();
      setEvents(data);
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setEventsLoading(false);
    }
  };

  const loadFeeConfig = async () => {
    try {
      const config = await hedgeContract.getFeeConfig();
      setFeeConfig(config);
    } catch (error) {
      console.error('Failed to load fee config:', error);
    }
  };

  useEffect(() => { loadEvents(); loadFeeConfig(); }, []);

  const [myPositions, setMyPositions] = useState<HedgePositionData[]>([]);

  const loadPositions = async () => {
    if (!wallet?.address) return;
    try {
      const data = await hedgeContract.getPositionsByWallet(wallet.address);
      setMyPositions(data);
    } catch (error) {
      console.error('Failed to load positions:', error);
    }
  };

  useEffect(() => { if (wallet?.address) loadPositions(); }, [wallet?.address]);

  const [myDeposits, setMyDeposits] = useState<HedgeLpDepositData[]>([]);

  const loadDeposits = async () => {
    if (!wallet?.address) return;
    try {
      const data = await hedgeContract.getDepositsByWallet(wallet.address);
      setMyDeposits(data);
    } catch (error) {
      console.error('Failed to load deposits:', error);
    }
  };

  useEffect(() => { if (wallet?.address) loadDeposits(); }, [wallet?.address]);

  type FXRate = { pair: string; rate: number; source: string; timestamp: number; lastUpdated: string };
  const { data: fxData } = useQuery<{ rates: Record<string, FXRate>; pairs: string[] }>({
    queryKey: ["/api/fx/rates"],
    refetchInterval: 5 * 60 * 1000,
  });

  const fetchEventDetails = async (id: number) => {
    const data = await hedgeContract.getEvent(id);
    setSelectedEvent(data);
    return data;
  };

  useEffect(() => {
    if (eventsLoading || events.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("event");
    const action = params.get("action");
    if (!eventId) return;
    const id = parseInt(eventId);
    if (isNaN(id)) return;
    const event = events.find(e => e.id === id);
    if (!event) return;
    setSelectedEvent(event);
    if (action === "buy") {
      setActiveTab("hedger");
      setBuyDialogOpen(true);
    } else if (action === "lp") {
      setActiveTab("lp");
      setDepositDialogOpen(true);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [eventsLoading, events]);

  const copyShareLink = (eventId: number, action: "buy" | "lp") => {
    const url = `${window.location.origin}/hedge?event=${eventId}&action=${action}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: "Link copied!", description: `Share this ${action === "buy" ? "hedge" : "LP deposit"} link with others.` });
    }).catch(() => {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    });
  };

  const buyProtectionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEvent) throw new Error("No event selected");
      const signer = await walletManager.getSigner(2);
      if (!signer) throw new Error("Wallet signer not available. Please unlock your wallet.");
      await hedgeContract.buyProtection(signer, selectedEvent.id, notional);
    },
    onSuccess: async () => {
      await loadEvents();
      await loadPositions();
      if (selectedEvent) await fetchEventDetails(selectedEvent.id);
      toast({ title: "Protection Purchased", description: `Notional: $${parseFloat(notional).toLocaleString()} — on-chain transaction confirmed` });
      setBuyDialogOpen(false);
      setNotional("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to buy protection", variant: "destructive" });
    }
  });

  const depositMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEvent) throw new Error("No event selected");
      const signer = await walletManager.getSigner(2);
      if (!signer) throw new Error("Wallet signer not available. Please unlock your wallet.");
      await hedgeContract.deposit(signer, selectedEvent.id, depositAmount);
    },
    onSuccess: async () => {
      await loadEvents();
      await loadDeposits();
      if (selectedEvent) await fetchEventDetails(selectedEvent.id);
      toast({ title: "Liquidity Deposited", description: `$${parseFloat(depositAmount).toLocaleString()} USDC deposited on-chain` });
      setDepositDialogOpen(false);
      setDepositAmount("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to deposit", variant: "destructive" });
    }
  });

  const createEventMutation = useMutation({
    mutationFn: async () => {
      const signer = await walletManager.getSigner(2);
      if (!signer) throw new Error("Wallet signer not available. Please unlock your wallet.");
      const expiryDate = new Date();
      expiryDate.setTime(expiryDate.getTime() + Math.max(1, parseInt(newEvent.expiryHours)) * 60 * 60 * 1000);
      const currentFxRate = fxData?.rates[newEvent.underlying]?.rate;
      if (!currentFxRate) throw new Error("Cannot fetch current FX rate for " + newEvent.underlying);
      const strikePrice = parseFloat(newEvent.strike);
      const strikeAbove = newEvent.direction === "up";
      if (strikeAbove && strikePrice <= currentFxRate)
        throw new Error("Strike must be above the current rate (" + currentFxRate.toFixed(4) + ") for an upward hedge.");
      if (!strikeAbove && strikePrice >= currentFxRate)
        throw new Error("Strike must be below the current rate (" + currentFxRate.toFixed(4) + ") for a downward hedge.");
      await hedgeContract.createEvent(signer, {
        name: newEvent.name,
        underlying: newEvent.underlying,
        strike: strikePrice,
        premiumRate: parseFloat(newEvent.premiumRate) / 100,
        expiryDate,
        allowExternalLp: newEvent.allowExternalLp,
        initialLiquidity: newEvent.initialLiquidity || "0",
        initialRate: currentFxRate,
        strikeAbove,
      });

      if (newEvent.poolOpen) {
        await loadEvents();
        const total = await hedgeContract.getReadContract().getTotalHedgeEvents();
        const newEventId = Number(total);
        await hedgeContract.setPoolSettings(signer, newEventId, true, newEvent.allowExternalLp);
      }
    },
    onSuccess: async () => {
      await loadEvents();
      const msg = newEvent.poolOpen
        ? "Event created and pool is open for hedgers!"
        : "Event created. Go to My Events to open the pool when ready.";
      toast({ title: "Event Created", description: msg });
      setCreateEventDialogOpen(false);
      setActiveTab("my-events");
      setNewEvent({ name: "", description: "", assetClass: "fx", underlying: "USD/GHS", strike: "", premiumRate: "", expiryHours: "24", initialLiquidity: "", poolOpen: true, allowExternalLp: true, direction: "up" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create event", variant: "destructive" });
    }
  });

  const togglePoolMutation = useMutation({
    mutationFn: async ({ eventId, poolOpen, allowExternalLp }: { eventId: number; poolOpen?: boolean; allowExternalLp?: boolean }) => {
      const signer = await walletManager.getSigner(2);
      if (!signer) throw new Error("Wallet signer not available.");
      const event = events.find(e => e.id === eventId);
      await hedgeContract.setPoolSettings(
        signer,
        eventId,
        typeof poolOpen === "boolean" ? poolOpen : (event?.poolOpen ?? true),
        typeof allowExternalLp === "boolean" ? allowExternalLp : (event?.allowExternalLp ?? true)
      );
    },
    onSuccess: async () => {
      await loadEvents();
      toast({ title: "Updated", description: "Pool settings changed" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" });
    }
  });

  const claimMutation = useMutation({
    mutationFn: async (positionId: number) => {
      const signer = await walletManager.getSigner(2);
      if (!signer) throw new Error("Wallet signer not available.");
      await hedgeContract.claimPayout(signer, positionId);
    },
    onSuccess: async () => {
      await loadPositions();
      toast({ title: "Payout Claimed", description: "Funds have been sent to your wallet" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to claim", variant: "destructive" });
    }
  });

  const withdrawMutation = useMutation({
    mutationFn: async (depositId: number) => {
      const signer = await walletManager.getSigner(2);
      if (!signer) throw new Error("Wallet signer not available.");
      await hedgeContract.withdrawCapital(signer, depositId);
    },
    onSuccess: async () => {
      await loadDeposits();
      await loadEvents();
      toast({ title: "Liquidity Withdrawn", description: "Funds returned to your wallet" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to withdraw", variant: "destructive" });
    }
  });

  const claimPremiumsMutation = useMutation({
    mutationFn: async (depositId: number) => {
      const signer = await walletManager.getSigner(2);
      if (!signer) throw new Error("Wallet signer not available.");
      await hedgeContract.claimPremiums(signer, depositId);
    },
    onSuccess: async () => {
      await loadDeposits();
      toast({ title: "Premiums Claimed", description: "Premiums sent to your wallet" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to claim premiums", variant: "destructive" });
    }
  });

  if (!wallet) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="bg-card border-border max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <Shield className="h-16 w-16 text-primary mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">Wallet Required</h2>
            <p className="text-muted-foreground mb-4">Connect your wallet to access P2P Hedge</p>
            <Link href="/wallet">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Wallet className="h-4 w-4 mr-2" /> Go to Wallet
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const premiumCalc = selectedEvent && notional ? parseFloat(notional) * selectedEvent.premiumRate : 0;
  const hedgerFeeRate = feeConfig?.hedgerFeeRate || 0.005;
  const hedgerFeeCalc = notional ? parseFloat(notional) * hedgerFeeRate : 0;
  const totalCostCalc = premiumCalc + hedgerFeeCalc;
  const currentRate = selectedEvent ? fxData?.rates[selectedEvent.underlying]?.rate || 0 : 0;
  const payoutPercent = selectedEvent ? selectedEvent.payoutPercent : 0;
  const predeterminedPayout = selectedEvent && notional ? parseFloat(notional) * payoutPercent : 0;
  const netPredeterminedPayout = predeterminedPayout > 0 ? predeterminedPayout * 0.99 : 0;

  return (
    <div className="min-h-screen bg-muted/30 pb-20">
      <AppHeader
        title="P2P Trade Hedge"
        rightContent={
          <Button
            onClick={() => setCreateEventDialogOpen(true)}
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
          >
            <Plus className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Create Event</span>
          </Button>
        }
      />

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        <Collapsible open={statsOpen} onOpenChange={setStatsOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between px-4 py-3 bg-card rounded-xl border border-border hover:bg-accent/50 transition-colors">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">My Stats</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {myPositions.filter(p => p.status === "active").length} positions · ${myDeposits.filter(d => !d.withdrawn).reduce((s, d) => s + d.amount, 0).toLocaleString()} deposited
                </span>
                {statsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="h-3.5 w-3.5 text-green-400" />
                  <span className="text-[11px] text-muted-foreground">Active Events</span>
                </div>
                <p className="text-xl font-bold text-foreground">{events.filter(e => e.status === "open").length}</p>
              </div>
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] text-muted-foreground">My Positions</span>
                </div>
                <p className="text-xl font-bold text-foreground">{myPositions.filter(p => p.status === "active").length}</p>
              </div>
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] text-muted-foreground">LP Deposits</span>
                </div>
                <p className="text-xl font-bold text-foreground">
                  ${myDeposits.filter(d => !d.withdrawn).reduce((s, d) => s + d.amount, 0).toLocaleString()}
                </p>
              </div>
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Award className="h-3.5 w-3.5 text-purple-400" />
                  <span className="text-[11px] text-muted-foreground">Premiums Earned</span>
                </div>
                <p className="text-xl font-bold text-foreground">
                  ${myDeposits.reduce((s, d) => s + d.premiumsEarned, 0).toLocaleString()}
                </p>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {fxData && Object.keys(fxData.rates).length > 0 && (
          <Collapsible open={fxOracleOpen} onOpenChange={setFxOracleOpen}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between px-4 py-3 bg-card rounded-xl border border-border hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-green-400" />
                  <span className="text-sm font-semibold text-foreground">Live Market Rates</span>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                </div>
                {fxOracleOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {(() => {
                const RATE_TABS = [
                  { key: 'fx' as const, label: 'FX Pairs', activeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40', dotClass: 'bg-blue-400' },
                  { key: 'commodity' as const, label: 'Commodities', activeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40', dotClass: 'bg-amber-400' },
                  { key: 'crypto' as const, label: 'Crypto', activeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40', dotClass: 'bg-purple-400' },
                ];
                const grouped: Record<string, string[]> = { fx: [], commodity: [], crypto: [] };
                (fxData.pairsWithClass || []).forEach((p: { pair: string; assetClass: string }) => {
                  if (grouped[p.assetClass] && fxData.rates[p.pair]) grouped[p.assetClass].push(p.pair);
                });
                const formatRate = (rate: number) => {
                  if (rate >= 1000) return rate.toLocaleString('en-US', { maximumFractionDigits: 2 });
                  if (rate >= 1) return rate.toFixed(4);
                  return rate.toFixed(6);
                };
                const activePairs = grouped[ratesTab] || [];
                return (
                  <div className="mt-3">
                    <div className="flex gap-1.5 mb-3">
                      {RATE_TABS.map(tab => (
                        <button key={tab.key} onClick={() => setRatesTab(tab.key)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors flex-1 justify-center ${
                            ratesTab === tab.key ? tab.activeClass : 'bg-card text-muted-foreground border-border hover:bg-accent/50'
                          }`}>
                          {ratesTab === tab.key && <span className={`w-1.5 h-1.5 rounded-full ${tab.dotClass}`} />}
                          {tab.label}
                          <span className="opacity-60 font-normal">({grouped[tab.key]?.length ?? 0})</span>
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {activePairs.map(pair => {
                        const r = fxData.rates[pair];
                        const label = COMMODITY_NAMES[pair] || pair;
                        const chg = r.change24h;
                        const hasChange = typeof chg === 'number' && isFinite(chg);
                        const isUp = hasChange && chg! >= 0;
                        return (
                          <div key={pair} className="bg-card rounded-xl border border-border px-3 py-2.5">
                            <div className="text-[10px] text-muted-foreground/70 truncate">{label}</div>
                            <div className="flex items-baseline justify-between gap-1 mt-0.5">
                              <span className="text-xs font-bold text-foreground">{formatRate(r.rate)}</span>
                              {hasChange && (
                                <span className={`text-[10px] font-semibold shrink-0 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                  {isUp ? '+' : ''}{chg!.toFixed(2)}%
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              <p className="text-[10px] text-muted-foreground/60 mt-2 text-right">
                Rates updated · {new Date(Object.values(fxData.rates)[0]?.timestamp).toLocaleTimeString()}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">Asset Class:</span>
          <div className="flex gap-1.5 flex-wrap">
            {(['all', 'fx', 'commodity', 'crypto'] as AssetClass[]).map(cls => (
              <button key={cls} onClick={() => setAssetClassFilter(cls)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  assetClassFilter === cls
                    ? cls === 'all' ? 'bg-primary text-primary-foreground border-primary'
                      : cls === 'fx' ? 'bg-blue-500/30 text-blue-300 border-blue-500/50'
                      : cls === 'commodity' ? 'bg-amber-500/30 text-amber-300 border-amber-500/50'
                      : 'bg-purple-500/30 text-purple-300 border-purple-500/50'
                    : 'bg-card text-muted-foreground border-border hover:bg-accent/50'
                }`}>
                {cls === 'all' ? 'All' : cls === 'fx' ? 'FX' : cls === 'commodity' ? 'Commodities' : 'Crypto'}
              </button>
            ))}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-card border border-border w-full grid grid-cols-4 h-11">
            <TabsTrigger value="hedger" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs sm:text-sm">
              <Shield className="h-4 w-4 mr-1.5 shrink-0" /> <span className="hidden sm:inline">Buy Protection</span><span className="sm:hidden">Hedge</span>
            </TabsTrigger>
            <TabsTrigger value="provider" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs sm:text-sm">
              <TrendingUp className="h-4 w-4 mr-1.5 shrink-0" /> <span className="hidden sm:inline">Provide Liquidity</span><span className="sm:hidden">LP</span>
            </TabsTrigger>
            <TabsTrigger value="my-events" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs sm:text-sm">
              <Settings className="h-4 w-4 mr-1.5 shrink-0" /> <span className="hidden sm:inline">My Events</span><span className="sm:hidden">Events</span>
            </TabsTrigger>
            <TabsTrigger value="my-hedges" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs sm:text-sm">
              <BarChart3 className="h-4 w-4 mr-1.5 shrink-0" /> <span className="hidden sm:inline">My Position</span><span className="sm:hidden">Position</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="hedger" className="space-y-3">
            {eventsLoading ? (
              <div className="text-center py-16 text-muted-foreground">Loading events...</div>
            ) : events.filter(e => e.status === "open" && e.creator.toLowerCase() !== (wallet?.address || "").toLowerCase() && (assetClassFilter === 'all' || getAssetClass(e.underlying) === assetClassFilter)).length === 0 ? (
              <div className="text-center py-16">
                <Shield className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">No active {assetClassFilter !== 'all' ? assetClassFilter : ''} protection events</p>
                <p className="text-muted-foreground/70 text-sm mt-1">Create an event to get started</p>
              </div>
            ) : events.filter(e => e.status === "open" && e.creator.toLowerCase() !== (wallet?.address || "").toLowerCase() && (assetClassFilter === 'all' || getAssetClass(e.underlying) === assetClassFilter)).map(event => (
              <Card key={event.id} className="bg-card border-border hover:border-primary/50 transition-colors cursor-pointer overflow-hidden"
                onClick={async () => { await fetchEventDetails(event.id); setBuyDialogOpen(true); }}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{event.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{event.underlying} Protection</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge className={`text-[10px] border ${ASSET_CLASS_LABELS[getAssetClass(event.underlying)].bg} ${ASSET_CLASS_LABELS[getAssetClass(event.underlying)].color}`}>
                        {ASSET_CLASS_LABELS[getAssetClass(event.underlying)].label}
                      </Badge>
                      <Badge className={`text-[10px] border flex items-center gap-0.5 ${event.strikeAbove ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}`}>
                        {event.strikeAbove ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                        {event.strikeAbove ? "Upward" : "Downward"}
                      </Badge>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary"
                        onClick={(e) => { e.stopPropagation(); copyShareLink(event.id, "buy"); }}
                        title="Share hedge link">
                        <Share2 className="h-3.5 w-3.5" />
                      </Button>
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">Open</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-muted-foreground/70">Strike</p>
                      <p className="text-xs font-bold text-foreground">{event.strike.toFixed(2)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-muted-foreground/70">Premium</p>
                      <p className="text-xs font-bold text-primary">{(event.premiumRate * 100).toFixed(1)}%</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-muted-foreground/70">Now</p>
                      <p className="text-xs font-bold text-foreground">
                        {fxData?.rates[event.underlying]?.rate.toFixed(2) || "—"}
                      </p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-muted-foreground/70">Expires In</p>
                      <p className="text-xs font-bold"><CountdownTimer expiryDate={event.expiryDate} /></p>
                    </div>
                  </div>

                  {fxData?.rates[event.underlying] && (() => {
                    const spot = fxData.rates[event.underlying].rate;
                    const isTouched = event.strikeAbove ? spot >= event.strike : spot <= event.strike;
                    return (
                      <div className={`rounded-lg px-3 py-2 flex items-center justify-between ${isTouched ? "bg-red-500/10 border border-red-500/20" : "bg-green-500/10 border border-green-500/20"}`}>
                        <div className="flex items-center gap-1.5">
                          <Activity className="h-3 w-3 text-green-400" />
                          <span className="text-xs text-muted-foreground">Spot:</span>
                          <span className="text-xs font-bold text-foreground">{spot.toFixed(4)}</span>
                        </div>
                        <span className={`text-[10px] font-bold ${isTouched ? "text-red-400" : "text-green-400"}`}>
                          {isTouched ? "TOUCHED — SETTLING" : "Monitoring"}
                        </span>
                      </div>
                    );
                  })()}

                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      Pool: <span className="font-semibold text-primary">${event.totalLiquidity.toLocaleString()}</span>
                      <span className="mx-1.5">·</span>
                      Available: <span className="font-semibold text-green-400">${event.availableCapacity.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!event.poolOpen && <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0">Closed</Badge>}
                      {!event.allowExternalLp && <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1.5 py-0">Private</Badge>}
                    </div>
                  </div>

                  {event.creator && (
                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <button onClick={(e) => openCreatorProfile(event.creator, e)}
                        className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        by {shortenAddress(event.creator)}
                      </button>
                    </div>
                  )}

                  {event.poolOpen ? (
                    <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-10"
                      onClick={async (e) => { e.stopPropagation(); await fetchEventDetails(event.id); setBuyDialogOpen(true); }}>
                      Buy Protection
                    </Button>
                  ) : (
                    <Button className="w-full bg-muted text-muted-foreground font-semibold h-10" disabled>
                      Pool Closed
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="provider" className="space-y-3">
            {eventsLoading ? (
              <div className="text-center py-16 text-muted-foreground">Loading events...</div>
            ) : events.filter(e => e.status === "open" && (assetClassFilter === 'all' || getAssetClass(e.underlying) === assetClassFilter)).length === 0 ? (
              <div className="text-center py-16">
                <TrendingUp className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">No pools available</p>
              </div>
            ) : events.filter(e => e.status === "open" && (assetClassFilter === 'all' || getAssetClass(e.underlying) === assetClassFilter)).map(event => (
              <Card key={event.id} className={`bg-card border-border hover:border-primary/50 transition-colors cursor-pointer ${wallet?.address?.toLowerCase() === event.creator.toLowerCase() ? 'ring-1 ring-primary/30' : ''}`}
                onClick={async () => {
                  const isCreator = wallet?.address?.toLowerCase() === event.creator.toLowerCase();
                  if (!event.allowExternalLp && !isCreator) return;
                  await fetchEventDetails(event.id); setDepositDialogOpen(true);
                }}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{event.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Earn premiums · {event.underlying}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {wallet?.address?.toLowerCase() === event.creator.toLowerCase() && (
                        <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] px-1.5 py-0">Your Pool</Badge>
                      )}
                      <Badge className={`text-[10px] border ${ASSET_CLASS_LABELS[getAssetClass(event.underlying)].bg} ${ASSET_CLASS_LABELS[getAssetClass(event.underlying)].color}`}>
                        {ASSET_CLASS_LABELS[getAssetClass(event.underlying)].label}
                      </Badge>
                      {event.allowExternalLp && (
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary"
                          onClick={(e) => { e.stopPropagation(); copyShareLink(event.id, "lp"); }}
                          title="Share LP deposit link">
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {!event.allowExternalLp && wallet?.address?.toLowerCase() !== event.creator.toLowerCase() && (
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1.5 py-0">Private</Badge>
                      )}
                      <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">
                        {event.poolOpen ? "Open" : "Closed"}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-muted-foreground/70">Earn</p>
                      <p className="text-xs font-bold text-green-400">{(event.premiumRate * 100).toFixed(1)}%</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-muted-foreground/70">Strike</p>
                      <p className="text-xs font-bold text-foreground">{event.strike.toFixed(2)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-muted-foreground/70">Expires In</p>
                      <p className="text-xs font-bold"><CountdownTimer expiryDate={event.expiryDate} /></p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Pool: <span className="font-semibold text-primary">${event.totalLiquidity.toLocaleString()}</span></span>
                    <span>LPs: {event.lpCount} · Hedgers: {event.hedgerCount}</span>
                  </div>

                  {event.creator && (
                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <button onClick={(e) => openCreatorProfile(event.creator, e)}
                        className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        by {shortenAddress(event.creator)}
                      </button>
                    </div>
                  )}

                  {(() => {
                    const isCreator = wallet?.address?.toLowerCase() === event.creator.toLowerCase();
                    if (isCreator) {
                      return (
                        <Button
                          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-10"
                          onClick={async (e) => { e.stopPropagation(); await fetchEventDetails(event.id); setDepositDialogOpen(true); }}
                        >
                          <DollarSign className="h-4 w-4 mr-1" /> Add to My Pool
                        </Button>
                      );
                    }
                    if (!event.allowExternalLp) {
                      return (
                        <Button className="w-full bg-muted text-muted-foreground font-semibold h-10" disabled>
                          <LockKeyhole className="h-4 w-4 mr-1" /> Private Pool
                        </Button>
                      );
                    }
                    return (
                      <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-10"
                        onClick={async (e) => { e.stopPropagation(); await fetchEventDetails(event.id); setDepositDialogOpen(true); }}>
                        <DollarSign className="h-4 w-4 mr-1" /> Deposit Liquidity
                      </Button>
                    );
                  })()}
                </CardContent>
              </Card>
            ))}

            {myDeposits.length > 0 && (
              <Collapsible defaultOpen>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between px-4 py-3 bg-card rounded-xl border border-border hover:bg-accent/50 transition-colors mt-2">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">My LP Deposits ({myDeposits.length})</span>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-3 mt-3">
                    {myDeposits.map(dep => {
                      const earned = dep.premiumsEarned;
                      const claimed = dep.premiumsClaimed;
                      const claimable = earned - claimed;
                      const depEvent = events.find(e => e.id === dep.eventId);
                      const isEventOpen = depEvent?.status === "open";
                      return (
                        <Card key={dep.id} className="bg-card border-border">
                          <CardContent className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm text-foreground font-medium">Event #{dep.eventId}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  ${dep.amount.toLocaleString()} deposited · {depEvent && depEvent.totalLiquidity > 0 ? ((dep.amount / depEvent.totalLiquidity) * 100).toFixed(2) : '0.00'}% of pool
                                </p>
                              </div>
                              {dep.withdrawn ? (
                                <Badge variant="secondary" className="text-[10px]">Withdrawn</Badge>
                              ) : isEventOpen ? (
                                <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 text-[10px]">
                                  <Lock className="h-2.5 w-2.5 mr-0.5" /> Locked
                                </Badge>
                              ) : (
                                <Button size="sm" variant="outline" className="text-xs h-7"
                                  onClick={() => withdrawMutation.mutate(dep.id)}
                                  disabled={withdrawMutation.isPending}>
                                  <Unlock className="h-3 w-3 mr-1" /> Withdraw
                                </Button>
                              )}
                            </div>

                            {(earned > 0 || claimable > 0) && (
                              <div className="bg-muted/50 rounded-lg px-3 py-2 space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <div className="text-xs">
                                    <span className="text-muted-foreground">Earned: </span>
                                    <span className="text-green-400 font-medium">${earned.toFixed(2)}</span>
                                    {claimable > 0 && (
                                      <span className="text-primary font-medium ml-2">· Claimable: ${claimable.toFixed(2)}</span>
                                    )}
                                  </div>
                                  {claimable > 0 && (
                                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs"
                                      onClick={() => claimPremiumsMutation.mutate(dep.id)}
                                      disabled={claimPremiumsMutation.isPending}>
                                      {claimPremiumsMutation.isPending ? "..." : `Claim`}
                                    </Button>
                                  )}
                                </div>
                                {claimable > 0 && (
                                  <div className="text-[10px] text-muted-foreground/70 flex justify-between">
                                    <span>{feeConfig ? (feeConfig.lpProfitFeeRate * 100).toFixed(0) : "1"}% profit fee: ${(claimable * (feeConfig?.lpProfitFeeRate || 0.01)).toFixed(4)}</span>
                                    <span>You receive: ${(claimable * (1 - (feeConfig?.lpProfitFeeRate || 0.01))).toFixed(2)}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </TabsContent>

          <TabsContent value="my-events" className="space-y-3">
            {events.filter(e => e.creator.toLowerCase() === wallet?.address?.toLowerCase()).length === 0 ? (
              <div className="text-center py-16">
                <Settings className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">No events created</p>
                <p className="text-muted-foreground/70 text-sm mt-1">Create an event to start earning premiums</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const myEvents = events.filter(e => e.creator.toLowerCase() === wallet?.address?.toLowerCase());
                  const totalPremiums = myEvents.reduce((sum, e) => sum + e.totalPremiums, 0);
                  const totalLoyalty = myEvents.reduce((sum, e) => sum + e.creatorEarnings, 0);
                  return (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-muted/50 rounded-xl p-3 text-center border border-border">
                        <p className="text-[10px] text-muted-foreground/70">Pool Premiums Earned</p>
                        <p className="text-lg font-bold text-green-400">${totalPremiums.toFixed(2)}</p>
                      </div>
                      <div className="bg-muted/50 rounded-xl p-3 text-center border border-border">
                        <p className="text-[10px] text-muted-foreground/70">Creator's Earnings</p>
                        <p className="text-lg font-bold text-amber-400">${totalLoyalty.toFixed(2)}</p>
                      </div>
                    </div>
                  );
                })()}
                {events.filter(e => e.creator.toLowerCase() === wallet?.address?.toLowerCase()).map(event => (
                  <Card key={event.id} className="bg-card border-border">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{event.name}</p>
                          <p className="text-[11px] text-muted-foreground">{event.underlying} · Strike: {event.strike.toFixed(2)}</p>
                        </div>
                        <Badge className={event.status === "open" ? "bg-green-500/20 text-green-400 border-green-500/30 text-[10px]" : event.status === "settled" ? "bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]" : "bg-muted/50 text-muted-foreground border-border text-[10px]"}>
                          {event.status === "open" ? "Active" : event.status}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div className="bg-muted/40 rounded-lg px-2 py-1.5">
                          <span className="text-[10px] text-muted-foreground/70">Pool</span>
                          <p className="text-xs font-bold text-foreground">${event.totalLiquidity.toLocaleString()}</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg px-2 py-1.5">
                          <span className="text-[10px] text-muted-foreground/70">Available</span>
                          <p className="text-xs font-bold text-green-400">${event.availableCapacity.toLocaleString()}</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg px-2 py-1.5">
                          <span className="text-[10px] text-muted-foreground/70">Hedgers</span>
                          <p className="text-xs font-bold text-foreground">{event.hedgerCount}</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg px-2 py-1.5">
                          <span className="text-[10px] text-muted-foreground/70">Premiums</span>
                          <p className="text-xs font-bold text-green-400">${event.totalPremiums.toFixed(2)}</p>
                        </div>
                      </div>
                      {event.status === "open" && (
                        <div className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-1.5 border border-border/40">
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Pool expires in</span>
                          <CountdownTimer expiryDate={event.expiryDate} className="text-[10px]" />
                        </div>
                      )}
                      {event.status === "open" && (
                        <div className="space-y-2 bg-muted/20 rounded-lg p-2.5 border border-border/50">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              {event.poolOpen ? <Unlock className="h-3 w-3 text-green-400" /> : <Lock className="h-3 w-3 text-red-400" />}
                              Open to Hedgers
                            </span>
                            <Switch checked={event.poolOpen ?? true}
                              onCheckedChange={v => { togglePoolMutation.mutate({ eventId: event.id, poolOpen: v }); }}
                              disabled={togglePoolMutation.isPending} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              {event.allowExternalLp ? <Globe className="h-3 w-3 text-blue-400" /> : <LockKeyhole className="h-3 w-3 text-amber-400" />}
                              Allow Other LPs
                            </span>
                            <Switch checked={event.allowExternalLp ?? true}
                              onCheckedChange={v => { togglePoolMutation.mutate({ eventId: event.id, allowExternalLp: v }); }}
                              disabled={togglePoolMutation.isPending} />
                          </div>
                        </div>
                      )}
                      {event.status === "open" && (
                        <Button
                          className="w-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 font-semibold h-9 text-sm"
                          variant="outline"
                          onClick={async () => { await fetchEventDetails(event.id); setDepositDialogOpen(true); }}
                        >
                          <DollarSign className="h-4 w-4 mr-1.5" /> Add Liquidity to My Pool
                        </Button>
                      )}
                      {(event.status === "settled" || event.status === "expired") && (
                        <div className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                          <span className="text-xs text-muted-foreground">
                            Settlement: {event.settlementPrice ? event.settlementPrice.toFixed(2) : "Pending"}
                          </span>
                          <Badge className={event.triggered ? "bg-red-500/20 text-red-400 text-[10px]" : "bg-muted/50 text-muted-foreground text-[10px]"}>
                            {event.triggered ? "Triggered" : "Not Triggered"}
                          </Badge>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="my-hedges" className="space-y-3">
            {myPositions.length === 0 ? (
              <div className="text-center py-16">
                <Shield className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">No positions yet</p>
                <p className="text-muted-foreground/70 text-sm mt-1">Buy protection on the Hedge tab to open a position</p>
              </div>
            ) : (
              <div className="space-y-3">
                {myPositions.filter(p => p.status === "active").length > 0 && (
                  <div className="flex items-center gap-2 px-1">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Positions</span>
                  </div>
                )}

                {myPositions.map(pos => {
                  const event = events.find(e => e.id === pos.eventId);

                  const notionalNum = pos.notional;
                  const strikeNum = event ? event.strike : 0;
                  const currentRate = event && fxData?.rates?.[event.underlying]?.rate || 0;
                  const grossPayout = pos.payoutAmount;
                  const estNetPayout = grossPayout > 0 ? grossPayout * 0.99 : 0;
                  const hasPayout = grossPayout > 0;

                  return (
                    <Card key={pos.id} className="bg-card border-border">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-semibold text-foreground">#{pos.id}</span>
                            {event && <span className="text-[10px] text-muted-foreground truncate">{event.underlying} · {event.name}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {pos.status === "active" && event && (
                              <CountdownTimer expiryDate={event.expiryDate} className="text-[10px]" />
                            )}
                            {pos.status === "settled_win" && (
                              <span className="text-[10px] font-medium text-green-400">Payout ready</span>
                            )}
                            <Badge className={
                              pos.status === "active" ? "bg-green-500/20 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0" :
                              pos.status === "settled_win" ? "bg-primary/20 text-primary border-primary/30 text-[10px] px-1.5 py-0" :
                              pos.status === "claimed" ? "bg-primary/20 text-primary border-primary/30 text-[10px] px-1.5 py-0" :
                              "bg-muted/50 text-muted-foreground border-border text-[10px] px-1.5 py-0"
                            }>
                              {pos.status === "active" ? "Active" :
                               pos.status === "settled_win" ? "Won" :
                               pos.status === "expired" ? "Lost" :
                               pos.status === "claimed" ? "Claimed" : pos.status}
                            </Badge>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="bg-muted/40 rounded-lg px-2 py-1.5">
                            <span className="text-[10px] text-muted-foreground/70">Notional</span>
                            <p className="text-xs font-bold text-foreground">${notionalNum.toLocaleString()}</p>
                          </div>
                          <div className="bg-muted/40 rounded-lg px-2 py-1.5">
                            <span className="text-[10px] text-muted-foreground/70">Premium Paid</span>
                            <p className="text-xs font-bold text-primary">${pos.premiumPaid.toFixed(2)}</p>
                          </div>
                          <div className="bg-muted/40 rounded-lg px-2 py-1.5">
                            <span className="text-[10px] text-muted-foreground/70">Strike</span>
                            <p className="text-xs font-bold text-foreground">{strikeNum.toFixed(2)}</p>
                          </div>
                        </div>

                        {pos.status === "active" && event && (
                          <div className={`rounded-lg p-2.5 border ${hasPayout ? "bg-green-500/5 border-green-500/20" : "bg-muted/20 border-border/50"}`}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] text-muted-foreground">Current Rate</span>
                              <span className="text-xs font-bold text-foreground">{currentRate > 0 ? currentRate.toFixed(4) : "Loading..."}</span>
                            </div>
                            <div className="flex items-center justify-between pt-1 border-t border-border/30">
                              <span className="text-[10px] text-muted-foreground">Predetermined Payout</span>
                              <span className={`text-sm font-bold ${hasPayout ? "text-green-400" : "text-muted-foreground"}`}>
                                ${grossPayout > 0 ? grossPayout.toFixed(2) : "0.00"}
                                <span className="text-[10px] text-muted-foreground ml-1">(net ${estNetPayout.toFixed(2)})</span>
                              </span>
                            </div>
                          </div>
                        )}

                        {(pos.status === "settled_win" || pos.status === "claimable" || pos.status === "claimed") && hasPayout && (
                          <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">{pos.status === "claimed" ? "Claimed Payout" : "Payout Ready"}</span>
                              <span className="text-sm font-bold text-green-400">${grossPayout.toFixed(2)}</span>
                            </div>
                          </div>
                        )}

                        {pos.status === "expired" && (
                          <div className="bg-muted/20 border border-border/50 rounded-lg p-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">Payout</span>
                              <span className="text-[10px] text-muted-foreground">$0.00 — rate stayed below strike</span>
                            </div>
                          </div>
                        )}
                        {pos.status === "settled_win" && !pos.claimed && (() => {
                          const gross = pos.payoutAmount;
                          const payoutFeeRate = feeConfig?.hedgerPayoutFeeRate || 0.01;
                          const fee = gross * payoutFeeRate;
                          const net = gross - fee;
                          return (
                            <div className="space-y-1.5">
                              <div className="text-[10px] text-muted-foreground/70 flex justify-between px-1">
                                <span>Payout: ${gross.toFixed(2)} · Fee ({(payoutFeeRate * 100).toFixed(0)}%): ${fee.toFixed(4)}</span>
                                <span>You receive: ${net.toFixed(2)}</span>
                              </div>
                              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                                onClick={() => claimMutation.mutate(pos.id)}
                                disabled={claimMutation.isPending}>
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                Claim ${net.toFixed(2)}
                              </Button>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>
                  );
                })}

                {myPositions.filter(p => p.status !== "active").length > 0 && (
                  <>
                    <div className="flex items-center gap-2 px-1 pt-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">History</span>
                    </div>
                    {myPositions.filter(p => p.status !== "active").map(pos => {
                      const event = events.find(e => e.id === pos.eventId);
                      const triggered = pos.status === "settled_win" || pos.status === "claimed";
                      return (
                        <Card key={`hist-${pos.id}`} className="bg-card border-border opacity-80">
                          <CardContent className="p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-xs font-semibold text-foreground">#{pos.id} · {event?.underlying || `Event #${pos.eventId}`}</p>
                                <p className="text-[11px] text-muted-foreground">{event?.name}</p>
                              </div>
                              <Badge className={triggered
                                ? "bg-green-500/20 text-green-400 border-green-500/30 text-[10px]"
                                : "bg-muted/50 text-muted-foreground border-border text-[10px]"}>
                                {triggered ? "Triggered" : "Expired"}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center">
                              <div className="bg-muted/40 rounded-lg px-2 py-1.5">
                                <span className="text-[10px] text-muted-foreground/70">Notional</span>
                                <p className="text-xs font-bold text-foreground">${pos.notional.toLocaleString()}</p>
                              </div>
                              <div className="bg-muted/40 rounded-lg px-2 py-1.5">
                                <span className="text-[10px] text-muted-foreground/70">Premium Paid</span>
                                <p className="text-xs font-bold text-muted-foreground">${pos.premiumPaid.toFixed(2)}</p>
                              </div>
                              <div className="bg-muted/40 rounded-lg px-2 py-1.5">
                                <span className="text-[10px] text-muted-foreground/70">{triggered ? "Payout" : "Result"}</span>
                                <p className={`text-xs font-bold ${triggered ? "text-green-400" : "text-muted-foreground"}`}>
                                  {triggered ? `$${pos.payoutAmount.toFixed(2)}` : "$0.00"}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={buyDialogOpen} onOpenChange={setBuyDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-[450px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Buy FX Protection
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {selectedEvent?.name} — {selectedEvent?.underlying}
            </DialogDescription>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground/70">Strike Price</p>
                  <p className="text-lg font-bold text-foreground">{selectedEvent.strike.toFixed(2)}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground/70">Expires In</p>
                  <p className="text-lg font-bold"><CountdownTimer expiryDate={selectedEvent.expiryDate} /></p>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Pool Utilization</span>
                  <span>{(selectedEvent.utilization * 100).toFixed(1)}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-primary h-2 rounded-full" style={{ width: `${Math.min(selectedEvent.utilization * 100, 100)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Available: ${selectedEvent.availableCapacity.toLocaleString()}
                </p>
              </div>

              <div>
                <Label className="text-muted-foreground">Coverage Amount (USD)</Label>
                <Input
                  type="number" min="10" step="1" placeholder="e.g. 100"
                  value={notional} onChange={e => setNotional(e.target.value)}
                  className="bg-muted border-border text-foreground mt-1"
                />
              </div>

              {notional && parseFloat(notional) >= 10 && (
                <div className="bg-muted/50 border border-border rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-foreground">Cost Breakdown</p>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Coverage Amount</span>
                    <span className="text-sm font-medium text-foreground">${parseFloat(notional).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Premium ({(selectedEvent.premiumRate * 100).toFixed(1)}%)</span>
                    <span className="text-sm font-medium text-foreground">${premiumCalc.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Platform Fee ({(hedgerFeeRate * 100).toFixed(1)}% of coverage)</span>
                    <span className="text-sm font-medium text-amber-400">${hedgerFeeCalc.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-border pt-2 flex justify-between">
                    <span className="text-xs font-semibold text-foreground">Total USDC Required</span>
                    <span className="text-sm font-bold text-primary">${totalCostCalc.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-border pt-2 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Initial Rate</span>
                      <span className="text-xs font-bold text-foreground">{selectedEvent.initialRate ? selectedEvent.initialRate.toFixed(4) : "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Current Rate</span>
                      <span className="text-xs font-bold text-foreground">{currentRate ? currentRate.toFixed(4) : "Loading..."}</span>
                    </div>
                    {payoutPercent > 0 && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Payout if Strike Hit ({(payoutPercent * 100).toFixed(1)}%)</span>
                          <span className="text-xs font-bold text-green-400">${predeterminedPayout.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Net Payout (after 1% fee)</span>
                          <span className="text-xs font-bold text-green-400">${netPredeterminedPayout.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    One-touch: settles when rate touches strike ({selectedEvent.strike.toFixed(2)}). Payout = Notional × ({selectedEvent.strike.toFixed(2)} − {selectedEvent.initialRate.toFixed(2)}) / {selectedEvent.initialRate.toFixed(2)} = {(payoutPercent * 100).toFixed(1)}% of notional. Fixed at purchase — you know exactly what you'll get.
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setBuyDialogOpen(false)} className="border-border text-muted-foreground w-full sm:w-auto">Cancel</Button>
            <Button onClick={() => buyProtectionMutation.mutate()}
              disabled={!notional || parseFloat(notional) < 10 || buyProtectionMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground w-full sm:w-auto">
              {buyProtectionMutation.isPending ? "Processing..." : `Pay $${totalCostCalc.toFixed(2)} & Buy Protection`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={depositDialogOpen} onOpenChange={setDepositDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-[450px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Deposit Liquidity
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {selectedEvent?.name} — Earn premiums from hedgers
            </DialogDescription>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground/70">Total Pool</p>
                  <p className="text-lg font-bold text-foreground">${selectedEvent.totalLiquidity.toLocaleString()}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground/70">Utilization</p>
                  <p className="text-lg font-bold text-foreground">{(selectedEvent.utilization * 100).toFixed(1)}%</p>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Deposit Amount (USDC)</Label>
                <Input
                  type="number" min="10" step="1" placeholder="e.g. 500"
                  value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                  className="bg-muted border-border text-foreground mt-1"
                />
              </div>

              {depositAmount && parseFloat(depositAmount) >= 10 && (
                <div className="bg-muted/50 border border-border rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-foreground">Cost Breakdown</p>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Deposit Amount</span>
                    <span className="text-sm font-medium text-foreground">${parseFloat(depositAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Deposit Fee</span>
                    <span className="text-sm font-medium text-green-400">$0.00 (no fee)</span>
                  </div>
                  <div className="border-t border-border pt-2 flex justify-between">
                    <span className="text-xs font-semibold text-foreground">Total USDC Required</span>
                    <span className="text-sm font-bold text-primary">${parseFloat(depositAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    Note: A {feeConfig ? (feeConfig.lpProfitFeeRate * 100).toFixed(0) : "1"}% fee applies on LP profits at withdrawal.
                  </p>
                </div>
              )}

              <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  <AlertTriangle className="h-3 w-3 inline mr-1 text-yellow-400" />
                  Risk: Payout scales with rate movement above strike ({selectedEvent.strike.toFixed(2)}).
                </p>
                <p className="text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 inline mr-1 text-green-400" />
                  Reward: Share of premiums proportional to your deposit.
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDepositDialogOpen(false)} className="border-border text-muted-foreground w-full sm:w-auto">Cancel</Button>
            <Button onClick={() => depositMutation.mutate()}
              disabled={!depositAmount || parseFloat(depositAmount) < 10 || depositMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground w-full sm:w-auto">
              {depositMutation.isPending ? "Depositing..." : `Pay $${depositAmount ? parseFloat(depositAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"} & Deposit`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createEventDialogOpen} onOpenChange={setCreateEventDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Create Hedge Event
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Set up a one-touch FX protection event — settles when rate touches strike
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground text-xs">Asset Class</Label>
              <div className="flex gap-1.5 mt-1">
                {([
                  { key: 'fx', label: 'FX', activeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
                  { key: 'commodity', label: 'Commodities', activeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
                  { key: 'crypto', label: 'Crypto', activeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
                ] as const).map(cls => (
                  <button key={cls.key} type="button"
                    onClick={() => {
                      const firstPair = (fxData?.pairsWithClass || []).find((p: { pair: string; assetClass: string }) => p.assetClass === cls.key)?.pair;
                      setNewEvent(p => ({ ...p, assetClass: cls.key, underlying: firstPair || p.underlying }));
                    }}
                    className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      newEvent.assetClass === cls.key ? cls.activeClass : 'bg-muted text-muted-foreground border-border hover:bg-accent/50'
                    }`}>
                    {cls.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-muted-foreground">Event Name</Label>
              <Input value={newEvent.name} onChange={e => setNewEvent(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. USD/GHS 24h Protection" className="bg-muted border-border text-foreground mt-1" />
            </div>
            <div>
              <Label className="text-muted-foreground">Description (optional)</Label>
              <Textarea value={newEvent.description} onChange={e => setNewEvent(p => ({ ...p, description: e.target.value }))}
                placeholder="Details about this hedge event" className="bg-muted border-border text-foreground mt-1" rows={2} />
            </div>
            <div>
              <Label className="text-muted-foreground">Pair</Label>
              <Select value={newEvent.underlying} onValueChange={v => setNewEvent(p => ({ ...p, underlying: v }))}>
                <SelectTrigger className="bg-muted border-border text-foreground mt-1">
                  <SelectValue placeholder="Select asset pair" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border max-h-72">
                  {(fxData?.pairsWithClass || [])
                    .filter((p: { pair: string; assetClass: string }) => p.assetClass === newEvent.assetClass)
                    .map((p: { pair: string; assetClass: string }) => (
                      <SelectItem key={p.pair} value={p.pair}>
                        {COMMODITY_NAMES[p.pair] ? `${COMMODITY_NAMES[p.pair]} (${p.pair})` : p.pair}
                        {fxData?.rates[p.pair] ? ` — ${fxData.rates[p.pair].rate > 1000 ? fxData.rates[p.pair].rate.toLocaleString('en-US', { maximumFractionDigits: 2 }) : fxData.rates[p.pair].rate.toFixed(4)}` : ""}
                      </SelectItem>
                    ))
                  }
                  {!fxData?.pairsWithClass && ["USD/GHS","USD/NGN","USD/KES","USD/ZAR","USD/XOF","EUR/GHS"].map(pair => (
                    <SelectItem key={pair} value={pair}>{pair}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {fxData?.rates[newEvent.underlying] && (
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Current {newEvent.underlying} Rate</p>
                <p className="text-lg font-bold text-foreground">{fxData.rates[newEvent.underlying].rate.toFixed(4)}</p>
              </div>
            )}

            <div>
              <Label className="text-muted-foreground">Hedge Direction</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button type="button"
                  onClick={() => setNewEvent(p => ({ ...p, direction: "up" }))}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md border text-sm font-medium transition-colors ${newEvent.direction === "up" ? "bg-green-500/20 border-green-500 text-green-400" : "bg-muted border-border text-muted-foreground hover:border-green-500/50"}`}>
                  <TrendingUp className="w-4 h-4" /> Price Rises
                </button>
                <button type="button"
                  onClick={() => setNewEvent(p => ({ ...p, direction: "down" }))}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md border text-sm font-medium transition-colors ${newEvent.direction === "down" ? "bg-red-500/20 border-red-500 text-red-400" : "bg-muted border-border text-muted-foreground hover:border-red-500/50"}`}>
                  <TrendingDown className="w-4 h-4" /> Price Falls
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                {newEvent.direction === "up" ? "Hedger wins if price rises to or above strike (e.g. importer hedging against currency weakness)." : "Hedger wins if price falls to or below strike (e.g. exporter hedging against currency strength)."}
              </p>
            </div>

            <div>
              <Label className="text-muted-foreground">Strike Price</Label>
              <Input type="number" step="0.01" value={newEvent.strike}
                onChange={e => setNewEvent(p => ({ ...p, strike: e.target.value }))}
                placeholder={fxData?.rates[newEvent.underlying] ? `e.g. ${fxData.rates[newEvent.underlying].rate.toFixed(2)}` : "e.g. 16.00"}
                className="bg-muted border-border text-foreground mt-1" />
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                {newEvent.direction === "up"
                  ? "Set above the current rate. Event settles when price rises to this level."
                  : "Set below the current rate. Event settles when price falls to this level."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-muted-foreground text-xs">Premium %</Label>
                <Input type="number" step="0.1" value={newEvent.premiumRate}
                  onChange={e => setNewEvent(p => ({ ...p, premiumRate: e.target.value }))}
                  placeholder="2.5" className="bg-muted border-border text-foreground mt-1" />
              </div>
              <div className="relative">
                <Label className="text-muted-foreground text-xs">Duration</Label>
                {/* Trigger button — shows selected value */}
                <button
                  type="button"
                  onClick={() => setDurationOpen(o => !o)}
                  className="w-full mt-1 flex items-center justify-between px-3 py-2 rounded-md bg-muted border border-border text-foreground text-xs font-medium hover:border-primary/50 transition-colors"
                >
                  <span>
                    {(() => {
                      const presets: Record<string, string> = { "24": "24 hours", "72": "3 days", "168": "7 days", "336": "14 days", "720": "30 days", "1440": "60 days", "2160": "90 days" };
                      return presets[newEvent.expiryHours] ?? (parseInt(newEvent.expiryHours) < 24 ? `${newEvent.expiryHours}h custom` : `${Math.round(parseInt(newEvent.expiryHours)/24)}d custom`);
                    })()}
                  </span>
                  <svg className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${durationOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>

                {/* Dropdown panel */}
                {durationOpen && (
                  <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg p-3">
                    <p className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider">Select duration</p>
                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      {[
                        { label: "24h", hours: "24" },
                        { label: "3d",  hours: "72" },
                        { label: "7d",  hours: "168" },
                        { label: "14d", hours: "336" },
                        { label: "30d", hours: "720" },
                        { label: "60d", hours: "1440" },
                        { label: "90d", hours: "2160" },
                      ].map(opt => (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => { setNewEvent(p => ({ ...p, expiryHours: opt.hours })); setDurationOpen(false); }}
                          className={`py-1.5 rounded-md text-xs font-medium border transition-all ${
                            newEvent.expiryHours === opt.hours
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-muted border-border text-muted-foreground hover:border-primary/60 hover:text-foreground"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-border pt-2">
                      <p className="text-[10px] text-muted-foreground mb-2">Custom</p>
                      {/* Unit toggle */}
                      <div className="flex rounded-md overflow-hidden border border-border mb-2">
                        <button type="button"
                          onClick={() => setCustomUnit('hours')}
                          className={`flex-1 py-1 text-xs font-medium transition-colors ${customUnit === 'hours' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                          Hours
                        </button>
                        <button type="button"
                          onClick={() => setCustomUnit('days')}
                          className={`flex-1 py-1 text-xs font-medium transition-colors ${customUnit === 'days' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                          Days
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number" step="1" min="1"
                          value={customValue}
                          onChange={e => setCustomValue(e.target.value)}
                          placeholder={customUnit === 'hours' ? 'e.g. 36' : 'e.g. 45'}
                          className="bg-muted border-border text-foreground h-7 text-xs flex-1"
                        />
                        <button type="button"
                          onClick={() => {
                            const v = parseInt(customValue) || 1;
                            const hours = customUnit === 'days' ? String(v * 24) : String(Math.max(1, v));
                            setNewEvent(p => ({ ...p, expiryHours: hours }));
                            setDurationOpen(false);
                            setCustomValue("");
                          }}
                          className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-medium">
                          Set
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Expiry preview */}
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  {(() => {
                    const h = parseInt(newEvent.expiryHours) || 0;
                    const expiry = new Date(Date.now() + h * 3600000);
                    if (h < 24) return `Expires ${expiry.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
                    return `Expires ${expiry.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
                  })()}
                </p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              One-touch option: settles when rate touches the strike price. Payout is predetermined at purchase: Notional × (Strike − Initial Rate) / Initial Rate.
              {fxData?.rates[newEvent.underlying] && newEvent.strike && parseFloat(newEvent.strike) > fxData.rates[newEvent.underlying].rate ? (
                <span className="text-green-400 font-semibold"> Payout = {(((parseFloat(newEvent.strike) - fxData.rates[newEvent.underlying].rate) / fxData.rates[newEvent.underlying].rate) * 100).toFixed(1)}% of notional.</span>
              ) : null}
              {' '}If strike is never touched before expiry, LPs keep all premiums.
            </p>

            <div>
              <Label className="text-muted-foreground text-xs">Initial Liquidity (USDC) <span className="text-red-400">*</span></Label>
              <Input type="number" step="100" min="10" value={newEvent.initialLiquidity}
                onChange={e => setNewEvent(p => ({ ...p, initialLiquidity: e.target.value }))}
                placeholder="e.g. 5000" className="bg-muted border-border text-foreground mt-1" />
            </div>

            <div className="space-y-3 bg-muted/30 rounded-lg p-3 border border-border">
              <p className="text-xs font-semibold text-foreground">Pool Settings</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {newEvent.poolOpen ? <Unlock className="h-3.5 w-3.5 text-green-400" /> : <Lock className="h-3.5 w-3.5 text-red-400" />}
                  <span className="text-xs text-muted-foreground">Open pool to hedgers</span>
                </div>
                <Switch checked={newEvent.poolOpen} onCheckedChange={v => setNewEvent(p => ({ ...p, poolOpen: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {newEvent.allowExternalLp ? <Globe className="h-3.5 w-3.5 text-blue-400" /> : <LockKeyhole className="h-3.5 w-3.5 text-amber-400" />}
                  <span className="text-xs text-muted-foreground">Allow external LPs</span>
                </div>
                <Switch checked={newEvent.allowExternalLp} onCheckedChange={v => setNewEvent(p => ({ ...p, allowExternalLp: v }))} />
              </div>
              <p className="text-[10px] text-muted-foreground/70">{newEvent.poolOpen ? "Pool will be open to hedgers immediately after creation." : "Pool will start closed. You can open it later from My Events."}</p>
            </div>

            {newEvent.strike && newEvent.premiumRate && newEvent.initialLiquidity && parseFloat(newEvent.initialLiquidity) >= 10 && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-foreground">Risk Summary</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-[10px] text-muted-foreground">Your Liquidity</span>
                    <span className="text-xs font-bold text-foreground">${parseFloat(newEvent.initialLiquidity).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[10px] text-muted-foreground">Premium Income</span>
                    <span className="text-xs font-bold text-green-400">{newEvent.premiumRate}% per hedge</span>
                  </div>
                </div>
                {fxData?.rates[newEvent.underlying] && (
                  <div className="border-t border-border pt-2 mt-1 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-[10px] text-muted-foreground">Current Rate → Strike</span>
                      <span className="text-xs font-bold text-foreground">
                        {fxData.rates[newEvent.underlying].rate.toFixed(4)} → {parseFloat(newEvent.strike).toFixed(4)}
                        {(() => {
                          const curr = fxData.rates[newEvent.underlying].rate;
                          const stk = parseFloat(newEvent.strike);
                          const gap = ((stk - curr) / curr * 100);
                          return <span className={`ml-1 ${gap > 0 ? "text-red-400" : "text-green-400"}`}>({gap > 0 ? "+" : ""}{gap.toFixed(1)}%)</span>;
                        })()}
                      </span>
                    </div>
                    {parseFloat(newEvent.strike) > fxData.rates[newEvent.underlying].rate && (
                      <div className="flex justify-between">
                        <span className="text-[10px] text-muted-foreground">Hedger Payout per $1,000</span>
                        <span className="text-xs font-bold text-amber-400">
                          ${((parseFloat(newEvent.strike) - fxData.rates[newEvent.underlying].rate) / fxData.rates[newEvent.underlying].rate * 1000).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="bg-muted/50 border border-border rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground">Cost Breakdown</p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Initial Liquidity</span>
              <span className="text-sm font-medium text-foreground">
                {newEvent.initialLiquidity ? `$${parseFloat(newEvent.initialLiquidity).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Event Creation Fee</span>
              <span className="text-sm font-medium text-amber-400">{feeConfig ? `$${feeConfig.creationFee.toFixed(2)}` : "Loading..."}</span>
            </div>
            <div className="border-t border-border pt-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Total USDC Required</span>
              <span className="text-sm font-bold text-primary">
                ${newEvent.initialLiquidity && feeConfig ? (parseFloat(newEvent.initialLiquidity) + feeConfig.creationFee).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : feeConfig ? feeConfig.creationFee.toFixed(2) : "Loading..."}
              </span>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setCreateEventDialogOpen(false)} className="border-border text-muted-foreground w-full sm:w-auto">Cancel</Button>
            <Button onClick={() => createEventMutation.mutate()}
              disabled={!newEvent.name || !newEvent.strike || !newEvent.premiumRate || !newEvent.initialLiquidity || parseFloat(newEvent.initialLiquidity || "0") < 10 || createEventMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground w-full sm:w-auto">
              {createEventMutation.isPending ? "Creating..." : `Pay $${newEvent.initialLiquidity && feeConfig ? (parseFloat(newEvent.initialLiquidity) + feeConfig.creationFee).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : feeConfig ? feeConfig.creationFee.toFixed(2) : "Loading..."} & Create`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creatorProfileOpen} onOpenChange={setCreatorProfileOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-[480px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Creator Profile
            </DialogTitle>
            <DialogDescription className="text-muted-foreground font-mono text-xs">
              {viewingCreator}
            </DialogDescription>
          </DialogHeader>
          {viewingCreator && (() => {
            const stats = getCreatorStats(viewingCreator);
            const isOwnProfile = wallet?.address?.toLowerCase() === viewingCreator.toLowerCase();
            return (
              <div className="space-y-4">
                {isOwnProfile ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-muted-foreground/70">Pool Premiums</p>
                      <p className="text-lg font-bold text-green-400">${stats.totalPremiums.toFixed(2)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-muted-foreground/70">Creator's Earnings</p>
                      <p className="text-lg font-bold text-amber-400">${stats.loyaltyEarnings.toFixed(2)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-muted-foreground/70">Total Liquidity</p>
                      <p className="text-lg font-bold text-primary">${stats.totalLiquidity.toLocaleString()}</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground/70">Total Liquidity Provided</p>
                    <p className="text-lg font-bold text-primary">${stats.totalLiquidity.toLocaleString()}</p>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-muted-foreground/70">Events</p>
                    <p className="text-sm font-bold text-foreground">{stats.creatorEvents.length}</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-muted-foreground/70">Active</p>
                    <p className="text-sm font-bold text-green-400">{stats.activeEvents}</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-muted-foreground/70">Hedgers Served</p>
                    <p className="text-sm font-bold text-foreground">{stats.totalHedgers}</p>
                  </div>
                </div>

                {stats.creatorEvents.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-foreground">Events</p>
                    {stats.creatorEvents.map(event => (
                      <div key={event.id} className="rounded-lg border border-border p-3 space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-medium text-foreground">{event.name}</p>
                            <p className="text-[11px] text-muted-foreground">{event.underlying} · Strike: {event.strike.toFixed(2)}</p>
                          </div>
                          <Badge className={event.status === "open" ? "bg-green-500/20 text-green-400 border-green-500/30 text-[10px]" : "bg-muted/50 text-muted-foreground border-border text-[10px]"}>
                            {event.status === "open" ? "Active" : event.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 text-center">
                          <div className="bg-muted/30 rounded px-2 py-1">
                            <span className="text-[9px] text-muted-foreground/70">Pool</span>
                            <p className="text-[11px] font-bold text-foreground">${event.totalLiquidity.toLocaleString()}</p>
                          </div>
                          <div className="bg-muted/30 rounded px-2 py-1">
                            <span className="text-[9px] text-muted-foreground/70">Hedgers</span>
                            <p className="text-[11px] font-bold text-foreground">{event.hedgerCount}</p>
                          </div>
                          <div className="bg-muted/30 rounded px-2 py-1">
                            <span className="text-[9px] text-muted-foreground/70">Earned</span>
                            <p className="text-[11px] font-bold text-green-400">${event.totalPremiums.toFixed(2)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}
