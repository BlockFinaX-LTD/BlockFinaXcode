/**
 * The rates watchlist: currencies BlockFinaX users trade in, against USD, plus the euro
 * and pound crosses most used for African trade. Every pair has a live rate from the
 * shared FX source.
 *
 * The 24-hour change compares the live rate with the FX oracle's own snapshot of the
 * same source from about 24 hours earlier (rate_snapshots, written on every fetch).
 * Without such a snapshot it is left empty: the stored pricing closes come from another
 * provider and are noisy for thinly traded currencies, so they are never used here.
 */
export const WATCHLIST = [
  "USD/NGN", "USD/GHS", "USD/KES", "USD/ZAR", "USD/EGP", "USD/XOF", "USD/XAF", "USD/MAD",
  "USD/UGX", "USD/TZS", "USD/RWF", "USD/ETB", "USD/ZMW", "USD/MZN", "USD/BWP", "USD/MUR", "USD/TND",
  "EUR/NGN", "EUR/GHS", "EUR/KES", "EUR/ZAR", "EUR/XOF", "GBP/GHS",
] as const;

export interface RateRow {
  pair: string;
  spot: number | null;
  /** Change over about 24 hours, or null when there is no snapshot that old yet. */
  change: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function watchlistRates(spot: (pair: string) => Promise<string>): Promise<RateRow[]> {
  const { storage } = await import("../storage");
  const target = Date.now() - DAY_MS;
  return Promise.all(WATCHLIST.map(async (pair) => {
    const s = await spot(pair).then(Number).catch(() => null);
    const snap = await storage.getRateSnapshotBefore(pair, target + 15 * 60 * 1000).catch(() => undefined);
    // Only a snapshot from roughly a day ago counts (not one from last week).
    const usable = snap && new Date(snap.recordedAt).getTime() >= target - 6 * 60 * 60 * 1000;
    const before = usable ? Number(snap!.rate) : null;
    return { pair, spot: s, change: s && before ? s / before - 1 : null };
  }));
}
