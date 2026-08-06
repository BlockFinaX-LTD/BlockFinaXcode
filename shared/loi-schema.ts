/**
 * Smart Letter of Intent — schema
 *
 * A structured-form → generated-document → collaborate → sign → locked-PDF
 * pipeline. The tables are deliberately document-type agnostic: `docType`
 * selects a template, and nothing else in the flow changes. That is what
 * lets the same machinery serve NDAs, MoUs and underwriting agreements
 * later without a second implementation.
 *
 * Design notes:
 *  - `publicId` is what appears in recipient URLs. The serial `id` never
 *    leaves the server, so recipients can't enumerate other people's deals.
 *  - Recipient auth is a hashed bearer token (same pattern as docs_tokens)
 *    plus an emailed OTP immediately before signing. The link alone is
 *    enough to *read*; it is deliberately not enough to *sign*.
 *  - `bodyMarkdown` is the living document. Regenerating overwrites it,
 *    which is why the UI warns before regenerate — edits are not merged.
 *  - Everything that happens is appended to loi_events. The audit trail in
 *    the final PDF is rendered from that table, so it cannot drift from
 *    what actually occurred.
 */

import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Vocabulary ────────────────────────────────────────────────────────────

/** Document types. Adding one here + a template is the whole expansion story. */
export const DOC_TYPES = [
  "loi",
  "nda",
  "partnership",
  "underwriting",
  "liquidity_provider",
  "investment",
  "mou",
  "service",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  loi: "Letter of Intent",
  nda: "Non-Disclosure Agreement",
  partnership: "Partnership Agreement",
  underwriting: "Underwriting Agreement",
  liquidity_provider: "Liquidity Provider Agreement",
  investment: "Investment Agreement",
  mou: "Memorandum of Understanding",
  service: "Service Agreement",
};

/** Counterparty relationship. Drives which LOI template variant is used. */
export const RELATIONSHIP_TYPES = [
  "institutional_underwriter",
  "liquidity_provider",
  "sme",
  "fintech_partner",
  "strategic_partner",
  "investor",
  "broker",
  "other",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  institutional_underwriter: "Institutional Underwriter",
  liquidity_provider: "Liquidity Provider",
  sme: "SME",
  fintech_partner: "Fintech Partner",
  strategic_partner: "Strategic Partner",
  investor: "Investor",
  broker: "Broker",
  other: "Other",
};

/**
 * Lifecycle. Order matters — the dashboard sorts by it and the recipient
 * portal refuses to act on anything past `signed`.
 */
export const LOI_STATUSES = [
  "draft",
  "awaiting_review",
  "sent",
  "viewed",
  "changes_requested",
  "awaiting_signature",
  "signed",
  "declined",
  "expired",
] as const;
export type LoiStatus = (typeof LOI_STATUSES)[number];

export const STATUS_LABELS: Record<LoiStatus, string> = {
  draft: "Draft",
  awaiting_review: "Waiting for Review",
  sent: "Sent",
  viewed: "Viewed",
  changes_requested: "Changes Requested",
  awaiting_signature: "Awaiting Signature",
  signed: "Fully Signed",
  declined: "Declined",
  expired: "Expired",
};

/** Statuses after which the document is immutable. */
export const TERMINAL_STATUSES: LoiStatus[] = ["signed", "declined", "expired"];

export const SIGNATURE_METHODS = ["typed", "drawn", "uploaded"] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

export const PARTIES = ["sender", "recipient"] as const;
export type Party = (typeof PARTIES)[number];

// ── Tables ────────────────────────────────────────────────────────────────

