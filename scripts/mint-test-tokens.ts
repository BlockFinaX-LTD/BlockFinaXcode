/**
 * Mints test signin + docs tokens for end-to-end testing of the
 * sliding-window renewal flow. Both tokens are deliberately created with
 * expiresAt 10 days from now (within the 30-day RENEW_BELOW window) so the
 * verify endpoint should push them out to 90 days when called.
 *
 * Run: tsx scripts/mint-test-tokens.ts
 * Emits JSON: { signin: "<raw>", docs: "<raw>" }
 */
import 'dotenv/config';
import crypto from 'crypto';
import { db } from '../server/db';
import { signinTokens, docsTokens, accessGrants } from '../shared/schema';
import { sql } from 'drizzle-orm';

const TEST_EMAIL = 'test-invited-user@blockfinax.local';
const TEN_DAYS = 10 * 24 * 60 * 60 * 1000;

function hash(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function main() {
  const rawSignin = crypto.randomBytes(32).toString('base64url');
  const rawDocs = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TEN_DAYS);

  await db.delete(signinTokens).where(sql`email = ${TEST_EMAIL}`);
  await db.delete(docsTokens).where(sql`email = ${TEST_EMAIL}`);
  await db.delete(accessGrants).where(sql`email = ${TEST_EMAIL}`);

  await db.insert(signinTokens).values({
    email: TEST_EMAIL,
    tokenHash: hash(rawSignin),
    expiresAt,
  });
  await db.insert(docsTokens).values({
    email: TEST_EMAIL,
    tokenHash: hash(rawDocs),
    name: 'test invited reviewer',
    reason: 'sliding-window test',
    expiresAt,
  });
  await db.insert(accessGrants).values({
    email: TEST_EMAIL,
    grantedBy: 'test',
  });

  console.log(JSON.stringify({
    signin: rawSignin,
    docs: rawDocs,
    email: TEST_EMAIL,
    expiresAtBefore: expiresAt.toISOString(),
  }));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
