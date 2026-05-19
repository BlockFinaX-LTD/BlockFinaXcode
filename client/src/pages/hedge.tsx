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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Shield, TrendingUp, TrendingDown, DollarSign, Clock, AlertTriangle, CheckCircle2,
  Plus, ArrowLeft, ArrowRight, Wallet, BarChart3, Users, Lock, Unlock, Award,
  Activity, PieChart, RefreshCw, ChevronDown, ChevronUp, ToggleLeft, ToggleRight,
  LockKeyhole, Globe, Settings, Share2, ExternalLink
} from "lucide-react";
import { Link } from "wouter";
import { hedgeContract, USDT_ADDRESS_SEPOLIA, getUsdcAddress, getUsdtAddress, type HedgeEventData, type HedgePositionData, type HedgeLpDepositData, type HedgeFeeConfig } from "@/lib/hedge-contract";
import { walletManager } from "@/lib/wallet";
import { ethers } from "ethers";
import { mainnetGuard } from "@/lib/mainnet-guard";
import { getNetworkById, DEFAULT_NETWORK, NETWORKS } from "@/lib/networks";

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
  const { wallet, settings, updateSettings } = useWallet();
  const { toast } = useToast();
  const selectedNetworkId = settings?.selectedNetworkId ?? DEFAULT_NETWORK.id;
  const selectedNetwork = getNetworkById(selectedNetworkId) ?? DEFAULT_NETWORK;
  const activeChainId = selectedNetwork.chainId;
  const activeUsdcAddress = getUsdcAddress(activeChainId);
  const activeUsdtAddress = getUsdtAddress(activeChainId);

  // Sync chain immediately during render so every query below uses the correct RPC
  hedgeContract.setChain(activeChainId);

  // ── Persistent wallet balances for the active chain ──────────────────────
  const { data: nativeBalance } = useQuery<string>({
    queryKey: ['/hedge/native-balance', wallet?.address, activeChainId],
    queryFn: () => hedgeContract.getNativeBalance(wallet!.address),
    enabled: !!wallet?.address,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const { data: usdcBalance } = useQuery<string>({
    queryKey: ['/hedge/usdc-balance', wallet?.address, activeChainId],
    queryFn: () => hedgeContract.getTokenBalance(activeUsdcAddress, wallet!.address),
    enabled: !!wallet?.address,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const { data: usdtBalance } = useQuery<string>({
    queryKey: ['/hedge/usdt-balance', wallet?.address, activeChainId],
    queryFn: () => hedgeContract.getTokenBalance(activeUsdtAddress, wallet!.address),
    enabled: !!wallet?.address && !!activeUsdtAddress,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  // ─────────────────────────────────────────────────────────────────────────

  const [activeTab, setActiveTab] = useState("hedger");
  const [assetClassFilter, setAssetClassFilter] = useState<AssetClass>('all');
  const [hasAutoSwitched, setHasAutoSwitched] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<HedgeEventData | null>(null);
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [createEventDialogOpen, setCreateEventDialogOpen] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
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

  // Live token balance for the selected event's payment token (shown in buy/deposit dialogs)
  const { data: selectedEventTokenBalance } = useQuery<string>({
    queryKey: ['/hedge/token-balance', selectedEvent?.paymentToken, wallet?.address],
    queryFn: async () => {
      if (!selectedEvent?.paymentToken || !wallet?.address) return '0';
      return hedgeContract.getTokenBalance(selectedEvent.paymentToken, wallet.address);
    },
    enabled: !!(selectedEvent?.paymentToken && wallet?.address && (buyDialogOpen || depositDialogOpen)),
    refetchInterval: 10_000,
  });
  const eventTokenSymbol = selectedEvent?.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT';
  const tokenBalanceNum = parseFloat(selectedEventTokenBalance ?? '0');

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
    underlying: "USD/GHS", strike: "", payoutCap: "", premiumRate: "",
    expiryHours: "24", initialLiquidity: "", poolOpen: true, allowExternalLp: true,
    direction: "up" as "up" | "down",
    paymentCurrency: "USDC" as "USDC" | "USDT",
    overrideAcknowledged: false,    // user must check this box to set premium below the engine's quote
    selfPriced: false,              // when true, skip engine attestation entirely; on-chain quoteSigner = address(0)
  });

  // On BSC force USDT (BSC Diamond only accepts USDT). On networks without USDT, fall back to USDC.
  useEffect(() => {
    if (activeChainId === 56 && activeUsdtAddress) {
      setNewEvent(p => ({ ...p, paymentCurrency: 'USDT' }));
    } else if (!activeUsdtAddress && newEvent.paymentCurrency === 'USDT') {
      setNewEvent(p => ({ ...p, paymentCurrency: 'USDC' }));
    }
  }, [activeChainId, activeUsdtAddress]);

  // ── v8: pricing-engine quote ──────────────────────────────────────────────
  // Debounced quote fetch — fires whenever the inputs that affect the premium
  // change. Returns null while the inputs are incomplete or the request is in flight.
  // The returned attestation is what gets passed into createEvent's signature
  // / quoteTimestamp / quoteNonce slots so the on-chain Diamond accepts the call.
  const [pricingQuote, setPricingQuote] = useState<import("@/lib/pricing-quote").QuoteResponse | null>(null);
  const [pricingQuoteLoading, setPricingQuoteLoading] = useState(false);
  const [pricingQuoteError, setPricingQuoteError] = useState<string | null>(null);

  useEffect(() => {
    setPricingQuote(null);
    setPricingQuoteError(null);

    const strikeNum = parseFloat(newEvent.strike);
    const payoutCapNum = parseFloat(newEvent.payoutCap);
    const liquidityNum = parseFloat(newEvent.initialLiquidity);
    const expiryHoursNum = parseInt(newEvent.expiryHours, 10);

    // Need a complete shape before we can quote. Notional defaults to initialLiquidity
    // (creator's seed) when none specified; pricing only depends on it for the absolute
    // dollar premium, not the rate.
    if (!Number.isFinite(strikeNum) || strikeNum <= 0) return;
    if (!Number.isFinite(payoutCapNum) || payoutCapNum <= 0) return;
    if (!Number.isFinite(liquidityNum) || liquidityNum <= 0) return;
    if (!Number.isFinite(expiryHoursNum) || expiryHoursNum <= 0) return;
    if (!wallet?.address) return;

    const handle = setTimeout(async () => {
      setPricingQuoteLoading(true);
      try {
        const { fetchPricingQuote } = await import("@/lib/pricing-quote");
        const expiryUnixSeconds = Math.floor(Date.now() / 1000) + expiryHoursNum * 60 * 60;
        const result = await fetchPricingQuote({
          pair: newEvent.underlying,
          strike: strikeNum,
          payoutCap: payoutCapNum,
          expiryUnixSeconds,
          notional: liquidityNum,
          strikeAbove: newEvent.direction === "up",
          chainId: activeChainId,
          diamondAddress: hedgeContract.activeDiamond,
          creator: wallet.address,
        });
        setPricingQuote(result);
        setPricingQuoteError(null);
      } catch (err: any) {
        setPricingQuote(null);
        setPricingQuoteError(err?.message || "Pricing engine unavailable");
      } finally {
        setPricingQuoteLoading(false);
      }
    }, 450);

    return () => clearTimeout(handle);
  }, [
    newEvent.underlying, newEvent.strike, newEvent.payoutCap,
    newEvent.expiryHours, newEvent.initialLiquidity, newEvent.direction,
    wallet?.address, activeChainId,
  ]);

  // Detects whether the user's typed premium is materially below the engine's quote.
  // Used to gate submit on an explicit "I understand" checkbox.
  const userPremiumNum = parseFloat(newEvent.premiumRate);
  const suggestedPctRate = pricingQuote ? pricingQuote.premiumRate * 100 : null;
  const isPremiumBelowSuggested = !!(
    suggestedPctRate !== null &&
    Number.isFinite(userPremiumNum) &&
    userPremiumNum > 0 &&
    userPremiumNum < suggestedPctRate * 0.9   // >10% below suggested
  );

  // Auto-fill the premium field with the engine's suggested rate whenever a fresh
  // quote arrives (debounced fetch fires when strike/cap/expiry/notional change).
  // The submission still goes on-chain as "self-priced" (signature = "0x") — this
  // is purely a UX nudge so the creator starts from the model's fair-value number
  // instead of typing blind. They can override after auto-fill if they want.
  useEffect(() => {
    if (suggestedPctRate !== null && Number.isFinite(suggestedPctRate) && suggestedPctRate > 0) {
      const next = suggestedPctRate.toFixed(3);
      setNewEvent(prev => prev.premiumRate === next ? prev : { ...prev, premiumRate: next });
    }
  }, [suggestedPctRate]);

  const [events, setEvents] = useState<HedgeEventData[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [txStep, setTxStep] = useState('');

  // Translates raw blockchain errors into plain-language messages
  const friendlyError = (error: any): string => {
    const raw: string = error?.reason || error?.data?.message || error?.message || 'Transaction failed';
    if (raw.includes('replacement fee too low')) return 'A previous transaction is still pending. Retrying automatically...';
    if (raw.includes('insufficient funds')) return 'Not enough ETH (gas) in your wallet to pay network fees.';
    if (raw.includes('user rejected') || raw.includes('User denied')) return 'Transaction was cancelled.';
    if (raw.includes('nonce too low') || raw.includes('nonce has already been used')) return 'Nonce conflict — please wait a moment and try again.';
    if (raw.toLowerCase().includes('allowance') || raw.toLowerCase().includes('exceeds allowance') || raw.toLowerCase().includes('transfer amount exceeds')) {
      return 'Token approval not yet confirmed on-chain. Please wait a moment and try again.';
    }
    // Contract revert reasons (both live reverts and pre-flight simulation errors)
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
      // Merge descriptions from DB (not stored on-chain)
      try {
        const dbRes = await fetch('/api/hedge/events/open');
        if (dbRes.ok) {
          const dbEvents: Array<{ onChainEventId: number; chainId: number; description?: string }> = await dbRes.json();
          const descMap = new Map(
            dbEvents.filter(e => e.chainId === activeChainId && e.description).map(e => [e.onChainEventId, e.description])
          );
          data.forEach(e => { if (descMap.has(e.id)) e.description = descMap.get(e.id); });
        }
      } catch { /* description is optional — continue without it */ }
      setEvents(data);
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setEventsLoading(false);
    }
  };

  const DEFAULT_FEE_CONFIG = {
    creationFee: 2,
    hedgerFeeRate: 0.005,
    hedgerPayoutFeeRate: 0.01,
    lpProfitFeeRate: 0.01,
    creatorLoyaltyRate: 0.005,
  };

  const loadFeeConfig = async () => {
    // Show defaults immediately so the dialog never blocks on "Loading..."
    setFeeConfig(DEFAULT_FEE_CONFIG);
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Fee config timeout')), 8000)
      );
      const config = await Promise.race([hedgeContract.getFeeConfig(), timeout]);
      setFeeConfig(config);
    } catch (error) {
      // Keep the default — it matches the on-chain values ($2 flat creation fee)
      console.warn('Fee config RPC call timed out; using defaults:', error);
    }
  };

  const loadPositions = async () => {
    if (!wallet?.address) return;
    try {
      const data = await hedgeContract.getPositionsByWallet(wallet.address);
      setMyPositions(data);
    } catch (error) {
      console.error('Failed to load positions:', error);
    }
  };

  const loadDeposits = async () => {
    if (!wallet?.address) return;
    try {
      const data = await hedgeContract.getDepositsByWallet(wallet.address);
      setMyDeposits(data);
    } catch (error) {
      console.error('Failed to load deposits:', error);
    }
  };

  useEffect(() => {
    hedgeContract.setChain(activeChainId);
    setEvents([]);
    setMyPositions([]);
    setMyDeposits([]);
    loadEvents();
    loadFeeConfig();
    if (wallet?.address) {
      loadPositions();
      loadDeposits();
    }
  }, [activeChainId]);

  useEffect(() => { if (wallet?.address) loadPositions(); }, [wallet?.address]);
  useEffect(() => { if (wallet?.address) loadDeposits(); }, [wallet?.address]);

  // Auto-switch to Base if no events found on current chain (handles users on an inactive saved chain)
  useEffect(() => {
    if (!eventsLoading && events.length === 0 && !hasAutoSwitched && activeChainId !== 8453) {
      const baseNetwork = NETWORKS.find(n => n.chainId === 8453);
      if (baseNetwork) {
        setHasAutoSwitched(true);
        updateSettings({ selectedNetworkId: baseNetwork.id });
      }
    }
  }, [eventsLoading, events.length, activeChainId]);

  type FXRate = { pair: string; rate: number; source: string; timestamp: number; lastUpdated: string };
  const { data: fxData } = useQuery<{ rates: Record<string, FXRate>; pairs: string[]; pairsWithClass: Array<{ pair: string; assetClass: string }> }>({
    queryKey: ["/api/fx/rates"],
    refetchInterval: 5 * 60 * 1000,
  });

  const fetchEventDetails = async (id: number) => {
    // Immediately populate from local cached data so the dialog always opens
    const local = events.find(e => e.id === id);
    if (local) setSelectedEvent(local);
    try {
      const data = await hedgeContract.getEvent(id);
      // Preserve description from cached data (not available on-chain)
      if (local?.description && !data.description) data.description = local.description;
      setSelectedEvent(data);
      return data;
    } catch (err) {
      console.warn('[fetchEventDetails] chain read failed, using cached data:', err);
      return local ?? null;
    }
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

  // Fire-and-forget activity logger. Server is idempotent (composite unique on
  // chainId+txHash+actionType), so retries are safe. We never block UX on this —
  // network failure here just means a missing row in the local feed, the
  // on-chain action already succeeded.
  const recordActivity = async (payload: {
    actionType: string;
    txHash: string;
    onChainEventId?: number | null;
    amount?: string | number | null;
    token?: string | null;
    metadata?: Record<string, any> | null;
  }) => {
    if (!wallet?.address || !payload.txHash) return;
    try {
      await fetch('/api/hedge/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: wallet.address,
          chainId: activeChainId,
          ...payload,
        }),
      });
    } catch (e) {
      console.warn('[activity] record failed (non-blocking):', e);
    }
  };

  const buyProtectionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEvent) throw new Error("No event selected");
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error("Wallet signer not available. Please unlock your wallet.");
      const txHash = await hedgeContract.buyProtection(signer, selectedEvent.id, notional, setTxStep);
      await recordActivity({
        actionType: 'buy_protection',
        txHash,
        onChainEventId: selectedEvent.id,
        amount: notional,
        token: selectedEvent.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT',
        metadata: {
          eventName: selectedEvent.name,
          underlying: selectedEvent.underlying,
          strike: selectedEvent.strike,
          premiumRate: selectedEvent.premiumRate,
        },
      });
    },
    onSuccess: async () => {
      setTxStep('');
      await loadEvents();
      await loadPositions();
      if (selectedEvent) await fetchEventDetails(selectedEvent.id);
      toast({ title: "Protection Purchased", description: `Notional: $${parseFloat(notional).toLocaleString()} — on-chain transaction confirmed` });
      setBuyDialogOpen(false);
      setNotional("");
    },
    onError: (error: any) => {
      setTxStep('');
      toast({ title: "Transaction Failed", description: friendlyError(error), variant: "destructive" });
    }
  });

  const depositMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEvent) throw new Error("No event selected");
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error("Wallet signer not available. Please unlock your wallet.");
      const txHash = await hedgeContract.deposit(signer, selectedEvent.id, depositAmount, setTxStep);
      await recordActivity({
        actionType: 'lp_deposit',
        txHash,
        onChainEventId: selectedEvent.id,
        amount: depositAmount,
        token: selectedEvent.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT',
        metadata: {
          eventName: selectedEvent.name,
          underlying: selectedEvent.underlying,
          strike: selectedEvent.strike,
        },
      });
    },
    onSuccess: async () => {
      setTxStep('');
      await loadEvents();
      await loadDeposits();
      if (selectedEvent) await fetchEventDetails(selectedEvent.id);
      toast({ title: "Liquidity Deposited", description: `$${parseFloat(depositAmount).toLocaleString()} USDC deposited on-chain` });
      setDepositDialogOpen(false);
      setDepositAmount("");
    },
    onError: (error: any) => {
      setTxStep('');
      toast({ title: "Transaction Failed", description: friendlyError(error), variant: "destructive" });
    }
  });

  const createEventMutation = useMutation({
    mutationFn: async () => {
      const signer = await walletManager.getSigner(selectedNetworkId);
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
      const paymentTokenAddr = newEvent.paymentCurrency === 'USDT' && activeUsdtAddress
        ? activeUsdtAddress
        : activeUsdcAddress;

      // v7: payoutCap. Pass 0 to opt into legacy single-strike behaviour;
      // otherwise we require it to be on the right side of strike (UI validates).
      const payoutCapNum = parseFloat(newEvent.payoutCap || "0") || 0;

      // Pricing model: every event is submitted on-chain as "self-priced" — the
      // contract gets signature = "0x" and stores quoteSigner = address(0).
      // The engine still computes a fair-value premium and the UI auto-fills the
      // creator's premium input with it (see auto-fill useEffect upstream), but
      // we don't bind that number cryptographically on-chain. This sidesteps the
      // payload-mismatch class of bugs entirely (no signature → nothing to
      // verify → can't be invalid).
      const signature: string = "0x";
      const quoteTimestamp = 0;
      const quoteNonce: string = ethers.ZeroHash;
      const signedInitialRate: number = currentFxRate;

      const { eventId: newEventId, txHash: createTxHash } = await hedgeContract.createEvent(signer, {
        name: newEvent.name,
        underlying: newEvent.underlying,
        strike: strikePrice,
        payoutCap: payoutCapNum,
        premiumRate: parseFloat(newEvent.premiumRate) / 100,
        expiryDate,
        allowExternalLp: newEvent.allowExternalLp,
        initialLiquidity: newEvent.initialLiquidity || "0",
        initialRate: signedInitialRate,
        strikeAbove,
        paymentToken: paymentTokenAddr,
        signature,
        quoteTimestamp,
        quoteNonce,
      }, setTxStep);

      await recordActivity({
        actionType: 'create_event',
        txHash: createTxHash,
        onChainEventId: newEventId,
        amount: newEvent.initialLiquidity || '0',
        token: newEvent.paymentCurrency,
        metadata: {
          eventName: newEvent.name,
          underlying: newEvent.underlying,
          strike: parseFloat(newEvent.strike),
          premiumRate: parseFloat(newEvent.premiumRate) / 100,
          expiryHours: newEvent.expiryHours,
          direction: newEvent.direction,
        },
      });

      if (newEvent.poolOpen && newEventId) {
        setTxStep('Opening pool...');
        const toggleTxHash = await hedgeContract.setPoolSettings(signer, newEventId, true, newEvent.allowExternalLp, setTxStep);
        await recordActivity({
          actionType: 'toggle_pool',
          txHash: toggleTxHash,
          onChainEventId: newEventId,
          metadata: { eventName: newEvent.name, poolOpen: true, allowExternalLp: newEvent.allowExternalLp },
        });
      }

      // Persist description to server (on-chain doesn't store text)
      if (newEventId && newEvent.description.trim()) {
        try {
          await fetch(`/api/hedge/events/chain/${activeChainId}/${newEventId}/description`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: newEvent.description.trim() }),
          });
        } catch { /* non-critical — description is optional */ }
      }
    },
    onSuccess: async () => {
      setTxStep('');
      await loadEvents();
      const msg = newEvent.poolOpen
        ? "Event created and pool is open for hedgers!"
        : "Event created. Go to My Events to open the pool when ready.";
      toast({ title: "Event Created", description: msg });
      setCreateEventDialogOpen(false);
      setActiveTab("my-events");
      setNewEvent({ name: "", description: "", assetClass: "fx", underlying: "USD/GHS", strike: "", payoutCap: "", premiumRate: "", expiryHours: "24", initialLiquidity: "", poolOpen: true, allowExternalLp: true, direction: "up", paymentCurrency: "USDC", overrideAcknowledged: false, selfPriced: false });
    },
    onError: (error: any) => {
      setTxStep('');
      console.error('[createEvent] Failed:', error);
      toast({ title: "Transaction Failed", description: friendlyError(error), variant: "destructive" });
    }
  });

  const togglePoolMutation = useMutation({
    mutationFn: async ({ eventId, poolOpen, allowExternalLp }: { eventId: number; poolOpen?: boolean; allowExternalLp?: boolean }) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error("Wallet signer not available.");
      const event = events.find(e => e.id === eventId);
      const nextPoolOpen = typeof poolOpen === "boolean" ? poolOpen : (event?.poolOpen ?? true);
      const nextAllowLp  = typeof allowExternalLp === "boolean" ? allowExternalLp : (event?.allowExternalLp ?? true);
      const txHash = await hedgeContract.setPoolSettings(signer, eventId, nextPoolOpen, nextAllowLp, setTxStep);
      await recordActivity({
        actionType: 'toggle_pool',
        txHash,
        onChainEventId: eventId,
        metadata: { eventName: event?.name, poolOpen: nextPoolOpen, allowExternalLp: nextAllowLp },
      });
    },
    onSuccess: async () => {
      setTxStep('');
      await loadEvents();
      toast({ title: "Updated", description: "Pool settings changed" });
    },
    onError: (error: any) => {
      setTxStep('');
      toast({ title: "Transaction Failed", description: friendlyError(error), variant: "destructive" });
    }
  });

  const claimMutation = useMutation({
    mutationFn: async (positionId: number) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error("Wallet signer not available.");
      const position = myPositions.find(p => p.id === positionId);
      const event = position ? events.find(e => e.id === position.eventId) : null;
      const txHash = await hedgeContract.claimPayout(signer, positionId, setTxStep);
      await recordActivity({
        actionType: 'claim_payout',
        txHash,
        onChainEventId: position?.eventId ?? null,
        amount: position?.payoutAmount ?? null,
        token: event?.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT',
        metadata: { positionId, eventName: event?.name, underlying: event?.underlying },
      });
    },
    onSuccess: async () => {
      setTxStep('');
      await loadPositions();
      toast({ title: "Payout Claimed", description: "Funds have been sent to your wallet" });
    },
    onError: (error: any) => {
      setTxStep('');
      toast({ title: "Transaction Failed", description: friendlyError(error), variant: "destructive" });
    }
  });

  const withdrawMutation = useMutation({
    mutationFn: async (depositId: number) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error("Wallet signer not available.");
      const dep = myDeposits.find(d => d.id === depositId);
      const event = dep ? events.find(e => e.id === dep.eventId) : null;
      const txHash = await hedgeContract.withdrawCapital(signer, depositId, setTxStep);
      await recordActivity({
        actionType: 'withdraw_lp',
        txHash,
        onChainEventId: dep?.eventId ?? null,
        amount: dep?.amount ?? null,
        token: event?.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT',
        metadata: { depositId, eventName: event?.name, underlying: event?.underlying },
      });
    },
    onSuccess: async () => {
      setTxStep('');
      await loadDeposits();
      await loadEvents();
      toast({ title: "Liquidity Withdrawn", description: "Funds returned to your wallet" });
    },
    onError: (error: any) => {
      setTxStep('');
      toast({ title: "Transaction Failed", description: friendlyError(error), variant: "destructive" });
    }
  });

  const recoverExpiredMutation = useMutation({
    mutationFn: async (eventId: number) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error("Wallet signer not available.");
      const event = events.find(e => e.id === eventId);
      const txHash = await hedgeContract.recoverExpiredPayouts(signer, eventId, setTxStep);
      await recordActivity({
        actionType: 'recover_expired',
        txHash,
        onChainEventId: eventId,
        metadata: { eventName: event?.name, underlying: event?.underlying },
      });
    },
    onSuccess: async () => {
      setTxStep('');
      await loadEvents();
      await loadDeposits();
      toast({ title: "Event Recovered", description: "Event marked expired on-chain. You can now withdraw your liquidity." });
    },
    onError: (error: any) => {
      setTxStep('');
      toast({ title: "Recovery Failed", description: friendlyError(error), variant: "destructive" });
    }
  });

  const claimPremiumsMutation = useMutation({
    mutationFn: async (depositId: number) => {
      const signer = await walletManager.getSigner(selectedNetworkId);
      if (!signer) throw new Error("Wallet signer not available.");
      const dep = myDeposits.find(d => d.id === depositId);
      const event = dep ? events.find(e => e.id === dep.eventId) : null;
      const claimable = dep ? (dep.premiumsEarned - dep.premiumsClaimed) : null;
      const txHash = await hedgeContract.claimPremiums(signer, depositId, setTxStep);
      await recordActivity({
        actionType: 'claim_premiums',
        txHash,
        onChainEventId: dep?.eventId ?? null,
        amount: claimable,
        token: event?.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT',
        metadata: { depositId, eventName: event?.name, underlying: event?.underlying },
      });
    },
    onSuccess: async () => {
      setTxStep('');
      await loadDeposits();
      toast({ title: "Premiums Claimed", description: "Premiums sent to your wallet" });
    },
    onError: (error: any) => {
      setTxStep('');
      toast({ title: "Transaction Failed", description: friendlyError(error), variant: "destructive" });
    }
  });

  // ── Mainnet safety wrappers ───────────────────────────────────────────────
  const guardedBuyProtection = () => {
    if (!selectedEvent) return;
    if (!wallet) {
      toast({ title: "Wallet locked", description: "Please unlock your wallet to buy protection.", variant: "destructive" });
      return;
    }
    // totalCostCalc = premium + hedger fee — the actual USDC leaving the wallet (not the notional)
    const paymentAmount = totalCostCalc;
    const chainCheck = mainnetGuard.validateChainId(activeChainId);
    if (!chainCheck.allowed) {
      toast({ title: "Network error", description: chainCheck.reason, variant: "destructive" });
      return;
    }
    const txCheck = mainnetGuard.validateTransaction(paymentAmount, wallet.address);
    if (!txCheck.allowed) {
      toast({ title: "Transaction blocked", description: txCheck.reason, variant: "destructive" });
      return;
    }
    if (txCheck.requiresConfirmation) {
      const notionalNum = parseFloat(notional) || 0;
      setConfirmMessage(
        `You are paying $${paymentAmount.toFixed(2)} ${eventTokenSymbol} (premium + fee) to buy $${notionalNum.toLocaleString()} notional coverage on ${selectedNetwork.name}. ` +
        `This uses real funds and cannot be reversed.`
      );
      setPendingAction(() => () => {
        buyProtectionMutation.mutate();
        mainnetGuard.recordTransaction(wallet.address, paymentAmount);
      });
      setConfirmDialogOpen(true);
      return;
    }
    buyProtectionMutation.mutate();
    mainnetGuard.recordTransaction(wallet.address, paymentAmount);
  };

  const guardedDeposit = () => {
    if (!selectedEvent) return;
    if (!wallet) {
      toast({ title: "Wallet locked", description: "Please unlock your wallet to deposit.", variant: "destructive" });
      return;
    }
    const amount = parseFloat(depositAmount) || 0;
    const chainCheck = mainnetGuard.validateChainId(activeChainId);
    if (!chainCheck.allowed) {
      toast({ title: "Network error", description: chainCheck.reason, variant: "destructive" });
      return;
    }
    const txCheck = mainnetGuard.validateTransaction(amount, wallet.address);
    if (!txCheck.allowed) {
      toast({ title: "Transaction blocked", description: txCheck.reason, variant: "destructive" });
      return;
    }
    if (txCheck.requiresConfirmation) {
      setConfirmMessage(
        `You are depositing $${amount.toFixed(2)} ${eventTokenSymbol} as liquidity on ${selectedNetwork.name}. ` +
        `This uses real funds and cannot be reversed.`
      );
      setPendingAction(() => () => {
        depositMutation.mutate();
        mainnetGuard.recordTransaction(wallet.address, amount);
      });
      setConfirmDialogOpen(true);
      return;
    }
    depositMutation.mutate();
    mainnetGuard.recordTransaction(wallet.address, amount);
  };
  // ─────────────────────────────────────────────────────────────────────────

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
    <div className="min-h-screen bg-background pb-28">
      <AppHeader
        title="Cover"
        rightContent={
          <Button
            onClick={() => setCreateEventDialogOpen(true)}
            size="sm"
            className="h-9 rounded-full text-xs px-3"
          >
            <Plus className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">New pool</span>
          </Button>
        }
      />

      {/* ── Page intro + balance strip ─────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 pt-5">
        <div className="mb-3">
          <h1 className="bfx-display text-[24px] font-semibold tracking-tight leading-tight">
            Cover marketplace
          </h1>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            Protect against FX moves — or earn premium providing cover.
          </p>
        </div>

        {/* Spendable balances — one tidy strip, no network/address pill */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-0.5 -mx-4 px-4">
          <span className="flex-shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
            Spendable
          </span>
          <div className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/50 border border-gray-100 dark:border-border/40 text-[11px]">
            <span className="text-muted-foreground font-medium">{selectedNetwork.symbol}</span>
            <span className="font-mono-data font-semibold text-foreground tabular-nums">
              {nativeBalance !== undefined
                ? parseFloat(nativeBalance).toFixed(4)
                : <span className="text-muted-foreground animate-pulse">···</span>}
            </span>
          </div>
          <div className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/50 border border-gray-100 dark:border-border/40 text-[11px]">
            <span className="text-muted-foreground font-medium">USDC</span>
            <span className="font-mono-data font-semibold text-foreground tabular-nums">
              {usdcBalance !== undefined
                ? parseFloat(usdcBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : <span className="text-muted-foreground animate-pulse">···</span>}
            </span>
          </div>
          {activeUsdtAddress && (
            <div className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/50 border border-gray-100 dark:border-border/40 text-[11px]">
              <span className="text-muted-foreground font-medium">USDT</span>
              <span className="font-mono-data font-semibold text-foreground tabular-nums">
                {usdtBalance !== undefined
                  ? parseFloat(usdtBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : <span className="text-muted-foreground animate-pulse">···</span>}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* ── Your portfolio summary (brand card) ─────────────────── */}
        <div className="relative overflow-hidden rounded-2xl bfx-hero-brand p-4">
          <div className="absolute inset-0 bfx-hero-brand-dotgrid opacity-60 pointer-events-none" />
          <div className="grid grid-cols-4 gap-2 relative">
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/60 font-semibold">Open pools</p>
              <p className="bfx-display text-white text-[20px] font-semibold mt-1">
                {events.filter(e => e.status === 'open').length}
              </p>
            </div>
            <div className="text-center border-l border-white/15">
              <p className="text-[10px] uppercase tracking-wider text-white/60 font-semibold">As buyer</p>
              <p className="bfx-display text-white text-[20px] font-semibold mt-1">
                {myPositions.filter(p => p.status === 'active').length}
              </p>
            </div>
            <div className="text-center border-l border-white/15">
              <p className="text-[10px] uppercase tracking-wider text-white/60 font-semibold">As provider</p>
              <p className="bfx-display text-white text-[20px] font-semibold mt-1 font-mono-data">
                ${myDeposits.filter(d => !d.withdrawn).reduce((s, d) => s + d.amount, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="text-center border-l border-white/15">
              <p className="text-[10px] uppercase tracking-wider text-white/60 font-semibold">Premium</p>
              <p className="bfx-display text-emerald-300 text-[20px] font-semibold mt-1 font-mono-data">
                ${myDeposits.reduce((s, d) => s + d.premiumsEarned, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>
        </div>

        {fxData && Object.keys(fxData.rates).length > 0 && (
          <Collapsible open={fxOracleOpen} onOpenChange={setFxOracleOpen}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between px-4 py-3.5 bg-card rounded-2xl border border-gray-100 dark:border-border/40 hover:border-primary/30 hover:shadow-[0_2px_8px_-2px_rgba(26,68,128,0.08)] transition-all">
                <div className="flex items-center gap-2.5">
                  <span className="h-7 w-7 rounded-full bg-emerald-100 dark:bg-emerald-500/10 inline-flex items-center justify-center">
                    <Activity className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  </span>
                  <span className="text-[14px] font-semibold tracking-tight text-foreground">Live market rates</span>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                </div>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
                  {Object.keys(fxData.rates).length} pairs
                  {fxOracleOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </span>
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

        {/* Asset-class segmented control */}
        {(() => {
          const openPools = events.filter(e => e.status === 'open');
          const countFor = (cls: AssetClass) =>
            cls === 'all' ? openPools.length : openPools.filter(e => getAssetClass(e.underlying) === cls).length;
          const ITEMS: { key: AssetClass; label: string; dot?: string }[] = [
            { key: 'all',       label: 'All' },
            { key: 'fx',        label: 'FX',          dot: 'bg-blue-400' },
            { key: 'commodity', label: 'Commodities', dot: 'bg-amber-400' },
            { key: 'crypto',    label: 'Crypto',      dot: 'bg-purple-400' },
          ];
          return (
            <div className="grid grid-cols-4 gap-1 bg-muted/50 rounded-xl p-1">
              {ITEMS.map(item => {
                const active = assetClassFilter === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setAssetClassFilter(item.key)}
                    className={`relative flex items-center justify-center gap-1.5 h-9 rounded-lg text-[11px] font-semibold transition-all ${
                      active
                        ? 'bg-card shadow-sm text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {item.dot && (
                      <span className={`w-1.5 h-1.5 rounded-full ${item.dot} ${active ? '' : 'opacity-60'}`} />
                    )}
                    {item.label}
                    <span className={`text-[10px] font-mono-data tabular-nums ${active ? 'text-muted-foreground' : 'opacity-60'}`}>
                      {countFor(item.key)}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-muted/50 w-full grid grid-cols-4 h-11 p-1 rounded-xl">
            <TabsTrigger
              value="hedger"
              className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground text-xs sm:text-sm font-semibold gap-1.5"
            >
              <Shield className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span className="hidden sm:inline">Buy cover</span>
              <span className="sm:hidden">Buy</span>
            </TabsTrigger>
            <TabsTrigger
              value="provider"
              className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground text-xs sm:text-sm font-semibold gap-1.5"
            >
              <TrendingUp className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span className="hidden sm:inline">Provide</span>
              <span className="sm:hidden">Earn</span>
            </TabsTrigger>
            <TabsTrigger
              value="my-events"
              className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground text-xs sm:text-sm font-semibold gap-1.5"
            >
              <Settings className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span className="hidden sm:inline">My pools</span>
              <span className="sm:hidden">Pools</span>
            </TabsTrigger>
            <TabsTrigger
              value="my-hedges"
              className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-foreground text-muted-foreground text-xs sm:text-sm font-semibold gap-1.5"
            >
              <BarChart3 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span className="hidden sm:inline">Positions</span>
              <span className="sm:hidden">Mine</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="hedger" className="space-y-3">
            {eventsLoading ? (
              <div className="text-center py-16 text-muted-foreground">Loading events...</div>
            ) : events.filter(e => e.status === "open" && e.creator.toLowerCase() !== (wallet?.address || "").toLowerCase() && (assetClassFilter === 'all' || getAssetClass(e.underlying) === assetClassFilter)).length === 0 ? (
              <div className="text-center py-16">
                <Shield className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">No active {assetClassFilter !== 'all' ? assetClassFilter : ''} protection events on {selectedNetwork.name}</p>
                {activeChainId !== 8453 && NETWORKS.find(n => n.chainId === 8453) && (
                  <button
                    onClick={() => updateSettings({ selectedNetworkId: NETWORKS.find(n => n.chainId === 8453)!.id })}
                    className="mt-3 text-sm text-primary hover:underline"
                  >
                    Switch to Base to see available events →
                  </button>
                )}
                {activeChainId === 8453 && (
                  <p className="text-muted-foreground/70 text-sm mt-1">Create an event to get started</p>
                )}
              </div>
            ) : events.filter(e => e.status === "open" && e.creator.toLowerCase() !== (wallet?.address || "").toLowerCase() && (assetClassFilter === 'all' || getAssetClass(e.underlying) === assetClassFilter)).map(event => {
              const cls = getAssetClass(event.underlying);
              const clsTone = cls === 'fx' ? { dot: 'bg-blue-400',   label: 'text-blue-600 dark:text-blue-400' }
                           : cls === 'commodity' ? { dot: 'bg-amber-400', label: 'text-amber-600 dark:text-amber-400' }
                           : { dot: 'bg-purple-400', label: 'text-purple-600 dark:text-purple-400' };
              const spot = fxData?.rates[event.underlying]?.rate;
              const isTouched = spot !== undefined ? (event.strikeAbove ? spot >= event.strike : spot <= event.strike) : false;
              const utilPct = Math.min(100, Math.round(((event.totalLiquidity - event.availableCapacity) / Math.max(1, event.totalLiquidity)) * 100));
              const isExpired = new Date() > event.expiryDate;
              const payToken = event.paymentToken?.toLowerCase() === activeUsdcAddress.toLowerCase() ? 'USDC' : 'USDT';
              return (
              <div key={event.id}
                className={`group relative rounded-2xl bg-card border border-gray-100 dark:border-border/40 hover:border-primary/30 hover:shadow-[0_4px_16px_-4px_rgba(26,68,128,0.15)] transition-all cursor-pointer overflow-hidden ${isTouched ? 'ring-1 ring-emerald-300/60 dark:ring-emerald-500/40' : ''}`}
                onClick={async () => { await fetchEventDetails(event.id); setBuyDialogOpen(true); }}>
                <div className="p-4 space-y-3.5">
                  {/* Header — asset glyph + name + status + expiry */}
                  <div className="flex items-start gap-3">
                    <div className="h-11 w-11 rounded-2xl bg-primary/8 border border-primary/15 flex items-center justify-center shrink-0 font-mono-data text-[11px] font-semibold text-primary tracking-tight">
                      {event.underlying.split('/')[0].slice(0, 3)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-semibold ${clsTone.label}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${clsTone.dot}`} />
                          {cls === 'fx' ? 'FX' : cls === 'commodity' ? 'Commodity' : 'Crypto'}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-[10.5px] text-muted-foreground font-mono-data font-medium">{event.underlying}</span>
                      </div>
                      <p className="bfx-display text-[15.5px] font-semibold tracking-tight leading-tight mt-0.5 truncate">{event.name}</p>
                      {event.description && (
                        <p className="text-[11px] text-muted-foreground/80 mt-0.5 line-clamp-1">{event.description}</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); copyShareLink(event.id, "buy"); }}
                      className="h-7 w-7 rounded-full hover:bg-muted/60 inline-flex items-center justify-center text-muted-foreground hover:text-primary transition-colors shrink-0"
                      title="Share">
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Direction sentence + countdown */}
                  <div className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      {event.strikeAbove ? (
                        <TrendingUp className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2.2} />
                      ) : (
                        <TrendingDown className="h-3.5 w-3.5 text-red-500" strokeWidth={2.2} />
                      )}
                      <span>Pays if</span>
                      <span className="font-mono-data font-semibold text-foreground tabular-nums">{event.underlying}</span>
                      <span>{event.strikeAbove ? 'rises above' : 'falls below'}</span>
                      <span className="font-mono-data font-semibold text-foreground tabular-nums">{event.strike.toFixed(2)}</span>
                    </span>
                    <span className="text-[11px] font-mono-data tabular-nums shrink-0">
                      <CountdownTimer expiryDate={event.expiryDate} />
                    </span>
                  </div>

                  {/* Key metrics row */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2">
                      <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Premium</p>
                      <p className="text-[14px] font-semibold font-mono-data text-primary tabular-nums mt-0.5">
                        {(event.premiumRate * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2">
                      <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Spot now</p>
                      <p className="text-[14px] font-semibold font-mono-data text-foreground tabular-nums mt-0.5">
                        {spot ? spot.toFixed(2) : "—"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2">
                      <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Pay in</p>
                      <p className="text-[14px] font-semibold font-mono-data text-foreground tabular-nums mt-0.5">
                        {payToken}
                      </p>
                    </div>
                  </div>

                  {/* Pool capacity bar */}
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-muted-foreground">Capacity</span>
                      <span className="font-mono-data tabular-nums">
                        <span className="font-semibold text-foreground">${event.availableCapacity.toLocaleString()}</span>
                        <span className="text-muted-foreground"> / ${event.totalLiquidity.toLocaleString()}</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
                      <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${utilPct}%` }} />
                    </div>
                  </div>

                  {/* Spot indicator banner (only when interesting) */}
                  {isTouched && (
                    <div className="rounded-xl px-3 py-2 flex items-center justify-between bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20">
                      <span className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">
                        <Activity className="h-3 w-3" />
                        Strike touched — settling
                      </span>
                    </div>
                  )}

                  {/* Footer — creator + CTA */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={(e) => openCreatorProfile(event.creator, e)}
                      className="text-[10.5px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 shrink-0">
                      <Users className="h-3 w-3" />
                      by {shortenAddress(event.creator)}
                    </button>
                    <div className="ml-auto flex items-center gap-1.5">
                      {!event.poolOpen && (
                        <Badge variant="outline" className="text-[9.5px] rounded-full border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 font-semibold">Closed</Badge>
                      )}
                      {!event.allowExternalLp && (
                        <Badge variant="outline" className="text-[9.5px] rounded-full border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold">Private</Badge>
                      )}
                    </div>
                  </div>

                  {isExpired ? (
                    <Button className="w-full h-10 rounded-xl bg-muted text-muted-foreground font-semibold" disabled>
                      Expired
                    </Button>
                  ) : event.poolOpen ? (
                    <Button
                      className="w-full h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm"
                      onClick={async (e) => { e.stopPropagation(); await fetchEventDetails(event.id); setBuyDialogOpen(true); }}>
                      Buy protection
                      <ArrowRight className="h-4 w-4 ml-1.5" />
                    </Button>
                  ) : (
                    <Button className="w-full h-10 rounded-xl bg-muted text-muted-foreground font-semibold" disabled>
                      Pool closed
                    </Button>
                  )}
                </div>
              </div>
              );
            })}
          </TabsContent>

          <TabsContent value="provider" className="space-y-3">
            {eventsLoading ? (
              <div className="text-center py-16 text-muted-foreground">Loading events...</div>
            ) : events.filter(e => e.status === "open" && new Date() < e.expiryDate && (assetClassFilter === 'all' || getAssetClass(e.underlying) === assetClassFilter)).length === 0 ? (
              <div className="text-center py-16">
                <TrendingUp className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">No pools available</p>
              </div>
            ) : events.filter(e => e.status === "open" && new Date() < e.expiryDate && (assetClassFilter === 'all' || getAssetClass(e.underlying) === assetClassFilter)).map(event => {
              const cls = getAssetClass(event.underlying);
              const clsTone = cls === 'fx' ? { dot: 'bg-blue-400',   label: 'text-blue-600 dark:text-blue-400' }
                           : cls === 'commodity' ? { dot: 'bg-amber-400', label: 'text-amber-600 dark:text-amber-400' }
                           : { dot: 'bg-purple-400', label: 'text-purple-600 dark:text-purple-400' };
              const isCreator = wallet?.address?.toLowerCase() === event.creator.toLowerCase();
              const canDeposit = event.allowExternalLp || isCreator;
              return (
              <div key={event.id}
                className={`group relative rounded-2xl bg-card border transition-all overflow-hidden ${
                  canDeposit
                    ? 'border-gray-100 dark:border-border/40 hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:shadow-[0_4px_16px_-4px_rgba(16,185,129,0.18)] cursor-pointer'
                    : 'border-gray-100 dark:border-border/40 opacity-70'
                } ${isCreator ? 'ring-1 ring-primary/30' : ''}`}
                onClick={async () => {
                  if (!canDeposit) return;
                  await fetchEventDetails(event.id); setDepositDialogOpen(true);
                }}>
                <div className="p-4 space-y-3.5">
                  {/* Header — APY-first hierarchy */}
                  <div className="flex items-start gap-3">
                    <div className="h-11 w-11 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 flex flex-col items-center justify-center shrink-0">
                      <p className="bfx-display text-[14px] font-bold text-emerald-700 dark:text-emerald-300 tabular-nums leading-none">
                        {(event.premiumRate * 100).toFixed(1)}
                      </p>
                      <p className="text-[8px] uppercase tracking-wider text-emerald-700/70 dark:text-emerald-400/70 font-semibold leading-none mt-0.5">%</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-semibold ${clsTone.label}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${clsTone.dot}`} />
                          {cls === 'fx' ? 'FX' : cls === 'commodity' ? 'Commodity' : 'Crypto'}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-[10.5px] text-muted-foreground font-mono-data font-medium">{event.underlying}</span>
                      </div>
                      <p className="bfx-display text-[15.5px] font-semibold tracking-tight leading-tight mt-0.5 truncate">{event.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Earn premium on each cover sold</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isCreator && (
                        <Badge variant="outline" className="text-[9px] rounded-full border-primary/30 bg-primary/8 text-primary font-semibold">Your pool</Badge>
                      )}
                      {event.allowExternalLp && (
                        <button
                          onClick={(e) => { e.stopPropagation(); copyShareLink(event.id, "lp"); }}
                          className="h-7 w-7 rounded-full hover:bg-muted/60 inline-flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
                          title="Share LP deposit link">
                          <Share2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Key context metrics */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2">
                      <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Strike</p>
                      <p className="text-[14px] font-semibold font-mono-data text-foreground tabular-nums mt-0.5">{event.strike.toFixed(2)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2">
                      <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Pool</p>
                      <p className="text-[14px] font-semibold font-mono-data text-foreground tabular-nums mt-0.5">${event.totalLiquidity.toLocaleString()}</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2">
                      <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Expires</p>
                      <p className="text-[13px] font-semibold font-mono-data tabular-nums mt-0.5">
                        <CountdownTimer expiryDate={event.expiryDate} />
                      </p>
                    </div>
                  </div>

                  {/* Participants strip */}
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        <span className="font-semibold text-foreground tabular-nums">{event.lpCount}</span> LPs
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Shield className="h-3 w-3" />
                        <span className="font-semibold text-foreground tabular-nums">{event.hedgerCount}</span> hedgers
                      </span>
                    </span>
                    <button
                      onClick={(e) => openCreatorProfile(event.creator, e)}
                      className="text-[10.5px] hover:text-primary transition-colors flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      by {shortenAddress(event.creator)}
                    </button>
                  </div>

                  {(() => {
                    if (isCreator) {
                      return (
                        <Button
                          className="w-full h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm"
                          onClick={async (e) => { e.stopPropagation(); await fetchEventDetails(event.id); setDepositDialogOpen(true); }}>
                          <DollarSign className="h-4 w-4 mr-1.5" /> Add to my pool
                        </Button>
                      );
                    }
                    if (!event.allowExternalLp) {
                      return (
                        <Button className="w-full h-10 rounded-xl bg-muted text-muted-foreground font-semibold" disabled>
                          <LockKeyhole className="h-4 w-4 mr-1.5" /> Private pool
                        </Button>
                      );
                    }
                    return (
                      <Button
                        className="w-full h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm"
                        onClick={async (e) => { e.stopPropagation(); await fetchEventDetails(event.id); setDepositDialogOpen(true); }}>
                        Provide liquidity
                        <ArrowRight className="h-4 w-4 ml-1.5" />
                      </Button>
                    );
                  })()}
                </div>
              </div>
              );
            })}

            {myDeposits.length > 0 && (
              <Collapsible defaultOpen>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between px-4 py-3.5 bg-card rounded-2xl border border-gray-100 dark:border-border/40 hover:border-primary/30 hover:shadow-[0_2px_8px_-2px_rgba(26,68,128,0.08)] transition-all mt-2 group">
                    <div className="flex items-center gap-2.5">
                      <span className="h-7 w-7 rounded-full bg-primary/10 inline-flex items-center justify-center">
                        <DollarSign className="h-3.5 w-3.5 text-primary" />
                      </span>
                      <span className="text-[14px] font-semibold tracking-tight">My deposits</span>
                      <Badge variant="outline" className="text-[10px] rounded-full border-gray-200 dark:border-border/60 font-mono-data tabular-nums">
                        {myDeposits.length}
                      </Badge>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground group-data-[state=open]:rotate-180 transition-transform" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-2.5 mt-2.5">
                    {myDeposits.map(dep => {
                      const earned = dep.premiumsEarned;
                      const claimed = dep.premiumsClaimed;
                      const claimable = earned - claimed;
                      const depEvent = events.find(e => e.id === dep.eventId);
                      const isStillActive = depEvent?.status === "open" && new Date() < depEvent.expiryDate;
                      const poolShare = depEvent && depEvent.totalLiquidity > 0 ? ((dep.amount / depEvent.totalLiquidity) * 100) : 0;
                      return (
                        <div key={dep.id} className={`rounded-2xl bg-card border ${claimable > 0 ? 'border-emerald-200 dark:border-emerald-500/30 ring-1 ring-emerald-200/40 dark:ring-emerald-500/20' : 'border-gray-100 dark:border-border/40'}`}>
                          <div className="p-4 space-y-3">
                            <div className="flex items-start gap-3">
                              <div className="h-10 w-10 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 flex items-center justify-center shrink-0">
                                <DollarSign className="h-4 w-4 text-amber-600 dark:text-amber-400" strokeWidth={2} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">
                                  Event #{dep.eventId} {depEvent && <>· {depEvent.underlying}</>}
                                </p>
                                <p className="text-[13.5px] font-semibold tracking-tight mt-0.5 truncate">{depEvent?.name || `Pool #${dep.eventId}`}</p>
                                <p className="text-[10.5px] text-muted-foreground font-mono-data tabular-nums mt-0.5">
                                  ${dep.amount.toLocaleString()} · {poolShare.toFixed(2)}% of pool
                                </p>
                              </div>
                              {dep.withdrawn ? (
                                <Badge variant="outline" className="text-[9.5px] rounded-full font-semibold bg-muted/60 text-muted-foreground border-gray-200 dark:border-border/60 shrink-0">
                                  Withdrawn
                                </Badge>
                              ) : isStillActive ? (
                                <Badge variant="outline" className="text-[9.5px] rounded-full font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/20 shrink-0 flex items-center gap-1">
                                  <Lock className="h-2.5 w-2.5" /> Locked
                                </Badge>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-[11px] h-7 rounded-lg border-gray-200 dark:border-border/60 font-semibold shrink-0"
                                  onClick={() => withdrawMutation.mutate(dep.id)}
                                  disabled={withdrawMutation.isPending}>
                                  <Unlock className="h-3 w-3 mr-1" />
                                  {withdrawMutation.isPending ? (txStep || 'Sending…') : 'Withdraw'}
                                </Button>
                              )}
                            </div>

                            {(earned > 0 || claimable > 0) && (
                              <div className="rounded-xl border border-gray-100 dark:border-border/40 bg-muted/30 px-3 py-2.5 space-y-2">
                                <div className="flex items-baseline justify-between">
                                  <div className="space-y-0.5">
                                    <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Premiums earned</p>
                                    <p className="text-[16px] font-semibold font-mono-data text-emerald-700 dark:text-emerald-400 tabular-nums">${earned.toFixed(2)}</p>
                                  </div>
                                  {claimable > 0 && (
                                    <Button
                                      size="sm"
                                      className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-[11.5px] px-3 rounded-lg font-semibold"
                                      onClick={() => claimPremiumsMutation.mutate(dep.id)}
                                      disabled={claimPremiumsMutation.isPending}>
                                      <CheckCircle2 className="h-3 w-3 mr-1" strokeWidth={2.2} />
                                      {claimPremiumsMutation.isPending ? (txStep || 'Sending…') : `Claim $${(claimable * (1 - (feeConfig?.lpProfitFeeRate || 0.01))).toFixed(2)}`}
                                    </Button>
                                  )}
                                </div>
                                {claimable > 0 && (
                                  <div className="text-[10px] text-muted-foreground/80 flex justify-between border-t border-gray-200/60 dark:border-border/30 pt-1.5">
                                    <span className="font-mono-data tabular-nums">Claimable ${claimable.toFixed(2)}</span>
                                    <span className="font-mono-data tabular-nums">Fee {(feeConfig ? feeConfig.lpProfitFeeRate * 100 : 1).toFixed(0)}% · ${(claimable * (feeConfig?.lpProfitFeeRate || 0.01)).toFixed(4)}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </TabsContent>

          <TabsContent value="my-events" className="space-y-3">
            {events.filter(e => e.creator.toLowerCase() === wallet?.address?.toLowerCase()).length === 0 ? (
              <div className="text-center py-14 px-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 mx-auto mb-3 flex items-center justify-center">
                  <Settings className="h-6 w-6 text-primary" strokeWidth={1.8} />
                </div>
                <p className="text-[15px] font-semibold tracking-tight">No pools created</p>
                <p className="text-[12px] text-muted-foreground mt-1">Create a pool to start earning premiums from hedgers.</p>
                <Button
                  onClick={() => setCreateEventDialogOpen(true)}
                  className="mt-4 h-9 rounded-xl text-[12.5px] font-semibold"
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-1.5" strokeWidth={2.2} /> Create your first pool
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const myEvents = events.filter(e => e.creator.toLowerCase() === wallet?.address?.toLowerCase());
                  const totalPremiums = myEvents.reduce((sum, e) => sum + e.totalPremiums, 0);
                  const totalLoyalty = myEvents.reduce((sum, e) => sum + e.creatorEarnings, 0);
                  return (
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="rounded-2xl border border-gray-100 dark:border-border/40 px-3.5 py-3">
                        <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Pool premiums</p>
                        <p className="bfx-display text-[20px] font-semibold font-mono-data text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">${totalPremiums.toFixed(2)}</p>
                      </div>
                      <div className="rounded-2xl border border-gray-100 dark:border-border/40 px-3.5 py-3">
                        <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Loyalty earnings</p>
                        <p className="bfx-display text-[20px] font-semibold font-mono-data text-amber-700 dark:text-amber-400 tabular-nums mt-0.5">${totalLoyalty.toFixed(2)}</p>
                      </div>
                    </div>
                  );
                })()}
                {events.filter(e => e.creator.toLowerCase() === wallet?.address?.toLowerCase()).map(event => {
                  const cls = getAssetClass(event.underlying);
                  const clsTone = cls === 'fx' ? { dot: 'bg-blue-400',   label: 'text-blue-600 dark:text-blue-400' }
                               : cls === 'commodity' ? { dot: 'bg-amber-400', label: 'text-amber-600 dark:text-amber-400' }
                               : { dot: 'bg-purple-400', label: 'text-purple-600 dark:text-purple-400' };
                  const isLive = event.status === 'open' && new Date() < event.expiryDate;
                  return (
                  <div key={event.id} className="rounded-2xl bg-card border border-gray-100 dark:border-border/40">
                    <div className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="h-11 w-11 rounded-2xl bg-primary/8 border border-primary/15 flex items-center justify-center shrink-0 font-mono-data text-[11px] font-semibold text-primary tracking-tight">
                          {event.underlying.split('/')[0].slice(0, 3)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-semibold ${clsTone.label}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${clsTone.dot}`} />
                              {cls === 'fx' ? 'FX' : cls === 'commodity' ? 'Commodity' : 'Crypto'}
                            </span>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="text-[10.5px] text-muted-foreground font-mono-data font-medium tabular-nums">strike {event.strike.toFixed(2)}</span>
                          </div>
                          <p className="bfx-display text-[14.5px] font-semibold tracking-tight leading-tight mt-0.5 truncate">{event.name}</p>
                        </div>
                        <Badge variant="outline" className={`text-[9.5px] rounded-full font-semibold shrink-0 ${
                          event.status === 'open'
                            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/20'
                            : event.status === 'settled'
                            ? 'bg-primary/8 text-primary border-primary/20'
                            : 'bg-muted/60 text-muted-foreground border-gray-200 dark:border-border/60'
                        }`}>
                          {event.status === 'open' ? 'Active' : event.status}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        <div className="rounded-xl bg-muted/30 px-2 py-2">
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Pool</p>
                          <p className="text-[12px] font-semibold font-mono-data tabular-nums mt-0.5">${event.totalLiquidity.toLocaleString()}</p>
                        </div>
                        <div className="rounded-xl bg-muted/30 px-2 py-2">
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Available</p>
                          <p className="text-[12px] font-semibold font-mono-data text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">${event.availableCapacity.toLocaleString()}</p>
                        </div>
                        <div className="rounded-xl bg-muted/30 px-2 py-2">
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Hedgers</p>
                          <p className="text-[12px] font-semibold font-mono-data tabular-nums mt-0.5">{event.hedgerCount}</p>
                        </div>
                        <div className="rounded-xl bg-muted/30 px-2 py-2">
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Premiums</p>
                          <p className="text-[12px] font-semibold font-mono-data text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">${event.totalPremiums.toFixed(2)}</p>
                        </div>
                      </div>

                      {isLive && (
                        <div className="flex items-center justify-between rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2">
                          <span className="text-[10.5px] text-muted-foreground flex items-center gap-1.5">
                            <Clock className="h-3 w-3" /> Expires in
                          </span>
                          <span className="text-[12px] font-mono-data tabular-nums font-semibold">
                            <CountdownTimer expiryDate={event.expiryDate} />
                          </span>
                        </div>
                      )}

                      {event.status === 'open' && new Date() >= event.expiryDate && (
                        <div className="rounded-xl border border-amber-100 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/5 px-3 py-2.5 space-y-2">
                          <p className="text-[11.5px] text-amber-900 dark:text-amber-300 font-semibold flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5" /> Pool expired — funds locked on-chain
                          </p>
                          {event.hedgerCount === 0 ? (
                            <>
                              <p className="text-[10.5px] text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
                                Nobody bought protection. Recover your seeded liquidity.
                              </p>
                              <Button
                                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold h-9 text-[12.5px] rounded-xl"
                                onClick={() => recoverExpiredMutation.mutate(event.id)}
                                disabled={recoverExpiredMutation.isPending}>
                                {recoverExpiredMutation.isPending ? (txStep || 'Processing…') : 'Withdraw my funds'}
                              </Button>
                            </>
                          ) : (
                            <p className="text-[10.5px] text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
                              {event.hedgerCount} buyer{event.hedgerCount !== 1 ? 's' : ''} settled — oracle is processing. Your withdrawal opens once settlement completes.
                            </p>
                          )}
                        </div>
                      )}

                      {isLive && (
                        <div className="rounded-xl border border-gray-100 dark:border-border/40 p-3 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11.5px] flex items-center gap-1.5 font-medium">
                              {event.poolOpen
                                ? <Unlock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                : <Lock className="h-3.5 w-3.5 text-red-500" />}
                              Open to hedgers
                            </span>
                            <Switch checked={event.poolOpen ?? true}
                              onCheckedChange={v => { togglePoolMutation.mutate({ eventId: event.id, poolOpen: v }); }}
                              disabled={togglePoolMutation.isPending} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11.5px] flex items-center gap-1.5 font-medium">
                              {event.allowExternalLp
                                ? <Globe className="h-3.5 w-3.5 text-blue-500" />
                                : <LockKeyhole className="h-3.5 w-3.5 text-amber-500" />}
                              Allow other LPs
                            </span>
                            <Switch checked={event.allowExternalLp ?? true}
                              onCheckedChange={v => { togglePoolMutation.mutate({ eventId: event.id, allowExternalLp: v }); }}
                              disabled={togglePoolMutation.isPending} />
                          </div>
                        </div>
                      )}

                      {isLive && (
                        <Button
                          className="w-full h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm"
                          onClick={async () => { await fetchEventDetails(event.id); setDepositDialogOpen(true); }}>
                          <DollarSign className="h-4 w-4 mr-1.5" /> Add liquidity to my pool
                        </Button>
                      )}

                      {(event.status === 'settled' || event.status === 'expired') && (
                        <div className="flex items-center justify-between rounded-xl bg-muted/30 px-3 py-2.5">
                          <span className="text-[11.5px] text-muted-foreground">
                            Settlement: <span className="font-mono-data tabular-nums font-semibold text-foreground">{event.settlementPrice ? event.settlementPrice.toFixed(2) : '—'}</span>
                          </span>
                          <Badge variant="outline" className={`text-[10px] rounded-full font-semibold ${
                            event.triggered
                              ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-100 dark:border-red-500/20'
                              : 'bg-muted/60 text-muted-foreground border-gray-200 dark:border-border/60'
                          }`}>
                            {event.triggered ? 'Triggered' : 'Not triggered'}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="my-hedges" className="space-y-3">
            {myPositions.length === 0 ? (
              <div className="text-center py-14 px-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 mx-auto mb-3 flex items-center justify-center">
                  <Shield className="h-6 w-6 text-primary" strokeWidth={1.8} />
                </div>
                <p className="text-[15px] font-semibold tracking-tight">No positions yet</p>
                <p className="text-[12px] text-muted-foreground mt-1">Buy cover from the Buy cover tab to open a position.</p>
                <Button
                  onClick={() => setActiveTab('hedger')}
                  className="mt-4 h-9 rounded-xl text-[12.5px] font-semibold"
                  size="sm"
                >
                  Browse pools <ArrowRight className="h-3.5 w-3.5 ml-1.5" strokeWidth={2.2} />
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {myPositions.filter(p => p.status === "active").length > 0 && (
                  <h3 className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold px-1">
                    Active positions
                  </h3>
                )}

                {myPositions.filter(p => p.status === "active").map(pos => {
                  const event = events.find(e => e.id === pos.eventId);
                  const notionalNum = pos.notional;
                  const strikeNum = event ? event.strike : 0;
                  const currentRate = (event && fxData?.rates?.[event.underlying]?.rate) || 0;
                  const grossPayout = pos.payoutAmount;
                  const estNetPayout = grossPayout > 0 ? grossPayout * 0.99 : 0;
                  const hasPayout = grossPayout > 0;
                  return (
                    <div key={pos.id} className={`rounded-2xl bg-card border ${hasPayout ? 'border-emerald-200 dark:border-emerald-500/30 ring-1 ring-emerald-200/50 dark:ring-emerald-500/20' : 'border-gray-100 dark:border-border/40'}`}>
                      <div className="p-4 space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="h-11 w-11 rounded-2xl bg-primary/8 border border-primary/15 flex items-center justify-center shrink-0 font-mono-data text-[11px] font-semibold text-primary">
                            {event?.underlying.split('/')[0].slice(0, 3) || '—'}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Position</span>
                              <span className="text-muted-foreground/40">·</span>
                              <span className="text-[10.5px] font-mono-data text-muted-foreground font-medium">#{pos.id}</span>
                            </div>
                            <p className="bfx-display text-[14.5px] font-semibold tracking-tight leading-tight mt-0.5 truncate">{event?.name || `Event #${pos.eventId}`}</p>
                            <p className="text-[11px] text-muted-foreground font-mono-data tabular-nums mt-0.5">{event?.underlying} · strike {strikeNum.toFixed(2)}</p>
                          </div>
                          <Badge variant="outline" className="text-[9.5px] rounded-full font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/20 shrink-0">
                            Active
                          </Badge>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div className="rounded-xl bg-muted/30 px-3 py-2">
                            <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Notional</p>
                            <p className="text-[13px] font-semibold font-mono-data tabular-nums mt-0.5">${notionalNum.toLocaleString()}</p>
                          </div>
                          <div className="rounded-xl bg-muted/30 px-3 py-2">
                            <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Premium paid</p>
                            <p className="text-[13px] font-semibold font-mono-data text-primary tabular-nums mt-0.5">${pos.premiumPaid.toFixed(2)}</p>
                          </div>
                          <div className="rounded-xl bg-muted/30 px-3 py-2">
                            <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Expires</p>
                            <p className="text-[12.5px] font-semibold font-mono-data tabular-nums mt-0.5">
                              {event ? <CountdownTimer expiryDate={event.expiryDate} /> : '—'}
                            </p>
                          </div>
                        </div>

                        {event && (
                          <div className={`rounded-xl p-3 border ${hasPayout ? 'bg-emerald-50/60 dark:bg-emerald-500/5 border-emerald-100 dark:border-emerald-500/20' : 'bg-muted/30 border-gray-100 dark:border-border/40'}`}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Current rate</span>
                              <span className="text-[13px] font-semibold font-mono-data tabular-nums">{currentRate > 0 ? currentRate.toFixed(4) : '…'}</span>
                            </div>
                            <div className="flex items-baseline justify-between pt-2 border-t border-gray-200/60 dark:border-border/30">
                              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">If triggered</span>
                              <span className={`bfx-display text-[18px] font-semibold font-mono-data tabular-nums ${hasPayout ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>
                                ${grossPayout > 0 ? grossPayout.toFixed(2) : '0.00'}
                                {grossPayout > 0 && <span className="text-[10px] text-muted-foreground font-normal ml-1">net ${estNetPayout.toFixed(2)}</span>}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {myPositions.filter(p => p.status === 'settled_win').map(pos => {
                  const event = events.find(e => e.id === pos.eventId);
                  const gross = pos.payoutAmount;
                  const payoutFeeRate = feeConfig?.hedgerPayoutFeeRate || 0.01;
                  const fee = gross * payoutFeeRate;
                  const net = gross - fee;
                  if (pos.claimed) return null;
                  return (
                    <div key={`win-${pos.id}`} className="rounded-2xl bg-card border border-emerald-200 dark:border-emerald-500/40 ring-1 ring-emerald-300/40 dark:ring-emerald-500/30 shadow-[0_4px_16px_-4px_rgba(16,185,129,0.2)] overflow-hidden">
                      <div className="bfx-hero-brand px-4 py-3 relative">
                        <div className="absolute inset-0 bfx-hero-brand-dotgrid opacity-40 pointer-events-none" />
                        <div className="relative flex items-center justify-between">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.14em] text-white/60 font-semibold flex items-center gap-1.5">
                              <CheckCircle2 className="h-3 w-3 text-emerald-300" /> Payout ready
                            </p>
                            <p className="bfx-display text-[24px] font-semibold font-mono-data text-emerald-300 tabular-nums mt-1">${net.toFixed(2)}</p>
                          </div>
                          <p className="text-[11px] text-white/55 font-mono-data tabular-nums text-right">
                            #{pos.id}<br />{event?.underlying}
                          </p>
                        </div>
                      </div>
                      <div className="p-4 space-y-2">
                        <div className="text-[10.5px] text-muted-foreground flex justify-between">
                          <span>Gross payout</span>
                          <span className="font-mono-data tabular-nums">${gross.toFixed(2)}</span>
                        </div>
                        <div className="text-[10.5px] text-muted-foreground flex justify-between">
                          <span>Fee ({(payoutFeeRate * 100).toFixed(0)}%)</span>
                          <span className="font-mono-data tabular-nums">−${fee.toFixed(4)}</span>
                        </div>
                        <Button className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold mt-2"
                          onClick={() => claimMutation.mutate(pos.id)}
                          disabled={claimMutation.isPending}>
                          <CheckCircle2 className="h-4 w-4 mr-1.5" strokeWidth={2.2} />
                          {claimMutation.isPending ? (txStep || 'Sending…') : `Claim $${net.toFixed(2)}`}
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {myPositions.filter(p => p.status !== "active").length > 0 && (
                  <>
                    <h3 className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold px-1 pt-2">
                      History
                    </h3>
                    {myPositions.filter(p => p.status !== "active" && !(p.status === 'settled_win' && !p.claimed)).map(pos => {
                      const event = events.find(e => e.id === pos.eventId);
                      const triggered = pos.status === "settled_win" || pos.status === "claimed";
                      return (
                        <div key={`hist-${pos.id}`} className="rounded-2xl bg-card border border-gray-100 dark:border-border/40 opacity-90">
                          <div className="p-4 space-y-2.5">
                            <div className="flex items-start justify-between">
                              <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">
                                  #{pos.id} · {event?.underlying || `Event #${pos.eventId}`}
                                </p>
                                <p className="text-[13.5px] font-semibold tracking-tight truncate mt-0.5">{event?.name}</p>
                              </div>
                              <Badge variant="outline" className={`text-[9.5px] rounded-full font-semibold shrink-0 ${
                                triggered
                                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/20'
                                  : 'bg-muted/60 text-muted-foreground border-gray-200 dark:border-border/60'
                              }`}>
                                {triggered ? (pos.status === 'claimed' ? 'Claimed' : 'Triggered') : 'Expired'}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="rounded-xl bg-muted/30 px-3 py-2">
                                <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Notional</p>
                                <p className="text-[12.5px] font-semibold font-mono-data tabular-nums mt-0.5">${pos.notional.toLocaleString()}</p>
                              </div>
                              <div className="rounded-xl bg-muted/30 px-3 py-2">
                                <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Premium</p>
                                <p className="text-[12.5px] font-semibold font-mono-data text-muted-foreground tabular-nums mt-0.5">${pos.premiumPaid.toFixed(2)}</p>
                              </div>
                              <div className="rounded-xl bg-muted/30 px-3 py-2">
                                <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">
                                  {triggered ? 'Payout' : 'Result'}
                                </p>
                                <p className={`text-[12.5px] font-semibold font-mono-data tabular-nums mt-0.5 ${triggered ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                                  {triggered ? `$${pos.payoutAmount.toFixed(2)}` : '$0.00'}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
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
        <DialogContent className="bg-card border-gray-100 dark:border-border/40 text-foreground sm:max-w-[460px] max-h-[88vh] overflow-y-auto p-0 rounded-2xl">
          {selectedEvent && (
            <>
              {/* Brand hero header */}
              <div className="relative overflow-hidden bfx-hero-brand px-6 pt-5 pb-5">
                <div className="absolute inset-0 bfx-hero-brand-dotgrid opacity-40 pointer-events-none" />
                <div className="relative">
                  <p className="text-[10.5px] uppercase tracking-[0.14em] text-white/60 font-semibold flex items-center gap-1.5">
                    <Shield className="h-3 w-3" /> Buy cover
                  </p>
                  <DialogTitle className="bfx-display text-[22px] font-semibold tracking-tight text-white mt-1.5 leading-tight">
                    {selectedEvent.name}
                  </DialogTitle>
                  <p className="text-[12px] text-white/70 font-mono-data mt-0.5">{selectedEvent.underlying}</p>
                  <div className="flex items-center gap-3 mt-4 text-[11px] text-white/75">
                    <span className="inline-flex items-center gap-1.5">
                      {selectedEvent.strikeAbove ? <TrendingUp className="h-3 w-3 text-emerald-300" strokeWidth={2.2} /> : <TrendingDown className="h-3 w-3 text-red-300" strokeWidth={2.2} />}
                      Strike <span className="font-mono-data font-semibold text-white tabular-nums">{selectedEvent.strike.toFixed(2)}</span>
                    </span>
                    <span className="text-white/30">·</span>
                    <span className="inline-flex items-center gap-1 font-mono-data tabular-nums">
                      <Clock className="h-3 w-3" /> <CountdownTimer expiryDate={selectedEvent.expiryDate} />
                    </span>
                  </div>
                </div>
              </div>

              <div className="px-6 pt-5 pb-2 space-y-4">
                {selectedEvent.description && (
                  <div className="bg-muted/40 rounded-xl p-3 border border-gray-100 dark:border-border/40">
                    <p className="text-[9.5px] text-muted-foreground mb-0.5 font-semibold uppercase tracking-[0.1em]">About</p>
                    <p className="text-[12.5px] text-foreground/90 leading-relaxed">{selectedEvent.description}</p>
                  </div>
                )}

                {/* Pool capacity bar */}
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-muted-foreground font-medium">Pool capacity</span>
                    <span className="font-mono-data tabular-nums">
                      <span className="font-semibold text-foreground">${selectedEvent.availableCapacity.toLocaleString()}</span>
                      <span className="text-muted-foreground"> available</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
                    <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${Math.min(selectedEvent.utilization * 100, 100)}%` }} />
                  </div>
                </div>

                {/* Coverage input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-[12px] font-semibold tracking-tight">Coverage amount</Label>
                    <span className="text-[10.5px] text-muted-foreground">
                      Balance:{' '}
                      <span className={`font-mono-data tabular-nums ${tokenBalanceNum < totalCostCalc && totalCostCalc > 0 ? 'text-destructive font-semibold' : 'text-foreground font-semibold'}`}>
                        {selectedEventTokenBalance !== undefined ? parseFloat(selectedEventTokenBalance).toFixed(2) : '…'} {eventTokenSymbol}
                      </span>
                    </span>
                  </div>
                  <div className="relative">
                    <Input
                      type="number" min="10" step="1" placeholder="100"
                      value={notional} onChange={e => setNotional(e.target.value)}
                      className="h-12 text-[18px] font-semibold font-mono-data tabular-nums pr-20 rounded-xl border-gray-200 dark:border-border/60"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground font-semibold">
                      {eventTokenSymbol}
                    </span>
                  </div>
                  {tokenBalanceNum < totalCostCalc && totalCostCalc > 0 && (
                    <p className="text-[11px] text-destructive font-medium mt-1.5 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Insufficient {eventTokenSymbol} balance
                    </p>
                  )}
                </div>

                {notional && parseFloat(notional) >= 10 && (
                  <div className="rounded-2xl border border-gray-100 dark:border-border/40 bg-muted/30 p-4 space-y-2.5">
                    <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Cost breakdown</p>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[12.5px]">
                        <span className="text-muted-foreground">Coverage</span>
                        <span className="font-mono-data tabular-nums font-medium">${parseFloat(notional).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between text-[12.5px]">
                        <span className="text-muted-foreground">Premium ({(selectedEvent.premiumRate * 100).toFixed(1)}%)</span>
                        <span className="font-mono-data tabular-nums font-medium">${premiumCalc.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-[12.5px]">
                        <span className="text-muted-foreground">Platform fee ({(hedgerFeeRate * 100).toFixed(1)}%)</span>
                        <span className="font-mono-data tabular-nums font-medium text-amber-700 dark:text-amber-400">${hedgerFeeCalc.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="border-t border-gray-200 dark:border-border/50 pt-2.5 flex items-baseline justify-between">
                      <span className="text-[12px] font-semibold">You pay</span>
                      <span className="bfx-display text-[22px] font-semibold font-mono-data tabular-nums text-primary">${totalCostCalc.toFixed(2)}</span>
                    </div>
                    {payoutPercent > 0 && (
                      <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-xl px-3 py-2.5">
                        <div className="flex items-baseline justify-between mb-0.5">
                          <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">If strike hit</span>
                          <span className="text-[10px] text-emerald-700/70 dark:text-emerald-400/70 font-mono-data tabular-nums">{(payoutPercent * 100).toFixed(1)}%</span>
                        </div>
                        <div className="bfx-display text-[20px] font-semibold font-mono-data tabular-nums text-emerald-700 dark:text-emerald-300">
                          ${netPredeterminedPayout.toFixed(2)}
                        </div>
                        <p className="text-[10px] text-emerald-700/70 dark:text-emerald-400/70 mt-1">
                          Net payout after 1% fee · fixed at purchase
                        </p>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground/80 leading-relaxed pt-1">
                      One-touch: pays out when {selectedEvent.underlying} touches {selectedEvent.strike.toFixed(2)}.
                      Initial rate {selectedEvent.initialRate?.toFixed(4) || 'N/A'} · current {currentRate ? currentRate.toFixed(4) : '…'}.
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter className="px-6 py-4 border-t border-gray-100 dark:border-border/40 flex-col sm:flex-row gap-2 mt-2">
                <Button variant="outline" onClick={() => setBuyDialogOpen(false)} className="w-full sm:w-auto rounded-xl border-gray-200 dark:border-border/60">Cancel</Button>
                <Button onClick={guardedBuyProtection}
                  disabled={!notional || parseFloat(notional) < 10 || buyProtectionMutation.isPending || (selectedEventTokenBalance !== undefined && tokenBalanceNum < totalCostCalc && totalCostCalc > 0)}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground w-full sm:w-auto rounded-xl font-semibold h-10">
                  {buyProtectionMutation.isPending ? (txStep || 'Approving…')
                    : selectedEventTokenBalance !== undefined && tokenBalanceNum < totalCostCalc && totalCostCalc > 0
                      ? `Insufficient ${eventTokenSymbol}`
                      : <>Pay ${totalCostCalc.toFixed(2)} · Buy cover <ArrowRight className="h-4 w-4 ml-1.5" strokeWidth={2.2} /></>}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={depositDialogOpen} onOpenChange={setDepositDialogOpen}>
        <DialogContent className="bg-card border-gray-100 dark:border-border/40 text-foreground sm:max-w-[460px] max-h-[88vh] overflow-y-auto p-0 rounded-2xl">
          {selectedEvent && (
            <>
              {/* Brand hero header — APY-first */}
              <div className="relative overflow-hidden bfx-hero-brand px-6 pt-5 pb-5">
                <div className="absolute inset-0 bfx-hero-brand-dotgrid opacity-40 pointer-events-none" />
                <div className="relative">
                  <p className="text-[10.5px] uppercase tracking-[0.14em] text-white/60 font-semibold flex items-center gap-1.5">
                    <DollarSign className="h-3 w-3" /> Provide cover · Earn premium
                  </p>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="bfx-display text-[36px] font-semibold tracking-tight text-emerald-300 leading-none font-mono-data tabular-nums">
                      {(selectedEvent.premiumRate * 100).toFixed(1)}%
                    </span>
                    <span className="text-[12px] text-white/60 font-semibold uppercase tracking-wider">per cover sold</span>
                  </div>
                  <DialogTitle className="text-[15px] font-semibold tracking-tight text-white mt-3 leading-tight">
                    {selectedEvent.name}
                  </DialogTitle>
                  <p className="text-[12px] text-white/70 font-mono-data mt-0.5">{selectedEvent.underlying} · pays in {eventTokenSymbol}</p>
                </div>
              </div>

              <div className="px-6 pt-5 pb-2 space-y-4">
                {/* Pool stats */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2.5">
                    <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Pool size</p>
                    <p className="text-[15px] font-semibold font-mono-data text-foreground tabular-nums mt-0.5">${selectedEvent.totalLiquidity.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2.5">
                    <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Utilization</p>
                    <p className="text-[15px] font-semibold font-mono-data text-foreground tabular-nums mt-0.5">{(selectedEvent.utilization * 100).toFixed(1)}%</p>
                  </div>
                </div>

                {/* Deposit input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-[12px] font-semibold tracking-tight">Deposit amount</Label>
                    <span className="text-[10.5px] text-muted-foreground">
                      Balance:{' '}
                      <span className={`font-mono-data tabular-nums ${depositAmount && parseFloat(depositAmount) > tokenBalanceNum ? 'text-destructive font-semibold' : 'text-foreground font-semibold'}`}>
                        {selectedEventTokenBalance !== undefined ? parseFloat(selectedEventTokenBalance).toFixed(2) : '…'} {eventTokenSymbol}
                      </span>
                    </span>
                  </div>
                  <div className="relative">
                    <Input
                      type="number" min="10" step="1" placeholder="500"
                      value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                      className="h-12 text-[18px] font-semibold font-mono-data tabular-nums pr-20 rounded-xl border-gray-200 dark:border-border/60"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground font-semibold">
                      {eventTokenSymbol}
                    </span>
                  </div>
                  {depositAmount && parseFloat(depositAmount) > tokenBalanceNum && (
                    <p className="text-[11px] text-destructive font-medium mt-1.5 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Insufficient {eventTokenSymbol} balance
                    </p>
                  )}
                </div>

                {depositAmount && parseFloat(depositAmount) >= 10 && (
                  <div className="rounded-2xl border border-gray-100 dark:border-border/40 bg-muted/30 p-4 space-y-2">
                    <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Summary</p>
                    <div className="flex justify-between text-[12.5px]">
                      <span className="text-muted-foreground">Deposit</span>
                      <span className="font-mono-data tabular-nums font-medium">${parseFloat(depositAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-[12.5px]">
                      <span className="text-muted-foreground">Deposit fee</span>
                      <span className="font-mono-data tabular-nums font-medium text-emerald-700 dark:text-emerald-400">$0.00 · none</span>
                    </div>
                    <div className="border-t border-gray-200 dark:border-border/50 pt-2 flex items-baseline justify-between">
                      <span className="text-[12px] font-semibold">You deposit</span>
                      <span className="bfx-display text-[22px] font-semibold font-mono-data tabular-nums text-primary">
                        ${parseFloat(depositAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/80 leading-relaxed pt-1">
                      Profit fee: {feeConfig ? (feeConfig.lpProfitFeeRate * 100).toFixed(0) : '1'}% on premiums earned, taken at withdrawal.
                    </p>
                  </div>
                )}

                {/* Risk / Reward strip */}
                <div className="grid grid-cols-1 gap-2">
                  <div className="rounded-xl border border-emerald-100 dark:border-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-500/5 px-3 py-2.5 flex items-start gap-2.5">
                    <span className="h-6 w-6 rounded-full bg-emerald-100 dark:bg-emerald-500/15 inline-flex items-center justify-center shrink-0">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" strokeWidth={2.2} />
                    </span>
                    <div>
                      <p className="text-[12px] font-semibold text-emerald-900 dark:text-emerald-200">Reward</p>
                      <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 leading-snug">
                        Share of premiums, proportional to your deposit.
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-amber-100 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/5 px-3 py-2.5 flex items-start gap-2.5">
                    <span className="h-6 w-6 rounded-full bg-amber-100 dark:bg-amber-500/15 inline-flex items-center justify-center shrink-0">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" strokeWidth={2.2} />
                    </span>
                    <div>
                      <p className="text-[12px] font-semibold text-amber-900 dark:text-amber-200">Risk</p>
                      <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 leading-snug">
                        Payout to hedgers if rate touches strike ({selectedEvent.strike.toFixed(2)}).
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter className="px-6 py-4 border-t border-gray-100 dark:border-border/40 flex-col sm:flex-row gap-2 mt-2">
                <Button variant="outline" onClick={() => setDepositDialogOpen(false)} className="w-full sm:w-auto rounded-xl border-gray-200 dark:border-border/60">Cancel</Button>
                <Button onClick={guardedDeposit}
                  disabled={!depositAmount || parseFloat(depositAmount) < 10 || depositMutation.isPending || (selectedEventTokenBalance !== undefined && depositAmount !== "" && parseFloat(depositAmount) > tokenBalanceNum)}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground w-full sm:w-auto rounded-xl font-semibold h-10">
                  {depositMutation.isPending ? (txStep || 'Approving…')
                    : selectedEventTokenBalance !== undefined && depositAmount !== "" && parseFloat(depositAmount) > tokenBalanceNum
                      ? `Insufficient ${eventTokenSymbol}`
                      : <>Deposit ${depositAmount ? parseFloat(depositAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'} <ArrowRight className="h-4 w-4 ml-1.5" strokeWidth={2.2} /></>}
                </Button>
              </DialogFooter>
            </>
          )}
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
            {/* Network selector */}
            <div>
              <Label className="text-muted-foreground text-xs">Deploy on Network</Label>
              <div className="flex gap-1.5 mt-1">
                {NETWORKS.map(net => (
                  <button key={net.id} type="button"
                    onClick={() => updateSettings({ selectedNetworkId: net.id })}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      selectedNetworkId === net.id
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'bg-muted text-muted-foreground border-border hover:bg-accent/50'
                    }`}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: net.color }} />
                    {net.name}
                  </button>
                ))}
              </div>
            </div>

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

            {/* Coverage presets — auto-fill strike + cap based on the user's intent.
                Spot is read from fxData.rates[underlying]; if not loaded yet, buttons are disabled. */}
            {fxData?.rates[newEvent.underlying] && (() => {
              const spot = fxData.rates[newEvent.underlying].rate;
              const isUp = newEvent.direction === "up";
              const presets = [
                {
                  key: "full",
                  label: "Full coverage",
                  sub: "Strike at spot, cap +25%",
                  strike: spot,
                  cap: isUp ? spot * 1.25 : spot * 0.75,
                },
                {
                  key: "moderate",
                  label: "Moderate (5% deductible)",
                  sub: "Cheaper, ~80% of FX loss covered",
                  strike: isUp ? spot * 1.05 : spot * 0.95,
                  cap:    isUp ? spot * 1.20 : spot * 0.80,
                },
                {
                  key: "speculative",
                  label: "Speculative",
                  sub: "Cheap, lottery-ticket payout",
                  strike: isUp ? spot * 1.10 : spot * 0.90,
                  cap:    isUp ? spot * 1.15 : spot * 0.85,
                },
              ];
              return (
                <div>
                  <Label className="text-muted-foreground text-xs">Coverage preset</Label>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    {presets.map(p => (
                      <button key={p.key} type="button"
                        onClick={() => setNewEvent(prev => ({
                          ...prev,
                          strike: p.strike.toFixed(4),
                          payoutCap: p.cap.toFixed(4),
                        }))}
                        className="flex flex-col items-start py-2 px-3 rounded-md border border-border bg-muted text-left hover:border-primary/50 transition-colors">
                        <span className="text-xs font-medium text-foreground">{p.label}</span>
                        <span className="text-[10px] text-muted-foreground/70 mt-0.5">{p.sub}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    Or set strike + cap manually below.
                  </p>
                </div>
              );
            })()}

            <div>
              <Label className="text-muted-foreground">Strike Price</Label>
              <Input type="number" step="0.01" value={newEvent.strike}
                onChange={e => setNewEvent(p => ({ ...p, strike: e.target.value }))}
                placeholder={fxData?.rates[newEvent.underlying] ? `e.g. ${fxData.rates[newEvent.underlying].rate.toFixed(2)}` : "e.g. 16.00"}
                className="bg-muted border-border text-foreground mt-1" />
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                {newEvent.direction === "up"
                  ? "Set above the current rate. Payouts begin when price reaches this level."
                  : "Set below the current rate. Payouts begin when price reaches this level."}
              </p>
            </div>

            {/* v7: Payout Cap — far edge of the payout range. */}
            <div>
              <Label className="text-muted-foreground">Payout Cap</Label>
              <Input type="number" step="0.01" value={newEvent.payoutCap}
                onChange={e => setNewEvent(p => ({ ...p, payoutCap: e.target.value }))}
                placeholder={
                  newEvent.strike
                    ? `e.g. ${(parseFloat(newEvent.strike) * (newEvent.direction === "up" ? 1.05 : 0.95)).toFixed(2)}`
                    : "(set strike first)"
                }
                className="bg-muted border-border text-foreground mt-1" />
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                {newEvent.direction === "up"
                  ? "Set ABOVE the strike. Payout grows linearly between strike and cap, then flattens. Bounds LP loss."
                  : "Set BELOW the strike. Payout grows linearly between strike and cap, then flattens. Bounds LP loss."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-muted-foreground text-xs">Premium %</Label>
                <Input type="number" step="0.1" value={newEvent.premiumRate}
                  onChange={e => setNewEvent(p => ({ ...p, premiumRate: e.target.value }))}
                  placeholder={suggestedPctRate !== null ? suggestedPctRate.toFixed(2) : "2.5"}
                  className="bg-muted border-border text-foreground mt-1" />
                {/* v8: pricing-engine quote indicator next to the premium input */}
                {pricingQuoteLoading && (
                  <p className="text-[10px] text-muted-foreground/70 mt-1 italic">Computing fair-value quote…</p>
                )}
                {!pricingQuoteLoading && suggestedPctRate !== null && (
                  <button
                    type="button"
                    className="text-[10px] mt-1 underline text-primary hover:text-primary/80"
                    onClick={() => setNewEvent(p => ({ ...p, premiumRate: suggestedPctRate.toFixed(3) }))}
                  >
                    Use suggested: {suggestedPctRate.toFixed(3)}%
                  </button>
                )}
                {!pricingQuoteLoading && pricingQuoteError && (
                  <p className="text-[10px] text-amber-400 mt-1">Quote unavailable: {pricingQuoteError}</p>
                )}
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


            {/* v8: Pricing-engine quote card — shows the math behind the suggested premium. */}
            {pricingQuote && (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary">Suggested premium (fair value)</span>
                  <span className="text-sm font-bold text-primary">
                    {(pricingQuote.premiumRate * 100).toFixed(3)}% &middot; ${pricingQuote.premiumUsd.toFixed(2)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                  <span>Spot:</span>            <span className="font-mono">{pricingQuote.breakdown.spot}</span>
                  <span>Range width:</span>     <span className="font-mono">{pricingQuote.breakdown.rangeWidth.toFixed(4)}</span>
                  <span>Time to expiry:</span>  <span className="font-mono">{pricingQuote.breakdown.T_days.toFixed(1)} days</span>
                  <span>USD risk-free (r):</span><span className="font-mono">{(pricingQuote.breakdown.inputs.r * 100).toFixed(2)}%</span>
                  <span>Empirical drift (μ):</span>
                  <span className="font-mono">
                    {pricingQuote.breakdown.inputs.mu === null ? "n/a" : (pricingQuote.breakdown.inputs.mu * 100).toFixed(2) + "%/yr"}
                  </span>
                  <span>Vol (σ, post-markup):</span><span className="font-mono">{(pricingQuote.breakdown.inputs.sigma * 100).toFixed(2)}%</span>
                  <span>Vol markup tier:</span>  <span className="font-mono">{pricingQuote.breakdown.pairClassification.tier}</span>
                  <span>Max payout:</span>      <span className="font-mono">${pricingQuote.maxPayoutUsd.toFixed(2)}</span>
                  {/* Coverage: % of underlying FX loss the hedge offsets at the cap.
                      Colour-code so users instantly see whether they're getting a partial or full hedge. */}
                  {typeof pricingQuote.breakdown.coveragePercent === "number" && (() => {
                    const pct = pricingQuote.breakdown.coveragePercent;
                    const tone =
                      pct >= 0.95 ? "text-emerald-400" :
                      pct >= 0.50 ? "text-amber-300"  :
                                    "text-red-400";
                    const label =
                      pct >= 0.95 ? "Full coverage" :
                      pct >= 0.50 ? "Partial coverage" :
                                    "Lottery-ticket — most FX loss uncovered";
                    return (
                      <>
                        <span>Coverage at cap:</span>
                        <span className={`font-mono ${tone}`}>
                          {(pct * 100).toFixed(1)}% — {label}
                        </span>
                      </>
                    );
                  })()}
                </div>
                {pricingQuote.attestation ? (
                  <p className="text-[9px] text-emerald-400">
                    ✓ Cryptographically signed by pricing engine ({pricingQuote.attestation.signerAddress.slice(0, 10)}…) — accepted on-chain.
                  </p>
                ) : (
                  <p className="text-[9px] text-amber-400">
                    ⚠ Quote unsigned (PRICING_ENGINE_PRIVATE_KEY not configured server-side). On-chain submission will fail if a signer is registered.
                  </p>
                )}
              </div>
            )}

            {/* v8: Override-warning if user types premium below the engine's quote. */}
            {isPremiumBelowSuggested && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 space-y-2">
                <p className="text-xs font-semibold text-red-400">
                  Premium is more than 10% below the suggested fair value of {suggestedPctRate?.toFixed(3)}%.
                </p>
                <p className="text-[10px] text-red-400/80">
                  Liquidity providers backing this event will earn less than the model thinks the risk is worth.
                  You are committing to underwrite this loss yourself if you proceed.
                </p>
                <label className="flex items-center gap-2 text-[10px] text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newEvent.overrideAcknowledged}
                    onChange={e => setNewEvent(p => ({ ...p, overrideAcknowledged: e.target.checked }))}
                    className="rounded"
                  />
                  I understand and accept the risk of underwriting at a below-fair price.
                </label>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground/70">
              Range payout: payout grows linearly between strike and cap, then flattens. Maximum LP loss = Notional × (Cap − Strike) / Initial Rate.
              {fxData?.rates[newEvent.underlying] && newEvent.strike && parseFloat(newEvent.strike) > fxData.rates[newEvent.underlying].rate ? (
                <span className="text-green-400 font-semibold"> Payout = {(((parseFloat(newEvent.strike) - fxData.rates[newEvent.underlying].rate) / fxData.rates[newEvent.underlying].rate) * 100).toFixed(1)}% of notional.</span>
              ) : null}
              {' '}If strike is never touched before expiry, LPs keep all premiums.
            </p>

            <div>
              <Label className="text-muted-foreground text-xs">Payment Currency <span className="text-red-400">*</span></Label>
              <Select
                value={newEvent.paymentCurrency}
                onValueChange={v => setNewEvent(p => ({ ...p, paymentCurrency: v as "USDC" | "USDT" }))}
              >
                <SelectTrigger className="bg-muted border-border text-foreground mt-1">
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USDC" textValue="USDC">
                    <div className="flex items-center gap-2">
                      <span className="text-blue-400 font-semibold">USDC</span>
                      <span className="text-muted-foreground text-xs">
                        USD Coin on {selectedNetwork.name}
                      </span>
                    </div>
                  </SelectItem>
                  {activeUsdtAddress ? (
                    <SelectItem value="USDT" textValue="USDT">
                      <div className="flex items-center gap-2">
                        <span className="text-green-400 font-semibold">USDT</span>
                        <span className="text-muted-foreground text-xs">
                          Tether USD on {selectedNetwork.name}
                        </span>
                      </div>
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              {!activeUsdtAddress && (
                <p className="text-[10px] text-amber-500/80 mt-1">
                  USDT is not available on {selectedNetwork.name}. Only USDC can be used.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                All liquidity, premiums, and payouts for this event use one currency.
              </p>
            </div>

            <div>
              <Label className="text-muted-foreground text-xs">Initial Liquidity ({newEvent.paymentCurrency}) <span className="text-red-400">*</span></Label>
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
              <span className="text-xs font-semibold text-foreground">Total {newEvent.paymentCurrency} Required</span>
              <span className="text-sm font-bold text-primary">
                ${newEvent.initialLiquidity && feeConfig ? (parseFloat(newEvent.initialLiquidity) + feeConfig.creationFee).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : feeConfig ? feeConfig.creationFee.toFixed(2) : "Loading..."}
              </span>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setCreateEventDialogOpen(false)} className="border-border text-muted-foreground w-full sm:w-auto">Cancel</Button>
            <Button onClick={() => createEventMutation.mutate()}
              disabled={
                !newEvent.name || !newEvent.strike || !newEvent.payoutCap || !newEvent.premiumRate ||
                !newEvent.initialLiquidity || parseFloat(newEvent.initialLiquidity || "0") < 10 ||
                createEventMutation.isPending ||
                // v8: if user typed a premium materially below the engine's quote, gate on the
                // explicit acknowledgement checkbox.
                (isPremiumBelowSuggested && !newEvent.overrideAcknowledged)
              }
              className="bg-primary hover:bg-primary/90 text-primary-foreground w-full sm:w-auto">
              {createEventMutation.isPending
                ? (txStep || "Preparing...")
                : `Pay $${newEvent.initialLiquidity && feeConfig ? (parseFloat(newEvent.initialLiquidity) + feeConfig.creationFee).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : feeConfig ? feeConfig.creationFee.toFixed(2) : "Loading..."} & Create`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creatorProfileOpen} onOpenChange={setCreatorProfileOpen}>
        <DialogContent className="bg-card border-gray-100 dark:border-border/40 text-foreground sm:max-w-[480px] max-h-[88vh] overflow-y-auto p-0 rounded-2xl">
          {viewingCreator && (() => {
            const stats = getCreatorStats(viewingCreator);
            const isOwnProfile = wallet?.address?.toLowerCase() === viewingCreator.toLowerCase();
            const hue = (() => {
              let n = 0;
              for (let i = 0; i < viewingCreator.length; i++) n = (n * 31 + viewingCreator.charCodeAt(i)) >>> 0;
              return n % 360;
            })();
            const initials = viewingCreator.slice(2, 4).toUpperCase();
            return (
              <>
                {/* Brand hero header with avatar */}
                <div className="relative overflow-hidden bfx-hero-brand px-6 pt-6 pb-5">
                  <div className="absolute inset-0 bfx-hero-brand-dotgrid opacity-40 pointer-events-none" />
                  <div className="relative flex items-center gap-3">
                    <div
                      className="h-14 w-14 rounded-2xl flex items-center justify-center font-mono-data text-[16px] font-bold text-white shrink-0 ring-2 ring-white/15"
                      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 50%), hsl(${(hue + 30) % 360} 70% 42%))` }}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10.5px] uppercase tracking-[0.14em] text-white/60 font-semibold">
                        {isOwnProfile ? 'Your creator profile' : 'Creator'}
                      </p>
                      <DialogTitle className="bfx-display text-[18px] font-semibold tracking-tight text-white leading-tight mt-1 truncate font-mono-data">
                        {viewingCreator.slice(0, 8)}…{viewingCreator.slice(-6)}
                      </DialogTitle>
                      <p className="text-[11px] text-white/60 font-mono-data tabular-nums mt-1">
                        {stats.creatorEvents.length} pool{stats.creatorEvents.length !== 1 ? 's' : ''} · {stats.totalHedgers} hedger{stats.totalHedgers !== 1 ? 's' : ''} served
                      </p>
                    </div>
                  </div>
                </div>

                <div className="px-6 pt-5 pb-6 space-y-4">
                  {/* Primary stats */}
                  {isOwnProfile ? (
                    <div className="grid grid-cols-3 gap-2.5">
                      <div className="rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2.5">
                        <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Pool premiums</p>
                        <p className="text-[14px] font-semibold font-mono-data text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">${stats.totalPremiums.toFixed(2)}</p>
                      </div>
                      <div className="rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2.5">
                        <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Loyalty</p>
                        <p className="text-[14px] font-semibold font-mono-data text-amber-700 dark:text-amber-400 tabular-nums mt-0.5">${stats.loyaltyEarnings.toFixed(2)}</p>
                      </div>
                      <div className="rounded-xl border border-gray-100 dark:border-border/40 px-3 py-2.5">
                        <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Liquidity</p>
                        <p className="text-[14px] font-semibold font-mono-data text-primary tabular-nums mt-0.5">${stats.totalLiquidity.toLocaleString()}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-gray-100 dark:border-border/40 px-4 py-3 flex items-baseline justify-between">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">Total liquidity</p>
                      <p className="bfx-display text-[20px] font-semibold font-mono-data text-primary tabular-nums">${stats.totalLiquidity.toLocaleString()}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-muted/30 px-3 py-2">
                      <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Pools</p>
                      <p className="text-[14px] font-semibold font-mono-data tabular-nums mt-0.5">{stats.creatorEvents.length}</p>
                    </div>
                    <div className="rounded-xl bg-muted/30 px-3 py-2">
                      <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Active</p>
                      <p className="text-[14px] font-semibold font-mono-data text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">{stats.activeEvents}</p>
                    </div>
                    <div className="rounded-xl bg-muted/30 px-3 py-2">
                      <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">Hedgers</p>
                      <p className="text-[14px] font-semibold font-mono-data tabular-nums mt-0.5">{stats.totalHedgers}</p>
                    </div>
                  </div>

                  {stats.creatorEvents.length > 0 && (
                    <div className="space-y-2.5">
                      <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Pools created</p>
                      <div className="space-y-2">
                        {stats.creatorEvents.map(event => (
                          <div key={event.id} className="rounded-2xl border border-gray-100 dark:border-border/40 p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[13.5px] font-semibold tracking-tight truncate">{event.name}</p>
                                <p className="text-[11px] text-muted-foreground font-mono-data tabular-nums mt-0.5">{event.underlying} · strike {event.strike.toFixed(2)}</p>
                              </div>
                              <Badge variant="outline" className={`text-[9.5px] rounded-full font-semibold ${
                                event.status === 'open'
                                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/20'
                                  : 'bg-muted/60 text-muted-foreground border-gray-200 dark:border-border/60'
                              }`}>
                                {event.status === 'open' ? 'Active' : event.status}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Pool</p>
                                <p className="text-[11.5px] font-semibold font-mono-data tabular-nums mt-0.5">${event.totalLiquidity.toLocaleString()}</p>
                              </div>
                              <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Hedgers</p>
                                <p className="text-[11.5px] font-semibold font-mono-data tabular-nums mt-0.5">{event.hedgerCount}</p>
                              </div>
                              <div className="rounded-lg bg-muted/40 px-2 py-1.5">
                                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Earned</p>
                                <p className="text-[11.5px] font-semibold font-mono-data text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">${event.totalPremiums.toFixed(2)}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* In-app confirmation dialog — replaces window.confirm() which is blocked in some mobile/PWA contexts */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent className="bg-card border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Transaction</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">{confirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground" onClick={() => { setConfirmDialogOpen(false); setPendingAction(null); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => { setConfirmDialogOpen(false); pendingAction?.(); setPendingAction(null); }}>Confirm & Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottomNav />
    </div>
  );
}
