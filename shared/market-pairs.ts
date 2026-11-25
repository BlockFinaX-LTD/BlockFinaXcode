/**
 * Pairs that price and settle on the stablecoin market rate, and how they are named to people.
 *
 * Internally (database, API, on-chain pools) these keep their codes, e.g. "USD/GHS". To people
 * they are shown as USDC pairs, "USDC/GHS", because the rate is what a USDC dollar trades for
 * and every payout is in USDC. Other pairs keep their official-rate names.
 */
export const MARKET_RATE_PAIRS = new Set(["USD/NGN", "USD/GHS", "USD/KES", "USD/ZAR"]);

/** "USD/GHS" shown as "USDC/GHS"; other pairs unchanged. */
export const pairLabel = (pair: string): string => (MARKET_RATE_PAIRS.has(pair) ? pair.replace(/^USD\//, "USDC/") : pair);

/** The perpetual's name: "USDCGHS-PERP". */
export const perpSymbol = (pair: string): string => `${pairLabel(pair).replace("/", "")}-PERP`;
