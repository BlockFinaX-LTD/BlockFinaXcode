import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { DOC_POLICY, asDocument } from "../routes";

test("a body-only upload is served as a full document; a full one is left alone", () => {
  assert.match(asDocument("<title>X</title><p>hi</p>"), /^<!doctype html><html lang="en"><head><meta charset="utf-8">/);
  const full = "<!doctype html><html><body>x</body></html>";
  assert.equal(asDocument(full), full);
});

test("doc pages are sandboxed, framed only by the dashboard, and reach no other site", () => {
  assert.match(DOC_POLICY, /sandbox allow-scripts/);
  assert.doesNotMatch(DOC_POLICY, /allow-same-origin/);
  assert.match(DOC_POLICY, /frame-ancestors 'self'/);
  assert.match(DOC_POLICY, /default-src 'none'/);
});

// Full round trip against a real database. Opt in, since CI has no database behind its URL:
// INTERNAL_DOCS_DB_TEST=1 DATABASE_URL=postgresql://localhost:5432/blockfinax_testnet npx tsx --test --test-force-exit <this file>
test("upload, list, view with a short-lived link, and refuse non-admins", { skip: process.env.INTERNAL_DOCS_DB_TEST !== "1" }, async () => {
  const { registerInternalDocRoutes } = await import("../routes");
  const { adminSessions } = await import("../../middleware/admin-auth");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerInternalDocRoutes(app);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = "test-admin-" + Date.now();
  adminSessions.set(token, { email: "admin@example.com", expiresAt: Date.now() + 60_000 } as any);
  const h = { "Content-Type": "application/json", "x-admin-token": token };
  const slug = "test-doc-" + Date.now();
  try {
    assert.equal((await fetch(`${base}/api/admin/internal-docs`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/internal-docs`, { method: "POST", headers: h, body: JSON.stringify({ slug: "Bad Slug", title: "t", html: "<p>x</p>" }) })).status, 400);
    const up = await fetch(`${base}/api/admin/internal-docs`, { method: "POST", headers: h, body: JSON.stringify({ slug, title: "Test doc", html: "<title>T</title><p>secret internals</p><script>1</script>" }) });
    assert.equal(up.status, 200);
    const list = await (await fetch(`${base}/api/admin/internal-docs`, { headers: h })).json();
    assert.ok(list.docs.some((d: any) => d.slug === slug && d.updatedBy === "admin@example.com"));
    const { url } = await (await fetch(`${base}/api/admin/internal-docs/${slug}/view`, { method: "POST", headers: h, body: "{}" })).json();
    const page = await fetch(base + url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-security-policy"), DOC_POLICY);
    assert.match(await page.text(), /secret internals/);
    assert.equal((await fetch(`${base}/api/internal-docs/view/not-a-token`)).status, 404);
  } finally {
    await fetch(`${base}/api/admin/internal-docs/${slug}/delete`, { method: "POST", headers: h, body: "{}" });
    adminSessions.delete(token);
    server.close();
    const { pool } = await import("../../db");
    await pool?.end();
  }
});
