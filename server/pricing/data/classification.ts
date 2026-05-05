/**
 * classification.ts — per-pair governance state in the DB.
 *
 * Source-of-truth for the LIST of pairs is server/pricing/data/pairs.ts.
 * Source-of-truth for the LIVE STATE per pair is the pair_classification table.
 *
 * Bootstrap: copy every PairSpec from the registry into the DB on first run
 * (idempotent — never overwrites existing rows). Subsequent edits go through
 * an admin route or direct SQL, never request handlers.
 */

import { db } from "../../db";
import { pairClassification, type PairClassification } from "../../../shared/schema";
import { eq, sql } from "drizzle-orm";
import { SUPPORTED_PAIRS } from "./pairs";

/**
 * Insert classification rows for every registry pair missing from the DB.
 * Idempotent — never overwrites existing rows.
 */
export async function seedDefaultClassifications(): Promise<number> {
  let inserted = 0;
  for (const spec of SUPPORTED_PAIRS) {
    const existing = await db
      .select({ pair: pairClassification.pair })
      .from(pairClassification)
      .where(eq(pairClassification.pair, spec.displayPair))
      .limit(1);
    if (existing.length > 0) continue;

    await db.insert(pairClassification).values({
      pair: spec.displayPair,
      useEmpiricalDrift: spec.useEmpiricalDrift,
      tier: spec.tier,
      notes: spec.notes,
    });
    inserted++;
  }
  return inserted;
}

/** Read the classification for a single pair. Throws if missing. */
export async function getPairClassification(pair: string): Promise<PairClassification> {
  const rows = await db
    .select()
    .from(pairClassification)
    .where(eq(pairClassification.pair, pair))
    .limit(1);
  if (rows.length === 0) {
    throw new Error(`No classification for pair ${pair}. Add it to pairs.ts and re-seed.`);
  }
  return rows[0];
}

/** All classifications, for admin views / debugging. */
export async function listAllClassifications(): Promise<PairClassification[]> {
  return db.select().from(pairClassification).orderBy(pairClassification.pair);
}

/** Mark when the drift was last recomputed for a pair (admin / governance trigger). */
export async function markDriftRecomputed(pair: string): Promise<void> {
  await db
    .update(pairClassification)
    .set({ lastDriftRecompute: sql`now()`, updatedAt: sql`now()` })
    .where(eq(pairClassification.pair, pair));
}
