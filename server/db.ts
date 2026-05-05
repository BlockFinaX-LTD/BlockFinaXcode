/**
 * Drizzle ORM Database Connection
 *
 * Driver selection — auto-detects Postgres host:
 *   - Neon Postgres URLs (host contains ".neon.tech") → @neondatabase/serverless via WebSocket
 *   - Everything else (Railway proxy, local Postgres, AWS RDS, etc.) → standard `pg` over TCP
 *
 * Why: Railway's monorail.proxy.rlwy.net uses a wildcard cert (*.up.railway.app) that
 * doesn't match the proxy hostname, so Neon's WebSocket cert pinning fails. The standard
 * `pg` driver lets us pass `rejectUnauthorized: false` to skip hostname verification.
 *
 * Both drivers expose a Pool-shaped interface that drizzle's adapters consume identically;
 * downstream code uses `db` and never sees the underlying driver choice.
 */

import { createRequire } from "node:module";
import * as schema from "@shared/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const url = process.env.DATABASE_URL;
const isNeon = url.includes(".neon.tech");
const requireCJS = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;

if (isNeon) {
  // Neon serverless via WebSocket — preserves the existing production behaviour
  // when DATABASE_URL points at a Neon endpoint.
  const { Pool, neonConfig } = requireCJS("@neondatabase/serverless");
  const { drizzle } = requireCJS("drizzle-orm/neon-serverless");
  const ws = requireCJS("ws");
  neonConfig.webSocketConstructor = ws.default ?? ws;
  _pool = new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 5000,
    ssl: false,
  });
  _db = drizzle({ client: _pool, schema });
} else {
  // Standard pg over TCP — for Railway proxy, local dev, RDS, etc.
  // rejectUnauthorized:false because Railway's proxy cert doesn't match the proxy hostname.
  const pg = requireCJS("pg");
  const { drizzle } = requireCJS("drizzle-orm/node-postgres");
  _pool = new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 5000,
    ssl: { rejectUnauthorized: false },
  });
  _db = drizzle(_pool, { schema });
}

export const pool = _pool;
export const db = _db as NodePgDatabase<typeof schema> | NeonDatabase<typeof schema>;