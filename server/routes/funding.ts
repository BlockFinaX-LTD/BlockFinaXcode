/**
 * funding.ts — the fundraising tracker's routes.
 *
 * Admin only, all of it. Which funders a company is talking to and how far each
 * has got is not public, and the discovery sweep costs money to run.
 */
import type { Express } from "express";
import {
  listOpportunities, deadlinesWithin, missedDeadlines, pipelineSummary,
  notesFor, setStage, addOpportunity, addNote, STAGES, type Stage,
} from "../funding/pipeline";
import { sweep, DEFAULT_QUERIES } from "../funding/discover";

/**
 * Who may touch any of this.
 *
 * ADMIN_EMAILS is the existing list; the header is the same one the admin
 * console already sends. Failing closed matters more here than elsewhere,
 * because one of these routes spends money on model calls.
 */
function isAdmin(req: any): boolean {
  const raw = (process.env.ADMIN_EMAILS || "").toLowerCase();
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const who = String(req.headers["x-admin-email"] || "").toLowerCase().trim();
  return !!who && allowed.includes(who);
}

export function registerFundingRoutes(app: Express): void {
  const guard = (req: any, res: any, next: any) =>
    isAdmin(req) ? next() : res.status(403).json({ error: "Admins only." });

  app.get("/api/funding/opportunities", guard, async (req, res) => {
    try {
      const stage = typeof req.query.stage === "string" ? req.query.stage : undefined;
      const includeClosed = req.query.includeClosed === "true";
      return res.json({ opportunities: await listOpportunities({ stage, includeClosed }) });
    } catch (e: any) { return res.status(500).json({ error: e?.message ?? "could not load" }); }
  });

  app.get("/api/funding/summary", guard, async (_req, res) => {
    try {
      const [summary, upcoming, missed] = await Promise.all([
        pipelineSummary(), deadlinesWithin(30), missedDeadlines(),
      ]);
      return res.json({ ...summary, upcoming, missed, stages: STAGES });
    } catch (e: any) { return res.status(500).json({ error: e?.message ?? "could not load" }); }
  });

  app.get("/api/funding/opportunities/:id/notes", guard, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
      return res.json({ notes: await notesFor(id) });
    } catch (e: any) { return res.status(500).json({ error: e?.message ?? "could not load" }); }
  });

  app.post("/api/funding/opportunities", guard, async (req, res) => {
    try {
      const r = await addOpportunity({ ...req.body, author: req.headers["x-admin-email"] as string });
      if (!r.ok) return res.status(400).json({ error: r.reason });
      return res.json(r);
    } catch (e: any) { return res.status(400).json({ error: e?.message ?? "could not add" }); }
  });

  app.post("/api/funding/opportunities/:id/stage", guard, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { stage, note } = req.body ?? {};
      const r = await setStage({
        id, stage: stage as Stage, note,
        author: req.headers["x-admin-email"] as string,
      });
      if (!r.ok) return res.status(400).json({ error: r.reason });
      return res.json({ ok: true });
    } catch (e: any) { return res.status(400).json({ error: e?.message ?? "could not update" }); }
  });

  app.post("/api/funding/opportunities/:id/notes", guard, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const r = await addNote({ id, body: req.body?.body, author: req.headers["x-admin-email"] as string });
      if (!r.ok) return res.status(400).json({ error: r.reason });
      return res.json({ ok: true });
    } catch (e: any) { return res.status(400).json({ error: e?.message ?? "could not add note" }); }
  });

  /**
   * POST /api/funding/sweep
   *
   * Deliberately manual. It spends money on model calls and web search, so it
   * runs when somebody asks rather than on a timer nobody remembers setting.
   * Everything it finds lands as a candidate awaiting review.
   */
  app.post("/api/funding/sweep", guard, async (req, res) => {
    try {
      const queries = Array.isArray(req.body?.queries) && req.body.queries.length
        ? req.body.queries.filter((q: unknown) => typeof q === "string").slice(0, 8)
        : undefined;
      const result = await sweep({ queries });
      return res.json({ ...result, defaultQueries: DEFAULT_QUERIES });
    } catch (e: any) { return res.status(500).json({ error: e?.message ?? "sweep failed" }); }
  });
}
