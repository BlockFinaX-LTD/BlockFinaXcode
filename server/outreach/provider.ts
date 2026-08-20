/**
 * provider.ts, fetching LinkedIn posts without touching Anthony's account.
 *
 * LinkedIn's own API cannot search posts or read third-party profiles. Sign-In
 * and Share are the only self-serve products, and post search sits behind
 * partner programmes that take months and are usually refused. There is no
 * endpoint to apply for.
 *
 * So this goes through Apify, which runs its own infrastructure and takes no
 * cookies. That is a better position than a browser extension, not a worse one:
 * no account of ours is in the loop, so there is nothing of Anthony's for
 * LinkedIn to restrict.
 */

const ACTOR = "harvestapi~linkedin-post-search";

export interface RawItem {
  text?: unknown;
  url?: unknown;
  name?: unknown;
  headline?: unknown;
  /** When the post was published, ISO string, if the provider said. */
  postedAt?: unknown;
}

/**
 * Read a publication date from whatever shape the provider used.
 *
 * Accepts an ISO string, a millisecond epoch, or a second epoch, because all
 * three appear in scraper payloads and the difference between seconds and
 * milliseconds is the difference between 2026 and 1970. Anything that lands
 * outside a plausible window is discarded rather than stored, since a wrong
 * date is worse than none: it would tell Anthony a stale thread is fresh.
 */
export function readPostedAt(p: any): string | null {
  const raw =
    p?.postedAt ?? p?.publishedAt ?? p?.postedDate ?? p?.datePublished ??
    p?.date ?? p?.timestamp ?? p?.time ?? p?.createdAt ?? null;
  if (raw == null) return null;

  let d: Date | null = null;
  if (typeof raw === "number") {
    // Ten digits is seconds, thirteen is milliseconds.
    d = new Date(raw < 1e12 ? raw * 1000 : raw);
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      d = new Date(n < 1e12 ? n * 1000 : n);
    } else {
      d = new Date(trimmed);
    }
  }
  if (!d || Number.isNaN(d.getTime())) return null;

  const ms = d.getTime();
  const now = Date.now();
  // Nothing older than five years, and nothing more than a day in the future.
  if (ms < now - 5 * 365 * 86400_000 || ms > now + 86400_000) return null;
  return d.toISOString();
}

export interface SearchOutcome {
  query: string;
  items: RawItem[];
  fetched: number;
  error: string | null;
}

/**
 * Normalise one Apify result into the shape the drafter expects.
 *
 * Field names are tried against several candidates rather than read from one
 * path. The actor documents its output only as "post content, author details";
 * the exact keys are unpublished, and a scraper's payload follows LinkedIn's
 * markup, so it moves. Reading one guessed path would return zero results with
 * no error, which is the worst failure available. Trying a handful degrades to
 * a missing author name instead of a missing post.
 */
export function mapApifyPost(p: any): RawItem | null {
  if (!p || typeof p !== "object") return null;
  const text = p.content ?? p.text ?? p.postContent ?? p.description ?? "";
  if (typeof text !== "string" || !text.trim()) return null;

  const author = p.author ?? p.actor ?? p.poster ?? {};
  const url =
    p.url ?? p.postUrl ?? p.linkedinUrl ?? p.link ??
    author.linkedinUrl ?? author.profileUrl ?? null;

  return {
    text: text.trim(),
    url: typeof url === "string" ? url : null,
    name: author.name ?? author.fullName ?? p.authorName ?? null,
    headline: author.headline ?? author.position ?? author.occupation ?? p.authorHeadline ?? null,
    postedAt: readPostedAt(p),
  };
}

/**
 * Run one search.
 *
 * Resolves with an error string rather than throwing, because the automatic
 * scan runs several of these at once and one failing provider call must not
 * lose the other three. The caller decides whether a partial result is worth
 * reporting, and it usually is.
 */
export async function searchLinkedIn(
  token: string,
  query: string,
  opts: { maxPosts?: number; postedLimit?: string; sortBy?: string; timeoutMs?: number } = {},
): Promise<SearchOutcome> {
  const cap = Math.min(Math.max(Number(opts.maxPosts) || 50, 1), 200);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);

  try {
    const r = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          searchQueries: [query],
          maxPosts: cap,
          sortBy: opts.sortBy === "relevance" ? "relevance" : "date",
          postedLimit: ["1h", "24h", "week", "month"].includes(opts.postedLimit || "")
            ? opts.postedLimit
            : "month",
        }),
      },
    );
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { query, items: [], fetched: 0, error: `provider returned ${r.status}. ${body.slice(0, 160)}` };
    }
    const raw = await r.json();
    const posts = Array.isArray(raw) ? raw : [];
    return {
      query,
      items: posts.map(mapApifyPost).filter((x): x is RawItem => x !== null),
      fetched: posts.length,
      error: null,
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { query, items: [], fetched: 0, error: aborted ? "timed out" : "could not reach the provider" };
  } finally {
    clearTimeout(timer);
  }
}
