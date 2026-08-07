/**
 * Compliance — KYC tiers, limits, sanctions and alerts.
 *
 * ## What gets measured, and why it is not notional
 *
 * Notional is the size of the position being protected. It is not money that
 * moves. On a $100,000 position across BlockFinaX's live pools the customer
 * pays between $70 and $2,000 in premium — the rate varies twenty-eight-fold —
 * while the maximum payout is $10,000 on every one of them, because they all
 * use a 10% payout rate.
 *
 * So neither notional nor premium is the right measure. Premium is what comes
 * in and it is tiny and wildly variable; a $70 premium can buy a $10,000 claim
 * on the pool. Money laundering cares about the exit far more than the
 * entrance, and $70 in against $10,000 out is exactly the shape that needs an
 * identity attached to it.
 *
 * Two things are therefore measured:
 *
 *   cashMoved       premiums paid, payouts received, deposits and withdrawals,
 *                   over a rolling 30-day window. Actual value transferred.
 *   payoutExposure  the maximum a customer's open positions could pay out.
 *                   A future outflow that has already been committed to.
 *
 * ## Where the numbers come from
 *
 * Not invented. These are the thresholds already committed to in
 * docs/ops/compliance-aml-kyc-policy.md, which the Bank of Ghana sandbox
 * application references:
 *
 *   §3.1  source of funds above $1,000
 *   §3.3  enhanced due diligence above $10,000 in any 30-day period
 *   §4    review single transactions above $5,000
 *
 * A control looser than the filed policy is worse than no control, because it
 * is a documented breach rather than an omission. If a threshold changes here,
 * change the policy in the same commit.
 *
 * Limits are cumulative over the window, never per transaction: a
 * per-transaction cap is defeated by splitting a payment in two, and §4 of the
 * same policy commits us to detecting exactly that.
 */

import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index, real } from "drizzle-orm/pg-core";
import { z } from "zod";

// ── Tiers ─────────────────────────────────────────────────────────────────

export interface TierDef {
  tier: number;
  name: string;
  /** Cumulative value moved in the rolling window, in USD. */
  cashMovedUsd: number;
  /** Maximum payout a customer's open positions may total, in USD. */
  payoutExposureUsd: number;
  requires: string[];
  description: string;
}

/** Rolling window the cumulative limit is measured over. Matches policy §3.3. */
export const LIMIT_WINDOW_DAYS = 30;

export const KYC_TIERS: TierDef[] = [
  {
    tier: 0,
    name: "Unverified",
    cashMovedUsd: 0,
    payoutExposureUsd: 0,
    requires: [],
    description: "Can browse and read, but cannot buy cover or provide liquidity.",
  },
  {
    tier: 1,
    name: "Basic",
    cashMovedUsd: 1_000,
    payoutExposureUsd: 1_000,
    requires: ["Full legal name", "Phone number", "Country of residence", "Ghana Card or passport number"],
    description:
      "Small-size transacting. Matches the policy's $1,000 source-of-funds threshold. " +
      "Roughly $10,000 of notional at a 10% payout rate.",
  },
  {
    tier: 2,
    name: "Verified",
    cashMovedUsd: 10_000,
    payoutExposureUsd: 10_000,
    requires: ["Photo ID document", "Proof of address", "Date of birth", "Source of funds"],
    description:
      "Full customer due diligence. The ceiling before enhanced due diligence applies, per policy §3.3. " +
      "Roughly $100,000 of notional at a 10% payout rate.",
  },
  {
    tier: 3,
    name: "Enhanced",
    cashMovedUsd: 1_000_000,
    payoutExposureUsd: 1_000_000,
    requires: [
      "Certificate of incorporation (business)",
      "Directors and shareholders register",
      "Beneficial ownership declaration (10% or more)",
      "Source of wealth",
    ],
    description:
      "Enhanced due diligence, per policy §3.3. Required once value moved or payout exposure passes $10,000 " +
      "in any 30-day period.",
  },
];

export const tierFor = (n: number | null | undefined): TierDef =>
  KYC_TIERS.find((t) => t.tier === (n ?? 0)) ?? KYC_TIERS[0];

// ── Submissions ───────────────────────────────────────────────────────────

export const KYC_SUBMISSION_STATUSES = ["submitted", "in_review", "approved", "rejected"] as const;
export type KycSubmissionStatus = (typeof KYC_SUBMISSION_STATUSES)[number];

/**
 * A customer's application to reach a tier.
 *
 * Documents live on the row as data URLs rather than on disk: Railway
 * containers have ephemeral filesystems, and identity documents that vanish on
 * redeploy would breach the six-year retention in policy §7.
 */