export const loiDocuments = pgTable(
  "loi_documents",
  {
    id: serial("id").primaryKey(),
    /** Unguessable id used in recipient-facing URLs. */
    publicId: text("public_id").notNull().unique(),

    docType: text("doc_type").notNull().default("loi"),
    templateKey: text("template_key").notNull().default("loi_generic"),
    status: text("status").notNull().default("draft"),

    // Sender (us)
    senderCompany: text("sender_company").notNull(),
    senderName: text("sender_name").notNull(),
    senderPosition: text("sender_position"),
    senderEmail: text("sender_email").notNull(),
    senderPhone: text("sender_phone"),

    // Recipient (counterparty)
    recipientCompany: text("recipient_company").notNull(),
    recipientName: text("recipient_name").notNull(),
    recipientPosition: text("recipient_position"),
    recipientEmail: text("recipient_email").notNull(),
    recipientCountry: text("recipient_country"),

    relationshipType: text("relationship_type").notNull().default("other"),

    /**
     * The structured answers from the wizard. Kept whole rather than
     * exploded into columns because the field set varies by docType and
     * regeneration needs the original inputs verbatim.
     */
    terms: jsonb("terms").$type<LoiTerms>().notNull().default({} as LoiTerms),

    /** The living document. Markdown-ish: headings, paragraphs, lists. */
    bodyMarkdown: text("body_markdown").notNull().default(""),
    /** Clauses the sender appended by hand, rendered after the template body. */
    customClauses: jsonb("custom_clauses").$type<CustomClause[]>().notNull().default([]),

    /** Personal note included in the invitation email. */
    personalMessage: text("personal_message"),

    expiresAt: timestamp("expires_at"),
    sentAt: timestamp("sent_at"),
    firstViewedAt: timestamp("first_viewed_at"),
    signedAt: timestamp("signed_at"),
    declinedAt: timestamp("declined_at"),
    declineReason: text("decline_reason"),
    /** Set once fully signed. Non-null means no further edits are accepted. */
    lockedAt: timestamp("locked_at"),

    /** Final PDF, base64. Small enough (tens of KB) to keep beside the row. */
    pdfBase64: text("pdf_base64"),

    /**
     * Whether this counterparty may be named in the investor data room.
     *
     * Defaults to false and must be turned on per document. The letter itself
     * commits both sides to confidentiality, so naming a counterparty to
     * investors without their agreement would breach the document we just
     * asked them to sign. Aggregate counts are always published; identities
     * never are unless this is set.
     */
    showInDataRoom: boolean("show_in_data_room").notNull().default(false),

    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    lastActivityAt: timestamp("last_activity_at").defaultNow(),
  },
  (t) => ({
    statusIdx: index("loi_documents_status_idx").on(t.status),
    recipientIdx: index("loi_documents_recipient_idx").on(t.recipientEmail),
  }),
);

