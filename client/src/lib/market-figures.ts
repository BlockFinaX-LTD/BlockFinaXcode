/**
 * Market figures, each with the source it came from.
 *
 * Every number a prospect, investor or supervisor might check lives here and
 * nowhere else, so the pitch deck, the data room and the printed documents
 * cannot drift apart. If a figure has no `source`, it is our own projection
 * and must be labelled as one wherever it is shown.
 *
 * Replaced the previous $35B "annual SME FX losses" figure, which could not be
 * traced to any published report. An unverifiable headline is worse than a
 * smaller verifiable one: the first thing a serious reader does is look it up.
 */

export interface Figure {
  /** Numeric value in USD, for arithmetic. */
  value: number;
  /** How it should be written wherever it is displayed. */
  display: string;
  /** What the number actually measures. Not a slogan. */
  label: string;
  /** Where it came from. Omitted only for our own projections. */
  source?: string;
  year?: number;
}

/** All African merchandise trade. This is the trade that carries FX exposure. */
export const AFRICAN_TRADE: Figure = {
  value: 1_500_000_000_000,
  display: "$1.5T",
  label: "African merchandise trade",
  source: "Afreximbank, African Trade Report 2025",
  year: 2024,
};

/** Cross-border trade within Africa. A subset of the above, not a substitute. */
export const INTRA_AFRICAN_TRADE: Figure = {
  value: 220_300_000_000,
  display: "$220B",
  label: "Intra-African trade, 14.4% of formal African trade",
  source: "Afreximbank, African Trade Report 2025",
  year: 2024,
};

/**
 * Unmet demand for trade finance: the part of African trade that financial
 * institutions measurably do not serve. We use it as the addressable segment
 * because it is the closest published measure of the businesses we exist for,
 * and it is measured rather than assumed. It is a proxy, and is labelled as one.
 */
export const UNMET_TRADE_FINANCE: Figure = {
  value: 83_000_000_000, // midpoint of the published 74–92 range
  display: "$74–92B",
  label: "Unmet trade finance demand in Africa, 5.4% of merchandise trade",
  source: "African Development Bank, Trade Finance in Africa 2025",
  year: 2024,
};

/**
 * Evidence that the loss is real and large, from audited accounts rather than
 * from an estimate. Ten listed companies, one country, one year. These are the
 * businesses that DO have treasury teams and hedging access.
 */
export const NIGERIA_FX_LOSSES: Figure = {
  value: 1_400_000_000,
  display: "$1.4B",
  label: "FX losses booked by ten listed Nigerian companies in one year",
  source: "Company accounts, reported by Nairametrics",
  year: 2024,
};

/**
 * Annual move of the cedi against the dollar. The 2025 reversal is kept
 * deliberately: the risk we sell against is volatility in both directions, and
 * a pitch built on permanent depreciation is refuted by the most recent year.
 */
export const CEDI_MOVE: { year: number; pct: number; note: string }[] = [
  { year: 2022, pct: -40.0, note: "depreciated" },
  { year: 2023, pct: -32.5, note: "depreciated" },
  { year: 2024, pct: -29.1, note: "depreciated" },
  { year: 2025, pct: +37.4, note: "appreciated, year to 17 October" },
];

/** Convenience aliases used by the market-sizing sections. */
export const TAM = AFRICAN_TRADE;
export const SAM = UNMET_TRADE_FINANCE;

/** Attribution line to print under any block that shows these figures. */
export const SOURCES_NOTE =
  "Sources: Afreximbank African Trade Report 2025; African Development Bank " +
  "Trade Finance in Africa 2025; Bank of Ghana; company accounts.";
