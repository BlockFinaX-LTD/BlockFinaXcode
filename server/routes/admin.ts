import type { Express } from "express";
import type { WebSocketServer } from "ws";
import { db } from "../db";
import { storage } from "../storage";
import { eq, desc, sql } from "drizzle-orm";
import { wallets, hedgeEvents, hedgePositions, hedgeLpDeposits, dailyTasks, userTaskCompletions, platformFees, termsAcceptances, articles } from "../../shared/schema";
import { userProfiles } from "../../shared/profile-schema";
import { referrals, referralCodes, userPoints, pointTransactions } from "../../shared/referral-schema";
import { strictLimiter } from "../middleware/rate-limiter";
import {
  adminSessions, adminChallenges, requireAdmin, generateAdminToken,
  getOwnerAddresses, ADMIN_SESSION_TTL_MS,
} from "../middleware/admin-auth";
import { readChainEvents, readChainPositionsByEvent, readChainDepositsByEvent, readPlatformFees } from "../hedge-reader";

export function registerAdminRoutes(app: Express, wss: WebSocketServer) {
  app.post("/api/admin/wallet-challenge", strictLimiter, (req, res) => {
    const nonce = generateAdminToken().slice(0, 32);
    adminChallenges.set(nonce, Date.now() + 5 * 60_000);
    const message = `Sign this message to access BlockFinaX Admin.\n\nNonce: ${nonce}\nValid for 5 minutes.`;
    res.json({ nonce, message });
  });

  app.post("/api/admin/login", strictLimiter, async (req, res) => {
    try {
      const { address, signature, nonce } = req.body;
      if (!address || !signature || !nonce) {
        return res.status(400).json({ message: "address, signature and nonce are required" });
      }

      const nonceExpiry = adminChallenges.get(nonce);
      if (!nonceExpiry || Date.now() > nonceExpiry) {
        return res.status(401).json({ message: "Challenge expired. Please try again." });
      }
      adminChallenges.delete(nonce);

      const owners = getOwnerAddresses();
      if (owners.length === 0) {
        return res.status(500).json({ message: "No admin wallet addresses configured." });
      }

      const { ethers } = await import("ethers");
      const message = `Sign this message to access BlockFinaX Admin.\n\nNonce: ${nonce}\nValid for 5 minutes.`;
      const recovered = ethers.verifyMessage(message, signature).toLowerCase();

      if (!owners.includes(recovered)) {
        return res.status(403).json({ message: "Wallet not authorised." });
      }

      const token = generateAdminToken();
      adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
      res.json({ token, address: recovered, expiresAt: Date.now() + ADMIN_SESSION_TTL_MS });
    } catch (err: any) {
      console.error("[Admin login]", err);
      res.status(500).json({ message: "Signature verification failed." });
    }
  });

  app.post("/api/admin/logout", (req, res) => {
    const token = req.headers["x-admin-token"] as string;
    if (token) adminSessions.delete(token);
    res.json({ success: true });
  });

  app.use("/api/admin", (req, res, next) => {
    if (req.path === "/login" || req.path === "/logout" || req.path === "/wallet-challenge") return next();
    requireAdmin(req, res, next);
  });

  app.post("/api/admin/reset-testnet", async (_req, res) => {
    try {
      await db.execute(sql`
        TRUNCATE TABLE
          wallets,
          user_profiles,
          user_accounts,
          auth_sessions,
          magic_links,
          webauthn_credentials,
          hedge_events,
          hedge_positions,
          hedge_lp_deposits,
          user_task_completions,
          platform_fees,
          rate_snapshots,
          terms_acceptances
        RESTART IDENTITY CASCADE
      `);

      for (const q of [
        sql`TRUNCATE TABLE referrals RESTART IDENTITY CASCADE`,
        sql`TRUNCATE TABLE referral_codes RESTART IDENTITY CASCADE`,
        sql`TRUNCATE TABLE user_points RESTART IDENTITY CASCADE`,
        sql`TRUNCATE TABLE point_transactions RESTART IDENTITY CASCADE`,
      ]) {
        try { await db.execute(q); } catch { /* table may not exist — skip */ }
      }

      console.log("[Admin] Testnet data cleared");
      res.json({ success: true, message: "Testnet data cleared. Configuration and content preserved." });
    } catch (e: any) {
      console.error("[Admin] Reset failed:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/overview", async (_req, res) => {
    try {
      const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(wallets);
      const [taskCompletionCount] = await db.select({
        count: sql<number>`count(*)::int`,
        totalPoints: sql<number>`coalesce(sum(points_earned), 0)::int`,
      }).from(userTaskCompletions);

      const chainEvents = await readChainEvents();
      const activeHedgeEvents = chainEvents.filter(e => e.status === 'open').length;
      const totalPremiums = chainEvents.reduce((s, e) => s + e.totalPremiums, 0);
      const totalLiquidity = chainEvents.reduce((s, e) => s + e.totalLiquidity, 0);
      const totalPositions = chainEvents.reduce((s, e) => s + e.hedgerCount, 0);
      const totalLpDeposits = chainEvents.reduce((s, e) => s + e.lpCount, 0);
      const platformFeeRevenue = await readPlatformFees();

      res.json({
        totalUsers: userCount.count,
        totalHedgeEvents: chainEvents.length,
        activeHedgeEvents,
        totalPositions,
        totalPremiumsCollected: totalPremiums.toFixed(6),
        totalLpDeposits,
        totalLiquidity: totalLiquidity.toFixed(6),
        totalTaskCompletions: taskCompletionCount.count,
        totalPointsAwarded: taskCompletionCount.totalPoints,
        hedgeFeeRevenue: platformFeeRevenue.toFixed(2),
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch admin overview" });
    }
  });

  app.get("/api/admin/users", async (req, res) => {
    try {
      const search = (req.query.search as string || "").toLowerCase();
      const allWallets = await db.select().from(wallets).orderBy(desc(wallets.createdAt));
      const allProfiles = await db.select({
        walletAddress: userProfiles.walletAddress,
        kycStatus: userProfiles.kycStatus,
        kycTier: userProfiles.kycTier,
        submittedAt: userProfiles.submittedAt,
      }).from(userProfiles);
      const profileMap = new Map(allProfiles.map(p => [p.walletAddress.toLowerCase(), p]));
      const result = allWallets
        .filter(w => !search || w.address.toLowerCase().includes(search) || (w.name && w.name.toLowerCase().includes(search)) || (w.email && w.email.toLowerCase().includes(search)))
        .map(w => ({
          id: w.id,
          address: w.address,
          name: w.name,
          email: w.email || null,
          isImported: w.isImported,
          createdAt: w.createdAt,
          kyc: profileMap.get(w.address.toLowerCase()) || { kycStatus: "not_started", kycTier: 0, submittedAt: null },
        }));
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch users" });
    }
  });

  app.get("/api/admin/kyc", async (_req, res) => {
    try {
      const profiles = await db.select().from(userProfiles).orderBy(desc(userProfiles.submittedAt));
      res.json(profiles);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/kyc/:address", async (req, res) => {
    try {
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.walletAddress, req.params.address));
      if (!profile) return res.status(404).json({ message: "No profile found" });
      res.json(profile);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/kyc/:address", async (req, res) => {
    try {
      const { kycStatus, kycTier, reviewerNotes } = req.body;
      const updates: Record<string, any> = { lastUpdated: new Date() };
      if (kycStatus !== undefined) updates.kycStatus = kycStatus;
      if (kycTier !== undefined) updates.kycTier = kycTier;
      if (reviewerNotes !== undefined) updates.reviewerNotes = reviewerNotes;
      if (kycStatus === "approved" || kycStatus === "rejected") updates.reviewedAt = new Date();
      await db.update(userProfiles).set(updates).where(eq(userProfiles.walletAddress, req.params.address));
      const [updated] = await db.select().from(userProfiles).where(eq(userProfiles.walletAddress, req.params.address));
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/kyc/:address/sync", async (req, res) => {
    try {
      const { getKycProvider } = await import("../kyc-provider");
      const provider = getKycProvider();

      if (!provider.getApplicantStatus) {
        return res.status(400).json({ message: `Provider '${provider.name}' does not support status sync` });
      }

      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.walletAddress, req.params.address));

      if (!profile?.kycProviderRef) {
        return res.status(400).json({ message: "No provider session found for this user" });
      }

      const result = await provider.getApplicantStatus(profile.kycProviderRef);
      const now = new Date();
      await db.update(userProfiles).set({
        kycStatus: result.status,
        kycTier: result.tier,
        reviewedAt: (result.status === "approved" || result.status === "rejected") ? now : profile.reviewedAt,
        lastUpdated: now,
      }).where(eq(userProfiles.walletAddress, req.params.address));

      const [updated] = await db.select().from(userProfiles).where(eq(userProfiles.walletAddress, req.params.address));
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/hedge", async (_req, res) => {
    try {
      const chainEvents = await readChainEvents();
      const allPositions: any[] = [];
      const allDeposits: any[] = [];

      await Promise.allSettled(
        chainEvents.map(async (event) => {
          const [positions, deposits] = await Promise.all([
            readChainPositionsByEvent(event.id),
            readChainDepositsByEvent(event.id),
          ]);
          allPositions.push(...positions);
          allDeposits.push(...deposits);
        })
      );

      res.json({ events: chainEvents, positions: allPositions, deposits: allDeposits });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch hedge data" });
    }
  });

  app.get("/api/admin/revenue", async (_req, res) => {
    try {
      const chainEvents = await readChainEvents();
      const allPositions: any[] = [];
      const allDeposits: any[] = [];

      await Promise.allSettled(
        chainEvents.map(async (event) => {
          const [positions, deposits] = await Promise.all([
            readChainPositionsByEvent(event.id),
            readChainDepositsByEvent(event.id),
          ]);
          allPositions.push(...positions);
          allDeposits.push(...deposits);
        })
      );

      const totalPremiumsCollected = allPositions.reduce((s, p) => s + p.premiumPaid, 0);
      const totalPayouts = allPositions.reduce((s, p) => s + p.payoutAmount, 0);
      const totalLiquidityDeposited = allDeposits.reduce((s, d) => s + d.amount, 0);
      const totalLpPremiumsEarned = allDeposits.reduce((s, d) => s + d.premiumsEarned, 0);
      const platformFeeRevenue = await readPlatformFees();

      const [txFeeStats] = await db.select({
        totalTxFees: sql<string>`coalesce(sum(fee_amount::numeric), 0)::text`,
        totalTransferVolume: sql<string>`coalesce(sum(transfer_amount::numeric), 0)::text`,
        txFeeCount: sql<number>`count(*)::int`,
      }).from(platformFees);

      const totalTxFees = parseFloat(txFeeStats.totalTxFees);
      const netPlatformRevenue = (platformFeeRevenue + totalTxFees).toFixed(2);

      res.json({
        totalPremiumsCollected: totalPremiumsCollected.toFixed(6),
        totalPayouts: totalPayouts.toFixed(6),
        totalLiquidityDeposited: totalLiquidityDeposited.toFixed(6),
        totalLpPremiumsEarned: totalLpPremiumsEarned.toFixed(6),
        hedgePoolFee: platformFeeRevenue.toFixed(2),
        totalTransactionFees: totalTxFees.toFixed(2),
        totalTransferVolume: parseFloat(txFeeStats.totalTransferVolume).toFixed(2),
        transactionFeeCount: txFeeStats.txFeeCount,
        netPlatformRevenue,
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch revenue data" });
    }
  });

  app.get("/api/admin/tasks", async (_req, res) => {
    try {
      const tasks = await db.select().from(dailyTasks).orderBy(dailyTasks.sortOrder);
      const completions = await db.select({
        taskId: userTaskCompletions.taskId,
        count: sql<number>`count(*)::int`,
        totalPoints: sql<number>`coalesce(sum(points_earned), 0)::int`,
      }).from(userTaskCompletions).groupBy(userTaskCompletions.taskId);

      const leaderboard = await db.select({
        walletAddress: userTaskCompletions.walletAddress,
        totalPoints: sql<number>`coalesce(sum(points_earned), 0)::int`,
        tasksCompleted: sql<number>`count(*)::int`,
      }).from(userTaskCompletions)
        .groupBy(userTaskCompletions.walletAddress)
        .orderBy(sql`sum(points_earned) desc`)
        .limit(20);

      res.json({ tasks, completions, leaderboard });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch tasks data" });
    }
  });

  app.post("/api/admin/tasks", async (req, res) => {
    try {
      const { taskKey, title, description, points, category, icon, actionUrl, actionType, isDaily, isActive, sortOrder } = req.body;
      if (!taskKey || !title || !description || !category) {
        return res.status(400).json({ message: "taskKey, title, description, and category are required" });
      }
      const [created] = await db.insert(dailyTasks).values({
        taskKey, title, description,
        points: points || 10,
        category,
        icon: icon || "star",
        actionUrl: actionUrl || null,
        actionType: actionType || "external",
        isDaily: isDaily !== undefined ? isDaily : true,
        isActive: isActive !== undefined ? isActive : true,
        sortOrder: sortOrder || 0,
      }).returning();
      res.json(created);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to create task" });
    }
  });

  app.patch("/api/admin/tasks/:id", async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const { points, isActive, title, description, category, taskKey, icon, actionUrl, actionType, isDaily, sortOrder } = req.body;
      const updates: any = {};
      if (points !== undefined) updates.points = points;
      if (isActive !== undefined) updates.isActive = isActive;
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (category !== undefined) updates.category = category;
      if (taskKey !== undefined) updates.taskKey = taskKey;
      if (icon !== undefined) updates.icon = icon;
      if (actionUrl !== undefined) updates.actionUrl = actionUrl;
      if (actionType !== undefined) updates.actionType = actionType;
      if (isDaily !== undefined) updates.isDaily = isDaily;
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      const [updated] = await db.update(dailyTasks).set(updates).where(eq(dailyTasks.id, taskId)).returning();
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to update task" });
    }
  });

  app.get("/api/admin/analytics", async (_req, res) => {
    try {
      const usersByDay = await db.select({
        date: sql<string>`to_char(created_at, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      }).from(wallets).where(sql`created_at is not null`).groupBy(sql`to_char(created_at, 'YYYY-MM-DD')`).orderBy(sql`to_char(created_at, 'YYYY-MM-DD')`);

      const chainEvents = await readChainEvents();
      const pairMap: Record<string, number> = {};
      const statusMap: Record<string, number> = {};
      for (const e of chainEvents) {
        pairMap[e.underlying] = (pairMap[e.underlying] || 0) + 1;
        statusMap[e.status] = (statusMap[e.status] || 0) + 1;
      }
      const hedgesByPair = Object.entries(pairMap).map(([pair, count]) => ({ pair, count }));
      const hedgesByStatus = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

      res.json({ usersByDay, hedgesByPair, hedgesByStatus });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch analytics" });
    }
  });

  app.get("/api/admin/articles", requireAdmin, async (_req, res) => {
    try {
      const all = await storage.getAllArticles(false);
      res.json(all);
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch articles" });
    }
  });

  app.post("/api/admin/articles", requireAdmin, async (req, res) => {
    try {
      const { title, subtitle, category, content, readTime, published, slug, publishedAt } = req.body;
      if (!title || !slug) return res.status(400).json({ message: "title and slug are required" });
      const article = await storage.createArticle({
        title, subtitle: subtitle || "", category: category || "Hedging",
        content: content || [], readTime: readTime || "5 min read",
        published: published !== false, slug,
        publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
      });
      res.json(article);
    } catch (e: any) {
      if (e?.message?.includes("unique")) return res.status(409).json({ message: "A post with that slug already exists" });
      res.status(500).json({ message: "Failed to create article" });
    }
  });

  app.patch("/api/admin/articles/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateArticle(id, req.body);
      if (!updated) return res.status(404).json({ message: "Article not found" });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: "Failed to update article" });
    }
  });

  app.delete("/api/admin/articles/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const ok = await storage.deleteArticle(id);
      if (!ok) return res.status(404).json({ message: "Article not found" });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: "Failed to delete article" });
    }
  });

  app.get("/api/admin/total-withdrawn", requireAdmin, async (req, res) => {
    try {
      const { explorerApi, diamond, token: tokenAddr, decimals } = req.query as Record<string, string>;
      if (!explorerApi || !diamond || !tokenAddr || !decimals) {
        return res.json({ total: 0 });
      }
      const url = `${explorerApi}?module=account&action=tokentx&address=${diamond}&contractaddress=${tokenAddr}&sort=asc&limit=10000`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const data = await r.json();
      if (!data.result || !Array.isArray(data.result)) return res.json({ total: 0 });
      const dec = parseInt(decimals, 10) || 6;
      const total = data.result
        .filter((tx: any) => tx.from?.toLowerCase() === diamond.toLowerCase())
        .reduce((sum: number, tx: any) => sum + Number(tx.value) / Math.pow(10, dec), 0);
      res.json({ total });
    } catch (e: any) {
      res.json({ total: 0 });
    }
  });

  app.get("/api/admin/oracle-addresses", async (_req, res) => {
    try {
      const { ethers } = await import("ethers");
      const nodes = [
        { label: "Oracle-A", key: process.env.ORACLE_KEY_A },
        { label: "Oracle-B", key: process.env.ORACLE_KEY_B },
        { label: "Oracle-C", key: process.env.ORACLE_KEY_C },
      ];
      const result = nodes.map(({ label, key }) => ({
        label,
        address: key ? new ethers.Wallet(key).address : null,
        configured: !!key,
      }));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/backup/export", async (_req, res) => {
    try {
      const [
        allWallets, allProfiles, allHedgeEvents, allPositions,
        allLpDeposits, allFees, allTaskCompletions, allPoints,
        allPointTx, allTerms, allReferrals, allReferralCodes, allArticles,
      ] = await Promise.all([
        db.select({ id: wallets.id, address: wallets.address, name: wallets.name, email: wallets.email, userId: wallets.userId, createdAt: wallets.createdAt }).from(wallets),
        db.select().from(userProfiles),
        db.select().from(hedgeEvents),
        db.select().from(hedgePositions),
        db.select().from(hedgeLpDeposits),
        db.select().from(platformFees),
        db.select().from(userTaskCompletions),
        db.select().from(userPoints),
        db.select().from(pointTransactions),
        db.select().from(termsAcceptances),
        db.select().from(referrals),
        db.select().from(referralCodes),
        db.select().from(articles),
      ]);

      const backup = {
        exportedAt: new Date().toISOString(),
        version: "1.0",
        tables: {
          wallets: allWallets, userProfiles: allProfiles, hedgeEvents: allHedgeEvents,
          hedgePositions: allPositions, hedgeLpDeposits: allLpDeposits, platformFees: allFees,
          userTaskCompletions: allTaskCompletions, userPoints: allPoints, pointTransactions: allPointTx,
          termsAcceptances: allTerms, referrals: allReferrals, referralCodes: allReferralCodes,
          articles: allArticles,
        },
        counts: {
          wallets: allWallets.length, userProfiles: allProfiles.length, hedgeEvents: allHedgeEvents.length,
          hedgePositions: allPositions.length, hedgeLpDeposits: allLpDeposits.length, platformFees: allFees.length,
          userTaskCompletions: allTaskCompletions.length, userPoints: allPoints.length,
          pointTransactions: allPointTx.length, termsAcceptances: allTerms.length,
          referrals: allReferrals.length, referralCodes: allReferralCodes.length, articles: allArticles.length,
        },
      };

      const filename = `blockfinax-backup-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.json(backup);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Backup failed" });
    }
  });

  app.get("/api/admin/health", async (_req, res) => {
    try {
      const result = await db.execute(sql`select now()::text as server_time`);
      const serverTime = (result as any)?.rows?.[0]?.server_time || new Date().toISOString();
      res.json({
        status: 'healthy',
        database: { connected: true, serverTime },
        websocket: { activeConnections: wss.clients.size },
      });
    } catch (error) {
      res.json({ status: 'unhealthy', database: { connected: false }, websocket: { activeConnections: 0 } });
    }
  });

  app.get("/api/admin/activity", async (_req, res) => {
    try {
      const allReferrals = await storage.getAllReferrals();
      const allWallets = await storage.getAllWallets();
      const activities: any[] = [];

      allReferrals.filter((ref: any) => ref.createdAt)
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10)
        .forEach((ref: any) => {
          activities.push({ type: 'referral', description: 'Referral code used', userAddress: ref.referredWalletAddress, timestamp: ref.createdAt });
        });

      allWallets.filter((w: any) => w.createdAt)
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10)
        .forEach((w: any) => {
          activities.push({ type: 'registration', description: 'New wallet created', userAddress: w.address, timestamp: w.createdAt });
        });

      activities.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json(activities.slice(0, 20));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch activity" });
    }
  });
}
