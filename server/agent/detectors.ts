/**
 * Detectors — finding things worth acting on.
 *
 * Deliberately split: **SQL decides what is true, the model decides what to
 * say.** Whether a letter has gone unread for seven days has a correct answer,
 * and a language model is the wrong instrument for it — slower, costlier, and
 * occasionally wrong about a fact that is sitting in a column. So each detector
 * is a plain query, and the model is only asked to write the words.
 *
 * Two rules keep the queue trustworthy:
 *
 *  - **One open proposal per thing.** A scan every few hours would otherwise
 *    pile up five identical follow-ups for the same letter.
 *  - **A rejection is respected.** Saying no to a nudge and having it
 *    reappear tomorrow is how a queue becomes noise. Rejected sources are
 *    suppressed for a cooling-off period.
 */

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { agentProposals, agentSettings, agentDecisions } from "@shared/agent-schema";
import { loiDocuments } from "@shared/loi-schema";
import { hedgeActivity, hedgeEvents } from "@shared/schema";
import { runAgent, fence } from "./runtime";

const SETTINGS_KEY = "thresholds";

export interface Thresholds {
  /** Days of silence before nudging an unopened letter. */
  followupDays: number;
  /** Days before expiry to send a reminder. */
  reminderDays: number;
  /** Days a change request may sit unresolved. */
  staleChangesDays: number;
  /** Cover-to-liquidity ratio above which a pool is flagged. */
  liquidityRatio: number;
  /** Days a rejected source stays suppressed. */
  rejectionCooldownDays: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  followupDays: 7,
  reminderDays: 3,
  staleChangesDays: 4,
  liquidityRatio: 1.0,
  rejectionCooldownDays: 14,
};

