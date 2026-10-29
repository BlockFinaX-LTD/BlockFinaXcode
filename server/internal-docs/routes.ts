/**
 * Internal developer docs in the admin dashboard (Dev docs).
 *
 * The documents live in the database, never in this repository: the repository is public
 * and these pages describe how the contracts work inside. An admin uploads an HTML file;
 * admins read it in the dashboard.
 *
 *   GET  /api/admin/internal-docs               list (slug, title, description, updated)
 *   POST /api/admin/internal-docs               add or replace { slug, title, description, html }
 *   POST /api/admin/internal-docs/:slug/delete  remove
 *   POST /api/admin/internal-docs/:slug/view    a viewing link valid for 10 minutes
 *   GET  /api/internal-docs/view/:token         the page itself, for the dashboard's frame
 *
 * The page is served as its own document with its own strict policy: it may run its own
 * inline script (a doc's calculator, say) but is sandboxed into a unique origin, so it can
 * read neither the admin's session nor anything else on the site, and it can only be
 * framed by the dashboard. The viewing link stands in for the admin token, which a frame
 * cannot send as a header.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { requireAdmin } from "../middleware/admin-auth";

const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;
/** The app parses request bodies up to 1 MB, so documents stay under that. */
const MAX_HTML = 900_000;
const VIEW_TTL_MS = 10 * 60 * 1000;
const viewTokens = new Map<string, { slug: string; expires: number }>();

let ready: Promise<void> | null = null;
async function docsDb() {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  const pending = (ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS internal_docs (
      slug text PRIMARY KEY,
      title text NOT NULL,
      description text,
      html text NOT NULL,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `).then(() => undefined));
  await pending;
  return pool;
}

/** The uploaded file may be a full document or just its body; both are served as a full document. */
export function asDocument(html: string): string {
  if (/^\s*<!doctype html/i.test(html) || /^\s*<html[\s>]/i.test(html)) return html;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${html}</body></html>`;
}

/** The policy each doc page is served with. */
export const DOC_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src data: https:",
  "frame-ancestors 'self'",
  "sandbox allow-scripts",
].join("; ");

export function registerInternalDocRoutes(app: Express) {
  const wrap = (h: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) =>
    h(req, res).catch((e) => res.status(400).json({ message: (e as Error).message }));

  app.get("/api/admin/internal-docs", requireAdmin, wrap(async (_req, res) => {
    const db = await docsDb();
    const { rows } = await db.query(`SELECT slug, title, description, updated_by, updated_at, length(html) AS size FROM internal_docs ORDER BY title`);
    res.json({ docs: rows.map((r: any) => ({ slug: r.slug, title: r.title, description: r.description, updatedBy: r.updated_by, updatedAt: r.updated_at, size: Number(r.size) })) });
  }));

  app.post("/api/admin/internal-docs", requireAdmin, wrap(async (req, res) => {
    const { slug, title, description, html } = req.body ?? {};
    if (typeof slug !== "string" || !SLUG.test(slug)) throw new Error("Use a short name of lowercase letters, numbers and hyphens");
    if (typeof title !== "string" || !title.trim()) throw new Error("Give the document a title");
    if (typeof html !== "string" || !html.trim()) throw new Error("Choose an HTML file");
    if (html.length > MAX_HTML) throw new Error("The file is larger than 900 KB");
    const db = await docsDb();
    await db.query(
      `INSERT INTO internal_docs (slug, title, description, html, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE SET title = $2, description = $3, html = $4, updated_by = $5, updated_at = now()`,
      [slug, title.trim().slice(0, 160), typeof description === "string" ? description.trim().slice(0, 400) || null : null, html, (req as any).adminEmail ?? null],
    );
    res.json({ ok: true });
  }));

  app.post("/api/admin/internal-docs/:slug/delete", requireAdmin, wrap(async (req, res) => {
    const db = await docsDb();
    const { rowCount } = await db.query(`DELETE FROM internal_docs WHERE slug = $1`, [req.params.slug]);
    if (!rowCount) throw new Error("Document not found");
    res.json({ ok: true });
  }));

  app.post("/api/admin/internal-docs/:slug/view", requireAdmin, wrap(async (req, res) => {
    const db = await docsDb();
    const { rowCount } = await db.query(`SELECT 1 FROM internal_docs WHERE slug = $1`, [req.params.slug]);
    if (!rowCount) throw new Error("Document not found");
    const now = Date.now();
    viewTokens.forEach((v, k) => { if (v.expires < now) viewTokens.delete(k); });
    const token = randomBytes(24).toString("base64url");
    viewTokens.set(token, { slug: req.params.slug, expires: now + VIEW_TTL_MS });
    res.json({ url: `/api/internal-docs/view/${token}` });
  }));

  app.get("/api/internal-docs/view/:token", async (req: Request, res: Response) => {
    const entry = viewTokens.get(req.params.token);
    if (!entry || entry.expires < Date.now()) return res.status(404).type("text/plain").send("This link has expired. Open the document again from the dashboard.");
    try {
      const db = await docsDb();
      const { rows } = await db.query(`SELECT html FROM internal_docs WHERE slug = $1`, [entry.slug]);
      if (!rows[0]) return res.status(404).type("text/plain").send("Document not found");
      res.setHeader("Content-Security-Policy", DOC_POLICY);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex");
      res.type("html").send(asDocument(rows[0].html));
    } catch {
      res.status(500).type("text/plain").send("Could not load the document");
    }
  });
}
