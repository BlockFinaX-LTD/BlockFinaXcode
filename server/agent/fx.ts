/**
 * Currency data for Finax.
 *
 * There are 482,903 historical closes across 86 pairs in the database, going
 * back to 2001 for some. It is the best material the assistant has for
 * explaining why cover is worth buying — but it cannot be handed to a language
 * model raw, because some of it is wrong.
 *
 * ## The bad ticks
 *
 * USD/GHS has a recorded close of 573.00 on 2020-03-30 and 151.50 on
 * 2011-07-19. The cedi traded near 5.6 and 1.5 respectively. USD/NGN and
 * USD/ETB both have closes of exactly 1.000. These are feed artefacts.
 *
 * Asked "how bad has the cedi been?", an assistant reading the maximum would
 * answer "it reached 573" — absurd on its face to a Ghanaian customer, and
 * enough to end their trust in everything else it says. Every series is
 * therefore cleaned before anything is computed from it.
 *
 * The filter is deliberately LOCAL. A global one would be wrong: the naira
 * genuinely went from 130 to 1,600 over the window, so a point far from the
 * series mean is often a real trend rather than an error. What a bad tick
 * looks like is a spike that its own immediate neighbours contradict — so each
 * point is judged against the median of the days around it, and nothing else.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { historicalFxCloses, rateSnapshots } from "@shared/schema";

export interface Close {
  date: string;
  close: number;
}

const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Drops points their own neighbours contradict.
 *
 * `window` is each side, so 5 compares against the surrounding fortnight.
 * `tolerance` of 0.4 means a point more than 40% away from that local median
 * is treated as a feed error. Real FX, even in a currency crisis, does not
 * move 40% in a day and then back again — the cedi's worst year was roughly
 * 50% over twelve months, not overnight.
 */
export function dropBadTicks(series: Close[], window = 5, tolerance = 0.4): { clean: Close[]; dropped: Close[] } {
  const clean: Close[] = [];
  const dropped: Close[] = [];

  for (let i = 0; i < series.length; i++) {
    const from = Math.max(0, i - window);
    const to = Math.min(series.length, i + window + 1);
    const neighbours: number[] = [];
    for (let j = from; j < to; j++) if (j !== i) neighbours.push(series[j].close);

    const local = median(neighbours);
    const point = series[i].close;

    const bad =
      !Number.isFinite(point) ||
      point <= 0 ||
      (Number.isFinite(local) && local > 0 && Math.abs(point - local) / local > tolerance);

    (bad ? dropped : clean).push(series[i]);
  }
  return { clean, dropped };
}

/** Cleaned daily closes for a pair, oldest first. */
export async function history(pair: string, years = 5): Promise<{ clean: Close[]; droppedCount: number }> {
  const cutoff = new Date(Date.now() - years * 365 * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ date: historicalFxCloses.date, close: historicalFxCloses.close })
    .from(historicalFxCloses)
    .where(and(eq(historicalFxCloses.pair, pair), gte(historicalFxCloses.date, cutoff)))
    .orderBy(historicalFxCloses.date);

  const series: Close[] = rows
    .map((r) => ({ date: String(r.date).slice(0, 10), close: num(r.close) }))
    .filter((r) => Number.isFinite(r.close));

  const { clean, dropped } = dropBadTicks(series);
  return { clean, droppedCount: dropped.length };
}

/** The most recent live rate, from the oracle snapshots. */
export async function liveRate(pair: string): Promise<{ rate: number; at: Date | null } | null> {
  const [row] = await db
    .select()
    .from(rateSnapshots)
    .where(eq(rateSnapshots.pair, pair))
    .orderBy(desc(rateSnapshots.recordedAt))
    .limit(1);
  if (!row) return null;
  const rate = num(row.rate);
  return Number.isFinite(rate) ? { rate, at: row.recordedAt } : null;
}

/** Pairs we actually have usable history for. */
export async function availablePairs(): Promise<string[]> {
  const rows = await db
    .select({ pair: historicalFxCloses.pair, n: sql<number>`count(*)::int` })
    .from(historicalFxCloses)
    .groupBy(historicalFxCloses.pair)
    .having(sql`count(*) > 250`);
  return rows.map((r) => r.pair).sort();
}

// ── Analysis ──────────────────────────────────────────────────────────────

export interface PairSummary {
  pair: string;
  liveRate: number | null;
  asOf: string | null;
  changes: { period: string; percent: number }[];
  /** Largest adverse move over a rolling window of this length. */
  worstMove: { days: number; percent: number; from: string; to: string } | null;
  annualVolatilityPercent: number | null;
  regime: "stable" | "volatile" | "extreme" | "unknown";
  observations: number;
  ticksDropped: number;
  note?: string;
}

const pctChange = (a: number, b: number) => ((b - a) / a) * 100;

/** Close nearest to `daysAgo`, so a missing day doesn't break the comparison. */
function closeNearest(series: Close[], daysAgo: number): Close | null {
  if (!series.length) return null;
  const target = Date.now() - daysAgo * 86_400_000;
  let best: Close | null = null;
  let bestGap = Infinity;
  for (const c of series) {
    const gap = Math.abs(new Date(c.date).getTime() - target);
    if (gap < bestGap) { bestGap = gap; best = c; }
  }
  // More than three weeks off is not a comparison worth reporting.
  return bestGap > 21 * 86_400_000 ? null : best;
}

