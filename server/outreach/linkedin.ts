/**
 * linkedin.ts, posting a comment through LinkedIn's own API.
 *
 * ## Why this is not the browser extension
 *
 * The extension reads. This writes, and writing is the line LinkedIn actually
 * enforces. Driving a logged-in session to type into a comment box is the
 * pattern their anti-automation systems are built to catch, and it is the
 * fastest way to lose the account a founder's outbound runs through.
 *
 * The API route is the opposite. Anthony authorises a LinkedIn app through
 * their own consent screen, LinkedIn issues a token, and every comment is a
 * sanctioned API call that they can see, rate limit and revoke. Nothing is
 * pretending to be a person. If LinkedIn ever objects, they turn off the token
 * rather than the account.
 *
 * ## What the token can and cannot do
 *
 * w_member_social covers posting and commenting as the authorising member. It
 * does not grant reading other people's content, which is why discovery still
 * goes through a provider. The two halves of this feature reach LinkedIn by
 * completely different routes, and that is not an accident: reading has no
 * sanctioned path and writing does.
 *
 * ## Why the token lives in the database
 *
 * Access tokens last about two months and the process restarts on every deploy.
 * Holding it in memory would mean re-authorising several times a week.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { platformSettings } from "@shared/schema";

const OAUTH_KEY = "linkedin_oauth";
const API = "https://api.linkedin.com";
/** Pinned rather than floating: LinkedIn sunsets versions, and a silent bump changes behaviour. */
const LINKEDIN_VERSION = "202605";

export interface LinkedInAuth {
  accessToken: string;
  /** urn:li:person:xxxx, the author every comment is attributed to. */
  personUrn: string;
  name: string | null;
  expiresAt: number;
  connectedAt: number;
  connectedBy: string | null;
}

export async function loadAuth(): Promise<LinkedInAuth | null> {
  try {
    const [row] = await db.select().from(platformSettings)
      .where(eq(platformSettings.key, OAUTH_KEY)).limit(1);
    if (!row?.value) return null;
    const a = JSON.parse(row.value) as LinkedInAuth;
    return a?.accessToken && a?.personUrn ? a : null;
  } catch {
    return null;
  }
}

export async function saveAuth(a: LinkedInAuth, by: string | null): Promise<void> {
  const value = JSON.stringify(a);
  await db.insert(platformSettings)
    .values({ key: OAUTH_KEY, value, updatedBy: by })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value, updatedAt: new Date(), updatedBy: by },
    });
}

export async function clearAuth(): Promise<void> {
  await db.delete(platformSettings).where(eq(platformSettings.key, OAUTH_KEY));
}

export function isExpired(a: LinkedInAuth): boolean {
  // A minute of slack, so a token that dies mid-request is reported as expired
  // rather than as a mysterious 401.
  return Date.now() > a.expiresAt - 60_000;
}

/* ── the OAuth dance ────────────────────────────────────────────────────── */

export function redirectUri(): string {
  const base = (process.env.PUBLIC_BASE_URL || "https://blockfinax.com").replace(/\/+$/, "");
  return `${base}/api/outreach/linkedin/callback`;
}

/**
 * Every redirect URL that could plausibly be needed, so the console can show
 * them rather than leaving Anthony to read one out of a LinkedIn error page.
 *
 * LinkedIn matches this value character for character: scheme, host, port and
 * path, with no allowance for a www prefix or a trailing slash. That is the
 * single most common reason a connection fails, and the error it returns says
 * only "does not match the registered value" without saying what it expected
 * or what it received. Registering both the apex and the www form costs
 * nothing and removes the entire class of problem.
 */
export function candidateRedirectUris(): string[] {
  const primary = redirectUri();
  const out = [primary];
  try {
    const u = new URL(primary);
    const host = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
    out.push(`${u.protocol}//${host}${u.pathname}`);
  } catch {
    /* a malformed base is reported by the primary value alone */
  }
  return Array.from(new Set(out));
}

