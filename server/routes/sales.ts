/**
 * Contact sales, from the demo. A visitor who wants live protection leaves their details;
 * the request is stored and the sales team is emailed (SALES_NOTIFY_EMAIL, else the admins).
 *
 *   POST /api/sales-requests   { name, email, company?, country?, role?, exposure?, monthlyVolume?, message?, source? }
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(160).optional(),
  country: z.string().trim().max(80).optional(),
  role: z.enum(["business", "underwriter", "partner", "other"]).optional(),
  exposure: z.string().trim().max(200).optional(),
  monthlyVolume: z.string().trim().max(80).optional(),
  message: z.string().trim().max(2000).optional(),
  source: z.string().trim().max(80).optional(),
});

let tableReady: Promise<void> | null = null;
async function ensureTable() {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  tableReady ??= pool.query(`CREATE TABLE IF NOT EXISTS sales_requests (
    id serial PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL,
    company text,
    country text,
    role text,
    exposure text,
    monthly_volume text,
    message text,
    source text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`).then(() => undefined);
  await tableReady;
  return pool;
}

/** A few requests per visitor per hour, so the form cannot be used to flood the inbox. */
const recent = new Map<string, number[]>();
function allowed(key: string) {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (hits.length >= 5) return false;
  hits.push(now);
  recent.set(key, hits);
  return true;
}

export function registerSalesRoutes(app: Express) {
  app.post("/api/sales-requests", async (req: Request, res: Response) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Please enter your name and a valid email." });
    if (!allowed(req.ip ?? "unknown")) return res.status(429).json({ message: "Thanks, we already have your request. We will be in touch." });
    try {
      const pool = await ensureTable();
      const r = parsed.data;
      const { rows } = await pool.query(
        `INSERT INTO sales_requests (name, email, company, country, role, exposure, monthly_volume, message, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [r.name, r.email.toLowerCase(), r.company ?? null, r.country ?? null, r.role ?? null, r.exposure ?? null, r.monthlyVolume ?? null, r.message ?? null, r.source ?? null],
      );
      const { emailAdminSalesRequest } = await import("../email");
      void emailAdminSalesRequest({ id: rows[0].id, ...r }).catch((err) => console.warn(`[sales] email failed: ${err?.message}`));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[sales] request failed:", err?.message);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });
}
