/**
 * market-brief.ts — what BlockFinaX can say about a currency that nobody else
 * in the comment thread can.
 *
 * A drafting tool that reaches for the news reads like everyone else reaching
 * for the same news. The advantage here is 483,000 daily closes going back to
 * 1996, already in the database for pricing. Nobody replying to a LinkedIn post
 * about the cedi has the realised-volatility percentile to hand.
 *
 * So the brief is computed, never recalled. Every number below is derived from
 * closes at request time, which means it cannot be stale and cannot be
 * hallucinated — the two failure modes that make a confident comment
 * embarrassing.
 *
 * ## What is computed, and why each one earns its place
 *
 *   spot, 30d, 90d, YTD, 1y   the table stakes. Direction and magnitude.
 *
 *   realised vol (30d, 90d)   the number most people arguing about currencies
 *                             never cite, because it is the one that separates
 *                             "it moved" from "it moved unusually".
 *
 *   vol percentile            the insight. 18% vol means nothing on its own;
 *                             18% in the 87th percentile of its own ten-year
 *                             history means the market is disturbed. This is the
 *                             single most quotable line the brief produces.
 *
 *   worst 30-day move         what a business actually lost, last time. Concrete
 *                             where "volatility" is abstract.
 *
 *   jump days                 daily moves past three sigma. Frontier currencies
 *                             step rather than diffuse, which is why the pricing
 *                             engine runs Merton and not plain Black-Scholes.
 *                             Being able to say "this pair jumped nine times in
 *                             the last year" is the empirical case for that.
 *
 * Nothing here is an opinion. The drafter is told to build the opinion.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export interface PairBrief {
  pair: string;
  spot: number;
  asOf: string;
  /** Percent change over the window. Positive = the base currency weakened. */
  move30: number | null;
  move90: number | null;
  moveYtd: number | null;
  move1y: number | null;
  /** Annualised realised volatility, percent. */
  vol30: number | null;
  vol90: number | null;
  /** Where vol90 sits in its own trailing history, 0–100. */
  volPercentile: number | null;
  /** The window that percentile was measured over. Quoted, so it cannot be overstated. */
  volPercentileFrom: string | null;
  /** Worst adverse 30-day move in the last three years, percent. */
  worst30: number | null;
  worst30Date: string | null;
  /** Daily moves beyond three sigma in the last year. */
  jumpDays: number | null;
  /** Closes available. Below ~250 the percentile is not worth quoting. */
  depth: number;
}

/**
 * Which pair is a post talking about?
 *
 * Matched on the currency's common name rather than its ISO code, because that
 * is how people write on LinkedIn — "the cedi", not "GHS". Ambiguous names are
 * deliberately absent: "shilling" is Kenyan, Ugandan or Tanzanian depending on
 * who is speaking, and guessing wrong produces a comment citing the wrong
 * country's data, which is worse than citing none.
 */
const PAIR_NAMES: Array<[RegExp, string]> = [
  [/\b(cedi|ghana(ian)?|ghs|accra)\b/i, "USD/GHS"],
  [/\b(naira|nigeria(n)?|ngn|lagos|abuja)\b/i, "USD/NGN"],
  [/\b(kenya(n)?|kes|nairobi|kenyan shilling)\b/i, "USD/KES"],
  [/\b(rand|south africa(n)?|zar|johannesburg)\b/i, "USD/ZAR"],
  [/\b(egypt(ian)?|egp|pound egypt|cairo)\b/i, "USD/EGP"],
  [/\b(kwacha|zambia(n)?|zmw|lusaka)\b/i, "USD/ZMW"],
  [/\b(uganda(n)?|ugx|kampala)\b/i, "USD/UGX"],
  [/\b(tanzania(n)?|tzs|dar es salaam)\b/i, "USD/TZS"],
  [/\b(cfa|xof|franc zone|waemu|senegal|ivory coast|côte d'ivoire)\b/i, "USD/XOF"],
];

export function pairsMentioned(text: string): string[] {
  const hits: string[] = [];
  for (const [re, pair] of PAIR_NAMES) {
    if (re.test(text) && !hits.includes(pair)) hits.push(pair);
  }
  // Explicit pair notation always wins — someone writing USD/GHS means it.
  const explicit = text.match(/\b(?:USD|EUR|GBP)\/[A-Z]{3}\b/g) || [];
  for (const e of explicit) if (!hits.includes(e)) hits.unshift(e);
  return hits.slice(0, 3);
}

/** Annualised standard deviation of daily log returns, as a percent. */
function annualisedVol(closes: number[]): number | null {
  if (closes.length < 10) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1], b = closes[i];
    if (a > 0 && b > 0) rets.push(Math.log(a / b));
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
  const varce = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varce) * Math.sqrt(252) * 100;
}

const pct = (now: number, then: number): number | null =>
  then > 0 ? ((now / then) - 1) * 100 : null;

/**
 * Build the brief for one pair.
 *
 * Closes arrive newest-first, so index 0 is today and index 21 is roughly a
 * month of trading days back. Calendar days would be wrong here — a 30-calendar-day
 * lookback silently spans a different number of observations depending on where
 * the holidays fell, which is the same unit error that once stopped the pricing
 * engine quoting anything at all.
 */
