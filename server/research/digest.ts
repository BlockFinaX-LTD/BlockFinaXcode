/**
 * digest.ts, turning a morning's feeds into something worth ten minutes.
 *
 * ## Why the links are the cheap part
 *
 * Eleven feeds return well over two hundred items a day. A list of two hundred
 * headlines is not research, it is a second inbox, and the reliable outcome of
 * a second inbox is that nobody opens it.
 *
 * What makes an item worth reading is why it matters to this business
 * specifically, and no feed supplies that. So the expensive step, a model
 * writing one or two sentences on what changed and what it means for the book,
 * is the whole point rather than an enhancement.
 *
 * ## Why there is a cheap filter in front of the expensive one
 *
 * Most of what these feeds carry is not about currency: Ghanaian local news,
 * equity fund tables, football. Running a model call over all of it would cost
 * more than the reading is worth. The keyword scorer already built for LinkedIn
 * posts does the same job here, and only what survives it is worth a call.
 */

import Anthropic from "@anthropic-ai/sdk";
import { desc, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { researchItems } from "@shared/schema";
import { relevanceScore } from "../routes/outreach-relevance";
import { FEEDS, fetchFeed, type FeedItem } from "./feeds";

export interface DigestResult {
  fetched: number;
  fresh: number;
  scored: number;
  briefed: number;
  errors: string[];
}

const SYSTEM = `You brief Anthony Kumako each morning. He runs BlockFinaX, which
helps businesses in Ghana, Nigeria, Kenya and South Africa protect themselves
against currency volatility. Underwriters put up capital and earn the premium;
businesses pay for protection against a move past an agreed level.

He has ten minutes. Your job is to say why an item is worth some of them.

Write one or two sentences saying what actually changed and what it means for
this business. Not a summary of the article: he can read the article. The
question is what a person running an FX cover book should do differently, watch,
or think about because of it.

Good: "The CBN raised the cash reserve ratio, which tightens naira liquidity and
usually widens the gap between official and parallel rates within weeks. That
gap is what our Nigerian pools price against."

Bad: "This article discusses Nigerian monetary policy and its effects on the
economy." That is a description, and it tells him nothing he could act on.

Score importance 0 to 100, honestly. Most things are under 30. Reserve above 70
for something that would change a decision this week: a policy move in a market
we cover, a currency regime change, a method that could improve how cover is
priced. A funding round at an unrelated startup is a 5 even if the headline is
exciting.

If an item turns out not to matter to this business at all, say so plainly in
the relevance line and score it low. A briefing that finds everything important
is one nobody trusts twice.

No em dashes and no en dashes. Plain English, no jargon.`;

const SCHEMA = {
  name: "brief",
  description: "Say why each item matters, and how much.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            relevance: { type: "string" },
            importance: { type: "integer", minimum: 0, maximum: 100 },
          },
          required: ["index", "relevance", "importance"],
        },
      },
    },
    required: ["items"],
  },
};

/** Feed weight nudges the score, so a working paper outranks a wire story that matched the same words. */
function scoreItem(it: FeedItem): number {
  const text = `${it.title} ${it.summary ?? ""}`;
  return relevanceScore(text) + it.weight;
}

export async function buildDigest(apiKey: string, model: string): Promise<DigestResult> {
  const errors: string[] = [];

  // Fetch every feed at once. They are independent and each can take seconds.
  const batches = await Promise.all(
    FEEDS.map(async f => {
      const items = await fetchFeed(f);
      if (!items.length) errors.push(`${f.name} returned nothing`);
      return items;
    }),
  );
  const all = batches.flat();

  // Drop what is already stored. Wire stories appear in several feeds at once,
  // and the same piece briefed twice reads as the tool repeating itself.
  const urls = Array.from(new Set(all.map(i => i.url)));
  let known = new Set<string>();
  try {
    if (urls.length) {
      const rows = await db.select({ url: researchItems.url }).from(researchItems)
        .where(inArray(researchItems.url, urls));
      known = new Set(rows.map(r => r.url));
    }
  } catch {
    errors.push("could not read what was already collected");
  }

  const seen = new Set<string>();
  const fresh = all.filter(i => {
    if (known.has(i.url) || seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });

  // Everything is stored, scored or not, so nothing is fetched twice tomorrow.
  for (const it of fresh) {
    try {
      await db.insert(researchItems).values({
        title: it.title.slice(0, 500),
        url: it.url,
        source: it.source,
        kind: it.kind,
        summary: it.summary,
        publishedAt: it.publishedAt,
        score: scoreItem(it),
      }).onConflictDoNothing({ target: researchItems.url });
    } catch {
      /* one bad row must not lose the batch */
    }
  }

  // Only what cleared the keyword bar earns a model call, best first.
  const candidates = fresh
    .map(it => ({ it, score: scoreItem(it) }))
    .filter(x => x.score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);

  if (!candidates.length) {
    return { fetched: all.length, fresh: fresh.length, scored: 0, briefed: 0, errors };
  }

  let briefed = 0;
  try {
    const client = new Anthropic({ apiKey });
    const listing = candidates.map((c, i) =>
      `[${i}] ${c.it.source}: ${c.it.title}\n${(c.it.summary ?? "").slice(0, 400)}`,
    ).join("\n\n");

    const msg = await client.messages.create({
      model,
      max_tokens: 3000,
      system: SYSTEM,
      tools: [SCHEMA],
      tool_choice: { type: "tool", name: "brief" },
      messages: [{ role: "user", content: `Today's candidates:\n\n${listing}` }],
    });

    const call = msg.content.find(b => b.type === "tool_use");
    const out = call && call.type === "tool_use" ? (call.input as any)?.items : null;

    for (const r of Array.isArray(out) ? out : []) {
      const c = candidates[Number(r?.index)];
      if (!c) continue;
      const relevance = typeof r?.relevance === "string" ? r.relevance.trim() : "";
      if (!relevance) continue;
      await db.update(researchItems).set({
        relevance,
        importance: Math.max(0, Math.min(100, Math.round(Number(r?.importance) || 0))),
      }).where(sql`${researchItems.url} = ${c.it.url}`);
      briefed++;
    }
  } catch (e) {
    errors.push(`briefing failed: ${e instanceof Error ? e.message : "unknown"}`);
  }

  return { fetched: all.length, fresh: fresh.length, scored: candidates.length, briefed, errors };
}
