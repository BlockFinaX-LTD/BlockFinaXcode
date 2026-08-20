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
import { outreachDrafts, outreachPeople, marketMemory } from "@shared/schema";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { requireAdmin } from "../middleware/admin-auth";
import { relevanceScore } from "./outreach-relevance";
import { briefForText, pairsMentioned, briefFor } from "../outreach/market-brief";
import { recallFor, listMemory } from "../outreach/memory";
import { notePerson } from "../outreach/people";

const MODEL = (process.env.AGENT_MODEL || "claude-sonnet-5").trim();

import { type Intent, INTENT_RULES, SYSTEM } from "../outreach/persona";
import { buildPrompt, type Candidate } from "../outreach/prompt";
import { searchLinkedIn, type RawItem } from "../outreach/provider";
import { runAutoScan, lastScanAt } from "../outreach/auto-scan";
import {
  loadAuth, saveAuth, clearAuth, isExpired, authorizeUrl, exchangeCode,
  redirectUri, activityUrnFrom, postComment,
} from "../outreach/linkedin";

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

/**
 * Filter a batch of candidate posts, draft for the survivors, save them.
 *
 * Shared by the extension (/ingest) and the search provider (/search) so both
 * paths apply the same relevance bar and the same dedupe. A post found twice by
 * two different routes should not produce two drafts.
 */


/**
 * Write one message. The single drafting path, shared by every route.
 *
 * There used to be two: /draft built its own prompt and draftBatch built
 * another. They drifted, as duplicated prompts always do, and the single-post
 * path ended up with no market data, no memory, no access to the comment
 * intent, and a line reading "Live BlockFinaX figures you may quote", which
 * produced exactly the sales copy it invited. One function now, so a change to
 * how Finax writes cannot reach one route and miss the other.
 *
 * ## Why the book is withheld from public writing
 *
 * The live pool figures go in only for a direct message or a connection note.
 * A stranger reading a message is entitled to know who is writing and why, so
 * naming the product there is honest. A public comment is different: the moment
 * our own activity is in the context window, the model reaches for it as
 * evidence, and "we have settled six pools on that basis" is a sales line
 * wearing an analyst's jacket.
 *
 * Withholding it is structural rather than instructional on purpose. An
 * instruction not to sell competes with tempting material sitting right there
 * in the prompt, and loses often enough to matter. Removing the material wins
 * every time.
 */
async function writeDraft(
  client: Anthropic,
  c: Candidate,
  kind: Intent,
): Promise<string | null> {
  const pairs = pairsMentioned(c.text);
  const [brief, recalled] = await Promise.all([
    briefForText(c.text).catch(() => ""),
    recallFor(c.text, pairs).catch(() => ""),
  ]);

  // The book is fetched only when the message is private. See buildPrompt.
  const context = kind === "dm" || kind === "connect"
    ? await liveContext().catch(() => "")
    : "";

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(c, kind, brief, recalled, context) }],
  });
  const out = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text).join("").trim();
  return out || null;
}

