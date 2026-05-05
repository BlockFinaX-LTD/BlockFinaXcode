/**
 * drift.ts — empirical drift μ for the EM correction (§3.5).
 *
 *   μ = ln(S_now / S_{N years ago}) / N
 *
 * For pairs where covered-interest parity does not hold (most EM), the standard
 * (r − q) drift in Garman-Kohlhagen is wrong. Substituting q_effective = r − μ
 * recovers a sensible price.
 *
 * Window: prefer 5 years; tolerate down to 3 if 5 isn't available yet.
 * Floor:  cap |μ| at ±50%/yr — anything bigger means a regime change is in
 *         the window and governance should re-baseline.
 */

import { getRecentCloses } from "./historical";

const TARGET_YEARS = 5;
const MIN_YEARS = 3;
const TRADING_DAYS_PER_YEAR = 252;
const ABS_DRIFT_FLOOR = 0.50;            // ±50%/yr cap
const TARGET_CLOSES = TARGET_YEARS * TRADING_DAYS_PER_YEAR;   // ~1260
const MIN_CLOSES   = MIN_YEARS * TRADING_DAYS_PER_YEAR;       // ~756

export interface DriftResult {
  /** Annualized log-return, capped at ±ABS_DRIFT_FLOOR. */
  mu: number;
  /** Annualized log-return BEFORE capping — for diagnostics. */
  muRaw: number;
  /** Number of trading-day closes used in the window. */
  closesUsed: number;
  /** Years actually covered (closesUsed / 252). */
  yearsCovered: number;
  /** First close date in the window. */
  startDate: string;
  /** Last close date in the window. */
  endDate: string;
}

/**
 * Compute the empirical drift for a pair from its DB-resident close history.
 *
 * Throws if there's not enough data (< MIN_YEARS).
 */
export async function computeEmpiricalDrift(pair: string): Promise<DriftResult> {
  // Ask for the target window; we'll trim if we don't have enough.
  const closes = await getRecentCloses(pair, TARGET_CLOSES);

  if (closes.length < MIN_CLOSES) {
    throw new Error(
      `Insufficient history for empirical drift on ${pair}: ` +
      `have ${closes.length} closes, need at least ${MIN_CLOSES} (${MIN_YEARS} years).`,
    );
  }

  const oldest = closes[0];
  const newest = closes[closes.length - 1];

  const sStart = Number(oldest.close);
  const sEnd   = Number(newest.close);
  const yearsCovered = closes.length / TRADING_DAYS_PER_YEAR;

  if (!Number.isFinite(sStart) || sStart <= 0 || !Number.isFinite(sEnd) || sEnd <= 0) {
    throw new Error(`Bad close values for ${pair}: start=${sStart}, end=${sEnd}`);
  }

  const muRaw = Math.log(sEnd / sStart) / yearsCovered;

  // Cap at ±ABS_DRIFT_FLOOR. If clipping kicks in, the window probably contains
  // a regime break — flag in the result so the orchestrator can warn governance.
  const mu = Math.max(-ABS_DRIFT_FLOOR, Math.min(ABS_DRIFT_FLOOR, muRaw));

  return {
    mu,
    muRaw,
    closesUsed: closes.length,
    yearsCovered,
    startDate: oldest.date,
    endDate: newest.date,
  };
}
