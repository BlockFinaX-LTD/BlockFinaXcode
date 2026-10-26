/**
 * Public and customer chat.
 *
 * Two endpoints, deliberately separate from the admin agent:
 *
 *   POST /api/chat/public    anonymous website visitor
 *   POST /api/chat/customer  signed-in user, their own account only
 *
 * The security property that matters is that a customer's identity is taken
 * from a verified sign-in session and threaded into the tool executor. The model
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
import { leads } from "@shared/lead-schema";
import { requireUser } from "../middleware/session-auth";
import { agentMessages, agentRuns, chatSchema } from "@shared/agent-schema";
import { runAgent, agentConfigured, fence } from "../agent/runtime";

/** Daily spend ceiling for the public agent, in USD. */
const PUBLIC_DAILY_BUDGET_USD = Number(process.env.AGENT_PUBLIC_DAILY_BUDGET || 5);
/** Messages one visitor may send per hour. */
const PUBLIC_HOURLY_LIMIT = Number(process.env.AGENT_PUBLIC_HOURLY_LIMIT || 20);

const visitorHits = new Map<string, { count: number; resetAt: number }>();

/**
 * Reduce whatever arrived to something that can only be a name.
 *
 * This string is handed to the model, so it is an injection surface like any
 * other visitor input. It stays inside the untrusted fence at the call site,
 * and this strips the characters that would let it pose as structure there:
 * no newlines, no angle brackets, no punctuation beyond what real names use.
 *
 * Returns null rather than an empty string when nothing survives, so the
 * caller has one falsy case to handle instead of two.
 */
function cleanVisitorName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    // Control characters and newlines first: those are what would let the
    // value break out of the single line it is placed on.
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    // Then the characters that could pose as markup or fence structure.
    // A denylist rather than a letters-only allowlist on purpose: most of our
    // market does not write their name in ASCII, and mangling someone's name
    // is a worse failure than passing through a character we did not predict.
    .replace(/[<>{}\[\]|\\`"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return cleaned.length >= 1 ? cleaned : null;
}


setInterval(() => {
  const now = Date.now();
  visitorHits.forEach((v, k) => { if (now > v.resetAt) visitorHits.delete(k); });
}, 10 * 60_000);

export function visitorKey(req: Request): string {
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
    const visitorName = cleanVisitorName(parsed.data.visitorName);

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
          {
            role: "user" as const,
            // Inside the fence deliberately. The name is visitor-supplied, so
            // it gets exactly the trust the visitor's own message gets.
            content: fence(
              "website-visitor",
              visitorName ? `[visitor's name: ${visitorName}]\n${message}` : message,
            ),
          },
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

      // The agent decides when offering a follow-up is natural; it never does
      // the collecting. This flag puts the consent form on screen — and is
      // suppressed once this visitor has already given their details, so the
      // same person is never asked twice.
      let offerFollowUp = false;
      if ((result.toolCalls ?? []).some((t) => t.name === "offer_follow_up")) {
        const [already] = await db
          .select({ id: leads.id })
          .from(leads)
          .where(eq(leads.threadId, scopedThread))
          .limit(1);
        offerFollowUp = !already;
      }

      res.json({ reply: saved.content, id: saved.id, offerFollowUp });
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

  app.post("/api/chat/customer", requireUser, async (req: Request, res: Response) => {
    if (!agentConfigured()) {
      return res.status(503).json({ message: "Chat isn't available right now." });
    }
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid message" });
    const { threadId, message } = parsed.data;

    // The session check verified this. It is the only source of the caller's identity —
    // nothing in the request body influences whose data gets read.
    const wallet = req.sessionUser!.address;

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

  app.get("/api/chat/customer/:threadId", requireUser, async (req: Request, res: Response) => {
    const wallet = req.sessionUser!.address.toLowerCase();
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