/** Hashed bearer tokens for the recipient's secure link. Re-issuable. */
export const loiTokens = pgTable(
  "loi_tokens",
  {
    id: serial("id").primaryKey(),
    loiId: integer("loi_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({ loiIdx: index("loi_tokens_loi_idx").on(t.loiId) }),
);

/** Emailed one-time codes. Required immediately before a signature commits. */
export const loiOtps = pgTable(
  "loi_otps",
  {
    id: serial("id").primaryKey(),
    loiId: integer("loi_id").notNull(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({ loiIdx: index("loi_otps_loi_idx").on(t.loiId) }),
);

export const loiSignatures = pgTable(
  "loi_signatures",
  {
    id: serial("id").primaryKey(),
    loiId: integer("loi_id").notNull(),
    party: text("party").notNull(), // sender | recipient
    signerName: text("signer_name").notNull(),
    signerEmail: text("signer_email").notNull(),
    signerPosition: text("signer_position"),
    method: text("method").notNull(), // typed | drawn | uploaded
    /** Typed: the literal text. Drawn/uploaded: a PNG data URL. */
    signatureData: text("signature_data").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    browser: text("browser"),
    device: text("device"),
    country: text("country"),
    signedAt: timestamp("signed_at").defaultNow(),
  },
  (t) => ({ loiIdx: index("loi_signatures_loi_idx").on(t.loiId) }),
);

/** Threaded comments and suggested edits from either side. */
export const loiComments = pgTable(
  "loi_comments",
  {
    id: serial("id").primaryKey(),
    loiId: integer("loi_id").notNull(),
    party: text("party").notNull(),
    authorName: text("author_name").notNull(),
    /** Which clause/heading this is anchored to. Null = general. */
    anchor: text("anchor"),
    kind: text("kind").notNull().default("comment"), // comment | suggestion
    body: text("body").notNull(),
    /** For suggestions: the replacement text being proposed. */
    suggestedText: text("suggested_text"),
    /** Set when the sender accepts or rejects a suggestion. */
    resolution: text("resolution"), // accepted | rejected
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({ loiIdx: index("loi_comments_loi_idx").on(t.loiId) }),
);

/** Append-only audit trail. Source of truth for the PDF's audit page. */
export const loiEvents = pgTable(
  "loi_events",
  {
    id: serial("id").primaryKey(),
    loiId: integer("loi_id").notNull(),
    type: text("type").notNull(),
    actor: text("actor"), // sender | recipient | system
    actorEmail: text("actor_email"),
    detail: text("detail"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({ loiIdx: index("loi_events_loi_idx").on(t.loiId) }),
);

// ── Structured term sheet ────────────────────────────────────────────────

export interface LoiTerms {
  purpose?: string;
  description?: string;
  estimatedVolume?: string;
  currency?: string;
  startDate?: string;
  duration?: string;
  exclusivity?: "none" | "mutual" | "recipient" | "sender";
  confidentiality?: boolean;
  confidentialityMonths?: number;
  governingLaw?: string;
  specialConditions?: string;
  additionalNotes?: string;
}

export const loiTermsSchema = z.object({
  purpose: z.string().max(2000).optional(),
  description: z.string().max(8000).optional(),
  estimatedVolume: z.string().max(120).optional(),
  currency: z.string().max(12).optional(),
  startDate: z.string().max(40).optional(),
  duration: z.string().max(120).optional(),
  exclusivity: z.enum(["none", "mutual", "recipient", "sender"]).optional(),
  confidentiality: z.boolean().optional(),
  confidentialityMonths: z.number().int().min(1).max(240).optional(),
  governingLaw: z.string().max(160).optional(),
  specialConditions: z.string().max(8000).optional(),
  additionalNotes: z.string().max(8000).optional(),
});

export interface CustomClause {
  id: string;
  heading: string;
  body: string;
}

export const customClauseSchema = z.object({
  id: z.string().max(64),
  heading: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
});

// ── Request validation ───────────────────────────────────────────────────

export const createLoiSchema = z.object({
  docType: z.enum(DOC_TYPES).default("loi"),
  senderCompany: z.string().min(1).max(200),
  senderName: z.string().min(1).max(200),
  senderPosition: z.string().max(200).optional(),
  senderEmail: z.string().email().max(320),
  senderPhone: z.string().max(60).optional(),

  recipientCompany: z.string().min(1).max(200),
  recipientName: z.string().min(1).max(200),
  recipientPosition: z.string().max(200).optional(),
  recipientEmail: z.string().email().max(320),
  recipientCountry: z.string().max(120).optional(),

  relationshipType: z.enum(RELATIONSHIP_TYPES).default("other"),
  terms: loiTermsSchema.default({}),
  personalMessage: z.string().max(4000).optional(),
  /** Days from send until the link stops working. */
  expiresInDays: z.number().int().min(1).max(365).default(30),
});

export const updateLoiSchema = createLoiSchema.partial().extend({
  bodyMarkdown: z.string().max(200_000).optional(),
  customClauses: z.array(customClauseSchema).max(50).optional(),
  /** Consent to name this counterparty in the investor data room. */
  showInDataRoom: z.boolean().optional(),
});

export const signSchema = z.object({
  method: z.enum(SIGNATURE_METHODS),
  signatureData: z.string().min(1).max(2_000_000),
  signerName: z.string().min(1).max(200),
  signerPosition: z.string().max(200).optional(),
  code: z.string().min(4).max(10),
});

export const commentSchema = z.object({
  anchor: z.string().max(200).optional(),
  kind: z.enum(["comment", "suggestion"]).default("comment"),
  body: z.string().min(1).max(8000),
  suggestedText: z.string().max(20000).optional(),
});

// ── Row types ────────────────────────────────────────────────────────────

export type LoiDocument = typeof loiDocuments.$inferSelect;
export type LoiToken = typeof loiTokens.$inferSelect;
export type LoiSignature = typeof loiSignatures.$inferSelect;
export type LoiComment = typeof loiComments.$inferSelect;
export type LoiEvent = typeof loiEvents.$inferSelect;

export const insertLoiSchema = createInsertSchema(loiDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLoiDocument = z.infer<typeof insertLoiSchema>;
