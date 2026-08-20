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
  `ALTER TABLE hedge_events ADD COLUMN IF NOT EXISTS implied_vol      numeric(10,6)`,
  `ALTER TABLE hedge_events ADD COLUMN IF NOT EXISTS min_premium_rate numeric(10,6)`,
];

(async () => {
  const label = process.env.LABEL || "database";
  const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    for (const sql of DDL) {
      await p.query(sql);
      console.log("  ok:", sql.trim().split("\n")[0].slice(0, 62));
    }
    const t = (await p.query(`select 1 from information_schema.tables where table_name='outreach_drafts'`)).rows;
    const c = (await p.query(`select column_name from information_schema.columns where table_name='hedge_events' and column_name in ('implied_vol','min_premium_rate')`)).rows;
    console.log(`  => ${label}: outreach_drafts ${t.length ? "EXISTS" : "MISSING"}, pricing cols: ${c.map((r: any) => r.column_name).join(", ") || "NONE"}`);
  } catch (e: any) {
    console.log("  FAILED:", e.message);
    process.exitCode = 1;
  }
  await p.end();
})();
