/**
 * outreach.ts — Finax drafts a LinkedIn reply; Anthony sends it.
 *
 * ## Why nothing here touches LinkedIn
 *
 * Their robots.txt prohibits automated access outright, and /feed/ redirects
 * any server request to a login wall — so "scanning" would mean driving a
 * logged-in session, which the User Agreement §8.2 forbids and which LinkedIn
 * enforces with bans. An account that carries a founder's outbound is worth
 * more than the convenience of not pasting.
 *
 * Reading a post was never the slow part. Pasting one takes thirty seconds;
 * writing a reply that says something true about FX cover takes ten minutes,
 * and that is the half worth automating.
 *
 * ## Why the draft is grounded in live data
 *
 * The failure mode for this kind of tool is fluent nothing — a reply that could
 * be posted under any fintech's logo. Every draft is written against the real
 * book: open pools, what cover actually costs, what has settled. A reply that
 * quotes a live premium is worth sending; one that says "we help businesses
 * manage FX volatility" is worth deleting, and reads to the recipient as a bot.
 */

import type { Express } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../db";
import { outreachDrafts } from "@shared/schema";
import { requireAdmin } from "../middleware/admin-auth";

const MODEL = (process.env.AGENT_MODEL || "claude-sonnet-5").trim();

type Intent = "reply" | "connect" | "dm";

const INTENT_RULES: Record<Intent, string> = {
  reply:
    "A public comment on their post. Under 60 words. It has to earn its place in a " +
    "thread — add a number, a mechanism or a distinction they did not have. Never " +
    "open by praising the post. No hashtags. No call to action; if the comment is " +
    "good they will look you up.",
  connect:
    "A connection request note. Under 300 characters, LinkedIn's hard limit. Say why " +
    "them specifically, in one line, referencing what they actually wrote. No pitch.",
  dm:
    "A direct message. Under 120 words. Assume they do not know who you are. Lead " +
    "with the specific thing in their post that prompted the message, say what " +
    "BlockFinaX does in one sentence, and ask one question worth answering. No " +
    "attachments, no calendar links, no 'quick call'.",
};

/** What the drafter is allowed to assert. Facts, not adjectives. */
async function liveContext(): Promise<string> {
  const lines: string[] = [];
  try {
    const { readChainEvents } = await import("../hedge-reader");
    const events = await readChainEvents();
    const open = events.filter(e => e.status === "open" && e.expiryDate > new Date());
    lines.push(`Open cover pools right now: ${open.length}.`);
    for (const e of open.slice(0, 5)) {
      const days = Math.max(0, (e.expiryDate.getTime() - Date.now()) / 86400000);
      lines.push(
        `  ${e.underlying}: strike ${e.strike}, premium ${(e.premiumRate * 100).toFixed(2)}% of notional, ` +
        `${days.toFixed(1)} days to expiry, $${e.totalLiquidity.toFixed(0)} underwritten.`,
      );
    }
    const settled = events.filter(e => e.status === "settled").length;
    if (settled) lines.push(`Pools settled to date: ${settled}.`);
  } catch {
    lines.push("Live pool data unavailable — do not quote specific pools or premiums.");
  }
  return lines.join("\n");
}

const SYSTEM = `You are drafting LinkedIn messages for Anthony Kumako, founder of BlockFinaX.

BlockFinaX writes parametric FX cover for businesses in frontier markets — importers
and exporters in Ghana, Nigeria and Kenya whose banks will not sell them a forward
because the ticket is too small and the credit assessment costs more than the trade.
Underwriters lock stablecoins into a pool against a currency pair, a strike and an
expiry. A hedger pays a premium for cover on a notional amount. At expiry an oracle
posts the rate and the contract pays out arithmetically — payout rises in proportion
to how far the rate moved past the strike, capped at a level fixed when the pool was
created. No claim, no assessor. It runs on Base and BNB Smart Chain.

How Anthony writes:
- Plain English. A CFO in Accra is the reader, not a crypto audience.
- Specific over general. A number beats an adjective every time.
- No hype, no emoji, no hashtags, no "excited to share", no "game-changing".
- British spelling.
- He is comfortable saying what the protocol does not do. It reads as confidence.

Hard rules:
- Never invent a number. Use only the live figures supplied, or none at all.
- Never claim regulatory status. BlockFinaX is pre-licence and has a Bank of Ghana
  sandbox application filed. If regulation comes up, say that plainly.
- Never promise returns to an underwriter or protection against loss to a hedger.
- If the post is unrelated to FX, trade, treasury or frontier markets, say so in the
  draft rather than forcing a connection — a forced reply costs more than no reply.

Output the message only. No preamble, no sign-off block, no quotation marks around it.`;

