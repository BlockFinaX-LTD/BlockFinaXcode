import pg from "pg";

/**
 * The prospect pipeline tables.
 *
 * Additive and idempotent, applied by hand for the same reason the outreach
 * tables are: `drizzle-kit push` stops on an unrelated question about
 * truncating loi_documents, and nobody should have to answer a truncate prompt
 * to create a table that has nothing to do with it.
 */
import { PROSPECT_DDL as DDL } from "../prospects/tables";

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
