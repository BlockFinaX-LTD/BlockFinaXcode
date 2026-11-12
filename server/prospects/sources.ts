/**
 * sources.ts, more places to find businesses with currency exposure.
 *
 * Google Maps answers "who does this, here", which finds a lot of businesses
 * and says nothing about whether any of them feel the problem. These sources
 * find businesses because of a signal:
 *
 *   - Job posts. A company hiring an import manager or a procurement officer in
 *     Lagos is paying suppliers abroad. It is the clearest buying signal there
 *     is, and LinkedIn lists the company's website alongside the post.
 *   - News. A company reporting foreign exchange losses has the problem in
 *     writing, in its own results.
 *   - A list page. Trade fair exhibitors, chamber of commerce members, sector
 *     directories. Someone else has already grouped the right businesses.
 *
 * Each source only finds the business. Finding an address and drafting the
 * email is the same pipeline Google Maps already feeds (saveBusinesses).
 */

import Anthropic from "@anthropic-ai/sdk";
import { apify, countryCode, findBusinesses, saveBusinesses, emptyResult, type Business, type DiscoverResult } from "./discover";

const JOBS_ACTOR = "curious_coder~linkedin-jobs-scraper";
const SEARCH_ACTOR = "apify~google-search-scraper";
const PAGE_ACTOR = "apify~rag-web-browser";

/** Businesses without a website get one looked up on Google Maps, up to this many per run. */
const WEBSITE_LOOKUPS = Number(process.env.PROSPECT_WEBSITE_LOOKUPS || 15);

export type SourceKind = "places" | "jobs" | "news" | "list";

/** Job titles that mean a business pays for things in another currency. */
export const JOB_QUERIES: Record<string, string[]> = {
  hedger: [
    "import manager", "procurement manager", "supply chain manager",
    "treasury manager", "clearing and forwarding", "finance manager import",
  ],
  underwriter: ["portfolio manager", "investment analyst", "treasury dealer"],
  psp: ["payments operations", "remittance operations"],
  bank: ["trade finance officer", "FX dealer"],
};

/** Searches that turn up companies saying, in public, that the currency hurt them. */
export const NEWS_QUERIES: Record<string, string[]> = {
  hedger: [
    "foreign exchange loss company results",
    "importers naira depreciation impact",
    "cedi depreciation importers costs",
    "shilling depreciation company profit",
  ],
  underwriter: ["fund launch Africa fixed income", "family office Africa investment"],
  psp: ["payment company licence approval Africa"],
  bank: ["trade finance bank Africa expansion"],
};

/** Countries the news searches run across, as Google Search country codes. */
export const NEWS_COUNTRIES: Array<{ name: string; code: string }> = [
  { name: "Nigeria", code: "ng" }, { name: "Ghana", code: "gh" },
  { name: "Kenya", code: "ke" }, { name: "South Africa", code: "za" },
];

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

/** A site that is a platform rather than the business's own page. */
function platformSite(url: string): boolean {
  return /(^|\.)(linkedin|facebook|instagram|twitter|x|youtube|wikipedia|google|bit|linktr)\.[a-z.]+$/
    .test(hostOf(url));
}

/** "Lagos, Nigeria" to "NG". */
function countryFromLocation(location: string): string | null {
  const parts = location.split(",").map(s => s.trim()).filter(Boolean);
  return countryCode(parts[parts.length - 1] || "");
}

// ── Job posts ─────────────────────────────────────────────────────────────

/** Companies hiring for a role that means currency exposure, one per company. */
export async function jobBusinesses(
  token: string,
  title: string,
  location: string,
  limit: number,
): Promise<Business[]> {
  const items = await apify<any>(JOBS_ACTOR, token, {
    keywords: title,
    location,
    datePosted: "pastMonth",
    limitPerSource: Math.min(Math.max(limit, 1), 100),
    // Reads each company's page too, which is where the website comes from.
    scrapeCompany: true,
  });

  const fallbackCountry = countryFromLocation(location);
  const byCompany = new Map<string, Business>();
  for (const it of items) {
    const company = str(it?.companyName);
    if (!company || byCompany.has(company.toLowerCase())) continue;
    // Recruiters post for their clients, and the client is who has the exposure.
    if (/recruit|staffing|talent|headhunt|hr solutions|consulting/i.test(company)) continue;

    const site = str(it?.companyWebsite);
    const job = str(it?.title) || title;
    const where = str(it?.location) || location;
    const posted = str(it?.postedAt);
    const industries = Array.isArray(it?.industries) ? it.industries.join(", ") : str(it?.industries);
    const about = str(it?.companyDescription).slice(0, 300);

    byCompany.set(company.toLowerCase(), {
      company,
      website: site && !platformSite(site) ? site : null,
      country: fallbackCountry,
      industry: industries || null,
      address: null,
      emails: [],
      evidence:
        `Hiring a ${job} in ${where}${posted ? ` (posted ${posted.slice(0, 10)})` : ""}.` +
        (about ? ` About them: ${about}` : ""),
      sourceUrl: str(it?.link) || null,
    });
  }
  return Array.from(byCompany.values());
}

