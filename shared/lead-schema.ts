/**
 * Leads — people who asked us to follow up.
 *
 * ## Why this table looks the way it does
 *
 * Finax talks to strangers on the public site. Some of them are worth
 * contacting again. The temptation is to have the agent ask for a name and an
 * email in conversation and then mail them — and that is the one version of
 * this feature that is unlawful.
 *
 * Sending unsolicited commercial email to an individual requires prior consent
 * in the EU and UK (ePrivacy Directive art. 13), in Nigeria (NDPA 2023), and
 * under Ghana's Data Protection Act 2012 (Act 843), which reaches the Ghanaian
 * subsidiary. The "soft opt-in" exception that lets a business email its
 * existing customers does not apply: a website visitor has bought nothing.
 * BlockFinaX Inc. is a Delaware company, so CAN-SPAM governs directly and
 * would permit more than this — but the strictest jurisdiction a recipient
 * might sit in decides the design, not the one the sender sits in.
 *
 * So consent is not inferred from the conversation. It is a distinct act: the
 * visitor is shown a specific sentence, ticks a box, and presses a button.
 *
 * ## Why the wording is stored, not just a boolean
 *
 * `consented: true` is worth nothing in a complaint. What answers a regulator
 * is the exact sentence the person agreed to, the moment they agreed, and what
 * they were doing at the time. So `consentText` holds the literal wording that
 * was on screen. If the wording is ever changed, older records still show what
 * their subject actually saw rather than what the current form says.
 *
 * This is also why the agent cannot write the consent sentence itself. A model
 * asked to collect email addresses will get persuasive, and a sentence it
 * improvised is not a record of anything. The wording lives in
 * CONSENT_WORDING below, the server checks that the client sent back exactly
 * that, and anything else is refused.
 */

import { pgTable, serial, text, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/**
 * The only consent wording the server will accept.
 *
 * Amended 8 August 2026: the operating entity is BlockFinaX Inc. (Delaware),
 * not BlockFinaX Ltd (Ghana). Rows captured before that date keep the wording
 * they were actually shown — which is the entire reason the literal text is
 * stored on each record rather than a reference to this constant.
 *
 * Written to satisfy the three things GDPR art. 13 requires at the point of
 * collection — who is processing, for what, and how to stop it — in language a
 * person will actually read. Changing this string is a change to a legal
 * record: add a new version rather than editing this one in place, so that
 * existing rows continue to mean what they meant.
 */
export const CONSENT_WORDING =
  "Email me about BlockFinaX. I understand BlockFinaX Inc. will use my name and " +
  "email to send occasional updates about hedging cover and underwriting, that " +
  "I can unsubscribe from any message, and that this is not required to use the site.";

export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    company: text("company"),

    /** Where the person was when they agreed. "chat" today; room for more. */
    source: text("source").notNull().default("chat"),
    /** The conversation this came from, so context is available on follow-up. */
    threadId: text("thread_id"),

    // ── The consent record ────────────────────────────────────────────────
    /** Literal wording displayed. The thing that answers a complaint. */
    consentText: text("consent_text").notNull(),
    consentedAt: timestamp("consented_at").notNull().defaultNow(),
    /**
     * Hashed visitor key, never a raw IP. Enough to show two records came from
     * different people without storing an identifier we do not need.
     */
    consentVisitor: text("consent_visitor"),

    // ── Follow-up ─────────────────────────────────────────────────────────
    /** When the delayed follow-up becomes due. Null once sent. */
    followUpDueAt: timestamp("follow_up_due_at"),
    followUpSentAt: timestamp("follow_up_sent_at"),

    // ── Withdrawal ────────────────────────────────────────────────────────
    /**
     * Opaque, unguessable, and the only thing the unsubscribe link carries.
     * Putting an email address in an unsubscribe URL lets anyone who sees the
     * link unsubscribe someone else, and leaks the address into server logs.
     */
    unsubscribeToken: text("unsubscribe_token").notNull().unique(),
    unsubscribedAt: timestamp("unsubscribed_at"),

    /** Set when a person asks to be erased. Kept as a tombstone so a repeat
     *  import cannot silently resurrect them. */
    erasedAt: timestamp("erased_at"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    emailIdx: index("leads_email_idx").on(t.email),
    dueIdx: index("leads_due_idx").on(t.followUpDueAt),
    tokenIdx: index("leads_token_idx").on(t.unsubscribeToken),
  }),
);

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  consentedAt: true,
  followUpSentAt: true,
  unsubscribedAt: true,
  erasedAt: true,
  createdAt: true,
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/** May we still email this person? */
export function isContactable(lead: Pick<Lead, "unsubscribedAt" | "erasedAt">): boolean {
  return !lead.unsubscribedAt && !lead.erasedAt;
}
