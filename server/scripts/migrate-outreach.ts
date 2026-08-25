import pg from "pg";

/**
 * Apply only the outreach + pricing schema additions.
 *
 * Written by hand rather than run through `drizzle-kit push` because push stops
 * on an unrelated question — whether to truncate loi_documents to add a unique
 * constraint — and that table holds real rows. Every statement here is additive
 * and IF NOT EXISTS, so running it twice is harmless and nothing existing is
 * touched.
 */
const DDL = [
  `CREATE TABLE IF NOT EXISTS outreach_drafts (
     id              serial PRIMARY KEY,
     source_url      text,
     source_text     text NOT NULL,
     person_name     text,
     person_headline text,
     intent          text NOT NULL DEFAULT 'reply',
     draft           text NOT NULL,
     original_draft  text NOT NULL,
     status          text NOT NULL DEFAULT 'waiting',
     created_at      timestamp DEFAULT now(),
     sent_at         timestamp
   )`,
  `CREATE INDEX IF NOT EXISTS outreach_drafts_status_idx ON outreach_drafts (status)`,
  `ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS posted_at timestamp`,
  `ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS comment_urn text`,
  `ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS demand_level    text`,
  `ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS demand_evidence text`,
  `ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS outcome         text`,
  `ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS outcome_note    text`,
  `ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS outcome_at      timestamp`,
  `CREATE INDEX IF NOT EXISTS outreach_drafts_outcome_idx ON outreach_drafts (outcome)`,
  `ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS queued_at timestamp`,
  `ALTER TABLE hedge_events ADD COLUMN IF NOT EXISTS implied_vol      numeric(10,6)`,
  `ALTER TABLE hedge_events ADD COLUMN IF NOT EXISTS min_premium_rate numeric(10,6)`,

  `CREATE TABLE IF NOT EXISTS outreach_people (
     id             serial PRIMARY KEY,
     profile_url    text NOT NULL UNIQUE,
     name           text,
     headline       text,
     company        text,
     location       text,
     topics         text,
     posts_seen     integer NOT NULL DEFAULT 1,
     top_score      integer NOT NULL DEFAULT 0,
     last_post_text text,
     last_post_url  text,
     status         text NOT NULL DEFAULT 'new',
     notes          text,
     first_seen     timestamp DEFAULT now(),
     last_seen      timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS outreach_people_status_idx ON outreach_people (status)`,
  `CREATE INDEX IF NOT EXISTS outreach_people_score_idx  ON outreach_people (top_score)`,
  `ALTER TABLE outreach_people ADD COLUMN IF NOT EXISTS segment     text`,
  `ALTER TABLE outreach_people ADD COLUMN IF NOT EXISTS fit         text`,
  `ALTER TABLE outreach_people ADD COLUMN IF NOT EXISTS fit_score   integer`,
  `ALTER TABLE outreach_people ADD COLUMN IF NOT EXISTS about       text`,
  `ALTER TABLE outreach_people ADD COLUMN IF NOT EXISTS verified    boolean NOT NULL DEFAULT false`,
  `ALTER TABLE outreach_people ADD COLUMN IF NOT EXISTS verified_at timestamp`,
  `ALTER TABLE outreach_people ADD COLUMN IF NOT EXISTS verified_by text`,
  `CREATE INDEX IF NOT EXISTS outreach_people_segment_idx ON outreach_people (segment)`,
  `CREATE INDEX IF NOT EXISTS outreach_people_fit_idx     ON outreach_people (fit_score)`,

  `CREATE TABLE IF NOT EXISTS market_memory (
     id          serial PRIMARY KEY,
     kind        text NOT NULL DEFAULT 'news',
     title       text NOT NULL,
     body        text NOT NULL,
     source_name text,
     source_url  text,
     as_of       timestamp NOT NULL,
     tags        text,
     pair        text,
     active      boolean NOT NULL DEFAULT true,
     created_at  timestamp DEFAULT now(),
     created_by  text
   )`,
  `CREATE INDEX IF NOT EXISTS market_memory_active_idx ON market_memory (active)`,
  `CREATE INDEX IF NOT EXISTS market_memory_asof_idx   ON market_memory (as_of)`,
];

(async () => {
  const label = process.env.LABEL || "database";
  const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    for (const sql of DDL) {
      await p.query(sql);
      console.log("  ok:", sql.trim().split("\n")[0].slice(0, 62));
    }
    const t = (await p.query(
      `select table_name from information_schema.tables
       where table_name in ('outreach_drafts','outreach_people','market_memory')`)).rows;
    const c = (await p.query(
      `select column_name from information_schema.columns
       where table_name='hedge_events' and column_name in ('implied_vol','min_premium_rate')`)).rows;
    console.log(`  => ${label}: tables [${t.map((r: any) => r.table_name).sort().join(", ")}]`);
    console.log(`     pricing cols: ${c.map((r: any) => r.column_name).join(", ") || "NONE"}`);
  } catch (e: any) {
    console.log("  FAILED:", e.message);
    process.exitCode = 1;
  }
  await p.end();
})();
