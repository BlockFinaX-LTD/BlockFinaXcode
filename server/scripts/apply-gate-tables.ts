/**
 * apply-gate-tables.ts — Idempotent SQL migration for the gating tables.
 * Run with: `npx tsx server/scripts/apply-gate-tables.ts`
 *
 * Creates: access_requests, access_grants, docs_tokens.
 * Safe to re-run; uses IF NOT EXISTS guards.
 */
import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Creating gating tables…');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS access_requests (
      id              SERIAL PRIMARY KEY,
      email           TEXT NOT NULL,
      name            TEXT NOT NULL,
      country         TEXT,
      role            TEXT,
      company         TEXT,
      use_case        TEXT,
      heard_from      TEXT,
      social_handle   TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      reviewed_at     TIMESTAMP,
      reviewed_by     TEXT,
      review_note     TEXT,
      created_at      TIMESTAMP DEFAULT now()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests (email);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests (status);`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS access_grants (
      id          SERIAL PRIMARY KEY,
      email       TEXT NOT NULL UNIQUE,
      granted_at  TIMESTAMP NOT NULL DEFAULT now(),
      granted_by  TEXT,
      revoked_at  TIMESTAMP
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_access_grants_email ON access_grants (email);`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS docs_tokens (
      id          SERIAL PRIMARY KEY,
      email       TEXT NOT NULL,
      token_hash  TEXT NOT NULL UNIQUE,
      name        TEXT,
      reason      TEXT,
      expires_at  TIMESTAMP NOT NULL,
      used_at     TIMESTAMP,
      revoked_at  TIMESTAMP,
      created_at  TIMESTAMP DEFAULT now()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_docs_tokens_email ON docs_tokens (email);`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS signin_tokens (
      id              SERIAL PRIMARY KEY,
      email           TEXT NOT NULL,
      token_hash      TEXT NOT NULL UNIQUE,
      expires_at      TIMESTAMP NOT NULL,
      first_used_at   TIMESTAMP,
      revoked_at      TIMESTAMP,
      created_at      TIMESTAMP DEFAULT now()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_signin_tokens_email ON signin_tokens (email);`);

  console.log('✓ Gating tables ready.');
  process.exit(0);
}

main().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
