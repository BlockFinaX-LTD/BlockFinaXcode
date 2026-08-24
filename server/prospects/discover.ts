/**
 * discover.ts, finding businesses that carry currency exposure, and how to
 * write to them.
 *
 * ## Why two stages rather than one
 *
 * There is no single source that hands you "Ghanaian food importers with an
 * email address". Finding the business and finding the address are different
 * problems with different tools:
 *
 *   1. A places search answers "who does this, here". Google Maps knows every
 *      importer, freight forwarder and payments company in Accra, with a
 *      website for most of them.
 *   2. A contact crawl answers "how do I write to them", by reading the
 *      contact page of each site found.
 *
 * Splitting it is also what makes the volume affordable. Stage one is cheap per
 * result; stage two is the expensive part, so it runs only against sites that
 * cleared stage one.
 *
 * ## Why role inboxes are the point, not a fallback
 *
 * A crawl of a company website yields info@ and sales@ far more often than a
 * named person, and that is the better outcome rather than a worse one. A
 * published business inbox can be written to cold; a named individual in Ghana,
 * Nigeria or the EU cannot without prior consent. The pipeline is built around
 * the addresses it is actually allowed to use.
 */

import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { prospects, classifyAddress, assessSendable } from "@shared/prospect-schema";

const PLACES_ACTOR = "compass~crawler-google-places";
const CONTACTS_ACTOR = "vdrmota~contact-info-scraper";

export interface Business {
  company: string;
  website: string | null;
  country: string | null;
  industry: string | null;
  address: string | null;
  /** Emails the places actor found on the business's own site, when asked. */
  emails: string[];
}

/**
 * Keep the addresses that belong to the business.
 *
 * A crawl of any real website picks up the addresses of whatever built it and
 * whatever tracks it. Writing to sentry@ or a WordPress theme author is not
 * outreach, it is noise that bounces and damages the sending domain.
 */
/**
 * Real top-level domains, near enough for this purpose.
 *
 * A crawl glues an address to whatever text follows it, and the result still
 * looks like an address: sales@booze.ngliquorstore passes any pattern check,
 * because "ngliquorstore" is letters after a dot. Only knowing what endings
 * actually exist catches it. One of these went out before this existed.
 */
const KNOWN_TLDS = new Set([
  "com","net","org","io","co","info","biz","app","dev","ai","xyz","online","site",
  "global","digital","travel","int","edu","gov","mil","tech","store","shop","group",
  "ng","gh","ke","za","ug","tz","zm","eg","ci","sn","cm","et","rw","mw","bw","na",
  "uk","ie","de","fr","nl","es","it","se","dk","fi","no","pl","be","at","pt","ch",
  "us","ca","au","nz","in","cn","sg","hk","ae","sa","jp","kr","br","mx","tr","il",
  "eu","africa","asia",
]);

/**
 * Fix an address the crawl mangled, or reject it.
 *
 * The repair works because the concatenation has a signature: the email's
 * domain begins with the business's real website domain and then continues into
 * page text. booze.ngliquorstore starts with booze.ng, so truncating there
 * recovers the address rather than discarding a real lead.
 *
 * Where there is nothing to check against, an unrecognised ending is refused
 * outright. A bounce costs more than a lead: bounces are what mark a sender as
 * working from a scraped list, and this domain also carries the magic links.
 */
export function repairEmail(email: string, website: string | null): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  let domain = email.slice(at + 1).toLowerCase();

  let siteHost = "";
  if (website) {
    try { siteHost = new URL(website).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* ignore */ }
  }

  // The concatenation case: repair rather than discard.
  if (siteHost && domain !== siteHost && domain.startsWith(siteHost)) {
    domain = siteHost;
  }

  const tld = domain.split(".").pop() || "";
  if (!KNOWN_TLDS.has(tld)) return null;
  if (domain.length > 60) return null;

  return `${local}@${domain}`;
}

function cleanEmails(raw: unknown[]): string[] {
  const out = raw
    .map(e => String(e ?? "").trim().toLowerCase())
    .filter(e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e))
    .filter(e => !/(sentry|wixpress|example\.|godaddy|wordpress|squarespace|shopify|cloudflare|\.png|\.jpg|@2x)/i.test(e));
  return Array.from(new Set(out));
}

