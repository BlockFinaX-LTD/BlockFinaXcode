/**
 * pipeline.ts — reading and moving opportunities.
 *
 * The agent gets the read half of this and nothing else. Stage changes go
 * through the routes, driven by a person, because §3 of the agent design says
 * capability is the tool list rather than the prompt, and a surface that reads
 * text from website visitors should not be able to mark a grant submitted.
 */

import { and, asc, desc, eq, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { fundingOpportunities, fundingNotes } from "@shared/schema";

export { STAGES, CLOSED_STAGES, type Stage } from "./spec";
import { STAGES, CLOSED_STAGES, type Stage, daysToDeadline, parseDeadline } from "./spec";

const num = (v: unknown) => (v == null ? null : Number(v));

export interface OpportunityView {
  id: number;
  name: string;
  funder: string | null;
  kind: string;
  url: string | null;
  amountMin: number | null;
  amountMax: number | null;
  currency: string;
  deadline: Date | null;
  rolling: boolean;
  stage: string;
  fit: number | null;
  rationale: string | null;
  source: string;
  owner: string | null;
  /** Negative once the deadline has passed. Null when rolling or undated. */
  daysToDeadline: number | null;
}

function view(r: any): OpportunityView {
  const deadline = r.deadline ? new Date(r.deadline) : null;
  return {
    id: r.id, name: r.name, funder: r.funder, kind: r.kind, url: r.url,
    amountMin: num(r.amountMin), amountMax: num(r.amountMax), currency: r.currency,
    deadline, rolling: !!r.rolling, stage: r.stage, fit: r.fit,
    rationale: r.rationale, source: r.source, owner: r.owner,
    daysToDeadline: daysToDeadline(deadline),
  };
}

export async function listOpportunities(opts: { stage?: string; includeClosed?: boolean } = {}) {
  const rows = await db.select().from(fundingOpportunities);
  let out = rows.map(view);
  if (opts.stage) out = out.filter((o) => o.stage === opts.stage);
  else if (!opts.includeClosed) out = out.filter((o) => !CLOSED_STAGES.includes(o.stage as Stage));
  // Soonest real deadline first; undated and rolling after, by fit.
  return out.sort((a, b) => {
    if (a.deadline && b.deadline) return a.deadline.getTime() - b.deadline.getTime();
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return (b.fit ?? 0) - (a.fit ?? 0);
  });
}

/**
 * What is due soon and still open.
 *
 * Closed stages are excluded because a deadline on something already won or
 * deliberately passed is not a thing anybody needs reminding about.
 */
export async function deadlinesWithin(days: number) {
  const all = await listOpportunities();
  return all.filter((o) =>
    o.daysToDeadline !== null && o.daysToDeadline <= days && o.daysToDeadline >= 0);
}

/** Anything whose deadline has gone by while it was still being worked on. */
export async function missedDeadlines() {
  const all = await listOpportunities();
  return all.filter((o) => o.daysToDeadline !== null && o.daysToDeadline < 0);
}

export async function pipelineSummary() {
  const rows = await db.select().from(fundingOpportunities);
  const byStage: Record<string, number> = {};
  STAGES.forEach((s) => { byStage[s] = 0; });
  let liveMin = 0, liveMax = 0;

  rows.forEach((r) => {
    byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
    if (!CLOSED_STAGES.includes(r.stage as Stage)) {
      liveMin += Number(r.amountMin ?? 0);
      liveMax += Number(r.amountMax ?? 0);
    }
  });

  const won = rows.filter((r) => r.stage === "won");
  return {
    total: rows.length,
    byStage,
    awaitingReview: byStage.candidate ?? 0,
    liveRangeMin: liveMin,
    liveRangeMax: liveMax,
    wonCount: won.length,
    wonMin: won.reduce((a, r) => a + Number(r.amountMin ?? 0), 0),
    wonMax: won.reduce((a, r) => a + Number(r.amountMax ?? 0), 0),
  };
}

export async function notesFor(opportunityId: number) {
  return db.select().from(fundingNotes)
    .where(eq(fundingNotes.opportunityId, opportunityId))
    .orderBy(asc(fundingNotes.createdAt));
}

/* ── writes, for the routes only ─────────────────────────────────────────── */

export async function setStage(args: {
  id: number; stage: Stage; author?: string; note?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!STAGES.includes(args.stage)) return { ok: false, reason: "Unknown stage." };
  const [before] = await db.select().from(fundingOpportunities)
    .where(eq(fundingOpportunities.id, args.id)).limit(1);
  if (!before) return { ok: false, reason: "No such opportunity." };

  await db.update(fundingOpportunities)
    .set({
      stage: args.stage,
      updatedAt: new Date(),
      // Stamped the first time a person moves it off candidate, so "how long
      // did this sit unreviewed" stays answerable afterwards.
      decidedAt: before.stage === "candidate" && args.stage !== "candidate"
        ? new Date() : before.decidedAt,
    })
    .where(eq(fundingOpportunities.id, args.id));

  await db.insert(fundingNotes).values({
    opportunityId: args.id,
    author: args.author ?? null,
    body: args.note?.trim()
      ? `${before.stage} to ${args.stage}. ${args.note.trim()}`
      : `${before.stage} to ${args.stage}.`,
  });
  return { ok: true };
}

export async function addOpportunity(args: {
  name: string; funder?: string; kind?: string; url?: string;
  amountMin?: number; amountMax?: number; deadline?: string; rolling?: boolean;
  owner?: string; notes?: string; author?: string;
}): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
  if (!args.name?.trim()) return { ok: false, reason: "A name is required." };
  const deadline = parseDeadline(args.deadline);

  const [row] = await db.insert(fundingOpportunities).values({
    name: args.name.trim().slice(0, 200),
    funder: args.funder?.slice(0, 200) ?? null,
    kind: args.kind ?? "grant",
    url: args.url ?? null,
    amountMin: args.amountMin != null ? String(args.amountMin) : null,
    amountMax: args.amountMax != null ? String(args.amountMax) : null,
    deadline,
    rolling: args.rolling === true || !deadline,
    // Added by a person, so it skips the review queue it exists to protect.
    stage: "researching",
    source: "manual",
    owner: args.owner ?? null,
    notes: args.notes ?? null,
    decidedAt: new Date(),
  }).returning({ id: fundingOpportunities.id });

  await db.insert(fundingNotes).values({
    opportunityId: row.id, author: args.author ?? null, body: "Added by hand.",
  });
  return { ok: true, id: row.id };
}

export async function addNote(args: { id: number; body: string; author?: string }) {
  if (!args.body?.trim()) return { ok: false as const, reason: "Empty note." };
  await db.insert(fundingNotes).values({
    opportunityId: args.id, body: args.body.trim(), author: args.author ?? null,
  });
  await db.update(fundingOpportunities)
    .set({ updatedAt: new Date() })
    .where(eq(fundingOpportunities.id, args.id));
  return { ok: true as const };
}
