/**
 * Interest-rate benchmark API (oracle architecture). Read-only; values come from official
 * sources through the observation store, never from the client.
 *
 *   GET /api/v2/benchmarks                                  benchmarks in use, with freshness
 *   GET /api/v2/benchmarks/:id                              one benchmark, with its registry entry
 *   GET /api/v2/benchmarks/:id/observations?from=&to=       stored values by observation date
 *   GET /api/v2/benchmarks/:id/observations/:date           the value for one observation date
 */
import type { Express, Request, Response } from "express";
import { BENCHMARKS, type BenchmarkId } from "@shared/rates/benchmarks";
import { db } from "../db";
import { addDays, isValidIsoDate } from "../rates/calendar";
import { benchmarkStatus, drizzleRateRepository, oracleBenchmarks, toView } from "../rates/service";
import { latestExpected } from "../rates/validate";

// Required wherever SOFR is shown (New York Fed Terms of Use; licensing v1.0).
const SOFR_NOTICE =
  "SOFR data are provided by the Federal Reserve Bank of New York and are subject to its Terms of Use. " +
  "The New York Fed does not sponsor, endorse or recommend BlockFinaX, and is not liable for the data or its use.";

function notice(id: BenchmarkId) {
  return id === "SOFR" ? { notice: SOFR_NOTICE } : {};
}

function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

export function registerRateOracleRoutes(app: Express): void {
  const repo = drizzleRateRepository(db);
  const inUse = () => new Map(oracleBenchmarks().map((b) => [b.id, b]));

  const benchmarkOr404 = (req: Request, res: Response) => {
    const b = inUse().get(String(req.params.id).toUpperCase() as BenchmarkId);
    if (!b) {
      fail(res, 404, "BENCHMARK_NOT_FOUND", `${req.params.id} is not a benchmark in use here`);
      return null;
    }
    return b;
  };

  app.get("/api/v2/benchmarks", async (_req, res) => {
    try {
      const list = await Promise.all(Array.from(inUse().values()).map((b) => benchmarkStatus(repo, b)));
      res.json({ benchmarks: list.map((s) => ({ ...s, ...notice(s.id) })) });
    } catch (err) {
      fail(res, 500, "INTERNAL", (err as Error).message);
    }
  });

  app.get("/api/v2/benchmarks/:id", async (req, res) => {
    const b = benchmarkOr404(req, res);
    if (!b) return;
    try {
      const status = await benchmarkStatus(repo, b);
      res.json({ ...status, registry: BENCHMARKS[b.id], ...notice(b.id) });
    } catch (err) {
      fail(res, 500, "INTERNAL", (err as Error).message);
    }
  });

  app.get("/api/v2/benchmarks/:id/observations", async (req, res) => {
    const b = benchmarkOr404(req, res);
    if (!b) return;
    const to = String(req.query.to ?? latestExpected(b).observationDate);
    const from = String(req.query.from ?? addDays(to, -45));
    if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) return fail(res, 400, "BAD_REQUEST", "from and to must be dates (YYYY-MM-DD), from on or before to");
    if (addDays(from, 400) < to) return fail(res, 400, "BAD_REQUEST", "ranges are limited to 400 days");
    try {
      const rows = await repo.range(b.id, from, to);
      res.json({ benchmark: b.id, from, to, observations: rows.map((o) => toView(o)), ...notice(b.id) });
    } catch (err) {
      fail(res, 500, "INTERNAL", (err as Error).message);
    }
  });

  app.get("/api/v2/benchmarks/:id/observations/:date", async (req, res) => {
    const b = benchmarkOr404(req, res);
    if (!b) return;
    const date = String(req.params.date);
    if (!isValidIsoDate(date)) return fail(res, 400, "BAD_REQUEST", "date must be YYYY-MM-DD");
    try {
      const o = await repo.get(b.id, date);
      if (!o) return fail(res, 404, "OBSERVATION_NOT_FOUND", `No ${b.id} value is held for ${date}`);
      res.json({ ...toView(o), revisions: o.revisions, ...notice(b.id) });
    } catch (err) {
      fail(res, 500, "INTERNAL", (err as Error).message);
    }
  });
}
