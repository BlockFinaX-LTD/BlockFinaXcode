/**
 * The rates watchlist: currencies BlockFinaX users trade in, against USD, plus the euro
 * and pound crosses most used for African trade. Every pair here has a live rate from
 * the shared FX source; the change is against the last stored daily close.
 */
export const WATCHLIST = [
  "USD/NGN", "USD/GHS", "USD/KES", "USD/ZAR", "USD/EGP", "USD/XOF", "USD/XAF", "USD/MAD",
  "USD/UGX", "USD/TZS", "USD/RWF", "USD/ETB", "USD/ZMW", "USD/MZN", "USD/BWP", "USD/MUR", "USD/TND",
  "EUR/NGN", "EUR/GHS", "EUR/KES", "EUR/ZAR", "EUR/XOF", "GBP/GHS",
] as const;

export interface RateRow {
  pair: string;
  spot: number | null;
  /** Fraction since the last stored daily close, or null without history. */
  change: number | null;
}

export async function watchlistRates(spot: (pair: string) => Promise<string>): Promise<RateRow[]> {
  const { getRecentCloses } = await import("../pricing/data/historical");
  return Promise.all(WATCHLIST.map(async (pair) => {
    const [s, closes] = await Promise.all([
      spot(pair).then(Number).catch(() => null),
      getRecentCloses(pair, 2).catch(() => [] as any[]),
    ]);
    const prev = closes.length ? Number(closes[closes.length - 1].close) : null;
    return { pair, spot: s, change: s && prev ? s / prev - 1 : null };
  }));
}
