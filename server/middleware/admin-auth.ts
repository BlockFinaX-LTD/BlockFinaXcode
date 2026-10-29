import { randomBytes } from "crypto";

/**
 * Admin sessions.
 *
 * The value carries the email the session was issued to, not just an expiry.
 * Admin access is a group — several people are in ADMIN_EMAILS — but some
 * actions belong to one person, and you cannot enforce that without knowing
 * who is holding the token.
 */
export interface AdminSession {
  expiresAt: number;
  email: string;
}

export const adminSessions = new Map<string, AdminSession>();
export const adminChallenges = new Map<string, number>();
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  // forEach rather than for..of: the build targets ES5, where iterating a Map
  // needs downlevelIteration.
  adminSessions.forEach((s, token) => { if (now > s.expiresAt) adminSessions.delete(token); });
  adminChallenges.forEach((exp, nonce) => { if (now > exp) adminChallenges.delete(nonce); });
}, 60_000).unref(); // housekeeping only: never keep a process (a test, a script) alive on its own

export function generateAdminToken(): string {
  return randomBytes(32).toString("hex");
}

export function getOwnerAddresses(): string[] {
  const raw = process.env.ADMIN_WALLET_ADDRESSES || "";
  return raw.split(",").map(a => a.trim().toLowerCase()).filter(Boolean);
}

/**
 * Admin email allowlist. The /api/admin/login endpoint accepts the session
 * token of a signed-in BlockFinaX user and grants admin access if that
 * account's email appears here. Comma-separated.
 */
export function getOwnerEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || "";
  return raw.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
}

/**
 * Who may approve what the agent proposes.
 *
 * A narrower list than ADMIN_EMAILS on purpose: administering the platform and
 * deciding what goes out to a counterparty in the CEO's name are different
 * authorities. Falls back to the founder's own addresses rather than to "any
 * admin", so a misconfigured environment restricts approval instead of
 * widening it.
 */
export function getApproverEmails(): string[] {
  const raw = (process.env.AGENT_APPROVERS || "").trim();
  const configured = raw.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return configured.length
    ? configured
    : ["anthonykumako@blockfinax.com", "anthonykumako8@gmail.com"];
}

/** The session behind this request, or null. */
export function sessionOf(req: any): AdminSession | null {
  const token = req.headers["x-admin-token"] as string;
  if (!token) return null;
  const s = adminSessions.get(token);
  if (!s || Date.now() > s.expiresAt) {
    if (token) adminSessions.delete(token);
    return null;
  }
  return s;
}

/** Email on the current session, or null. Used to attribute decisions. */
export function adminEmail(req: any): string | null {
  return sessionOf(req)?.email ?? null;
}

export function requireAdmin(req: any, res: any, next: any) {
  const session = sessionOf(req);
  if (!session) return res.status(401).json({ message: "Unauthorized" });
  // Downstream handlers read this rather than the map, so attribution can't
  // drift from the token that was actually presented.
  req.adminEmail = session.email;
  next();
}

/**
 * Stricter gate for decisions that are the founder's alone: approving or
 * rejecting what the agent proposes, and setting how much it does unattended.
 *
 * Deliberately separate from requireAdmin rather than folded into it. Other
 * admins should keep full access to the dashboard; they just don't get to
 * decide what leaves the building signed by someone else.
 */
export function requireApprover(req: any, res: any, next: any) {
  const session = sessionOf(req);
  if (!session) return res.status(401).json({ message: "Unauthorized" });
  if (!getApproverEmails().includes(session.email.toLowerCase())) {
    return res.status(403).json({
      message: "Only Anthony can approve or reject what the agent proposes.",
    });
  }
  req.adminEmail = session.email;
  next();
}
