import type { Express } from "express";
import { timingSafeEqual, randomBytes } from "crypto";
import multer from "multer";
import path from "path";
import fs from "fs";
import { eq, sql } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { hedgeActivity, hedgeEvents, platformFees, loiDocuments } from "@shared/schema";
import {
  readChainEvents,
  readChainPositionsByEvent,
  readChainDepositsByEvent,
  readPlatformFeesPerChain,
  readCreationFeePerChain,
} from "../hedge-reader";
import { isBackfillRunning } from "../chain-logs";

const investorSessions = new Map<string, number>();
const investorEditSessions = new Set<string>();
const docsInvestorSessions = new Map<string, number>();
const investorLoginAttempts = new Map<string, { count: number; resetAt: number }>();
const EDIT_ACCESS_CODE = process.env.EDIT_ACCESS_CODE || "";

function generateInvestorToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Mint an investor session and store it. Used by other routes (e.g. the
 * docs-gate shared-key bypass) to grant admins data-room access without
 * forcing them to retype the investor password.
 */
export function mintInvestorSession(opts: { editEnabled?: boolean; ttlMs?: number; docsTokenId?: number } = {}): {
  token: string;
  expiresAt: number;
} {
  const token = generateInvestorToken();
  // 60 days by default. Investor sessions are in-memory so they get wiped on
  // server restart, but the gate auto-mints fresh ones on every docs-token
  // verify — so the user never sees the password screen on a return visit.
  const expiry = Date.now() + (opts.ttlMs ?? 60 * 24 * 60 * 60_000);
  investorSessions.set(token, expiry);
  if (opts.editEnabled) investorEditSessions.add(token);
  if (opts.docsTokenId) docsInvestorSessions.set(token, opts.docsTokenId);
  return { token, expiresAt: expiry };
}

// This service runs one replica; all investor sessions are process-local.
// Revoking a docs credential also removes sessions already derived from it.
export function revokeDocsInvestorSessions(docsTokenId: number) {
  docsInvestorSessions.forEach((id, token) => {
    if (id !== docsTokenId) return;
    investorSessions.delete(token);
    investorEditSessions.delete(token);
    docsInvestorSessions.delete(token);
  });
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of investorSessions.entries()) {
    if (now > expiry) { investorSessions.delete(token); investorEditSessions.delete(token); docsInvestorSessions.delete(token); }
  }
}, 3600_000);

const UPLOAD_DIR = path.join(process.cwd(), "server", "uploads", "compliance");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const complianceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  },
});

const complianceUpload = multer({
  storage: complianceStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF, Word, Excel, PowerPoint, and text files are allowed"));
  },
});

