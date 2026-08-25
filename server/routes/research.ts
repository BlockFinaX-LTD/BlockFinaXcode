/**
 * research.ts, the morning reading.
 *
 * The one route that does more than list things is /save, which pushes an item
 * into market_memory. That connection is the point of the whole section: a
 * piece Anthony marks as mattering becomes something the outreach drafter can
 * cite, with its date attached. Research nobody acts on changes nothing.
 */

import type { Express } from "express";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { researchItems, marketMemory } from "@shared/schema";
import { requireAdmin } from "../middleware/admin-auth";
import { buildDigest } from "../research/digest";
import { digestStatus } from "../research/scheduler";

const MODEL = (process.env.AGENT_MODEL || "claude-sonnet-5").trim();

export function registerResearchRoutes(app: Express): void {
  // ── GET /api/research ───────────────────────────────────────────────────
  app.get("/api/research", requireAdmin, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "unread";
      const rows = await db.select().from(researchItems)
        .where(isNotNull(researchItems.importance))
        .orderBy(desc(researchItems.importance), desc(researchItems.publishedAt))
        .limit(200);

      const filtered = status === "all" ? rows : rows.filter(r => r.status === status);
      const count = (s: string) => rows.filter(r => r.status === s).length;

      // Collected but never briefed. Worth reporting rather than hiding: it is
      // the difference between a quiet morning and a broken fetcher.
      const [{ n: unscored }] = await db.select({ n: sql<number>`count(*)::int` })
        .from(researchItems).where(sql`${researchItems.importance} is null`);

      return res.json({
        items: filtered.slice(0, 60),
        counts: {
          all: rows.length,
          unread: count("unread"),
          saved: count("saved"),
          dismissed: count("dismissed"),
          collectedNotBriefed: Number(unscored) || 0,
        },
        schedule: await digestStatus(),
      });
    } catch {
      return res.json({ items: [], counts: {}, schedule: null });
    }
  });

  // ── POST /api/research/refresh ──────────────────────────────────────────
  app.post("/api/research/refresh", requireAdmin, async (_req, res) => {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Briefing is not configured." });
      return res.json(await buildDigest(apiKey, MODEL));
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "refresh failed" });
    }
  });

  // ── PATCH /api/research/:id ─────────────────────────────────────────────
  app.patch("/api/research/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
      const status = req.body?.status;
      if (!["unread", "read", "saved", "dismissed"].includes(status)) {
        return res.status(400).json({ error: "unknown status" });
      }
      const [row] = await db.update(researchItems).set({ status })
        .where(eq(researchItems.id, id)).returning();
      if (!row) return res.status(404).json({ error: "not found" });
      return res.json(row);
    } catch {
      return res.status(500).json({ error: "Could not update that." });
    }
  });

  // ── POST /api/research/:id/save ─────────────────────────────────────────
  //
  // Into market_memory, where the outreach drafter can reach it.
  //
  // asOf is the publication date rather than today, which is the whole reason
  // memory is dated: a policy decision quoted six months from now must be
  // quoted as six months old. Storing today's date would make every saved item
  // look current forever.
  app.post("/api/research/:id/save", requireAdmin, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });

      const [item] = await db.select().from(researchItems)
        .where(eq(researchItems.id, id)).limit(1);
      if (!item) return res.status(404).json({ error: "not found" });
      if (item.savedToMemoryAt) {
        return res.status(409).json({ error: "Already saved to memory." });
      }

      const body = [item.relevance, item.summary].filter(Boolean).join("\n\n").slice(0, 4000);
      if (body.length < 20) return res.status(400).json({ error: "Too little to save." });

      await db.insert(marketMemory).values({
        kind: item.kind === "research" ? "research" : item.kind === "policy" ? "policy" : "news",
        title: item.title.slice(0, 500),
        body,
        sourceName: item.source,
        sourceUrl: item.url,
        asOf: item.publishedAt ?? item.fetchedAt ?? new Date(),
        createdBy: req.adminEmail || null,
      });

      const [row] = await db.update(researchItems)
        .set({ status: "saved", savedToMemoryAt: new Date() })
        .where(eq(researchItems.id, id)).returning();
      return res.json(row);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "could not save" });
    }
  });
}
