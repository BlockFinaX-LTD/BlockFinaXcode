/**
 * scan.ts, finding investors rather than typing them in.
 *
 * ## Why LinkedIn profiles and not Crunchbase
 *
 * Crunchbase has better structured investor data and its scraper requires a
 * logged-in session cookie, which means driving somebody's account and
 * re-supplying the cookie every time it rotates. That is the pattern this
 * codebase has avoided everywhere else and there is no reason to adopt it here.
 *
 * harvestapi/linkedin-profile-search needs no cookie, no proxy configuration
 * and no session. Checked against its published schema rather than guessed: the
 * last actor added here failed silently on every call for days because a
 * required field was assumed rather than read.
 *
 * ## Why profiles and not emails
 *
 * A profile search returns people, not addresses, and that is the right shape
 * for this. An investor reached cold by email is one of forty that morning. The
 * same person reached after a comment on their own post about African fintech
 * has already seen the name. So these land in the leads list, where the
 * LinkedIn machinery already works, rather than in the email queue.
 *
 * The firm behind them is a separate problem, and the business pipeline already
 * solves it: a fund website goes through the same contact crawl as any other.
 */

import { randomBytes } from "node:crypto";
import { db } from "../db";
import { outreachPeople } from "@shared/schema";
import { notePerson, normaliseProfileUrl } from "../outreach/people";

const ACTOR = "harvestapi~linkedin-profile-search";

/** Titles that actually hold a cheque, rather than titles that sound like it. */
export const INVESTOR_TITLES = [
  "Partner",
  "General Partner",
  "Managing Partner",
  "Principal",
  "Investment Manager",
  "Investment Associate",
  "Angel Investor",
  "Venture Partner",
];

/** Where pre-seed money for African fintech actually sits. */
export const INVESTOR_LOCATIONS = [
  "Lagos, Nigeria",
  "Nairobi, Kenya",
  "Accra, Ghana",
  "Cape Town, South Africa",
  "London, United Kingdom",
  "San Francisco, California",
];

export const INVESTOR_QUERIES = [
  "pre-seed African fintech",
  "early stage fintech Africa",
  "emerging markets fintech investor",
  "Africa venture capital",
];

export interface ScanResult {
  found: number;
  recorded: number;
  duplicates: number;
  errors: string[];
}

interface Profile {
  name: string | null;
  headline: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
}

/**
 * Read one result into the shape the leads list expects.
 *
 * Field names are tried against several candidates for the same reason they are
 * in the post reader: the actor documents its output loosely, and a payload
 * shaped by LinkedIn's markup moves. Reading one guessed path returns nothing
 * and reports no error, which is the worst failure available.
 */
function readProfile(p: any): Profile | null {
  if (!p || typeof p !== "object") return null;
  const url = p.linkedinUrl ?? p.profileUrl ?? p.url ?? p.publicProfileUrl ?? null;
  if (typeof url !== "string" || !url) return null;

  const company =
    p.currentCompany?.name ?? p.companyName ?? p.company ??
    (Array.isArray(p.experience) ? p.experience[0]?.companyName : null) ?? null;

  return {
    name: p.name ?? p.fullName ?? [p.firstName, p.lastName].filter(Boolean).join(" ") ?? null,
    headline: p.headline ?? p.occupation ?? p.title ?? null,
    company: typeof company === "string" ? company : null,
    location: p.location ?? p.locationName ?? p.geoRegion ?? null,
    url,
  };
}

async function apify(token: string, input: unknown, timeoutMs = 180_000): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(input),
      },
    );
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`${r.status}: ${body.slice(0, 180)}`);
    }
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One scan.
 *
 * Records into the same leads table everything else uses, marked as investors
 * by their topics, so they appear beside the rest of the list and can be
 * qualified and messaged by machinery that already exists rather than a second
 * copy of it.
 */
export async function scanInvestors(opts: {
  token: string;
  query: string;
  location: string;
  maxItems?: number;
}): Promise<ScanResult> {
  const errors: string[] = [];
  let raw: any[] = [];

  try {
    raw = await apify(opts.token, {
      searchQuery: opts.query,
      currentJobTitles: INVESTOR_TITLES,
      locations: [opts.location],
      maxItems: Math.min(Math.max(opts.maxItems ?? 25, 1), 100),
      profileScraperMode: "Short",
    });
  } catch (e) {
    return { found: 0, recorded: 0, duplicates: 0, errors: [e instanceof Error ? e.message : "search failed"] };
  }

  const profiles = raw.map(readProfile).filter((p): p is Profile => !!p);
  let recorded = 0, duplicates = 0;

  for (const p of profiles) {
    const url = p.url ? normaliseProfileUrl(p.url) : null;
    if (!url) { duplicates++; continue; }

    // The headline is the evidence here, the way a post is elsewhere. Someone
    // whose own headline says Partner at a fund investing in African fintech
    // has told us what they do more reliably than any inference would.
    const text = [p.headline, p.company, "investor venture capital pre-seed"]
      .filter(Boolean).join(" ");

    try {
      await notePerson({
        profileUrl: url,
        name: p.name,
        headline: p.headline,
        postText: text,
        postUrl: null,
        score: 0,
      });
      recorded++;
    } catch {
      duplicates++;
    }
  }

  return { found: profiles.length, recorded, duplicates, errors };
}
