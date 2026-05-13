import { randomBytes } from "crypto";

export const adminSessions = new Map<string, number>();
export const adminChallenges = new Map<string, number>();
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [token, exp] of adminSessions) if (now > exp) adminSessions.delete(token);
  for (const [nonce, exp] of adminChallenges) if (now > exp) adminChallenges.delete(nonce);
}, 60_000);

export function generateAdminToken(): string {
  return randomBytes(32).toString("hex");
}

export function getOwnerAddresses(): string[] {
  const raw = process.env.ADMIN_WALLET_ADDRESSES || "";
  return raw.split(",").map(a => a.trim().toLowerCase()).filter(Boolean);
}

/**
 * Admin email allowlist. The /api/admin/login endpoint accepts a Rift
 * access token, calls Rift to resolve the signed-in user's email, and
 * grants admin access if that email appears here. Comma-separated.
 */
export function getOwnerEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || "";
  return raw.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
}

export function requireAdmin(req: any, res: any, next: any) {
  const token = req.headers["x-admin-token"] as string;
  const expiry = token ? adminSessions.get(token) : undefined;
  if (!expiry || Date.now() > expiry) {
    if (token) adminSessions.delete(token);
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}
