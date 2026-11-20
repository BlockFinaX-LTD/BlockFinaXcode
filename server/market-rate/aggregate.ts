/**
 * Market (parallel) rate: combine quotes from several trading platforms into one rate per pair.
 * Pure functions, so the method can be tested and published exactly as it runs.
 *
 * Method (docs: oracles-and-settlement/market-rates):
 *   1. each source gives a mid price (halfway between its buy and sell);
 *   2. stale quotes are dropped;
 *   3. each source gets a weight from real activity, capped so none dominates;
 *      a market with no recent trades gets no weight;
 *   4. values too far from the median are dropped;
 *   5. the weighted median of the rest is the rate;
 *   6. too few sources left: no rate (the caller keeps the last good one).
 */

export type SourceKind = "exchange" | "p2p" | "composite";

export interface SourceQuote {
  source: string;
  kind: SourceKind;
  pair: string; // e.g. "USD/NGN"
  bid: number | null;
  ask: number | null;
  mid: number;
  /** USD traded in the last 24 hours (exchanges). */
  volumeUsd?: number | null;
  /** Number of live adverts behind the price (P2P). */
  ads?: number | null;
  /** When the source's price was observed, ms. */
  at: number;
}

export interface WeightedQuote extends SourceQuote {
  weight: number;
  included: boolean;
  reason?: "stale" | "no_activity" | "outlier";
}

export interface CompositeRate {
  pair: string;
  rate: number;
  sources: number;
  quotes: WeightedQuote[];
  at: number;
}

export interface AggregateRules {
  /** A quote older than this is dropped. */
  maxAgeMs: number;
  /** Published composites refresh more slowly than order books, so they may be older. */
  maxAgeCompositeMs: number;
  /** A quote further than this share from the median is dropped. */
  maxDeviation: number;
  /** Fewest sources needed for a rate. */
  minSources: number;
  /** No source may carry more than this share of the total weight. */
  weightCap: number;
}

export const DEFAULT_RULES: AggregateRules = { maxAgeMs: 5 * 60_000, maxAgeCompositeMs: 45 * 60_000, maxDeviation: 0.03, minSources: 1, weightCap: 0.4 };

/** Mid price from a buy and sell, or null if either is missing or they are crossed badly. */
export function midOf(bid: number | null, ask: number | null): number | null {
  if (bid == null || ask == null || !(bid > 0) || !(ask > 0)) return null;
  if (ask < bid * 0.98) return null; // crossed by more than 2%: not a usable book
  return (bid + ask) / 2;
}

/** Median of the middle of a list of P2P advert prices, ignoring the extremes. */
export function advertsMid(prices: number[], keep = 5): number | null {
  const xs = prices.filter((p) => p > 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const take = xs.slice(0, Math.max(1, Math.min(keep, xs.length)));
  return median(take);
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Raw activity weight before capping: exchanges by volume, P2P by adverts, composites fixed. */
export function activityWeight(q: SourceQuote): number {
  if (q.kind === "exchange") return q.volumeUsd && q.volumeUsd > 0 ? Math.sqrt(q.volumeUsd) : 0;
  if (q.kind === "p2p") return q.ads && q.ads > 0 ? Math.sqrt(q.ads) * 10 : 0;
  return 300; // a published composite of many providers
}

function weightedMedian(items: { value: number; weight: number }[]): number {
  const s = [...items].sort((a, b) => a.value - b.value);
  const total = s.reduce((t, x) => t + x.weight, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.weight;
    if (acc >= total / 2) return x.value;
  }
  return s[s.length - 1].value;
}

/**
 * Cap each weight so no source holds more than `cap` of the total. A capped weight x satisfies
 * x = cap * (rest + x), so x = cap * rest / (1 - cap); repeat until nothing is over.
 * With too few sources to meet the cap at all (n * cap < 1), weights are made equal.
 */
export function capWeights(ws: number[], cap: number): number[] {
  const out = [...ws];
  const live = out.filter((w) => w > 0).length;
  if (live === 0) return out;
  if (live * cap < 1) return out.map((w) => (w > 0 ? 1 : 0));
  for (let i = 0; i < out.length + 1; i++) {
    const total = out.reduce((t, w) => t + w, 0);
    let worst = -1;
    for (let j = 0; j < out.length; j++) if (out[j] > cap * total + 1e-9 && (worst < 0 || out[j] > out[worst])) worst = j;
    if (worst < 0) break;
    const rest = total - out[worst];
    out[worst] = (cap * rest) / (1 - cap);
  }
  return out;
}

export function aggregate(pair: string, quotes: SourceQuote[], now: number, rules: AggregateRules = DEFAULT_RULES): CompositeRate | null {
  const qs: WeightedQuote[] = quotes.filter((q) => q.pair === pair && q.mid > 0).map((q) => ({ ...q, weight: 0, included: false }));
  const fresh = qs.filter((q) => {
    if (now - q.at > (q.kind === "composite" ? rules.maxAgeCompositeMs : rules.maxAgeMs)) { q.reason = "stale"; return false; }
    const w = activityWeight(q);
    if (!(w > 0)) { q.reason = "no_activity"; return false; }
    q.weight = w;
    return true;
  });
  if (fresh.length < rules.minSources) return null;
  const mid0 = median(fresh.map((q) => q.mid));
  const kept = fresh.filter((q) => {
    if (Math.abs(q.mid - mid0) / mid0 > rules.maxDeviation) { q.reason = "outlier"; q.weight = 0; return false; }
    return true;
  });
  if (kept.length < rules.minSources) return null;
  const capped = capWeights(kept.map((q) => q.weight), rules.weightCap);
  const total = capped.reduce((t, w) => t + w, 0);
  kept.forEach((q, i) => { q.weight = total > 0 ? capped[i] / total : 0; q.included = true; });
  const rate = weightedMedian(kept.map((q) => ({ value: q.mid, weight: q.weight })));
  return { pair, rate, sources: kept.length, quotes: qs, at: now };
}