export function registerInvestorRoutes(app: Express) {
  app.post("/api/investor/auth", (req, res) => {
    const ip = req.ip || "unknown";
    const now = Date.now();

    const attempts = investorLoginAttempts.get(ip);
    if (attempts) {
      if (now < attempts.resetAt && attempts.count >= 5) {
        return res.status(429).json({ message: "Too many attempts. Try again in 15 minutes." });
      }
      if (now >= attempts.resetAt) investorLoginAttempts.delete(ip);
    }

    const { password } = req.body;
    const investorPassword = process.env.INVESTOR_PASSWORD || process.env.ADMIN_PASSWORD;
    const isEditCode = safeEqual(password, EDIT_ACCESS_CODE);
    const isInvestorCode = investorPassword ? safeEqual(password, investorPassword) : false;

    if (!isEditCode && !isInvestorCode) {
      const current = investorLoginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60_000 };
      investorLoginAttempts.set(ip, { count: current.count + 1, resetAt: current.resetAt });
      return res.status(401).json({ message: "Invalid access code" });
    }

    investorLoginAttempts.delete(ip);
    const token = generateInvestorToken();
    const expiry = now + 24 * 60 * 60_000;
    investorSessions.set(token, expiry);
    if (isEditCode) investorEditSessions.add(token);

    res.json({ token, expiresAt: expiry, editEnabled: isEditCode });
  });

  app.get("/api/investor/verify", (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    if (!token) return res.status(401).json({ valid: false });
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) {
      investorSessions.delete(token);
      investorEditSessions.delete(token);
      return res.status(401).json({ valid: false });
    }
    res.json({ valid: true, editEnabled: investorEditSessions.has(token) });
  });

  app.post("/api/investor/unlock-edit", (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) return res.status(401).json({ success: false, message: "Session expired" });
    const { password } = req.body;
    if (!safeEqual(password, EDIT_ACCESS_CODE)) return res.status(403).json({ success: false, message: "Incorrect edit password" });
    investorEditSessions.add(token);
    res.json({ success: true });
  });

  app.post("/api/verify-edit-code", (req, res) => {
    const { password } = req.body;
    if (!safeEqual(password, EDIT_ACCESS_CODE)) return res.status(403).json({ success: false });
    res.json({ success: true });
  });

  app.post("/api/investor/logout", (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    if (token) { investorSessions.delete(token); investorEditSessions.delete(token); }
    res.json({ success: true });
  });

  /**
   * Live traction feed for the data room.
   *
   * Everything numeric here is read from the Diamond on Base + BSC at request
   * time — this is deliberately NOT served from the local DB, because the
   * whole point for an investor is that the numbers are verifiable on-chain.
   * The DB is used only for the transaction log (hedge_activity), which
   * carries the tx hashes needed to deep-link into the block explorers.
   *
   * Mirrors the maths in /api/admin/revenue so the two never disagree.
   */
  /**
   * A single long secret that opens the traction panel and nothing else.
   *
   * The data room password is all or nothing: one code unlocks the cap table,
   * the signed LOIs, the financial model and the audit together. Handing that
   * to a grant reviewer who asked for traction gives them everything, so this
   * is a separate key that reaches exactly one endpoint.
   *
   * Unset means the share link is off, which is the right default: a missing
   * environment variable must never become a link that opens to anyone.
   */
  const tractionShareKey = () => (process.env.TRACTION_SHARE_KEY || "").trim();

  /** Attempts per IP per hour against the share key, since it is guessable in principle. */
  const shareHits = new Map<string, { n: number; resetAt: number }>();
  const shareThrottled = (ip: string): boolean => {
    const now = Date.now();
    const cur = shareHits.get(ip);
    if (!cur || now > cur.resetAt) {
      shareHits.set(ip, { n: 1, resetAt: now + 3_600_000 });
      return false;
    }
    cur.n += 1;
    return cur.n > 60;
  };

  app.get("/api/investor/traction", async (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    const expiry = investorSessions.get(token);
    const viaSession = Boolean(expiry && Date.now() <= expiry);

    // The share key arrives in the query string because the link has to work
    // when it is pasted into a browser, where no header can be set.
    const key = tractionShareKey();
    const offered = String(req.query.k || "");
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
    let viaShare = false;
    if (!viaSession && offered) {
      viaShare = Boolean(key) && safeEqual(offered, key);
      // Only failures count. The limiter exists to stop someone guessing the
      // key, and counting successful loads would have throttled the very
      // reviewer the link was made for: the panel refreshes itself, so an
      // open tab spends the allowance on its own without anyone touching it.
      if (!viaShare && shareThrottled(ip)) {
        return res.status(429).json({ error: "Too many attempts" });
      }
    }

    if (!viaSession && !viaShare) {
      if (!viaShare) investorSessions.delete(token);
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const [chainEvents, perChainFees, perChainCreationFees, txFeeStats, recentActivity, dbPools] =
        await Promise.all([
          readChainEvents(),
          readPlatformFeesPerChain(),
          readCreationFeePerChain(),
          db
            .select({
              totalTxFees: sql<string>`coalesce(sum(fee_amount::numeric), 0)::text`,
              totalTransferVolume: sql<string>`coalesce(sum(transfer_amount::numeric), 0)::text`,
              txFeeCount: sql<number>`count(*)::int`,
            })
            .from(platformFees)
            .then((r) => r[0]),
          // Full history, newest first. Ordered by block number so the sequence
          // reflects the chain rather than when our backfill happened to write
          // the row; createdAt is the fallback for rows written live.
          db
            .select({
              txHash: hedgeActivity.txHash,
              chainId: hedgeActivity.chainId,
              actionType: hedgeActivity.actionType,
              amount: hedgeActivity.amount,
              token: hedgeActivity.token,
              walletAddress: hedgeActivity.walletAddress,
              onChainEventId: hedgeActivity.onChainEventId,
              positionId: hedgeActivity.positionId,
              depositId: hedgeActivity.depositId,
              metadata: hedgeActivity.metadata,
              blockNumber: hedgeActivity.blockNumber,
              status: hedgeActivity.status,
              createdAt: hedgeActivity.createdAt,
            })
            .from(hedgeActivity)
            .orderBy(sql`coalesce(block_number, 0) desc, created_at desc`)
            .limit(500),
          // Pool identity + status, as synced from chain by ChainSync. Used to
          // name pairs and count statuses for pools whose on-chain getters
          // revert, so the section never under-reports the book.
          db
            .select({
              chainId: hedgeEvents.chainId,
              onChainEventId: hedgeEvents.onChainEventId,
              underlying: hedgeEvents.underlying,
              status: hedgeEvents.status,
            })
            .from(hedgeEvents)
            .where(sql`chain_id IS NOT NULL`),
        ]);

      // Aggregate the indexed on-chain log. This is the reliable source: every
      // row was decoded from a real event log and carries its own tx hash, so
      // the totals are itemised and independently verifiable. The contract's
      // getHedgeEventStats getters revert on several deployed pools and time
      // out intermittently, which is why they are not trusted for headlines.
      const logAgg = await db
        .select({
          notional: sql<string>`coalesce(sum(amount::numeric) filter (where action_type = 'buy_protection'), 0)::text`,
          liquidity: sql<string>`coalesce(sum(amount::numeric) filter (where action_type = 'deposit'), 0)::text`,
          premiums: sql<string>`coalesce(sum((metadata::json->>'premium')::numeric) filter (where action_type = 'buy_protection'), 0)::text`,
          hedgerFees: sql<string>`coalesce(sum((metadata::json->>'platformFee')::numeric) filter (where action_type = 'buy_protection'), 0)::text`,
          poolsCreated: sql<number>`count(*) filter (where action_type = 'create_event')::int`,
          poolsCreatedBase: sql<number>`count(*) filter (where action_type = 'create_event' and chain_id = 8453)::int`,
          poolsCreatedBsc: sql<number>`count(*) filter (where action_type = 'create_event' and chain_id = 56)::int`,
          poolsSeen: sql<number>`count(distinct on_chain_event_id)::int`,
          purchases: sql<number>`count(*) filter (where action_type = 'buy_protection')::int`,
          deposits: sql<number>`count(*) filter (where action_type = 'deposit')::int`,
          uniqueHedgersLog: sql<number>`count(distinct wallet_address) filter (where action_type = 'buy_protection')::int`,
          uniqueLpsLog: sql<number>`count(distinct wallet_address) filter (where action_type = 'deposit')::int`,
        })
        .from(hedgeActivity)
        .then((r) => r[0]);

      // Positions + deposits, fanned out per event across both chains.
      const allPositions: any[] = [];
      const allDeposits: any[] = [];
      await Promise.allSettled(
        chainEvents.map(async (event) => {
          const [positions, deposits] = await Promise.all([
            readChainPositionsByEvent(event.id, (event as any).chainId),
            readChainDepositsByEvent(event.id, (event as any).chainId),
          ]);
          allPositions.push(...positions);
          allDeposits.push(...deposits);
        })
      );

      // Headline figures come from the indexed log, falling back to the
      // contract's live aggregates only where the log has nothing to say.
      const num = (s: string) => parseFloat(s) || 0;
      const liveExposure = chainEvents.reduce((s, e) => s + e.totalExposure, 0);
      const livePremiums = chainEvents.reduce((s, e) => s + e.totalPremiums, 0);
      const liveLiquidity = chainEvents.reduce((s, e) => s + e.totalLiquidity, 0);

      const totalNotional = num(logAgg.notional) || liveExposure;
      const totalPremiumsCollected = num(logAgg.premiums) || livePremiums;
      const totalLiquidityDeposited = num(logAgg.liquidity) || liveLiquidity;
      const hedgerPositions = logAgg.purchases || chainEvents.reduce((s, e) => s + e.hedgerCount, 0);
      const lpPositions = logAgg.deposits || chainEvents.reduce((s, e) => s + (e as any).lpCount, 0);

      // Payouts and LP earnings have no event log of their own, so they can
      // only come from the per-position getters — which revert on most pools.
      const totalPayouts = allPositions.reduce((s, p) => s + p.payoutAmount, 0);
      const totalLpPremiumsEarned = allDeposits.reduce((s, d) => s + d.premiumsEarned, 0);
      const uniqueHedgers = logAgg.uniqueHedgersLog
        || new Set(allPositions.map((p) => String(p.hedger).toLowerCase())).size;
      const uniqueLps = logAgg.uniqueLpsLog
        || new Set(allDeposits.map((d) => String(d.lp).toLowerCase())).size;

      // How much of the pool set we could read in full — surfaced so the UI can
      // say so rather than silently under-reporting.
      const detailCoverage = {
        poolsRead: chainEvents.length,
        poolsIndexed: logAgg.poolsSeen,
        positionsResolved: allPositions.length,
        depositsResolved: allDeposits.length,
      };

      // Revenue, itemised from the indexed log:
      //   creation fee   — flat $2 per pool created (initializeHedgeFees)
      //   hedger fee     — protocol cut taken at purchase, emitted in the log
      //   transfer fee   — wallet-to-wallet fees recorded in platform_fees
      // The Diamond's getHedgePlatformFees() accumulator is read alongside as a
      // cross-check; it reflects the *undrawn* treasury balance, so it reads
      // lower than lifetime revenue once fees have been withdrawn.
      const poolsCreated = logAgg.poolsCreated || logAgg.poolsSeen;

      // Creation fee is per chain and governable — Base charges $25, BSC $2 —
      // so it is read live rather than hardcoded. Note this applies the CURRENT
      // fee to historical pools: if governance changed the fee after a pool was
      // created, that pool's contribution is approximated. The hedger fees
      // below carry no such caveat; they come from the purchase logs directly.
      const feeFor = (chainId: number) => {
        const hit = perChainCreationFees.find((c) => c.chainId === chainId);
        // known:false means we could not read the fee at all — the UI says so
        // rather than showing $0, which would read as "we charge nothing".
        return { fee: hit?.creationFee ?? 0, known: !!hit?.onChain };
      };
      const creationFeeBreakdown = [
        { chainName: "Base", pools: logAgg.poolsCreatedBase, ...feeFor(8453) },
        { chainName: "BSC", pools: logAgg.poolsCreatedBsc, ...feeFor(56) },
      ]
        .filter((c) => c.pools > 0)
        .map(({ chainName, pools, fee, known }) => ({ chainName, pools, feePerPool: fee, known }));
      const creationFees = creationFeeBreakdown.reduce((s, c) => s + c.pools * c.feePerPool, 0);
      const hedgerProtocolFees = num(logAgg.hedgerFees);

      const chainFeeDetails: Record<string, { fees: number; source: string }> = {};
      let onChainTreasury = 0;
      for (const chain of perChainFees) {
        onChainTreasury += chain.fees;
        chainFeeDetails[chain.chainName] = {
          fees: chain.fees,
          source: chain.onChain ? "on-chain treasury balance" : "getter unavailable on this Diamond",
        };
      }

      const totalTxFees = parseFloat(txFeeStats.totalTxFees);
      const totalHedgeFees = creationFees + hedgerProtocolFees;

      // Per-pair rollup — which corridors have real volume behind them.
      // Pair names come from the synced pool table (complete), the money comes
      // from the indexed log (complete), joined on the on-chain event id.
      const pairOf = new Map<number, string>();
      for (const p of dbPools) {
        if (p.onChainEventId != null) pairOf.set(p.onChainEventId, p.underlying);
      }
      for (const e of chainEvents) pairOf.set(e.id, e.underlying);

      const perPool = await db
        .select({
          poolId: hedgeActivity.onChainEventId,
          liquidity: sql<string>`coalesce(sum(amount::numeric) filter (where action_type = 'deposit'), 0)::text`,
          notional: sql<string>`coalesce(sum(amount::numeric) filter (where action_type = 'buy_protection'), 0)::text`,
          premiums: sql<string>`coalesce(sum((metadata::json->>'premium')::numeric) filter (where action_type = 'buy_protection'), 0)::text`,
          hedgers: sql<number>`count(distinct wallet_address) filter (where action_type = 'buy_protection')::int`,
        })
        .from(hedgeActivity)
        .where(sql`on_chain_event_id IS NOT NULL`)
        .groupBy(hedgeActivity.onChainEventId);

      const byPair: Record<string, { pools: number; liquidity: number; notional: number; premiums: number; hedgers: number }> = {};
      for (const p of perPool) {
        const k = (p.poolId != null ? pairOf.get(p.poolId) : undefined) || "Unknown pair";
        if (!byPair[k]) byPair[k] = { pools: 0, liquidity: 0, notional: 0, premiums: 0, hedgers: 0 };
        byPair[k].pools += 1;
        byPair[k].liquidity += num(p.liquidity);
        byPair[k].notional += num(p.notional);
        byPair[k].premiums += num(p.premiums);
        byPair[k].hedgers += p.hedgers;
      }

      // ── Signed agreements ────────────────────────────────────────────
      // Commercial traction that isn't on-chain: counterparties who have
      // actually executed a letter of intent.
      //
      // Two deliberate constraints:
      //  1. Only fully-signed documents count. A sent-but-unsigned LOI is a
      //     pipeline item, not traction, and presenting it as one would not
      //     survive diligence.
      //  2. Counterparty identities appear only where showInDataRoom was
      //     explicitly set. The LOI itself binds both sides to
      //     confidentiality, so naming a signatory to investors without
      //     their agreement would breach the document they just signed.
      //     Everything else is published as anonymous aggregate.
      const agreements = await (async () => {
        try {
          const signed = await db
            .select({
              relationshipType: loiDocuments.relationshipType,
              docType: loiDocuments.docType,
              country: loiDocuments.recipientCountry,
              company: loiDocuments.recipientCompany,
              signedAt: loiDocuments.signedAt,
              showInDataRoom: loiDocuments.showInDataRoom,
            })
            .from(loiDocuments)
            .where(eq(loiDocuments.status, "signed"));

          const outstanding = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(loiDocuments)
            .where(sql`${loiDocuments.status} IN ('sent','viewed','changes_requested','awaiting_signature')`)
            .then((r) => r[0]?.n ?? 0);

          const tally = (key: "relationshipType" | "country") =>
            signed.reduce<Record<string, number>>((acc, r) => {
              const k = (r[key] || "Unspecified") as string;
              acc[k] = (acc[k] ?? 0) + 1;
              return acc;
            }, {});

          return {
            signedCount: signed.length,
            outstandingCount: outstanding,
            byRelationship: tally("relationshipType"),
            byCountry: tally("country"),
            latestSignedAt:
              signed
                .map((s) => s.signedAt)
                .filter(Boolean)
                .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0] ?? null,
            // Named only with explicit per-document consent.
            named: signed
              .filter((s) => s.showInDataRoom)
              .map((s) => ({
                company: s.company,
                country: s.country,
                relationshipType: s.relationshipType,
                docType: s.docType,
                signedAt: s.signedAt,
              })),
          };
        } catch {
          // The agreements module is additive — if its tables aren't ready
          // yet, the on-chain traction figures must still render.
          return { signedCount: 0, outstandingCount: 0, byRelationship: {}, byCountry: {}, latestSignedAt: null, named: [] };
        }
      })();

      res.json({
        generatedAt: new Date().toISOString(),
        chains: perChainFees.map((c) => ({ chainId: c.chainId, chainName: c.chainName, live: c.onChain })),
        // Pool counts prefer the synced table over the live getters: the
        // getters revert on several pools, the synced table has all of them.
        pools: (() => {
          const src = dbPools.length >= chainEvents.length
            ? dbPools.map((p) => p.status)
            : chainEvents.map((e) => e.status);
          return {
            total: Math.max(src.length, logAgg.poolsSeen),
            open: src.filter((s) => s === "open").length,
            settled: src.filter((s) => s === "settled").length,
            expired: src.filter((s) => s === "expired").length,
          };
        })(),
        participants: {
          hedgerPositions,
          lpPositions,
          uniqueHedgers,
          uniqueLps,
        },
        detailCoverage,
        volume: {
          totalNotional: totalNotional.toFixed(2),
          totalLiquidityDeposited: totalLiquidityDeposited.toFixed(2),
          totalPremiumsCollected: totalPremiumsCollected.toFixed(2),
          totalPayouts: totalPayouts.toFixed(2),
          totalLpPremiumsEarned: totalLpPremiumsEarned.toFixed(2),
          totalTransferVolume: parseFloat(txFeeStats.totalTransferVolume).toFixed(2),
        },
        revenue: {
          creationFees: creationFees.toFixed(2),
          creationFeeBreakdown,
          poolsCreated,
          hedgerProtocolFees: hedgerProtocolFees.toFixed(2),
          hedgePlatformFees: totalHedgeFees.toFixed(2),
          transactionFees: totalTxFees.toFixed(2),
          netPlatformRevenue: (totalHedgeFees + totalTxFees).toFixed(2),
          transactionFeeCount: txFeeStats.txFeeCount,
          onChainTreasury: onChainTreasury.toFixed(2),
          chainFeeDetails,
        },
        byPair: Object.entries(byPair)
          .map(([pair, v]) => ({ pair, ...v }))
          .sort((a, b) => b.liquidity - a.liquidity),
        // A share link is stricter than the data room about who gets named.
        // showInDataRoom is consent to appear in front of investors who typed
        // the access code, not on a URL that can be forwarded onward. Counts
        // and countries still tell the traction story; the names are dropped.
        agreements: viaShare ? { ...agreements, named: [] } : agreements,
        activityBackfill: {
          running: isBackfillRunning(),
          rows: recentActivity.length,
        },
        recentActivity: recentActivity.map((a) => ({
          ...a,
          explorerUrl:
            a.chainId === 8453
              ? `https://basescan.org/tx/${a.txHash}`
              : a.chainId === 56
              ? `https://bscscan.com/tx/${a.txHash}`
              : null,
          chainName: a.chainId === 8453 ? "Base" : a.chainId === 56 ? "BSC" : String(a.chainId),
        })),
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to load traction data",
      });
    }
  });

  app.get("/api/investor/content/:docId", async (req, res) => {
    const data = await storage.getDataRoomContent(req.params.docId);
    res.json(data);
  });

  app.post("/api/investor/content/:docId", async (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) { investorSessions.delete(token); return res.status(401).json({ error: "Unauthorized" }); }
    if (!investorEditSessions.has(token)) return res.status(403).json({ error: "Edit access required" });
    if (typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "Invalid data" });
    await storage.setDataRoomContent(req.params.docId, req.body as Record<string, string>);
    res.json({ ok: true });
  });

  app.post("/api/investor/upload", (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) { investorSessions.delete(token); return res.status(401).json({ error: "Unauthorized" }); }
    if (!investorEditSessions.has(token)) return res.status(403).json({ error: "Edit access required" });

    complianceUpload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      res.json({
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        url: `/api/investor/files/${encodeURIComponent(req.file.filename)}`,
      });
    });
  });

  app.get("/api/investor/files/:filename", (req, res) => {

    const raw = path.basename(decodeURIComponent(req.params.filename));
    if (!/^[\w.\-]+$/.test(raw)) return res.status(400).json({ error: "Invalid filename" });
    const filepath = path.resolve(UPLOAD_DIR, raw);
    const resolvedBase = path.resolve(UPLOAD_DIR);
    if (!filepath.startsWith(resolvedBase + path.sep) && filepath !== resolvedBase) return res.status(400).json({ error: "Invalid path" });
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: "File not found" });
    res.download(filepath, raw.replace(/^\d+_/, ""));
  });

  app.delete("/api/investor/files/:filename", (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) { investorSessions.delete(token); return res.status(401).json({ error: "Unauthorized" }); }
    if (!investorEditSessions.has(token)) return res.status(403).json({ error: "Edit access required" });

    const raw = path.basename(decodeURIComponent(req.params.filename));
    if (!/^[\w.\-]+$/.test(raw)) return res.status(400).json({ error: "Invalid filename" });
    const filepath = path.resolve(UPLOAD_DIR, raw);
    const resolvedBase = path.resolve(UPLOAD_DIR);
    if (!filepath.startsWith(resolvedBase + path.sep) && filepath !== resolvedBase) return res.status(400).json({ error: "Invalid path" });
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    res.json({ ok: true });
  });
}
