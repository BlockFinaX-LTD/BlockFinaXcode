/**
 * memory.ts — the qualitative half of what Finax knows.
 *
 * The rate history says what a currency did. It cannot say why, and a comment
 * that cites a move without a mechanism reads as a bot with a calculator. This
 * module holds the other half — a central bank decision, an IMF tranche, a
 * paper worth citing — and hands the drafter the few entries that bear on the
 * post in front of it.
 *
 * ## Why facts are dated rather than merely stored
 *
 * "The Bank of Ghana holds at 27%" is worth saying in March and wrong by
 * September. A memory with no date is a liability: the model will quote it with
 * exactly the same confidence either way, and a founder's account is the wrong
 * place to discover that. So every entry carries an as-of date, retrieval
 * decays with age, and the prompt is told how old each fact is so it can write
 * "as of March" instead of implying it is today.
 *
 * ## Why retrieval is keyword overlap and not embeddings
 *
 * The corpus is tens of entries that Anthony curates by hand, not millions. At
 * that size term overlap is both adequate and inspectable — when the wrong fact
 * surfaces, the reason is visible in the tags rather than buried in a vector.
 * An embedding index would also need re-embedding on every edit, for a recall
 * gain that does not exist at this scale.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { marketMemory, type MarketMemory } from "@shared/schema";

/** Words too common to carry meaning; matching on them retrieves everything. */
const STOP = new Set([
  "the", "and", "for", "that", "with", "this", "from", "have", "has", "are", "was",
  "our", "their", "you", "your", "his", "her", "its", "but", "not", "all", "can",
  "will", "would", "been", "were", "they", "them", "what", "when", "which", "who",
  "how", "why", "more", "most", "some", "into", "out", "about", "just", "than",
  "then", "there", "here", "over", "under", "very", "much", "many", "also",
]);

const terms = (s: string): string[] =>
  (s.toLowerCase().match(/[a-z][a-z-]{2,}/g) || []).filter(w => !STOP.has(w));

const DAY = 86_400_000;

/**
 * Score one memory against a post.
 *
 * Tags are weighted above body text because they are the curator's own
 * statement of what a fact is for. Age applies a gentle decay rather than a
 * cutoff — a two-year-old structural fact about franc-zone pegs stays useful,
 * while a two-year-old rate decision should lose to last month's.
 */
function score(m: MarketMemory, postTerms: Set<string>, pairs: string[]): number {
  let s = 0;

  const tagList = (m.tags || "").toLowerCase().split(",").map(t => t.trim()).filter(Boolean);
  for (const t of tagList) {
    // A multi-word tag counts if the post contains any of its words.
    if (t.split(/\s+/).some(w => postTerms.has(w))) s += 4;
  }

  // Array.from rather than iterating the Set directly: the build targets ES5,
  // where for..of over a Set needs downlevelIteration.
  for (const w of Array.from(new Set(terms(`${m.title} ${m.body}`)))) {
    if (postTerms.has(w)) s += 1;
  }

  // A fact about the exact pair under discussion is almost always the right one.
  if (m.pair && pairs.includes(m.pair)) s += 8;

  if (s === 0) return 0;

  const ageDays = Math.max(0, (Date.now() - new Date(m.asOf).getTime()) / DAY);
  // Half-life of roughly a year: recent facts win ties, old ones still surface
  // when nothing newer is relevant.
  const recency = Math.pow(0.5, ageDays / 365);
  return s * (0.4 + 0.6 * recency);
}

function ageLabel(asOf: Date | string): string {
  const days = Math.floor((Date.now() - new Date(asOf).getTime()) / DAY);
  if (days <= 1) return "today";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

/**
 * The facts worth putting in front of the drafter for this post.
 *
 * Returns an empty string when nothing scores, and the prompt treats that as
 * permission to cite nothing. Forcing a marginally-related fact into a comment
 * is how a reply stops sounding like a person who knows the subject.
 */
export async function recallFor(text: string, pairs: string[], limit = 4): Promise<string> {
  let rows: MarketMemory[];
  try {
    rows = await db.select().from(marketMemory)
      .where(eq(marketMemory.active, true))
      .orderBy(desc(marketMemory.asOf))
      .limit(400);
  } catch {
    return "";
  }
  if (!rows.length) return "";

  const postTerms = new Set(terms(text));
  const ranked = rows
    .map(m => ({ m, s: score(m, postTerms, pairs) }))
    .filter(x => x.s >= 4)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);

  if (!ranked.length) return "";

  return ranked.map(({ m }) => {
    const src = [m.sourceName, m.sourceUrl].filter(Boolean).join(" ");
    return (
      `- [${m.kind}, ${ageLabel(m.asOf)}] ${m.title}\n` +
      `  ${m.body.trim()}` +
      (src ? `\n  source: ${src}` : "")
    );
  }).join("\n");
}

/** Everything, newest first — for the console list. */
export async function listMemory(includeInactive = false): Promise<MarketMemory[]> {
  const base = db.select().from(marketMemory);
  const rows = includeInactive
    ? await base.orderBy(desc(marketMemory.asOf)).limit(500)
    : await base.where(eq(marketMemory.active, true)).orderBy(desc(marketMemory.asOf)).limit(500);
  return rows;
}
