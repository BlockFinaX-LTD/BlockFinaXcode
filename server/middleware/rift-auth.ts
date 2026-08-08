/**
 * rift-auth.ts — Verifies the caller's Rift access token (Authorization: Bearer)
 * against Rift's `/user/me` and attaches the resolved user to the request.
 *
 * Usage:
 *   import { requireRiftUser } from "../middleware/rift-auth";
 *   app.post("/api/tasks/complete", requireRiftUser, async (req, res) => {
 *     const wallet = req.riftUser!.address;   // verified by Rift
 *     ...
 *   });
 *
 * We cache the (token → user) lookup for a short TTL so a burst of API calls
 * doesn't slam Rift. Cache key is the access token itself.
 */

import type { Request, Response, NextFunction } from "express";

const RIFT_API_BASE = process.env.RIFT_API_BASE || "https://payment.riftfi.xyz";
/**
 * Server-side key. Prefers RIFT_SECRET_KEY, which must never carry a VITE_
 * prefix — that prefix is what puts a value into the public browser bundle.
 */
const RIFT_API_KEY = process.env.RIFT_SECRET_KEY || process.env.RIFT_API_KEY || process.env.VITE_RIFT_API_KEY || "";

const CACHE_TTL_MS = 60_000; // 60s — short enough to honor revocations, long enough to absorb bursts
const NEG_CACHE_TTL_MS = 5_000; // briefly cache rejections too so bad tokens don't pound Rift

export interface RiftAuthenticatedUser {
  address: string;
  email: string | null;
  phoneNumber: string | null;
  externalId: string | null;
  user: string; // Rift UUID
}

interface CacheEntry {
  expiresAt: number;
  user: RiftAuthenticatedUser | null; // null = verified rejection
}

const cache = new Map<string, CacheEntry>();

declare global {
  namespace Express {
    interface Request {
      riftUser?: RiftAuthenticatedUser;
    }
  }
}

function getBearerToken(req: Request): string | null {
  const header = (req.headers.authorization || req.headers.Authorization) as string | undefined;
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

async function fetchRiftUser(accessToken: string): Promise<RiftAuthenticatedUser | null> {
  if (!RIFT_API_KEY) {
    console.error("[rift-auth] VITE_RIFT_API_KEY is not set on the server");
    return null;
  }
  try {
    const r = await fetch(`${RIFT_API_BASE}/user/me`, {
      method: "GET",
      headers: {
        "X-API-Key": RIFT_API_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!r.ok) return null;
    const body = (await r.json()) as any;
    // The SDK wraps payloads inconsistently — be liberal in what we accept.
    const u = body?.user ?? body?.data?.user ?? body?.data ?? body;
    if (!u?.address) return null;
    return {
      address: String(u.address).toLowerCase(),
      email: u.email ?? null,
      phoneNumber: u.phoneNumber ?? u.phone ?? null,
      externalId: u.externalId ?? null,
      user: u.user ?? u.id ?? "",
    };
  } catch (err: any) {
    console.error("[rift-auth] /user/me unreachable:", err?.message);
    return null;
  }
}

/**
 * Resolve a Rift access token to a verified user (or null). Cached.
 * Exported so non-middleware callers (admin login, etc.) can reuse it.
 */
export async function verifyRiftAccessToken(accessToken: string): Promise<RiftAuthenticatedUser | null> {
  const now = Date.now();
  const cached = cache.get(accessToken);
  if (cached && cached.expiresAt > now) return cached.user;

  const user = await fetchRiftUser(accessToken);
  cache.set(accessToken, {
    user,
    expiresAt: now + (user ? CACHE_TTL_MS : NEG_CACHE_TTL_MS),
  });
  return user;
}

/**
 * Express middleware. Rejects with 401 unless a valid Bearer token resolves
 * to a Rift user. Attaches `req.riftUser` on success.
 */
export async function requireRiftUser(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const user = await verifyRiftAccessToken(token);
  if (!user) {
    return res.status(401).json({ error: "Your session is invalid or expired. Sign in again." });
  }
  req.riftUser = user;
  next();
}

// Light cleanup so the in-memory cache doesn't grow unbounded
setInterval(() => {
  const now = Date.now();
  Array.from(cache.entries()).forEach(([k, v]) => { if (v.expiresAt < now) cache.delete(k); });
}, 60_000).unref?.();
