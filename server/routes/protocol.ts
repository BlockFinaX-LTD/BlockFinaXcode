import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { eq } from "drizzle-orm";
import { authSessions, platformFees } from "../../shared/schema";
import { requireAdmin } from "../middleware/admin-auth";
import { strictLimiter } from "../middleware/rate-limiter";

// ── Integer financial math helpers ───────────────────────────────────────────
function toMicro(s: string | number): bigint {
  const str = String(s).trim().replace(/[^0-9.-]/g, '') || '0';
  const neg = str.startsWith('-');
  const abs = neg ? str.slice(1) : str;
  const dot = abs.indexOf('.');
  if (dot === -1) return (neg ? -1n : 1n) * BigInt(abs || '0') * 1_000_000n;
  const int = abs.slice(0, dot) || '0';
  const frac = abs.slice(dot + 1).padEnd(6, '0').slice(0, 6);
  return (neg ? -1n : 1n) * (BigInt(int) * 1_000_000n + BigInt(frac));
}

function fromMicro(n: bigint): string {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  return `${neg ? '-' : ''}${abs / 1_000_000n}.${String(abs % 1_000_000n).padStart(6, '0')}`;
}
// ─────────────────────────────────────────────────────────────────────────────

const FEE_CONFIG = {
  walletTransferPercent: 0.3,
  minimumFeeCents: 50,
  hedgePoolPercent: 0.5,
};

// Event creation fee in USD — must match on-chain initializeHedgeFees value
const EVENT_CREATION_FEE = 2;

// Server-side price cache
let cachedPrices: { eth: number; bnb: number | null; usdc: number; lastUpdated: number } | null = null;
const PRICE_CACHE_MS = 5 * 60_000;

