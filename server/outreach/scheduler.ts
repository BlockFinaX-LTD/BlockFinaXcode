/**
 * scheduler.ts, the scan that runs on its own every five hours.
 *
 * ## Why the last run is stored in the database
 *
 * Railway restarts on every deploy, and an interval timer starts again from
 * zero each time. A scan costs money at the provider, so a naive setInterval
 * would bill a full scan on every push, which on a busy afternoon is several
 * scans nobody asked for and all of them finding the same posts.
 *
 * So the schedule is anchored to a timestamp in platform_settings rather than
 * to process uptime. On boot the scheduler works out how long is actually left
 * of the current interval and waits that long. A deploy therefore costs
 * nothing, and the cadence survives restarts.
 *
 * ## Why it checks rather than fires
 *
 * The timer ticks every ten minutes and asks whether five hours have passed.
 * A single long timer would be equivalent only if the process lived that long,
 * which it does not, and short ticks make the drift after a restart a few
 * minutes instead of a few hours.
 *
 * ## Why it refuses to overlap
 *
 * A scan takes a couple of minutes across several parallel provider calls. If
 * one is slow, the next tick must not start a second, both because it doubles
 * the bill and because two runs drafting the same posts race on the dedupe.
 */

import { lastScanAt, runAutoScan } from "./auto-scan";
import type { RawItem } from "./provider";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const TICK_MS = 10 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export interface SchedulerDeps {
  draft: (items: RawItem[], kind: any, threshold: number) => Promise<{
    drafted: number; considered: number; relevant: number; drafts: unknown[];
  }>;
}

async function tick(deps: SchedulerDeps, intervalMs: number): Promise<void> {
  if (running) return;

  const apifyToken = process.env.APIFY_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Not configured is not an error worth logging every ten minutes. The console
  // says plainly that search is unconfigured, and that is where someone looks.
  if (!apifyToken || !apiKey) return;

  const last = await lastScanAt();
  if (last && Date.now() - last.getTime() < intervalMs) return;

  running = true;
  const started = Date.now();
  try {
    const r = await runAutoScan({
      apifyToken,
      apiKey,
      model: (process.env.AGENT_MODEL || "claude-sonnet-5").trim(),
      intent: "comment",
      perQuery: 25,
      postedLimit: "week",
      draft: deps.draft,
      by: "scheduler",
    });
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(
      `[Outreach] Scan done in ${secs}s: ${r.searched.length} searches, ` +
      `${r.fetched} posts, ${r.relevant} relevant, ${r.drafted} drafted` +
      (r.plannerFallback ? " (planner fell back to standing angles)" : "") +
      (r.note ? ` — ${r.note}` : ""),
    );
    const failed = r.searched.filter(s => s.error);
    // Worth saying out loud: a scan that "found nothing" because the provider
    // was down looks identical to one that found nothing on LinkedIn.
    for (const f of failed) console.warn(`[Outreach] Search "${f.query}" failed: ${f.error}`);
  } catch (err) {
    console.error("[Outreach] Scheduled scan threw:", err);
  } finally {
    running = false;
  }
}

export function startOutreachScanner(deps: SchedulerDeps, intervalMs = FIVE_HOURS_MS): void {
  if (timer) return;
  // Deliberately no immediate run. Boot is exactly when a scan is least likely
  // to be wanted and most likely to be a duplicate of the one before the deploy.
  timer = setInterval(() => { void tick(deps, intervalMs); }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();

  void (async () => {
    const last = await lastScanAt();
    const dueIn = last ? Math.max(0, intervalMs - (Date.now() - last.getTime())) : 0;
    const configured = !!(process.env.APIFY_TOKEN && process.env.ANTHROPIC_API_KEY);
    console.log(
      `[Outreach] Automatic scan every ${Math.round(intervalMs / 3600000)}h. ` +
      (!configured
        ? "Idle: APIFY_TOKEN or ANTHROPIC_API_KEY not set."
        : last
          ? `Last run ${last.toISOString()}, next in about ${Math.round(dueIn / 60000)} minutes.`
          : "No previous run recorded, first scan within ten minutes."),
    );
  })();
}

export function stopOutreachScanner(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