export async function briefFor(pair: string): Promise<PairBrief | null> {
  const rows = (await db.execute(sql`
    select date::text as d, close::float8 as c
    from historical_fx_closes
    where pair = ${pair}
    order by date desc
    limit 7000
  `)).rows as Array<{ d: string; c: number }>;

  if (rows.length < 30) return null;

  const c = rows.map(r => Number(r.c)).filter(v => Number.isFinite(v) && v > 0);
  if (c.length < 30) return null;

  const spot = c[0];
  const at = (i: number) => c[Math.min(i, c.length - 1)];

  const year = rows[0].d.slice(0, 4);
  const ytdRow = rows.find(r => r.d <= `${year}-01-02`);

  // Rolling 90-day vol through the available history, to place today's reading.
  const volSeries: number[] = [];
  for (let i = 0; i + 64 <= c.length; i += 5) {
    const v = annualisedVol(c.slice(i, i + 64));
    if (v !== null) volSeries.push(v);
  }
  const vol90 = annualisedVol(c.slice(0, 64));
  let volPercentile: number | null = null;
  let volPercentileFrom: string | null = null;
  if (vol90 !== null && volSeries.length >= 20) {
    const below = volSeries.filter(v => v < vol90).length;
    volPercentile = Math.round((below / volSeries.length) * 100);
    // The oldest close the rolling series actually reached. Carried through to
    // the rendered brief because a percentile is meaningless without its window,
    // and a drafter given "26-year history" in one line and a five-year
    // percentile in another will confidently merge the two.
    volPercentileFrom = rows[Math.min(rows.length - 1, volSeries.length * 5 + 63)]?.d?.slice(0, 4) ?? null;
  }

  // Worst adverse 30-day move in the last ~3 years. "Adverse" means the base
  // currency weakening, which is the direction that hurts an importer — the
  // person these posts are usually about.
  let worst30: number | null = null;
  let worst30Date: string | null = null;
  for (let i = 0; i + 21 < Math.min(c.length, 780); i++) {
    const m = pct(c[i], c[i + 21]);
    if (m !== null && (worst30 === null || m > worst30)) {
      worst30 = m;
      worst30Date = rows[i].d;
    }
  }

  // Jump days: |daily log return| beyond three standard deviations, measured
  // over the last year against that same year's own sigma.
  let jumpDays: number | null = null;
  const yr = c.slice(0, Math.min(252, c.length));
  if (yr.length >= 60) {
    const rets: number[] = [];
    for (let i = 1; i < yr.length; i++) rets.push(Math.log(yr[i - 1] / yr[i]));
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length - 1));
    jumpDays = sd > 0 ? rets.filter(r => Math.abs(r - mean) > 3 * sd).length : null;
  }

  return {
    pair,
    spot,
    asOf: rows[0].d,
    move30: pct(spot, at(21)),
    move90: pct(spot, at(63)),
    moveYtd: ytdRow ? pct(spot, Number(ytdRow.c)) : null,
    move1y: c.length > 250 ? pct(spot, at(251)) : null,
    vol30: annualisedVol(c.slice(0, 22)),
    vol90,
    volPercentile,
    volPercentileFrom,
    worst30,
    worst30Date,
    jumpDays,
    depth: c.length,
  };
}

/** A signed change, where direction is the point. */
const signed = (v: number | null) =>
  v === null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

/** A magnitude — volatility has no direction, so a + sign would be noise. */
const mag = (v: number | null) => (v === null ? "n/a" : `${v.toFixed(1)}%`);

/** 1st, 2nd, 3rd, 4th — including the teens, which are all "th". */
function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
}

/** Render one brief as lines the drafter can quote directly. */
export function renderBrief(b: PairBrief): string {
  const L: string[] = [];
  L.push(`${b.pair} — spot ${b.spot.toFixed(4)} as of ${b.asOf}`);
  L.push(
    `  moves: 30d ${signed(b.move30)}, 90d ${signed(b.move90)}, YTD ${signed(b.moveYtd)}, 1y ${signed(b.move1y)} ` +
    `(positive = local currency weaker against the base)`,
  );
  if (b.vol90 !== null) {
    const where =
      b.volPercentile === null ? ""
        : (() => {
            const span = b.volPercentileFrom ? ` measured since ${b.volPercentileFrom}` : "";
            const verdict =
              b.volPercentile >= 80 ? ", unusually disturbed"
              : b.volPercentile <= 20 ? ", unusually calm"
              : ", around normal";
            return ` — ${ordinal(b.volPercentile)} percentile${span}${verdict}`;
          })();
    L.push(`  realised volatility: 30d ${mag(b.vol30)}, 90d ${mag(b.vol90)}${where}`);
  }
  if (b.worst30 !== null && b.worst30 > 0) {
    L.push(`  worst 30-day move in 3 years: ${signed(b.worst30)} (to ${b.worst30Date})`);
  }
  if (b.jumpDays !== null) {
    L.push(
      `  days beyond 3 sigma in the last year: ${b.jumpDays}` +
      (b.jumpDays >= 3 ? " — steps rather than drifts, which is why cover is priced with a jump model" : ""),
    );
  }
  if (b.depth < 250) L.push(`  (only ${b.depth} closes available — do not quote the percentile)`);
  return L.join("\n");
}

/**
 * The brief for whatever a post is about.
 *
 * Returns an empty string rather than a default pair when nothing is mentioned.
 * A comment about Kenyan trade finance that cites Ghanaian data is worse than
 * one that cites no data, and the drafter is told it may say nothing at all.
 */
export async function briefForText(text: string): Promise<string> {
  const pairs = pairsMentioned(text);
  if (!pairs.length) return "";
  const briefs: string[] = [];
  for (const p of pairs) {
    try {
      const b = await briefFor(p);
      if (b) briefs.push(renderBrief(b));
    } catch {
      /* one pair failing must not lose the rest */
    }
  }
  return briefs.join("\n");
}
