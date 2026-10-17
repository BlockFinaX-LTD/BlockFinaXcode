/**
 * auto-scan.ts, one run of the automatic scan.
 *
 * Separated from the route so the scheduler and the button share it exactly. A
 * scheduled job that reimplements what the button does is a job that drifts
 * from it, and the drift is invisible until the drafts stop matching.
 */

import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { platformSettings } from "@shared/schema";
import { planSearches, type PlannedSearch } from "./planner";
import { searchLinkedIn, type RawItem } from "./provider";

export interface ScanResult {
  drafted: number;
  relevant: number;
  considered: number;
  fetched: number;
  drafts: unknown[];
  plan: PlannedSearch[];
  plannerFallback: boolean;
  searched: Array<{ query: string; fetched: number; error: string | null }>;
  note?: string;
}

export const LAST_SCAN_KEY = "outreach_last_auto_scan";

/** When the scheduler last completed a run. Null if it never has. */
export async function lastScanAt(): Promise<Date | null> {
  try {
    const [row] = await db.select().from(platformSettings)
      .where(eq(platformSettings.key, LAST_SCAN_KEY)).limit(1);
    if (!row?.value) return null;
    const d = new Date(row.value);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

async function recordScanAt(when: Date, by: string): Promise<void> {
  try {
    await db.insert(platformSettings)
      .values({ key: LAST_SCAN_KEY, value: when.toISOString(), updatedBy: by })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: when.toISOString(), updatedAt: new Date(), updatedBy: by },
      });
  } catch {
    /* a failed timestamp write must not lose the drafts that were just made */
  }
}

/**
 * Run one scan: plan, search in parallel, merge, draft.
 *
 * `draft` is injected rather than imported to avoid a cycle, since the routes
 * module already imports this one.
 */
export async function runAutoScan(opts: {
  apifyToken: string;
  apiKey: string;
  model: string;
  intent: any;
  perQuery?: number;
  postedLimit?: string;
  minScore?: number;
  draft: (items: RawItem[], kind: any, threshold: number) => Promise<{
    drafted: number; considered: number; relevant: number; drafts: unknown[];
  }>;
  by?: string;
}): Promise<ScanResult> {
  const cap = Math.min(Math.max(Number(opts.perQuery) || 25, 5), 50);
  const plan = await planSearches(opts.apiKey, opts.model);

  const outcomes = await Promise.all(
    plan.searches.map(sq =>
      searchLinkedIn(opts.apifyToken, sq.query, {
        maxPosts: cap,
        postedLimit: ["24h", "week", "month"].includes(opts.postedLimit || "") ? opts.postedLimit : "week",
        sortBy: "relevance",
        timeoutMs: 100_000,
      }),
    ),
  );

  // Merge before drafting rather than drafting per query. Two angles will
  // surface the same post, and the drafter can only rank what it is shown at
  // once; ranking each query separately would draft the best of a weak query
  // ahead of the second best of a strong one.
  const merged: RawItem[] = [];
  const seen = new Set<string>();
  for (const o of outcomes) {
    for (const it of o.items) {
      const u = typeof it.url === "string" ? it.url : "";
      if (u && seen.has(u)) continue;
      if (u) seen.add(u);
      merged.push(it);
    }
  }

  const fetched = outcomes.reduce((n, o) => n + o.fetched, 0);
  const searched = outcomes.map(o => ({ query: o.query, fetched: o.fetched, error: o.error }));
  const allFailed = outcomes.length > 0 && outcomes.every(o => o.error);

  /**
   * Say which kind of failure it was.
   *
   * Every error used to be reported as "failed to reach the provider", including
   * the ones where the provider answered immediately and told us exactly what was
   * wrong. A 402 carrying "not-enough-usage-to-run-paid-actor" means the account
   * is out of credit, and calling that a connectivity failure sends the reader to
   * rotate an API key that was never the problem.
   *
   * The provider layer already keeps the status and the body. This only has to
   * stop discarding what it captured.
   */
  const errors = outcomes.map(o => o.error || "").filter(Boolean);
  const outOfCredit = errors.some(e => /not-enough-usage|exceed your remaining usage|\b402\b/i.test(e));
  const rejected = errors.some(e => /provider returned (4|5)\d\d/i.test(e));
  const unreachable = errors.some(e => /could not reach|timed out/i.test(e));

  const failureNote = outOfCredit
    ? "The scraping provider refused the job: the account is out of credit. " +
      "Top up the Apify balance. A new API token will not help, the limit is on the account."
    : rejected
      ? `The provider was reached and refused the request. First error: ${errors[0].slice(0, 200)}`
      : unreachable
        ? "Could not reach the provider. Check network access and that APIFY_TOKEN is set."
        : "Every search failed.";

  await recordScanAt(new Date(), opts.by || "scheduler");

  if (!merged.length) {
    return {
      drafted: 0, relevant: 0, considered: 0, fetched, drafts: [],
      plan: plan.searches, plannerFallback: plan.fallback, searched,
      note: allFailed
        ? failureNote
        : "LinkedIn returned nothing for any of the planned searches.",
    };
  }

  const out = await opts.draft(merged, opts.intent, typeof opts.minScore === "number" ? opts.minScore : 2);
  return {
    ...out, fetched,
    plan: plan.searches, plannerFallback: plan.fallback, searched,
  };
}
