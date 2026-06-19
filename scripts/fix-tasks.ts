/* Set proper verifiers on the seeded tasks so nothing auto-awards without
   either an on-chain proof, an explicit free-task flag, or admin-reviewed
   evidence. Idempotent — safe to re-run. */
import 'dotenv/config';
import { db } from '../server/db';
import { dailyTasks } from '../shared/schema';
import { eq } from 'drizzle-orm';

// id -> fields to set
const UPDATES: Array<{ id: number; set: Record<string, unknown>; why: string }> = [
  { id: 1, set: { verifier: 'auto' }, why: 'Open BlockFinaX — tiny welcome/check-in, free by design' },
  { id: 2, set: { verifier: 'manual', category: 'community' }, why: 'Check FX rates — needs proof; was mislabeled on-chain' },
  { id: 3, set: { verifier: 'manual' }, why: 'Share a market move — needs a link/screenshot' },
  { id: 4, set: { verifier: 'manual' }, why: 'Complete profile — 50 pts, needs verification' },
  { id: 5, set: { verifier: 'manual' }, why: 'Follow on X — needs proof' },
  { id: 6, set: { verifier: 'manual' }, why: 'Join Telegram — needs proof' },
  { id: 9, set: { isActive: false }, why: 'Refer a friend — handled automatically by the referral system' },
  // #7, #8 already onchain-verified; #10 already manual.
];

async function main() {
  for (const u of UPDATES) {
    await db.update(dailyTasks).set(u.set).where(eq(dailyTasks.id, u.id));
    console.log(`#${u.id} -> ${JSON.stringify(u.set)}   (${u.why})`);
  }
  console.log('\nDone. Verifying…\n');
  const tasks = await db.select().from(dailyTasks);
  for (const t of tasks) {
    const v = t.verifier;
    const mode = !t.isActive ? 'INACTIVE'
      : (v && String(v).startsWith('onchain:')) ? 'ONCHAIN-VERIFIED'
      : v === 'auto' ? 'AUTO (free)'
      : 'MANUAL REVIEW';
    console.log(`#${t.id} [${t.category}] verifier=${JSON.stringify(v)} -> ${mode} | ${t.title}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
