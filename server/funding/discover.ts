/**
 * discover.ts — sweeping for funding BlockFinaX could actually apply to.
 *
 * Claude with web search, asked for real programmes, returning structured rows.
 * Everything it proposes lands at stage "candidate" and waits for a person.
 *
 * ## Why nothing is auto-accepted
 *
 * A model asked to find grants will always find grants. Some will be closed,
 * some will be for the wrong region, and some will not exist. This codebase
 * already refuses to let the agent state a figure it did not fetch, for exactly
 * that reason, and a fundraising pipeline is worse to pollute than a chat
 * answer: a fabricated deadline is something a founder plans a fortnight around.
 *
 * So the sweep proposes and a human disposes, and two mechanical filters run
 * before a human ever sees a row:
 *
 *   A URL is required, and it must resolve. A hallucinated programme almost
 *   always comes with a hallucinated link, and a link that 404s is the cheapest
 *   possible signal that the rest of the row is invented.
 *
 *   Anything already tracked is dropped, matched on URL and on name. Without
 *   it, every sweep re-proposes the same programmes and the queue becomes
 *   noise, including ones already marked "passed" that were deliberately
 *   rejected.
 */

import Anthropic from "@anthropic-ai/sdk";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import { fundingOpportunities, fundingNotes } from "@shared/schema";
import {
  PROFILE, DEFAULT_QUERIES, coerceKind, normName, normUrl, parseDeadline, clampFit,
} from "./spec";

export { DEFAULT_QUERIES };

const MODEL = (process.env.AGENT_MODEL || "claude-sonnet-5").trim();

export interface Candidate {
  name: string;
  funder?: string;
  kind: string;
  url: string;
  amountMin?: number;
  amountMax?: number;
  deadline?: string;
  rolling?: boolean;
  fit?: number;
  rationale?: string;
}

/**
 * Does the link actually go anywhere?
 *
 * HEAD first, falling back to GET, because plenty of sites refuse HEAD. A
 * timeout counts as unreachable rather than as a pass: the point is to catch
 * invented URLs, and treating "could not tell" as "fine" defeats it.
 */
async function urlResolves(url: string): Promise<boolean> {
  const attempt = async (method: "HEAD" | "GET") => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url, { method, redirect: "follow", signal: ctl.signal });
      return r.status < 400;
    } catch { return false; } finally { clearTimeout(t); }
  };
  if (!/^https?:\/\//i.test(url)) return false;
  return (await attempt("HEAD")) || (await attempt("GET"));
}

async function alreadyTracked(c: Candidate): Promise<boolean> {
  const rows = await db
    .select({ name: fundingOpportunities.name, url: fundingOpportunities.url })
    .from(fundingOpportunities);
  const nName = normName(c.name);
  const nUrl = normUrl(c.url || "");
  return rows.some((r) =>
    normName(r.name) === nName || (!!r.url && normUrl(r.url) === nUrl));
}

/**
 * Ask for candidates against one query.
 *
 * The model is told to return nothing rather than guess, which is the whole
 * point: an empty sweep is a fine outcome and a padded one is not.
 */
async function searchOnce(client: Anthropic, query: string): Promise<Candidate[]> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as any],
    messages: [{
      role: "user",
      content:
        `Search the web for real, currently open funding opportunities matching this company.\n\n` +
        `COMPANY:\n${PROFILE}\n\n` +
        `SEARCH: ${query}\n\n` +
        `Return ONLY a JSON array, no prose. Each item:\n` +
        `{"name","funder","kind":"grant|accelerator|vc|competition|other","url",` +
        `"amountMin","amountMax","deadline":"YYYY-MM-DD","rolling":true|false,` +
        `"fit":0-100,"rationale"}\n\n` +
        `Rules:\n` +
        `- Only programmes you actually found a page for. url must be that page.\n` +
        `- Omit anything whose applications have closed with no future round.\n` +
        `- If unsure of a deadline, omit the field rather than guessing.\n` +
        `- fit is how well it matches THIS company, not how prestigious it is.\n` +
        `- Return [] if you found nothing real. An empty result is correct and expected.`,
    }],
  });

  const text = res.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export interface SweepResult {
  queries: number;
  proposed: number;
  droppedUnreachable: number;
  droppedDuplicate: number;
  added: Array<{ id: number; name: string; url: string }>;
}

/**
 * Run a sweep and file whatever survives as candidates.
 *
 * Idempotent in the way that matters: running it twice adds nothing the second
 * time, because everything already tracked is dropped by name or URL.
 */
export async function sweep(args: { queries?: string[] } = {}): Promise<SweepResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set, so no sweep can run.");
  const client = new Anthropic({ apiKey: key });
  const queries = args.queries?.length ? args.queries : DEFAULT_QUERIES;

  const out: SweepResult = {
    queries: queries.length, proposed: 0, droppedUnreachable: 0, droppedDuplicate: 0, added: [],
  };

  for (const q of queries) {
    let found: Candidate[] = [];
    try { found = await searchOnce(client, q); }
    catch { continue; }  // One bad query must not end the sweep.

    for (const c of found) {
      if (!c?.name || !c?.url) continue;
      out.proposed++;

      if (await alreadyTracked(c)) { out.droppedDuplicate++; continue; }
      if (!(await urlResolves(c.url))) { out.droppedUnreachable++; continue; }

      const deadline = parseDeadline(c.deadline);

      const [row] = await db.insert(fundingOpportunities).values({
        name: c.name.slice(0, 200),
        funder: c.funder?.slice(0, 200) ?? null,
        kind: coerceKind(c.kind),
        url: c.url,
        amountMin: c.amountMin != null ? String(c.amountMin) : null,
        amountMax: c.amountMax != null ? String(c.amountMax) : null,
        deadline,
        rolling: c.rolling === true || (!deadline && c.rolling !== false),
        stage: "candidate",
        fit: clampFit(c.fit),
        rationale: c.rationale?.slice(0, 2000) ?? null,
        source: "search",
        sourceQuery: q,
      }).returning({ id: fundingOpportunities.id });

      await db.insert(fundingNotes).values({
        opportunityId: row.id,
        author: "sweep",
        body: `Proposed by a discovery sweep on the query "${q}". Link checked and reachable. Not reviewed by anyone yet.`,
      });

      out.added.push({ id: row.id, name: c.name, url: c.url });
    }
  }
  return out;
}
