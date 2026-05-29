/**
 * verify-gate-tables.ts — Quick read-only sanity check after migration.
 * Run with: npx tsx server/scripts/verify-gate-tables.ts
 */
import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';

async function main() {
  const tables = ['access_requests', 'access_grants', 'docs_tokens', 'signin_tokens'];
  console.log('\nTable status (production DB):');
  console.log('─'.repeat(60));
  for (const t of tables) {
    try {
      const result = await db.execute(
        sql`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = ${t}`,
      );
      const cols = (result.rows?.[0] as { n: number } | undefined)?.n ?? 0;
      const countResult = await db.execute(sql`SELECT COUNT(*)::int AS n FROM ${sql.identifier(t)}`);
      const rowCount = (countResult.rows?.[0] as { n: number } | undefined)?.n ?? 0;
      const ok = cols > 0 ? '✓' : '✗';
      console.log(`  ${ok} ${t.padEnd(20)} ${cols} columns, ${rowCount} rows`);
    } catch (e: any) {
      console.log(`  ✗ ${t.padEnd(20)} ERROR: ${e?.message}`);
    }
  }
  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
