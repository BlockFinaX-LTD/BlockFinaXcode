/**
 * Compliance records API.
 *
 * Customers (signed in):
 *   GET  /api/records/retention                       what we keep, how long and why
 *   GET  /api/records/complaints   POST same           their complaints / make one
 *   GET  /api/records/deletion     POST same           their deletion request / ask for one
 *   GET  /api/records/kyb/:org     POST same           a business's identity check (admins of it)
 *   POST /api/records/kyb/:org/:submission/documents  upload a document for it
 *
 * BlockFinaX staff (admin session; every call is itself recorded by requireAdmin):
 *   GET  /api/admin/records/log?action=&subjectType=&subjectId=&actorId=&from=&to=&limit=
 *   GET  /api/admin/records/verify                    recompute the whole hash chain
 *   GET  /api/admin/records/anchors   POST .../anchor  daily anchors on Stellar / anchor now
 *   GET  /api/admin/records/complaints   PATCH .../complaints/:id
 *   GET  /api/admin/records/kyb   GET .../kyb/:id   GET .../kyb/:id/documents/:doc   POST .../kyb/:id/decision
 *   GET  /api/admin/records/cases   POST same   GET .../cases/:id   POST .../cases/:id/notes   POST .../cases/:id/decision
 *   GET  /api/admin/records/deletion   POST .../deletion/:id/complete
 *   GET  /api/admin/records/accounts/summary?days=   GET .../accounts?search=   GET .../accounts/:id
 *   GET  /api/admin/records/travel-rule
 *   GET  /api/admin/records/report?from=&to=&format=csv
 */
import type { Express, NextFunction, Request, Response } from "express";
import { ApplicationError } from "@shared/domain/types";
import { retentionSummary } from "@shared/records/retention";
import { getSession } from "../auth-routes";
import { requireAdmin } from "../middleware/admin-auth";
import { accountDetail, accountsSummary, listAccounts } from "./accounts";
import { anchorYesterday, listAnchors } from "./anchor";
import { listLog, verifyLog } from "./log";
import { regulatoryReport, reportCsv } from "./reports";
import * as store from "./store";

const STATUS: Record<string, number> = { UNAUTHORIZED: 401, INVALID_REQUEST: 400, TRAVEL_RULE_REQUIRED: 400 };

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch((err) => {
    if (err instanceof ApplicationError) return res.status(STATUS[err.code] ?? 400).json({ error: { code: err.code, message: err.message } });
    next(err);
  });

async function signedIn(req: Request): Promise<number> {
  const s = await getSession(req);
  if (!s?.userId) throw new ApplicationError("UNAUTHORIZED", "Sign in first");
  return s.userId;
}
const staffOf = (req: Request) => String((req as any).adminEmail ?? "unknown");
const num = (v: unknown, name: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApplicationError("INVALID_REQUEST", `${name} is invalid`);
  return n;
};
const orgHeader = (req: Request) => { const n = Number(req.header("x-bfx-organisation")); return Number.isInteger(n) && n > 0 ? n : null; };

