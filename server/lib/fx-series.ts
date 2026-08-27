/**
 * Removing feed errors that survive a median filter.
 *
 * `dropBadTicks` in fx.ts compares each close to its local median with a 40%
 * tolerance. That bound is deliberate: the cedi genuinely lost roughly half its
 * value across 2022, so a tighter filter would delete real history. But it
 * leaves a gap, and USD/GHS shows it exactly:
 *
 *     2025-09-30   12.4500
 *     2025-10-01   14.5000   <- 16.5% up in one day
 *     2025-10-02   12.5000   <- 13.8% back down
 *
 * 14.50 sits about 17% from its local median, well inside the 40% bound, so it
 * is kept. It then dominates every statistic computed from the series: it alone
 * produced a "worst 60 day move" of 30.9% for USD/GHS and 32.4% for EUR/GHS,
 * neither of which happened.
 *
 * The distinguishing feature is not size, it is persistence. A real
 * devaluation holds: the rate steps up and stays up. A feed error makes a round
 * trip and is gone the next day. So this filter asks whether the neighbours on
 * either side agree with each other while disagreeing with the point between
 * them, which is a shape a market does not produce and a broken tick always
 * does.
 *
 * Pure and dependency free so it can be tested without a database.
 */

export interface Close {
  date: string;
  close: number;
}

export interface SpikeResult {
  clean: Close[];
  dropped: Close[];
}

/**
 * Drop points that spike away from both neighbours and immediately return.
 *
 * @param jump      How far the point must sit from both neighbours to be
 *                  suspicious. 0.06 means 6%.
 * @param agreement How close the two neighbours must be to each other for the
 *                  point between them to be judged an error. 0.03 means the
 *                  day before and the day after are within 3%, so nothing
 *                  durable happened and the middle day is alone.
 *
 * Both bounds must be met. A genuine step of 12.45 to 14.50 to 14.60 keeps its
 * middle point, because the neighbours are 17% apart and so do not agree: the
 * move persisted, which is what makes it real.
 */
export function dropSpikes(series: Close[], jump = 0.06, agreement = 0.03): SpikeResult {
  const clean: Close[] = [];
  const dropped: Close[] = [];

  for (let i = 0; i < series.length; i++) {
    // Endpoints have no pair of neighbours to sit between, so they are never
    // judged. A spike on the first or last day of a window is indistinguishable
    // from the series simply starting or ending there.
    if (i === 0 || i === series.length - 1) {
      clean.push(series[i]);
      continue;
    }

    const prev = series[i - 1].close;
    const here = series[i].close;
    const next = series[i + 1].close;

    if (!Number.isFinite(prev) || !Number.isFinite(next) || prev <= 0 || next <= 0) {
      clean.push(series[i]);
      continue;
    }

    const awayFromPrev = Math.abs(here - prev) / prev;
    const awayFromNext = Math.abs(here - next) / next;
    const neighboursAgree = Math.abs(next - prev) / prev <= agreement;

    // Both neighbours must be far from this point, in the same direction of
    // disagreement, and close to each other. That is a spike that reverted.
    const isSpike =
      awayFromPrev > jump &&
      awayFromNext > jump &&
      neighboursAgree &&
      Math.sign(here - prev) === Math.sign(here - next);

    (isSpike ? dropped : clean).push(series[i]);
  }

  return { clean, dropped };
}
