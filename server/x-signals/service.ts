/**
 * Storage and the twice-daily run for X signals (see ./search.ts).
 *
 *   x_signals       one row per public post found, with its score and review status
 *   x_signal_runs   one row per run: when, how many pages and posts, and any error
 *
 * Idle until TWITTERAPI_IO_KEY is set. Only public post fields are kept, and rows are
 * deleted on a schedule: dismissed after 30 days, everything else after 90.
 */
import { TOPICS, isNoise, score, searchTopic, type Post } from "./search";
import { classify } from "./classify";

export const RUN_EVERY_MS = 12 * 60 * 60 * 1000;
/** Pages per topic per run (20 posts a page). 7 topics x 2 pages x 20 = 280 posts, about 4 cents. */
const maxPages = () => Math.max(1, Math.min(5, Number(process.env.X_SIGNALS_MAX_PAGES || 2)));
const apiKey = () => (process.env.TWITTERAPI_IO_KEY || "").trim();
/** twitterapi.io's free tier allows one request every 5 seconds; paid plans can lower this. */
const gapMs = () => Math.max(0, Number(process.env.X_SIGNALS_REQUEST_GAP_MS ?? 5500));
export const xSignalsConfigured = () => !!apiKey();

let ready: Promise<void> | null = null;
export async function xSignalsDb() {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  const pending = (ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS x_signals (
      tweet_id text PRIMARY KEY,
      url text NOT NULL,
      text text NOT NULL,
      topic text NOT NULL,
      author_handle text NOT NULL,
      author_name text NOT NULL,
      author_followers integer NOT NULL DEFAULT 0,
      author_location text,
      author_bio text,
      posted_at timestamptz NOT NULL,
      likes integer NOT NULL DEFAULT 0,
      replies integer NOT NULL DEFAULT 0,
      reposts integer NOT NULL DEFAULT 0,
      quotes integer NOT NULL DEFAULT 0,
      views integer NOT NULL DEFAULT 0,
      score integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'new',
      note text,
      found_at timestamptz NOT NULL DEFAULT now(),
      reviewed_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS x_signals_status_idx ON x_signals (status, score DESC);
    ALTER TABLE x_signals ADD COLUMN IF NOT EXISTS keyword_score integer;
    ALTER TABLE x_signals ADD COLUMN IF NOT EXISTS ai_kind text;
    ALTER TABLE x_signals ADD COLUMN IF NOT EXISTS ai_reason text;
    CREATE TABLE IF NOT EXISTS x_signal_runs (
      id serial PRIMARY KEY,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      trigger text NOT NULL,
      pages integer NOT NULL DEFAULT 0,
      found integer NOT NULL DEFAULT 0,
      kept integer NOT NULL DEFAULT 0,
      error text
    );
  `).then(() => undefined));
  await pending;
  return pool;
}

/** True when the post is new; a post seen before only has its counts refreshed. */
async function store(topic: string, p: Post): Promise<boolean> {
  const db = await xSignalsDb();
  // The same text from the same account (reposted adverts, cross-posts) is kept once.
  const dup = await db.query(`SELECT 1 FROM x_signals WHERE author_handle = $1 AND left(text, 120) = left($2, 120) AND tweet_id <> $3 LIMIT 1`,
    [p.author.handle, p.text, p.id]);
  if (dup.rowCount) return false;
  const { rows } = await db.query(
    `INSERT INTO x_signals (tweet_id, url, text, topic, author_handle, author_name, author_followers, author_location, author_bio,
       posted_at, likes, replies, reposts, quotes, views, score, keyword_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
     ON CONFLICT (tweet_id) DO UPDATE SET likes = EXCLUDED.likes, replies = EXCLUDED.replies, reposts = EXCLUDED.reposts,
       quotes = EXCLUDED.quotes, views = EXCLUDED.views
     RETURNING (xmax = 0) AS inserted`,
    [p.id, p.url, p.text.slice(0, 2000), topic, p.author.handle, p.author.name.slice(0, 200), p.author.followers,
     p.author.location.slice(0, 200) || null, p.author.bio.slice(0, 600) || null, p.createdAt,
     p.likes, p.replies, p.reposts, p.quotes, p.views, score(p)],
  );
  return rows[0]?.inserted === true;
}

let running = false;

/** One run over every topic. Returns what it did; never throws for a single topic's failure. */
export async function runXSignals(trigger: "schedule" | "manual") {
  const key = apiKey();
  if (!key) throw new Error("Set TWITTERAPI_IO_KEY to turn on X signals");
  if (running) throw new Error("A run is already in progress");
  running = true;
  const db = await xSignalsDb();
  const { rows } = await db.query(`INSERT INTO x_signal_runs (trigger) VALUES ($1) RETURNING id`, [trigger]);
  const runId = rows[0].id as number;
  let pages = 0, found = 0, kept = 0;
  const errors: string[] = [];
  const fresh: Post[] = [];
  try {
    // Since the last finished run, or the last 24 hours on the first run; never more than 3 days back.
    const last = await db.query(`SELECT max(started_at) AS at FROM x_signal_runs WHERE finished_at IS NOT NULL AND error IS NULL`);
    const floor = Date.now() - 3 * 86_400_000;
    const since = Math.floor(Math.max(floor, last.rows[0]?.at ? new Date(last.rows[0].at).getTime() : Date.now() - 86_400_000) / 1000);
    for (const topic of TOPICS) {
      try {
        const r = await searchTopic(key, topic, since, maxPages(), fetch, gapMs());
        pages += r.pages;
        found += r.posts.length;
        for (const p of r.posts) if (!isNoise(p, topic) && (await store(topic.key, p))) { kept += 1; fresh.push(p); }
      } catch (e) {
        errors.push(`${topic.label}: ${(e as Error).message}`);
      }
    }
    // Claude's read replaces the keyword score where it is available; news, politics and
    // adverts it recognises are dismissed straight away so the review list stays short.
    try {
      const verdicts = await classify(fresh.map((p) => ({ id: p.id, text: p.text, handle: p.author.handle, bio: p.author.bio, location: p.author.location })));
      for (const v of verdicts) {
        const drop = ["news", "politics", "advert"].includes(v.kind) && v.relevance < 30;
        await db.query(`UPDATE x_signals SET score = $2, ai_kind = $3, ai_reason = $4, status = CASE WHEN $5 THEN 'dismissed' ELSE status END WHERE tweet_id = $1`,
          [v.id, v.relevance, v.kind, v.reason, drop]);
      }
    } catch (e) {
      errors.push(`Claude review skipped: ${(e as Error).message.slice(0, 160)}`);
    }
    await db.query(`DELETE FROM x_signals WHERE (status = 'dismissed' AND found_at < now() - interval '30 days') OR found_at < now() - interval '90 days'`);
  } finally {
    await db.query(`UPDATE x_signal_runs SET finished_at = now(), pages = $2, found = $3, kept = $4, error = $5 WHERE id = $1`,
      [runId, pages, found, kept, errors.length ? errors.join("; ").slice(0, 1000) : null]);
    running = false;
  }
  return { pages, found, kept, errors };
}

export async function lastRun() {
  const db = await xSignalsDb();
  const { rows } = await db.query(`SELECT * FROM x_signal_runs ORDER BY started_at DESC LIMIT 1`);
  return rows[0] ?? null;
}

let timer: NodeJS.Timeout | null = null;

/** Checks every hour and runs when the last run is 12 hours old, so restarts do not cause extra runs. */
export function startXSignalsScheduler() {
  if (timer) return;
  if (!xSignalsConfigured()) {
    console.log("[XSignals] Idle: TWITTERAPI_IO_KEY not set.");
    return;
  }
  const check = async () => {
    try {
      const last = await lastRun();
      if (last && Date.now() - new Date(last.started_at).getTime() < RUN_EVERY_MS) return;
      const r = await runXSignals("schedule");
      console.log(`[XSignals] ${r.kept} new of ${r.found} posts, ${r.pages} pages${r.errors.length ? `; ${r.errors.length} topic errors` : ""}`);
    } catch (e) {
      console.error("[XSignals] run failed:", (e as Error).message);
    }
  };
  timer = setInterval(check, 60 * 60 * 1000);
  setTimeout(check, 60_000);
  console.log("[XSignals] Searching X every 12 hours.");
}
