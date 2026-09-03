/**
 * spec.ts — the rules, with nothing behind them.
 *
 * Split out because pipeline.ts and discover.ts both reach the database at
 * import time, which puts every rule they contain out of reach of a test. The
 * same split already exists in pricing, where bounds.ts and purchase-math.ts
 * were pulled out of quote-purchase.ts for exactly this reason.
 *
 * These are the decisions worth pinning: what counts as closed, what counts as
 * a duplicate, and what the sweep is allowed to keep. No imports at all.
 */

export const STAGES = [
  "candidate", "researching", "drafting", "submitted", "interview", "won", "lost", "passed",
] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Stages where the outcome is settled.
 *
 * These leave the working pipeline but are never deleted, so the sweep's
 * duplicate check still sees them. Without that, an opportunity deliberately
 * turned down comes back as a fresh candidate on the next run.
 */
export const CLOSED_STAGES: Stage[] = ["won", "lost", "passed"];

export const KINDS = ["grant", "accelerator", "vc", "competition", "other"] as const;

/** Anything unrecognised becomes "other" rather than being stored as typed. */
export function coerceKind(k: unknown): string {
  return typeof k === "string" && (KINDS as readonly string[]).includes(k) ? k : "other";
}

/** Loose enough that "Base Builder Grants" and "base  builder-grants " collide. */
export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Trailing slashes and case are not differences worth treating as ones. */
export function normUrl(u: string): string {
  return u.replace(/\/+$/, "").toLowerCase();
}

/**
 * Only an exact ISO date is accepted.
 *
 * Anything looser is dropped rather than parsed generously, because a wrong
 * deadline is something a founder plans a fortnight around, and Date can be
 * talked into a number for almost any string.
 */
export function parseDeadline(d: unknown): Date | null {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = new Date(d + "T00:00:00Z");
  return Number.isNaN(t.getTime()) ? null : t;
}

/** A model-supplied score is clamped, not trusted. */
export function clampFit(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Days until a deadline, or null when there is not one.
 *
 * Null rather than zero for rolling and undated entries: zero would sort them
 * alongside things due today and put them in every "closing soon" list forever.
 * Negative means the date has gone by.
 */
export function daysToDeadline(deadline: Date | null, now = Date.now()): number | null {
  if (!deadline) return null;
  return Math.round((deadline.getTime() - now) / 86400000);
}

/**
 * What BlockFinaX is, in the terms a funder would recognise.
 *
 * One copy, so the sweep and the fit score judge against the same description
 * and it can be corrected in one place when the business moves.
 */
export const PROFILE = `
BlockFinaX builds FX risk infrastructure for emerging markets, focused on
Africa. Importers and exporters buy cover against currency moves; underwriters
provide the capital and earn premiums. It runs on Base (Ethereum L2), settles in
USDC, and prices with a Merton jump-diffusion model calibrated to frontier
currencies. Incorporated in Delaware with a Ghanaian operating subsidiary.
Live on mainnet with real positions. Categories that fit: onchain/crypto
infrastructure, fintech, emerging markets, financial inclusion, trade finance,
climate and agriculture adaptation where FX risk is a barrier, Africa-focused
accelerators and funds.
`.trim();

export const DEFAULT_QUERIES = [
  "Base ecosystem builder grants 2026 application",
  "Africa fintech accelerator applications open 2026",
  "emerging markets financial inclusion grant fintech 2026",
  "stablecoin payments infrastructure grant programme",
  "trade finance innovation fund Africa application",
];
