/**
 * X signals: public posts on X where people talk about the currency problems BlockFinaX
 * solves, found with twitterapi.io's advanced search and ranked for review.
 *
 * Read only. Nothing here posts, likes, follows or messages: reaching out stays a human
 * reply on X, which is both what X's ranking rewards and what privacy law allows.
 *
 * Cost: twitterapi.io charges about $0.15 per 1,000 posts (a page is up to 20). With the
 * defaults below a run reads at most TOPICS x pages x 20 posts.
 */

export interface Topic {
  key: string;
  label: string;
  /** X search syntax. Retweets are excluded so each post is someone's own words. */
  query: string;
}

export const TOPICS: Topic[] = [
  { key: "ngn", label: "Naira pain",
    query: '(naira OR NGN) (supplier OR invoice OR import OR importer OR "dollar rate" OR "exchange rate" OR "fx") -filter:retweets lang:en' },
  { key: "ghs", label: "Cedi pain",
    query: '(cedi OR GHS) (supplier OR invoice OR import OR importer OR "exchange rate" OR depreciation) -filter:retweets lang:en' },
  { key: "kes", label: "Shilling pain",
    query: '("kenya shilling" OR KES) (supplier OR invoice OR import OR "exchange rate") -filter:retweets lang:en' },
  { key: "hedging", label: "FX risk in Africa",
    query: '("fx risk" OR "currency risk" OR "exchange rate risk" OR hedging OR "fx hedge") (Africa OR Nigeria OR Ghana OR Kenya) -filter:retweets lang:en' },
  { key: "partners", label: "Partners and connectors",
    query: '("trade finance" OR "cross-border payments" OR treasury OR "fx desk") (Nigeria OR Ghana OR Kenya OR Africa) -filter:retweets lang:en' },
  { key: "stellar", label: "Stellar and stablecoins",
    query: '(Stellar OR Soroban OR USDC) (Africa OR Nigeria OR Ghana OR Kenya) (FX OR remittance OR "foreign exchange" OR payments) -filter:retweets lang:en' },
  { key: "competitors", label: "Competitors",
    query: '("ledig.io" OR "Ledig" OR "StableFX" OR "Mento protocol") -filter:retweets' },
];

export interface Author {
  handle: string;
  name: string;
  followers: number;
  location: string;
  bio: string;
  automated: boolean;
}

export interface Post {
  id: string;
  url: string;
  text: string;
  createdAt: Date;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  views: number;
  author: Author;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Turns one tweet from the API into the fields we keep. Anything malformed is skipped. */
export function toPost(t: any): Post | null {
  if (!t || typeof t.id !== "string" || typeof t.text !== "string" || !t.author?.userName) return null;
  if (t.retweeted_tweet) return null;
  const created = new Date(t.createdAt);
  return {
    id: t.id,
    url: str(t.url) || `https://x.com/${t.author.userName}/status/${t.id}`,
    text: t.text,
    createdAt: Number.isNaN(created.getTime()) ? new Date() : created,
    likes: num(t.likeCount), replies: num(t.replyCount), reposts: num(t.retweetCount),
    quotes: num(t.quoteCount), views: num(t.viewCount),
    author: {
      handle: str(t.author.userName), name: str(t.author.name), followers: num(t.author.followers),
      location: str(t.author.location), bio: str(t.author.description), automated: t.author.isAutomated === true,
    },
  };
}

// Promotions and noise that share our keywords but are never a business with a currency problem.
const SPAM = /\b(airdrop|giveaway|pump|presale|signals?\s+group|join (my|our) (telegram|channel)|t\.me\/|whatsapp me|dm (me )?for|forex (signals|mentor)|betting|odds|casino|nft drop|1000x|100x)\b/i;

export function isNoise(p: Post): boolean {
  if (p.author.automated) return true;
  if (SPAM.test(p.text) || SPAM.test(p.author.bio)) return true;
  // Mostly hashtags or links: not someone describing a problem.
  const words = p.text.split(/\s+/).filter(Boolean);
  const junk = words.filter((w) => w.startsWith("#") || w.startsWith("http") || w.startsWith("@")).length;
  return words.length < 6 || junk / words.length > 0.5;
}

const PAIN = /\b(supplier|suppliers|invoice|invoices|import|importer|importing|export|exporter|payment|pay (my|our)|margin|margins|cost|costs|price|prices|loss|lost|hedge|hedging|budget|contract|container|goods|stock|inventory)\b/i;
const ROLE = /\b(ceo|founder|co-?founder|cfo|treasur|finance (director|manager)|importer|exporter|trader|logistics|freight|procurement|sme|business owner|manufactur|fintech|payments|bank(er|ing)?)\b/i;

/**
 * Relevance, 0 to 100: how much the post sounds like a real business problem, from a
 * real business person, that others care about. A guide for sorting, not a verdict.
 */
export function score(p: Post): number {
  let s = 0;
  if (PAIN.test(p.text)) s += 35;
  if (ROLE.test(p.author.bio)) s += 25;
  if (/\?/.test(p.text)) s += 5; // a question invites a helpful reply
  s += Math.min(15, Math.log10(1 + p.replies + p.quotes * 2 + p.likes / 5) * 8);
  s += Math.min(10, Math.log10(1 + p.author.followers) * 2.5);
  if (/nigeria|lagos|abuja|ghana|accra|kumasi|kenya|nairobi|africa/i.test(p.author.location)) s += 10;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export interface SearchResult {
  posts: Post[];
  pages: number;
}

/** One topic, newest first, posts after `sinceUnix`, up to `maxPages` pages. */
export async function searchTopic(apiKey: string, topic: Topic, sinceUnix: number, maxPages: number, fetchImpl: typeof fetch = fetch): Promise<SearchResult> {
  const posts: Post[] = [];
  let cursor = "";
  let pages = 0;
  while (pages < maxPages) {
    const url = new URL("https://api.twitterapi.io/twitter/tweet/advanced_search");
    url.searchParams.set("query", `${topic.query} since_time:${sinceUnix}`);
    url.searchParams.set("queryType", "Latest");
    url.searchParams.set("cursor", cursor);
    const res = await fetchImpl(url, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(30_000) });
    pages += 1;
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`twitterapi.io ${res.status}: ${body?.message ?? "request failed"}`);
    for (const t of Array.isArray(body.tweets) ? body.tweets : []) {
      const p = toPost(t);
      if (p) posts.push(p);
    }
    if (!body.has_next_page || !body.next_cursor) break;
    cursor = String(body.next_cursor);
  }
  return { posts, pages };
}
