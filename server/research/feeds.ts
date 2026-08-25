/**
 * feeds.ts, where the morning reading comes from.
 *
 * Every URL here was fetched and confirmed to return parseable items before it
 * was added. Four obvious candidates are missing for that reason: the IMF, BIS,
 * World Bank and The Africa Report all either 403 a plain request or have moved
 * their feeds. A source list containing dead entries is worse than a short one,
 * because a fetcher that always reports failures is one nobody reads the output
 * of.
 *
 * The mix is deliberate. Local business press for what is actually happening to
 * companies in Accra and Lagos, a central bank for policy, one global markets
 * feed for the dollar side of every pair, and quantitative finance preprints
 * because the pricing engine's own methods come from that literature.
 */

export interface Feed {
  name: string;
  url: string;
  /** news | research | policy | analysis */
  kind: string;
  /** Weight for how much a hit from here is worth. A working paper outlives a headline. */
  weight: number;
}

export const FEEDS: Feed[] = [
  // Ghana
  { name: "MyJoyOnline", url: "https://www.myjoyonline.com/feed/", kind: "news", weight: 1 },

  // Nigeria
  { name: "Nairametrics", url: "https://nairametrics.com/feed/", kind: "news", weight: 2 },
  { name: "BusinessDay NG", url: "https://businessday.ng/feed/", kind: "news", weight: 2 },
  { name: "Premium Times", url: "https://www.premiumtimesng.com/feed", kind: "news", weight: 1 },

  // Kenya
  { name: "Central Bank of Kenya", url: "https://www.centralbank.go.ke/feed/", kind: "policy", weight: 3 },

  // Pan-African
  { name: "African Business", url: "https://african.business/feed", kind: "analysis", weight: 2 },
  { name: "TechCabal", url: "https://techcabal.com/feed/", kind: "news", weight: 2 },

  // Global markets, for the dollar side of every pair we price
  { name: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", kind: "news", weight: 1 },
  { name: "FT Alphaville", url: "https://ftalphaville.ft.com/feed", kind: "analysis", weight: 2 },

  // Research. The pricing engine runs Garman-Kohlhagen with a Merton jump term,
  // and that literature is where the next improvement to it comes from.
  { name: "arXiv q-fin", url: "http://export.arxiv.org/rss/q-fin", kind: "research", weight: 3 },
  { name: "ECB Publications", url: "https://www.ecb.europa.eu/rss/pub.html", kind: "research", weight: 2 },
];

export interface FeedItem {
  title: string;
  url: string;
  source: string;
  kind: string;
  summary: string | null;
  publishedAt: Date | null;
  weight: number;
}

/**
 * Feed text to readable text.
 *
 * Numeric entities matter as much as named ones. Feeds are full of smart quotes
 * written as &#8216; and &#8217;, and a briefing whose headlines read
 * "GoldBod &#8216;losses&#8217;" looks broken regardless of how good the
 * analysis underneath is. Entities are decoded twice because several of these
 * publications double-encode: &amp;#8216; appears verbatim in the wild.
 */
const decodeEntities = (s: string): string =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
   .replace(/&(amp|lt|gt|quot|apos|nbsp|hellip|mdash|ndash|rsquo|lsquo|rdquo|ldquo);/g,
     m => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
             "&nbsp;": " ", "&hellip;": "...", "&mdash;": ", ", "&ndash;": ", ",
             "&rsquo;": "'", "&lsquo;": "'", "&rdquo;": '"', "&ldquo;": '"' }[m] ?? " "));

const strip = (s: string): string =>
  decodeEntities(decodeEntities(s.replace(/<!\[CDATA\[|\]\]>/g, "")).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const tag = (block: string, name: string): string | null => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? strip(m[1]) : null;
};

/**
 * Parse RSS and Atom with one function.
 *
 * Both are used across these sources, and a dependency to tell them apart is
 * not worth it: an item is a block bounded by <item> or <entry>, a title is a
 * title in both, and the only real difference is where the link lives.
 */
export function parseFeed(xml: string, feed: Feed): FeedItem[] {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) ?? [];
  const out: FeedItem[] = [];

  for (const b of blocks) {
    const title = tag(b, "title");
    if (!title) continue;

    // RSS puts the URL in <link>text</link>; Atom puts it in <link href="..."/>.
    let url = tag(b, "link");
    if (!url || !/^https?:/i.test(url)) {
      const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      url = href?.[1] ?? null;
    }
    if (!url || !/^https?:/i.test(url)) continue;

    const dateRaw = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    let publishedAt: Date | null = null;
    if (dateRaw) {
      const d = new Date(dateRaw);
      // Same plausibility window used elsewhere: a wrong date is worse than none,
      // because it sorts a stale piece to the top of a morning briefing.
      if (!Number.isNaN(d.getTime())
          && d.getTime() > Date.now() - 400 * 86400_000
          && d.getTime() < Date.now() + 86400_000) {
        publishedAt = d;
      }
    }

    const summary = tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content");

    out.push({
      title,
      url: url.split("?")[0],
      source: feed.name,
      kind: feed.kind,
      summary: summary ? summary.slice(0, 1200) : null,
      publishedAt,
      weight: feed.weight,
    });
  }
  return out;
}

/** Fetch one feed. Resolves empty on failure, so one dead source cannot lose the rest. */
export async function fetchFeed(feed: Feed, timeoutMs = 20_000): Promise<FeedItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        // Several of these refuse a request with no user agent at all.
        "user-agent": "Mozilla/5.0 (compatible; BlockFinaXResearch/1.0)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!r.ok) return [];
    return parseFeed(await r.text(), feed);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