// ── Reading text with the model ───────────────────────────────────────────

interface Extracted {
  company: string;
  website?: string;
  country?: string;
  industry?: string;
  evidence?: string;
  sourceUrl?: string;
}

const EXTRACT_TOOL = {
  name: "companies",
  description: "The businesses found in the text.",
  input_schema: {
    type: "object" as const,
    properties: {
      companies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            company: { type: "string", description: "The business's own name." },
            website: { type: "string", description: "Its own website, only if the text gives it." },
            country: { type: "string", description: "Country it operates in, if stated." },
            industry: { type: "string", description: "What it does, in a few words." },
            evidence: { type: "string", description: "One sentence from the text showing why it fits." },
            sourceUrl: { type: "string", description: "The URL of the result it came from, if there is one." },
          },
          required: ["company"],
        },
      },
    },
    required: ["companies"],
  },
};

async function extractCompanies(
  apiKey: string,
  model: string,
  instruction: string,
  text: string,
): Promise<Extracted[]> {
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model,
    max_tokens: 4000,
    system:
      "You pull businesses out of web text for BlockFinaX, which helps businesses protect " +
      "themselves against currency volatility. Only list real, named businesses the text " +
      "actually mentions. Never invent a company, a website or a fact. Leave a field out " +
      "rather than guess it. Skip the publisher, the event organiser, government bodies " +
      "and any business that is only mentioned in passing.\n\n" + instruction,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "companies" },
    messages: [{ role: "user", content: text.slice(0, 60_000) }],
  });
  const call = msg.content.find(b => b.type === "tool_use");
  if (!call || call.type !== "tool_use") return [];
  const list = (call.input as any)?.companies;
  return Array.isArray(list) ? list.filter((c: any) => str(c?.company)) : [];
}

function toBusiness(c: Extracted, fallbackCountry: string | null, fallbackUrl: string | null): Business {
  const site = str(c.website);
  const website = site && /^https?:\/\//.test(site) && !platformSite(site)
    ? site
    : site && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(site) ? `https://${site}` : null;
  return {
    company: str(c.company),
    website,
    country: countryCode(c.country) ?? fallbackCountry,
    industry: str(c.industry) || null,
    address: null,
    emails: [],
    evidence: str(c.evidence) || null,
    sourceUrl: str(c.sourceUrl) || fallbackUrl,
  };
}

// ── News ──────────────────────────────────────────────────────────────────

/** Companies named in recent search results about currency pain. */
async function newsBusinesses(
  token: string,
  apiKey: string,
  model: string,
  query: string,
  country: string,
): Promise<Business[]> {
  const code = NEWS_COUNTRIES.find(c => c.name.toLowerCase() === country.toLowerCase())?.code
    ?? (countryCode(country) || "").toLowerCase();
  const pages = await apify<any>(SEARCH_ACTOR, token, {
    queries: `${query} ${country}`,
    maxPagesPerQuery: 2,
    countryCode: code || "",
    quickDateRange: "m6",
  });

  const lines: string[] = [];
  for (const page of pages) {
    for (const r of Array.isArray(page?.organicResults) ? page.organicResults : []) {
      const title = str(r?.title), url = str(r?.url), desc = str(r?.description);
      if (title && url) lines.push(`${title}\n${url}\n${desc}`);
    }
  }
  if (!lines.length) return [];

  const found = await extractCompanies(apiKey, model,
    `These are search results for "${query}" in ${country}. List the businesses that the ` +
    "results show are hurt by, or exposed to, exchange rate moves: importers, manufacturers " +
    "with imported inputs, businesses reporting FX losses. Use the snippet as the evidence " +
    "and the result's URL as sourceUrl.",
    lines.join("\n\n"),
  );
  return found.map(c => toBusiness(c, countryCode(country), null));
}

