/**
 * Contact sales (from the demo) and the website Contact page. The request is stored and the
 * team is emailed (SALES_NOTIFY_EMAIL, else the admins).
 *
 *   POST /api/sales-requests   { name, email, company?, jobTitle?, phone?, enquiry?, country?, role?,
 *                                exposure?, monthlyVolume?, message?, source? }
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { ADMIN_EMAILS, escapeHtml, sendEmail, shell } from "../email";

/** Enquiry types on the Contact page. */
export const ENQUIRIES = [
  "General enquiries",
  "Protection for my business",
  "Underwriting and liquidity",
  "Partnerships",
  "API and integrations",
  "Media and press",
  "Security and vulnerability reporting",
  "Compliance and legal",
  "Complaints and feedback",
] as const;

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(160).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  enquiry: z.enum(ENQUIRIES).optional(),
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
  )`)
    .then(() => pool.query(`ALTER TABLE sales_requests
      ADD COLUMN IF NOT EXISTS job_title text,
      ADD COLUMN IF NOT EXISTS phone text,
      ADD COLUMN IF NOT EXISTS enquiry text`))
    .then(() => undefined);
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
        `INSERT INTO sales_requests (name, email, company, country, role, exposure, monthly_volume, message, source, job_title, phone, enquiry)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [r.name, r.email.toLowerCase(), r.company ?? null, r.country ?? null, r.role ?? null, r.exposure ?? null, r.monthlyVolume ?? null, r.message ?? null, r.source ?? null, r.jobTitle ?? null, r.phone ?? null, r.enquiry ?? null],
      );
      void emailAdminSalesRequest({ id: rows[0].id, ...r }).catch((err) => console.warn(`[sales] email failed: ${err?.message}`));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[sales] request failed:", err?.message);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });
}

/** Email the sales team (SALES_NOTIFY_EMAIL, else the admins) about a new request. */
async function emailAdminSalesRequest(req: {
  id: number;
  name: string;
  email: string;
  company?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  enquiry?: string | null;
  country?: string | null;
  role?: string | null;
  exposure?: string | null;
  monthlyVolume?: string | null;
  message?: string | null;
  source?: string | null;
}) {
  const rows = [
    ['Enquiry', req.enquiry],
    ['Name', req.name],
    ['Email', req.email],
    ['Company', req.company],
    ['Job title', req.jobTitle],
    ['Phone', req.phone],
    ['Country', req.country],
    ['Interested as', req.role],
    ['Exposure', req.exposure],
    ['Monthly volume', req.monthlyVolume],
    ['Message', req.message],
    ['Asked from', req.source],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;width:140px;vertical-align:top;">${k}</td><td style="padding:6px 0;color:#0f1a2f;font-size:13px;">${escapeHtml(String(v))}</td></tr>`,
    )
    .join('');
  const body = `
    <h2 style="font-size:18px;margin:0 0 12px;font-weight:600;letter-spacing:-0.01em;">Sales request #${req.id}</h2>
    <p style="font-size:13px;color:#5b6577;margin:0 0 16px;">Someone using the demo wants to talk about live protection.</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
  `;
  const to = (process.env.SALES_NOTIFY_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
  return sendEmail({
    to: to.length ? to : ADMIN_EMAILS,
    subject: `[BlockFinaX] Sales request from ${req.name}${req.company ? ` (${req.company})` : ''}`,
    html: shell('Sales request', body),
    replyTo: req.email,
  });
}
