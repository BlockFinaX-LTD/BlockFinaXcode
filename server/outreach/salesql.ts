/**
 * Emails for leads, from SalesQL, looked up by the person's LinkedIn profile.
 *
 * Finax finds people from LinkedIn posts and sorts them. When one is a match (a buyer, underwriter or
 * partner with a fit score of SALESQL_MIN_FIT or more), or when Anthony verifies them, their
 * profile is looked up once in SalesQL and the email is attached to the lead. A lookup that
 * finds nothing costs no SalesQL credit; one that finds data costs 1. At most
 * SALESQL_DAILY_CAP automatic lookups run per day; the Find email button always runs.
 *
 * Results live in their own table keyed by the lead, so the leads table is unchanged.
 *
 * Without a REST API key, the same lookups run from a Claude session that has the SalesQL
 * connector: it lists the matches still missing an email (leadsNeedingEmail) and saves
 * what SalesQL returns (saveLookups), through two endpoints guarded by OUTREACH_ENRICH_TOKEN.
 *
 *   SALESQL_API_KEY     REST API key (Professional plan or above); without it nothing runs
 *   SALESQL_MIN_FIT     fit score from which a buyer or partner is looked up (default 50)
 *   SALESQL_DAILY_CAP   automatic lookups per UTC day (default 25)
 */
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
/** The database, loaded on first use so this module can be imported without one (tests). */
async function getPool(): Promise<Db | null> {
  const { pool } = await import("../db");
  return (pool as unknown as Db) ?? null;
}

const ENDPOINT = "https://api-public.salesql.com/v1/persons/enrich";
const MATCH_SEGMENTS = new Set(["buyer", "underwriter", "partner"]);

export interface LeadEmail {
  email: string | null;
  emailType: string | null;
  emailStatus: string | null;
  /** found | not_found | error */
  result: string;
  lookedUpAt: string;
}

let ready: Promise<void> | null = null;
async function table(): Promise<Db> {
  const pool = await getPool();
  if (!pool) throw new Error("No database");
  ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS outreach_people_email (
      person_id integer PRIMARY KEY,
      email text,
      email_type text,
      email_status text,
      result text NOT NULL,
      detail text,
      looked_up_at timestamptz NOT NULL DEFAULT now()
    )`).then(() => undefined);
  await ready;
  return pool;
}

export const salesqlConfigured = () => Boolean(process.env.SALESQL_API_KEY?.trim());

/** The best email from a SalesQL person: a valid work address first, then any valid one, then any. */
export function bestEmail(body: any): { email: string; type: string | null; status: string | null } | null {
  const person = body?.person ?? body;
  const emails: { email?: string; type?: string; status?: string }[] = Array.isArray(person?.emails) ? person.emails : [];
  const usable = emails.filter((e) => typeof e.email === "string" && e.email.includes("@"));
  const rank = (e: { type?: string; status?: string }) => (e.status === "Valid" ? 0 : 2) + (e.type === "Work" ? 0 : 1);
  const pick = usable.sort((a, b) => rank(a) - rank(b))[0];
  return pick ? { email: pick.email!, type: pick.type ?? null, status: pick.status ?? null } : null;
}

/** Look one lead up in SalesQL and save what comes back. Throws only when SalesQL is not set up. */
export async function findEmail(personId: number, profileUrl: string): Promise<LeadEmail> {
  const key = process.env.SALESQL_API_KEY?.trim();
  if (!key) throw new Error("SalesQL is not connected. Add SALESQL_API_KEY on the server.");
  const db = await table();
  let result = "error", detail = "", found: ReturnType<typeof bestEmail> = null;
  try {
    const res = await fetch(`${ENDPOINT}?${new URLSearchParams({ linkedin_url: profileUrl })}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) { result = "not_found"; }
    else if (res.ok) { found = bestEmail(await res.json()); result = found ? "found" : "not_found"; }
    else {
      detail = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      // Rate limits and credit checks are temporary: keep no record, so it is tried again later.
      if (res.status === 429 || res.status === 503) throw new Error(`SalesQL is busy (${res.status}). Try again shortly.`);
      if (res.status === 401 || res.status === 403) throw new Error("SalesQL refused the API key. Check SALESQL_API_KEY.");
    }
  } catch (err) {
    if (/SalesQL/.test((err as Error).message)) throw err;
    detail = (err as Error).message;
  }
  await saveLookup(db, personId, found, result, detail || null);
  return { email: found?.email ?? null, emailType: found?.type ?? null, emailStatus: found?.status ?? null, result, lookedUpAt: new Date().toISOString() };
}

