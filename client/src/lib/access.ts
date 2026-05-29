/**
 * access.ts — Client-side access gate helpers
 *
 * After a user signs in via the Rift widget, we check their email against
 * the backend allowlist. The result is cached in sessionStorage so we
 * don't re-check on every navigation.
 */

const CACHE_KEY = 'bfx_access_check';
const CACHE_TTL_MS = 5 * 60 * 1000;

export type AccessStatus = 'allowed' | 'pending' | 'rejected' | 'none';

interface CachedResult {
  email: string;
  allowed: boolean;
  status: AccessStatus;
  at: number;
}

export async function checkAccess(email: string): Promise<{ allowed: boolean; status: AccessStatus }> {
  const norm = (email || '').trim().toLowerCase();
  if (!norm) return { allowed: false, status: 'none' };

  // Cache hit?
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as CachedResult;
      if (
        cached.email === norm &&
        Date.now() - cached.at < CACHE_TTL_MS
      ) {
        return { allowed: cached.allowed, status: cached.status };
      }
    }
  } catch {
    /* ignore */
  }

  const res = await fetch(`/api/access/check?email=${encodeURIComponent(norm)}`);
  if (!res.ok) return { allowed: false, status: 'none' };
  const json = (await res.json()) as { allowed: boolean; status: AccessStatus };

  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ email: norm, allowed: json.allowed, status: json.status, at: Date.now() } as CachedResult),
    );
  } catch {
    /* ignore */
  }

  return json;
}

export function invalidateAccessCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export interface AccessRequestPayload {
  name: string;
  email: string;
  country?: string;
  role?: string;
  company?: string;
  useCase?: string;
  heardFrom?: string;
  socialHandle?: string;
}

export async function submitAccessRequest(payload: AccessRequestPayload): Promise<{ status: string; id?: number }> {
  const res = await fetch('/api/access/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to submit request');
  }
  return res.json();
}

// ── Signin token (issued on approval, gates /auth) ───────────────────────

const SIGNIN_KEY = 'bfx_signin_token';

interface StoredSignin {
  token: string;
  expiresAt: string;
}

export function getStoredSigninToken(): StoredSignin | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SIGNIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSignin;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(SIGNIN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setStoredSigninToken(token: string, expiresAt: string): void {
  try {
    localStorage.setItem(SIGNIN_KEY, JSON.stringify({ token, expiresAt }));
  } catch {
    /* ignore */
  }
}

export function clearStoredSigninToken(): void {
  try {
    localStorage.removeItem(SIGNIN_KEY);
  } catch {
    /* ignore */
  }
}

export async function verifySigninToken(token: string): Promise<{ valid: boolean; expiresAt?: string; reason?: string }> {
  try {
    const res = await fetch(`/api/access/signin-verify?t=${encodeURIComponent(token)}`);
    if (!res.ok) return { valid: false };
    return res.json();
  } catch {
    return { valid: false };
  }
}
