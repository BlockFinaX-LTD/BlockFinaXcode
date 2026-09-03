/**
 * content.ts — drafting posts, behind the admin session.
 *
 * Draft and propose are separate endpoints on purpose. Draft returns something
 * to look at without putting it in the queue, which is what you want while
 * finding the angle; propose files it for approval, which is the commitment.
 *
 * Neither posts. The token that can post lives in outreach/linkedin.ts and is
 * reached only after a person approves the proposal.
 */
import type { Express } from "express";
import { requireAdmin } from "../middleware/admin-auth";
import { draftPost, proposePost, ANGLES, type Angle } from "../agent/content";
import { availablePairs } from "../agent/fx";

export function registerContentRoutes(app: Express): void {
  /** The angles, and the pairs there is data for. */
  app.get("/api/content/angles", requireAdmin, async (_req, res) => {
    try {
      const pairs = await availablePairs().catch(() => []);
      return res.json({
        angles: Object.entries(ANGLES).map(([k, v]) => ({ key: k, label: v.label, brief: v.brief })),
        pairs,
      });
    } catch (e: any) { return res.status(500).json({ error: e?.message ?? "could not load" }); }
  });

  app.post("/api/content/draft", requireAdmin, async (req, res) => {
    try {
      const { angle, pair, extra } = req.body ?? {};
      if (!angle || !(angle in ANGLES)) return res.status(400).json({ error: "A known angle is required." });
      const out = await draftPost({ angle: angle as Angle, pair, extra });
      if ("error" in out) return res.status(400).json({ error: out.error });
      return res.json(out);
    } catch (e: any) { return res.status(500).json({ error: e?.message ?? "drafting failed" }); }
  });

  app.post("/api/content/propose", requireAdmin, async (req, res) => {
    try {
      const { angle, pair, extra } = req.body ?? {};
      if (!angle || !(angle in ANGLES)) return res.status(400).json({ error: "A known angle is required." });
      const out = await proposePost({ angle: angle as Angle, pair, extra });
      if (!out.ok) return res.status(400).json({ error: out.error });
      return res.json(out);
    } catch (e: any) { return res.status(500).json({ error: e?.message ?? "could not queue" }); }
  });
}
