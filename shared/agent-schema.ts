/**
 * Mini-CEO agent — schema
 *
 * See docs/agent-design.md for the reasoning. The short version:
 *
 *  - The agent proposes; a human approves; execution reuses existing routes.
 *  - How much it does unattended is a per-capability dial, not a fixed policy.
 *  - Four actions are absent rather than disabled: sign, move money, change
 *    contract parameters, delete records. No tool exists for them.
 *  - Learning is from feedback, not weights: every approve/reject/edit is a
 *    labelled example, and the edit diff is the strongest signal there is.
 *    Extracted preferences live in `agent_rules` as readable, editable text —
 *    when it learns something wrong you can see it and delete it.
 */

import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index, real } from "drizzle-orm/pg-core";
import { z } from "zod";

// ── Vocabulary ────────────────────────────────────────────────────────────

/** Which agent a row belongs to. The two share code and nothing else. */
export const AGENT_SCOPES = ["internal", "public"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/**
 * Capabilities the autonomy dial applies to. Deliberately does NOT include
 * signing, payments, contract parameters or deletion — those have no tool, so
 * there is nothing to set.
 */
export const CAPABILITIES = [
  "answer_internal",
  "answer_public",
  "meeting_notes",
  "internal_alert",
  "draft_followup",
  "send_loi_reminder",
  "weekly_digest",
  "meeting_speech",
  "linkedin_post",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  answer_internal: "Answer questions (internal)",
  answer_public: "Answer questions (website)",
  meeting_notes: "Meeting notes & summaries",
  internal_alert: "Internal alerts",
  draft_followup: "Draft follow-up emails",
  send_loi_reminder: "Send letter reminders",
  weekly_digest: "Weekly digest",
  meeting_speech: "Speak in meetings",
  linkedin_post: "Post to LinkedIn company page",
};

export const AUTONOMY_LEVELS = ["off", "ask", "auto"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/**
 * Starting points. Read-only and inward-facing things run unattended; anything
 * that leaves the building starts at `ask` and graduates once trusted.
 */
export const DEFAULT_AUTONOMY: Record<Capability, AutonomyLevel> = {
  answer_internal: "auto",
  answer_public: "off", // enabled with the public agent in a later phase
  meeting_notes: "auto",
  internal_alert: "auto",
  draft_followup: "ask",
  send_loi_reminder: "ask",
  weekly_digest: "ask",
  meeting_speech: "off",
  linkedin_post: "off",
};

export const PROPOSAL_STATUSES = ["proposed", "approved", "rejected", "executed", "failed"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_KINDS = [
  "loi_followup",
  "loi_reminder",
  "loi_stale_changes",
  "pool_at_capacity",
  "weekly_digest",
  "linkedin_draft",
  "meeting_action",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  loi_followup: "Follow up on a letter",
  loi_reminder: "Send an expiry reminder",
  loi_stale_changes: "Respond to requested changes",
  pool_at_capacity: "Pool nearing capacity",
  weekly_digest: "Weekly digest",
  linkedin_draft: "LinkedIn draft",
  meeting_action: "Meeting action item",
};

// ── Tables ────────────────────────────────────────────────────────────────

/** The queue. One row per thing the agent thinks should happen. */
export const agentProposals = pgTable(
  "agent_proposals",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    /** Why it was raised. Shown before you approve — an unexplained proposal is unapprovable. */
    rationale: text("rationale").notNull().default(""),
    /** The draft itself: subject, body, target ids. Shape varies by kind. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Your version, when you change it before approving. The diff is the lesson. */
    editedPayload: jsonb("edited_payload").$type<Record<string, unknown>>(),

    status: text("status").notNull().default("proposed"),
    priority: text("priority").notNull().default("normal"),

    /** What it is about, so the queue can deep-link. e.g. "loi" / 12 */
    sourceType: text("source_type"),
    sourceId: integer("source_id"),

    runId: integer("run_id"),
    /** Set once included in a digest, so the next one doesn't repeat it. */
    notifiedAt: timestamp("notified_at"),
    proposedAt: timestamp("proposed_at").defaultNow(),
    decidedAt: timestamp("decided_at"),
    decidedBy: text("decided_by"),
    executedAt: timestamp("executed_at"),
    error: text("error"),
  },
  (t) => ({
    statusIdx: index("agent_proposals_status_idx").on(t.status),
    kindIdx: index("agent_proposals_kind_idx").on(t.kind),
  }),
);

/**
 * Every approve / reject / edit, kept forever. This is the training set.
 * Rejections matter most: a kind rejected nine times in ten means the detector
 * is wrong, and that is only visible if rejections survive.
 */
export const agentDecisions = pgTable(
  "agent_decisions",
  {
    id: serial("id").primaryKey(),
    proposalId: integer("proposal_id").notNull(),
    kind: text("kind").notNull(),
    decision: text("decision").notNull(), // approved | rejected | edited
    /** What the agent wrote. */
    original: text("original").notNull().default(""),
    /** What was actually sent, when edited. */
    final: text("final"),
    /** Free-text reason, when given. */
    note: text("note"),
    decidedBy: text("decided_by"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({ kindIdx: index("agent_decisions_kind_idx").on(t.kind) }),
);

/**
 * Extracted preferences, in plain English. Readable and editable in the
 * dashboard — the point of learning this way rather than into weights is that
 * a wrong lesson can be seen and deleted.
 */
export const agentRules = pgTable("agent_rules", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("internal"),
  rule: text("rule").notNull(),
  /** How it arose: "extracted" from decisions, or "manual". */
  origin: text("origin").notNull().default("manual"),
  /** How many decisions supported it, when extracted. */
  evidenceCount: integer("evidence_count").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** One row per model invocation. Makes cost and behaviour observable. */
export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull().default("internal"),
  trigger: text("trigger").notNull(), // chat | schedule | manual | event
  model: text("model"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  toolCalls: integer("tool_calls").notNull().default(0),
  proposalsCreated: integer("proposals_created").notNull().default(0),
  startedAt: timestamp("started_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
  error: text("error"),
});

/** Chat, internal and public. `toolCalls` is kept for auditing what it read. */
export const agentMessages = pgTable(
  "agent_messages",
  {
    id: serial("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    scope: text("scope").notNull().default("internal"),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls").$type<{ name: string; input: unknown }[]>(),
    runId: integer("run_id"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({ threadIdx: index("agent_messages_thread_idx").on(t.threadId) }),
);

/** Durable notes carried between runs. */
export const agentFacts = pgTable("agent_facts", {
  id: serial("id").primaryKey(),
  fact: text("fact").notNull(),
  sourceType: text("source_type"),
  sourceId: integer("source_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Autonomy dial + editable system instructions. Key/value, versioned by row. */
export const agentSettings = pgTable("agent_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: text("updated_by"),
});

// ── Request validation ───────────────────────────────────────────────────

export const chatSchema = z.object({
  threadId: z.string().min(1).max(64),
  message: z.string().min(1).max(8000),
});

export const decideSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  /** Present when you changed the draft before approving. */
  editedPayload: z.record(z.unknown()).optional(),
  note: z.string().max(2000).optional(),
});

export const ruleSchema = z.object({
  rule: z.string().min(3).max(1000),
  scope: z.enum(AGENT_SCOPES).default("internal"),
  active: z.boolean().default(true),
});

// ── Row types ────────────────────────────────────────────────────────────

export type AgentProposal = typeof agentProposals.$inferSelect;
export type AgentDecision = typeof agentDecisions.$inferSelect;
export type AgentRule = typeof agentRules.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type AgentMessage = typeof agentMessages.$inferSelect;
export type AgentFact = typeof agentFacts.$inferSelect;