export const kycSubmissions = pgTable(
  "kyc_submissions",
  {
    id: serial("id").primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    requestedTier: integer("requested_tier").notNull().default(1),
    status: text("status").notNull().default("submitted"),
    entityType: text("entity_type").notNull().default("individual"), // individual | business

    fullName: text("full_name"),
    dateOfBirth: text("date_of_birth"),
    nationality: text("nationality"),
    country: text("country"),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    idType: text("id_type"),
    idNumber: text("id_number"),

    companyName: text("company_name"),
    registrationNumber: text("registration_number"),
    beneficialOwners: text("beneficial_owners"),

    sourceOfFunds: text("source_of_funds"),
    sourceOfWealth: text("source_of_wealth"),
    expectedMonthlyVolume: text("expected_monthly_volume"),
    /** Self-declared. Screening reaches its own conclusion — see policy §3.3. */
    isPep: boolean("is_pep").notNull().default(false),

    documents: jsonb("documents").$type<KycDocument[]>().notNull().default([]),

    reviewerNotes: text("reviewer_notes"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at"),
    submittedAt: timestamp("submitted_at").defaultNow(),
  },
  (t) => ({
    walletIdx: index("kyc_submissions_wallet_idx").on(t.walletAddress),
    statusIdx: index("kyc_submissions_status_idx").on(t.status),
  }),
);

export interface KycDocument {
  label: string;
  filename: string;
  mime: string;
  dataUrl: string;
}

// ── Sanctions ─────────────────────────────────────────────────────────────

/**
 * Every screening run, hit or not.
 *
 * Clean results are kept deliberately. Policy §5 commits to screening "at
 * onboarding and on an ongoing basis", and the only way to show a supervisor
 * that this happened is a record of the screens that found nothing.
 */
export const sanctionsScreenings = pgTable(
  "sanctions_screenings",
  {
    id: serial("id").primaryKey(),
    subjectType: text("subject_type").notNull(), // name | wallet
    subject: text("subject").notNull(),
    walletAddress: text("wallet_address"),
    submissionId: integer("submission_id"),

    matched: boolean("matched").notNull().default(false),
    /** 0–1. A high score raises an alert; it never auto-rejects. */
    topScore: real("top_score").notNull().default(0),
    matches: jsonb("matches").$type<SanctionMatch[]>().notNull().default([]),
    provider: text("provider").notNull().default("opensanctions"),
    error: text("error"),
    screenedAt: timestamp("screened_at").defaultNow(),
  },
  (t) => ({
    walletIdx: index("sanctions_screenings_wallet_idx").on(t.walletAddress),
    matchedIdx: index("sanctions_screenings_matched_idx").on(t.matched),
  }),
);

export interface SanctionMatch {
  name: string;
  score: number;
  datasets: string[];
  topics: string[];
  country?: string;
  id?: string;
}

// ── Alerts ────────────────────────────────────────────────────────────────

export const ALERT_KINDS = [
  "large_transaction",
  "cumulative_threshold",
  "structuring",
  "sanctions_hit",
  "limit_exceeded",
  "pep",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_LABELS: Record<AlertKind, string> = {
  large_transaction: "Large single transaction",
  cumulative_threshold: "Cumulative threshold reached",
  structuring: "Possible structuring",
  sanctions_hit: "Sanctions screening hit",
  limit_exceeded: "Tier limit exceeded",
  pep: "Politically exposed person",
};

/**
 * Compliance alerts. Policy §4 requires review within 24 hours, so `openedAt`
 * is what an overdue count is measured against.
 */
export const complianceAlerts = pgTable(
  "compliance_alerts",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    severity: text("severity").notNull().default("medium"),
    walletAddress: text("wallet_address"),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("open"), // open | cleared | escalated
    resolution: text("resolution"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    openedAt: timestamp("opened_at").defaultNow(),
  },
  (t) => ({
    statusIdx: index("compliance_alerts_status_idx").on(t.status),
    walletIdx: index("compliance_alerts_wallet_idx").on(t.walletAddress),
  }),
);

// ── Validation ────────────────────────────────────────────────────────────

export const kycDocumentSchema = z.object({
  label: z.string().min(1).max(120),
  filename: z.string().max(300),
  mime: z.string().max(100),
  dataUrl: z.string().max(6_000_000),
});

export const kycSubmissionSchema = z.object({
  requestedTier: z.number().int().min(1).max(3),
  entityType: z.enum(["individual", "business"]).default("individual"),

  fullName: z.string().min(2).max(200),
  dateOfBirth: z.string().max(40).optional(),
  nationality: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(60).optional(),
  email: z.string().email().max(320).optional(),
  idType: z.string().max(60).optional(),
  idNumber: z.string().max(100).optional(),

  companyName: z.string().max(200).optional(),
  registrationNumber: z.string().max(100).optional(),
  beneficialOwners: z.string().max(4000).optional(),

  sourceOfFunds: z.string().max(1000).optional(),
  sourceOfWealth: z.string().max(1000).optional(),
  expectedMonthlyVolume: z.string().max(100).optional(),
  isPep: z.boolean().default(false),

  documents: z.array(kycDocumentSchema).max(10).default([]),
});

export const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  grantedTier: z.number().int().min(0).max(3).optional(),
  notes: z.string().max(4000).optional(),
});

export type KycSubmission = typeof kycSubmissions.$inferSelect;
export type SanctionsScreening = typeof sanctionsScreenings.$inferSelect;
export type ComplianceAlert = typeof complianceAlerts.$inferSelect;
