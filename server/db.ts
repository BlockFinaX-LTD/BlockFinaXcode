/**
 * Drizzle ORM Database Connection
 *
 * Driver selection — auto-detects Postgres host:
 *   - Neon Postgres URLs (host contains ".neon.tech") → @neondatabase/serverless via WebSocket
 *   - Everything else (Railway proxy, local Postgres, AWS RDS, etc.) → standard `pg` over TCP
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

/**
 * Read naive timestamps as UTC, which is what they are.
 *
 * Every timestamp column in this schema is `timestamp without time zone`, and
 * the database's own TimeZone is Etc/UTC — so `NOW()` writes a UTC wall clock
 * and the stored value means UTC. The driver does not know that. Given
 * "2026-08-09 05:49:33" it hands back a Date built in the *process's* local
 * zone, so on a machine at UTC+3 that value is read as 02:49 UTC: three hours
 * early, silently, on every timestamp the application touches.
 *
 * Railway's containers run UTC, so local and UTC coincide there and the fault
 * is invisible in production — which is exactly what makes it worth pinning
 * down rather than leaving to chance. It surfaces on any developer machine not
 * set to UTC, and it would surface in production the moment a container's zone
 * changed.
 *
 * 1114 is TIMESTAMP WITHOUT TIME ZONE; 1115 its array form. Appending Z says
 * what the column already means. Correcting it here rather than migrating a
 * hundred columns to timestamptz keeps the change to one place, and to the one
 * layer that was making the wrong assumption.
 */
function readNaiveTimestampsAsUtc(pgTypes: {
  setTypeParser: (oid: number, fn: (v: string) => unknown) => void;
}) {
  const parse = (value: string) => (value == null ? value : new Date(value.replace(" ", "T") + "Z"));
  pgTypes.setTypeParser(1114, parse as (v: string) => unknown);
  pgTypes.setTypeParser(1115, parse as (v: string) => unknown);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;

if (isNeon) {
  // Neon serverless via WebSocket — preserves the existing production behaviour
  // when DATABASE_URL points at a Neon endpoint.
  const { Pool, neonConfig, types: neonTypes } = requireCJS("@neondatabase/serverless");
  const { drizzle } = requireCJS("drizzle-orm/neon-serverless");
  if (neonTypes?.setTypeParser) readNaiveTimestampsAsUtc(neonTypes);
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
  // Standard pg over TCP. In production, certificate verification is mandatory.
  // DATABASE_SSL_CA may provide the trusted CA bundle for a private database
  // certificate. Configure a database hostname that matches its certificate;
  // do not disable TLS verification to work around a hostname mismatch.
  const pg = requireCJS("pg");
  const { drizzle } = requireCJS("drizzle-orm/node-postgres");
  if (pg?.types?.setTypeParser) readNaiveTimestampsAsUtc(pg.types);
  const databaseSslCa = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n");
  // Testnet only: its database is reached over Railway's private network, which is
  // encrypted and not reachable from the internet, and its certificate is self-signed
  // for localhost. Production never takes this branch.
  const testnetPrivateNetwork =
    process.env.APP_ENV === "testnet" && new URL(url).hostname.endsWith(".railway.internal");
  _pool = new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 5000,
    ssl: testnetPrivateNetwork ? false : {
      rejectUnauthorized: process.env.NODE_ENV === "production",
      ...(databaseSslCa ? { ca: databaseSslCa } : {}),
    },
  });
  _db = drizzle(_pool, { schema });
}

export const pool = _pool;
export const db = _db as NodePgDatabase<typeof schema> | NeonDatabase<typeof schema>;
