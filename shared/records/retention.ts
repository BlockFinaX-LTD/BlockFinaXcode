/**
 * How long BlockFinaX keeps each kind of record, and what happens when someone asks us to
 * delete their data.
 *
 * Anti-money-laundering rules in our markets (Ghana, Nigeria, Kenya) and Circle's partner
 * terms expect identity and transaction records to be kept for at least five years after the
 * relationship ends. Privacy law (Ghana's Data Protection Act, Nigeria's NDPA, Kenya's DPA)
 * lets a person ask for deletion, but allows records kept to meet a legal duty. So a deletion
 * request anonymises what we are free to remove at once, and schedules the rest for removal
 * when its retention period ends. Review these periods with a lawyer before mainnet.
 */

type RetentionAction = "delete" | "anonymise" | "keep";

interface RetentionRule {
  /** What the records are. */
  label: string;
  /** Years kept after the account closes (or after the record's own date, where noted). */
  years: number;
  /** What a deletion request does before the period ends. */
  onRequest: RetentionAction;
  /** Why we keep it. */
  basis: string;
}

export const RETENTION: Record<string, RetentionRule> = {
  identity: { label: "Identity checks (KYC, KYB, sanctions screening)", years: 5, onRequest: "keep", basis: "Anti-money-laundering record keeping" },
  transactions: { label: "Cover, payouts, deposits, withdrawals and transfers", years: 5, onRequest: "keep", basis: "Anti-money-laundering record keeping; on-chain records cannot be erased" },
  travelRule: { label: "Travel Rule sender and recipient details", years: 5, onRequest: "keep", basis: "Virtual asset transfer rules" },
  quotes: { label: "Quotes and key facts shown before a purchase", years: 5, onRequest: "keep", basis: "Evidence for disputes and fair-pricing reviews" },
  complaints: { label: "Complaints and their outcomes", years: 5, onRequest: "keep", basis: "Complaints handling rules" },
  cases: { label: "Suspicious activity cases and reports", years: 5, onRequest: "keep", basis: "Anti-money-laundering record keeping; the subject is never told" },
  legal: { label: "Terms and privacy acceptances", years: 5, onRequest: "keep", basis: "Proof of the agreement in force" },
  emails: { label: "Record of emails we sent you", years: 2, onRequest: "anonymise", basis: "Proof of what we told customers" },
  profile: { label: "Name, email, phone and preferences", years: 0, onRequest: "anonymise", basis: "Needed only while the account is open" },
  marketing: { label: "Marketing preferences and outreach", years: 0, onRequest: "delete", basis: "Consent, which can be withdrawn" },
  assistant: { label: "Conversations with Finax", years: 1, onRequest: "delete", basis: "Service quality" },
};

/** The audit log itself is never edited; it refers to people by id or by a hash of their email. */
export const LOG_RETENTION_YEARS = 7;

export function retentionSummary(): { key: string; label: string; years: number; onRequest: RetentionAction; basis: string }[] {
  return Object.entries(RETENTION).map(([key, r]) => ({ key, ...r }));
}
