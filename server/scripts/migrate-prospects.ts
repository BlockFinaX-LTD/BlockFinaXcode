import pg from "pg";

/**
 * The prospect pipeline tables.
 *
 * Additive and idempotent, applied by hand for the same reason the outreach
 * tables are: `drizzle-kit push` stops on an unrelated question about
 * truncating loi_documents, and nobody should have to answer a truncate prompt
 * to create a table that has nothing to do with it.
 */
const DDL = [
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

(async () => {
  const label = process.env.LABEL || "database";
  const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    for (const sql of DDL) {
      await p.query(sql);
      console.log("  ok:", sql.trim().split("\n")[0].slice(0, 60));
    }
    const t = (await p.query(
      `select table_name from information_schema.tables
       where table_name in ('prospects','email_suppressions')`)).rows;
    console.log(`  => ${label}: [${t.map((r: any) => r.table_name).sort().join(", ")}]`);
  } catch (e: any) {
    console.log("  FAILED:", e.message);
    process.exitCode = 1;
  }
  await p.end();
})();
