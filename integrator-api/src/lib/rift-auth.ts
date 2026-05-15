/**
 * Rift JWT verifier — copied verbatim from the main app so this package
 * is fully self-contained (no cross-package imports). Verifies an
 * `Authorization: Bearer <accessToken>` against Rift's /user/me and
 * attaches `req.riftUser`. Cached for 60s.
 */

import type { NextFunction, Request, Response } from "express";

const RIFT_API_BASE = process.env.RIFT_API_BASE || "https://payment.riftfi.xyz";
const RIFT_API_KEY  = process.env.RIFT_API_KEY || process.env.VITE_RIFT_API_KEY || "";

const CACHE_TTL_MS = 60_000;
const NEG_CACHE_TTL_MS = 5_000;

export interface RiftAuthenticatedUser {
  address: string;
  email: string | null;
  phoneNumber: string | null;
  externalId: string | null;
  user: string;
}

interface CacheEntry { expiresAt: number; user: RiftAuthenticatedUser | null; }
const cache = new Map<string, CacheEntry>();

declare global {
  namespace Express {
    interface Request {
      riftUser?: RiftAuthenticatedUser;
    }
  }
}

function getBearer(req: Request): string | null {
  const h = (req.headers.authorization || req.headers.Authorization) as string | undefined;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

async function fetchRiftUser(accessToken: string): Promise<RiftAuthenticatedUser | null> {
  if (!RIFT_API_KEY) {
    console.error("[rift-auth] RIFT_API_KEY missing");
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

export async function verifyRiftAccessToken(token: string): Promise<RiftAuthenticatedUser | null> {
  const now = Date.now();
  const c = cache.get(token);
  if (c && c.expiresAt > now) return c.user;
  const user = await fetchRiftUser(token);
  cache.set(token, { user, expiresAt: now + (user ? CACHE_TTL_MS : NEG_CACHE_TTL_MS) });
  return user;
}

export async function requireRiftUser(req: Request, res: Response, next: NextFunction) {
  const token = getBearer(req);
  if (!token) return res.status(401).json({ error: { code: "unauthorized", message: "Authentication required" } });
  const user = await verifyRiftAccessToken(token);
  if (!user) return res.status(401).json({ error: { code: "unauthorized", message: "Your session is invalid or expired. Sign in again." } });
  req.riftUser = user;
  next();
}

setInterval(() => {
  const now = Date.now();
  Array.from(cache.entries()).forEach(([k, v]) => { if (v.expiresAt < now) cache.delete(k); });
}, 60_000).unref?.();
