/**
 * The rates watchlist: currencies BlockFinaX users trade in, against USD, plus the euro
 * and pound crosses most used for African trade. Every pair has a live rate from the
 * shared FX source.
 *
 * The daily change compares today's snapshot of that same live rate with the previous
 * day's (rate_snapshots). Stored pricing closes come from another provider and are
 * noisy for thinly traded currencies, so they are never used for the change shown.
 */
export const WATCHLIST = [
  "USD/NGN", "USD/GHS", "USD/KES", "USD/ZAR", "USD/EGP", "USD/XOF", "USD/XAF", "USD/MAD",
  "USD/UGX", "USD/TZS", "USD/RWF", "USD/ETB", "USD/ZMW", "USD/MZN", "USD/BWP", "USD/MUR", "USD/TND",
  "EUR/NGN", "EUR/GHS", "EUR/KES", "EUR/ZAR", "EUR/XOF", "GBP/GHS",
] as const;

export interface RateRow {
  pair: string;
  spot: number | null;
  /** Today's live rate against the previous day's snapshot, or null before there is one. */
  change: number | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Record today's live rate for every watchlist pair (latest reading of the day wins). */
export async function recordRateSnapshots(spot: (pair: string) => Promise<string>) {
  const { db } = await import("../db");
  const { rateSnapshots } = await import("@shared/rates-schema");
  const day = today();
  for (const pair of WATCHLIST) {
    const rate = await spot(pair).catch(() => null);
    if (!rate || !(Number(rate) > 0)) continue;
    await db.insert(rateSnapshots).values({ pair, day, rate })
      .onConflictDoUpdate({ target: [rateSnapshots.pair, rateSnapshots.day], set: { rate, takenAt: new Date() } });
  }
}

export async function watchlistRates(spot: (pair: string) => Promise<string>): Promise<RateRow[]> {
  const { db } = await import("../db");
  const { rateSnapshots } = await import("@shared/rates-schema");
  const { and, desc, eq, lt } = await import("drizzle-orm");
  const day = today();
  return Promise.all(WATCHLIST.map(async (pair) => {
    const s = await spot(pair).then(Number).catch(() => null);
    const [prev] = await db.select().from(rateSnapshots)
      .where(and(eq(rateSnapshots.pair, pair), lt(rateSnapshots.day, day)))
      .orderBy(desc(rateSnapshots.day)).limit(1)
      .catch(() => [] as any[]);
    const before = prev ? Number(prev.rate) : null;
    return { pair, spot: s, change: s && before ? s / before - 1 : null };
  }));
}
