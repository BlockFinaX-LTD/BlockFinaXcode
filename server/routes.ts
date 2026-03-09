/**
 * Server Routes Configuration
 * 
 * Handles all API endpoints for wallet management, hedge,
 * tasks system, and FX oracle.
 */

import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import type { Referral } from "../shared/referral-schema";
import { wallets, subscribers, transactions, balances, hedgeEvents, hedgePositions, hedgeLpDeposits, dailyTasks, userTaskCompletions, platformFees } from "../shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { requireSignature, optionalSignature, type AuthenticatedRequest } from "./middleware/signature-auth";
import { generalApiLimiter, financialMutationLimiter, walletLimiter } from "./middleware/rate-limiter";
import { readChainEvents, readChainPositionsByEvent, readChainDepositsByEvent, readPlatformFees, invalidateChainCache } from "./hedge-reader";

/**
 * Register all API routes and WebSocket handlers
 * Returns HTTP server instance with WebSocket support
 * 
 * ROUTE INDEX:
 * [HEALTH]         GET  /api/health
 * [USER]           GET/POST /api/user/role
 * [ADMIN]          GET  /api/admin/*
 * [WALLET]         GET/POST /api/wallets, /networks, /transactions, /balances
 * [WAITLIST]       POST/GET /api/waitlist
 * [FX-ORACLE]      GET  /api/fx/rates, /rate
 * [HEDGE]          GET/POST /api/hedge/*
 */
