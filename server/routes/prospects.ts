/**
 * prospects.ts, the cold outbound pipeline.
 *
 * Discovery finds businesses, a model works out what they are and writes the
 * first email, Anthony reads it and approves, and only then does anything send.
 *
 * ## Why approval is a separate act and cannot be automated
 *
 * A model writing to ten thousand strangers in a founder's name is the one
 * version of this that ends badly, and it ends badly all at once. Every send
 * requires an `approvedAt` set through the console by a named person. There is
 * no route that approves and sends in the same call, on purpose.
 */

import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { prospects, assessSendable, classifyAddress } from "@shared/prospect-schema";
import { requireAdmin } from "../middleware/admin-auth";
import { discoverProspects, SEED_QUERIES, SEED_LOCATIONS } from "../prospects/discover";
import { researchAndWrite } from "../prospects/write";
import { checkSendConfig, sendProspectEmail, sentToday, DAILY_SEND_CAP, suppress } from "../prospects/send";

const MODEL = (process.env.AGENT_MODEL || "claude-sonnet-5").trim();

export function registerProspectRoutes(app: Express): void {
  // ── GET /api/prospects ──────────────────────────────────────────────────
  app.get("/api/prospects", requireAdmin, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "all";
      const segment = typeof req.query.segment === "string" ? req.query.segment : "all";

      const rows = await db.select().from(prospects)
        .orderBy(desc(prospects.fitScore), desc(prospects.createdAt))
        .limit(1000);

      const filtered = rows.filter(r =>
        (status === "all" || r.status === status) &&
        (segment === "all" || r.segment === segment));

      const count = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).length;
      return res.json({
        prospects: filtered.slice(0, 300),
        total: filtered.length,
        counts: {
          all: rows.length,
          new: count(r => r.status === "new"),
          drafted: count(r => r.status === "drafted"),
          approved: count(r => r.status === "approved"),
          sent: count(r => r.status === "sent"),
          sendable: count(r => r.sendable),
          blocked: count(r => !r.sendable),
        },
        segments: {
          hedger: count(r => r.segment === "hedger"),
          underwriter: count(r => r.segment === "underwriter"),
          psp: count(r => r.segment === "psp"),
          bank: count(r => r.segment === "bank"),
          unknown: count(r => r.segment === "unknown"),
        },
      });
    } catch {
      return res.json({ prospects: [], total: 0, counts: {}, segments: {} });
    }
  });

  // ── GET /api/prospects/config ───────────────────────────────────────────
  app.get("/api/prospects/config", requireAdmin, async (_req, res) => {
    const guard = checkSendConfig();
    return res.json({
      canSend: guard.ok,
      reason: guard.reason ?? null,
      from: guard.from ?? null,
      discovery: !!process.env.APIFY_TOKEN,
      sentToday: await sentToday(),
      dailyCap: DAILY_SEND_CAP,
      seeds: { queries: SEED_QUERIES, locations: SEED_LOCATIONS },
    });
  });

  // ── POST /api/prospects/discover ────────────────────────────────────────
  app.post("/api/prospects/discover", requireAdmin, async (req, res) => {
    try {
      const token = process.env.APIFY_TOKEN;
      if (!token) return res.status(503).json({ error: "Discovery needs APIFY_TOKEN." });

      const { query, location, segment, limit } = req.body ?? {};
      const q = typeof query === "string" ? query.trim() : "";
      const loc = typeof location === "string" ? location.trim() : "";
      if (!q || !loc) return res.status(400).json({ error: "Give it a business type and a place." });

      const out = await discoverProspects({
        token, query: q, location: loc,
        segment: ["hedger", "underwriter", "psp", "bank"].includes(segment) ? segment : "unknown",
        limit: Math.min(Math.max(Number(limit) || 60, 1), 300),
      });
      return res.json(out);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "discovery failed" });
    }
  });

  // ── POST /api/prospects/write ───────────────────────────────────────────
  //
  // Research and draft for everything not yet written. Capped per call because
  // each row is a model call, and a discovery run can add three hundred.
  app.post("/api/prospects/write", requireAdmin, async (req, res) => {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Drafting is not configured." });
      const limit = Math.min(Math.max(Number(req.body?.limit) || 20, 1), 50);

      const pending = await db.select().from(prospects)
        .where(and(eq(prospects.status, "new"), isNull(prospects.draftBody)))
        .orderBy(desc(prospects.createdAt))
        .limit(limit);

      let written = 0;
      for (const p of pending) {
        const w = await researchAndWrite(apiKey, MODEL, {
          company: p.company, website: p.website, country: p.country,
          industry: p.industry, evidence: p.evidence, description: p.description,
          addressKind: p.addressKind,
        });
        if (!w) continue;
        await db.update(prospects).set({
          segment: w.segment, fit: w.fit, fitScore: w.fitScore, description: w.description,
          draftSubject: w.subject, draftBody: w.body,
          status: "drafted", updatedAt: new Date(),
        }).where(eq(prospects.id, p.id));
        written++;
      }

      const [{ left }] = await db.select({ left: sql<number>`count(*)::int` }).from(prospects)
        .where(and(eq(prospects.status, "new"), isNull(prospects.draftBody)));
      return res.json({ written, considered: pending.length, remaining: Number(left) || 0 });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "drafting failed" });
    }
  });

  // ── PATCH /api/prospects/:id ────────────────────────────────────────────
  app.patch("/api/prospects/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
      const { draftSubject, draftBody, status, notes, segment } = req.body ?? {};
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof draftSubject === "string" && draftSubject.trim()) patch.draftSubject = draftSubject.trim();
      if (typeof draftBody === "string" && draftBody.trim()) patch.draftBody = draftBody.trim();
      if (["new", "drafted", "approved", "rejected", "replied"].includes(status)) patch.status = status;
      if (["hedger", "underwriter", "psp", "bank", "unknown"].includes(segment)) patch.segment = segment;
      if (typeof notes === "string") patch.notes = notes;

      // Editing the message un-approves it. An approval is a person saying they
      // read this text; changing the text afterwards makes that record false.
      if (patch.draftBody || patch.draftSubject) {
        patch.approvedAt = null;
        patch.approvedBy = null;
        if (!patch.status) patch.status = "drafted";
      }

      const [row] = await db.update(prospects).set(patch).where(eq(prospects.id, id)).returning();
      if (!row) return res.status(404).json({ error: "not found" });
      return res.json(row);
    } catch {
      return res.status(500).json({ error: "Could not update that." });
    }
  });

  // ── POST /api/prospects/:id/approve ─────────────────────────────────────
  app.post("/api/prospects/:id/approve", requireAdmin, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
      const on = req.body?.approved !== false;

      const [p] = await db.select().from(prospects).where(eq(prospects.id, id)).limit(1);
      if (!p) return res.status(404).json({ error: "not found" });
      if (on && !p.sendable) {
        return res.status(400).json({ error: p.sendableReason || "This address cannot be emailed." });
      }
      if (on && !p.draftBody) return res.status(400).json({ error: "Nothing drafted yet." });

      const [row] = await db.update(prospects).set({
        approvedAt: on ? new Date() : null,
        approvedBy: on ? (req.adminEmail || "admin") : null,
        status: on ? "approved" : "drafted",
        updatedAt: new Date(),
      }).where(eq(prospects.id, id)).returning();
      return res.json(row);
    } catch {
      return res.status(500).json({ error: "Could not approve that." });
    }
  });

  // ── POST /api/prospects/:id/send ────────────────────────────────────────
  app.post("/api/prospects/:id/send", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
      if ((await sentToday()) >= DAILY_SEND_CAP) {
        return res.status(429).json({
          error: `Daily cap of ${DAILY_SEND_CAP} reached. A new sending domain judged on volume ramp is a domain that gets filtered.`,
        });
      }
      const out = await sendProspectEmail(id);
      return out.ok ? res.json(out) : res.status(400).json(out);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "send failed" });
    }
  });

  // ── POST /api/prospects/send-approved ───────────────────────────────────
  //
  // Everything already approved, up to the daily cap. This sends only messages
  // a person has already read and marked; it cannot approve anything itself.
  app.post("/api/prospects/send-approved", requireAdmin, async (_req, res) => {
    try {
      const guard = checkSendConfig();
      if (!guard.ok) return res.status(503).json({ error: guard.reason });

      const already = await sentToday();
      const room = Math.max(0, DAILY_SEND_CAP - already);
      if (!room) return res.status(429).json({ error: `Daily cap of ${DAILY_SEND_CAP} already reached.` });

      const queue = await db.select().from(prospects)
        .where(and(eq(prospects.status, "approved"), isNull(prospects.sentAt)))
        .orderBy(desc(prospects.fitScore))
        .limit(room);

      let sent = 0;
      const failures: Array<{ id: number; error?: string }> = [];
      for (const p of queue) {
        const out = await sendProspectEmail(p.id);
        if (out.ok) sent++; else failures.push({ id: p.id, error: out.error });
      }
      return res.json({ sent, attempted: queue.length, failures, capRemaining: room - sent });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "send failed" });
    }
  });

  // ── GET /api/prospects/unsubscribe/:token ───────────────────────────────
  //
  // Public, and must stay public: an unsubscribe behind a login is not an
  // unsubscribe. The token carries no address, so seeing the link tells you
  // nothing and leaks nothing into server logs.
  app.get("/api/prospects/unsubscribe/:token", async (req, res) => {
    const done = (msg: string) =>
      res.status(200).send(
        `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title>` +
        `<div style="font:16px/1.6 -apple-system,system-ui,sans-serif;max-width:34em;margin:12vh auto;padding:0 1.2em;color:#0f172a">` +
        `<h1 style="font-size:19px">${msg}</h1>` +
        `<p style="color:#475569">You will not receive further emails from BlockFinaX outreach.</p></div>`,
      );
    try {
      const token = String(req.params.token || "");
      if (!token) return done("That link is not valid.");
      const [p] = await db.select().from(prospects)
        .where(eq(prospects.unsubscribeToken, token)).limit(1);
      if (!p) return done("That link is not valid, or you already unsubscribed.");

      await db.update(prospects)
        .set({ unsubscribedAt: new Date(), sendable: false, sendableReason: "Unsubscribed.", status: "rejected" })
        .where(eq(prospects.id, p.id));
      // Also to the standing list, so the next discovery run cannot re-add them.
      await suppress(p.email, "unsubscribed", `via prospect ${p.id}`);
      return done("Done. You are unsubscribed.");
    } catch {
      return done("Something went wrong, but your request was noted.");
    }
  });

  // ── POST /api/prospects/suppress ────────────────────────────────────────
  app.post("/api/prospects/suppress", requireAdmin, async (req, res) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!email) return res.status(400).json({ error: "Which address?" });
      await suppress(email, "manual", typeof req.body?.note === "string" ? req.body.note : undefined);
      await db.update(prospects)
        .set({ sendable: false, sendableReason: "On the suppression list.", status: "rejected" })
        .where(eq(prospects.email, email));
      return res.json({ suppressed: email });
    } catch {
      return res.status(500).json({ error: "Could not suppress that." });
    }
  });
}
