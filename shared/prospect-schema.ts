/**
 * Prospects, businesses found by looking rather than by asking.
 *
 * ## Why this is a different table from `leads`
 *
 * `leads` holds people who ticked a box. Its whole design is the consent
 * record: the literal wording shown, the moment, the visitor key. That is what
 * answers a complaint, and mixing cold prospects into it would destroy the one
 * property it exists to have. A row in `leads` means "this person asked us to
 * write to them" and must keep meaning exactly that.
 *
 * So cold outbound lives here, with its own lawful basis and its own rails.
 *
 * ## The distinction that decides whether a send is allowed
 *
 * Not every address is the same kind of thing.
 *
 *   role       info@, sales@, treasury@, contact@. A published business
 *              contact point. Not personal data about an identifiable person in
 *              most readings, and cold B2B contact to one is ordinary practice.
 *
 *   individual ada.boateng@company.com. Personal data. Under Ghana's Data
 *              Protection Act 2012, Nigeria's NDPA 2023, and the ePrivacy
 *              Directive as it applies in the EU and UK, unsolicited commercial
 *              email to a named individual needs prior consent. BlockFinaX Inc.
 *              is Delaware and CAN-SPAM would permit more, but the recipient's
 *              jurisdiction decides, not the sender's.
 *
 * Both are stored, because knowing who works somewhere is useful. Only one is
 * sendable by default, and `sendableReason` records why for every row, so the
 * answer to "why did we email this person" is in the database rather than in
 * somebody's memory.
 *
 * ## Why suppression is a tombstone
 *
 * An unsubscribe has to survive re-import. Discovery runs repeatedly over the
 * same web, so without a permanent record the next crawl re-adds someone who
 * already asked to be left alone, and the second email is far worse than the
 * first.
 */

import { pgTable, serial, text, timestamp, index, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/** What BlockFinaX wants from each kind of prospect. */
export type ProspectSegment =
  | "hedger"       // carries currency exposure. Buys cover.
  | "underwriter"  // has capital to put behind a pool. The LP side.
  | "psp"          // payment provider, could distribute or integrate
  | "bank"         // could partner or refer what it cannot underwrite
  | "unknown";

export const prospects = pgTable(
  "prospects",
  {
    id: serial("id").primaryKey(),

    // ── The business ──────────────────────────────────────────────────────
    company: text("company").notNull(),
    website: text("website"),
    /** ISO-2 where the business operates. Drives whether cold contact is allowed. */
    country: text("country"),
    /** What they actually do, in a sentence. Read from their own site. */
    description: text("description"),
    /** Free text: "food importer", "payments", "asset manager". */
    industry: text("industry"),
    /** Anything that shows they have the exposure. Quoted from the source. */
    evidence: text("evidence"),

    // ── The contact ───────────────────────────────────────────────────────
    email: text("email").notNull(),
    /** role | individual. Decides whether this is sendable without consent. */
    addressKind: text("address_kind").notNull().default("role"),
    contactName: text("contact_name"),
    contactTitle: text("contact_title"),

    // ── Where it came from ────────────────────────────────────────────────
    /** The URL the address was actually found on. Provenance, not a guess. */
    sourceUrl: text("source_url"),
    /** search | site-crawl | directory | manual | import */
    source: text("source").notNull().default("search"),
    /** The query or seed that produced it, so a bad batch can be traced. */
    sourceQuery: text("source_query"),

    // ── Qualification ─────────────────────────────────────────────────────
    /** hedger | underwriter | psp | bank | unknown */
    segment: text("segment").notNull().default("unknown"),
    /** How BlockFinaX relates to this business specifically. */
    fit: text("fit"),
    fitScore: integer("fit_score"),

    /**
     * Whether this row may be emailed, and the reason either way.
     *
     * Computed rather than assumed, and stored rather than recomputed at send
     * time, so that a rule change tomorrow cannot silently make yesterday's
     * decision look different from the one that was actually taken.
     */
    sendable: boolean("sendable").notNull().default(false),
    sendableReason: text("sendable_reason"),

    // ── Pipeline ──────────────────────────────────────────────────────────
    /** new | drafted | approved | sent | replied | bounced | rejected */
    status: text("status").notNull().default("new"),
    draftSubject: text("draft_subject"),
    draftBody: text("draft_body"),
    /** Set only by a person. The model may never approve its own message. */
    approvedAt: timestamp("approved_at"),
    approvedBy: text("approved_by"),
    sentAt: timestamp("sent_at"),
    /** Resend's id, so a delivery can actually be traced afterwards. */
    providerMessageId: text("provider_message_id"),
    bouncedAt: timestamp("bounced_at"),
    repliedAt: timestamp("replied_at"),

    // ── Withdrawal ────────────────────────────────────────────────────────
    /** Opaque. The unsubscribe link carries this and nothing else. */
    unsubscribeToken: text("unsubscribe_token").notNull().unique(),
    unsubscribedAt: timestamp("unsubscribed_at"),

    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("prospects_email_idx").on(t.email),
    statusIdx: index("prospects_status_idx").on(t.status),
    segmentIdx: index("prospects_segment_idx").on(t.segment),
    tokenIdx: index("prospects_token_idx").on(t.unsubscribeToken),
    countryIdx: index("prospects_country_idx").on(t.country),
  }),
);

