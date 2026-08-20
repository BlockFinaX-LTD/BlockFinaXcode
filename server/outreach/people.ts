/**
 * people.ts — the list of individuals worth talking to.
 *
 * Built as a by-product of drafting rather than as a separate scrape. Every
 * post that clears the relevance bar was written by someone; that person is
 * recorded here along with what they were seen writing about.
 *
 * The result is a list of people who have publicly said something about
 * currency risk — which qualifies them far better than a title filter would.
 * "CFO at a Lagos manufacturer" is a guess that they care about FX. "Posted
 * about dollar shortages three times this month" is evidence. And it
 * accumulates on its own: the more Anthony uses the tool for drafting, the
 * better the list gets, with nobody maintaining it.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { outreachPeople } from "@shared/schema";
import { matchedTopics } from "../routes/outreach-relevance";

export interface Sighting {
  profileUrl: string;
  name?: string | null;
  headline?: string | null;
  postText: string;
  postUrl?: string | null;
  score: number;
}

/**
 * Reduce a LinkedIn URL to the identity it names.
 *
 * Query strings on LinkedIn carry tracking that differs per view, so the same
 * account arrives with a different URL every time. Without normalising, the
 * list fills with duplicates of one person.
 *
 * Post permalinks are rejected outright. They identify an article rather than
 * an account, and storing one here would create a row nobody can act on and
 * that can never be merged with the real account when it turns up properly.
 */
export function normaliseProfileUrl(raw: string): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;

  // People and company pages both count. The first real scan surfaced
  // MarketForces Africa, TopStories Nigeria and The Journal Nigeria alongside
  // named individuals, and an outreach list that silently drops every
  // publication is missing the accounts that actually drive these threads.
  const person = u.pathname.match(/\/in\/([^/]+)/i);
  if (person) {
    const slug = decodeURIComponent(person[1]).toLowerCase().replace(/\/+$/, "");
    return slug ? `https://www.linkedin.com/in/${slug}` : null;
  }
  const company = u.pathname.match(/\/company\/([^/]+)/i);
  if (company) {
    const slug = decodeURIComponent(company[1]).toLowerCase().replace(/\/+$/, "");
    return slug ? `https://www.linkedin.com/company/${slug}` : null;
  }
  return null;
}

/** Company is often the tail of a headline: "CFO at Acme Foods". */
function companyFrom(headline?: string | null): string | null {
  if (!headline) return null;
  const m = headline.match(/\bat\s+(.{2,60})$/i);
  return m ? m[1].trim().replace(/[.,;]+$/, "") : null;
}

const mergeTopics = (existing: string | null, fresh: string[]): string => {
  const set = new Set(
    (existing || "").split(",").map(t => t.trim()).filter(Boolean).concat(fresh),
  );
  return Array.from(set).slice(0, 12).join(",");
};

/**
 * Record that someone was seen writing something relevant.
 *
 * Upsert on the profile URL. Counters accumulate and the best score is kept
 * rather than the latest, because one genuinely sharp post about FX says more
 * about a person than a run of passing mentions.
 *
 * `status` is deliberately never touched on update. Anthony marks someone
 * "contacted" or "ignored"; seeing them post again must not quietly reset that,
 * or the list would keep re-offering people he has already decided about.
 */
export async function notePerson(s: Sighting): Promise<void> {
  const url = normaliseProfileUrl(s.profileUrl);
  if (!url) return;

  const topics = matchedTopics(s.postText);
  const name = s.name?.trim() || null;
  const headline = s.headline?.trim() || null;
  const company = companyFrom(headline);
  const snippet = s.postText.trim().slice(0, 1200);

  try {
    await db.insert(outreachPeople).values({
      profileUrl: url,
      name,
      headline,
      company,
      topics: topics.join(","),
      postsSeen: 1,
      topScore: s.score,
      lastPostText: snippet,
      lastPostUrl: s.postUrl?.trim() || null,
      status: "new",
    }).onConflictDoUpdate({
      target: outreachPeople.profileUrl,
      set: {
        // COALESCE on the new value: a later sighting that happens to be missing
        // a name must not erase one we already had.
        name: sql`coalesce(${name}, ${outreachPeople.name})`,
        headline: sql`coalesce(${headline}, ${outreachPeople.headline})`,
        company: sql`coalesce(${company}, ${outreachPeople.company})`,
        topics: sql`${mergeTopics(null, topics)}`,
        postsSeen: sql`${outreachPeople.postsSeen} + 1`,
        topScore: sql`greatest(${outreachPeople.topScore}, ${s.score})`,
        lastPostText: snippet,
        lastPostUrl: s.postUrl?.trim() || null,
        lastSeen: new Date(),
      },
    });
  } catch {
    /* the list is a by-product; failing to record someone must not lose a draft */
  }

  // Topic merging needs the row that is already there, which the upsert above
  // cannot see. Done as a second statement so the accumulated set survives:
  // a person who posts about trade and later about hedging should carry both.
  try {
    await db.execute(sql`
      update outreach_people
      set topics = (
        select string_agg(distinct t, ',')
        from unnest(string_to_array(coalesce(topics, '') || ',' || ${topics.join(",")}, ',')) as t
        where t <> ''
      )
      where profile_url = ${url}
    `);
  } catch {
    /* cosmetic; the row is already saved */
  }
}
