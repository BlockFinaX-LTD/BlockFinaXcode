/**
 * Acceptance of the Terms of Use and the Privacy Policy.
 *
 *   GET  /api/legal/status    the current versions and whether this account accepted them
 *   POST /api/legal/accept    { terms, privacy }  record acceptance of the current versions
 *
 * Each acceptance is kept as its own row (account, document, version, time, device), so
 * there is a record of exactly what each person agreed to and when. Table created on first use.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import { getSession } from "../auth-routes";

let ready: Promise<void> | null = null;
async function legalDb() {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS legal_acceptances (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      document text NOT NULL,
      version text NOT NULL,
      accepted_at timestamptz NOT NULL DEFAULT now(),
      ip text,
      user_agent text
    );
    CREATE INDEX IF NOT EXISTS legal_acceptances_user_idx ON legal_acceptances (user_id, document);
  `).then(() => undefined);
  await ready;
  return pool;
}

/** Which of the current documents the user has accepted. */
export async function legalStatus(userId: number) {
  const db = await legalDb();
  const { rows } = await db.query(
    `SELECT document, version FROM legal_acceptances WHERE user_id = $1 AND ((document = 'terms' AND version = $2) OR (document = 'privacy' AND version = $3))`,
    [userId, TERMS_VERSION, PRIVACY_VERSION],
  );
  const has = (d: string) => rows.some((r: any) => r.document === d);
  return {
    terms: { version: TERMS_VERSION, accepted: has("terms") },
    privacy: { version: PRIVACY_VERSION, accepted: has("privacy") },
  };
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

export function registerLegalRoutes(app: Express) {
  app.get("/api/legal/status", wrap(async (req, res) => {
    const session = await getSession(req);
    if (!session?.userId) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Sign in first" } });
    const s = await legalStatus(session.userId);
    // Accepted an earlier version: the card says the documents were updated.
    const { rows: [prior] } = await (await legalDb()).query(`SELECT 1 FROM legal_acceptances WHERE user_id = $1 LIMIT 1`, [session.userId]);
    res.json({ ...s, needsAcceptance: !s.terms.accepted || !s.privacy.accepted, updated: Boolean(prior) });
  }));

  app.post("/api/legal/accept", wrap(async (req, res) => {
    const session = await getSession(req);
    if (!session?.userId) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Sign in first" } });
    const { terms, privacy } = req.body ?? {};
    // Only the versions on screen now can be accepted, so a stale page cannot agree to old terms.
    if (terms !== TERMS_VERSION || privacy !== PRIVACY_VERSION) {
      return res.status(409).json({ error: { code: "OUTDATED", message: "The Terms or Privacy Policy changed. Refresh to read the latest versions." } });
    }
    const db = await legalDb();
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim().slice(0, 64) || null;
    const ua = String(req.headers["user-agent"] ?? "").slice(0, 300) || null;
    const status = await legalStatus(session.userId);
    for (const [document, version, done] of [["terms", TERMS_VERSION, status.terms.accepted], ["privacy", PRIVACY_VERSION, status.privacy.accepted]] as const) {
      if (!done) await db.query(`INSERT INTO legal_acceptances (user_id, document, version, ip, user_agent) VALUES ($1,$2,$3,$4,$5)`, [session.userId, document, version, ip, ua]);
    }
    res.json({ ok: true });
  }));
}