async function saveLookup(db: Db, personId: number, found: { email: string; type: string | null; status: string | null } | null, result: string, detail: string | null) {
  await db.query(
    `INSERT INTO outreach_people_email (person_id, email, email_type, email_status, result, detail, looked_up_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (person_id) DO UPDATE SET email = $2, email_type = $3, email_status = $4, result = $5, detail = $6, looked_up_at = now()`,
    [personId, found?.email ?? null, found?.type ?? null, found?.status ?? null, result, detail],
  );
}

/** Matches (buyers and partners at or above the fit score, and verified leads) not yet looked up. */
export async function leadsNeedingEmail(limit = 50) {
  const db = await table();
  const minFit = Number(process.env.SALESQL_MIN_FIT) || 50;
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.company, p.headline, p.profile_url AS "profileUrl", p.segment, p.fit_score AS "fitScore", p.verified
     FROM outreach_people p
     LEFT JOIN outreach_people_email e ON e.person_id = p.id AND e.result <> 'error'
     WHERE e.person_id IS NULL AND (p.verified OR (p.segment IN ('buyer', 'underwriter', 'partner') AND coalesce(p.fit_score, 0) >= $1))
     ORDER BY p.verified DESC, p.fit_score DESC NULLS LAST
     LIMIT $2`,
    [minFit, Math.min(Math.max(limit, 1), 100)],
  );
  return rows as { id: number; name: string | null; company: string | null; headline: string | null; profileUrl: string; segment: string | null; fitScore: number | null; verified: boolean }[];
}

/**
 * Save lookups made elsewhere (a Claude session with the SalesQL connector). Each item names
 * the lead and either the emails SalesQL returned or that it found nothing.
 */
export async function saveLookups(items: { id: number; emails?: { email?: string; type?: string; status?: string }[]; notFound?: boolean }[]) {
  const db = await table();
  let found = 0, missing = 0;
  for (const it of items.slice(0, 100)) {
    if (!Number.isInteger(it.id)) continue;
    const pick = bestEmail({ emails: it.emails ?? [] });
    await saveLookup(db, it.id, pick, pick ? "found" : "not_found", "via Claude SalesQL connector");
    if (pick) found++; else missing++;
  }
  return { found, notFound: missing };
}

/** Saved lookups for a set of leads, by lead id. */
export async function emailsFor(personIds: number[]): Promise<Map<number, LeadEmail>> {
  const out = new Map<number, LeadEmail>();
  if (!personIds.length) return out;
  const db = await table();
  const { rows } = await db.query(`SELECT * FROM outreach_people_email WHERE person_id = ANY($1::int[])`, [personIds]);
  for (const r of rows) {
    out.set(r.person_id, { email: r.email, emailType: r.email_type, emailStatus: r.email_status, result: r.result, lookedUpAt: new Date(r.looked_up_at).toISOString() });
  }
  return out;
}

/**
 * Called after a lead is sorted or verified: looks them up once if they are a match, SalesQL
 * is set up, nobody has looked them up before and today's cap is not reached. Never throws.
 */
export async function autoFindEmail(p: { id: number; profileUrl: string; segment?: string | null; fitScore?: number | null; verified?: boolean | null }) {
  try {
    if (!salesqlConfigured()) return;
    const minFit = Number(process.env.SALESQL_MIN_FIT) || 50;
    const match = p.verified || (MATCH_SEGMENTS.has(String(p.segment)) && (p.fitScore ?? 0) >= minFit);
    if (!match) return;
    const db = await table();
    const { rows: [seen] } = await db.query(`SELECT 1 FROM outreach_people_email WHERE person_id = $1 AND result <> 'error'`, [p.id]);
    if (seen) return;
    const cap = Number(process.env.SALESQL_DAILY_CAP) || 25;
    const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM outreach_people_email WHERE looked_up_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`);
    if (n >= cap) return;
    await findEmail(p.id, p.profileUrl);
  } catch (err) {
    console.warn(`[salesql] lead ${p.id}: ${(err as Error).message}`);
  }
}

/* ── Look anyone up (Finax) ────────────────────────────────────────────────
 *
 * Finax's admin chat can look a person up by LinkedIn link, or by name plus company
 * (name or website). A bare name is matched against the outreach leads first, so a lead
 * Finax already found can be looked up from their name alone. SalesQL has no search by
 * name only, so a bare name with no lead match comes back asking for the company.
 * One SalesQL credit per person found; nothing found costs nothing.
 */

export interface PersonDetails {
  name: string | null;
  title: string | null;
  company: string | null;
  companyWebsite: string | null;
  location: string | null;
  linkedinUrl: string | null;
  emails: { email: string; type: string | null; status: string | null }[];
  phones: { phone: string; type: string | null; valid: boolean | null }[];
}

