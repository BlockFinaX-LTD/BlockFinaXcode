/**
 * Pure rules of the Connector Programme: matching organisations, scoring the course,
 * reward periods, eligibility and statements. No database, so it is tested directly.
 */
import { randomBytes } from "node:crypto";
import {
  MODULES, PASS_MARK, REVENUE_SHARE, REWARD_MONTHS, moduleById,
  type LedgerKind, type MemberStatus,
} from "@shared/connector-programme";
import { ANSWERS } from "./course-answers";

const LEGAL_SUFFIXES = new Set([
  "ltd", "limited", "plc", "inc", "incorporated", "llc", "llp", "corp", "corporation", "co", "company",
  "sa", "sarl", "gmbh", "bv", "nv", "pty", "pte", "ag", "the", "group", "holdings",
]);

/** A comparable key for an organisation name: "The Acme Trading Co. Ltd" and "acme trading" match. */
export function orgKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\./g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !LEGAL_SUFFIXES.has(w))
    .join(" ")
    .trim();
}

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "outlook.com", "live.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "yandex.com",
]);

/** The organisation's own domain from a website or work email; null for free mail providers or junk. */
export function orgDomain(input?: string | null): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@").pop()!;
  s = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0]!.replace(/^www\./, "").replace(/:\d+$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return FREE_MAIL.has(s) ? null : s;
}

export interface ExistingRegistration {
  id: string;
  userId: number;
  orgKey: string;
  domain: string | null;
  status: string;
  createdAt: Date;
}

/**
 * Whether a new registration collides with one already on file. Declined registrations
 * never block, closed ones stop blocking after 12 months, and everything else blocks,
 * including the connector's own earlier registration (one organisation counts once).
 */
export function findConflict(
  candidate: { orgKey: string; domain: string | null },
  existing: ExistingRegistration[],
  now = new Date(),
): ExistingRegistration | null {
  const yearAgo = new Date(now);
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 12);
  for (const e of existing) {
    if (e.status === "declined") continue;
    if (e.status === "closed" && e.createdAt < yearAgo) continue;
    if (candidate.orgKey && e.orgKey === candidate.orgKey) return e;
    if (candidate.domain && e.domain === candidate.domain) return e;
  }
  return null;
}

export interface QuizResult {
  correct: number;
  total: number;
  score: number;
  passed: boolean;
  /** Question ids answered wrongly, so the reader knows what to revisit. */
  wrong: string[];
}

/** Marks one module. Unknown module throws; missing answers count as wrong. */
export function scoreModule(moduleId: string, answers: Record<string, unknown>): QuizResult {
  const mod = moduleById(moduleId);
  if (!mod) throw new Error(`Unknown module ${moduleId}`);
  const wrong: string[] = [];
  let correct = 0;
  for (const q of mod.questions) {
    const given = answers?.[q.id];
    if (typeof given === "number" && given === ANSWERS[q.id]) correct++;
    else wrong.push(q.id);
  }
  const total = mod.questions.length;
  const score = total ? correct / total : 0;
  return { correct, total, score, passed: score >= PASS_MARK, wrong };
}

/** "2026-Q4" for a date in October to December 2026. */
export function quarterOf(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** The last day of a quarter, plus 30 days: when its payment is due. */
export function paymentDue(quarter: string): Date {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) throw new Error(`Not a quarter: ${quarter}`);
  const end = new Date(Date.UTC(Number(m[1]), Number(m[2]) * 3, 0));
  end.setUTCDate(end.getUTCDate() + 30);
  return end;
}

/** The 12-month reward period that starts at the first revenue. */
export function rewardPeriod(firstRevenue: Date): { start: Date; end: Date } {
  const end = new Date(firstRevenue);
  end.setUTCMonth(end.getUTCMonth() + REWARD_MONTHS);
  return { start: new Date(firstRevenue), end };
}

export interface FeePosition {
  createdAt: number; // seconds
  fee: string;
}

/**
 * The revenue share a referred user has produced: 25% of protocol fees on their
 * contracts within 12 months of their first fee-paying contract. An estimate shown to
 * the connector; the quarterly ledger entry BlockFinaX records is what is paid.
 */
export function referralRevenue(positions: FeePosition[], now = new Date()) {
  const paid = positions
    .map((p) => ({ at: new Date(p.createdAt * 1000), fee: Number(p.fee) || 0 }))
    .filter((p) => p.fee > 0)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!paid.length) return { contracts: positions.length, fees: 0, share: 0, periodStart: null, periodEnd: null, active: false };
  const { start, end } = rewardPeriod(paid[0]!.at);
  const fees = paid.filter((p) => p.at >= start && p.at < end).reduce((s, p) => s + p.fee, 0);
  return {
    contracts: positions.length,
    fees: round2(fees),
    share: round2(fees * REVENUE_SHARE),
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    active: now < end,
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Readiness {
  status: MemberStatus | "none";
  agreementSigned: boolean;
  modulesPassed: string[];
  screening: string;
}

/** What still stands between a member and registering prospects or sharing a referral link. */
export function missingSteps(r: Readiness): string[] {
  const missing: string[] = [];
  if (r.status === "none") missing.push("Apply to join the programme");
  else if (r.status === "applied") missing.push("Wait for BlockFinaX to approve your application");
  else if (r.status === "paused") missing.push("Your access is paused; contact BlockFinaX");
  else if (r.status === "ended" || r.status === "declined") missing.push("Your membership is not active");
  if (!r.agreementSigned) missing.push("Sign your agreement");
  const needed = MODULES.filter((m) => m.required && !r.modulesPassed.includes(m.id));
  if (needed.length) missing.push(`Pass the training: ${needed.map((m) => m.title).join(", ")}`);
  if (r.screening === "hit") missing.push("Your screening needs review by BlockFinaX");
  return missing;
}

export interface LedgerLine {
  kind: LedgerKind;
  quarter: string;
  amountUsd: number;
}

/** Earned, paid and owed per quarter, oldest first, plus totals. Payments are recorded as positive amounts. */
export function statement(lines: LedgerLine[]) {
  const byQ = new Map<string, { quarter: string; earned: number; paid: number }>();
  for (const l of lines) {
    const q = byQ.get(l.quarter) ?? { quarter: l.quarter, earned: 0, paid: 0 };
    if (l.kind === "payment") q.paid += l.amountUsd;
    else q.earned += l.amountUsd;
    byQ.set(l.quarter, q);
  }
  const quarters = Array.from(byQ.values()).sort((a, b) => a.quarter.localeCompare(b.quarter))
    .map((q) => ({ ...q, earned: round2(q.earned), paid: round2(q.paid) }));
  const earned = round2(quarters.reduce((s, q) => s + q.earned, 0));
  const paid = round2(quarters.reduce((s, q) => s + q.paid, 0));
  return { quarters, earned, paid, owed: round2(earned - paid) };
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A referral code like "BFX7K2QMA": no 0/O, 1/I/L, easy to read aloud. */
export function newReferralCode(): string {
  const bytes = randomBytes(6);
  let s = "BFX";
  for (let i = 0; i < bytes.length; i++) s += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return s;
}

export function isReferralCode(s: unknown): s is string {
  return typeof s === "string" && /^BFX[A-HJ-NP-Z2-9]{6}$/.test(s);
}
