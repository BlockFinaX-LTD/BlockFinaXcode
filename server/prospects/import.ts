/**
 * import.ts, adding contacts Anthony already holds, such as a SalesQL export.
 *
 * The rows arrive through the admin page rather than the repository because the
 * repository is public and these are named people.
 *
 * Imported rows skip the drafting queue: Anthony researches and writes to these
 * himself. The sendable verdict is still computed, so sending through the app
 * stays under the same rule as every other row.
 */

import { randomBytes } from "node:crypto";
import { prospects, assessSendable, classifyAddress } from "@shared/prospect-schema";

export const IMPORT_SOURCE = "import";

const SEGMENTS = new Set(["hedger", "underwriter", "psp", "bank", "investor", "unknown"]);
const MAX_ROWS = 500;

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Only http and https, because these values become links on the admin page. */
function link(v: unknown): string | null {
  const s = text(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
}

export function parseImportRow(r: any) {
  const email = text(r?.email)?.toLowerCase() ?? null;
  const company = text(r?.company);
  if (!email || !company) return null;
  const segment = text(r?.segment) ?? "unknown";
  const country = text(r?.country)?.toUpperCase().slice(0, 2) ?? null;
  const addressKind = classifyAddress(email);
  const verdict = assessSendable({ email, country, addressKind });
  return {
    company,
    website: link(r?.website),
    country,
    industry: text(r?.industry),
    email,
    addressKind,
    contactName: text(r?.name),
    contactTitle: text(r?.title),
    sourceUrl: link(r?.linkedin),
    source: IMPORT_SOURCE,
    sourceQuery: text(r?.batch),
    segment: SEGMENTS.has(segment) ? segment : "unknown",
    sendable: verdict.sendable,
    sendableReason: verdict.reason,
    notes: text(r?.notes),
  };
}

/**
 * These tables are not part of shared/schema.ts, so a database push does not make
 * them. Creating them here leaves any existing table and its rows untouched.
 */
let ready: Promise<unknown> | null = null;
async function ensureProspectTables() {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  const pending = (ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS prospects (
      id serial PRIMARY KEY,
      company text NOT NULL,
      website text,
      country text,
      description text,
      industry text,
      evidence text,
      email text NOT NULL,
      address_kind text NOT NULL DEFAULT 'role',
      contact_name text,
      contact_title text,
      source_url text,
      source text NOT NULL DEFAULT 'search',
      source_query text,
      segment text NOT NULL DEFAULT 'unknown',
      fit text,
      fit_score integer,
      sendable boolean NOT NULL DEFAULT false,
      sendable_reason text,
      status text NOT NULL DEFAULT 'new',
      draft_subject text,
      draft_body text,
      approved_at timestamp,
      approved_by text,
      sent_at timestamp,
      provider_message_id text,
      bounced_at timestamp,
      replied_at timestamp,
      unsubscribe_token text NOT NULL UNIQUE,
      unsubscribed_at timestamp,
      notes text,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS prospects_email_idx ON prospects (email);
    CREATE INDEX IF NOT EXISTS prospects_status_idx ON prospects (status);
    CREATE INDEX IF NOT EXISTS prospects_segment_idx ON prospects (segment);
    CREATE INDEX IF NOT EXISTS prospects_token_idx ON prospects (unsubscribe_token);
    CREATE INDEX IF NOT EXISTS prospects_country_idx ON prospects (country);
    CREATE TABLE IF NOT EXISTS email_suppressions (
      id serial PRIMARY KEY,
      email text NOT NULL,
      reason text NOT NULL DEFAULT 'unsubscribed',
      note text,
      created_at timestamp DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_email_idx ON email_suppressions (email);
  `));
  pending.catch(() => { ready = null; });
  await pending;
}

/** Adds what is new. An address already known is left exactly as it is. */
export async function importContacts(rows: unknown[]) {
  await ensureProspectTables();
  const { db } = await import("../db");
  let added = 0, duplicates = 0, invalid = 0;
  for (const raw of rows.slice(0, MAX_ROWS)) {
    const row = parseImportRow(raw);
    if (!row) { invalid++; continue; }
    const out = await db.insert(prospects)
      .values({ ...row, unsubscribeToken: randomBytes(24).toString("hex") })
      .onConflictDoNothing({ target: prospects.email })
      .returning({ id: prospects.id });
    if (out.length) added++; else duplicates++;
  }
  return { added, duplicates, invalid, skipped: Math.max(0, rows.length - MAX_ROWS) };
}