export function registerRecordsRoutes(app: Express) {
  // ── Customers ──
  app.get("/api/records/retention", (_req, res) => { res.json({ rules: retentionSummary(), travelRuleThresholdUsd: store.travelRuleThreshold() }); });

  app.get("/api/records/complaints", wrap(async (req, res) => { res.json({ complaints: await store.myComplaints(await signedIn(req)), sla: store.COMPLAINT_SLA, categories: store.COMPLAINT_CATEGORIES }); }));
  app.post("/api/records/complaints", wrap(async (req, res) => { res.json({ complaint: await store.submitComplaint(await signedIn(req), orgHeader(req), req.body ?? {}) }); }));

  app.get("/api/records/deletion", wrap(async (req, res) => { res.json({ request: await store.myDeletionRequest(await signedIn(req)) }); }));
  app.post("/api/records/deletion", wrap(async (req, res) => { res.json({ request: await store.requestDeletion(await signedIn(req)) }); }));

  app.get("/api/records/kyb/:org", wrap(async (req, res) => { res.json({ submission: await store.kybStatus(await signedIn(req), num(req.params.org, "organisation")) }); }));
  app.post("/api/records/kyb/:org", wrap(async (req, res) => { res.json({ submission: await store.submitKyb(await signedIn(req), num(req.params.org, "organisation"), req.body ?? {}) }); }));
  app.post("/api/records/kyb/:org/:submission/documents", wrap(async (req, res) => {
    res.json({ document: await store.uploadKybDocument(await signedIn(req), num(req.params.org, "organisation"), num(req.params.submission, "submission"), req.body ?? {}) });
  }));

  // ── Staff ──
  const admin = (path: string, method: "get" | "post" | "patch", fn: (req: Request, res: Response) => Promise<unknown>) =>
    (app as any)[method](path, requireAdmin, wrap(fn));

  admin("/api/admin/records/log", "get", async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json({ entries: await listLog({ action: q.action, subjectType: q.subjectType, subjectId: q.subjectId, actorId: q.actorId, from: q.from, to: q.to, limit: q.limit ? Number(q.limit) : undefined }) });
  });
  admin("/api/admin/records/verify", "get", async (_req, res) => { res.json(await verifyLog()); });
  admin("/api/admin/records/anchors", "get", async (_req, res) => { res.json({ anchors: await listAnchors() }); });
  admin("/api/admin/records/anchor", "post", async (_req, res) => { res.json(await anchorYesterday()); });
  admin("/api/admin/records/retention", "get", async (_req, res) => { res.json({ rules: retentionSummary() }); });

  admin("/api/admin/records/complaints", "get", async (req, res) => { res.json({ complaints: await store.listComplaints(req.query.status as string | undefined), sla: store.COMPLAINT_SLA }); });
  admin("/api/admin/records/complaints/:id", "patch", async (req, res) => { res.json({ complaint: await store.updateComplaint(num(req.params.id, "id"), staffOf(req), req.body ?? {}) }); });

  admin("/api/admin/records/kyb", "get", async (req, res) => { res.json({ submissions: await store.listKyb(req.query.status as string | undefined) }); });
  admin("/api/admin/records/kyb/:id", "get", async (req, res) => { res.json({ submission: await store.kybDetail(num(req.params.id, "id"), staffOf(req)) }); });
  admin("/api/admin/records/kyb/:id/documents/:doc", "get", async (req, res) => {
    const d = await store.kybDocument(num(req.params.id, "id"), num(req.params.doc, "document"), staffOf(req));
    res.setHeader("Content-Type", d.mime);
    res.setHeader("Content-Disposition", `inline; filename="${d.name.replace(/[^\w.\- ]/g, "_")}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(d.data);
  });
  admin("/api/admin/records/kyb/:id/decision", "post", async (req, res) => { res.json({ submission: await store.decideKyb(num(req.params.id, "id"), staffOf(req), req.body ?? {}) }); });

  admin("/api/admin/records/cases", "get", async (req, res) => { res.json({ cases: await store.listCases(req.query.status as string | undefined) }); });
  admin("/api/admin/records/cases", "post", async (req, res) => { res.json({ case: await store.openCase(staffOf(req), req.body ?? {}) }); });
  admin("/api/admin/records/cases/:id", "get", async (req, res) => { res.json({ case: await store.caseDetail(num(req.params.id, "id"), staffOf(req)) }); });
  admin("/api/admin/records/cases/:id/notes", "post", async (req, res) => { res.json({ note: await store.addCaseNote(num(req.params.id, "id"), staffOf(req), req.body?.body) }); });
  admin("/api/admin/records/cases/:id/decision", "post", async (req, res) => { res.json({ case: await store.decideCase(num(req.params.id, "id"), staffOf(req), req.body ?? {}) }); });

  admin("/api/admin/records/deletion", "get", async (_req, res) => { res.json({ requests: await store.listDeletionRequests() }); });
  admin("/api/admin/records/deletion/:id/complete", "post", async (req, res) => { res.json({ summary: await store.completeDeletion(num(req.params.id, "id"), staffOf(req)) }); });

  admin("/api/admin/records/accounts/summary", "get", async (req, res) => { res.json(await accountsSummary(Number(req.query.days) || 30)); });
  admin("/api/admin/records/accounts", "get", async (req, res) => { res.json({ accounts: await listAccounts(String(req.query.search ?? "")) }); });
  admin("/api/admin/records/accounts/:id", "get", async (req, res) => {
    const detail = await accountDetail(num(req.params.id, "id"), staffOf(req));
    if (!detail) throw new ApplicationError("INVALID_REQUEST", "Account not found");
    res.json(detail);
  });
  admin("/api/admin/records/travel-rule", "get", async (_req, res) => { res.json({ records: await store.listTravelRule(), thresholdUsd: store.travelRuleThreshold() }); });

  admin("/api/admin/records/report", "get", async (req, res) => {
    const to = String(req.query.to || new Date().toISOString().slice(0, 10));
    const from = String(req.query.from || new Date(Date.parse(to) - 30 * 86_400_000).toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ApplicationError("INVALID_REQUEST", "from and to must be YYYY-MM-DD");
    const report = await regulatoryReport(from, to);
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="blockfinax-report-${from}-to-${to}.csv"`);
      return res.send(reportCsv(report));
    }
    res.json(report);
  });
}