/**
 * Addresses that must never be contacted again, whatever discovery finds.
 *
 * Separate from `prospects` so it outlives the row. Deleting a prospect, or
 * re-importing them under a different company name, must not lose the fact
 * that they asked to be left alone. The email is stored lowercased and the
 * lookup is exact.
 */
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    /** unsubscribed | bounced | complained | manual */
    reason: text("reason").notNull().default("unsubscribed"),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("email_suppressions_email_idx").on(t.email),
  }),
);

export const insertProspectSchema = createInsertSchema(prospects).omit({
  id: true, createdAt: true, updatedAt: true, sentAt: true, approvedAt: true,
});

export type Prospect = typeof prospects.$inferSelect;
export type InsertProspect = typeof prospects.$inferInsert;
export type EmailSuppression = typeof emailSuppressions.$inferSelect;

/**
 * Role inboxes, the addresses a business publishes to be written to.
 *
 * Deliberately conservative. Anything not on this list is treated as belonging
 * to a person, because the cost of being wrong runs one way: emailing a named
 * individual without consent is the problem, and declining to email a role
 * address by mistake costs nothing but one lead.
 */
const ROLE_LOCAL_PARTS = new Set([
  "info", "contact", "hello", "enquiries", "enquiry", "inquiries", "inquiry",
  "sales", "admin", "office", "support", "help", "mail", "email", "general",
  "finance", "accounts", "accounting", "treasury", "trade", "trading",
  "procurement", "purchasing", "imports", "exports", "logistics",
  "partnerships", "partners", "business", "bd", "commercial", "invest",
  "investors", "ir", "press", "media", "marketing", "customerservice",
  "customercare", "service", "team", "operations", "ops",
]);

export function classifyAddress(email: string): "role" | "individual" {
  const local = (email.split("@")[0] || "").toLowerCase().replace(/[._-]/g, "");
  if (ROLE_LOCAL_PARTS.has(local)) return "role";
  // "sales.africa", "info-gh" and similar are still role inboxes.
  for (const r of Array.from(ROLE_LOCAL_PARTS)) {
    if (local.startsWith(r) && local.length <= r.length + 8) return "role";
  }
  return "individual";
}

/**
 * Countries where cold email to a named individual requires prior consent.
 *
 * Not exhaustive and not legal advice. It exists so the default is the careful
 * one for the markets BlockFinaX actually sells into, rather than the default
 * being "send to everyone and find out".
 */
export const CONSENT_REQUIRED_COUNTRIES = new Set([
  "GH", "NG", "KE", "ZA", "UG", "TZ", "ZM", "EG",
  "GB", "IE", "DE", "FR", "NL", "ES", "IT", "SE", "DK", "FI", "NO", "PL",
  "BE", "AT", "PT", "CZ", "GR", "RO", "HU", "CH", "CA", "AU", "NZ",
]);

/**
 * May this row be emailed, and why.
 *
 * The reason is returned alongside the verdict because it gets stored. Six
 * months from now the useful question is not whether a row was sendable but on
 * what basis it was judged so, and a boolean cannot answer that.
 */
export function assessSendable(p: {
  email: string;
  country?: string | null;
  addressKind?: string | null;
}): { sendable: boolean; reason: string } {
  const email = (p.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
    // Quoting it matters at volume. In a table of ten thousand rows, "invalid
    // address" says nothing about which crawl produced the rubbish.
    return {
      sendable: false,
      reason: `Not a usable email address: ${JSON.stringify(p.email ?? "")}. Discovery captured something that is not an address.`,
    };
  }

  const kind = p.addressKind || classifyAddress(email);
  if (kind === "role") {
    return {
      sendable: true,
      reason: "Published business inbox, not a named individual. Cold B2B contact with an unsubscribe and a postal address.",
    };
  }

  const cc = (p.country || "").toUpperCase();
  if (!cc) {
    return {
      sendable: false,
      reason: "Personal address and the country is unknown, so the stricter rule applies.",
    };
  }
  if (CONSENT_REQUIRED_COUNTRIES.has(cc)) {
    return {
      sendable: false,
      reason: `Personal address in ${cc}, where unsolicited commercial email to an individual needs prior consent. Write to the company inbox instead, or reach this person on LinkedIn.`,
    };
  }
  return {
    sendable: true,
    reason: `Personal address in ${cc}, which permits cold B2B email with an unsubscribe and a postal address.`,
  };
}
