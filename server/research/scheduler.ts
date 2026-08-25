/**
 * scheduler.ts, the morning briefing.
 *
 * Runs once a day rather than on an interval, because "every morning" is what
 * was asked for and an interval drifts: a six hourly job started at noon
 * briefs at midnight forever after.
 *
 * The last run date is stored, so a deploy at nine in the morning does not
 * produce a second briefing, and a server that was asleep at six still briefs
 * when it wakes.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { platformSettings } from "@shared/schema";
import { buildDigest } from "./digest";

const KEY = "research_last_digest";
const TICK_MS = 20 * 60 * 1000;
/** Local hour to brief at. Anthony is in Ghana, which is UTC. */
const HOUR = Number(process.env.RESEARCH_DIGEST_HOUR || 6);

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

async function lastRunDay(): Promise<string | null> {
  try {
    const [row] = await db.select().from(platformSettings)
      .where(eq(platformSettings.key, KEY)).limit(1);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function markRun(day: string): Promise<void> {
  try {
    await db.insert(platformSettings)
      .values({ key: KEY, value: day, updatedBy: "research" })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: day, updatedAt: new Date(), updatedBy: "research" },
      });
  } catch {
    /* a lost marker costs one duplicate run, not correctness */
  }
}

async function tick(): Promise<void> {
  if (running) return;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const now = new Date();
  if (now.getUTCHours() < HOUR) return;
  const today = dayKey(now);
  if (await lastRunDay() === today) return;

  running = true;
  try {
    // Marked before the work, not after. A digest takes minutes, and a second
    // tick landing mid-run would otherwise start another one.
    await markRun(today);
    const r = await buildDigest(apiKey, (process.env.AGENT_MODEL || "claude-sonnet-5").trim());
    console.log(
      `[Research] ${today}: ${r.fetched} fetched, ${r.fresh} new, ${r.briefed} briefed.` +
      (r.errors.length ? ` Problems: ${r.errors.slice(0, 3).join("; ")}` : ""),
    );
  } catch (err) {
    console.error("[Research] Digest threw:", err);
  } finally {
    running = false;
  }
}

export function startResearchDigest(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  void (async () => {
    const last = await lastRunDay();
    console.log(
      `[Research] Morning digest after ${HOUR}:00 UTC. ` +
      (process.env.ANTHROPIC_API_KEY
        ? `Last run ${last ?? "never"}.`
        : "Idle: ANTHROPIC_API_KEY not set."),
    );
  })();
}

export async function digestStatus(): Promise<{ lastRunDay: string | null; hourUtc: number }> {
  return { lastRunDay: await lastRunDay(), hourUtc: HOUR };
}
