/**
 * Which currency moves BlockFinaX sells protection against right now.
 *
 * The contracts support both directions. For launch only "up" is on sale: the dollar
 * rising against the local currency (local currency depreciation), which is payables
 * protection for hedgers and depreciation cover for underwriters.
 *
 * To offer receivables protection (appreciation cover) again, add "down" here. Existing
 * "down" contracts and pools are unaffected either way: they keep running, settle and pay.
 */
import type { Direction } from "./types";

export const OFFERED_DIRECTIONS: readonly Direction[] = ["up"];

export const isOffered = (d: Direction): boolean => OFFERED_DIRECTIONS.includes(d);

/** Whether a pool can sell to new buyers today. Older pools covering "both" sell the offered direction. */
export const poolForSale = (d: Direction | "both"): boolean => (d === "both" ? OFFERED_DIRECTIONS.length > 0 : isOffered(d));

export const NOT_OFFERED_MESSAGE =
  "Protection against the local currency strengthening is not on offer yet. BlockFinaX currently protects against the local currency weakening.";
