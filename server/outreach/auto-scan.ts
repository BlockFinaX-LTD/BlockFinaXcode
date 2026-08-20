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

  await recordScanAt(new Date(), opts.by || "scheduler");

  if (!merged.length) {
    return {
      drafted: 0, relevant: 0, considered: 0, fetched, drafts: [],
      plan: plan.searches, plannerFallback: plan.fallback, searched,
      note: allFailed
        ? "Every search failed to reach the provider."
        : "LinkedIn returned nothing for any of the planned searches.",
    };
  }

  const out = await opts.draft(merged, opts.intent, typeof opts.minScore === "number" ? opts.minScore : 2);
  return {
    ...out, fetched,
    plan: plan.searches, plannerFallback: plan.fallback, searched,
  };
}
