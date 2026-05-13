import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { eq, desc, and, sql } from "drizzle-orm";
import { dailyTasks, userTaskCompletions, termsAcceptances, authSessions } from "../../shared/schema";
import { userPoints, pointTransactions } from "../../shared/referral-schema";
import { requireRiftUser } from "../middleware/rift-auth";
import { v2 as cloudinary } from "cloudinary";

// Configure Cloudinary from env. The `CLOUDINARY_URL` env var auto-configures
// cloud_name + api_key + api_secret on import. We just validate it loaded.
const cloudinaryConfigured = !!cloudinary.config().cloud_name;

export function registerCommunityRoutes(app: Express) {
  // Public read of the point→USD conversion. Falls back to 0.05 ($0.05/pt)
  // when unset. The Earn page uses this to show "≈ $X.XX worth" under
  // the total points figure.
  app.get("/api/platform/settings/point-value", async (_req, res) => {
    try {
      const v = await storage.getSetting("point_value_usd");
      res.json({ usdPerPoint: v ? parseFloat(v) : 0.05 });
    } catch {
      res.json({ usdPerPoint: 0.05 });
    }
  });

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

  /**
   * Returns a signed Cloudinary upload payload so the browser can PUT the
   * file directly to Cloudinary without it ever touching our server. The
   * signature binds the upload to a per-user folder + a fresh timestamp so
   * a captured signature can't be reused for someone else's evidence.
   *
   * Frontend uses these fields to POST to
   *   https://api.cloudinary.com/v1_1/{cloud_name}/image/upload
   *
   * Auth: Rift Bearer required — we never want anonymous uploads.
   */
  app.post("/api/tasks/upload-signature", requireRiftUser, async (req, res) => {
    try {
      if (!cloudinaryConfigured) {
        return res.status(503).json({
          error: "Image uploads aren't configured yet. Ask the admin to set CLOUDINARY_URL.",
        });
      }
      const cfg = cloudinary.config() as any;
      const wallet = req.riftUser!.address;
      const timestamp = Math.floor(Date.now() / 1000);
      // Tag with the user's wallet for traceability; one folder per user
      const folder = `evidence/${wallet}`;
      const params: Record<string, string | number> = {
        timestamp,
        folder,
        // Cap image size at 1600×1600 (Cloudinary downscales on upload) — saves bandwidth
        // and makes admin thumbnails snappy.
        eager: "c_limit,w_1600,h_1600,q_auto,f_auto",
      };
      const signature = cloudinary.utils.api_sign_request(params, cfg.api_secret as string);
      res.json({
        cloudName: cfg.cloud_name,
        apiKey: cfg.api_key,
        timestamp,
        signature,
        folder,
        eager: params.eager,
      });
    } catch (e: any) {
      console.error("[upload-signature]", e);
      res.status(500).json({ error: "Failed to sign upload" });
    }
  });

  // Auth model: Authorization: Bearer <rift access token>. requireRiftUser
  // verifies against Rift /user/me and attaches req.riftUser with the canonical
  // wallet address — we never trust an address from the body.
  app.post("/api/tasks/complete", requireRiftUser, async (req, res) => {
    try {
      const { taskId, evidenceUrl, evidenceImage, evidenceText } = req.body ?? {};
      if (!taskId) return res.status(400).json({ error: "taskId required" });
      const addr = req.riftUser!.address; // already lowercased

      const [task] = await db.select().from(dailyTasks).where(and(eq(dailyTasks.id, taskId), eq(dailyTasks.isActive, true)));
      if (!task) return res.status(404).json({ error: "Task not found or inactive" });

      // ── Server-side verification gate ─────────────────────────────────
      // verifier='onchain:X' — require a matching row in hedge_activity.
      // verifier='manual'   — require an evidence submission; points
      //                       awarded only when an admin approves.
      // otherwise           — trust the client (legacy default).
      let reviewStatus: 'auto' | 'pending' = 'auto';

      if (task.verifier?.startsWith('onchain:')) {
        const requiredAction = task.verifier.slice('onchain:'.length);
        const did = await storage.hasHedgeAction(addr, requiredAction);
        if (!did) {
          return res.status(400).json({
            error: `On-chain action required — complete this task in-app before claiming.`,
            hint: requiredAction,
          });
        }
      } else if (task.verifier === 'manual') {
        const url   = typeof evidenceUrl   === 'string' ? evidenceUrl.trim()   : '';
        const image = typeof evidenceImage === 'string' ? evidenceImage.trim() : '';
        const text  = typeof evidenceText  === 'string' ? evidenceText.trim()  : '';
        if (!url && !image && !text) {
          return res.status(400).json({
            error: 'Evidence required — attach a screenshot, paste a link, or describe what you did.',
          });
        }
        // Anti-spoofing: if the image URL was provided, it MUST be a Cloudinary URL
        // from our configured cloud — clients can't drop arbitrary URLs here.
        if (image) {
          const cfg = cloudinary.config() as any;
          const expectedPrefix = cfg.cloud_name ? `https://res.cloudinary.com/${cfg.cloud_name}/` : null;
          if (!expectedPrefix || !image.startsWith(expectedPrefix)) {
            return res.status(400).json({ error: 'Invalid image URL — uploads must go through the in-app picker.' });
          }
        }
        reviewStatus = 'pending';
      }

      // Idempotency: daily tasks once per day, one-time tasks once ever.
      // A pending submission counts as "already claimed" so users can't
      // spam multiple evidence rows for the same task.
      const existing = await db.select().from(userTaskCompletions)
        .where(and(eq(userTaskCompletions.walletAddress, addr), eq(userTaskCompletions.taskId, taskId)));

      if (task.isDaily) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const alreadyToday = existing.some(c => new Date(c.completedAt) >= today);
        if (alreadyToday) return res.status(400).json({ error: "Task already completed today" });
      } else {
        // Reject if there's any non-rejected row for this task
        const blocking = existing.find(c => c.reviewStatus !== 'rejected');
        if (blocking) {
          return res.status(400).json({
            error: blocking.reviewStatus === 'pending'
              ? 'Already submitted — waiting for admin review.'
              : 'Task already completed.',
          });
        }
      }

      await db.insert(userTaskCompletions).values({
        walletAddress: addr,
        taskId: task.id,
        pointsEarned: task.points,
        reviewStatus,
        evidenceUrl: typeof evidenceUrl === 'string' ? evidenceUrl.trim() || null : null,
        evidenceImage: typeof evidenceImage === 'string' ? evidenceImage.trim() || null : null,
        evidenceText: typeof evidenceText === 'string' ? evidenceText.trim() || null : null,
      });

      // Only credit points immediately for auto-approved completions.
      // Manual submissions credit when the admin approves them.
      if (reviewStatus === 'auto') {
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
        return res.json({ success: true, pointsEarned: task.points, totalPoints: updatedPoints?.totalPoints || task.points });
      }

      // Manual: queued for review
      res.json({ success: true, status: 'pending_review', pointsEarned: 0, message: 'Submitted for admin review. You’ll be notified once approved.' });
    } catch (error) {
      console.error('[tasks/complete]', error);
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
