/**
 * tables.ts, the prospect tables, created at startup.
 *
 * These used to be created only by running scripts/migrate-prospects.ts by
 * hand. The testnet database never had it run, so every read failed quietly:
 * the list showed nothing, the queue read as full (an unreadable count counts
 * as full, so no money is spent), and sending showed as stopped. Every
 * statement is IF NOT EXISTS, so running it on each start is safe.
 */

import { pool } from "../db";

export const PROSPECT_DDL = [
  `CREATE TABLE IF NOT EXISTS prospects (
     id                  serial PRIMARY KEY,
     company             text NOT NULL,
     website             text,
     country             text,
     description         text,
     industry            text,
     evidence            text,
     email               text NOT NULL,
     address_kind        text NOT NULL DEFAULT 'role',
     contact_name        text,
     contact_title       text,
     source_url          text,
     source              text NOT NULL DEFAULT 'search',
     source_query        text,
     segment             text NOT NULL DEFAULT 'unknown',
     fit                 text,
     fit_score           integer,
     sendable            boolean NOT NULL DEFAULT false,
     sendable_reason     text,
     status              text NOT NULL DEFAULT 'new',
     draft_subject       text,
     draft_body          text,
     approved_at         timestamp,
     approved_by         text,
     sent_at             timestamp,
     provider_message_id text,
     bounced_at          timestamp,
     replied_at          timestamp,
     unsubscribe_token   text NOT NULL UNIQUE,
     unsubscribed_at     timestamp,
     notes               text,
     created_at          timestamp DEFAULT now(),
     updated_at          timestamp DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS prospects_email_idx    ON prospects (email)`,
  `CREATE INDEX IF NOT EXISTS prospects_status_idx          ON prospects (status)`,
  `CREATE INDEX IF NOT EXISTS prospects_segment_idx         ON prospects (segment)`,
  `CREATE INDEX IF NOT EXISTS prospects_token_idx           ON prospects (unsubscribe_token)`,
  `CREATE INDEX IF NOT EXISTS prospects_country_idx         ON prospects (country)`,

  `CREATE TABLE IF NOT EXISTS email_suppressions (
     id         serial PRIMARY KEY,
     email      text NOT NULL,
     reason     text NOT NULL DEFAULT 'unsubscribed',
     note       text,
     created_at timestamp DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_email_idx ON email_suppressions (email)`,
];

export async function ensureProspectTables(): Promise<void> {
  try {
    for (const sql of PROSPECT_DDL) await pool.query(sql);
  } catch (e) {
    console.error("[Prospects] Could not create the prospect tables:", e instanceof Error ? e.message : e);
  }
}
