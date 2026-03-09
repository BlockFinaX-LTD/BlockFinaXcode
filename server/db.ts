/**
 * Drizzle ORM Database Connection
 * 
 * Establishes connection to Neon PostgreSQL database with Drizzle ORM.
 * Exports: pool, db instances configured with schema
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 3, // Further limit concurrent connections
  idleTimeoutMillis: 15000,
  connectionTimeoutMillis: 5000,
  ssl: false, // Reduce SSL overhead
});
export const db = drizzle({ client: pool, schema });