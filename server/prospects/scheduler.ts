/**
 * scheduler.ts, filling the pipeline without anybody opening the dashboard.
 *
 * ## What should and should not be automatic
 *
 * Finding businesses and writing a first draft are mechanical. There is no
 * judgement in deciding to search "freight forwarder in Tema" this week, and
 * making Anthony press a button for it turns a research tool into a chore that
 * only runs on the days he remembers.
 *
 * Approving is different, and stays manual because he asked for it. A cold
 * email goes out under his own name to a stranger, and the failure mode is not
 * one bad message but two hundred identical bad messages before anyone notices.
 * So this fills the queue and stops there. Nothing here can approve or send.
 *
 * ## Why it stops when the queue is full
 *
 * Discovery costs money at the provider. Spending it to find three hundred more
 * businesses while three hundred already sit unapproved is buying inventory
 * nobody is unpacking. The backpressure check is what keeps a scheduled job
 * from quietly running up a bill against work that is not being used.
 *
 * ## Why the seed cursor is stored
 *
 * The matrix of business types and cities is worked through in order and the
 * position is kept in the database. Restarting picks up where it left off
 * rather than searching Accra food importers again on every deploy, which would
 * cost money to rediscover rows that already exist.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { prospects } from "@shared/prospect-schema";
import { platformSettings } from "@shared/schema";
import { discoverProspects, SEED_QUERIES, SEED_LOCATIONS } from "./discover";
import { researchAndWrite } from "./write";

const CURSOR_KEY = "prospect_seed_cursor";
const LAST_RUN_KEY = "prospect_last_discovery";
/**
 * What the last cycle actually did.
 *
 * The first live run searched three seeds, inserted nothing, and reported it
 * only to a log nobody was reading. The console showed a zero, which is what a
 * working pipeline with nothing to find looks like as well as a broken one.
 * Storing the outcome makes the difference visible in the place people look.
 */
const LAST_RESULT_KEY = "prospect_last_result";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const TICK_MS = 15 * 60 * 1000;

/**
 * How many seeds to work through per cycle.
 *
 * One at a time would take two months to cover every business type in every
 * city, which is not the volume Anthony asked for. Three at a time is roughly
 * three weeks, and it is safe to be this aggressive only because of the
 * backpressure check below: the real limit on spending is how fast he approves,
 * not how fast the search runs.
 */
const SEEDS_PER_CYCLE = Number(process.env.PROSPECT_SEEDS_PER_CYCLE || 3);

/**
 * Stop discovering when this many are already waiting on a person.
 *
 * Finding three hundred more businesses while three hundred sit unapproved is
 * buying inventory nobody is unpacking, and it is billed per search. This is
 * what stops a scheduled job quietly running up a provider bill against work
 * that is not being used.
 */
const QUEUE_BACKPRESSURE = Number(process.env.PROSPECT_QUEUE_CAP || 250);

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Every (segment, query, location) combination, in a stable order. */
function seedMatrix(): Array<{ segment: string; query: string; location: string }> {
  const out: Array<{ segment: string; query: string; location: string }> = [];
  for (const location of SEED_LOCATIONS) {
    for (const [segment, queries] of Object.entries(SEED_QUERIES)) {
      for (const query of queries) out.push({ segment, query, location });
    }
  }
  return out;
}

async function readNumber(key: string): Promise<number> {
  try {
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, key)).limit(1);
    return row?.value ? Number(row.value) || 0 : 0;
  } catch {
    return 0;
  }
}

async function writeValue(key: string, value: string): Promise<void> {
  try {
    await db.insert(platformSettings)
      .values({ key, value, updatedBy: "prospect-scheduler" })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value, updatedAt: new Date(), updatedBy: "prospect-scheduler" },
      });
  } catch {
    /* a lost cursor costs one repeated search, not correctness */
  }
}

/** How many are sitting in the pipeline waiting on a human. */
async function awaitingPerson(): Promise<number> {
  try {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(prospects)
      .where(sql`${prospects.status} in ('new','drafted') and ${prospects.sentAt} is null`);
    return Number(row?.n) || 0;
  } catch {
    return QUEUE_BACKPRESSURE; // unreadable means do not spend money
  }
}

/** Draft for everything discovered but not yet written. */
async function draftPending(apiKey: string, model: string, limit: number): Promise<number> {
  const pending = await db.select().from(prospects)
    .where(and(eq(prospects.status, "new"), isNull(prospects.draftBody)))
    .limit(limit);

  let written = 0;
  for (const p of pending) {
    const w = await researchAndWrite(apiKey, model, {
      company: p.company, website: p.website, country: p.country,
      industry: p.industry, evidence: p.evidence, description: p.description,
      addressKind: p.addressKind,
    });
    if (!w) continue;
    await db.update(prospects).set({
      segment: w.segment, fit: w.fit, fitScore: w.fitScore, description: w.description,
      draftSubject: w.subject, draftBody: w.body,
      status: "drafted", updatedAt: new Date(),
    }).where(eq(prospects.id, p.id));
    written++;
  }
  return written;
}

