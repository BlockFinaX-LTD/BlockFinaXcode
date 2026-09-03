/**
 * recheck.ts — is it still open?
 *
 * A sweep checks a programme once, on the day it finds it. Deadlines then move,
 * rounds close, and pages go dead, and none of that announces itself. Without a
 * recheck the pipeline degrades quietly into a list of things that used to be
 * true, which is worse than an empty one because it looks maintained.
 *
 * Three levels of certainty, and they are kept apart rather than collapsed into
 * one "open" flag:
 *
 *   The link is dead. Mechanical, certain, no model involved.
 *   The deadline has gone by. Arithmetic against a date already stored.
 *   The page now says closed. Read by the model, so it is a signal and not a
 *   verdict; it is written as a note for a person rather than acted on.
 *
 * Nothing here changes a stage. A programme closing is news for whoever owns
 * it, not a reason for a background job to decide the application is abandoned.
 */

import Anthropic from "@anthropic-ai/sdk";
import { eq, ne, and, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { fundingOpportunities, fundingNotes } from "@shared/schema";
import { CLOSED_STAGES, parseDeadline, type Stage } from "./spec";

const MODEL = (process.env.AGENT_MODEL || "claude-sonnet-5").trim();

export interface RecheckFinding {
  id: number;
  name: string;
  url: string | null;
  /** dead-link, deadline-passed, page-says-closed, deadline-moved */
  issue: string;
  detail: string;
}

export interface RecheckResult {
  checked: number;
  findings: RecheckFinding[];
}

async function linkAlive(url: string): Promise<boolean> {
  const attempt = async (method: "HEAD" | "GET") => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url, { method, redirect: "follow", signal: ctl.signal });
      return r.status < 400;
    } catch { return false; } finally { clearTimeout(t); }
  };
  return (await attempt("HEAD")) || (await attempt("GET"));
}

/**
 * Ask the model to read the page and report status.
 *
 * Given the page rather than a search, so it answers about this programme
 * rather than about the topic. Told to say "unknown" freely, because a wrong
 * "closed" on something still open is the expensive error here: it is the one
 * that makes somebody stop working on a live application.
 */
async function readPage(client: Anthropic, url: string, name: string): Promise<{
  status: "open" | "closed" | "unknown";
  deadline: string | null;
  note: string;
}> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 } as any],
    messages: [{
      role: "user",
      content:
        `Read this funding programme page and report whether applications are open.\n\n` +
        `PROGRAMME: ${name}\nURL: ${url}\n\n` +
        `Return ONLY JSON: {"status":"open|closed|unknown","deadline":"YYYY-MM-DD or null","note":"one sentence"}\n\n` +
        `Say "unknown" whenever the page does not make it clear. A wrong "closed" ` +
        `stops someone working on a live application, so it is much worse than an ` +
        `honest "unknown". Only say "closed" if the page states it.`,
    }],
  });
  const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { status: "unknown", deadline: null, note: "Could not read the page." };
  try {
    const j = JSON.parse(m[0]);
    return {
      status: ["open", "closed"].includes(j.status) ? j.status : "unknown",
      deadline: typeof j.deadline === "string" ? j.deadline : null,
      note: typeof j.note === "string" ? j.note.slice(0, 400) : "",
    };
  } catch { return { status: "unknown", deadline: null, note: "Could not read the page." }; }
}

/**
 * Recheck everything still live.
 *
 * Closed stages are skipped: a grant already won, lost or passed on does not
 * need its page revisited, and checking them would spend money to learn nothing.
 *
 * `deep` turns on the page read. Without it the recheck is free and catches the
 * two certain cases; with it, it costs a model call per opportunity and also
 * catches a page that has quietly stopped accepting applications.
 */
export async function recheck(opts: { deep?: boolean } = {}): Promise<RecheckResult> {
  const rows = (await db.select().from(fundingOpportunities))
    .filter((r) => !CLOSED_STAGES.includes(r.stage as Stage));

  const findings: RecheckFinding[] = [];
  const client = opts.deep && process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  for (const r of rows) {
    const note = async (body: string) => {
      await db.insert(fundingNotes).values({ opportunityId: r.id, author: "recheck", body });
    };

    // 1. Certain: the deadline stored on the row has gone by.
    if (r.deadline && new Date(r.deadline).getTime() < Date.now() - 86400000) {
      findings.push({
        id: r.id, name: r.name, url: r.url,
        issue: "deadline-passed",
        detail: `Closed on ${new Date(r.deadline).toISOString().slice(0, 10)}, still marked ${r.stage}.`,
      });
    }

    // 2. Certain: the page is gone.
    if (r.url) {
      const alive = await linkAlive(r.url);
      if (!alive) {
        findings.push({
          id: r.id, name: r.name, url: r.url,
          issue: "dead-link", detail: "The programme page no longer loads.",
        });
        await note("Recheck: the programme page no longer loads.");
        continue;  // No point reading a page that is not there.
      }
    }

    // 3. A signal, not a verdict: what the page itself says.
    if (client && r.url) {
      const seen = await readPage(client, r.url, r.name).catch(() => null);
      if (!seen) continue;

      if (seen.status === "closed") {
        findings.push({
          id: r.id, name: r.name, url: r.url,
          issue: "page-says-closed",
          detail: seen.note || "The page says applications are closed.",
        });
        await note(`Recheck: the page says applications are closed. ${seen.note}`);
      }

      const fresh = parseDeadline(seen.deadline);
      const stored = r.deadline ? new Date(r.deadline) : null;
      if (fresh && (!stored || Math.abs(fresh.getTime() - stored.getTime()) > 86400000)) {
        // Written, because a moved deadline is the one change that is safe to
        // apply: it comes from the programme's own page and being wrong about
        // it in the other direction is what caused the missed-deadline banner.
        await db.update(fundingOpportunities)
          .set({ deadline: fresh, updatedAt: new Date() })
          .where(eq(fundingOpportunities.id, r.id));
        findings.push({
          id: r.id, name: r.name, url: r.url,
          issue: "deadline-moved",
          detail: `Deadline updated to ${seen.deadline}${stored ? ` from ${stored.toISOString().slice(0, 10)}` : ""}.`,
        });
        await note(`Recheck: deadline updated to ${seen.deadline}. ${seen.note}`);
      }
    }
  }

  return { checked: rows.length, findings };
}
