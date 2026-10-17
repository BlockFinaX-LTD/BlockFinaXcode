/**
 * The rates watchlist: currencies BlockFinaX users trade in, against USD, plus the euro
 * and pound crosses most used for African trade. Every pair here has a live rate from
 * the shared FX source; the change is the last day's move between stored daily closes.
 */
export const WATCHLIST = [
  "USD/NGN", "USD/GHS", "USD/KES", "USD/ZAR", "USD/EGP", "USD/XOF", "USD/XAF", "USD/MAD",
  "USD/UGX", "USD/TZS", "USD/RWF", "USD/ETB", "USD/ZMW", "USD/MZN", "USD/BWP", "USD/MUR", "USD/TND",
  "EUR/NGN", "EUR/GHS", "EUR/KES", "EUR/ZAR", "EUR/XOF", "GBP/GHS",
] as const;

export interface RateRow {
  pair: string;
  spot: number | null;
  /** The last day's move (latest close vs the one before), or null without history. */
  change: number | null;
}

export async function watchlistRates(spot: (pair: string) => Promise<string>): Promise<RateRow[]> {
  const { getRecentCloses } = await import("../pricing/data/historical");
  return Promise.all(WATCHLIST.map(async (pair) => {
    const [s, closes] = await Promise.all([
      spot(pair).then(Number).catch(() => null),
      getRecentCloses(pair, 2).catch(() => [] as any[]),
    ]);
    // Change compares two daily closes from the same source. Comparing the live rate
    // (one provider) with a close (another) shows the providers' gap, not a move.
    const last = closes.length >= 2 ? Number(closes[closes.length - 1].close) : null;
    const before = closes.length >= 2 ? Number(closes[closes.length - 2].close) : null;
    return { pair, spot: s, change: last && before ? last / before - 1 : null };
  }));
}
