/**
 * Security checks before mainnet, in the admin dashboard.
 *
 * The checks name the weak spots that must be closed before real money, so they live in the
 * database, never in this public repository. An admin imports them from a JSON file, ticks
 * them off and keeps notes; every change records who made it and when.
 *
 *   GET  /api/admin/security-checks              the list
 *   POST /api/admin/security-checks/import       add or replace { checks: [...] } by id
 *   POST /api/admin/security-checks/:id          change { status?, notes?, owner? } (or a full check)
 *   POST /api/admin/security-checks/:id/delete   remove
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "../middleware/admin-auth";

export const STATUSES = ["todo", "in_progress", "done", "not_needed"] as const;
export const PRIORITIES = ["blocker", "high", "medium", "low"] as const;
type Status = (typeof STATUSES)[number];
type Priority = (typeof PRIORITIES)[number];

export interface SecurityCheck {
  id: string;
  area: string;
  title: string;
  why: string;
  how: string;
  priority: Priority;
  status: Status;
  owner: string | null;
  notes: string | null;
  sort: number;
}

const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** One check from an import file, checked and trimmed. Throws with the reason if it is unusable. */
export function parseCheck(raw: any, index: number): Omit<SecurityCheck, "status" | "owner" | "notes"> & Partial<Pick<SecurityCheck, "status" | "owner" | "notes">> {
  const where = `Check ${index + 1}`;
  if (!raw || typeof raw !== "object") throw new Error(`${where} is not an object`);
  if (typeof raw.id !== "string" || !ID.test(raw.id)) throw new Error(`${where}: the id must be lowercase letters, numbers and hyphens`);
  const title = text(raw.title, 200);
  if (!title) throw new Error(`${where} (${raw.id}) has no title`);
  const priority = raw.priority ?? "medium";
  if (!PRIORITIES.includes(priority)) throw new Error(`${where} (${raw.id}): priority must be one of ${PRIORITIES.join(", ")}`);
  if (raw.status !== undefined && !STATUSES.includes(raw.status)) throw new Error(`${where} (${raw.id}): status must be one of ${STATUSES.join(", ")}`);
  return {
    id: raw.id,
    area: text(raw.area, 80) || "General",
    title,
    why: text(raw.why, 2000),
    how: text(raw.how, 4000),
    priority,
    sort: Number.isFinite(raw.sort) ? Math.trunc(raw.sort) : index,
    ...(raw.status !== undefined ? { status: raw.status } : {}),
    ...(typeof raw.owner === "string" ? { owner: text(raw.owner, 120) || null } : {}),
    ...(typeof raw.notes === "string" ? { notes: text(raw.notes, 4000) || null } : {}),
  };
}

let ready: Promise<void> | null = null;
async function checksDb() {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  const pending = (ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS security_checks (
      id text PRIMARY KEY,
      area text NOT NULL,
      title text NOT NULL,
      why text NOT NULL DEFAULT '',
      how text NOT NULL DEFAULT '',
      priority text NOT NULL DEFAULT 'medium',
      status text NOT NULL DEFAULT 'todo',
      owner text,
      notes text,
      sort integer NOT NULL DEFAULT 0,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `).then(() => undefined));
  await pending;
  return pool;
}

const asCheck = (r: any) => ({
  id: r.id, area: r.area, title: r.title, why: r.why, how: r.how, priority: r.priority, status: r.status,
  owner: r.owner, notes: r.notes, sort: r.sort, updatedBy: r.updated_by, updatedAt: r.updated_at,
});

export function registerSecurityCheckRoutes(app: Express) {
  const wrap = (h: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) =>
    h(req, res).catch((e) => res.status(400).json({ message: (e as Error).message }));

  app.get("/api/admin/security-checks", requireAdmin, wrap(async (_req, res) => {
    const db = await checksDb();
    const { rows } = await db.query(`SELECT * FROM security_checks ORDER BY sort, id`);
    res.json({ checks: rows.map(asCheck) });
  }));

  // Importing adds new checks and updates the wording of existing ones. Progress already
  // recorded (status, owner, notes) is kept unless the file sets it.
  app.post("/api/admin/security-checks/import", requireAdmin, wrap(async (req, res) => {
    const list = Array.isArray(req.body?.checks) ? req.body.checks : Array.isArray(req.body) ? req.body : null;
    if (!list || !list.length) throw new Error("The file needs a list of checks");
    if (list.length > 500) throw new Error("At most 500 checks in one file");
    const checks = list.map(parseCheck);
    const ids = new Set<string>();
    for (const c of checks) { if (ids.has(c.id)) throw new Error(`The id ${c.id} appears twice`); ids.add(c.id); }
    const db = await checksDb();
    const by = (req as any).adminEmail ?? null;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const c of checks) {
        await client.query(
          `INSERT INTO security_checks (id, area, title, why, how, priority, sort, status, owner, notes, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'todo'), $9, $10, $11)
           ON CONFLICT (id) DO UPDATE SET area = $2, title = $3, why = $4, how = $5, priority = $6, sort = $7,
             status = COALESCE($8, security_checks.status),
             owner = CASE WHEN $12 THEN $9 ELSE security_checks.owner END,
             notes = CASE WHEN $13 THEN $10 ELSE security_checks.notes END,
             updated_by = $11, updated_at = now()`,
          [c.id, c.area, c.title, c.why, c.how, c.priority, c.sort, c.status ?? null, c.owner ?? null, c.notes ?? null, by, "owner" in c, "notes" in c],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, imported: checks.length });
  }));

  app.post("/api/admin/security-checks/:id", requireAdmin, wrap(async (req, res) => {
    const { status, notes, owner } = req.body ?? {};
    if (status !== undefined && !STATUSES.includes(status)) throw new Error(`Status must be one of ${STATUSES.join(", ")}`);
    const db = await checksDb();
    const { rowCount } = await db.query(
      `UPDATE security_checks SET
         status = COALESCE($2, status),
         notes = CASE WHEN $3 THEN $4 ELSE notes END,
         owner = CASE WHEN $5 THEN $6 ELSE owner END,
         updated_by = $7, updated_at = now()
       WHERE id = $1`,
      [req.params.id, status ?? null, typeof notes === "string", text(notes, 4000) || null, typeof owner === "string", text(owner, 120) || null, (req as any).adminEmail ?? null],
    );
    if (!rowCount) throw new Error("Check not found");
    res.json({ ok: true });
  }));

  app.post("/api/admin/security-checks/:id/delete", requireAdmin, wrap(async (req, res) => {
    const db = await checksDb();
    const { rowCount } = await db.query(`DELETE FROM security_checks WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw new Error("Check not found");
    res.json({ ok: true });
  }));
}
