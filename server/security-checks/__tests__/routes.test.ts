import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { parseCheck } from "../routes";

test("a check from an import file is trimmed and given defaults", () => {
  const c = parseCheck({ id: "audit", title: "  Audit  " }, 3);
  assert.equal(c.title, "Audit");
  assert.equal(c.area, "General");
  assert.equal(c.priority, "medium");
  assert.equal(c.sort, 3);
  assert.equal("status" in c, false);
});

test("unusable checks are refused with the reason", () => {
  assert.throws(() => parseCheck({ id: "Bad Id", title: "x" }, 0), /id must be/);
  assert.throws(() => parseCheck({ id: "ok", title: "" }, 0), /no title/);
  assert.throws(() => parseCheck({ id: "ok", title: "x", priority: "urgent" }, 0), /priority/);
  assert.throws(() => parseCheck({ id: "ok", title: "x", status: "finished" }, 0), /status/);
});

// Full round trip against a real database. Opt in, since CI has no database behind its URL:
// SECURITY_CHECKS_DB_TEST=1 DATABASE_URL=postgresql://localhost:5432/blockfinax_testnet npx tsx --test --test-force-exit <this file>
test("import, tick off, re-import keeps progress, and refuse non-admins", { skip: process.env.SECURITY_CHECKS_DB_TEST !== "1" }, async () => {
  const { registerSecurityCheckRoutes } = await import("../routes");
  const { adminSessions } = await import("../../middleware/admin-auth");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerSecurityCheckRoutes(app);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = "test-admin-" + Date.now();
  adminSessions.set(token, { email: "admin@example.com", expiresAt: Date.now() + 60_000 } as any);
  const h = { "Content-Type": "application/json", "x-admin-token": token };
  const id = "test-check-" + Date.now();
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/api/admin/security-checks`)).status, 401);
    assert.equal((await post("/api/admin/security-checks/import", { checks: [{ id, title: "a" }, { id, title: "b" }] })).status, 400);
    assert.equal((await post("/api/admin/security-checks/import", { checks: [{ id, title: "First", priority: "blocker" }] })).status, 200);
    assert.equal((await post(`/api/admin/security-checks/${id}`, { status: "done", notes: "Evidence", owner: "Anthony" })).status, 200);
    assert.equal((await post("/api/admin/security-checks/import", { checks: [{ id, title: "Reworded", priority: "blocker" }] })).status, 200);
    const { checks } = await (await fetch(`${base}/api/admin/security-checks`, { headers: h })).json();
    const c = checks.find((x: any) => x.id === id);
    assert.equal(c.title, "Reworded");
    assert.equal(c.status, "done");
    assert.equal(c.notes, "Evidence");
    assert.equal(c.owner, "Anthony");
    assert.equal(c.updatedBy, "admin@example.com");
  } finally {
    await post(`/api/admin/security-checks/${id}/delete`, {});
    server.close();
  }
});