export async function getThresholds(): Promise<Thresholds> {
  try {
    const [row] = await db.select().from(agentSettings).where(eq(agentSettings.key, SETTINGS_KEY)).limit(1);
    return row ? { ...DEFAULT_THRESHOLDS, ...JSON.parse(row.value) } : { ...DEFAULT_THRESHOLDS };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export async function setThresholds(patch: Partial<Thresholds>): Promise<Thresholds> {
  const next = { ...(await getThresholds()), ...patch };
  const value = JSON.stringify(next);
  await db
    .insert(agentSettings)
    .values({ key: SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: agentSettings.key, set: { value, updatedAt: new Date() } });
  return next;
}

const days = (d: Date | string | null | undefined): number =>
  d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : Infinity;

const daysUntil = (d: Date | string | null | undefined): number =>
  d ? Math.floor((new Date(d).getTime() - Date.now()) / 86_400_000) : Infinity;

// ── Candidates ───────────────────────────────────────────────────────────

interface Candidate {
  kind: string;
  title: string;
  rationale: string;
  sourceType: string;
  sourceId: number;
  priority?: "low" | "normal" | "high";
  /** Everything the model needs to draft. Counterparty names included — see
   *  docs/agent-design.md §14; a follow-up addressed to nobody is useless. */
  context: Record<string, unknown>;
}

/** Letters sent a while ago and never opened. */
async function findUnopenedLetters(t: Thresholds): Promise<Candidate[]> {
  const rows = await db
    .select()
    .from(loiDocuments)
    .where(and(eq(loiDocuments.status, "sent"), isNull(loiDocuments.firstViewedAt)));

  return rows
    .filter((r) => days(r.sentAt) >= t.followupDays)
    .map((r) => ({
      kind: "loi_followup",
      title: `Follow up with ${r.recipientCompany}`,
      rationale: `Sent ${days(r.sentAt)} days ago and still unopened. ${r.recipientName} may not have seen it.`,
      sourceType: "loi",
      sourceId: r.id,
      priority: days(r.sentAt) >= t.followupDays * 2 ? ("high" as const) : ("normal" as const),
      context: {
        counterparty: r.recipientCompany,
        contact: r.recipientName,
        contactPosition: r.recipientPosition,
        documentType: r.docType,
        relationship: r.relationshipType,
        daysSinceSent: days(r.sentAt),
        expiresInDays: daysUntil(r.expiresAt),
        senderName: r.senderName,
      },
    }));
}

/** Letters approaching expiry without a signature. */
async function findExpiringLetters(t: Thresholds): Promise<Candidate[]> {
  const rows = await db
    .select()
    .from(loiDocuments)
    .where(sql`${loiDocuments.status} IN ('sent','viewed','awaiting_signature')`);

  return rows
    .filter((r) => {
      const left = daysUntil(r.expiresAt);
      return left <= t.reminderDays && left >= 0;
    })
    .map((r) => ({
      kind: "loi_reminder",
      title: `${r.recipientCompany} — letter expires in ${daysUntil(r.expiresAt)} day(s)`,
      rationale: `Read but unsigned, and the signing window closes in ${daysUntil(r.expiresAt)} day(s).`,
      sourceType: "loi",
      sourceId: r.id,
      priority: "high" as const,
      context: {
        counterparty: r.recipientCompany,
        contact: r.recipientName,
        documentType: r.docType,
        daysUntilExpiry: daysUntil(r.expiresAt),
        hasViewed: !!r.firstViewedAt,
        senderName: r.senderName,
      },
    }));
}

/** Change requests sitting unanswered. */
async function findStaleChangeRequests(t: Thresholds): Promise<Candidate[]> {
  const rows = await db
    .select()
    .from(loiDocuments)
    .where(eq(loiDocuments.status, "changes_requested"));

  return rows
    .filter((r) => days(r.lastActivityAt) >= t.staleChangesDays)
    .map((r) => ({
      kind: "loi_stale_changes",
      title: `${r.recipientCompany} is waiting on your reply`,
      rationale: `They asked for changes ${days(r.lastActivityAt)} days ago and nothing has gone back.`,
      sourceType: "loi",
      sourceId: r.id,
      priority: "high" as const,
      context: {
        counterparty: r.recipientCompany,
        contact: r.recipientName,
        daysWaiting: days(r.lastActivityAt),
        senderName: r.senderName,
      },
    }));
}

/**
 * Pools where cover sold outweighs the liquidity backing it.
 *
 * Internal alert only — this one never drafts an outward message, because the
 * right response is a decision about capital, not an email.
 */
async function findThinPools(t: Thresholds): Promise<Candidate[]> {
  const pools = await db.select().from(hedgeEvents).where(eq(hedgeEvents.status, "open"));
  if (!pools.length) return [];

  const activity = await db.select().from(hedgeActivity);
  const out: Candidate[] = [];

  for (const p of pools) {
    if (p.onChainEventId == null) continue;
    const mine = activity.filter((a) => a.onChainEventId === p.onChainEventId && a.chainId === p.chainId);
    const cover = mine
      .filter((a) => a.actionType === "buy_protection")
      .reduce((s, a) => s + (parseFloat(a.amount ?? "0") || 0), 0);
    const liquidity = mine
      .filter((a) => a.actionType === "deposit")
      .reduce((s, a) => s + (parseFloat(a.amount ?? "0") || 0), 0);

    if (cover <= 0) continue;
    const maxPayout = cover * (parseFloat(p.payoutRate ?? "0") || 0);
    if (liquidity > 0 && maxPayout / liquidity < t.liquidityRatio) continue;

    out.push({
      kind: "pool_low_liquidity",
      title: `${p.underlying} pool may be under-collateralised`,
      rationale:
        `Cover sold is $${cover.toFixed(2)} with a maximum payout of $${maxPayout.toFixed(2)}, ` +
        `against $${liquidity.toFixed(2)} of deposited liquidity.`,
      sourceType: "pool",
      sourceId: p.id,
      priority: "high" as const,
      context: { pair: p.underlying, poolName: p.name, cover, maxPayout, liquidity, expiryDate: p.expiryDate },
    });
  }
  return out;
}

// ── Suppression ──────────────────────────────────────────────────────────

/**
 * Drops candidates that already have an open proposal, or whose source was
 * rejected recently. Without this a queue checked every few hours turns into
 * the same three items repeated until they're ignored.
 */
async function suppressKnown(candidates: Candidate[], t: Thresholds): Promise<Candidate[]> {
  if (!candidates.length) return [];

  const open = await db
    .select()
    .from(agentProposals)
    .where(eq(agentProposals.status, "proposed"));

  const recentlyRejected = await db
    .select({ proposalId: agentDecisions.proposalId, createdAt: agentDecisions.createdAt })
    .from(agentDecisions)
    .where(eq(agentDecisions.decision, "rejected"));

  const rejectedIds = recentlyRejected
    .filter((d) => days(d.createdAt) < t.rejectionCooldownDays)
    .map((d) => d.proposalId);

  const rejectedSources = rejectedIds.length
    ? await db.select().from(agentProposals).where(inArray(agentProposals.id, rejectedIds))
    : [];

  const key = (kind: string, type: string | null, id: number | null) => `${kind}:${type}:${id}`;
  const blocked = new Set([
    ...open.map((p) => key(p.kind, p.sourceType, p.sourceId)),
    ...rejectedSources.map((p) => key(p.kind, p.sourceType, p.sourceId)),
  ]);

  return candidates.filter((c) => !blocked.has(key(c.kind, c.sourceType, c.sourceId)));
}

// ── Drafting ─────────────────────────────────────────────────────────────

const DRAFT_INSTRUCTIONS: Record<string, string> = {
  loi_followup:
    "Write a short, warm follow-up email to the counterparty. They have not opened the letter, so assume it may " +
    "have been missed rather than ignored — no pressure, no guilt. Offer to walk through it on a call. " +
    "Two or three sentences.",
  loi_reminder:
    "Write a brief reminder that the signing window closes soon. State the deadline plainly, offer help if " +
    "anything is holding them up. Two or three sentences.",
  loi_stale_changes:
    "Write a short note acknowledging that they asked for changes and that a revision is coming. Do not promise " +
    "specific terms — you do not know what was decided. Two or three sentences.",
  pool_low_liquidity:
    "Write two sentences to Anthony, internal only, stating the exposure plainly and what the options are. " +
    "This is not going to a counterparty.",
};

/** Turns a candidate into a written draft. */
async function draft(c: Candidate): Promise<{ body: string; runId: number | null }> {
  const instruction = DRAFT_INSTRUCTIONS[c.kind] ?? "Write a short, useful message.";

  const res = await runAgent({
    scope: "internal",
    trigger: "schedule",
    maxTokens: 700,
    // No tools: everything needed is in the context below, and a drafting call
    // that goes exploring is a slower, costlier call for no gain.
    messages: [
      {
        role: "user",
        content:
          `${instruction}\n\nSituation: ${c.rationale}\n\n` +
          `${fence("business-record", JSON.stringify(c.context, null, 2))}\n\n` +
          `Sign off as ${c.context.senderName ?? "Anthony Kumako"} where the message goes to a counterparty. ` +
          `Reply with the message body only — no subject line, no preamble, no quotation marks.`,
      },
    ],
    systemExtra:
      "You are drafting a message for Anthony to review. He will read it before anything is sent, so write it " +
      "as the finished article rather than as options. Return the body text only.",
  });

  return { body: res.text.trim(), runId: res.runId };
}

// ── Scan ─────────────────────────────────────────────────────────────────

export interface ScanResult {
  found: number;
  suppressed: number;
  created: number;
  failed: number;
  byKind: Record<string, number>;
}

/**
 * Runs every detector, drafts what survives suppression, and queues it.
 *
 * A drafting failure drops that one candidate rather than the scan: one bad
 * response should not cost the other four proposals.
 */
export async function runScan(): Promise<ScanResult> {
  const t = await getThresholds();

  const found = [
    ...(await findUnopenedLetters(t)),
    ...(await findExpiringLetters(t)),
    ...(await findStaleChangeRequests(t)),
    ...(await findThinPools(t)),
  ];

  const fresh = await suppressKnown(found, t);
  const result: ScanResult = {
    found: found.length,
    suppressed: found.length - fresh.length,
    created: 0,
    failed: 0,
    byKind: {},
  };

  for (const c of fresh) {
    try {
      const { body, runId } = await draft(c);
      if (!body) { result.failed += 1; continue; }
      await db.insert(agentProposals).values({
        kind: c.kind,
        title: c.title,
        rationale: c.rationale,
        payload: { body, context: c.context },
        priority: c.priority ?? "normal",
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        runId,
      });
      result.created += 1;
      result.byKind[c.kind] = (result.byKind[c.kind] ?? 0) + 1;
    } catch (err: any) {
      console.error(`[agent:scan] drafting ${c.kind} for ${c.sourceType} ${c.sourceId} failed:`, err?.message);
      result.failed += 1;
    }
  }

  return result;
}

/** What the detectors would raise, without calling the model. Cheap and safe. */
export async function dryRun(): Promise<{ candidates: Omit<Candidate, "context">[]; suppressed: number }> {
  const t = await getThresholds();
  const found = [
    ...(await findUnopenedLetters(t)),
    ...(await findExpiringLetters(t)),
    ...(await findStaleChangeRequests(t)),
    ...(await findThinPools(t)),
  ];
  const fresh = await suppressKnown(found, t);
  return {
    candidates: fresh.map(({ context, ...rest }) => rest),
    suppressed: found.length - fresh.length,
  };
}