export async function draftBatch(
  items: RawItem[],
  kind: Intent,
  threshold: number,
): Promise<{ drafted: number; considered: number; relevant: number; drafts: unknown[] }> {
  const seen = new Set(
    (await db.select({ url: outreachDrafts.sourceUrl }).from(outreachDrafts))
      .map(r => (r.url || "").trim())
      .filter(Boolean),
  );

  const candidates: Candidate[] = [];

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
      postedAt: typeof it?.postedAt === "string" ? it.postedAt : null,
      profileUrl: typeof it?.profileUrl === "string" ? it.profileUrl : null,
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
  const created: unknown[] = [];

  for (const c of chosen) {
    try {
      const draft = await writeDraft(client, c, kind);
      if (!draft) continue;
      const [row] = await db.insert(outreachDrafts).values({
        sourceUrl: c.url,
        sourceText: c.text,
        personName: c.name,
        personHeadline: c.headline,
        intent: kind,
        draft,
        originalDraft: draft,
        postedAt: c.postedAt ? new Date(c.postedAt) : null,
      }).returning();
      created.push(row);

      // The list of individuals is a by-product of drafting: anyone whose post
      // was worth answering is worth remembering.
      // The author's own page, not the post link. These were the same field
      // once, and since the provider returns a post permalink for nearly every
      // result, the People list could never fill.
      const who = c.profileUrl || c.url;
      if (who) {
        await notePerson({
          profileUrl: who,
          name: c.name,
          headline: c.headline,
          postText: c.text,
          postUrl: c.url,
          score: c.score,
        });
      }
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
      const kind: Intent = ["reply", "comment", "connect", "dm"].includes(intent) ? intent : "reply";

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Drafting is not configured (ANTHROPIC_API_KEY)." });

      // Same writer as every other route. A pasted post skips the relevance
      // filter, because Anthony choosing to paste it is the judgement the filter
      // exists to approximate.
      const client = new Anthropic({ apiKey });
      const draft = await writeDraft(client, {
        text: sourceText.trim(),
        url: typeof sourceUrl === "string" && sourceUrl.trim() ? sourceUrl.trim() : null,
        name: personName?.trim() || null,
        headline: personHeadline?.trim() || null,
        score: relevanceScore(sourceText),
      }, kind);
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
      if (!token) return res.status(503).json({ error: "LinkedIn search is not configured. Set APIFY_TOKEN." });
      if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "Drafting is not configured." });

      const { query, intent, maxPosts, postedLimit, sortBy, minScore } = req.body ?? {};
      const q = typeof query === "string" ? query.trim() : "";
      if (!q) return res.status(400).json({ error: "Give it something to search for." });

      const kind: Intent = ["reply", "comment", "connect", "dm"].includes(intent) ? intent : "comment";
      const found = await searchLinkedIn(token, q, { maxPosts, postedLimit, sortBy });
      if (found.error) return res.status(502).json({ error: `LinkedIn search failed: ${found.error}` });
      if (!found.items.length) {
        return res.json({ drafted: 0, considered: found.fetched, relevant: 0, drafts: [], query: q, fetched: found.fetched });
      }

      const out = await draftBatch(found.items, kind, typeof minScore === "number" ? minScore : 2);
      return res.json({ ...out, query: q, fetched: found.fetched });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "search failed" });
    }
  });

  // ── POST /api/outreach/auto ─────────────────────────────────────────────
  //
  // Scan without being told what to look for.
  //
  // The planner reads what the currencies have actually done and decides which
  // angles are worth hunting today. That is the judgement a senior marketer
  // makes, and the search box was quietly leaving it to Anthony. A fixed
  // keyword list would hunt the same ground forever; the interesting angle
  // moves with the market.
  //
  // The searches run in parallel because they are independent and each provider
  // call can take most of a minute. Four in sequence would push the request
  // past any sensible timeout for no reason.
  //
  // The plan comes back with the drafts so the reasoning is auditable. A scan
  // that spends money should be able to say what it spent it on.
  app.post("/api/outreach/auto", requireAdmin, async (req: any, res) => {
    try {
      const apifyToken = process.env.APIFY_TOKEN;
      if (!apifyToken) return res.status(503).json({ error: "LinkedIn search is not configured. Set APIFY_TOKEN." });
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Drafting is not configured." });

      const { intent, postedLimit, perQuery, minScore } = req.body ?? {};
      const result = await runAutoScan({
        apifyToken,
        apiKey,
        model: MODEL,
        intent: ["reply", "comment", "connect", "dm"].includes(intent) ? intent : "comment",
        perQuery,
        postedLimit,
        minScore,
        draft: draftBatch,
        by: req.adminEmail || "console",
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "scan failed" });
    }
  });

  // ── GET /api/outreach/schedule ──────────────────────────────────────────
  //
  // When the automatic scan last ran and when it runs next, so the console can
  // say so rather than leaving Anthony to guess whether it is working.
  app.get("/api/outreach/schedule", requireAdmin, async (_req, res) => {
    try {
      const last = await lastScanAt();
      const intervalMs = 5 * 60 * 60 * 1000;
      return res.json({
        lastScanAt: last ? last.toISOString() : null,
        nextScanAt: last ? new Date(last.getTime() + intervalMs).toISOString() : null,
        intervalHours: 5,
        configured: !!(process.env.APIFY_TOKEN && process.env.ANTHROPIC_API_KEY),
      });
    } catch {
      return res.json({ lastScanAt: null, nextScanAt: null, intervalHours: 5, configured: false });
    }
  });


  /* ── LinkedIn account, for sending ────────────────────────────────────────
   *
   * Discovery and sending reach LinkedIn by completely different routes, and
   * that is not an accident. Reading third-party posts has no sanctioned path,
   * so it goes through a provider. Writing does have one, so it goes through
   * LinkedIn's own API on a token Anthony granted through their consent screen.
   * Nothing here pretends to be a person using a browser.
   */

  // A short-lived nonce tying the LinkedIn redirect back to the admin who
  // started it. The callback arrives as a plain browser navigation with no
  // admin header on it, so without this anyone who guessed the URL could bind
  // their own LinkedIn account to Anthony's console.
  const oauthStates = new Map<string, { email: string; expires: number }>();

  app.get("/api/outreach/linkedin/status", requireAdmin, async (_req, res) => {
    try {
      const auth = await loadAuth();
      return res.json({
        connected: !!auth && !isExpired(auth),
        configured: !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
        name: auth?.name ?? null,
        expiresAt: auth ? new Date(auth.expiresAt).toISOString() : null,
        expired: auth ? isExpired(auth) : false,
        redirectUri: redirectUri(),
      });
    } catch {
      return res.json({ connected: false, configured: false, name: null, expiresAt: null, expired: false });
    }
  });

  app.post("/api/outreach/linkedin/connect", requireAdmin, async (req: any, res) => {
    if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
      return res.status(503).json({ error: "Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET first." });
    }
    const state = randomBytes(24).toString("hex");
    oauthStates.set(state, { email: req.adminEmail || "unknown", expires: Date.now() + 10 * 60_000 });
    oauthStates.forEach((v, k) => { if (Date.now() > v.expires) oauthStates.delete(k); });
    return res.json({ url: authorizeUrl(state) });
  });

  // Not behind requireAdmin: LinkedIn sends the browser here, and a redirect
  // carries no header. The state nonce is what authenticates it.
  app.get("/api/outreach/linkedin/callback", async (req, res) => {
    const done = (msg: string, ok: boolean) =>
      res.redirect(`/admin?linkedin=${ok ? "connected" : "failed"}&message=${encodeURIComponent(msg)}`);
    try {
      const { code, state, error, error_description } = req.query as Record<string, string>;
      if (error) return done(error_description || error, false);
      const pending = state ? oauthStates.get(state) : undefined;
      if (!pending || Date.now() > pending.expires) {
        return done("That link expired. Start again from the console.", false);
      }
      oauthStates.delete(state);
      if (!code) return done("LinkedIn did not return a code.", false);

      const auth = await exchangeCode(code);
      auth.connectedBy = pending.email;
      await saveAuth(auth, pending.email);
      return done(`Connected as ${auth.name || "your LinkedIn account"}.`, true);
    } catch (err) {
      return done(err instanceof Error ? err.message : "Could not connect.", false);
    }
  });

  app.post("/api/outreach/linkedin/disconnect", requireAdmin, async (_req, res) => {
    try {
      await clearAuth();
      return res.json({ connected: false });
    } catch {
      return res.status(500).json({ error: "Could not disconnect." });
    }
  });

  // ── POST /api/outreach/:id/post ─────────────────────────────────────────
  //
  // Publish one draft, as a comment, under Anthony's own name.
  //
  // One draft per call, never a batch. That is the safer pattern with LinkedIn,
  // and the honest one: something posted in a founder's name should be
  // something he decided to post, one at a time, having read it.
  //
  // The draft text is read from the database rather than taken from the request
  // body, so what gets published is the version sitting in the console. A body
  // field would let the two diverge, and the record of what was sent would stop
  // matching what was actually sent.
  app.post("/api/outreach/:id/post", requireAdmin, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });

      const auth = await loadAuth();
      if (!auth) return res.status(503).json({ error: "No LinkedIn account connected." });
      if (isExpired(auth)) return res.status(401).json({ error: "The LinkedIn connection expired. Reconnect it." });

      const [row] = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, id)).limit(1);
      if (!row) return res.status(404).json({ error: "not found" });
      if (row.commentUrn) {
        return res.status(409).json({ error: "This was already posted.", commentUrn: row.commentUrn });
      }
      if (row.intent !== "comment" && row.intent !== "reply") {
        return res.status(400).json({
          error: "Only comments and replies can be posted. A connection note or direct message has to be sent by hand.",
        });
      }

      const urn = activityUrnFrom(row.sourceUrl);
      if (!urn) {
        return res.status(400).json({
          error: "No post to comment on. This draft has a profile link rather than a post link.",
        });
      }

      const out = await postComment(auth, urn, row.draft);
      if (!out.ok) return res.status(out.retryable ? 503 : 502).json({ error: out.error });

      const [updated] = await db.update(outreachDrafts)
        .set({ status: "sent", sentAt: new Date(), commentUrn: out.commentUrn ?? out.commentId ?? "posted" })
        .where(eq(outreachDrafts.id, id))
        .returning();
      return res.json({ posted: true, commentUrn: out.commentUrn, draft: updated });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Could not post that." });
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

  // ── GET /api/outreach/people ────────────────────────────────────────────
  //
  // The list, built as a by-product of drafting. Ordered by best score then
  // most recently seen, so the people who write the sharpest things about
  // currency risk sit at the top rather than whoever posted last.
  app.get("/api/outreach/people", requireAdmin, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const rows = await db.select().from(outreachPeople)
        .orderBy(desc(outreachPeople.topScore), desc(outreachPeople.lastSeen))
        .limit(500);
      const filtered = status && status !== "all"
        ? rows.filter(r => r.status === status)
        : rows;
      return res.json({
        people: filtered,
        counts: {
          all: rows.length,
          new: rows.filter(r => r.status === "new").length,
          contacted: rows.filter(r => r.status === "contacted").length,
          replied: rows.filter(r => r.status === "replied").length,
          ignored: rows.filter(r => r.status === "ignored").length,
        },
      });
    } catch {
      return res.json({ people: [], counts: { all: 0, new: 0, contacted: 0, replied: 0, ignored: 0 } });
    }
  });

  // ── PATCH /api/outreach/people/:id ──────────────────────────────────────
  app.patch("/api/outreach/people/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
      const { status, notes } = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (["new", "drafted", "contacted", "replied", "ignored"].includes(status)) patch.status = status;
      if (typeof notes === "string") patch.notes = notes;
      if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing to update" });
      const [row] = await db.update(outreachPeople).set(patch)
        .where(eq(outreachPeople.id, id)).returning();
      if (!row) return res.status(404).json({ error: "not found" });
      return res.json(row);
    } catch {
      return res.status(500).json({ error: "Could not update that person." });
    }
  });

  // ── GET /api/outreach/memory ────────────────────────────────────────────
  app.get("/api/outreach/memory", requireAdmin, async (req, res) => {
    try {
      const all = req.query.all === "1";
      return res.json({ memory: await listMemory(all) });
    } catch {
      return res.json({ memory: [] });
    }
  });

  // ── POST /api/outreach/memory ───────────────────────────────────────────
  //
  // Curated by hand. A fact with no as-of date is refused rather than defaulted
  // to today: the whole point of the store is that the drafter can say "as of
  // March" instead of implying the present tense, and a wrong date silently
  // destroys that.
  app.post("/api/outreach/memory", requireAdmin, async (req: any, res) => {
    try {
      const { kind, title, body, sourceName, sourceUrl, asOf, tags, pair } = req.body ?? {};
      const t = typeof title === "string" ? title.trim() : "";
      const b = typeof body === "string" ? body.trim() : "";
      if (t.length < 4) return res.status(400).json({ error: "Give it a title." });
      if (b.length < 20) return res.status(400).json({ error: "Give it a few sentences of substance." });
      const when = asOf ? new Date(asOf) : null;
      if (!when || Number.isNaN(when.getTime())) {
        return res.status(400).json({ error: "When was this true? A date is required." });
      }
      const [row] = await db.insert(marketMemory).values({
        kind: ["news", "policy", "research", "data", "insight"].includes(kind) ? kind : "news",
        title: t,
        body: b,
        sourceName: typeof sourceName === "string" ? sourceName.trim() || null : null,
        sourceUrl: typeof sourceUrl === "string" ? sourceUrl.trim() || null : null,
        asOf: when,
        tags: typeof tags === "string" ? tags.trim() || null : null,
        pair: typeof pair === "string" ? pair.trim().toUpperCase() || null : null,
        createdBy: req.adminEmail || null,
      }).returning();
      return res.json(row);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Could not save that." });
    }
  });

  // ── PATCH /api/outreach/memory/:id ──────────────────────────────────────
  //
  // Retiring a fact clears `active` rather than deleting the row, so a
  // superseded policy rate stays on the record instead of vanishing.
  app.patch("/api/outreach/memory/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
      const { active, title, body, tags, pair } = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (typeof active === "boolean") patch.active = active;
      if (typeof title === "string" && title.trim()) patch.title = title.trim();
      if (typeof body === "string" && body.trim()) patch.body = body.trim();
      if (typeof tags === "string") patch.tags = tags.trim() || null;
      if (typeof pair === "string") patch.pair = pair.trim().toUpperCase() || null;
      if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing to update" });
      const [row] = await db.update(marketMemory).set(patch)
        .where(eq(marketMemory.id, id)).returning();
      if (!row) return res.status(404).json({ error: "not found" });
      return res.json(row);
    } catch {
      return res.status(500).json({ error: "Could not update that." });
    }
  });

  // ── GET /api/outreach/brief ─────────────────────────────────────────────
  //
  // The computed market picture on its own, so Anthony can see exactly what the
  // drafter was given. When a comment cites a surprising number, this is where
  // he checks it before posting.
  app.get("/api/outreach/brief", requireAdmin, async (req, res) => {
    try {
      const pair = typeof req.query.pair === "string" ? req.query.pair.trim().toUpperCase() : "";
      if (pair) {
        const b = await briefFor(pair);
        return b ? res.json(b) : res.status(404).json({ error: `No history for ${pair}.` });
      }
      const wanted = ["USD/GHS", "USD/NGN", "USD/KES", "USD/ZAR"];
      const out = [];
      for (const p of wanted) {
        try { const b = await briefFor(p); if (b) out.push(b); } catch { /* skip */ }
      }
      return res.json({ briefs: out });
    } catch {
      return res.status(500).json({ error: "Could not build the brief." });
    }
  });
}