async function tick(intervalMs: number): Promise<void> {
  if (running) return;

  const apifyToken = process.env.APIFY_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apifyToken || !apiKey) return;

  const last = await readNumber(LAST_RUN_KEY);
  if (last && Date.now() - last < intervalMs) return;

  running = true;
  try {
    const waiting = await awaitingPerson();
    if (waiting >= QUEUE_BACKPRESSURE) {
      // Not an error. Say it once and move the clock on, so this is not
      // re-evaluated every fifteen minutes for a week.
      console.log(
        `[Prospects] ${waiting} already waiting for approval, so no new search this cycle. ` +
        `Approve or discard some and it resumes.`,
      );
      await writeValue(LAST_RUN_KEY, String(Date.now()));
      return;
    }

    const matrix = seedMatrix();
    let cursor = (await readNumber(CURSOR_KEY)) % matrix.length;
    const lines: string[] = [];
    let inserted = 0;

    for (let i = 0; i < Math.max(1, SEEDS_PER_CYCLE); i++) {
      const seed = matrix[cursor];
      try {
        const found = await discoverProspects({
          token: apifyToken,
          query: seed.query,
          location: seed.location,
          segment: seed.segment,
          limit: 40,
        });
        inserted += found.inserted;
        lines.push(
          `"${seed.query}" in ${seed.location}: ${found.found} found, ${found.inserted} new, ` +
          `${found.duplicates} known, ${found.sendable} contactable` +
          (found.errors.length ? ` (${found.errors[0]})` : ""),
        );
      } catch (e) {
        lines.push(`"${seed.query}" in ${seed.location}: failed, ${e instanceof Error ? e.message : "unknown"}`);
      }
      cursor = (cursor + 1) % matrix.length;

      // Stop early if this cycle alone filled the queue, rather than running
      // the remaining seeds into a backlog nobody asked for.
      if (await awaitingPerson() >= QUEUE_BACKPRESSURE) {
        lines.push("queue filled, stopping this cycle early");
        break;
      }
    }

    // Draft for everything found, across all seeds, so nothing sits in the
    // pipeline as a bare company name with no message against it.
    const drafted = await draftPending(apiKey, (process.env.AGENT_MODEL || "claude-sonnet-5").trim(), 40);

    await writeValue(CURSOR_KEY, String(cursor));
    await writeValue(LAST_RUN_KEY, String(Date.now()));

    await writeValue(LAST_RESULT_KEY, JSON.stringify({
      at: new Date().toISOString(),
      inserted, drafted, lines: lines.slice(0, 6),
    }));

    console.log(
      `[Prospects] ${inserted} new businesses, ${drafted} drafted. ` +
      `Position ${cursor} of ${matrix.length}.\n  ${lines.join("\n  ")}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeValue(LAST_RESULT_KEY, JSON.stringify({
      at: new Date().toISOString(), inserted: 0, drafted: 0,
      lines: [`the cycle failed: ${message}`],
    }));
    console.error("[Prospects] Scheduled discovery threw:", err);
    // Move the clock on regardless, so one bad seed does not retry every
    // fifteen minutes until someone notices.
    await writeValue(LAST_RUN_KEY, String(Date.now()));
  } finally {
    running = false;
  }
}

/**
 * Where automatic discovery has got to, for the console.
 *
 * Shown so the pipeline filling itself is visible rather than mysterious. A
 * background job nobody can see the state of is one people assume is broken.
 */
export async function discoveryStatus(): Promise<{
  configured: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  position: number;
  total: number;
  seedsPerCycle: number;
  queueCap: number;
  waiting: number;
  paused: boolean;
  lastResult: { at: string; inserted: number; drafted: number; lines: string[] } | null;
}> {
  const matrix = seedMatrix();
  const last = await readNumber(LAST_RUN_KEY);
  const waiting = await awaitingPerson();

  let lastResult: any = null;
  try {
    const [row] = await db.select().from(platformSettings)
      .where(eq(platformSettings.key, LAST_RESULT_KEY)).limit(1);
    if (row?.value) lastResult = JSON.parse(row.value);
  } catch {
    /* a missing or unreadable summary is not worth failing the status for */
  }

  return {
    configured: !!(process.env.APIFY_TOKEN && process.env.ANTHROPIC_API_KEY),
    lastRunAt: last ? new Date(last).toISOString() : null,
    nextRunAt: last ? new Date(last + FOUR_HOURS_MS).toISOString() : null,
    position: (await readNumber(CURSOR_KEY)) % matrix.length,
    total: matrix.length,
    seedsPerCycle: SEEDS_PER_CYCLE,
    queueCap: QUEUE_BACKPRESSURE,
    waiting,
    paused: waiting >= QUEUE_BACKPRESSURE,
    lastResult,
  };
}

export function startProspectScheduler(intervalMs = FOUR_HOURS_MS): void {
  if (timer) return;
  timer = setInterval(() => { void tick(intervalMs); }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();

  void (async () => {
    const configured = !!(process.env.APIFY_TOKEN && process.env.ANTHROPIC_API_KEY);
    const last = await readNumber(LAST_RUN_KEY);
    console.log(
      `[Prospects] Discovery every ${Math.round(intervalMs / 3600000)}h, ` +
      `${SEEDS_PER_CYCLE} searches per cycle, across ${seedMatrix().length} ` +
      `business type and city combinations. ` +
      (!configured
        ? "Idle: APIFY_TOKEN or ANTHROPIC_API_KEY not set."
        : last
          ? `Last run ${new Date(last).toISOString()}.`
          : "No previous run, first search within fifteen minutes."),
    );
  })();
}

export function stopProspectScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
