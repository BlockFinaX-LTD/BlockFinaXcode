/**
 * format-rate.ts — a premium rate, with enough precision to see it move.
 *
 * Lifted out of hedge.tsx so the page and the explainer that describes it can
 * never render the same rate two different ways.
 *
 * `.toFixed(1)` rendered 0.5010% and 0.4997% both as "0.5%", which hid the
 * entire point of a dynamically priced pool: position 16 was charged a rate
 * that genuinely differed from the pool's stored one and the screen said the
 * two were identical.
 *
 * Adaptive rather than a fixed four decimals, because 2.5% should not read
 * "2.5000%". Small rates get the digits they need and trailing zeros are
 * trimmed, so 0.501% stays "0.501%" and 2.5% stays "2.5%".
 */
export function fmtRate(rate: number): string {
  if (!Number.isFinite(rate)) return '—';
  const pct = rate * 100;
  if (pct === 0) return '0%';
  // Below 1% the interesting digits sit further right. Three was not enough:
  // 0.4997% rounded to 0.500% and then lost its zeros to become "0.5%", which
  // is the very collapse this exists to prevent. Four keeps the difference.
  const dp = Math.abs(pct) < 1 ? 4 : 2;
  return pct.toFixed(dp).replace(/\.?0+$/, '') + '%';
}