/**
 * Scopes.
 *
 * openid and profile identify who authorised, which is needed because a comment
 * must name its author and the person URN comes from the userinfo endpoint.
 * w_member_social is the one that does the work.
 */
const SCOPES = ["openid", "profile", "w_member_social"];

export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID || "",
    redirect_uri: redirectUri(),
    state,
    scope: SCOPES.join(" "),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${p.toString()}`;
}

export async function exchangeCode(code: string): Promise<LinkedInAuth> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: process.env.LINKEDIN_CLIENT_ID || "",
    client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
  });

  const r = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.access_token) {
    throw new Error(j?.error_description || j?.error || `token exchange failed (${r.status})`);
  }

  // Who authorised. The person URN is required on every comment, so without
  // this the token is useless and it is better to fail here than at send time.
  const me = await fetch(`${API}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${j.access_token}` },
  });
  const info: any = await me.json().catch(() => ({}));
  if (!me.ok || !info?.sub) {
    throw new Error(info?.message || `could not read the LinkedIn profile (${me.status})`);
  }

  return {
    accessToken: j.access_token,
    personUrn: `urn:li:person:${info.sub}`,
    name: info.name || null,
    expiresAt: Date.now() + (Number(j.expires_in) || 60 * 86400) * 1000,
    connectedAt: Date.now(),
    connectedBy: null,
  };
}

/* ── posting ────────────────────────────────────────────────────────────── */

/**
 * Pull the activity URN out of a post URL.
 *
 * A comment has to name the thing it is on, and LinkedIn identifies that by
 * URN rather than by URL. Returns null rather than guessing when the URL is a
 * profile or a search result, because posting a comment onto the wrong thread
 * is not recoverable by editing.
 */
export function activityUrnFrom(url: string | null | undefined): string | null {
  if (!url) return null;

  // The plain permalink form.
  const direct = url.match(/urn:li:(activity|ugcPost|share):(\d+)/);
  if (direct) return `urn:li:${direct[1]}:${direct[2]}`;

  // The same thing percent-encoded, which is how it arrives in a query string.
  const encoded = url.match(/urn%3Ali%3A(activity|ugcPost|share)%3A(\d+)/i);
  if (encoded) return `urn:li:${encoded[1]}:${encoded[2]}`;

  // The share form LinkedIn actually uses in public post links:
  //   /posts/marketforcesafrica_naira-weakens-activity-7496146729793261569-h3xB
  // This is the shape the provider returns for essentially every result, so
  // without it the send button never appears on anything.
  const share = url.match(/-activity-(\d{10,})(?:-|\/|$|\?)/);
  if (share) return `urn:li:activity:${share[1]}`;

  return null;
}

/**
 * When was a post published, according to its own id?
 *
 * LinkedIn activity ids are snowflake-like: the high bits are a millisecond
 * timestamp. Shifting right by 22 recovers it, which is checkable against
 * known posts and lands within the search window every time.
 *
 * This matters because the provider does not reliably return a date field. All
 * thirty drafts in the first real scan came back with no publication date at
 * all, which left every card unable to say whether a thread was an hour old or
 * a month old. The id is always present, because it is the identity of the
 * post, so deriving from it is more dependable than reading a field that may
 * not be there.
 */
export function postedAtFromUrn(urn: string | null): string | null {
  if (!urn) return null;
  const m = urn.match(/:(\d{10,})$/);
  if (!m) return null;
  try {
    const ms = Number(BigInt(m[1]) >> BigInt(22));
    if (!Number.isFinite(ms)) return null;
    const now = Date.now();
    // Same plausibility window as a provider-supplied date. LinkedIn changed id
    // schemes once before, and a wrong date is worse than none.
    if (ms < now - 5 * 365 * 86400_000 || ms > now + 86400_000) return null;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

export interface PostResult {
  ok: boolean;
  commentUrn?: string;
  commentId?: string;
  error?: string;
  /** True when the failure is worth retrying later rather than never. */
  retryable?: boolean;
}

/**
 * Publish one comment.
 *
 * Never batches. Every call is one comment that a person clicked to send, which
 * is both the safer pattern with LinkedIn and the honest one: a comment posted
 * under Anthony's name should be a thing Anthony decided to post.
 */
export function commentEndpoint(activityUrn: string): string {
  // Percent-encoded, because under X-Restli-Protocol-Version 2.0.0 the reserved
  // characters in a path key must be escaped. The colons in
  // urn:li:activity:123 become %3A. Sent raw, which is how LinkedIn's own
  // documentation prints it, the call returns 400 ILLEGAL_ARGUMENT "exception
  // in path variables", and their error table blames an invalid urn, which
  // sends you looking at the urn instead of at the encoding.
  return `${API}/rest/socialActions/${encodeURIComponent(activityUrn)}/comments`;
}

/**
 * The urn forms worth trying for the same post.
 *
 * socialActions accepts a share, a ugcPost or an activity urn, but not
 * interchangeably for every post: which one resolves depends on how the post
 * was originally created, and nothing in the URL says which. LinkedIn's own
 * guidance for ILLEGAL_ARGUMENT is literally "try again with a share or
 * ugcPost URN".
 *
 * Retrying is safe because the only trigger is a 400 rejection, which means
 * nothing was created. A failed call cannot leave a duplicate comment behind.
 */
export function urnVariants(activityUrn: string): string[] {
  const m = activityUrn.match(/^urn:li:(activity|ugcPost|share):(\d+)$/);
  if (!m) return [activityUrn];
  const id = m[2];
  const order = [m[1], "activity", "ugcPost", "share"];
  return Array.from(new Set(order)).map(t => `urn:li:${t}:${id}`);
}

export async function postComment(
  auth: LinkedInAuth,
  activityUrn: string,
  text: string,
): Promise<PostResult> {
  let lastBody = "";
  let lastStatus = 0;

  for (const urn of urnVariants(activityUrn)) {
    try {
      const r = await fetch(commentEndpoint(urn), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Linkedin-Version": LINKEDIN_VERSION,
          "X-Restli-Protocol-Version": "2.0.0",
          "content-type": "application/json",
        },
        body: JSON.stringify({ actor: auth.personUrn, object: urn, message: { text } }),
      });

      if (r.ok) {
        const id = r.headers.get("x-restli-id");
        const body: any = await r.json().catch(() => ({}));
        return {
          ok: true,
          commentId: id || body?.id,
          commentUrn: body?.commentUrn || (id ? `urn:li:comment:(${urn},${id})` : undefined),
        };
      }

      lastStatus = r.status;
      lastBody = await r.text().catch(() => "");

      if (r.status === 429) {
        return { ok: false, retryable: true, error: "LinkedIn is rate limiting comments. Wait a few minutes." };
      }
      if (r.status === 401 || r.status === 403) {
        // A 403 here usually means the token is fine but the app was never
        // granted w_member_social, which is a Products tab problem rather than
        // a stale token. The two have different fixes, so they are separated.
        const scopeIssue = /permission|scope|ACCESS_DENIED|not authorized/i.test(lastBody);
        return {
          ok: false,
          error: scopeIssue
            ? `LinkedIn refused the permission. The app needs w_member_social, which comes with ` +
              `the "Share on LinkedIn" product. Check the Products tab. ${lastBody.slice(0, 160)}`
            : `LinkedIn rejected the token (${r.status}). Reconnect the account. ${lastBody.slice(0, 160)}`,
        };
      }
      // Only an ILLEGAL_ARGUMENT is worth another urn form. Anything else is a
      // real failure and retrying would just repeat it.
      if (!(r.status === 400 && /ILLEGAL_ARGUMENT|path variables/i.test(lastBody))) break;
    } catch (e) {
      return { ok: false, retryable: true, error: e instanceof Error ? e.message : "network error" };
    }
  }

  return { ok: false, error: `LinkedIn returned ${lastStatus}. ${lastBody.slice(0, 240)}` };
}
