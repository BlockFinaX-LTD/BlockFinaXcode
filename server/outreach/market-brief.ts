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
 *   realised vol (30d, 90d)   what separates "it moved" from "it moved
 *                             unusually", which most people arguing about
 *                             currencies never distinguish.
 *
 *   vol percentile            where today sits in the pair's own history. 18%
 *                             means nothing alone; 18% at the 87th percentile
 *                             means the market is disturbed.
 *
 *   worst 30-day move         what a business actually paid, last time.
 *
 *   jump days                 days that moved far more than an ordinary day.
 *                             Frontier currencies step rather than diffuse,
 *                             which is why the pricing engine runs Merton
 *                             rather than plain Black-Scholes.
 *
 * ## Why every figure is rendered twice
 *
 * The first drafts written against this brief were accurate and unreadable.
 * Two comments in a row cited "the 7th percentile of its range since 2003" and
 * "beyond 3 sigma", which is a phrase no importer has ever used about their own
 * money. The numbers were right and said nothing to the person meant to read
 * them.
 *
 * So each statistic is followed by a plain-English rendering and, where it
 * applies, by what it meant in money on a reference invoice. Supplying the
 * translation here rather than demanding it in the prompt means the drafter
 * picks between ready-made phrasings instead of inventing one under pressure,
 * which is where the jargon kept creeping back.
 *
 * The percentile is deliberately offered three ways. A single phrasing gets
 * reused verbatim across comments, and a run of comments that all sound alike
 * is what exposes a drafting tool.
 *
 * Nothing here is an opinion. The drafter is told to build the opinion.
 *
 * The rendered text avoids em dashes for the same reason persona.ts does: it
 * goes straight into the prompt, and a model matches the punctuation it is
 * shown far more reliably than it follows an instruction about punctuation.
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

/**
 * A reference invoice, for turning a percentage into money.
 *
 * Percentages are the language of the person who computed them. "The worst
 * 30-day move was +41.5%" is a fact about a series; "a $100,000 invoice would
 * have needed $41,500 more naira to settle" is a fact about a business, and the
 * second is the one a finance director recognises as their own problem.
 */
const REFERENCE_INVOICE = 100_000;

/**
 * Render one brief as lines the drafter can use.
 *
 * Every statistic is followed by what it means in plain terms, because the
 * drafts that came back from the first live scan were accurate and unreadable:
 * "the 7th percentile of its range since 2003" twice in two comments, plus
 * "beyond 3 sigma", which is a phrase no importer has ever used. The numbers
 * were right and said nothing to the person meant to read them.
 *
 * Supplying the translation here rather than asking for it in the prompt means
 * the model is choosing between ready-made plain-English phrasings instead of
 * inventing one under pressure, which is where the jargon crept back in.
 */
export function renderBrief(b: PairBrief): string {
  const L: string[] = [];
  L.push(`${b.pair}: spot ${b.spot.toFixed(4)} as of ${b.asOf}`);
  // Direction in words, not as a sign convention.
  //
  // This line used to print "30d -4.9%" with "(positive = local currency
  // weaker)" appended, and left the model to work out what a negative number
  // meant for an importer. It got it backwards in a live draft: the cedi had
  // strengthened nearly 5% and the comment told a Ghanaian CFO her orders were
  // arriving $4,900 more expensive. She would have known instantly.
  //
  // A parenthetical legend is an inference step, and inference steps are where
  // this fails. Saying "strengthened, so imports cost less" removes the step.
  const local = b.pair.split("/")[1] ?? "the local currency";
  const direction = (v: number | null): string => {
    if (v === null) return "no data";
    if (Math.abs(v) < 0.05) return "flat";
    return v > 0
      ? `${local} weaker by ${Math.abs(v).toFixed(1)}%, so imports cost more`
      : `${local} stronger by ${Math.abs(v).toFixed(1)}%, so imports cost less`;
  };
  L.push(`  last 30 days: ${direction(b.move30)}`);
  L.push(`  last 90 days: ${direction(b.move90)}`);
  L.push(`  year to date: ${direction(b.moveYtd)}`);
  if (b.move1y !== null) L.push(`  last 12 months: ${direction(b.move1y)}`);
  L.push(
    `  Say the direction as written above. Do not infer it from a sign, and never ` +
    `describe a strengthening currency as costing an importer more.`,
  );

  if (b.vol90 !== null) {
    L.push(`  realised volatility: 30d ${mag(b.vol30)}, 90d ${mag(b.vol90)}`);
    if (b.volPercentile !== null) {
      const years = b.volPercentileFrom
        ? new Date().getFullYear() - Number(b.volPercentileFrom)
        : null;
      const span = years && years > 1 ? `${years} years` : "the available history";
      // Meaning, not wording. An earlier version supplied a finished sentence
      // and three drafts in a row reproduced it almost verbatim, because a
      // ready-made phrase is easier to copy than to rewrite. Stating the fact
      // and withholding the phrasing forces the drafter to say it in its own
      // words, which is the only thing that produces variety.
      if (b.volPercentile <= 20) {
        L.push(
          `  meaning: only about ${b.volPercentile} stretches in every 100 across ${span} were ` +
          `this quiet. Unusually still. Put this in your own words.`,
        );
      } else if (b.volPercentile >= 80) {
        L.push(
          `  meaning: rougher than about ${b.volPercentile} stretches in every 100 across ${span}. ` +
          `Put this in your own words.`,
        );
      } else {
        L.push(`  meaning: ordinary conditions for this pair. Put this in your own words.`);
      }
    }
  }

  if (b.worst30 !== null && b.worst30 > 0) {
    const cost = Math.round((b.worst30 / 100) * REFERENCE_INVOICE);
    L.push(
      `  worst 30-day move in 3 years: ${signed(b.worst30)}, ending ${b.worst30Date}. ` +
      `In money: a $${REFERENCE_INVOICE.toLocaleString()} invoice needed roughly ` +
      `$${cost.toLocaleString()} more of local currency to settle, inside that one month. ` +
      `Use whichever of those two framings suits the sentence.`,
    );
  }

  if (b.jumpDays !== null && b.jumpDays > 0) {
    // "3 sigma" is not a phrase any importer uses. Say what it describes.
    L.push(
      `  outsized single days in the last year: ${b.jumpDays}. Days that moved several times ` +
      `further than a normal day, which a forecast built on averages never anticipates. ` +
      `Describe this in your own words, and never as "sigma".`,
    );
  }

  if (b.depth < 250) L.push(`  (only ${b.depth} closes available, so do not quote the percentile)`);
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
