/**
 * The currency pairs BlockFinaX sells cover on (pools can be created for these). Each must
 * also be enabled in the currency-pool contract (`set_pair`, owner only) and have a pricing
 * source in server/pricing/data/pairs.ts. POOL_PAIRS (comma-separated) overrides the list.
 *
 * Added 2026-11-05: UGX (Uganda), TZS (Tanzania), ZMW (Zambia), MAD (Morocco) and XOF
 * (the West African CFA franc, used in eight countries).
 */
export const HEDGE_PAIRS = [
  "USD/NGN", "USD/GHS", "USD/KES", "USD/ZAR", "USD/EGP",
  "USD/UGX", "USD/TZS", "USD/ZMW", "USD/MAD", "USD/XOF",
] as const;

export function hedgePairs(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.POOL_PAIRS;
  return raw ? raw.split(",").map((p) => p.trim()).filter(Boolean) : [...HEDGE_PAIRS];
}
