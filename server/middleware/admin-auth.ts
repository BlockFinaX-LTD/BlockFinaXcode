import { randomBytes, createHash } from "crypto";

/**
 * Admin sessions.
 *
 * The value carries the email the session was issued to, not just an expiry.
 * Admin access is a group — several people are in ADMIN_EMAILS — but some
 * actions belong to one person, and you cannot enforce that without knowing
 * who is holding the token.
 */
interface AdminSession {
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
function sessionOf(req: any): AdminSession | null {
  const token = req.headers["x-admin-token"] as string;
  if (!token) return null;
  const s = adminSessions.get(token);
  if (!s || Date.now() > s.expiresAt) {
    if (token) adminSessions.delete(token);
    return null;
  }
  return s;
}

/*
 * Sessions are kept in the database as well as in memory, so a deploy or restart
 * does not sign every admin out. Only a SHA-256 hash of the token is stored; the
 * token itself never leaves the browser and this process. Expiry slides: each use
 * pushes it ADMIN_SESSION_TTL_MS ahead, so an idle session still ends.
 */
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
let tableReady: Promise<Db | null> | null = null;
function store(): Promise<Db | null> {
  tableReady ??= import("../db").then(async ({ pool }) => {
    const db = pool as unknown as Db;
    if (!db) return null;
    await db.query(`CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash text PRIMARY KEY, email text NOT NULL, expires_at timestamptz NOT NULL)`);
    return db;
  }).catch(() => null);
  return tableReady;
}
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const lastWrite = new Map<string, number>();

/** Start a session: in memory now, in the database in the background. */
export function startAdminSession(token: string, email: string): number {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  adminSessions.set(token, { expiresAt, email });
  void store().then((db) => db?.query(
    `INSERT INTO admin_sessions (token_hash, email, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO UPDATE SET email = $2, expires_at = $3`,
    [hashOf(token), email, new Date(expiresAt)],
  )).catch(() => undefined);
  return expiresAt;
}

/** End a session everywhere. */
export function endAdminSession(token: string): void {
  adminSessions.delete(token);
  void store().then((db) => db?.query(`DELETE FROM admin_sessions WHERE token_hash = $1 OR expires_at < now()`, [hashOf(token)]))
    .catch(() => undefined);
}

/** Push an active session's expiry forward; the database copy at most every 10 minutes. */
function touch(token: string, s: AdminSession) {
  s.expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  const last = lastWrite.get(token) ?? 0;
  if (Date.now() - last < 10 * 60_000) return;
  lastWrite.set(token, Date.now());
  void store().then((db) => db?.query(`UPDATE admin_sessions SET expires_at = $2 WHERE token_hash = $1`, [hashOf(token), new Date(s.expiresAt)]))
    .catch(() => undefined);
}

/** A session from the database, after a restart emptied memory. */
async function loadSession(token: string): Promise<AdminSession | null> {
  const db = await store();
  if (!db) return null;
  const { rows } = await db.query(
    `SELECT email, expires_at FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()`, [hashOf(token)]);
  if (!rows[0]) return null;
  const s: AdminSession = { email: rows[0].email, expiresAt: new Date(rows[0].expires_at).getTime() };
  adminSessions.set(token, s);
  return s;
}

export function requireAdmin(req: any, res: any, next: any) {
  const pass = (session: AdminSession) => {
    // Downstream handlers read this rather than the map, so attribution can't
    // drift from the token that was actually presented.
    req.adminEmail = session.email;
    touch(String(req.headers["x-admin-token"]), session);
    recordStaffActivity(req, res, session.email);
    next();
  };
  const session = sessionOf(req);
  if (session) return pass(session);
  const token = req.headers["x-admin-token"];
  if (!token || typeof token !== "string") return res.status(401).json({ message: "Unauthorized" });
  loadSession(token)
    .then((s) => (s ? pass(s) : res.status(401).json({ message: "Unauthorized" })))
    .catch(() => res.status(401).json({ message: "Unauthorized" }));
}

/** Admin reads that open someone's personal or financial data. */
const SENSITIVE_READ = /\/(kyc|users?|profiles?|documents?|proofs?|positions|hedges?|withdrawals|wallets?|signatures|sanctions|alerts|compliance|organisations?|otc)(\/|$|\?)/i;
const REDACT = /secret|password|token|private|mnemonic|seed|key|signature|^data$|file|image|base64/i;

/** A request body for the log: field names kept, sensitive values and large blobs removed. */
function redactBody(body: unknown, depth = 0): unknown {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body.length > 300 ? `${body.slice(0, 300)}…` : body;
  if (typeof body !== "object") return body;
  if (depth > 3) return "[nested]";
  if (Array.isArray(body)) return body.slice(0, 20).map((v) => redactBody(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>).slice(0, 40)) out[k] = REDACT.test(k) ? "[redacted]" : redactBody(v, depth + 1);
  return out;
}

/**
 * Every staff change (any method other than GET) is written to the compliance log with who,
 * what, when and the result; reads that open personal or financial data are logged as views.
 * The records API logs its own views, so it is skipped here.
 */
function recordStaffActivity(req: any, res: any, email: string) {
  if (req.__staffRecorded) return; // guarded twice (global /api/admin gate and the route's own)
  req.__staffRecorded = true;
  const method = String(req.method || "GET").toUpperCase();
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  const isRead = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (isRead && (!SENSITIVE_READ.test(path) || path.startsWith("/api/admin/records/"))) return;
  res.on("finish", () => {
    if (isRead && res.statusCode >= 400) return;
    import("../records/log").then(({ recordSoon }) => recordSoon({
      actor: { type: "staff", id: email },
      action: isRead ? "data.viewed" : "staff.action",
      subject: { type: "endpoint", id: `${method} ${path}` },
      data: isRead ? { path } : { method, path, status: res.statusCode, body: redactBody(req.body) },
    })).catch(() => undefined);
  });
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
  recordStaffActivity(req, res, session.email);
  next();
}
