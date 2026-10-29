/**
 * Admin endpoints for X signals (x-admin-token):
 *
 *   GET  /api/admin/x-signals?status=new&topic=ngn   posts to review, best first
 *   POST /api/admin/x-signals/:id/status             useful, contacted, dismissed or new, with a note
 *   POST /api/admin/x-signals/run                    search now instead of waiting for the schedule
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "../middleware/admin-auth";
import { TOPICS } from "./search";
import { lastRun, runXSignals, xSignalsConfigured, xSignalsDb } from "./service";

const STATUSES = ["new", "useful", "contacted", "dismissed"];

export function registerXSignalRoutes(app: Express) {
  const wrap = (h: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) =>
    h(req, res).catch((e) => res.status(400).json({ message: (e as Error).message }));

  app.get("/api/admin/x-signals", requireAdmin, wrap(async (req, res) => {
    const status = STATUSES.includes(String(req.query.status)) ? String(req.query.status) : "new";
    const topic = TOPICS.some((t) => t.key === req.query.topic) ? String(req.query.topic) : null;
    const db = await xSignalsDb();
    const { rows } = await db.query(
      `SELECT * FROM x_signals WHERE status = $1 AND ($2::text IS NULL OR topic = $2)
       ORDER BY score DESC, posted_at DESC LIMIT 200`, [status, topic]);
    const counts = await db.query(`SELECT status, count(*)::int AS n FROM x_signals GROUP BY status`);
    res.json({
      configured: xSignalsConfigured(),
      lastRun: await lastRun(),
      topics: TOPICS.map((t) => ({ key: t.key, label: t.label })),
      counts: Object.fromEntries(counts.rows.map((r: any) => [r.status, r.n])),
      signals: rows.map((r: any) => ({
        id: r.tweet_id, url: r.url, text: r.text, topic: r.topic, score: r.score, status: r.status, note: r.note,
        kind: r.ai_kind, reason: r.ai_reason,
        postedAt: r.posted_at, likes: r.likes, replies: r.replies, reposts: r.reposts, views: r.views,
        author: { handle: r.author_handle, name: r.author_name, followers: r.author_followers, location: r.author_location, bio: r.author_bio },
      })),
    });
  }));

  app.post("/api/admin/x-signals/:id/status", requireAdmin, wrap(async (req, res) => {
    const status = String(req.body?.status ?? "");
    if (!STATUSES.includes(status)) throw new Error("Choose new, useful, contacted or dismissed");
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) || null : null;
    const db = await xSignalsDb();
    const { rowCount } = await db.query(
      `UPDATE x_signals SET status = $2, note = COALESCE($3, note), reviewed_at = now() WHERE tweet_id = $1`, [req.params.id, status, note]);
    if (!rowCount) throw new Error("Post not found");
    res.json({ ok: true });
  }));

  app.post("/api/admin/x-signals/run", requireAdmin, wrap(async (_req, res) => {
    res.json(await runXSignals("manual"));
  }));
}
