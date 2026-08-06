/**
 * Public and customer chat.
 *
 * Two endpoints, deliberately separate from the admin agent:
 *
 *   POST /api/chat/public    anonymous website visitor
 *   POST /api/chat/customer  signed-in user, their own account only
 *
 * The security property that matters is that a customer's identity is taken
 * from a Rift-verified session and threaded into the tool executor. The model
 * never sees a wallet address it could substitute, and the customer tool
 * schemas have no field to put one in. So "tell me about someone else's
 * account" has no mechanism to succeed, regardless of how it is phrased.
 *
 * Both surfaces are metered. An unauthenticated agent endpoint is a way to
 * spend money on strangers, so the public one is capped per IP and per day.
 */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { requireRiftUser } from "../middleware/rift-auth";
import { agentMessages, agentRuns, chatSchema } from "@shared/agent-schema";
import { runAgent, agentConfigured, fence } from "../agent/runtime";

/** Daily spend ceiling for the public agent, in USD. */
const PUBLIC_DAILY_BUDGET_USD = Number(process.env.AGENT_PUBLIC_DAILY_BUDGET || 5);
/** Messages one visitor may send per hour. */
const PUBLIC_HOURLY_LIMIT = Number(process.env.AGENT_PUBLIC_HOURLY_LIMIT || 20);

const visitorHits = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  visitorHits.forEach((v, k) => { if (now > v.resetAt) visitorHits.delete(k); });
}, 10 * 60_000);

function visitorKey(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const ip = typeof fwd === "string" && fwd ? fwd.split(",")[0].trim() : req.ip || "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = visitorHits.get(key);
  if (!entry || now > entry.resetAt) {
    visitorHits.set(key, { count: 1, resetAt: now + 3_600_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > PUBLIC_HOURLY_LIMIT;
}

/** Today's public spend, so a quiet abuse campaign can't run up a bill. */
async function publicSpendToday(): Promise<number> {
  try {
    const [row] = await db
      .select({ cost: sql<number>`coalesce(sum(cost_usd), 0)` })
      .from(agentRuns)
      .where(and(eq(agentRuns.scope, "public"), gte(agentRuns.startedAt, new Date(Date.now() - 86_400_000))));
    return Number(row?.cost ?? 0);
  } catch {
    return 0;
  }
}

export function registerAgentChatRoutes(app: Express) {
  // ═══ PUBLIC ════════════════════════════════════════════════════════════

  app.post("/api/chat/public", async (req: Request, res: Response) => {
    if (!agentConfigured()) {
      return res.status(503).json({ message: "Chat isn't available right now." });
    }

    const key = visitorKey(req);
    if (rateLimited(key)) {
      return res.status(429).json({
        message: "That's a lot of questions in one go. Try again shortly, or email us at hello@blockfinax.com.",
      });
    }
    if ((await publicSpendToday()) >= PUBLIC_DAILY_BUDGET_USD) {
      return res.status(503).json({
        message: "Chat is taking a short break. Email hello@blockfinax.com and a person will reply.",
      });
    }

    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid message" });
    const { threadId, message } = parsed.data;

    try {
      // Thread ids come from the browser, so they are namespaced by the hashed
      // visitor key. Without that, guessing another visitor's id would read
      // their conversation.
      const scopedThread = `pub_${key}_${threadId}`.slice(0, 120);

      const history = await db
        .select()
        .from(agentMessages)
        .where(and(eq(agentMessages.threadId, scopedThread), eq(agentMessages.scope, "public")))
        .orderBy(agentMessages.id)
        .limit(20);

      await db.insert(agentMessages).values({
        threadId: scopedThread, scope: "public", role: "user", content: message,
      });

      const result = await runAgent({
        scope: "public",
        trigger: "chat",
        maxTokens: 1024,
        retrieveFor: message,
        messages: [
          ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          // A stranger's text is fenced as data, not folded into instructions.
          { role: "user" as const, content: fence("website-visitor", message) },
        ],
      });

      const [saved] = await db
        .insert(agentMessages)
        .values({
          threadId: scopedThread, scope: "public", role: "assistant",
          content: result.text || "Sorry — I didn't catch that.",
          toolCalls: result.toolCalls, runId: result.runId,
        })
        .returning();

      res.json({ reply: saved.content, id: saved.id });
    } catch (err: any) {
      console.error("[chat:public] failed:", err?.message);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  app.get("/api/chat/public/:threadId", async (req: Request, res: Response) => {
    const scopedThread = `pub_${visitorKey(req)}_${req.params.threadId}`.slice(0, 120);
    const rows = await db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.threadId, scopedThread), eq(agentMessages.scope, "public")))
      .orderBy(agentMessages.id)
      .limit(50);
    res.json(rows.map((r) => ({ id: r.id, role: r.role, content: r.content })));
  });

  // ═══ CUSTOMER ══════════════════════════════════════════════════════════

  app.post("/api/chat/customer", requireRiftUser, async (req: Request, res: Response) => {
    if (!agentConfigured()) {
      return res.status(503).json({ message: "Chat isn't available right now." });
    }
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid message" });
    const { threadId, message } = parsed.data;

    // Rift verified this. It is the only source of the caller's identity —
    // nothing in the request body influences whose data gets read.
    const wallet = req.riftUser!.address;

    try {
      // Namespaced by wallet, so a guessed thread id cannot surface another
      // customer's conversation.
      const scopedThread = `cus_${wallet.toLowerCase()}_${threadId}`.slice(0, 120);

      const history = await db
        .select()
        .from(agentMessages)
        .where(and(eq(agentMessages.threadId, scopedThread), eq(agentMessages.scope, "customer")))
        .orderBy(agentMessages.id)
        .limit(30);

      await db.insert(agentMessages).values({
        threadId: scopedThread, scope: "customer", role: "user", content: message,
      });

      const result = await runAgent({
        scope: "customer",
        trigger: "chat",
        maxTokens: 1024,
        identity: { walletAddress: wallet },
        retrieveFor: message,
        messages: [
          ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          { role: "user" as const, content: fence("customer", message) },
        ],
      });

      const [saved] = await db
        .insert(agentMessages)
        .values({
          threadId: scopedThread, scope: "customer", role: "assistant",
          content: result.text || "Sorry — I didn't catch that.",
          toolCalls: result.toolCalls, runId: result.runId,
        })
        .returning();

      res.json({ reply: saved.content, id: saved.id });
    } catch (err: any) {
      console.error("[chat:customer] failed:", err?.message);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  app.get("/api/chat/customer/:threadId", requireRiftUser, async (req: Request, res: Response) => {
    const wallet = req.riftUser!.address.toLowerCase();
    const scopedThread = `cus_${wallet}_${req.params.threadId}`.slice(0, 120);
    const rows = await db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.threadId, scopedThread), eq(agentMessages.scope, "customer")))
      .orderBy(agentMessages.id)
      .limit(60);
    res.json(rows.map((r) => ({ id: r.id, role: r.role, content: r.content })));
  });
}
