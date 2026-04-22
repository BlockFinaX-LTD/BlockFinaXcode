/**
 * Drizzle ORM Database Connection
 *
 * Supports both Neon serverless (WebSocket) and standard PostgreSQL (TCP).
 * Auto-detects based on DATABASE_URL: Neon URLs use the serverless driver,
 * all others (Railway, Supabase, local) use the standard pg driver.
 */

import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const dbUrl = process.env.DATABASE_URL;
const isNeon = dbUrl.includes('neon.tech');

let pool: any;
let db: any;

if (isNeon) {
  // Neon serverless driver (WebSocket-based, works in edge runtimes)
  const { Pool, neonConfig } = await import('@neondatabase/serverless');
  const ws = (await import('ws')).default;
  neonConfig.webSocketConstructor = ws;

  pool = new Pool({
    connectionString: dbUrl,
    max: 3,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 5000,
    ssl: true,
  });

  const { drizzle } = await import('drizzle-orm/neon-serverless');
  db = drizzle({ client: pool, schema });
} else {
  // Standard pg driver (TCP — works with Railway, Supabase, local PostgreSQL)
  const pg = await import('pg');
  const needsSsl = dbUrl.includes('sslmode=require');

  pool = new pg.default.Pool({
    connectionString: dbUrl,
    max: 3,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 5000,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
  });

  const { drizzle } = await import('drizzle-orm/node-postgres');
  db = drizzle({ client: pool, schema });
}

export { pool, db };
