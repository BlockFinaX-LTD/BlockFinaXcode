/**
 * outreach.ts — Finax finds LinkedIn posts worth answering and drafts the reply.
 * Anthony sends it. Nothing here ever posts.
 *
 * ## Three ways a post gets here
 *
 *   /draft   one post, pasted by hand.
 *   /ingest  from the browser extension, which reads the page Anthony is already
 *            looking at. His session, his browser, his IP; it never navigates or
 *            scrolls on its own, so it makes no requests LinkedIn could see.
 *   /search  through an outside provider that runs its own infrastructure and
 *            takes no cookies. This is the safest of the three, not the riskiest:
 *            no account of ours is in the loop, so there is nothing to restrict.
 *
 * LinkedIn's own API cannot do this. Sign-In and Share are the only self-serve
 * products; post search and third-party profiles sit behind partner programmes
 * that take months and are usually refused. There is no endpoint to apply for,
 * which is why /search goes through a provider instead.
 *
 * Reading the post was never the slow part. Finding one takes seconds; writing a
 * reply that says something true about FX cover takes ten minutes, and that is
 * the half worth automating.
 *
 * ## Why the draft is grounded in live data
 *
 * The failure mode for this kind of tool is fluent nothing — a reply that could
 * be posted under any fintech's logo. Every draft is written against the real
 * book: open pools, what cover actually costs, what has settled. A reply that
 * quotes a live premium is worth sending; one that says "we help businesses
 * manage FX volatility" is worth deleting, and reads to the recipient as a bot.
 *
 * The same instinct drives relevanceScore: most of a feed is not about currency,
 * and drafting a hedging reply to a birthday post produces exactly the message
 * this tool exists to avoid. Skipping is a feature.
 */

import type { Express } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../db";
import { outreachDrafts } from "@shared/schema";
import { timingSafeEqual } from "node:crypto";
import { requireAdmin } from "../middleware/admin-auth";
import { relevanceScore } from "./outreach-relevance";

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

/**
 * Auth for the browser extension.
 *
 * Admin sessions are in-memory with an eight-hour TTL, issued by logging in
 * through Rift. That is right for a console someone sits in front of, and wrong
 * for an extension: Anthony would be re-pasting a token twice a day, and again
 * after every redeploy, since a restart empties the map.
 *
 * So /ingest also accepts a static token from the environment. It is deliberately
 * scoped to this one route. The worst an attacker can do with it is put unwanted
 * drafts in the waiting room — it cannot read the book, approve anything, or
 * reach any other admin endpoint. That is a proportionate amount of authority to
 * put in a browser extension, where a session token never belonged.
 *
 * A real admin session is still accepted, so the console works unchanged.
 */
function requireIngestAuth(req: any, res: any, next: any) {
  const configured = (process.env.OUTREACH_INGEST_TOKEN || "").trim();
  const presented = (req.headers["x-admin-token"] || "").toString().trim();
  if (configured && presented && timingSafeEqualStr(presented, configured)) return next();
  return requireAdmin(req, res, next);
}

/** Constant-time compare, so a wrong token cannot be found a character at a time. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const ACTOR = "harvestapi~linkedin-post-search";

type RawItem = { text?: unknown; url?: unknown; name?: unknown; headline?: unknown };

/**
 * Normalise one Apify result into the shape draftBatch expects.
 *
 * Field names are tried against several candidates rather than read from one
 * path. The actor's output schema is documented only as "post content, author
 * details" — the exact keys are not published, and a scraper's payload shape
 * follows LinkedIn's markup, so it moves. Reading one guessed path would fail
 * silently and return zero results with no error; trying a handful degrades to
 * a missing name instead of a missing post.
 */