async function apify<T>(actor: string, token: string, input: unknown, timeoutMs = 240_000): Promise<T[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(input),
      },
    );
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`${actor} returned ${r.status}. ${body.slice(0, 200)}`);
    }
    const json = await r.json();
    return Array.isArray(json) ? json : [];
  } finally {
    clearTimeout(timer);
  }
}

/** ISO-2 from a country name, for the markets this actually sells into. */
const COUNTRY_CODES: Record<string, string> = {
  ghana: "GH", nigeria: "NG", kenya: "KE", "south africa": "ZA",
  uganda: "UG", tanzania: "TZ", zambia: "ZM", egypt: "EG",
  "united kingdom": "GB", "united states": "US", uae: "AE",
  "united arab emirates": "AE", india: "IN", china: "CN", netherlands: "NL",
};

function countryCode(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  if (/^[A-Z]{2}$/.test(s)) return s;
  return COUNTRY_CODES[s.toLowerCase()] ?? null;
}

/** Stage one: who does this, here. */
export async function findBusinesses(
  token: string,
  query: string,
  location: string,
  limit: number,
): Promise<Business[]> {
  const items = await apify<any>(PLACES_ACTOR, token, {
    searchStringsArray: [query],
    locationQuery: location,
    maxCrawledPlacesPerSearch: Math.min(Math.max(limit, 1), 500),
    language: "en",
    skipClosedPlaces: true,
    // Ask the places actor to read the business website for contact details in
    // the same run. It does the job the separate contact crawl was doing, in
    // one call rather than two, which is both cheaper and one less thing to
    // fail. The second actor is kept as a fallback for the businesses this
    // misses.
    scrapeContacts: true,
  });

  const out: Business[] = [];
  for (const it of items) {
    const company = typeof it?.title === "string" ? it.title.trim() : "";
    if (!company) continue;
    const raw = Array.isArray(it?.emails) ? it.emails : [];
    out.push({
      company,
      website: typeof it?.website === "string" && it.website.trim() ? it.website.trim() : null,
      country: countryCode(it?.countryCode ?? it?.country),
      industry: typeof it?.categoryName === "string" ? it.categoryName : null,
      address: typeof it?.address === "string" ? it.address : null,
      emails: cleanEmails(raw),
    });
  }
  return out;
}

/** Stage two: how do I write to them. */
export async function findEmails(
  token: string,
  urls: string[],
): Promise<Map<string, string[]>> {
  if (!urls.length) return new Map();
  const items = await apify<any>(CONTACTS_ACTOR, token, {
    startUrls: urls.slice(0, 200).map(url => ({ url })),
    maxRequestsPerStartUrl: 4,   // home, contact, about, one more
    maxDepth: 2,
    sameDomain: true,
    considerChildFrames: false,
    // Required by this actor. Omitting it made every call fail, which is why
    // the first live run found nothing at all: the places search worked and the
    // contact crawl never ran.
    proxyConfig: { useApifyProxy: true },
  });

  const byDomain = new Map<string, string[]>();
  for (const it of items) {
    const emails: string[] = Array.isArray(it?.emails) ? it.emails : [];
    const from = typeof it?.url === "string" ? it.url : "";
    if (!emails.length || !from) continue;
    let host = "";
    try { host = new URL(from).hostname.replace(/^www\./, "").toLowerCase(); } catch { continue; }
    const clean = cleanEmails(emails);
    if (!clean.length) continue;
    byDomain.set(host, Array.from(new Set((byDomain.get(host) || []).concat(clean))));
  }
  return byDomain;
}

export interface DiscoverResult {
  found: number;
  withSite: number;
  withEmail: number;
  inserted: number;
  duplicates: number;
  sendable: number;
  errors: string[];
}

/**
 * One discovery run.
 *
 * Deliberately inserts unsendable rows as well as sendable ones. A named
 * contact in Ghana cannot be cold emailed, but knowing they exist is useful:
 * they are exactly who to look for on LinkedIn, and the outreach tool already
 * handles that. Discarding them would throw away the research.
 */
