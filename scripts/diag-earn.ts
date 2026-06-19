/* One-off diagnostic: dump task verifiers + the most recent task completions
   so we can see whether they were auto-credited or routed to review. */
import 'dotenv/config';
import { db } from '../server/db';
import { dailyTasks, userTaskCompletions } from '../shared/schema';
import { userPoints, pointTransactions } from '../shared/referral-schema';
import { desc } from 'drizzle-orm';

async function main() {
  const tasks = await db.select().from(dailyTasks);
  console.log('\n=== TASK DEFINITIONS ===');
  for (const t of tasks) {
    console.log(`#${t.id} [${t.category}] verifier=${JSON.stringify(t.verifier)} active=${t.isActive} pts=${t.points} | ${t.title}`);
  }

  const comps = await db.select().from(userTaskCompletions).orderBy(desc(userTaskCompletions.completedAt)).limit(20);
  console.log('\n=== LAST 20 COMPLETIONS (reviewStatus tells the story: auto=credited, pending=review) ===');
  for (const c of comps) {
    console.log(`task#${c.taskId} status=${c.reviewStatus} pts=${c.pointsEarned} wallet=${c.walletAddress.slice(0, 10)} at=${new Date(c.completedAt as any).toISOString()}`);
  }

  const pts = await db.select().from(userPoints).orderBy(desc(userPoints.totalPoints)).limit(10);
  console.log('\n=== TOP POINTS BALANCES ===');
  for (const p of pts) console.log(`${p.walletAddress.slice(0, 12)} total=${p.totalPoints} referral=${p.referralPoints}`);

  const txns = await db.select().from(pointTransactions).orderBy(desc(pointTransactions.createdAt)).limit(10);
  console.log('\n=== LAST 10 POINT TRANSACTIONS ===');
  for (const x of txns) console.log(`${x.type} +${x.points} ${x.walletAddress.slice(0, 10)} | ${x.description} @ ${new Date(x.createdAt as any).toISOString()}`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
