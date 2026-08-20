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