export function registerOutreachRoutes(app: Express): void {
  // ── POST /api/outreach/draft ────────────────────────────────────────────
  app.post("/api/outreach/draft", requireAdmin, async (req, res) => {
    try {
      const { sourceText, sourceUrl, personName, personHeadline, intent } = req.body ?? {};
      if (typeof sourceText !== "string" || sourceText.trim().length < 20) {
        return res.status(400).json({ error: "Paste the post or comment you want to reply to." });
      }
      const kind: Intent = ["reply", "connect", "dm"].includes(intent) ? intent : "reply";

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Drafting is not configured (ANTHROPIC_API_KEY)." });

      const who = [personName, personHeadline].filter(Boolean).join(" — ") || "unknown";
      const prompt =
        `They wrote:\n"""\n${sourceText.trim().slice(0, 4000)}\n"""\n\n` +
        `Who they are: ${who}\n\n` +
        `Live BlockFinaX figures you may quote:\n${await liveContext()}\n\n` +
        `Draft a ${kind}. ${INTENT_RULES[kind]}`;

      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 700,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      });
      const draft = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text)
        .join("")
        .trim();
      if (!draft) return res.status(502).json({ error: "The model returned nothing. Try again." });

      const [row] = await db
        .insert(outreachDrafts)
        .values({
          sourceUrl: typeof sourceUrl === "string" && sourceUrl.trim() ? sourceUrl.trim() : null,
          sourceText: sourceText.trim(),
          personName: personName?.trim() || null,
          personHeadline: personHeadline?.trim() || null,
          intent: kind,
          draft,
          originalDraft: draft,
        })
        .returning();
      return res.json(row);
    } catch (err) {
      const m = err instanceof Error ? err.message : "drafting failed";
      return res.status(500).json({ error: m });
    }
  });

  // ── GET /api/outreach ───────────────────────────────────────────────────
  app.get("/api/outreach", requireAdmin, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "waiting";
      const rows = await db
        .select()
        .from(outreachDrafts)
        .where(eq(outreachDrafts.status, status))
        .orderBy(desc(outreachDrafts.createdAt))
        .limit(100);
      return res.json(rows);
    } catch {
      return res.status(500).json({ error: "Could not load the waiting room." });
    }
  });

  // ── PATCH /api/outreach/:id ─────────────────────────────────────────────
  // Edit the text, or move it out of the waiting room. "Sent" is a claim about
  // something that happened elsewhere — nothing here can send anything.
  app.patch("/api/outreach/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });
      const { draft, status } = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (typeof draft === "string" && draft.trim()) patch.draft = draft.trim();
      if (status === "sent" || status === "discarded" || status === "waiting") {
        patch.status = status;
        patch.sentAt = status === "sent" ? new Date() : null;
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing to update" });

      const [row] = await db
        .update(outreachDrafts)
        .set(patch)
        .where(eq(outreachDrafts.id, id))
        .returning();
      if (!row) return res.status(404).json({ error: "not found" });
      return res.json(row);
    } catch {
      return res.status(500).json({ error: "Could not update that draft." });
    }
  });

  // ── GET /api/outreach/stats ─────────────────────────────────────────────
  app.get("/api/outreach/stats", requireAdmin, async (_req, res) => {
    try {
      const rows = await db.select({ status: outreachDrafts.status }).from(outreachDrafts);
      const count = (s: string) => rows.filter(r => r.status === s).length;
      return res.json({ waiting: count("waiting"), sent: count("sent"), discarded: count("discarded") });
    } catch {
      return res.json({ waiting: 0, sent: 0, discarded: 0 });
    }
  });
}
