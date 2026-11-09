/**
 * Which currency moves BlockFinaX sells protection against right now.
 *
 * Both are on sale: "up" is an Up cover (the dollar rising against the local currency, for
 * payments a business makes) and "down" is a Down cover (the dollar falling, for dollar
 * income a business receives). Removing a direction here stops new sales of it; existing
 * contracts and pools in that direction keep running, settle and pay either way.
 */
import type { Direction } from "./types";

export const OFFERED_DIRECTIONS: readonly Direction[] = ["up", "down"];

export const isOffered = (d: Direction): boolean => OFFERED_DIRECTIONS.includes(d);

/** Whether a pool can sell to new buyers today. Older pools covering "both" sell the offered direction. */
export const poolForSale = (d: Direction | "both"): boolean => (d === "both" ? OFFERED_DIRECTIONS.length > 0 : isOffered(d));

export const NOT_OFFERED_MESSAGE = "This direction of protection is not on offer right now.";