/** The fields worth showing from a SalesQL person. */
export function personDetails(body: any): PersonDetails {
  const p = body?.person ?? body ?? {};
  const loc = p.location;
  const location = typeof loc === "string" ? loc
    : loc ? [loc.city, loc.state, loc.country].filter(Boolean).join(", ") || null : null;
  const emails = (Array.isArray(p.emails) ? p.emails : [])
    .filter((e: any) => typeof e?.email === "string" && e.email.includes("@"))
    .map((e: any) => ({ email: e.email, type: e.type ?? null, status: e.status ?? null }));
  const phones = (Array.isArray(p.phones) ? p.phones : [])
    .filter((x: any) => typeof x?.phone === "string" && x.phone.trim())
    .map((x: any) => ({ phone: x.phone, type: x.type ?? null, valid: typeof x.is_valid === "boolean" ? x.is_valid : null }));
  return {
    name: p.full_name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || null),
    title: p.title ?? p.headline ?? null,
    company: p.organization?.name ?? p.organization_name ?? null,
    companyWebsite: p.organization?.website ?? p.organization?.website_domain ?? null,
    location,
    linkedinUrl: p.linkedin_url ?? null,
    emails,
    phones,
  };
}

/** Turns "https://www.acme.com/about" or "acme.com" into "acme.com"; anything else is null. */
export function asDomain(v?: string | null): string | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s || /\s/.test(s) || !s.includes(".")) return null;
  return s.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] || null;
}

type LookupInput = { name?: string; company?: string; linkedinUrl?: string };

export async function lookupPerson(input: LookupInput): Promise<
  | { found: true; person: PersonDetails; savedToLead?: number }
  | { found: false; reason: string; candidates?: { id: number; name: string | null; company: string | null; headline: string | null }[] }
> {
  const key = process.env.SALESQL_API_KEY?.trim();
  if (!key) return { found: false, reason: "SalesQL is not connected. SALESQL_API_KEY is missing on the server." };

  const name = input.name?.trim() || "";
  const company = input.company?.trim() || "";
  let linkedinUrl = input.linkedinUrl?.trim() || (/linkedin\.com\/in\//i.test(name) ? name : "");
  let leadId: number | undefined;

  // A bare name: try the outreach leads, which carry a LinkedIn link.
  if (!linkedinUrl && name && !company) {
    const db = await table();
    const { rows } = await db.query(
      `SELECT id, name, company, headline, profile_url AS "profileUrl" FROM outreach_people
       WHERE lower(name) LIKE '%' || lower($1) || '%' ORDER BY verified DESC, fit_score DESC NULLS LAST LIMIT 5`,
      [name],
    );
    if (rows.length === 1 && /linkedin\.com\/in\//i.test(rows[0].profileUrl ?? "")) {
      linkedinUrl = rows[0].profileUrl;
      leadId = rows[0].id;
    } else {
      return {
        found: false,
        reason: rows.length > 1
          ? "Several leads match that name. Say which one, or give the company."
          : "SalesQL needs a company (name or website) or a LinkedIn link along with the name.",
        candidates: rows.length > 1 ? rows.map(({ id, name, company, headline }: any) => ({ id, name, company, headline })) : undefined,
      };
    }
  }

  const params = new URLSearchParams();
  if (linkedinUrl) params.set("linkedin_url", linkedinUrl);
  else {
    if (!name) return { found: false, reason: "Give a name or a LinkedIn link." };
    params.set("full_name", name);
    const domain = asDomain(company);
    params.set(domain ? "organization_domain" : "organization_name", domain ?? company);
  }

  const res = await fetch(`${ENDPOINT}?${params}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return { found: false, reason: "SalesQL has no match for that person." };
  if (res.status === 401 || res.status === 403) return { found: false, reason: "SalesQL refused the API key. Check SALESQL_API_KEY." };
  if (res.status === 429 || res.status === 503) return { found: false, reason: `SalesQL is busy (${res.status}). Try again shortly.` };
  if (!res.ok) return { found: false, reason: `SalesQL error ${res.status}: ${(await res.text()).slice(0, 200)}` };

  const body = await res.json();
  const person = personDetails(body);
  if (!person.emails.length && !person.phones.length && !person.name) {
    return { found: false, reason: "SalesQL has no match for that person." };
  }

  // If this person is one of Finax's leads, keep the email on the lead too.
  if (!leadId && person.linkedinUrl) {
    const db = await table();
    const slug = person.linkedinUrl.toLowerCase().replace(/\/+$/, "").split("/in/")[1];
    if (slug) {
      const { rows } = await db.query(`SELECT id FROM outreach_people WHERE lower(profile_url) LIKE '%/in/' || $1 || '%' LIMIT 1`, [slug]);
      leadId = rows[0]?.id;
    }
  }
  if (leadId) {
    const db = await table();
    const pick = bestEmail(body);
    await saveLookup(db, leadId, pick, pick ? "found" : "not_found", "via Finax lookup");
  }
  return { found: true, person, savedToLead: leadId };
}