export async function discoverProspects(opts: {
  token: string;
  query: string;
  location: string;
  segment: string;
  limit: number;
}): Promise<DiscoverResult> {
  const errors: string[] = [];
  let businesses: Business[] = [];
  try {
    businesses = await findBusinesses(opts.token, opts.query, opts.location, opts.limit);
  } catch (e) {
    return {
      found: 0, withSite: 0, withEmail: 0, inserted: 0, duplicates: 0, sendable: 0,
      errors: [e instanceof Error ? e.message : "places search failed"],
    };
  }

  const sites = businesses.filter(b => b.website);

  // The places run already returns contacts for most businesses. Only crawl the
  // ones it missed, which is the expensive call avoided for the majority.
  const emailsByHost = new Map<string, string[]>();
  const stillMissing: string[] = [];
  for (const b of sites) {
    let host = "";
    try { host = new URL(b.website!).hostname.replace(/^www\./, "").toLowerCase(); } catch { continue; }
    if (b.emails.length) emailsByHost.set(host, b.emails);
    else stillMissing.push(b.website!);
  }

  if (stillMissing.length) {
    try {
      const crawled = await findEmails(opts.token, stillMissing);
      crawled.forEach((v, k) => { if (!emailsByHost.has(k)) emailsByHost.set(k, v); });
    } catch (e) {
      // Not fatal. Whatever the places run found is still usable, and saying so
      // beats reporting zero when most of the work succeeded.
      errors.push(`contact crawl failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  let inserted = 0, duplicates = 0, sendableCount = 0, withEmail = 0;

  for (const b of businesses) {
    if (!b.website) continue;
    let host = "";
    try { host = new URL(b.website).hostname.replace(/^www\./, "").toLowerCase(); } catch { continue; }
    const found = emailsByHost.get(host);
    if (!found?.length) continue;
    withEmail++;

    // One row per business, not per address. Writing to info@ and sales@ at the
    // same company is one message arriving twice, which reads as spam even when
    // it is not. Role inboxes are preferred because they are the ones that can
    // lawfully be written to.
    // Repair or drop anything the crawl mangled, before choosing.
    const usable = found
      .map(e => repairEmail(e, b.website))
      .filter((e): e is string => !!e);
    if (!usable.length) continue;

    const role = usable.find(e => classifyAddress(e) === "role");
    const email = role ?? usable[0];

    const kind = classifyAddress(email);
    const verdict = assessSendable({ email, country: b.country, addressKind: kind });
    if (verdict.sendable) sendableCount++;

    try {
      const res = await db.insert(prospects).values({
        company: b.company,
        website: b.website,
        country: b.country,
        industry: b.industry,
        evidence: b.address ? `Listed at ${b.address}` : null,
        email,
        addressKind: kind,
        sourceUrl: b.website,
        source: "search",
        sourceQuery: `${opts.query} in ${opts.location}`,
        segment: opts.segment,
        sendable: verdict.sendable,
        sendableReason: verdict.reason,
        unsubscribeToken: randomBytes(24).toString("hex"),
      }).onConflictDoNothing({ target: prospects.email }).returning({ id: prospects.id });
      if (res.length) inserted++; else duplicates++;
    } catch {
      duplicates++;
    }
  }

  return {
    found: businesses.length,
    withSite: sites.length,
    withEmail,
    inserted,
    duplicates,
    sendable: sendableCount,
    errors,
  };
}

/**
 * The searches worth running for each kind of prospect.
 *
 * Written as places queries because that is what stage one takes. "Freight
 * forwarder" finds firms whose entire business is moving goods across a border,
 * which is a better proxy for currency exposure than "import export company",
 * a phrase that mostly returns directories and consultants.
 */
export const SEED_QUERIES: Record<string, string[]> = {
  hedger: [
    "food importer", "freight forwarder", "customs clearing agent",
    "commodity trader", "pharmaceutical importer", "electronics importer",
    "building materials importer", "agricultural exporter", "manufacturer",
  ],
  psp: [
    "payment service provider", "money transfer operator",
    "mobile money agent", "fintech company", "remittance company",
  ],
  underwriter: [
    "asset management company", "investment fund", "family office",
    "private equity firm", "venture capital firm",
  ],
  bank: [
    "commercial bank", "trade finance bank", "microfinance institution",
    "foreign exchange bureau",
  ],
};

export const SEED_LOCATIONS = [
  "Accra, Ghana", "Tema, Ghana", "Kumasi, Ghana",
  "Lagos, Nigeria", "Abuja, Nigeria", "Port Harcourt, Nigeria",
  "Nairobi, Kenya", "Mombasa, Kenya",
  "Johannesburg, South Africa", "Cape Town, South Africa",
];
