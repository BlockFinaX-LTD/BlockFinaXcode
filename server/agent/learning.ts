/**
 * Learning from feedback.
 *
 * Not reinforcement learning in the technical sense — no weights are updated.
 * At one founder's decision volume that would need a year of data to produce
 * anything, and the result would be uninspectable.
 *
 * What happens instead:
 *
 *   approve / reject / edit  →  agent_decisions  →  extracted rules  →  prompt
 *
 * The strongest signal is an edit. The diff between what the agent wrote and
 * what Anthony actually sent is a specific, concrete lesson — far richer than
 * a thumbs-down. Rejections matter nearly as much: a proposal kind rejected
 * nine times out of ten means the detector is wrong, not the wording.
 *
 * Extracted rules are plain English, stored in `agent_rules`, and editable in
 * the dashboard. That is the point of doing it this way: when the agent learns
 * something wrong you can read it and delete it, which is impossible with
 * weights.
 */

import { db } from "../db";
import { agentDecisions, agentRules, type AgentScope } from "@shared/agent-schema";
import { desc, eq, and } from "drizzle-orm";
import { runAgent } from "./runtime";

/** Below this there isn't enough signal to generalise from. */
const MIN_DECISIONS = 6;
/** How much history each extraction considers. */
const WINDOW = 40;

export interface ExtractionResult {
  considered: number;
  added: string[];
  skipped: string;
}

/**
 * Reviews recent decisions and proposes durable preferences.
 *
 * Deliberately conservative: it is asked for rules only where the evidence
 * repeats, because a "rule" learned from a single edit is a coin flip that
 * then contaminates every future draft.
 */
export async function extractRules(scope: AgentScope = "internal"): Promise<ExtractionResult> {
  const decisions = await db
    .select()
    .from(agentDecisions)
    .orderBy(desc(agentDecisions.id))
    .limit(WINDOW);

  if (decisions.length < MIN_DECISIONS) {
    return {
      considered: decisions.length,
      added: [],
      skipped: `Needs at least ${MIN_DECISIONS} decisions to generalise from; there are ${decisions.length}.`,
    };
  }

  const existing = await db
    .select()
    .from(agentRules)
    .where(and(eq(agentRules.scope, scope), eq(agentRules.active, true)));

  // Edits carry the diff; rejections carry the reason. Both are useful, and
  // they teach different things, so both go in labelled.
  const transcript = decisions
    .map((d, i) => {
      const head = `[${i + 1}] ${d.kind} — ${d.decision}`;
      if (d.decision === "edited" && d.final) {
        return `${head}\nAGENT WROTE:\n${d.original}\nANTHONY SENT:\n${d.final}`;
      }
      if (d.decision === "rejected") {
        return `${head}\nAGENT WROTE:\n${d.original}${d.note ? `\nREASON GIVEN: ${d.note}` : ""}`;
      }
      return `${head} (approved unchanged)`;
    })
    .join("\n\n");

  const prompt = `Below are recent decisions Anthony made on drafts you produced. Work out what he consistently prefers.

${transcript}

${existing.length ? `Rules already recorded — do not repeat these:\n${existing.map((r) => `- ${r.rule}`).join("\n")}\n` : ""}
Return between zero and four NEW rules, as a JSON array of strings and nothing else.

A rule earns its place only if the evidence repeats across at least two decisions. One edit is a coincidence, not a preference. Write each rule as a specific instruction that would change a future draft — "keep follow-ups to two sentences" is useful; "write well" is not.

If nothing repeats often enough, return [].`;

  const res = await runAgent({
    scope: "internal",
    trigger: "manual",
    maxTokens: 1024,
    messages: [{ role: "user", content: prompt }],
    systemExtra:
      "You are reviewing your own past drafts to learn preferences. Respond with a JSON array of strings only — no prose, no code fence.",
  });

  let rules: string[] = [];
  try {
    const match = res.text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        rules = parsed.filter((r): r is string => typeof r === "string" && r.trim().length > 3).slice(0, 4);
      }
    }
  } catch {
    // A malformed reply means no rules this round, which is a fine outcome.
    return { considered: decisions.length, added: [], skipped: "Could not parse the extraction reply." };
  }

  const added: string[] = [];
  for (const rule of rules) {
    const clean = rule.trim().slice(0, 1000);
    // Cheap duplicate guard — the prompt already lists existing rules, but the
    // model can still paraphrase one back.
    if (existing.some((e) => e.rule.toLowerCase() === clean.toLowerCase())) continue;
    await db.insert(agentRules).values({
      scope,
      rule: clean,
      origin: "extracted",
      evidenceCount: decisions.length,
    });
    added.push(clean);
  }

  return { considered: decisions.length, added, skipped: added.length ? "" : "No new repeated preference found." };
}

/**
 * Records a decision. Called on every approve/reject so the training set
 * builds as a side effect of ordinary use, with nothing extra to remember.
 */
export async function recordDecision(args: {
  proposalId: number;
  kind: string;
  decision: "approved" | "rejected" | "edited";
  original: string;
  final?: string | null;
  note?: string | null;
  decidedBy?: string | null;
}): Promise<void> {
  await db.insert(agentDecisions).values({
    proposalId: args.proposalId,
    kind: args.kind,
    decision: args.decision,
    original: args.original.slice(0, 20_000),
    final: args.final ? args.final.slice(0, 20_000) : null,
    note: args.note ?? null,
    decidedBy: args.decidedBy ?? null,
  });
}

/** Approval rate per proposal kind — shows which detectors are earning their place. */
export async function decisionStats(): Promise<
  { kind: string; total: number; approved: number; edited: number; rejected: number; approvalRate: number }[]
> {
  const rows = await db.select().from(agentDecisions);
  const byKind = new Map<string, { total: number; approved: number; edited: number; rejected: number }>();
  for (const r of rows) {
    const e = byKind.get(r.kind) ?? { total: 0, approved: 0, edited: 0, rejected: 0 };
    e.total += 1;
    if (r.decision === "approved") e.approved += 1;
    else if (r.decision === "edited") e.edited += 1;
    else e.rejected += 1;
    byKind.set(r.kind, e);
  }
  const out: { kind: string; total: number; approved: number; edited: number; rejected: number; approvalRate: number }[] = [];
  byKind.forEach((v, kind) => {
    out.push({
      kind,
      ...v,
      // An edit still means it was worth sending, so it counts as a success.
      approvalRate: v.total ? Math.round(((v.approved + v.edited) / v.total) * 100) : 0,
    });
  });
  return out;
}
