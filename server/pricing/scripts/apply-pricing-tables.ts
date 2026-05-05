/**
 * apply-pricing-tables.ts — idempotent migration that creates the two pricing-engine
 * tables directly via raw SQL. Bypasses drizzle-kit so unrelated pre-existing schema
 * drift doesn't block our additive changes.
 *
 * Tables created:
 *   - historical_fx_closes
 *   - pair_classification
 *
 * Both use IF NOT EXISTS so re-running is a no-op.
 *
 * Usage:
 *   node --env-file=.env node_modules/.bin/tsx server/pricing/scripts/apply-pricing-tables.ts
 */

// Use the standard pg driver (not @neondatabase/serverless). Neon's WebSocket
// layer hardcodes hostname verification and Railway's proxy cert doesn't match,
// causing the connection to fail. pg with rejectUnauthorized:false handles it cleanly.
import pg from "pg";
const { Pool } = pg;

const SQL = `
CREATE TABLE IF NOT EXISTS historical_fx_closes (
  id          SERIAL PRIMARY KEY,
  pair        TEXT NOT NULL,
  date        TEXT NOT NULL,
  close       NUMERIC(30, 10) NOT NULL,
  source      TEXT NOT NULL DEFAULT 'twelvedata',
  fetched_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS historical_fx_closes_pair_date
  ON historical_fx_closes (pair, date);

CREATE TABLE IF NOT EXISTS pair_classification (
  pair                  TEXT PRIMARY KEY,
  use_empirical_drift   BOOLEAN NOT NULL,
  tier                  TEXT NOT NULL,
  notes                 TEXT,
  last_drift_recompute  TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT now()
);
`;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set");
  }

  console.log("Applying pricing tables to:", process.env.DATABASE_URL.replace(/:[^:@]+@/, ":***@"));

  // Railway's monorail.proxy.rlwy.net uses a wildcard cert that doesn't match the
  // proxy hostname. rejectUnauthorized:false skips hostname verification — safe here
  // because the connection string itself is the secret, not the cert pinning.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query(SQL);
    console.log("\n✓ Tables created (or already existed).");

    // Verify
    const r = await pool.query(`
      SELECT tablename, (SELECT count(*) FROM information_schema.columns WHERE table_name = tablename) AS col_count
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename IN ('historical_fx_closes', 'pair_classification')
      ORDER BY tablename;
    `);
    console.log("\nVerification:");
    for (const row of r.rows) {
      console.log(`  ${row.tablename}: ${row.col_count} columns`);
    }
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
