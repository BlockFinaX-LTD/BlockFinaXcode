import { defineConfig } from "drizzle-kit";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "./shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// Only the tables defined in shared/schema.ts. Many tables are created by the app itself
// (perps, market rates, compliance records, OTC, accounts and more); without this filter,
// `drizzle-kit push --force` (run on every testnet start) drops them as "not in the schema".
const tablesFilter = Object.values(schema)
  .filter((t): t is PgTable => is(t, PgTable))
  .map((t) => getTableName(t));

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  tablesFilter,
});
