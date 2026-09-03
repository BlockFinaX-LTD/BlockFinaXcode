import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { eq, sql } from "drizzle-orm";
import { authSessions, platformFees, hedgeEvents, hedgePositions, hedgeLpDeposits, hedgeActivity, historicalFxCloses } from "../../shared/schema";
import { describeMove } from "../agent/fx-direction";
import { dropSpikes } from "../lib/fx-series";
import { requireAdmin } from "../middleware/admin-auth";
import { requireRiftUser } from "../middleware/rift-auth";
import { strictLimiter } from "../middleware/rate-limiter";
import { syncChainEvents } from "../chain-sync";
import { verifyHedgeTx, VERIFIABLE_ACTIONS } from "../lib/chain-verify";

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
  // Auth: Authorization: Bearer <rift access token>. The authenticated wallet
  // is the one we sponsor — we never trust a wallet address from the body.
  app.post("/api/gas/sponsor", strictLimiter, requireRiftUser, async (req, res) => {
    try {
      const { chainId } = req.body ?? {};
      const addr = req.riftUser!.address;           // already lowercased + verified by Rift
      const walletAddress = addr;
      const now = Date.now();
      const cooldownKey = `${addr}:${chainId || 8453}`;
      const lastSponsored = gasSponsorCooldown.get(cooldownKey) || 0;
      if (now - lastSponsored < 60000) return res.json({ success: true, sponsored: false, message: "Recently sponsored" });

      const ethers = await import("ethers");
      const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
      if (!deployerKey) return res.status(500).json({ message: "Gas sponsor not configured" });

      // Select RPC based on chainId — default to Base
      const RPC_BY_CHAIN: Record<number, string> = {
        8453: "https://mainnet.base.org",
        56:   "https://bsc-dataseed.binance.org",
      };
      const rpc = RPC_BY_CHAIN[Number(chainId)] || "https://mainnet.base.org";
      const provider = new ethers.JsonRpcProvider(rpc);

      const userBalance = await provider.getBalance(walletAddress);
      const minGasBalance = ethers.parseEther("0.00005");
      if (userBalance >= minGasBalance) return res.json({ success: true, sponsored: false, message: "Sufficient gas balance" });

      const deployer = new ethers.Wallet(deployerKey, provider);
      const gasAmount = ethers.parseEther("0.0001");
      const deployerBalance = await provider.getBalance(deployer.address);
      if (deployerBalance < gasAmount) return res.status(400).json({ message: "Gas sponsor wallet low on funds" });

      const tx = await deployer.sendTransaction({ to: walletAddress, value: gasAmount });
      await tx.wait();
      gasSponsorCooldown.set(cooldownKey, now);
      res.json({ success: true, sponsored: true, txHash: tx.hash, amount: "0.0001" });
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

  // Auth: Authorization: Bearer <rift access token>. The recorder must be the
  // sender of the transfer — we cross-check `fromWallet` against the verified
  // Rift identity so the books can't be polluted by random callers.
  app.post("/api/fees/record", requireRiftUser, async (req, res) => {
    try {
      const { txHash, feeTxHash, fromWallet, toWallet, transferAmount, token, chainId } = req.body;
      if (!txHash || !fromWallet || !toWallet || !transferAmount) return res.status(400).json({ message: "Missing required fields" });
      if (String(fromWallet).toLowerCase() !== req.riftUser!.address) {
        return res.status(403).json({ message: 'You can only record fees for transfers from your own wallet' });
      }

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


  /**
   * Daily closes for one pair, for the chart in the purchase sheet.
   *
   * Closes only, because closes are all the table holds. That is the right
   * series here anyway: someone buying thirty day cover cares where the rate
   * settles, not where it flickered intraday, which is the only thing a
   * candlestick would add.
   *
   * Deliberately returns no forecast of any kind. The chart shows what has
   * happened and where the strike sits across it, and the buyer draws their
   * own conclusion. A trend line on a page selling financial protection is an
   * implied prediction, and this product is in front of a regulator.
   */
  app.get("/api/fx/history/:pair", async (req, res) => {
    try {
      const pair = decodeURIComponent(req.params.pair).toUpperCase();
      if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) {
        return res.status(400).json({ message: "Pair must look like USD/GHS" });
      }

      /**
       * Hours are a different series from days, not a shorter one.
       *
       * historical_fx_closes holds one close per day, so it cannot answer
       * "the last six hours" at all. The oracle's rate_snapshots can, and is
       * the only intraday record there is.
       *
       * Worth knowing what that record looks like for these pairs. Across 48
       * hours every FX pair carries about 50 snapshots and just THREE distinct
       * rates: the upstream provider revalues exotic currencies once or twice
       * a day rather than continuously. An intraday chart of USD/GHS is
       * therefore a staircase with three steps, and that is the truth about
       * the market rather than a defect in the chart. distinctRates is
       * returned so the caller can say so plainly instead of drawing a line
       * that implies a precision the data does not have.
       */
      const hoursRaw = req.query.hours ? parseInt(String(req.query.hours), 10) : NaN;
      const intraday = Number.isFinite(hoursRaw) && hoursRaw > 0;
      const hours = intraday ? Math.min(Math.max(hoursRaw, 1), 48) : 0;

      // Up to twenty-five years, which covers the oldest series in the table.
      // The payload stays small because the drawing points are thinned below.
      const days = Math.min(Math.max(parseInt(String(req.query.days || "365"), 10) || 365, 7), 9200);
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

      /**
       * When this pair first appeared in the snapshot table.
       *
       * An hour view on a pair added an hour ago has nothing to draw, and
       * saying "no price history" for that is wrong in a way that matters: it
       * reads as a fault, and someone goes looking for a break that is not
       * there. The client uses this to say the true thing instead, which is
       * that tracking only just started.
       *
       * Only computed for intraday, since daily closes are backfilled from
       * years of history and never have this problem.
       */
      let trackingSince: string | null = null;
      if (intraday) {
        const t: any = await db.execute(sql`
          select min(recorded_at) as first from rate_snapshots where pair = ${pair}`);
        const first = (t.rows ?? t)[0]?.first;
        trackingSince = first ? new Date(first).toISOString() : null;
      }

      const rows = intraday
        ? ((await db.execute(sql`
            select recorded_at as date, rate as close
            from rate_snapshots
            where pair = ${pair}
              and recorded_at > now() - (${hours} || ' hours')::interval
            order by recorded_at
          `)) as any).rows.map((r: any) => ({ date: new Date(r.date).toISOString(), close: r.close }))
        : await db
            .select({ date: historicalFxCloses.date, close: historicalFxCloses.close })
            .from(historicalFxCloses)
            .where(sql`${historicalFxCloses.pair} = ${pair} and ${historicalFxCloses.date} >= ${since}`)
            .orderBy(historicalFxCloses.date);

      const raw: { date: string; close: number }[] = (rows as { date: unknown; close: unknown }[])
        .map((r) => ({ date: String(r.date), close: Number(r.close) }))
        .filter((p) => Number.isFinite(p.close) && p.close > 0);

      // Feed errors that survive the 40% median filter in fx.ts. USD/GHS has a
      // 14.50 sitting between a 12.45 and a 12.50, which alone produced a
      // "worst 60 day move" of 30.9% that never happened.
      //
      // Daily closes only. The filter judges a point against its neighbours,
      // and snapshots hold the same rate for hours at a time by design, so the
      // shape it looks for does not mean the same thing on that series.
      const { clean: points, dropped } = intraday
        ? { clean: raw, dropped: [] as typeof raw }
        : dropSpikes(raw);

      if (points.length < 2) {
        return res.json({ pair, days, points: [], change: null, ticksDropped: dropped.length,
          intraday, trackingSince, note: "not enough history" });
      }

      const first = points[0].close;
      const lastClose = points[points.length - 1].close;

      /**
       * The live spot, from the same oracle the rates list reads.
       *
       * A daily close is a settled end of day figure and the spot is right
       * now, so the two legitimately differ by a few tenths of a percent. Two
       * screens showing different numbers for the same pair reads as a bug
       * whether or not it is one, so the chart quotes the live rate and the
       * closes remain what the line is drawn from.
       */
      let live: number | null = null;
      try {
        const r = await getRate(pair);
        if (r && Number.isFinite(r.rate) && r.rate > 0) live = r.rate;
      } catch {
        /* the chart is still true without it */
      }

      /**
       * Whether an hour view is possible for this pair at all.
       *
       * 63 pairs are polled into rate_snapshots; 86 have daily closes. The 23
       * in the gap, EUR/USD and USD/JPY among them, would answer every hour
       * request with an empty chart. Reported so the caller can leave those
       * buttons off rather than offer a control that cannot work.
       */
      let hasIntraday = false;
      try {
        const probe = (await db.execute(sql`
          select 1 from rate_snapshots
          where pair = ${pair} and recorded_at > now() - interval '48 hours' limit 1
        `)) as any;
        hasIntraday = (probe.rows?.length ?? 0) > 0;
      } catch {
        /* the daily chart does not depend on this */
      }

      const last = live ?? lastClose;
      const changePct = Number((((last - first) / first) * 100).toFixed(1));

      /**
       * Thin the series for drawing only.
       *
       * A 25 year range is about 6,000 closes, which is a 300KB payload to
       * draw a line a few hundred pixels wide. Every statistic above is
       * computed on the FULL series first, deliberately: sampling before
       * measuring would let the thinning quietly drop the very spike that
       * makes the worst move worst, and the number would drift with the
       * viewport.
       *
       * The endpoints are always kept, so the line still begins and ends
       * where the data does.
       */
      const MAX_POINTS = 480;
      let drawn = points;
      if (points.length > MAX_POINTS) {
        const step = (points.length - 1) / (MAX_POINTS - 1);
        const out: typeof points = [];
        for (let i = 0; i < MAX_POINTS; i++) out.push(points[Math.round(i * step)]);
        out[out.length - 1] = points[points.length - 1];
        drawn = out;
      }

      res.json({
        pair,
        days,
        intraday,
        hasIntraday,
        hours: intraday ? hours : undefined,
        /**
         * How many different rates appear in this window.
         *
         * Low on an intraday range means the provider revalues this pair only
         * a couple of times a day, so the line is a staircase. Surfaced so the
         * chart can say that plainly rather than let it read as a fault.
         */
        distinctRates: new Set(points.map((p) => p.close)).size,
        /** When this pair first entered the snapshot table. Intraday only. */
        trackingSince,
        points: drawn,
        /** The last settled daily close, kept distinct from the live spot. */
        lastClose,
        live,
        /** How many closes the figures were computed from, before thinning. */
        observations: points.length,
        latest: last,
        // Surfaced rather than hidden. A rising count means the upstream feed
        // is degrading, and silently cleaning it would hide that.
        ticksDropped: dropped.length,
        // Stated in words, never as a bare sign. A minus on a currency pair
        // does not mean what it looks like, and reading it wrong has already
        // put the opposite of the truth in front of a reader once.
        change: { percent: changePct, direction: describeMove(pair, changePct) },
      });
    } catch {
      res.status(500).json({ message: "Failed to load history" });
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

  // Sync on-chain hedge events into the DB (admin-only, idempotent)
  app.post("/api/admin/sync-chain-events", requireAdmin, async (req, res) => {
    try {
      const chainId = req.body?.chainId ? Number(req.body.chainId) : undefined;
      const results = await syncChainEvents(chainId);
      res.json({ ok: true, results });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Sync failed" });
    }
  });

  // Clear all cached hedge event data (admin-only) — use when switching contract addresses
  app.post("/api/admin/clear-hedge-events", requireAdmin, async (req, res) => {
    try {
      // Delete in order of foreign key dependencies
      await db.delete(hedgePositions);
      await db.delete(hedgeLpDeposits);
      await db.delete(hedgeEvents);

      res.json({
        ok: true,
        message: "All hedge events, positions, and LP deposits cleared"
      });
    } catch (error: any) {
      res.status(500).json({
        message: error?.message || "Failed to clear hedge events"
      });
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
        { label: 'Base',   chainId: 8453, diamond: process.env.BASE_DIAMOND_ADDRESS || '0xbCC51E62C4948FD35ab505bd71804C849601e4Ef', rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org' },
        { label: 'BSC',    chainId: 56,   diamond: process.env.BSC_DIAMOND_ADDRESS  || '0xaC939C0897981Abc0711ec4e37527F13106180fc', rpc: process.env.BSC_RPC_URL  || 'https://bsc-dataseed.binance.org' },
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

  /**
   * Per-pool totals derived from the indexed on-chain event log.
   *
   * The Diamond's getHedgeEventStats is the canonical source, but the public
   * Base RPC throttles under load and ethers reports the throttle as a revert,
   * so a page read commonly comes back missing pools — and those render as
   * $0 liquidity, which an underwriter reads as an empty pool.
   *
   * hedge_activity holds every LiquidityDeposited / ProtectionPurchased log
   * ever emitted, so these totals are computed from chain data without
   * touching an RPC. Verified against the contract: pool 9 = $400 both ways,
   * pool 5 = $210, pool 7 = $100.
   *
   * Caveat: withdrawals are not yet indexed, so liquidity is gross deposits.
   * For pools with withdrawn capital this reads high — the client prefers the
   * live contract figure whenever it has one and only falls back to this.
   */
  app.get("/api/hedge/pool-stats", async (_req, res) => {
    try {
      const rows = await db
        .select({
          chainId: hedgeActivity.chainId,
          poolId: hedgeActivity.onChainEventId,
          liquidity: sql<string>`coalesce(sum(amount::numeric) filter (where action_type = 'deposit'), 0)::text`,
          exposure: sql<string>`coalesce(sum(amount::numeric) filter (where action_type = 'buy_protection'), 0)::text`,
          premiums: sql<string>`coalesce(sum((metadata::json->>'premium')::numeric) filter (where action_type = 'buy_protection'), 0)::text`,
          lpCount: sql<number>`count(distinct wallet_address) filter (where action_type = 'deposit')::int`,
          hedgerCount: sql<number>`count(distinct wallet_address) filter (where action_type = 'buy_protection')::int`,
        })
        .from(hedgeActivity)
        .where(sql`on_chain_event_id IS NOT NULL`)
        .groupBy(hedgeActivity.chainId, hedgeActivity.onChainEventId);

      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch pool stats" });
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

  app.patch("/api/hedge/events/chain/:chainId/:onChainId/description", async (req, res) => {
    try {
      const chainId = parseInt(req.params.chainId);
      const onChainEventId = parseInt(req.params.onChainId);
      const { description } = req.body;
      if (!description || typeof description !== 'string') return res.status(400).json({ message: "description required" });
      await storage.setHedgeEventDescription(chainId, onChainEventId, description.trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to save description" });
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
      // 5% of the premium, not of the notional.
      //
      // The basis matters more than the number. A fee on notional is charged on
      // the amount being protected, so it does not move with the price of the
      // protection: on a 1% premium it is a tenth of what the hedger pays, and
      // on a cheap pool it can exceed the premium several times over. A fee on
      // premium is a share of the transaction, which is what it is meant to be.
      //
      // This matches the deployed HedgeFacet on Base, which was upgraded to
      // the premium basis: position #7 paid $4.50 on a $90 premium. Positions
      // #1–#6 predate that and were charged 0.5% of notional, so this path and
      // the chain agree going forward but not retrospectively.
      const HEDGER_FEE_RATE = 0.05;
      const hedgerPlatformFee = premiumPaid * HEDGER_FEE_RATE;
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
      console.log(`[Hedge Fee] Notional: $${notionalNum} | MaxPayout: $${maxPayout.toFixed(2)} (${(payoutRate * 100).toFixed(0)}%) | Premium: $${premiumPaid.toFixed(4)} | Hedger fee (5% of premium): $${hedgerPlatformFee.toFixed(4)} | Creator reward (5%): $${creatorReward.toFixed(4)} | Event: ${event.name}`);

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
      const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
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

  // ── Hedge activity feed ─────────────────────────────────────────────────
  // Append-only log of every on-chain action a wallet has taken. The client
  // POSTs to this endpoint immediately after a mutation's tx receipt resolves.
  // The composite unique on (chainId, txHash, actionType) makes it idempotent —
  // re-posting the same row (e.g. on a retry) is a no-op.

  const ACTION_TYPES = new Set([
    "create_event", "buy_protection", "lp_deposit",
    "claim_payout", "claim_premiums", "withdraw_lp",
    "recover_expired", "toggle_pool", "settle_event",
    "reward_payout",
  ]);

  app.post("/api/hedge/activity", requireRiftUser, async (req, res) => {
    try {
      const {
        chainId, txHash, actionType,
        eventId, onChainEventId, positionId, depositId,
        amount, token, metadata,
      } = req.body ?? {};

      // Wallet comes from the verified Rift token — NEVER the body — so a caller
      // can't log activity for someone else's address.
      const walletAddress = req.riftUser!.address;

      if (!Number.isFinite(chainId)) {
        return res.status(400).json({ message: "chainId is required" });
      }
      if (!txHash || typeof txHash !== "string") {
        return res.status(400).json({ message: "txHash is required" });
      }
      if (!ACTION_TYPES.has(actionType)) {
        return res.status(400).json({ message: `actionType must be one of: ${Array.from(ACTION_TYPES).join(", ")}` });
      }

      // Reward-bearing actions (buy_protection / lp_deposit / create_event) are
      // RPC-verified before we mark them 'verified' — the only status that grants
      // task points. Other actions are logged 'confirmed' for the feed only.
      let status = "confirmed";
      if (VERIFIABLE_ACTIONS.has(actionType)) {
        const v = await verifyHedgeTx(chainId, txHash, walletAddress, actionType);
        if (!v.ok) {
          return res.status(400).json({ message: `On-chain verification failed: ${v.reason}` });
        }
        status = "verified";
      }

      const row = await storage.recordHedgeActivity({
        walletAddress,
        chainId,
        txHash,
        actionType,
        eventId: eventId ?? null,
        onChainEventId: onChainEventId ?? null,
        positionId: positionId ?? null,
        depositId: depositId ?? null,
        amount: amount != null ? String(amount) : null,
        token: token ?? null,
        metadata: metadata != null ? (typeof metadata === "string" ? metadata : JSON.stringify(metadata)) : null,
        status,
      });

      // First verified qualifying action settles a pending referral (awards both
      // the referrer and the referee). Fire-and-forget — never blocks the response.
      if (status === "verified") {
        storage.completePendingReferral(walletAddress)
          .then((r) => { if (r) console.log(`[referral] completed for ${walletAddress} → +${r.points} to ${r.referrer}`); })
          .catch((e) => console.warn("[referral] complete failed:", e?.message));
      }

      res.json(row);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to record activity" });
    }
  });

  // GET — returns the wallet's full activity feed. Optional ?chainId=xxxx&limit=NN
  app.get("/api/hedge/activity/:wallet", async (req, res) => {
    try {
      const wallet = String(req.params.wallet || "");
      if (!wallet) return res.status(400).json({ message: "wallet param required" });
      const chainId = req.query.chainId ? Number(req.query.chainId) : undefined;
      const limit = req.query.limit ? Math.min(200, Number(req.query.limit) || 50) : 50;
      const rows = await storage.getHedgeActivityByWallet(wallet, { chainId, limit });
      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to load activity" });
    }
  });
}
