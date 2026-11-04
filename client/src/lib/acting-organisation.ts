/**
 * Which account the app is acting for: the user's own, or an organisation they belong to.
 *
 * A per-device convenience only. The server checks membership and role on every request,
 * so a stale or edited value here can never grant anything; at worst a request is refused.
 */
const KEY = "bfx:acting-organisation";
const INVITE_KEY = "bfx:organisation-invite";
const EVENT = "bfx:acting-organisation";

export interface ActingOrganisation {
  id: number;
  name: string;
  account: string;
  role: "admin" | "operator" | "viewer";
}

export function actingOrganisation(): ActingOrganisation | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ActingOrganisation) : null;
  } catch {
    return null;
  }
}

export function setActingOrganisation(org: ActingOrganisation | null) {
  try {
    if (org) localStorage.setItem(KEY, JSON.stringify(org));
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable: acting for the personal account */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT));
}

export function onActingOrganisationChange(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** The header the server reads to act for an organisation. */
export function actingHeaders(): Record<string, string> {
  const org = actingOrganisation();
  return org ? { "X-BFX-Organisation": String(org.id) } : {};
}

/** An invitation opened before signing in, kept for this tab only. */
export function pendingInviteToken(): string | null {
  try { return sessionStorage.getItem(INVITE_KEY); } catch { return null; }
}
export function setPendingInviteToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(INVITE_KEY, token);
    else sessionStorage.removeItem(INVITE_KEY);
  } catch { /* storage unavailable: the link must be opened again after sign-in */ }
}