/**
 * How a currency has actually behaved.
 *
 * A rising USD/XXX means the local currency is weakening, which is the
 * direction an importer is exposed to — so `worstMove` looks for the largest
 * RISE, not the largest absolute change.
 */
export async function summarise(pair: string, years = 5, windowDays = 60): Promise<PairSummary> {
  const { clean, droppedCount } = await history(pair, years);
  const live = await liveRate(pair);

  const base: PairSummary = {
    pair,
    liveRate: live?.rate ?? null,
    asOf: live?.at ? new Date(live.at).toISOString().slice(0, 10) : null,
    changes: [],
    worstMove: null,
    annualVolatilityPercent: null,
    regime: "unknown",
    observations: clean.length,
    ticksDropped: droppedCount,
  };

  if (clean.length < 30) {
    return { ...base, note: `Only ${clean.length} usable observations for ${pair} — too few to characterise.` };
  }

  const latest = clean[clean.length - 1];
  for (const [label, days] of [["30 days", 30], ["90 days", 90], ["1 year", 365], ["3 years", 1095]] as const) {
    const then = closeNearest(clean, days);
    if (then && then.date !== latest.date) {
      base.changes.push({ period: label, percent: Number(pctChange(then.close, latest.close).toFixed(1)) });
    }
  }

  // Worst adverse move over any rolling window of `windowDays`.
  let worst = { percent: 0, from: "", to: "" };
  for (let i = 0; i < clean.length; i++) {
    const startTime = new Date(clean[i].date).getTime();
    for (let j = i + 1; j < clean.length; j++) {
      const span = (new Date(clean[j].date).getTime() - startTime) / 86_400_000;
      if (span > windowDays) break;
      const move = pctChange(clean[i].close, clean[j].close);
      if (move > worst.percent) worst = { percent: move, from: clean[i].date, to: clean[j].date };
    }
  }
  if (worst.percent > 0) {
    base.worstMove = { days: windowDays, percent: Number(worst.percent.toFixed(1)), from: worst.from, to: worst.to };
  }

  // Annualised volatility from daily log returns.
  const returns: number[] = [];
  for (let i = 1; i < clean.length; i++) {
    const r = Math.log(clean[i].close / clean[i - 1].close);
    if (Number.isFinite(r)) returns.push(r);
  }
  if (returns.length > 30) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const annual = Math.sqrt(variance) * Math.sqrt(252) * 100;
    base.annualVolatilityPercent = Number(annual.toFixed(1));
    // Bands chosen to match the language already used on the liquidity-provider
    // page, so the assistant and the site describe a currency the same way.
    base.regime = annual < 8 ? "stable" : annual < 20 ? "volatile" : "extreme";
  }

  return base;
}

export interface Scenario {
  pair: string;
  notionalUsd: number;
  tenorDays: number;
  premiumRatePercent: number;
  premiumCostUsd: number;
  /** How often a move of at least `triggerPercent` happened historically. */
  triggerPercent: number;
  windowsExamined: number;
  windowsTriggered: number;
  historicalTriggerRate: number;
  worstCaseMovePercent: number | null;
  worstCaseLossUsd: number | null;
  note: string;
}

/**
 * A worked example built from what actually happened, not from a model.
 *
 * Answers the only question a customer really asks: "would this have been
 * worth buying?" Historical frequency is not a prediction and the note says
 * so — but it is a far better starting point than an invented illustration,
 * and it is checkable against a chart they can find themselves.
 */
export async function scenario(args: {
  pair: string;
  notionalUsd: number;
  tenorDays?: number;
  premiumRatePercent?: number;
  triggerPercent?: number;
  years?: number;
}): Promise<Scenario> {
  const { pair, notionalUsd } = args;
  const tenorDays = args.tenorDays ?? 60;
  const premiumRatePercent = args.premiumRatePercent ?? 1;
  const triggerPercent = args.triggerPercent ?? 5;
  const { clean } = await history(pair, args.years ?? 5);

  let windows = 0;
  let triggered = 0;
  let worst = 0;

  for (let i = 0; i < clean.length; i++) {
    const start = new Date(clean[i].date).getTime();
    let end: Close | null = null;
    for (let j = i + 1; j < clean.length; j++) {
      const span = (new Date(clean[j].date).getTime() - start) / 86_400_000;
      if (span >= tenorDays) { end = clean[j]; break; }
    }
    if (!end) break;
    windows += 1;
    const move = pctChange(clean[i].close, end.close);
    if (move >= triggerPercent) triggered += 1;
    if (move > worst) worst = move;
  }

  const premiumCost = (notionalUsd * premiumRatePercent) / 100;
  return {
    pair,
    notionalUsd,
    tenorDays,
    premiumRatePercent,
    premiumCostUsd: Number(premiumCost.toFixed(2)),
    triggerPercent,
    windowsExamined: windows,
    windowsTriggered: triggered,
    historicalTriggerRate: windows ? Number(((triggered / windows) * 100).toFixed(1)) : 0,
    worstCaseMovePercent: worst > 0 ? Number(worst.toFixed(1)) : null,
    worstCaseLossUsd: worst > 0 ? Number(((notionalUsd * worst) / 100).toFixed(2)) : null,
    note:
      "Based on actual daily closes, with feed errors removed. Past frequency is not a forecast — " +
      "it describes what has happened, not what will.",
  };
}