async function fetchEthPrice(): Promise<number | null> {
  const sources = [
    async () => {
      const r = await fetch("https://www.okx.com/api/v5/market/ticker?instId=ETH-USDT", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const d = await r.json() as any;
      const p = parseFloat(d.data?.[0]?.last);
      return isFinite(p) && p > 100 ? p : null;
    },
    async () => {
      const r = await fetch("https://api.mexc.com/api/v3/ticker/price?symbol=ETHUSDT", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const d = await r.json() as any;
      const p = parseFloat(d.price);
      return isFinite(p) && p > 100 ? p : null;
    },
    async () => {
      const r = await fetch("https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const d = await r.json() as any;
      const p = d.USD;
      return isFinite(p) && p > 100 ? p : null;
    },
    async () => {
      const r = await fetch("https://api.kraken.com/0/public/Ticker?pair=ETHUSD", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const d = await r.json() as any;
      const p = parseFloat(d.result?.XETHZUSD?.c?.[0]);
      return isFinite(p) && p > 100 ? p : null;
    },
    async () => {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const d = await r.json() as any;
      const p = d.ethereum?.usd;
      return isFinite(p) && p > 100 ? p : null;
    },
  ];
  const results = await Promise.allSettled(sources.map(fn => fn()));
  for (const r of results) {
    if (r.status === "fulfilled" && r.value !== null) return r.value;
  }
  return null;
}

async function fetchBnbPrice(): Promise<number | null> {
  const sources = [
    async () => {
      const r = await fetch("https://www.okx.com/api/v5/market/ticker?instId=BNB-USDT", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const d = await r.json() as any;
      const p = parseFloat(d.data?.[0]?.last);
      return isFinite(p) && p > 10 ? p : null;
    },
    async () => {
      const r = await fetch("https://api.mexc.com/api/v3/ticker/price?symbol=BNBUSDT", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const d = await r.json() as any;
      const p = parseFloat(d.price);
      return isFinite(p) && p > 10 ? p : null;
    },
    async () => {
      const r = await fetch("https://min-api.cryptocompare.com/data/price?fsym=BNB&tsyms=USD", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const d = await r.json() as any;
      const p = d.USD;
      return isFinite(p) && p > 10 ? p : null;
    },
    async () => {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const d = await r.json() as any;
      const p = d.binancecoin?.usd;
      return isFinite(p) && p > 10 ? p : null;
    },
  ];
  const results = await Promise.allSettled(sources.map(fn => fn()));
  for (const r of results) {
    if (r.status === "fulfilled" && r.value !== null) return r.value;
  }
  return null;
}

const gasSponsorCooldown = new Map<string, number>();

export async function registerProtocolRoutes(app: Express) {
  const { fetchAllRates, getRate, getSupportedPairs, getSupportedPairsWithClass, checkAndSettleEvents, startOraclePoller } = await import("../fx-oracle");
  startOraclePoller(5 * 60 * 1000);

  // ── Gas sponsorship ──────────────────────────────────────────────────────────
  app.post("/api/gas/sponsor", strictLimiter, async (req, res) => {
    try {
      const { walletAddress, chainId } = req.body;
      if (!walletAddress) return res.status(400).json({ message: "Wallet address required" });

      const addr = walletAddress.toLowerCase();
      const now = Date.now();
      const cooldownKey = `${addr}:${chainId || 1135}`;
      const lastSponsored = gasSponsorCooldown.get(cooldownKey) || 0;
      if (now - lastSponsored < 60000) return res.json({ success: true, sponsored: false, message: "Recently sponsored" });

      const ethers = await import("ethers");
      const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
      if (!deployerKey) return res.status(500).json({ message: "Gas sponsor not configured" });

      // Select RPC based on chainId — default to Lisk
      const RPC_BY_CHAIN: Record<number, string> = {
        1135: "https://rpc.api.lisk.com",
        8453: "https://mainnet.base.org",
        56:   "https://bsc-dataseed.binance.org",
      };
      const rpc = RPC_BY_CHAIN[Number(chainId)] || "https://rpc.api.lisk.com";
      const provider = new ethers.JsonRpcProvider(rpc);

      const userBalance = await provider.getBalance(walletAddress);
      const minGasBalance = ethers.parseEther("0.001");
      if (userBalance >= minGasBalance) return res.json({ success: true, sponsored: false, message: "Sufficient gas balance" });

      const deployer = new ethers.Wallet(deployerKey, provider);
      const gasAmount = ethers.parseEther("0.005");
      const deployerBalance = await provider.getBalance(deployer.address);
      if (deployerBalance < gasAmount) return res.status(400).json({ message: "Gas sponsor wallet low on funds" });

      const tx = await deployer.sendTransaction({ to: walletAddress, value: gasAmount });
      await tx.wait();
      gasSponsorCooldown.set(cooldownKey, now);
      res.json({ success: true, sponsored: true, txHash: tx.hash, amount: "0.005" });
    } catch (error: any) {
      console.error("Gas sponsor error:", error);
      res.status(500).json({ message: error.message || "Gas sponsorship failed" });
    }
  });

  // ── Wallet transfer fees ─────────────────────────────────────────────────────
  app.get("/api/fees/calculate", (req, res) => {
    try {
      const amount = parseFloat(req.query.amount as string);
      if (isNaN(amount) || amount <= 0) return res.status(400).json({ message: "Valid amount is required" });
      const percentFee = amount * (FEE_CONFIG.walletTransferPercent / 100);
      const minimumFee = FEE_CONFIG.minimumFeeCents / 100;
      const feeAmount = Math.max(percentFee, minimumFee);
      const netAmount = Math.max(amount - feeAmount, 0);
      res.json({ transferAmount: amount, feeAmount: parseFloat(feeAmount.toFixed(6)), feePercent: FEE_CONFIG.walletTransferPercent, minimumFee, netAmount: parseFloat(netAmount.toFixed(6)) });
    } catch (error) {
      res.status(500).json({ message: "Failed to calculate fee" });
    }
  });

  app.post("/api/fees/record", async (req, res) => {
    const sessionToken = (req.headers['x-session-token'] as string) || null;
    if (!sessionToken) return res.status(401).json({ message: 'Authentication required' });
    const [sess] = await db.select().from(authSessions).where(eq(authSessions.sessionToken, sessionToken));
    if (!sess || sess.expiresAt < new Date()) return res.status(401).json({ message: 'Session expired' });

    try {
      const { txHash, feeTxHash, fromWallet, toWallet, transferAmount, token, chainId } = req.body;
      if (!txHash || !fromWallet || !toWallet || !transferAmount) return res.status(400).json({ message: "Missing required fields" });

      const amt = parseFloat(transferAmount);
      if (isNaN(amt) || amt <= 0) return res.status(400).json({ message: "Invalid transfer amount" });
      const percentFee = amt * (FEE_CONFIG.walletTransferPercent / 100);
      const minimumFee = FEE_CONFIG.minimumFeeCents / 100;
      const computedFee = Math.max(percentFee, minimumFee);

      await db.insert(platformFees).values({
        txHash, feeTxHash: feeTxHash || null, fromWallet, toWallet,
        transferAmount: amt.toFixed(6), feeAmount: computedFee.toFixed(6),
        feePercent: FEE_CONFIG.walletTransferPercent.toString(),
        token: token || "USDC", chainId: chainId || 4202,
        status: feeTxHash ? "collected" : "pending",
      });
      res.json({ success: true, feeAmount: computedFee });
    } catch (error: any) {
      console.error("Fee record error:", error);
      res.status(500).json({ message: error.message || "Failed to record fee" });
    }
  });

  // ── Price feed ───────────────────────────────────────────────────────────────
  app.get("/api/prices", async (_req, res) => {
    try {
      if (cachedPrices && Date.now() - cachedPrices.lastUpdated < PRICE_CACHE_MS) return res.json(cachedPrices);
      const [eth, bnb] = await Promise.all([fetchEthPrice(), fetchBnbPrice()]);
      if (eth !== null) {
        cachedPrices = { eth, bnb: bnb ?? cachedPrices?.bnb ?? null, usdc: 1, lastUpdated: Date.now() };
        return res.json(cachedPrices);
      }
      if (cachedPrices) return res.json(cachedPrices);
      return res.status(503).json({ error: "Price data temporarily unavailable" });
    } catch {
      if (cachedPrices) return res.json(cachedPrices);
      return res.status(503).json({ error: "Price data temporarily unavailable" });
    }
  });

  // ── FX oracle ────────────────────────────────────────────────────────────────
  app.get("/api/fx/rates", async (_req, res) => {
    try {
      const rates = await fetchAllRates();
      res.json({ rates, pairs: getSupportedPairs(), pairsWithClass: getSupportedPairsWithClass() });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch FX rates" });
    }
  });

  app.get("/api/fx/rate/:pair", async (req, res) => {
    try {
      const pair = decodeURIComponent(req.params.pair);
      const rate = await getRate(pair);
      if (!rate) return res.status(404).json({ message: `No rate for ${pair}` });
      res.json(rate);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch rate" });
    }
  });

  app.post("/api/fx/auto-settle", requireAdmin, async (req, res) => {
    try {
      const result = await checkAndSettleEvents();
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to run auto-settle" });
    }
  });

  // Oracle health status — shows what each chain's oracle can read and whether settlement is configured
  app.get("/api/oracle/status", requireAdmin, async (_req, res) => {
    try {
      const { ethers } = await import("ethers");
      const HEDGE_READ_ABI = [
        'function getTotalHedgeEvents() view returns (uint256)',
        'function isAuthorisedOracle(address) view returns (bool)',
      ];
      const CHAINS = [
        { label: 'Lisk',   chainId: 1135, diamond: process.env.DIAMOND_ADDRESS     || '0x885E663645173a0791b82f0e6608921D31E3D700', rpc: process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com' },
        { label: 'Base',   chainId: 8453, diamond: process.env.BASE_DIAMOND_ADDRESS || '', rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org' },
        { label: 'BSC',    chainId: 56,   diamond: process.env.BSC_DIAMOND_ADDRESS  || '', rpc: process.env.BSC_RPC_URL  || 'https://bsc-dataseed.binance.org' },
      ].filter(c => !!c.diamond);

      const ORACLE_WALLETS = [
        process.env.ORACLE_KEY_A,
        process.env.ORACLE_KEY_B,
        process.env.ORACLE_KEY_C,
      ].filter(Boolean).map(k => new ethers.Wallet(k!).address);

      const settlementConfigured = !!process.env.DEPLOYER_PRIVATE_KEY;

      const chainStatuses = await Promise.all(CHAINS.map(async chain => {
        try {
          const provider = new ethers.JsonRpcProvider(chain.rpc);
          const contract = new ethers.Contract(chain.diamond, HEDGE_READ_ABI, provider);
          const [totalEvents, blockNumber] = await Promise.all([
            contract.getTotalHedgeEvents().then(Number).catch(() => null),
            provider.getBlockNumber().catch(() => null),
          ]);
          const oracleChecks = await Promise.all(
            ORACLE_WALLETS.map(addr =>
              contract.isAuthorisedOracle(addr).catch(() => null)
            )
          );
          return {
            chain: chain.label,
            chainId: chain.chainId,
            diamond: chain.diamond,
            rpc: chain.rpc,
            connected: blockNumber !== null,
            blockNumber,
            totalEvents,
            hedgeFacetAvailable: totalEvents !== null,
            oracleNodes: ORACLE_WALLETS.map((addr, i) => ({
              address: addr,
              registered: oracleChecks[i],
            })),
          };
        } catch (e: any) {
          return {
            chain: chain.label,
            chainId: chain.chainId,
            diamond: chain.diamond,
            rpc: chain.rpc,
            connected: false,
            error: e?.message,
          };
        }
      }));

      res.json({
        settlementConfigured,
        oracleWallets: ORACLE_WALLETS,
        chains: chainStatuses,
        settlementPollingIntervalMs: 5 * 60 * 1000,
      });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Status check failed" });
    }
  });

  // ── Hedge events ─────────────────────────────────────────────────────────────
  app.get("/api/hedge/events", async (_req, res) => {
    try {
      const events = await storage.getAllHedgeEvents();
      const eventsWithStats = await Promise.all(events.map(async (event) => {
        const positions = await storage.getHedgePositionsByEvent(event.id);
        const deposits = await storage.getHedgeLpDepositsByEvent(event.id);
        const totalLiquidity = deposits.filter(d => !d.withdrawn).reduce((sum, d) => sum + parseFloat(d.amount), 0);
        const totalExposure = positions.filter(p => p.status === "active").reduce((sum, p) => sum + parseFloat(p.maxPayout), 0);
        const totalPremiums = positions.reduce((sum, p) => sum + parseFloat(p.premiumPaid), 0);
        const utilization = totalLiquidity > 0 ? (totalExposure / totalLiquidity) * 100 : 0;
        return {
          ...event,
          poolStats: {
            totalLiquidity, totalExposure, totalPremiums,
            utilization: Math.min(utilization, 100),
            availableCapacity: Math.max(0, totalLiquidity - totalExposure),
            lpCount: deposits.filter(d => !d.withdrawn).length,
            hedgerCount: positions.filter(p => p.status === "active").length,
          }
        };
      }));
      res.json(eventsWithStats);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch hedge events" });
    }
  });

  app.get("/api/hedge/events/open", async (_req, res) => {
    try {
      const events = await storage.getOpenHedgeEvents();
      res.json(events);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch open hedge events" });
    }
  });

  app.get("/api/hedge/events/:id", async (req, res) => {
    try {
      const event = await storage.getHedgeEvent(parseInt(req.params.id));
      if (!event) return res.status(404).json({ message: "Event not found" });
      const positions = await storage.getHedgePositionsByEvent(event.id);
      const deposits = await storage.getHedgeLpDepositsByEvent(event.id);
      const totalLiquidity = deposits.filter(d => !d.withdrawn).reduce((sum, d) => sum + parseFloat(d.amount), 0);
      const totalExposure = positions.filter(p => p.status === "active").reduce((sum, p) => sum + parseFloat(p.maxPayout), 0);
      const totalPremiums = positions.reduce((sum, p) => sum + parseFloat(p.premiumPaid), 0);
      const utilization = totalLiquidity > 0 ? (totalExposure / totalLiquidity) * 100 : 0;
      res.json({
        ...event,
        poolStats: {
          totalLiquidity, totalExposure, totalPremiums,
          utilization: Math.min(utilization, 100),
          availableCapacity: Math.max(0, totalLiquidity - totalExposure),
          lpCount: deposits.filter(d => !d.withdrawn).length,
          hedgerCount: positions.filter(p => p.status === "active").length,
        }
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch hedge event" });
    }
  });

  app.post("/api/hedge/events", async (req, res) => {
    const evtToken = (req.headers['x-session-token'] as string) || null;
    if (!evtToken) return res.status(401).json({ message: 'Authentication required' });
    const [evtSess] = await db.select().from(authSessions).where(eq(authSessions.sessionToken, evtToken));
    if (!evtSess || evtSess.expiresAt < new Date()) return res.status(401).json({ message: 'Session expired' });

    try {
      const { name, description, underlying, strike, premiumRate, payoutRate, safetyFactor, expiryDate, createdBy, poolOpen, allowExternalLp, initialLiquidity } = req.body;

      if (!name || !underlying || !strike || !premiumRate || !expiryDate || !createdBy) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      if (!initialLiquidity || parseFloat(initialLiquidity) < 10) {
        return res.status(400).json({ message: "Initial liquidity is required (minimum $10)" });
      }

      const expiry = new Date(expiryDate);
      if (expiry <= new Date()) return res.status(400).json({ message: "Expiry date must be in the future" });

      console.log(`[Event Creation Fee] $${EVENT_CREATION_FEE} charged to ${createdBy} for creating event: ${name}`);

      const event = await storage.createHedgeEvent({
        name,
        description: description || null,
        underlying,
        strike: strike.toString(),
        premiumRate: premiumRate.toString(),
        payoutRate: (payoutRate || 0.30).toString(),
        safetyFactor: "1",
        expiryDate: expiry,
        status: "open",
        poolOpen: poolOpen === true ? true : false,
        allowExternalLp: allowExternalLp !== false,
        createdBy
      });

      if (initialLiquidity && parseFloat(initialLiquidity) >= 10) {
        const amountNum = parseFloat(initialLiquidity);
        await storage.createHedgeLpDeposit({
          eventId: event.id,
          lpWallet: createdBy,
          amount: amountNum.toString(),
          shares: amountNum.toString()
        });
      }

      res.status(201).json(event);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to create hedge event" });
    }
  });

  app.patch("/api/hedge/events/:id/pool", async (req, res) => {
    try {
      const { poolOpen, allowExternalLp, callerAddress } = req.body;
      const event = await storage.getHedgeEvent(parseInt(req.params.id));
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (!callerAddress || callerAddress.toLowerCase() !== event.createdBy.toLowerCase()) {
        return res.status(403).json({ message: "Only the event creator can modify pool settings" });
      }
      const updates: Record<string, any> = {};
      if (typeof poolOpen === "boolean") updates.poolOpen = poolOpen;
      if (typeof allowExternalLp === "boolean") updates.allowExternalLp = allowExternalLp;
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "No valid fields to update" });
      const updated = await storage.updateHedgeEvent(event.id, updates);
      res.json({ ...updated, message: "Pool settings updated" });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to update pool settings" });
    }
  });

  // ── Hedge positions ──────────────────────────────────────────────────────────
  app.post("/api/hedge/positions", async (req, res) => {
    try {
      const { eventId, hedgerWallet, notional } = req.body;
      if (!eventId || !hedgerWallet || !notional) return res.status(400).json({ message: "Missing required fields: eventId, hedgerWallet, notional" });

      const event = await storage.getHedgeEvent(parseInt(eventId));
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (event.status !== "open") return res.status(400).json({ message: "Event is not open for new positions" });
      if (!event.poolOpen) return res.status(400).json({ message: "Pool is currently closed by the creator" });
      if (new Date(event.expiryDate) <= new Date()) return res.status(400).json({ message: "Event has expired" });

      const notionalNum = parseFloat(notional);
      if (notionalNum < 10) return res.status(400).json({ message: "Minimum notional is $10" });

      const premiumPaid = notionalNum * parseFloat(event.premiumRate);
      const payoutRate = parseFloat(event.payoutRate) || 0.30;
      const maxPayout = notionalNum * payoutRate;
      const HEDGER_FEE_RATE = 0.005;
      const hedgerPlatformFee = notionalNum * HEDGER_FEE_RATE;
      const totalCost = premiumPaid + hedgerPlatformFee;

      const positions = await storage.getHedgePositionsByEvent(event.id);
      const deposits = await storage.getHedgeLpDepositsByEvent(event.id);
      const totalLiquidity = deposits.filter(d => !d.withdrawn).reduce((sum, d) => sum + parseFloat(d.amount), 0);
      const currentExposure = positions.filter(p => p.status === "active").reduce((sum, p) => sum + parseFloat(p.maxPayout), 0);

      if (currentExposure + maxPayout > totalLiquidity) {
        return res.status(400).json({
          message: "Insufficient pool liquidity for this position",
          availableCapacity: Math.max(0, totalLiquidity - currentExposure),
          maxNotionalAllowed: totalLiquidity > currentExposure ? Math.floor((totalLiquidity - currentExposure) / payoutRate) : 0
        });
      }

      const position = await storage.createHedgePosition({
        eventId: event.id, hedgerWallet,
        notional: notionalNum.toString(), premiumPaid: premiumPaid.toString(),
        maxPayout: maxPayout.toString(), status: "active"
      });

      const activeDeposits = deposits.filter(d => !d.withdrawn);
      if (activeDeposits.length > 0) {
        const totalLiqMicro = activeDeposits.reduce((sum, d) => sum + toMicro(d.amount), 0n);
        const premiumMicro = toMicro(premiumPaid);
        for (const dep of activeDeposits) {
          const depMicro = toMicro(dep.amount);
          const earnedMicro = totalLiqMicro > 0n ? (premiumMicro * depMicro) / totalLiqMicro : 0n;
          const currentMicro = toMicro(dep.premiumsEarned || "0");
          await storage.updateHedgeLpDeposit(dep.id, { premiumsEarned: fromMicro(currentMicro + earnedMicro) });
        }
      }

      const creatorRewardMicro = toMicro(hedgerPlatformFee) * 5n / 100n;
      const currentCreatorMicro = toMicro(event.creatorEarnings || "0");
      await storage.updateHedgeEvent(event.id, { creatorEarnings: fromMicro(currentCreatorMicro + creatorRewardMicro) });

      const creatorReward = Number(creatorRewardMicro) / 1_000_000;
      console.log(`[Hedge Fee] Notional: $${notionalNum} | MaxPayout: $${maxPayout.toFixed(2)} (${(payoutRate * 100).toFixed(0)}%) | Premium: $${premiumPaid.toFixed(4)} | Hedger fee (0.5%): $${hedgerPlatformFee.toFixed(4)} | Creator reward (5%): $${creatorReward.toFixed(4)} | Event: ${event.name}`);

      res.status(201).json({
        ...position, premiumPaid, hedgerPlatformFee, creatorReward, totalCost, maxPayout,
        message: `Protection purchased. Total cost: $${totalCost.toFixed(2)} (Premium: $${premiumPaid.toFixed(2)} + Platform fee: $${hedgerPlatformFee.toFixed(4)}). Payout scales with rate movement.`
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to buy protection" });
    }
  });

  app.get("/api/hedge/positions/:wallet", async (req, res) => {
    try {
      const positions = await storage.getHedgePositionsByWallet(req.params.wallet);
      res.json(positions);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch positions" });
    }
  });

  // ── Hedge LP deposits ────────────────────────────────────────────────────────
  app.post("/api/hedge/deposits", async (req, res) => {
    try {
      const { eventId, lpWallet, amount } = req.body;
      if (!eventId || !lpWallet || !amount) return res.status(400).json({ message: "Missing required fields: eventId, lpWallet, amount" });

      const event = await storage.getHedgeEvent(parseInt(eventId));
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (event.status !== "open") return res.status(400).json({ message: "Event is not open for deposits" });

      const isCreator = lpWallet.toLowerCase() === event.createdBy.toLowerCase();
      if (!isCreator && !event.allowExternalLp) return res.status(403).json({ message: "This pool is private — only the creator can provide liquidity" });

      const amountNum = parseFloat(amount);
      if (amountNum < 10) return res.status(400).json({ message: "Minimum deposit is $10" });

      const existingDeposits = await storage.getHedgeLpDepositsByEvent(event.id);
      const activeExisting = existingDeposits.filter(d => !d.withdrawn);
      const totalLiqMicro = activeExisting.reduce((sum, d) => sum + toMicro(d.amount), 0n);
      const totalSharesMicro = activeExisting.reduce((sum, d) => sum + toMicro(d.shares), 0n);
      const amtMicro = toMicro(amountNum);
      const sharesMicro = totalLiqMicro === 0n ? amtMicro : (amtMicro * totalSharesMicro) / totalLiqMicro;
      const shares = Number(sharesMicro) / 1_000_000;

      const deposit = await storage.createHedgeLpDeposit({
        eventId: event.id, lpWallet, amount: amountNum.toString(), shares: fromMicro(sharesMicro)
      });

      res.status(201).json({ ...deposit, message: `Deposited $${amountNum.toFixed(2)} into pool. Received ${shares.toFixed(4)} LP shares.` });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to deposit liquidity" });
    }
  });

  app.get("/api/hedge/deposits/:wallet", async (req, res) => {
    try {
      const deposits = await storage.getHedgeLpDepositsByWallet(req.params.wallet);
      res.json(deposits);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch deposits" });
    }
  });

  app.post("/api/hedge/deposits/:id/withdraw", async (req, res) => {
    try {
      const deposit = await storage.getHedgeLpDeposit(parseInt(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.withdrawn) return res.status(400).json({ message: "Already withdrawn" });

      const event = await storage.getHedgeEvent(deposit.eventId);
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (event.status === "open") return res.status(400).json({ message: "Cannot withdraw liquidity while the contract is still active. Withdrawals are available after the event expires or settles." });

      const updated = await storage.updateHedgeLpDeposit(deposit.id, { withdrawn: true, withdrawnAt: new Date() });
      res.json({ ...updated, message: "Liquidity withdrawn successfully" });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to withdraw" });
    }
  });

  app.post("/api/hedge/deposits/:id/claim-premiums", async (req, res) => {
    try {
      const { callerAddress } = req.body;
      if (!callerAddress) return res.status(400).json({ message: "Missing callerAddress" });

      const deposit = await storage.getHedgeLpDeposit(parseInt(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.lpWallet.toLowerCase() !== callerAddress.toLowerCase()) return res.status(403).json({ message: "Unauthorized: You can only claim premiums for your own deposits" });

      const earned = parseFloat(deposit.premiumsEarned || "0");
      const alreadyWithdrawn = parseFloat(deposit.premiumsWithdrawn || "0");
      const claimable = earned - alreadyWithdrawn;
      if (claimable <= 0) return res.status(400).json({ message: "No premiums available to claim" });

      const LP_PROFIT_FEE_RATE = 0.01;
      const lpProfitFee = claimable * LP_PROFIT_FEE_RATE;
      const netPayout = claimable - lpProfitFee;

      const CREATOR_LOYALTY_RATE = 0.05;
      const creatorReward = lpProfitFee * CREATOR_LOYALTY_RATE;
      const event = await storage.getHedgeEvent(deposit.eventId);
      if (event) {
        const currentCreatorEarnings = parseFloat(event.creatorEarnings || "0");
        await storage.updateHedgeEvent(event.id, { creatorEarnings: (currentCreatorEarnings + creatorReward).toString() });
      }

      const treasuryPrivateKey = process.env.TREASURY_POOL_PRIVATE_KEY;
      if (!treasuryPrivateKey) return res.status(500).json({ message: "Treasury wallet not configured" });

      const ethers = await import("ethers");
      const provider = new ethers.JsonRpcProvider("https://rpc.sepolia-api.lisk.com");
      const treasuryWallet = new ethers.Wallet(treasuryPrivateKey, provider);
      const usdcAddress = "0xf52Ad63619Bf9cFeF510341ac6b4038554399562";
      const usdcContract = new ethers.Contract(usdcAddress, [
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function transfer(address to, uint256 amount) returns (bool)"
      ], treasuryWallet);

      const decimals = await usdcContract.decimals();
      const treasuryBalance = await usdcContract.balanceOf(treasuryWallet.address);
      const treasuryBalanceFormatted = parseFloat(ethers.formatUnits(treasuryBalance, decimals));
      if (netPayout > treasuryBalanceFormatted) return res.status(400).json({ message: `Insufficient treasury balance. Available: ${treasuryBalanceFormatted.toFixed(2)} USDC, Claimable: ${netPayout.toFixed(2)} USDC` });

      const transferAmount = ethers.parseUnits(netPayout.toFixed(6), decimals);
      const tx = await usdcContract.transfer(deposit.lpWallet, transferAmount);
      const receipt = await tx.wait();

      const updated = await storage.updateHedgeLpDeposit(deposit.id, { premiumsWithdrawn: (alreadyWithdrawn + claimable).toString() });

      console.log(`[LP Fee] Claimed: $${claimable.toFixed(4)} | Platform fee (1%): $${lpProfitFee.toFixed(4)} | Net to LP: $${netPayout.toFixed(4)} | LP: ${deposit.lpWallet}`);

      res.json({
        success: true, txHash: receipt.hash,
        grossAmount: claimable.toFixed(2), platformFee: lpProfitFee.toFixed(4), netAmount: netPayout.toFixed(2),
        from: treasuryWallet.address, to: deposit.lpWallet,
        message: `Claimed $${netPayout.toFixed(2)} USDC (1% platform fee: $${lpProfitFee.toFixed(4)} retained)`
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to claim premiums" });
    }
  });

  // ── Settle event (admin) ─────────────────────────────────────────────────────
  app.post("/api/hedge/events/:id/settle", requireAdmin, async (req, res) => {
    try {
      const { settlementPrice, settlerAddress } = req.body;
      if (!settlementPrice || !settlerAddress) return res.status(400).json({ message: "Missing settlementPrice or settlerAddress" });

      const event = await storage.getHedgeEvent(parseInt(req.params.id));
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (event.status !== "open") return res.status(400).json({ message: "Event already settled or expired" });

      const RATE_SCALE = 100_000_000n;
      function toRateBig(s: string | number): bigint {
        const str = String(s).trim().replace(/[^0-9.]/g, '') || '0';
        const dot = str.indexOf('.');
        if (dot === -1) return BigInt(str) * RATE_SCALE;
        const int = str.slice(0, dot) || '0';
        const frac = str.slice(dot + 1).padEnd(8, '0').slice(0, 8);
        return BigInt(int) * RATE_SCALE + BigInt(frac);
      }

      const priceBig = toRateBig(settlementPrice);
      const strikeBig = toRateBig(event.strike);
      const triggered = priceBig >= strikeBig;
      const price = parseFloat(settlementPrice);
      const strike = parseFloat(event.strike);

      await storage.updateHedgeEvent(event.id, { status: "settled", settlementPrice: price.toString(), triggered, settledAt: new Date() });

      const positions = await storage.getHedgePositionsByEvent(event.id);
      for (const pos of positions) {
        if (pos.status !== "active") continue;
        if (triggered && strikeBig > 0n) {
          const rateGapBig = ((priceBig - strikeBig) * RATE_SCALE) / strikeBig;
          const notionalMicro = toMicro(pos.notional);
          const payoutMicro = (notionalMicro * rateGapBig) / RATE_SCALE;
          const payoutCapped = payoutMicro > 0n ? payoutMicro : 0n;
          await storage.updateHedgePosition(pos.id, { status: "settled_win", payoutAmount: fromMicro(payoutCapped) });
        } else {
          await storage.updateHedgePosition(pos.id, { status: "settled_loss", payoutAmount: "0" });
        }
      }

      res.json({
        message: triggered
          ? `Event settled. FX rate ${price} >= strike ${strike}. Protection triggered! Hedgers can claim payouts.`
          : `Event settled. FX rate ${price} < strike ${strike}. Protection not triggered. Positions expire worthless.`,
        triggered, settlementPrice: price, strike
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to settle event" });
    }
  });

  // ── Claim payout (hedger) ────────────────────────────────────────────────────
  app.post("/api/hedge/positions/:id/claim", async (req, res) => {
    try {
      const position = await storage.getHedgePosition(parseInt(req.params.id));
      if (!position) return res.status(404).json({ message: "Position not found" });
      if (position.claimed) return res.status(400).json({ message: "Already claimed" });
      if (position.status !== "settled_win") return res.status(400).json({ message: "Position not eligible for payout" });

      const { callerAddress } = req.body;
      if (!callerAddress) return res.status(400).json({ message: "callerAddress is required" });
      if (position.hedgerWallet.toLowerCase() !== callerAddress.toLowerCase()) return res.status(403).json({ message: "Unauthorized: this position does not belong to your wallet" });

      const grossPayout = parseFloat(position.payoutAmount || "0");
      const HEDGER_PAYOUT_FEE_RATE = 0.01;
      const payoutFee = grossPayout * HEDGER_PAYOUT_FEE_RATE;
      const netPayout = grossPayout - payoutFee;

      const CREATOR_LOYALTY_RATE = 0.05;
      const creatorReward = payoutFee * CREATOR_LOYALTY_RATE;
      const event = await storage.getHedgeEvent(position.eventId);
      if (event) {
        const currentCreatorEarnings = parseFloat(event.creatorEarnings || "0");
        await storage.updateHedgeEvent(event.id, { creatorEarnings: (currentCreatorEarnings + creatorReward).toString() });
      }

      await storage.updateHedgePosition(position.id, { claimed: true, status: "claimed" });

      console.log(`[Hedger Payout Fee] Gross: $${grossPayout.toFixed(4)} | Platform fee (1%): $${payoutFee.toFixed(4)} | Creator reward (5%): $${creatorReward.toFixed(4)} | Net to hedger: $${netPayout.toFixed(4)} | Position: #${position.id}`);

      res.json({
        message: `Payout claimed! Gross: $${grossPayout.toFixed(2)} — Platform fee (1%): $${payoutFee.toFixed(4)} — You receive: $${netPayout.toFixed(2)}`,
        grossPayout: grossPayout.toFixed(2), platformFee: payoutFee.toFixed(4), netPayout: netPayout.toFixed(2)
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to claim payout" });
    }
  });
}
