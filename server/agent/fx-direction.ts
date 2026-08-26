/**
 * How a move on a currency pair reads to the person living in it.
 *
 * Its own module, with no imports, so it can be tested without a database.
 * `fx.ts` reaches the network and the db at import time, and a pure string
 * function should not need either to be checked.
 *
 * This exists because the direction was reported backwards in production.
 * USD/GHS fell 4.5% over thirty days to 25 August 2026, which is fewer cedis
 * per dollar and therefore a STRONGER cedi, and a Ghanaian importer was told
 * the cedi was weakening. The cause was handing the model a bare signed
 * number: on a currency pair a minus sign does not mean what it looks like,
 * because the pair names the foreign currency first and the local one second.
 */

/**
 * Put a move into words from the local currency's side.
 *
 * A rising USD/GHS means more cedis are needed per dollar, so the cedi is the
 * one that weakened and dollar imports got more expensive. Stated rather than
 * implied by a sign, because implying it is what failed.
 */
export function describeMove(pair: string, percent: number): string {
  const local = pair.split("/")[1] || pair || "the local currency";
  if (!Number.isFinite(percent) || Math.abs(percent) < 0.05) return `${local} broadly flat`;
  return percent > 0
    ? `${local} weaker by ${Math.abs(percent).toFixed(1)}%, so imports cost more`
    : `${local} stronger by ${Math.abs(percent).toFixed(1)}%, so imports cost less`;
}
