import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { eq, desc, and, sql } from "drizzle-orm";
import { dailyTasks, userTaskCompletions, termsAcceptances, authSessions } from "../../shared/schema";
import { userPoints, pointTransactions } from "../../shared/referral-schema";

export function registerCommunityRoutes(app: Express) {
  app.get("/api/tasks", async (req, res) => {
    try {
      const tasks = await db.select().from(dailyTasks).where(eq(dailyTasks.isActive, true)).orderBy(dailyTasks.sortOrder);
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks" });
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

      const points = await db.select().from(userPoints).where(eq(userPoints.walletAddress, addr));
      const userTotalPoints = points.length > 0 ? points[0].totalPoints : 0;

      res.json({ completedTaskIds: allCompletedTaskIds, todayCompletedTaskIds, totalPointsEarned, userTotalPoints, completionsCount: completions.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch task progress" });
    }
  });

  app.post("/api/tasks/complete", async (req, res) => {
    const taskToken = (req.headers['x-session-token'] as string) || null;
    if (!taskToken) return res.status(401).json({ error: 'Authentication required' });
    const [taskSess] = await db.select().from(authSessions).where(eq(authSessions.sessionToken, taskToken));
    if (!taskSess || taskSess.expiresAt < new Date()) return res.status(401).json({ error: 'Session expired' });

    try {
      const { walletAddress, taskId } = req.body;
      if (!walletAddress || !taskId) return res.status(400).json({ error: "walletAddress and taskId required" });
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

      await db.insert(userTaskCompletions).values({ walletAddress: addr, taskId: task.id, pointsEarned: task.points });

      const existingPoints = await db.select().from(userPoints).where(eq(userPoints.walletAddress, addr));
      if (existingPoints.length === 0) {
        await db.insert(userPoints).values({ walletAddress: addr, totalPoints: task.points, referralPoints: 0 });
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
      res.json({ success: true, pointsEarned: task.points, totalPoints: updatedPoints?.totalPoints || task.points });
    } catch (error) {
      res.status(500).json({ error: "Failed to complete task" });
    }
  });

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

  app.get("/api/referrals/:walletAddress", async (req, res) => {
    try {
      const refs = await storage.getReferralsByWallet(req.params.walletAddress);
      res.json(refs);
    } catch (error) {
      res.status(500).json({ error: "Failed to get referrals" });
    }
  });

  app.get("/api/terms/accepted/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const row = await db.select().from(termsAcceptances)
        .where(and(eq(termsAcceptances.walletAddress, address.toLowerCase()), eq(termsAcceptances.version, "1.0")))
        .limit(1);
      res.json({ accepted: row.length > 0, acceptedAt: row[0]?.acceptedAt ?? null });
    } catch {
      res.status(500).json({ error: "Failed to check acceptance" });
    }
  });

  app.post("/api/terms/accept", async (req, res) => {
    const termsToken = (req.headers['x-session-token'] as string) || null;
    if (!termsToken) return res.status(401).json({ error: 'Authentication required' });
    const [termsSess] = await db.select().from(authSessions).where(eq(authSessions.sessionToken, termsToken));
    if (!termsSess || termsSess.expiresAt < new Date()) return res.status(401).json({ error: 'Session expired' });
    try {
      const { walletAddress, version } = req.body;
      if (!walletAddress || !version) return res.status(400).json({ error: "Missing fields" });
      await db.insert(termsAcceptances).values({ walletAddress: walletAddress.toLowerCase(), version }).onConflictDoNothing();
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to record acceptance" });
    }
  });

  app.get("/api/articles", async (_req, res) => {
    try {
      const all = await storage.getAllArticles(true);
      res.json(all);
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch articles" });
    }
  });

  app.get("/api/articles/:slug", async (req, res) => {
    try {
      const article = await storage.getArticleBySlug(req.params.slug);
      if (!article || !article.published) return res.status(404).json({ message: "Article not found" });
      res.json(article);
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch article" });
    }
  });
}