function mapApifyPost(p: any): RawItem | null {
  if (!p || typeof p !== "object") return null;
  const text = p.content ?? p.text ?? p.postContent ?? p.description ?? "";
  if (typeof text !== "string" || !text.trim()) return null;

  const author = p.author ?? p.actor ?? p.poster ?? {};
  const url =
    p.url ?? p.postUrl ?? p.linkedinUrl ?? p.link ??
    author.linkedinUrl ?? author.profileUrl ?? null;

  return {
    text: text.trim(),
    url: typeof url === "string" ? url : null,
    name: author.name ?? author.fullName ?? p.authorName ?? null,
    headline: author.headline ?? author.position ?? author.occupation ?? p.authorHeadline ?? null,
  };
}

/**
 * Filter a batch of candidate posts, draft for the survivors, save them.
 *
 * Shared by the extension (/ingest) and the search provider (/search) so both
 * paths apply the same relevance bar and the same dedupe. A post found twice by
 * two different routes should not produce two drafts.
 */
async function draftBatch(
  items: RawItem[],
  kind: Intent,
  threshold: number,
): Promise<{ drafted: number; considered: number; relevant: number; drafts: unknown[] }> {
  const seen = new Set(
    (await db.select({ url: outreachDrafts.sourceUrl }).from(outreachDrafts))
      .map(r => (r.url || "").trim())
      .filter(Boolean),
  );

  const candidates: Array<{
    text: string; url: string | null; name: string | null; headline: string | null; score: number;
  }> = [];

  for (const it of items.slice(0, 200)) {
    const text = typeof it?.text === "string" ? it.text.trim() : "";
    if (text.length < 60) continue;
    const url = typeof it?.url === "string" && it.url.trim() ? it.url.trim() : null;
    if (url && seen.has(url)) continue;
    const score = relevanceScore(text);
    if (score < threshold) continue;
    candidates.push({
      text,
      url,
      name: typeof it?.name === "string" ? it.name.trim() || null : null,
      headline: typeof it?.headline === "string" ? it.headline.trim() || null : null,
      score,
    });
    if (url) seen.add(url);
  }

  // Best first, so a generous batch drafts the ten most relevant rather than
  // the ten that happened to arrive first.
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 10);
  if (!chosen.length) {
    return { drafted: 0, considered: items.length, relevant: 0, drafts: [] };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const context = await liveContext();
  const created: unknown[] = [];

  for (const c of chosen) {
    try {
      const who = [c.name, c.headline].filter(Boolean).join(" — ") || "unknown";
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 700,
        system: SYSTEM,
        messages: [{
          role: "user",
          content:
            `They wrote:\n"""\n${c.text.slice(0, 4000)}\n"""\n\n` +
            `Who they are: ${who}\n\n` +
            `Live BlockFinaX figures you may quote:\n${context}\n\n` +
            `Draft a ${kind}. ${INTENT_RULES[kind]}`,
        }],
      });
      const draft = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text).join("").trim();
      if (!draft) continue;
      const [row] = await db.insert(outreachDrafts).values({
        sourceUrl: c.url,
        sourceText: c.text,
        personName: c.name,
        personHeadline: c.headline,
        intent: kind,
        draft,
        originalDraft: draft,
      }).returning();
      created.push(row);
    } catch {
      /* one item failing must not lose the batch */
    }
  }

  return {
    drafted: created.length,
    considered: items.length,
    relevant: candidates.length,
    drafts: created,
  };
}

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

  // ── POST /api/outreach/scan ─────────────────────────────────────────────
  //
  // One paste, many drafts.
  //
  // Pasting posts one at a time is the part that made the waiting room feel
  // like work, and it is also the part that does not need a person: separating
  // a page of notifications into distinct items is reading, not judgement.
  // Select the whole LinkedIn notifications page, or a forwarded digest email,
  // or a thread of comments, and paste the lot.
  //
  // This is still not scanning LinkedIn. The text arrives because Anthony
  // copied it from his own screen, which is his to copy; nothing here reaches
  // their servers, and nothing drives his session.
  app.post("/api/outreach/scan", requireAdmin, async (req, res) => {
    try {
      const { blob, intent } = req.body ?? {};
      if (typeof blob !== "string" || blob.trim().length < 60) {
        return res.status(400).json({ error: "Paste a page of notifications, comments or a digest email." });
      }
      const kind: Intent = ["reply", "connect", "dm"].includes(intent) ? intent : "reply";
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Drafting is not configured (ANTHROPIC_API_KEY)." });

      const client = new Anthropic({ apiKey });

      // Step one: split the paste into items. Kept separate from drafting so a
      // bad extraction is visible as a wrong item rather than a wrong reply,
      // and so the model is doing one job at a time.
      const extraction = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system:
          "You separate pasted LinkedIn content into distinct items. Output ONLY a JSON array, no prose. " +
          'Each element: {"personName": string|null, "personHeadline": string|null, "sourceUrl": string|null, "text": string}. ' +
          "`text` is what that person actually wrote — the post or comment, not the UI around it. " +
          "Drop navigation, timestamps, reaction counts, 'See more', and LinkedIn's own chrome. " +
          "Drop anything Anthony Kumako or BlockFinaX wrote; he is not replying to himself. " +
          "If an item has no substantive text, omit it. If nothing usable is present, output [].",
        messages: [{ role: "user", content: blob.trim().slice(0, 24000) }],
      });
      const raw = extraction.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text)
        .join("")
        .trim();

      let items: Array<{ personName?: string; personHeadline?: string; sourceUrl?: string; text?: string }> = [];
      try {
        const match = raw.match(/\[[\s\S]*\]/);
        items = match ? JSON.parse(match[0]) : [];
      } catch {
        return res.status(502).json({ error: "Couldn't separate that into items. Try a smaller selection." });
      }
      const usable = items.filter(i => typeof i?.text === "string" && i.text.trim().length >= 20).slice(0, 15);
      if (!usable.length) {
        return res.json({ drafted: 0, skipped: items.length, drafts: [], note: "Nothing in that paste had text worth replying to." });
      }

      // Step two: draft each. Sequential rather than parallel — this is a
      // background chore, and fifteen concurrent calls is a rate limit waiting
      // to happen for no gain in a flow nobody is watching.
      const context = await liveContext();
      const created = [];
      const failed: string[] = [];
      for (const item of usable) {
        try {
          const who = [item.personName, item.personHeadline].filter(Boolean).join(" — ") || "unknown";
          const msg = await client.messages.create({
            model: MODEL,
            max_tokens: 700,
            system: SYSTEM,
            messages: [{
              role: "user",
              content:
                `They wrote:\n"""\n${item.text!.trim().slice(0, 4000)}\n"""\n\n` +
                `Who they are: ${who}\n\n` +
                `Live BlockFinaX figures you may quote:\n${context}\n\n` +
                `Draft a ${kind}. ${INTENT_RULES[kind]}`,
            }],
          });
          const draft = msg.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map(b => b.text)
            .join("")
            .trim();
          if (!draft) { failed.push(who); continue; }

          const [row] = await db.insert(outreachDrafts).values({
            sourceUrl: item.sourceUrl?.trim() || null,
            sourceText: item.text!.trim(),
            personName: item.personName?.trim() || null,
            personHeadline: item.personHeadline?.trim() || null,
            intent: kind,
            draft,
            originalDraft: draft,
          }).returning();
          created.push(row);
        } catch {
          failed.push(item.personName || "one item");
        }
      }

      return res.json({
        drafted: created.length,
        skipped: items.length - usable.length,
        failed: failed.length,
        drafts: created,
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : "scan failed";
      return res.status(500).json({ error: m });
    }
  });

  // ── POST /api/outreach/ingest ───────────────────────────────────────────
  //
  // The browser extension's endpoint. Items arrive already separated, because
  // the DOM gives cleaner structure than asking a model to re-read a blob —
  // author, headline, permalink and body are distinct fields on the page, so
  // extracting them there costs nothing and is not a guess.
  //
  // Two filters run before anything is drafted. Neither is about politeness:
  //
  //   dedupe     — the same post appears on every scroll, and drafting it twice
  //                wastes a call and puts a duplicate in front of Anthony.
  //   relevance  — a feed is mostly not about currency risk. Drafting a reply
  //                to a hiring post is worse than drafting nothing: it produces
  //                exactly the kind of message that reads as a bot, which is the
  //                thing this tool exists to avoid.
  //
  // The relevance test is keyword-based on purpose. A model call per post would
  // cost more than the drafts themselves, and the judgement here is coarse —
  // does this mention money moving across a border — not subtle.
  app.post("/api/outreach/ingest", requireIngestAuth, async (req, res) => {
    try {
      const { items, intent, minScore } = req.body ?? {};
      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: "No items." });
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({ error: "Drafting is not configured." });
      }
      const out = await draftBatch(
        items,
        ["reply", "connect", "dm"].includes(intent) ? intent : "reply",
        typeof minScore === "number" ? minScore : 2,
      );
      return res.json(out);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "ingest failed" });
    }
  });

  // ── POST /api/outreach/search ───────────────────────────────────────────
  //
  // Search LinkedIn without touching Anthony's account.
  //
  // LinkedIn's own API cannot do this. Sign-In and Share are the only
  // self-serve products; post search and third-party profiles sit behind
  // partner programmes that take months and are usually refused. So the search
  // runs through Apify, which operates its own infrastructure and does not use
  // his session or cookies. That is the real advantage over the extension: no
  // account of ours is involved, so there is nothing of his to restrict.
  //
  // It costs money — roughly $1.50 per thousand posts — which is why maxPosts
  // is capped and the query is required rather than defaulted. An accidental
  // unbounded run should not be possible from a UI click.
  app.post("/api/outreach/search", requireAdmin, async (req, res) => {
    try {
      const token = process.env.APIFY_TOKEN;
      if (!token) {
        return res.status(503).json({
          error: "LinkedIn search is not configured. Set APIFY_TOKEN.",
        });
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({ error: "Drafting is not configured." });
      }

      const { query, intent, maxPosts, postedLimit, sortBy, minScore } = req.body ?? {};
      const q = typeof query === "string" ? query.trim() : "";
      if (!q) return res.status(400).json({ error: "Give it something to search for." });

      const cap = Math.min(Math.max(Number(maxPosts) || 50, 1), 200);
      const kind: Intent = ["reply", "connect", "dm"].includes(intent) ? intent : "reply";

      // Apify's sync endpoint returns the dataset directly, so there is no run
      // to poll. It gives up at 300s; we stop earlier so the admin console gets
      // an error rather than a hung request.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      let raw: unknown;
      try {
        const r = await fetch(
          `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              searchQueries: [q],
              maxPosts: cap,
              sortBy: sortBy === "relevance" ? "relevance" : "date",
              postedLimit: ["1h", "24h", "week", "month"].includes(postedLimit) ? postedLimit : "month",
            }),
          },
        );
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          return res.status(502).json({
            error: `LinkedIn search failed (${r.status}). ${body.slice(0, 200)}`,
          });
        }
        raw = await r.json();
      } catch (e) {
        const aborted = e instanceof Error && e.name === "AbortError";
        return res.status(504).json({
          error: aborted ? "LinkedIn search timed out." : "Could not reach the search provider.",
        });
      } finally {
        clearTimeout(timer);
      }

      const posts = Array.isArray(raw) ? raw : [];
      const items = posts.map(mapApifyPost).filter((x): x is RawItem => x !== null);
      if (!items.length) {
        return res.json({ drafted: 0, considered: posts.length, relevant: 0, drafts: [], query: q });
      }

      const out = await draftBatch(items, kind, typeof minScore === "number" ? minScore : 2);
      return res.json({ ...out, query: q, fetched: posts.length });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "search failed" });
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