export async function registerRoutes(app: Express): Promise<Server> {

  app.use("/api/", generalApiLimiter);
  app.use("/api/hedge/", financialMutationLimiter);
  app.use("/api/wallets/", walletLimiter);

  const signedRoutePrefixes = [
    "/api/hedge/",
  ];
  
  app.use((req, res, next) => {
    const isWriteMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    const isSensitiveRoute = signedRoutePrefixes.some(prefix => req.path.startsWith(prefix));
    
    if (isWriteMethod && isSensitiveRoute) {
      return requireSignature(req as AuthenticatedRequest, res, next);
    }
    next();
  });

  // ═══════════════════════════════════════════════════════
  // [HEALTH] Health Check
  // ═══════════════════════════════════════════════════════
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/network-config", (req, res) => {
    const networkMode = process.env.NETWORK_MODE || "testnet";
    res.json({
      mode: networkMode,
      isMainnet: networkMode === "mainnet",
      chainId: 4202,
      networkName: "Lisk Sepolia",
      signatureRequired: networkMode === "mainnet"
    });
  });

  // ═══════════════════════════════════════════════════════
  // [USER] User Role Management
  // ═══════════════════════════════════════════════════════
  app.get("/api/user/role/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      
      if (!walletAddress) {
        return res.status(400).json({ message: "Wallet address is required" });
      }

      const userRole = await storage.getUserRole(walletAddress);
      
      if (!userRole) {
        return res.status(404).json({ message: "User role not found" });
      }

      res.json(userRole);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to fetch user role" 
      });
    }
  });

  app.post("/api/user/role", async (req, res) => {
    try {
      const { walletAddress, role } = req.body;
      
      if (!walletAddress || !role) {
        return res.status(400).json({ message: "Wallet address and role are required" });
      }

      const validRoles = ['individual', 'business'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ message: "Invalid role specified" });
      }

      // Check if user already has a role
      const existingRole = await storage.getUserRole(walletAddress);
      
      if (existingRole) {
        // Update existing role
        const updatedRole = await storage.updateUserRole(walletAddress, {
          role,
          lastActivity: new Date(),
          isActive: true
        });
        res.json({ message: "Role updated successfully", role: updatedRole });
      } else {
        // Create new role
        const newRole = await storage.createUserRole({
          walletAddress,
          role,
          kycStatus: 'pending',
          isActive: true
        });
        res.json({ message: "Role assigned successfully", role: newRole });
      }
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to assign role" 
      });
    }
  });

  // ═══════════════════════════════════════════════════════
  // [ADMIN] Admin Dashboard
  // ═══════════════════════════════════════════════════════
  const adminSessions = new Set<string>();

  function generateAdminToken(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 48; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
    return token;
  }

  function requireAdmin(req: any, res: any, next: any) {
    const token = req.headers["x-admin-token"] as string;
    if (!token || !adminSessions.has(token)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  }

  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return res.status(500).json({ message: "Admin password not configured" });
    }
    if (password !== adminPassword) {
      return res.status(401).json({ message: "Invalid password" });
    }
    const token = generateAdminToken();
    adminSessions.add(token);
    res.json({ token });
  });

  app.post("/api/admin/logout", (req, res) => {
    const token = req.headers["x-admin-token"] as string;
    if (token) adminSessions.delete(token);
    res.json({ success: true });
  });

  app.use("/api/admin", (req, res, next) => {
    if (req.path === "/login" || req.path === "/logout") return next();
    requireAdmin(req, res, next);
  });

  app.get("/api/admin/overview", async (_req, res) => {
    try {
      const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(wallets);
      const [txCount] = await db.select({ count: sql<number>`count(*)::int`, volume: sql<string>`coalesce(sum(value::numeric), 0)::text` }).from(transactions);
      const [taskCompletionCount] = await db.select({ count: sql<number>`count(*)::int`, totalPoints: sql<number>`coalesce(sum(points_earned), 0)::int` }).from(userTaskCompletions);

      const chainEvents = await readChainEvents();
      const activeHedgeEvents = chainEvents.filter(e => e.status === 'open').length;
      const totalPremiums = chainEvents.reduce((s, e) => s + e.totalPremiums, 0);
      const totalLiquidity = chainEvents.reduce((s, e) => s + e.totalLiquidity, 0);
      const totalPositions = chainEvents.reduce((s, e) => s + e.hedgerCount, 0);
      const totalLpDeposits = chainEvents.reduce((s, e) => s + e.lpCount, 0);
      const platformFeeRevenue = await readPlatformFees();

      res.json({
        totalUsers: userCount.count,
        totalTransactions: txCount.count,
        transactionVolume: txCount.volume,
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
      const result = allWallets
        .filter(w => !search || w.address.toLowerCase().includes(search) || (w.name && w.name.toLowerCase().includes(search)) || (w.email && w.email.toLowerCase().includes(search)))
        .map(w => ({
          id: w.id,
          address: w.address,
          name: w.name,
          email: w.email || null,
          isImported: w.isImported,
          createdAt: w.createdAt,
        }));
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch users" });
    }
  });

  app.get("/api/admin/transactions", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const wallet = (req.query.wallet as string || "").toLowerCase();
      let query = db.select().from(transactions).orderBy(desc(transactions.timestamp));
      const allTx = await query;
      const filtered = allTx.filter(tx => {
        if (status && tx.status !== status) return false;
        if (wallet && !tx.from.toLowerCase().includes(wallet) && !tx.to.toLowerCase().includes(wallet)) return false;
        return true;
      });
      res.json(filtered.slice(0, 200));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch transactions" });
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

      const txByDay = await db.select({
        date: sql<string>`to_char(timestamp, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
        volume: sql<string>`coalesce(sum(value::numeric), 0)::text`,
      }).from(transactions).where(sql`timestamp is not null`).groupBy(sql`to_char(timestamp, 'YYYY-MM-DD')`).orderBy(sql`to_char(timestamp, 'YYYY-MM-DD')`);

      const chainEvents = await readChainEvents();
      const pairMap: Record<string, number> = {};
      const statusMap: Record<string, number> = {};
      for (const e of chainEvents) {
        pairMap[e.underlying] = (pairMap[e.underlying] || 0) + 1;
        statusMap[e.status] = (statusMap[e.status] || 0) + 1;
      }
      const hedgesByPair = Object.entries(pairMap).map(([pair, count]) => ({ pair, count }));
      const hedgesByStatus = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

      res.json({ usersByDay, hedgesByPair, hedgesByStatus, txByDay });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch analytics" });
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
      const referrals = await storage.getAllReferrals();
      const allWallets = await storage.getAllWallets();
      const activities: any[] = [];
      
      referrals.filter((ref: any) => ref.createdAt)
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

  // ═══════════════════════════════════════════════════════
  // [ADMIN ARTICLES] Article Content Management
  // ═══════════════════════════════════════════════════════
  app.get("/api/admin/articles", async (_req, res) => {
    try {
      const allArticles = await storage.getArticles(false);
      res.json(allArticles);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch articles" });
    }
  });

  app.post("/api/admin/articles", async (req, res) => {
    try {
      const article = await storage.createArticle(req.body);
      res.status(201).json(article);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create article" });
    }
  });

  app.patch("/api/admin/articles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const article = await storage.updateArticle(id, req.body);
      if (!article) return res.status(404).json({ message: "Article not found" });
      res.json(article);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to update article" });
    }
  });

  app.delete("/api/admin/articles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteArticle(id);
      if (!deleted) return res.status(404).json({ message: "Article not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to delete article" });
    }
  });

  // ═══════════════════════════════════════════════════════
  // [PUBLIC ARTICLES] Published Articles API
  // ═══════════════════════════════════════════════════════
  app.get("/api/articles", async (_req, res) => {
    try {
      const publishedArticles = await storage.getArticles(true);
      res.json(publishedArticles);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch articles" });
    }
  });

  app.get("/api/articles/:slug", async (req, res) => {
    try {
      const article = await storage.getArticleBySlug(req.params.slug);
      if (!article || !article.isPublished) return res.status(404).json({ message: "Article not found" });
      res.json(article);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch article" });
    }
  });
  // ═══════════════════════════════════════════════════════
  // [WALLET] Wallet & Transaction Management
  // ═══════════════════════════════════════════════════════
  app.get("/api/wallets", async (req, res) => {
    try {
      const wallets = await storage.getAllWallets();
      res.json(wallets);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to fetch wallets" 
      });
    }
  });

  app.post("/api/wallets", async (req, res) => {
    try {
      const existing = await storage.getWalletByAddress(req.body.address);
      if (existing) {
        return res.status(200).json(existing);
      }

      const wallet = await storage.createWallet(req.body);

      const SIGNUP_BONUS = 100;
      let userPoints = await storage.getUserPoints(wallet.address);
      if (!userPoints) {
        userPoints = await storage.createUserPoints({
          walletAddress: wallet.address,
          totalPoints: SIGNUP_BONUS,
          referralPoints: 0,
        });
      } else {
        await storage.updateUserPoints(wallet.address, SIGNUP_BONUS);
      }
      await storage.createPointTransaction({
        walletAddress: wallet.address,
        type: 'signup_bonus',
        points: SIGNUP_BONUS,
        description: 'Welcome bonus for creating an account',
        referenceId: wallet.address,
      });

      res.status(201).json(wallet);
    } catch (error) {
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to create wallet" 
      });
    }
  });

  app.post("/api/wallets/email", async (req, res) => {
    try {
      const { walletAddress, email } = req.body;
      if (!walletAddress || !email) {
        return res.status(400).json({ error: "walletAddress and email required" });
      }
      await db.update(wallets).set({ email }).where(eq(wallets.address, walletAddress));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save email" });
    }
  });

  app.get("/api/wallets/:id", async (req, res) => {
    try {
      const wallet = await storage.getWallet(parseInt(req.params.id));
      if (!wallet) {
        return res.status(404).json({ message: "Wallet not found" });
      }
      res.json(wallet);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to fetch wallet" 
      });
    }
  });

  app.get("/api/wallet/:address/token-balances", async (req, res) => {
    try {
      const { address } = req.params;
      const { networkId } = req.query;
      const chainId = networkId ? parseInt(networkId as string) : 4202;

      const ethers = await import("ethers");

      let rpcUrl = "https://rpc.sepolia-api.lisk.com";
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      const usdcAddress = "0xf52Ad63619Bf9cFeF510341ac6b4038554399562";
      const usdcContract = new ethers.Contract(usdcAddress, [
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)"
      ], provider);

      const rawBalance = await usdcContract.balanceOf(address);
      const decimals = await usdcContract.decimals();
      const balance = ethers.formatUnits(rawBalance, Number(decimals));
      const usdValue = parseFloat(balance) * 1.0;

      res.json({
        balances: [{
          token: {
            symbol: "USDC",
            name: "Test USDC",
            address: usdcAddress,
            decimals: Number(decimals),
            icon: "💵",
            color: "#2775CA"
          },
          balance,
          usdValue
        }]
      });
    } catch (error: any) {
      res.json({ balances: [] });
    }
  });

  // Fetch wallet transactions from blockchain explorer
  app.get("/api/wallet/:address/transactions", async (req, res) => {
    try {
      const { address } = req.params;
      const { networkId } = req.query;
      const chainId = networkId ? parseInt(networkId as string) : 4202;
      
      let baseUrl = '';
      
      if (chainId === 4202) {
        baseUrl = 'https://sepolia-blockscout.lisk.com/api';
      }
      
      if (!baseUrl) {
        return res.json({ transactions: [] });
      }
      
      const usdcContracts = [
        '0x0e82fddad51cc3ac12b69761c45bbcb9a2bf3c83', // Lisk Sepolia USDC.e
        '0xf52ad63619bf9cfef510341ac6b4038554399562', // Lisk Sepolia Test USDC
      ];
      
      const txListUrl = `${baseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc`;
      const tokenTxUrl = `${baseUrl}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc`;
      
      const [txResponse, tokenResponse] = await Promise.all([
        fetch(txListUrl).then(r => r.json()).catch(() => ({ status: '0', result: [] })),
        fetch(tokenTxUrl).then(r => r.json()).catch(() => ({ status: '0', result: [] })),
      ]);
      
      const allTransactions: any[] = [];
      const seenHashes = new Set<string>();
      
      if (tokenResponse.status === '1' && Array.isArray(tokenResponse.result)) {
        for (const tx of tokenResponse.result) {
          const contractAddr = tx.contractAddress?.toLowerCase() || '';
          const isUsdc = usdcContracts.includes(contractAddr);
          const decimals = parseInt(tx.tokenDecimal) || 6;
          const rawAmount = BigInt(tx.value || '0');
          const displayValue = (Number(rawAmount) / Math.pow(10, decimals)).toString();
          const usdValue = isUsdc ? Number(rawAmount) / Math.pow(10, decimals) : 0;
          
          allTransactions.push({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: displayValue,
            type: tx.from.toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
            status: 'confirmed',
            timestamp: new Date(parseInt(tx.timeStamp) * 1000),
            blockNumber: tx.blockNumber,
            gasUsed: tx.gasUsed || '0',
            gasPrice: tx.gasPrice || '0',
            usdValue,
            tokenSymbol: isUsdc ? 'USDC' : (tx.tokenSymbol || 'TOKEN'),
            isTokenTransfer: true
          });
          seenHashes.add(tx.hash);
        }
      }
      
      if (txResponse.status === '1' && Array.isArray(txResponse.result)) {
        for (const tx of txResponse.result) {
          if (seenHashes.has(tx.hash)) continue;
          
          const ethValue = parseFloat(tx.value) / 1e18;
          if (ethValue === 0 && tx.input && tx.input !== '0x') continue;
          
          allTransactions.push({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: ethValue.toString(),
            type: tx.from.toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
            status: tx.txreceipt_status === '1' ? 'confirmed' : 'failed',
            timestamp: new Date(parseInt(tx.timeStamp) * 1000),
            blockNumber: tx.blockNumber,
            gasUsed: tx.gasUsed,
            gasPrice: tx.gasPrice,
            usdValue: ethValue * 3200,
            tokenSymbol: 'ETH',
            isTokenTransfer: false
          });
        }
      }
      
      allTransactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      res.json({ transactions: allTransactions.slice(0, 50) });
    } catch (error) {
      res.json({ transactions: [] });
    }
  });

  // Network management endpoints
  app.get("/api/networks", async (req, res) => {
    try {
      const networks = await storage.getAllNetworks();
      res.json(networks);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to fetch networks" 
      });
    }
  });

  app.post("/api/networks", async (req, res) => {
    try {
      const network = await storage.createNetwork(req.body);
      res.status(201).json(network);
    } catch (error) {
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to create network" 
      });
    }
  });

  // Transaction management endpoints
  app.get("/api/transactions", async (req, res) => {
    try {
      const { walletId, networkId, limit = 50 } = req.query;
      const transactions = await storage.getTransactions({
        walletId: walletId ? parseInt(walletId as string) : undefined,
        networkId: networkId ? parseInt(networkId as string) : undefined,
        limit: parseInt(limit as string)
      });
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to fetch transactions" 
      });
    }
  });

  app.post("/api/transactions", async (req, res) => {
    try {
      const existingTx = await storage.getTransactionByHash(req.body.hash);
      if (existingTx) {
        return res.status(200).json(existingTx);
      }
      const transaction = await storage.createTransaction(req.body);
      
      // Check if this is the user's first transaction and award bonus
      if (transaction.from) {
        // Get all transactions from this wallet address
        const wallet = await storage.getWalletByAddress(transaction.from);
        if (wallet) {
          const userTransactions = await storage.getTransactions({ walletId: wallet.id });
          
          // If this is the first transaction (only one exists), award bonus
          if (userTransactions.length === 1) {
            const FIRST_TRANSACTION_BONUS = 25;
            
            // Award points
            let userPoints = await storage.getUserPoints(transaction.from);
            if (!userPoints) {
              userPoints = await storage.createUserPoints({
                walletAddress: transaction.from,
                totalPoints: FIRST_TRANSACTION_BONUS,
                referralPoints: 0,
              });
            } else {
              await storage.updateUserPoints(transaction.from, FIRST_TRANSACTION_BONUS);
            }
            
            // Create point transaction record
            await storage.createPointTransaction({
              walletAddress: transaction.from,
              type: 'first_transaction_bonus',
              points: FIRST_TRANSACTION_BONUS,
              description: 'Bonus for completing your first transaction',
              referenceId: transaction.hash,
            });
          }
        }
      }
      
      res.status(201).json(transaction);
    } catch (error) {
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to create transaction" 
      });
    }
  });

  app.get("/api/transactions/:hash", async (req, res) => {
    try {
      const transaction = await storage.getTransactionByHash(req.params.hash);
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      res.json(transaction);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to fetch transaction" 
      });
    }
  });

  app.patch("/api/transactions/:hash", async (req, res) => {
    try {
      const transaction = await storage.updateTransaction(req.params.hash, req.body);
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      res.json(transaction);
    } catch (error) {
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to update transaction" 
      });
    }
  });

  // Balance management endpoints
  app.get("/api/balances", async (req, res) => {
    try {
      const { walletId, networkId } = req.query;
      const balances = await storage.getBalances({
        walletId: walletId ? parseInt(walletId as string) : undefined,
        networkId: networkId ? parseInt(networkId as string) : undefined
      });
      res.json(balances);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to fetch balances" 
      });
    }
  });

  app.post("/api/balances", async (req, res) => {
    try {
      const balance = await storage.createBalance(req.body);
      res.status(201).json(balance);
    } catch (error) {
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to create balance" 
      });
    }
  });

  app.patch("/api/balances/:id", async (req, res) => {
    try {
      const balance = await storage.updateBalance(parseInt(req.params.id), req.body);
      if (!balance) {
        return res.status(404).json({ message: "Balance not found" });
      }
      res.json(balance);
    } catch (error) {
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to update balance" 
      });
    }
  });

  app.get("/api/stats/platform", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const walletResult = await db.execute(sql`SELECT COUNT(*)::int as count FROM wallets`);
      const profileResult = await db.execute(sql`SELECT COUNT(*)::int as count FROM user_profiles`);
      const activeResult = await db.execute(sql`SELECT COUNT(*)::int as count FROM hedge_events WHERE status = 'open'`);
      const totalResult = await db.execute(sql`SELECT COUNT(*)::int as count FROM hedge_events`);
      const rows = walletResult.rows || walletResult;
      const pRows = profileResult.rows || profileResult;
      const aRows = activeResult.rows || activeResult;
      const tRows = totalResult.rows || totalResult;
      res.json({
        totalWallets: Number(rows[0]?.count || 0),
        totalProfiles: Number(pRows[0]?.count || 0),
        activeHedgeEvents: Number(aRows[0]?.count || 0),
        totalHedgeEvents: Number(tRows[0]?.count || 0),
      });
    } catch (error) {
      console.error("Platform stats error:", error);
      res.json({ totalWallets: 0, totalProfiles: 0, activeHedgeEvents: 0, totalHedgeEvents: 0 });
    }
  });

  // Statistics endpoints
  app.get("/api/stats/portfolio/:walletId", async (req, res) => {
    try {
      const walletId = parseInt(req.params.walletId);
      const stats = await storage.getPortfolioStats(walletId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to fetch portfolio stats" 
      });
    }
  });
  // ═══════════════════════════════════════════════════════
  // [WAITLIST] Early Adopter Waitlist
  // ═══════════════════════════════════════════════════════
  app.post("/api/waitlist", async (req, res) => {
    try {
      const { insertWaitlistSchema } = await import("@shared/schema");
      
      // Normalize email to lowercase
      const data = {
        ...req.body,
        email: req.body.email?.toLowerCase()
      };
      
      const validatedData = insertWaitlistSchema.parse(data);
      
      // Check if email already exists
      const existing = await storage.getWaitlistByEmail(validatedData.email);
      if (existing) {
        return res.status(409).json({ 
          message: "This email is already on the waitlist. We'll be in touch soon!" 
        });
      }
      
      const entry = await storage.createWaitlistEntry(validatedData);
      
      res.status(201).json({ 
        message: "Successfully joined the waitlist! We'll be in touch soon.",
        id: entry.id
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('unique')) {
        return res.status(409).json({ 
          message: "This email is already on the waitlist." 
        });
      }
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to join waitlist" 
      });
    }
  });

  // Get waitlist count (public)
  app.get("/api/waitlist/count", async (req, res) => {
    try {
      const count = await storage.getWaitlistCount();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to get waitlist count" 
      });
    }
  });

  // ═══════════════════════════════════════════════════════
  // [SUBSCRIBERS] Email subscribers
  // ═══════════════════════════════════════════════════════

  app.post("/api/subscribe", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: "Valid email required" });
      }
      const normalized = email.toLowerCase().trim();
      const existing = await db.select().from(subscribers).where(eq(subscribers.email, normalized)).limit(1);
      if (existing.length > 0) {
        return res.json({ message: "You're already subscribed!" });
      }
      await db.insert(subscribers).values({ email: normalized });
      res.json({ message: "You're in! We'll keep you updated." });
    } catch (error) {
      res.status(500).json({ error: "Failed to subscribe" });
    }
  });

  // ═══════════════════════════════════════════════════════
  // [FX-ORACLE] FX Rates & Oracle
  // ═══════════════════════════════════════════════════════

  const { fetchAllRates, getRate, getSupportedPairs, getSupportedPairsWithClass, checkAndSettleEvents, startOraclePoller } = await import("./fx-oracle");

  startOraclePoller(5 * 60 * 1000);

  const gasSponsorCooldown = new Map<string, number>();

  app.post("/api/gas/sponsor", async (req, res) => {
    try {
      const { walletAddress } = req.body;
      if (!walletAddress) {
        return res.status(400).json({ message: "Wallet address required" });
      }

      const addr = walletAddress.toLowerCase();
      const now = Date.now();
      const lastSponsored = gasSponsorCooldown.get(addr) || 0;
      if (now - lastSponsored < 60000) {
        return res.json({ success: true, sponsored: false, message: "Recently sponsored" });
      }

      const ethers = await import("ethers");
      const provider = new ethers.JsonRpcProvider("https://rpc.sepolia-api.lisk.com");
      const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
      if (!deployerKey) {
        return res.status(500).json({ message: "Gas sponsor not configured" });
      }

      const userBalance = await provider.getBalance(walletAddress);
      const minGasBalance = ethers.parseEther("0.001");

      if (userBalance >= minGasBalance) {
        return res.json({ success: true, sponsored: false, message: "Sufficient gas balance" });
      }

      const deployer = new ethers.Wallet(deployerKey, provider);
      const gasAmount = ethers.parseEther("0.005");

      const deployerBalance = await provider.getBalance(deployer.address);
      if (deployerBalance < gasAmount) {
        return res.status(400).json({ message: "Gas sponsor wallet low on ETH" });
      }

      const tx = await deployer.sendTransaction({
        to: walletAddress,
        value: gasAmount,
      });
      await tx.wait();

      gasSponsorCooldown.set(addr, now);

      res.json({ success: true, sponsored: true, txHash: tx.hash, amount: "0.005" });
    } catch (error: any) {
      console.error("Gas sponsor error:", error);
      res.status(500).json({ message: error.message || "Gas sponsorship failed" });
    }
  });

  app.post("/api/faucet/request", async (req, res) => {
    try {
      const { walletAddress, amount } = req.body;
      if (!walletAddress || !amount) {
        return res.status(400).json({ message: "Wallet address and amount required" });
      }
      const requestedAmount = parseFloat(amount);
      if (isNaN(requestedAmount) || requestedAmount <= 0 || requestedAmount > 500) {
        return res.status(400).json({ message: "Amount must be between 1 and 500 USDC per day" });
      }
      const ethers = await import("ethers");
      const provider = new ethers.JsonRpcProvider("https://rpc.sepolia-api.lisk.com");
      const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
      if (!deployerKey) {
        return res.status(500).json({ message: "Faucet not configured" });
      }
      const deployer = new ethers.Wallet(deployerKey, provider);
      const usdcAddress = "0xf52Ad63619Bf9cFeF510341ac6b4038554399562";
      const usdc = new ethers.Contract(usdcAddress, [
        "function transfer(address to, uint256 amount) returns (bool)",
        "function balanceOf(address) view returns (uint256)"
      ], deployer);
      const balance = await usdc.balanceOf(deployer.address);
      const amountWei = ethers.parseUnits(requestedAmount.toString(), 6);
      if (balance < amountWei) {
        return res.status(400).json({ message: "Faucet is empty, please try again later" });
      }
      const tx = await usdc.transfer(walletAddress, amountWei);
      await tx.wait();
      res.json({ success: true, txHash: tx.hash, amount: requestedAmount });
    } catch (error: any) {
      console.error("Faucet error:", error);
      res.status(500).json({ message: error.message || "Faucet transfer failed" });
    }
  });

  const FEE_CONFIG = {
    walletTransferPercent: 0.3,
    minimumFeeCents: 50,
    hedgePoolPercent: 0.5,
  };

  app.get("/api/fees/calculate", (req, res) => {
    try {
      const amount = parseFloat(req.query.amount as string);
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ message: "Valid amount is required" });
      }
      const percentFee = amount * (FEE_CONFIG.walletTransferPercent / 100);
      const minimumFee = FEE_CONFIG.minimumFeeCents / 100;
      const feeAmount = Math.max(percentFee, minimumFee);
      const netAmount = Math.max(amount - feeAmount, 0);

      res.json({
        transferAmount: amount,
        feeAmount: parseFloat(feeAmount.toFixed(6)),
        feePercent: FEE_CONFIG.walletTransferPercent,
        minimumFee,
        netAmount: parseFloat(netAmount.toFixed(6)),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to calculate fee" });
    }
  });

  app.post("/api/fees/record", async (req, res) => {
    try {
      const { txHash, feeTxHash, fromWallet, toWallet, transferAmount, token, chainId } = req.body;
      if (!txHash || !fromWallet || !toWallet || !transferAmount) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const amt = parseFloat(transferAmount);
      if (isNaN(amt) || amt <= 0) {
        return res.status(400).json({ message: "Invalid transfer amount" });
      }
      const percentFee = amt * (FEE_CONFIG.walletTransferPercent / 100);
      const minimumFee = FEE_CONFIG.minimumFeeCents / 100;
      const computedFee = Math.max(percentFee, minimumFee);

      await db.insert(platformFees).values({
        txHash,
        feeTxHash: feeTxHash || null,
        fromWallet,
        toWallet,
        transferAmount: amt.toFixed(6),
        feeAmount: computedFee.toFixed(6),
        feePercent: FEE_CONFIG.walletTransferPercent.toString(),
        token: token || "USDC",
        chainId: chainId || 4202,
        status: feeTxHash ? "collected" : "pending",
      });

      res.json({ success: true, feeAmount: computedFee });
    } catch (error: any) {
      console.error("Fee record error:", error);
      res.status(500).json({ message: error.message || "Failed to record fee" });
    }
  });

  app.get("/api/fees/treasury-address", async (_req, res) => {
    try {
      const { getTreasuryAddress } = await import("./treasury-wallet");
      const address = getTreasuryAddress();
      res.json({ address });
    } catch (error) {
      res.status(500).json({ message: "Failed to get treasury address" });
    }
  });

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

  app.post("/api/fx/auto-settle", async (req, res) => {
    try {
      const result = await checkAndSettleEvents();
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to run auto-settle" });
    }
  });

  // ═══════════════════════════════════════════════════════
  // [HEDGE] P2P Trade Hedge
  // ═══════════════════════════════════════════════════════

  // Get all hedge events
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
            totalLiquidity,
            totalExposure,
            totalPremiums,
            utilization: Math.min(utilization, 100),
            availableCapacity: Math.max(0, totalLiquidity - totalExposure),
            lpCount: deposits.filter(d => !d.withdrawn).length,
            hedgerCount: positions.filter(p => p.status === "active").length
          }
        };
      }));
      res.json(eventsWithStats);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch hedge events" });
    }
  });

  // Get open hedge events
  app.get("/api/hedge/events/open", async (_req, res) => {
    try {
      const events = await storage.getOpenHedgeEvents();
      res.json(events);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch open hedge events" });
    }
  });

  // Get single hedge event with pool stats
  app.get("/api/hedge/events/:id", async (req, res) => {
    try {
      const event = await storage.getHedgeEvent(parseInt(req.params.id));
      if (!event) return res.status(404).json({ message: "Event not found" });

      const positions = await storage.getHedgePositionsByEvent(event.id);
      const deposits = await storage.getHedgeLpDepositsByEvent(event.id);

      const totalLiquidity = deposits
        .filter(d => !d.withdrawn)
        .reduce((sum, d) => sum + parseFloat(d.amount), 0);
      const totalExposure = positions
        .filter(p => p.status === "active")
        .reduce((sum, p) => sum + parseFloat(p.maxPayout), 0);
      const totalPremiums = positions.reduce((sum, p) => sum + parseFloat(p.premiumPaid), 0);
      const utilization = totalLiquidity > 0 ? (totalExposure / totalLiquidity) * 100 : 0;

      res.json({
        ...event,
        poolStats: {
          totalLiquidity,
          totalExposure,
          totalPremiums,
          utilization: Math.min(utilization, 100),
          availableCapacity: Math.max(0, totalLiquidity - totalExposure),
          lpCount: deposits.filter(d => !d.withdrawn).length,
          hedgerCount: positions.filter(p => p.status === "active").length
        }
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch hedge event" });
    }
  });

  app.post("/api/hedge/events", async (req, res) => {
    try {
      const { name, description, underlying, strike, premiumRate, payoutRate, safetyFactor, expiryDate, createdBy, poolOpen, allowExternalLp, initialLiquidity } = req.body;

      if (!name || !underlying || !strike || !premiumRate || !expiryDate || !createdBy) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (!initialLiquidity || parseFloat(initialLiquidity) < 10) {
        return res.status(400).json({ message: "Initial liquidity is required (minimum $10)" });
      }

      const EVENT_CREATION_FEE = 25;

      const expiry = new Date(expiryDate);
      if (expiry <= new Date()) {
        return res.status(400).json({ message: "Expiry date must be in the future" });
      }

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

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const updated = await storage.updateHedgeEvent(event.id, updates);
      res.json({ ...updated, message: "Pool settings updated" });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to update pool settings" });
    }
  });

  // Buy protection (hedger)
  app.post("/api/hedge/positions", async (req, res) => {
    try {
      const { eventId, hedgerWallet, notional } = req.body;

      if (!eventId || !hedgerWallet || !notional) {
        return res.status(400).json({ message: "Missing required fields: eventId, hedgerWallet, notional" });
      }

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

      // Check pool capacity — compare estimated max payout against available liquidity
      // Payout formula: Notional × (Rate - Strike) / Strike, capped by payoutRate
      const positions = await storage.getHedgePositionsByEvent(event.id);
      const deposits = await storage.getHedgeLpDepositsByEvent(event.id);
      const totalLiquidity = deposits.filter(d => !d.withdrawn).reduce((sum, d) => sum + parseFloat(d.amount), 0);
      const currentExposure = positions.filter(p => p.status === "active").reduce((sum, p) => sum + parseFloat(p.maxPayout), 0);
      const maxCapacity = totalLiquidity;

      if (currentExposure + maxPayout > maxCapacity) {
        return res.status(400).json({
          message: "Insufficient pool liquidity for this position",
          availableCapacity: Math.max(0, maxCapacity - currentExposure),
          maxNotionalAllowed: maxCapacity > currentExposure ? Math.floor((maxCapacity - currentExposure) / payoutRate) : 0
        });
      }

      const position = await storage.createHedgePosition({
        eventId: event.id,
        hedgerWallet,
        notional: notionalNum.toString(),
        premiumPaid: premiumPaid.toString(),
        maxPayout: maxPayout.toString(),
        status: "active"
      });

      // Full premium goes to LPs — platform fee is separate
      const activeDeposits = deposits.filter(d => !d.withdrawn);
      if (activeDeposits.length > 0) {
        for (const dep of activeDeposits) {
          const share = parseFloat(dep.amount) / totalLiquidity;
          const earned = premiumPaid * share;
          await storage.updateHedgeLpDeposit(dep.id, {
            premiumsEarned: (parseFloat(dep.premiumsEarned || "0") + earned).toString()
          });
        }
      }

      const CREATOR_LOYALTY_RATE = 0.05;
      const creatorReward = hedgerPlatformFee * CREATOR_LOYALTY_RATE;
      const currentCreatorEarnings = parseFloat(event.creatorEarnings || "0");
      await storage.updateHedgeEvent(event.id, {
        creatorEarnings: (currentCreatorEarnings + creatorReward).toString()
      });

      console.log(`[Hedge Fee] Notional: $${notionalNum} | MaxPayout: $${maxPayout.toFixed(2)} (${(payoutRate * 100).toFixed(0)}%) | Premium: $${premiumPaid.toFixed(4)} (100% to LPs) | Hedger platform fee (0.5%): $${hedgerPlatformFee.toFixed(4)} | Creator reward (5%): $${creatorReward.toFixed(4)} | Event: ${event.name}`);

      res.status(201).json({
        ...position,
        premiumPaid,
        hedgerPlatformFee,
        creatorReward,
        totalCost,
        maxPayout,
        message: `Protection purchased. Total cost: $${totalCost.toFixed(2)} (Premium: $${premiumPaid.toFixed(2)} + Platform fee: $${hedgerPlatformFee.toFixed(4)}). Payout scales with rate movement.`
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to buy protection" });
    }
  });

  // Get positions by wallet
  app.get("/api/hedge/positions/:wallet", async (req, res) => {
    try {
      const positions = await storage.getHedgePositionsByWallet(req.params.wallet);
      res.json(positions);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch positions" });
    }
  });

  // Deposit liquidity (LP)
  app.post("/api/hedge/deposits", async (req, res) => {
    try {
      const { eventId, lpWallet, amount } = req.body;

      if (!eventId || !lpWallet || !amount) {
        return res.status(400).json({ message: "Missing required fields: eventId, lpWallet, amount" });
      }

      const event = await storage.getHedgeEvent(parseInt(eventId));
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (event.status !== "open") return res.status(400).json({ message: "Event is not open for deposits" });

      const isCreator = lpWallet.toLowerCase() === event.createdBy.toLowerCase();
      if (!isCreator && !event.allowExternalLp) {
        return res.status(403).json({ message: "This pool is private — only the creator can provide liquidity" });
      }

      const amountNum = parseFloat(amount);
      if (amountNum < 10) return res.status(400).json({ message: "Minimum deposit is $10" });

      const existingDeposits = await storage.getHedgeLpDepositsByEvent(event.id);
      const totalLiquidity = existingDeposits.filter(d => !d.withdrawn).reduce((sum, d) => sum + parseFloat(d.amount), 0);
      const totalShares = existingDeposits.filter(d => !d.withdrawn).reduce((sum, d) => sum + parseFloat(d.shares), 0);
      const shares = totalLiquidity === 0 ? amountNum : (amountNum / totalLiquidity) * totalShares;

      const deposit = await storage.createHedgeLpDeposit({
        eventId: event.id,
        lpWallet,
        amount: amountNum.toString(),
        shares: shares.toString()
      });

      res.status(201).json({
        ...deposit,
        message: `Deposited $${amountNum.toFixed(2)} into pool. Received ${shares.toFixed(4)} LP shares.`
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to deposit liquidity" });
    }
  });

  // Auto-seed liquidity from treasury pool wallet (admin-only: deployer or treasury wallet)
  app.post("/api/hedge/treasury-seed", async (req, res) => {
    try {
      const { eventId, amount, callerAddress } = req.body;
      if (!eventId || !amount) {
        return res.status(400).json({ message: "Missing required fields: eventId, amount" });
      }

      const treasuryPrivateKey = process.env.TREASURY_POOL_PRIVATE_KEY;
      if (!treasuryPrivateKey) {
        return res.status(500).json({ message: "Treasury wallet not configured" });
      }

      const ethers = await import("ethers");
      const treasuryWallet = new ethers.Wallet(treasuryPrivateKey);
      const treasuryAddress = treasuryWallet.address;

      const deployerAddress = "0xef5Bed7c221c85A2c88e3c0223ee45482d6F037d";
      const caller = (callerAddress || "").toLowerCase();
      if (caller !== deployerAddress.toLowerCase() && caller !== treasuryAddress.toLowerCase()) {
        return res.status(403).json({ message: "Unauthorized: Only platform admin can seed treasury liquidity" });
      }

      const event = await storage.getHedgeEvent(parseInt(eventId));
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (event.status !== "open") return res.status(400).json({ message: "Event is not open for deposits" });

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || !isFinite(amountNum) || amountNum < 10) return res.status(400).json({ message: "Minimum deposit is $10" });

      const existingDeposits = await storage.getHedgeLpDepositsByEvent(event.id);
      const totalLiquidity = existingDeposits.filter(d => !d.withdrawn).reduce((sum, d) => sum + parseFloat(d.amount), 0);
      const totalShares = existingDeposits.filter(d => !d.withdrawn).reduce((sum, d) => sum + parseFloat(d.shares), 0);
      const shares = totalLiquidity === 0 ? amountNum : (amountNum / totalLiquidity) * totalShares;

      const deposit = await storage.createHedgeLpDeposit({
        eventId: event.id,
        lpWallet: treasuryAddress,
        amount: amountNum.toString(),
        shares: shares.toString()
      });

      res.status(201).json({
        ...deposit,
        treasuryAddress,
        message: `Treasury wallet seeded $${amountNum.toFixed(2)} into pool. Received ${shares.toFixed(4)} LP shares.`
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to seed from treasury" });
    }
  });

  app.post("/api/hedge/treasury-withdraw", async (req, res) => {
    try {
      const { amount, callerAddress } = req.body;
      if (!amount || !callerAddress) {
        return res.status(400).json({ message: "Missing required fields: amount, callerAddress" });
      }

      const treasuryPrivateKey = process.env.TREASURY_POOL_PRIVATE_KEY;
      if (!treasuryPrivateKey) {
        return res.status(500).json({ message: "Treasury wallet not configured" });
      }

      const ethers = await import("ethers");
      const deployerAddress = "0xef5Bed7c221c85A2c88e3c0223ee45482d6F037d";
      const caller = (callerAddress || "").toLowerCase();
      if (caller !== deployerAddress.toLowerCase()) {
        return res.status(403).json({ message: "Unauthorized: Only platform admin can withdraw from treasury" });
      }

      const provider = new ethers.JsonRpcProvider("https://rpc.sepolia-api.lisk.com");
      const treasuryWallet = new ethers.Wallet(treasuryPrivateKey, provider);
      const treasuryAddress = treasuryWallet.address;

      const usdcAddress = "0xf52Ad63619Bf9cFeF510341ac6b4038554399562";
      const usdcContract = new ethers.Contract(usdcAddress, [
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function transfer(address to, uint256 amount) returns (bool)"
      ], treasuryWallet);

      const decimals = await usdcContract.decimals();
      const currentBalance = await usdcContract.balanceOf(treasuryAddress);
      const currentBalanceFormatted = parseFloat(ethers.formatUnits(currentBalance, decimals));

      let transferAmount: bigint;
      if (amount === "all") {
        transferAmount = currentBalance;
      } else {
        const amountNum = parseFloat(amount);
        if (isNaN(amountNum) || amountNum <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }
        if (amountNum > currentBalanceFormatted) {
          return res.status(400).json({ message: `Insufficient treasury balance. Available: ${currentBalanceFormatted.toFixed(2)} USDC` });
        }
        transferAmount = ethers.parseUnits(amountNum.toFixed(6), decimals);
      }

      if (transferAmount === 0n) {
        return res.status(400).json({ message: "Treasury balance is zero" });
      }

      const tx = await usdcContract.transfer(deployerAddress, transferAmount);
      const receipt = await tx.wait();

      const amountTransferred = ethers.formatUnits(transferAmount, decimals);

      res.json({
        success: true,
        txHash: receipt.hash,
        amount: amountTransferred,
        from: treasuryAddress,
        to: deployerAddress,
        message: `Successfully unstaked ${amountTransferred} USDC from treasury to deployer wallet`
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to withdraw from treasury" });
    }
  });

  app.get("/api/hedge/treasury-balance", async (_req, res) => {
    try {
      const treasuryPrivateKey = process.env.TREASURY_POOL_PRIVATE_KEY;
      if (!treasuryPrivateKey) {
        return res.status(500).json({ message: "Treasury wallet not configured" });
      }
      const ethers = await import("ethers");
      const treasuryWallet = new ethers.Wallet(treasuryPrivateKey);
      const provider = new ethers.JsonRpcProvider("https://rpc.sepolia-api.lisk.com");
      const usdcAddress = "0xf52Ad63619Bf9cFeF510341ac6b4038554399562";
      const usdcContract = new ethers.Contract(usdcAddress, [
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)"
      ], provider);
      const balance = await usdcContract.balanceOf(treasuryWallet.address);
      const decimals = await usdcContract.decimals();
      res.json({
        address: treasuryWallet.address,
        balance: ethers.formatUnits(balance, decimals),
        raw: balance.toString()
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch treasury balance" });
    }
  });

  // Get treasury wallet address for hedge pools
  app.get("/api/hedge/treasury-address", async (_req, res) => {
    try {
      const treasuryPrivateKey = process.env.TREASURY_POOL_PRIVATE_KEY;
      if (!treasuryPrivateKey) {
        return res.status(500).json({ message: "Treasury wallet not configured" });
      }
      const ethers = await import("ethers");
      const treasuryWallet = new ethers.Wallet(treasuryPrivateKey);
      res.json({ address: treasuryWallet.address });
    } catch (error) {
      res.status(500).json({ message: "Failed to get treasury address" });
    }
  });

  // Get LP deposits by wallet
  app.get("/api/hedge/deposits/:wallet", async (req, res) => {
    try {
      const deposits = await storage.getHedgeLpDepositsByWallet(req.params.wallet);
      res.json(deposits);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch deposits" });
    }
  });

  // Withdraw LP liquidity
  app.post("/api/hedge/deposits/:id/withdraw", async (req, res) => {
    try {
      const deposit = await storage.getHedgeLpDeposit(parseInt(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.withdrawn) return res.status(400).json({ message: "Already withdrawn" });

      const event = await storage.getHedgeEvent(deposit.eventId);
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (event.status === "open") {
        return res.status(400).json({ message: "Cannot withdraw liquidity while the contract is still active. Withdrawals are available after the event expires or settles." });
      }

      const updated = await storage.updateHedgeLpDeposit(deposit.id, {
        withdrawn: true,
        withdrawnAt: new Date()
      });

      res.json({ ...updated, message: "Liquidity withdrawn successfully" });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to withdraw" });
    }
  });

  // Claim earned premiums (LP withdraws earned premiums from treasury to their wallet)
  app.post("/api/hedge/deposits/:id/claim-premiums", async (req, res) => {
    try {
      const { callerAddress } = req.body;
      if (!callerAddress) {
        return res.status(400).json({ message: "Missing callerAddress" });
      }

      const deposit = await storage.getHedgeLpDeposit(parseInt(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });

      if (deposit.lpWallet.toLowerCase() !== callerAddress.toLowerCase()) {
        return res.status(403).json({ message: "Unauthorized: You can only claim premiums for your own deposits" });
      }

      const earned = parseFloat(deposit.premiumsEarned || "0");
      const alreadyWithdrawn = parseFloat(deposit.premiumsWithdrawn || "0");
      const claimable = earned - alreadyWithdrawn;

      if (claimable <= 0) {
        return res.status(400).json({ message: "No premiums available to claim" });
      }

      const LP_PROFIT_FEE_RATE = 0.01;
      const lpProfitFee = claimable * LP_PROFIT_FEE_RATE;
      const netPayout = claimable - lpProfitFee;

      const CREATOR_LOYALTY_RATE = 0.05;
      const creatorReward = lpProfitFee * CREATOR_LOYALTY_RATE;
      const event = await storage.getHedgeEvent(deposit.eventId);
      if (event) {
        const currentCreatorEarnings = parseFloat(event.creatorEarnings || "0");
        await storage.updateHedgeEvent(event.id, {
          creatorEarnings: (currentCreatorEarnings + creatorReward).toString()
        });
      }

      const treasuryPrivateKey = process.env.TREASURY_POOL_PRIVATE_KEY;
      if (!treasuryPrivateKey) {
        return res.status(500).json({ message: "Treasury wallet not configured" });
      }

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

      if (netPayout > treasuryBalanceFormatted) {
        return res.status(400).json({ message: `Insufficient treasury balance. Available: ${treasuryBalanceFormatted.toFixed(2)} USDC, Claimable: ${netPayout.toFixed(2)} USDC` });
      }

      const transferAmount = ethers.parseUnits(netPayout.toFixed(6), decimals);
      const tx = await usdcContract.transfer(deposit.lpWallet, transferAmount);
      const receipt = await tx.wait();

      const updated = await storage.updateHedgeLpDeposit(deposit.id, {
        premiumsWithdrawn: (alreadyWithdrawn + claimable).toString()
      });

      console.log(`[LP Fee] Claimed: $${claimable.toFixed(4)} | Platform fee (1%): $${lpProfitFee.toFixed(4)} | Net to LP: $${netPayout.toFixed(4)} | LP: ${deposit.lpWallet}`);

      res.json({
        success: true,
        txHash: receipt.hash,
        grossAmount: claimable.toFixed(2),
        platformFee: lpProfitFee.toFixed(4),
        netAmount: netPayout.toFixed(2),
        from: treasuryWallet.address,
        to: deposit.lpWallet,
        message: `Claimed $${netPayout.toFixed(2)} USDC (1% platform fee: $${lpProfitFee.toFixed(4)} retained)`
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to claim premiums" });
    }
  });

  // Settle event (admin posts oracle price)
  app.post("/api/hedge/events/:id/settle", async (req, res) => {
    try {
      const { settlementPrice, settlerAddress } = req.body;
      if (!settlementPrice || !settlerAddress) {
        return res.status(400).json({ message: "Missing settlementPrice or settlerAddress" });
      }

      const event = await storage.getHedgeEvent(parseInt(req.params.id));
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (event.status !== "open") return res.status(400).json({ message: "Event already settled or expired" });

      const price = parseFloat(settlementPrice);
      const strike = parseFloat(event.strike);
      const triggered = price >= strike;

      // Update event
      await storage.updateHedgeEvent(event.id, {
        status: "settled",
        settlementPrice: price.toString(),
        triggered,
        settledAt: new Date()
      });

      // Settle all active positions with proportional payout based on rate gap
      const positions = await storage.getHedgePositionsByEvent(event.id);
      const strikePrice = parseFloat(event.strike);
      for (const pos of positions) {
        if (pos.status !== "active") continue;

        if (triggered && strikePrice > 0) {
          const rateGap = (price - strikePrice) / strikePrice;
          const notionalVal = parseFloat(pos.notional);
          const payout = notionalVal * rateGap;
          await storage.updateHedgePosition(pos.id, {
            status: "settled_win",
            payoutAmount: Math.max(0, payout).toFixed(2)
          });
        } else {
          await storage.updateHedgePosition(pos.id, {
            status: "settled_loss",
            payoutAmount: "0"
          });
        }
      }

      res.json({
        message: triggered
          ? `Event settled. FX rate ${price} >= strike ${strike}. Protection triggered! Hedgers can claim payouts.`
          : `Event settled. FX rate ${price} < strike ${strike}. Protection not triggered. Positions expire worthless.`,
        triggered,
        settlementPrice: price,
        strike
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to settle event" });
    }
  });

  // Claim payout (hedger)
  app.post("/api/hedge/positions/:id/claim", async (req, res) => {
    try {
      const position = await storage.getHedgePosition(parseInt(req.params.id));
      if (!position) return res.status(404).json({ message: "Position not found" });
      if (position.claimed) return res.status(400).json({ message: "Already claimed" });
      if (position.status !== "settled_win") return res.status(400).json({ message: "Position not eligible for payout" });

      const grossPayout = parseFloat(position.payoutAmount || "0");
      const HEDGER_PAYOUT_FEE_RATE = 0.01;
      const payoutFee = grossPayout * HEDGER_PAYOUT_FEE_RATE;
      const netPayout = grossPayout - payoutFee;

      const CREATOR_LOYALTY_RATE = 0.05;
      const creatorReward = payoutFee * CREATOR_LOYALTY_RATE;
      const event = await storage.getHedgeEvent(position.eventId);
      if (event) {
        const currentCreatorEarnings = parseFloat(event.creatorEarnings || "0");
        await storage.updateHedgeEvent(event.id, {
          creatorEarnings: (currentCreatorEarnings + creatorReward).toString()
        });
      }

      await storage.updateHedgePosition(position.id, {
        claimed: true,
        status: "claimed"
      });

      console.log(`[Hedger Payout Fee] Gross: $${grossPayout.toFixed(4)} | Platform fee (1%): $${payoutFee.toFixed(4)} | Creator reward (5%): $${creatorReward.toFixed(4)} | Net to hedger: $${netPayout.toFixed(4)} | Position: #${position.id}`);

      res.json({
        message: `Payout claimed! Gross: $${grossPayout.toFixed(2)} — Platform fee (1%): $${payoutFee.toFixed(4)} — You receive: $${netPayout.toFixed(2)}`,
        grossPayout: grossPayout.toFixed(2),
        platformFee: payoutFee.toFixed(4),
        netPayout: netPayout.toFixed(2)
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to claim payout" });
    }
  });

  const httpServer = createServer(app);

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const connectedClients = new Map<string, WebSocket>();

  wss.on('connection', (ws: WebSocket) => {
    let clientWalletAddress: string | null = null;

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'authenticate') {
          clientWalletAddress = message.walletAddress?.toLowerCase();
          if (clientWalletAddress) {
            connectedClients.set(clientWalletAddress, ws);
          }
          ws.send(JSON.stringify({
            type: 'authenticated',
            walletAddress: clientWalletAddress
          }));
        }
      } catch (error) {
      }
    });

    ws.on('close', () => {
      if (clientWalletAddress) {
        connectedClients.delete(clientWalletAddress);
      }
    });

    ws.on('error', () => {
      if (clientWalletAddress) {
        connectedClients.delete(clientWalletAddress);
      }
    });
  });

  const { userPoints, pointTransactions } = await import("../shared/referral-schema");

  app.get("/api/tasks", async (req, res) => {
    try {
      const tasks = await db.select().from(dailyTasks).where(eq(dailyTasks.isActive, true)).orderBy(dailyTasks.sortOrder);
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/progress/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const addr = walletAddress.toLowerCase();

      const completions = await db.select().from(userTaskCompletions).where(eq(userTaskCompletions.walletAddress, addr));

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayCompletions = completions.filter(c => new Date(c.completedAt) >= today);
      const allCompletedTaskIds = completions.map(c => c.taskId);
      const todayCompletedTaskIds = todayCompletions.map(c => c.taskId);

      const totalPointsEarned = completions.reduce((sum, c) => sum + c.pointsEarned, 0);

      let points = await db.select().from(userPoints).where(eq(userPoints.walletAddress, addr));
      const userTotalPoints = points.length > 0 ? points[0].totalPoints : 0;

      res.json({
        completedTaskIds: allCompletedTaskIds,
        todayCompletedTaskIds,
        totalPointsEarned,
        userTotalPoints,
        completionsCount: completions.length,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch task progress" });
    }
  });

  app.post("/api/tasks/complete", async (req, res) => {
    try {
      const { walletAddress, taskId } = req.body;
      if (!walletAddress || !taskId) {
        return res.status(400).json({ error: "walletAddress and taskId required" });
      }
      const addr = walletAddress.toLowerCase();

      const [task] = await db.select().from(dailyTasks).where(and(eq(dailyTasks.id, taskId), eq(dailyTasks.isActive, true)));
      if (!task) return res.status(404).json({ error: "Task not found or inactive" });

      const existing = await db.select().from(userTaskCompletions)
        .where(and(eq(userTaskCompletions.walletAddress, addr), eq(userTaskCompletions.taskId, taskId)));

      if (task.isDaily) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const alreadyToday = existing.some(c => new Date(c.completedAt) >= today);
        if (alreadyToday) return res.status(400).json({ error: "Task already completed today" });
      } else {
        if (existing.length > 0) return res.status(400).json({ error: "Task already completed" });
      }

      await db.insert(userTaskCompletions).values({
        walletAddress: addr,
        taskId: task.id,
        pointsEarned: task.points,
      });

      const existingPoints = await db.select().from(userPoints).where(eq(userPoints.walletAddress, addr));
      if (existingPoints.length === 0) {
        await db.insert(userPoints).values({
          walletAddress: addr,
          totalPoints: task.points,
          referralPoints: 0,
        });
      } else {
        await db.update(userPoints)
          .set({ totalPoints: sql`${userPoints.totalPoints} + ${task.points}`, lastUpdated: new Date() })
          .where(eq(userPoints.walletAddress, addr));
      }

      await db.insert(pointTransactions).values({
        walletAddress: addr,
        type: "task_reward",
        points: task.points,
        description: `Completed: ${task.title}`,
        referenceId: `task_${task.id}`,
      });

      const [updatedPoints] = await db.select().from(userPoints).where(eq(userPoints.walletAddress, addr));

      res.json({
        success: true,
        pointsEarned: task.points,
        totalPoints: updatedPoints?.totalPoints || task.points,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to complete task" });
    }
  });

  app.get("/api/tasks/leaderboard", async (req, res) => {
    try {
      const leaders = await db.select().from(userPoints).orderBy(desc(userPoints.totalPoints)).limit(20);
      res.json(leaders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  });

  // Referral codes — get or auto-create for a wallet
  app.get("/api/referrals/codes/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      let codes = await storage.getReferralCodesByWallet(walletAddress);
      if (!codes || codes.length === 0) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const rand = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const newCode = await storage.createReferralCode({
          code: `BFX-${rand}`,
          referrerWalletAddress: walletAddress,
          isActive: true,
          maxUses: 100,
          description: 'Personal referral code',
        });
        codes = [newCode];
      }
      res.json(codes[0]);
    } catch (error) {
      res.status(500).json({ error: "Failed to get referral code" });
    }
  });

  // Referrals made via a wallet's codes
  app.get("/api/referrals/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const refs = await storage.getReferralsByWallet(walletAddress);
      res.json(refs);
    } catch (error) {
      res.status(500).json({ error: "Failed to get referrals" });
    }
  });

  return httpServer;
}