// ── A list page ───────────────────────────────────────────────────────────

/** Businesses on one page: exhibitors, members, a directory category. */
async function listBusinesses(
  token: string,
  apiKey: string,
  model: string,
  url: string,
): Promise<Business[]> {
  const pages = await apify<any>(PAGE_ACTOR, token, {
    query: url,
    maxResults: 1,
    outputFormats: ["markdown"],
    requestTimeoutSecs: 120,
  }, 180_000);
  const text = pages.map(p => str(p?.markdown) || str(p?.text)).join("\n\n");
  if (!text) return [];

  const found = await extractCompanies(apiKey, model,
    `This is the page at ${url}, a list of businesses such as trade fair exhibitors, ` +
    "association members or a directory. List every business on it, with its website when " +
    "the page links to one. For evidence, say what list it is on, for example " +
    "\"Exhibitor at the Lagos International Trade Fair 2026\".",
    text,
  );
  return found.map(c => toBusiness(c, null, url));
}

// ── Filling in websites ───────────────────────────────────────────────────

const COUNTRY_NAMES: Record<string, string> = {
  NG: "Nigeria", GH: "Ghana", KE: "Kenya", ZA: "South Africa", UG: "Uganda",
  TZ: "Tanzania", ZM: "Zambia", EG: "Egypt", AE: "United Arab Emirates", GB: "United Kingdom",
};

/**
 * Look up a website on Google Maps for businesses found without one.
 *
 * News and job posts name the company but not always its site, and without a
 * site there is no contact page to read. Capped, because each lookup is a paid
 * search.
 */
async function fillWebsites(token: string, list: Business[], where: string): Promise<string[]> {
  const errors: string[] = [];
  const missing = list.filter(b => !b.website).slice(0, WEBSITE_LOOKUPS);
  for (const b of missing) {
    const place = b.country ? COUNTRY_NAMES[b.country] ?? where : where;
    try {
      const [hit] = await findBusinesses(token, b.company, place, 1);
      if (hit?.website && hit.company.toLowerCase().includes(b.company.toLowerCase().split(" ")[0])) {
        b.website = hit.website;
        b.emails = hit.emails;
        b.industry = b.industry ?? hit.industry;
        b.address = hit.address;
      }
    } catch (e) {
      errors.push(`website lookup failed: ${e instanceof Error ? e.message : "unknown"}`);
      break;
    }
  }
  return errors;
}

// ── One run of any source ─────────────────────────────────────────────────

export async function discoverFrom(opts: {
  kind: Exclude<SourceKind, "places">;
  token: string;
  apiKey?: string;
  model: string;
  /** Job title, or news topic. */
  query: string;
  /** City and country for jobs, country for news. */
  location: string;
  /** The page to read, for a list. */
  url?: string;
  segment: string;
  limit: number;
}): Promise<DiscoverResult> {
  let businesses: Business[] = [];
  let sourceQuery = "";
  try {
    if (opts.kind === "jobs") {
      businesses = await jobBusinesses(opts.token, opts.query, opts.location, opts.limit);
      sourceQuery = `jobs: ${opts.query} in ${opts.location}`;
    } else {
      if (!opts.apiKey) return emptyResult("Reading news and lists needs ANTHROPIC_API_KEY.");
      if (opts.kind === "news") {
        businesses = await newsBusinesses(opts.token, opts.apiKey, opts.model, opts.query, opts.location);
        sourceQuery = `news: ${opts.query} in ${opts.location}`;
      } else {
        if (!opts.url) return emptyResult("Give it the address of the list page.");
        businesses = await listBusinesses(opts.token, opts.apiKey, opts.model, opts.url);
        sourceQuery = `list: ${opts.url}`;
      }
    }
  } catch (e) {
    return emptyResult(e instanceof Error ? e.message : `${opts.kind} search failed`);
  }

  const lookupErrors = await fillWebsites(opts.token, businesses, opts.location);
  const out = await saveBusinesses(opts.token, businesses, {
    source: opts.kind === "list" ? "directory" : opts.kind,
    sourceQuery,
    segment: opts.segment,
  });
  out.errors.push(...lookupErrors);
  return out;
}
