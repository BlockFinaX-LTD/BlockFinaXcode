/**
 * Mini-CEO agent — API
 *
 * Admin-only in this phase. The public website agent is a later phase and will
 * mount its own routes with the `public` scope, whose tool set cannot reach
 * business data (see server/agent/tools.ts).
 *
 * Nothing here executes an outward-facing action. Proposals are created,
 * approved and recorded; the executor that actually sends is phase 3, and it
 * will go through the existing LOI routes rather than around them.
 */

import type { Express, Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { requireAdmin, requireApprover, getApproverEmails } from "../middleware/admin-auth";
import { strictLimiter } from "../middleware/rate-limiter";
import {
  agentProposals, agentMessages, agentRules, agentRuns, agentSettings, agentFacts,
  chatSchema, decideSchema, ruleSchema,
  CAPABILITIES, DEFAULT_AUTONOMY, AUTONOMY_LEVELS,
  type Capability, type AutonomyLevel,
} from "@shared/agent-schema";
import { runAgent, agentConfigured, MODEL } from "../agent/runtime";
import { extractRules, recordDecision, decisionStats } from "../agent/learning";
import { sendPendingDigest } from "../agent/notify";

const AUTONOMY_KEY = "autonomy";

/** Autonomy dial, defaults merged over whatever has been saved. */
async function getAutonomy(): Promise<Record<Capability, AutonomyLevel>> {
  try {
    const [row] = await db.select().from(agentSettings).where(eq(agentSettings.key, AUTONOMY_KEY)).limit(1);
    const saved = row ? (JSON.parse(row.value) as Partial<Record<Capability, AutonomyLevel>>) : {};
    return { ...DEFAULT_AUTONOMY, ...saved };
  } catch {
    return { ...DEFAULT_AUTONOMY };
  }
}

/** Text of a proposal, for the decision log. Kinds vary, so this is best-effort. */
function draftText(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return "";
  const parts = [payload.subject, payload.body, payload.text, payload.message]
    .filter((v): v is string => typeof v === "string");
  return parts.join("\n\n");
}

export function registerAgentRoutes(app: Express) {
  /** Whether the agent can run at all, plus what it costs so far. */
  app.get("/api/agent/status", requireAdmin, async (req: Request, res: Response) => {
    try {
      const [spend] = await db
        .select({
          runs: sql<number>`count(*)::int`,
          cost: sql<number>`coalesce(sum(cost_usd), 0)`,
          tokensIn: sql<number>`coalesce(sum(tokens_in), 0)::int`,
          tokensOut: sql<number>`coalesce(sum(tokens_out), 0)::int`,
        })
        .from(agentRuns);
      const [pending] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(agentProposals)
        .where(eq(agentProposals.status, "proposed"));

      const me = ((req as any).adminEmail || "").toLowerCase();
      res.json({
        configured: agentConfigured(),
        model: MODEL,
        canApprove: getApproverEmails().includes(me),
        approvers: getApproverEmails(),
        pendingProposals: pending?.n ?? 0,
        spend: {
          runs: spend?.runs ?? 0,
          totalUsd: Number(spend?.cost ?? 0).toFixed(4),
          tokensIn: spend?.tokensIn ?? 0,
          tokensOut: spend?.tokensOut ?? 0,
        },
        autonomy: await getAutonomy(),
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to read agent status" });
    }
  });

  // ═══ CHAT ══════════════════════════════════════════════════════════════

  app.get("/api/agent/thread/:threadId", requireAdmin, async (req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.threadId, req.params.threadId), eq(agentMessages.scope, "internal")))
      .orderBy(agentMessages.id);
    res.json(rows);
  });

  /**
   * Ask the agent something. Rate-limited because each call costs money and
   * an accidental loop in the UI would otherwise be expensive.
   */
  app.post("/api/agent/chat", requireAdmin, strictLimiter, async (req: Request, res: Response) => {
    if (!agentConfigured()) {
      return res.status(503).json({
        message: "The agent isn't configured yet. Set ANTHROPIC_API_KEY and restart.",
      });
    }
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid message" });
    const { threadId, message } = parsed.data;

    try {
      const history = await db
        .select()
        .from(agentMessages)
        .where(and(eq(agentMessages.threadId, threadId), eq(agentMessages.scope, "internal")))
        .orderBy(agentMessages.id)
        .limit(40);

      await db.insert(agentMessages).values({ threadId, scope: "internal", role: "user", content: message });

      const result = await runAgent({
        scope: "internal",
        trigger: "chat",
        messages: [
          ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          { role: "user" as const, content: message },
        ],
      });

      const [saved] = await db
        .insert(agentMessages)
        .values({
          threadId,
          scope: "internal",
          role: "assistant",
          content: result.text || "(no reply)",
          toolCalls: result.toolCalls,
          runId: result.runId,
        })
        .returning();

      res.json({
        message: saved,
        usage: { tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd.toFixed(4) },
      });
    } catch (err: any) {
      console.error("[agent] chat failed:", err?.message);
      res.status(500).json({ message: err?.message || "The agent couldn't answer that." });
    }
  });

  app.delete("/api/agent/thread/:threadId", requireAdmin, async (req: Request, res: Response) => {
    await db.delete(agentMessages).where(eq(agentMessages.threadId, req.params.threadId));
    res.json({ ok: true });
  });

  // ═══ PROPOSALS ═════════════════════════════════════════════════════════

  app.get("/api/agent/proposals", requireAdmin, async (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : "proposed";
    let rows = await db.select().from(agentProposals).orderBy(desc(agentProposals.id)).limit(200);
    if (status && status !== "all") rows = rows.filter((r) => r.status === status);
    res.json(rows);
  });

  /**
   * Approve or reject. An approval carrying an edited payload is recorded as
   * an edit, because the diff is the most useful thing the agent can learn
   * from — treating it as a plain approval would throw that away.
   */
  app.post("/api/agent/proposals/:id/decide", requireApprover, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const parsed = decideSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid decision" });
      const { decision, editedPayload, note } = parsed.data;

      const [p] = await db.select().from(agentProposals).where(eq(agentProposals.id, id)).limit(1);
      if (!p) return res.status(404).json({ message: "Not found" });
      if (p.status !== "proposed") {
        return res.status(409).json({ message: `Already ${p.status}.` });
      }

      const edited = decision === "approved" && editedPayload && draftText(editedPayload) !== draftText(p.payload);

      await db
        .update(agentProposals)
        .set({
          status: decision,
          editedPayload: editedPayload ?? null,
          decidedAt: new Date(),
          decidedBy: (req as any).adminEmail ?? null,
        })
        .where(eq(agentProposals.id, id));

      await recordDecision({
        proposalId: id,
        kind: p.kind,
        decision: edited ? "edited" : decision,
        original: draftText(p.payload),
        final: edited ? draftText(editedPayload) : null,
        note,
        decidedBy: (req as any).adminEmail ?? null,
      });

      // Execution is phase 3 and will call the existing LOI routes rather than
      // reimplementing them. Until then an approval records intent only.
      res.json({ ok: true, status: decision, recordedAs: edited ? "edited" : decision, executed: false });
    } catch (err: any) {
      console.error("[agent] decide failed:", err?.message);
      res.status(500).json({ message: "Failed to record the decision" });
    }
  });

  /** Send the digest now rather than waiting for the sweep. */
  app.post("/api/agent/notify", requireApprover, strictLimiter, async (_req: Request, res: Response) => {
    try {
      res.json(await sendPendingDigest());
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to send the digest" });
    }
  });

  // ═══ LEARNING ══════════════════════════════════════════════════════════

  app.get("/api/agent/rules", requireAdmin, async (_req: Request, res: Response) => {
    const rules = await db.select().from(agentRules).orderBy(desc(agentRules.id));
    res.json({ rules, stats: await decisionStats() });
  });

  app.post("/api/agent/rules", requireAdmin, async (req: Request, res: Response) => {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid rule" });
    const [row] = await db
      .insert(agentRules)
      .values({ ...parsed.data, origin: "manual" })
      .returning();
    res.status(201).json(row);
  });

  app.patch("/api/agent/rules/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof req.body?.rule === "string") patch.rule = req.body.rule.slice(0, 1000);
    if (typeof req.body?.active === "boolean") patch.active = req.body.active;
    const [row] = await db.update(agentRules).set(patch).where(eq(agentRules.id, id)).returning();
    res.json(row);
  });

  app.delete("/api/agent/rules/:id", requireAdmin, async (req: Request, res: Response) => {
    await db.delete(agentRules).where(eq(agentRules.id, parseInt(req.params.id, 10)));
    res.json({ ok: true });
  });

  /** Review recent decisions and propose new preferences. */
  app.post("/api/agent/rules/extract", requireAdmin, strictLimiter, async (_req: Request, res: Response) => {
    if (!agentConfigured()) return res.status(503).json({ message: "Set ANTHROPIC_API_KEY first." });
    try {
      res.json(await extractRules("internal"));
    } catch (err: any) {
      console.error("[agent] extraction failed:", err?.message);
      res.status(500).json({ message: err?.message || "Extraction failed" });
    }
  });

  // ═══ MEMORY & SETTINGS ═════════════════════════════════════════════════

  app.get("/api/agent/facts", requireAdmin, async (_req: Request, res: Response) => {
    res.json(await db.select().from(agentFacts).orderBy(desc(agentFacts.id)));
  });

  app.post("/api/agent/facts", requireAdmin, async (req: Request, res: Response) => {
    const fact = String(req.body?.fact || "").trim().slice(0, 2000);
    if (!fact) return res.status(400).json({ message: "Empty fact" });
    const [row] = await db.insert(agentFacts).values({ fact }).returning();
    res.status(201).json(row);
  });

  app.delete("/api/agent/facts/:id", requireAdmin, async (req: Request, res: Response) => {
    await db.delete(agentFacts).where(eq(agentFacts.id, parseInt(req.params.id, 10)));
    res.json({ ok: true });
  });

  /** Set the autonomy dial. Unknown capabilities and levels are ignored. */
  app.put("/api/agent/autonomy", requireApprover, async (req: Request, res: Response) => {
    const incoming = req.body ?? {};
    const next: Record<string, AutonomyLevel> = { ...(await getAutonomy()) };
    for (const cap of CAPABILITIES) {
      const v = incoming[cap];
      if (typeof v === "string" && (AUTONOMY_LEVELS as readonly string[]).includes(v)) {
        next[cap] = v as AutonomyLevel;
      }
    }
    const value = JSON.stringify(next);
    await db
      .insert(agentSettings)
      .values({ key: AUTONOMY_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: agentSettings.key, set: { value, updatedAt: new Date() } });
    res.json(next);
  });

  /** Recent runs, for the cost and behaviour view. */
  app.get("/api/agent/runs", requireAdmin, async (_req: Request, res: Response) => {
    res.json(await db.select().from(agentRuns).orderBy(desc(agentRuns.id)).limit(50));
  });
}
