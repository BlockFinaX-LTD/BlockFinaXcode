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
import { recheck } from "../funding/recheck";
import { requireAdmin } from "../middleware/admin-auth";

/**
 * Guarded by the same session every other admin route uses.
 *
 * My first version checked an `x-admin-email` header against ADMIN_EMAILS,
 * which was both a second auth scheme and a weaker one: a header naming an
 * allowed address is not proof of being that person. requireAdmin resolves a
 * real signed-in session and puts the verified email on the request, which is
 * also what makes attribution on a stage change trustworthy.
 */
export function registerFundingRoutes(app: Express): void {
  const guard = requireAdmin;

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
      const r = await addOpportunity({ ...req.body, author: (req as any).adminEmail });
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
        author: (req as any).adminEmail,
      });
      if (!r.ok) return res.status(400).json({ error: r.reason });
      return res.json({ ok: true });
    } catch (e: any) { return res.status(400).json({ error: e?.message ?? "could not update" }); }
  });

  app.post("/api/funding/opportunities/:id/notes", guard, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const r = await addNote({ id, body: req.body?.body, author: (req as any).adminEmail });
      if (!r.ok) return res.status(400).json({ error: r.reason });
      return res.json({ ok: true });
    } catch (e: any) { return res.status(400).json({ error: e?.message ?? "could not add note" }); }
  });

  /**
   * POST /api/funding/recheck
   *
   * Revisits everything still live and reports what has changed underneath it.
   * Free without `deep`, which catches dead links and deadlines already gone
   * by; `deep` adds a page read per opportunity and costs a model call each.
   *
   * Changes nothing except a deadline that the programme's own page has moved.
   * A closing programme is news for whoever owns it, not grounds for a
   * background job to decide an application is abandoned.
   */
  app.post("/api/funding/recheck", guard, async (req, res) => {
    try {
      return res.json(await recheck({ deep: req.body?.deep === true }));
    } catch (e: any) { return res.status(500).json({ error: e?.message ?? "recheck failed" }); }
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
