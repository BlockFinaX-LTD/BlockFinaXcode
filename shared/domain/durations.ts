/**
 * Protection durations, mirroring the Stellar currency pool contract
 * (blockfinax-stellar/contracts/currency-pool: markup_for, expiry_at).
 *
 * A pool sells either only its listed durations ("specific", how pools made before
 * duration rules behave), any whole number of days from its minimum to the protocol
 * maximum ("any"), or up to its own maximum ("up-to"). In the open modes the listed
 * durations are price points: the markup between two of them is interpolated, and
 * outside them the nearest one applies. Cover ends at 14:00 UTC on its date, with
 * Saturday and Sunday moved to Monday.
 */
import type { Tenor } from "./types";

export type DurationMode = "specific" | "any" | "up-to";

export interface DurationRule {
  mode: DurationMode;
  minDays: number;
  /** The longest duration this pool sells now: the pool's own maximum or the protocol maximum. */
  maxDays: number;
}

const DAY = 86_400;
export const FIXING_SECONDS = 14 * 3600;
export const DEFAULT_MAX_TENOR_DAYS = 90;

/** When cover bought at `nowSec` for `days` ends (unix seconds). */
export function expiryAt(nowSec: number, days: number): number {
  let day = Math.floor((nowSec + days * DAY) / DAY);
  const weekday = (day + 3) % 7; // 1970-01-01 was a Thursday; Monday is 0
  if (weekday === 5) day += 2;
  else if (weekday === 6) day += 1;
  return day * DAY + FIXING_SECONDS;
}

/** The markup a pool charges for `days`, or null when it does not sell that duration. */
export function markupForDays(pool: { tenors: Tenor[]; durations?: DurationRule }, days: number): number | null {
  const rule = pool.durations;
  const active = pool.tenors.filter((t) => t.active);
  if (!Number.isInteger(days) || days < 1) return null;
  if (!rule || rule.mode === "specific") {
    if (rule && days > rule.maxDays) return null;
    return active.find((t) => t.tenorDays === days)?.markupBps ?? null;
  }
  if (days < rule.minDays || days > rule.maxDays) return null;
  let lo: Tenor | undefined;
  let hi: Tenor | undefined;
  for (const t of active) {
    if (t.tenorDays <= days && (!lo || t.tenorDays > lo.tenorDays)) lo = t;
    if (t.tenorDays >= days && (!hi || t.tenorDays < hi.tenorDays)) hi = t;
  }
  if (lo && hi) {
    if (lo.tenorDays === hi.tenorDays) return lo.markupBps;
    // Integer division truncating toward zero, as the contract does.
    return lo.markupBps + Math.trunc(((hi.markupBps - lo.markupBps) * (days - lo.tenorDays)) / (hi.tenorDays - lo.tenorDays));
  }
  return (lo ?? hi)?.markupBps ?? null;
}

/** Durations a pool can be asked for: a range for the open modes, a list otherwise. */
export function durationsOffered(pool: { tenors: Tenor[]; durations?: DurationRule }): { range: { minDays: number; maxDays: number } | null; days: number[] } {
  const rule = pool.durations;
  const listed = pool.tenors.filter((t) => t.active).map((t) => t.tenorDays).sort((a, b) => a - b);
  if (!rule || rule.mode === "specific") return { range: null, days: rule ? listed.filter((d) => d <= rule.maxDays) : listed };
  return { range: { minDays: rule.minDays, maxDays: rule.maxDays }, days: listed.filter((d) => d >= rule.minDays && d <= rule.maxDays) };
}
