/**
 * Official-source adapters, one per benchmark (oracle architecture section 2).
 *
 * Each adapter knows its source's URL, format, observation-date field, precision and
 * revision field. Parsing is pure so tests can feed recorded and malformed payloads.
 * Adapters never validate ranges or calendars; `validateObservation` does that.
 */
import type { BenchmarkId } from "@shared/rates/benchmarks";
import type { RawObservation } from "./validate";

export interface FetchResult {
  source: string;
  url: string;
  /** Raw response body, kept as evidence in the observation store. */
  body: string;
  observations: RawObservation[];
}

export interface RateAdapter {
  benchmark: BenchmarkId;
  /** Latest `count` observations from the primary source, falling back to the official alternative. */
  fetchLatest(count: number): Promise<FetchResult>;
}

export class SourceError extends Error {
  constructor(readonly source: string, message: string) {
    super(`${source}: ${message}`);
    this.name = "SourceError";
  }
}

const TIMEOUT_MS = 15_000;
const USER_AGENT = "BlockFinaX-RateOracle/1.0 (+https://blockfinax.com)";

async function fetchText(source: string, url: string, init: RequestInit = {}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new SourceError(source, `request failed: ${(err as Error).message}`);
  }
  const body = await res.text();
  if (!res.ok) throw new SourceError(source, `HTTP ${res.status}`);
  return body;
}

function parseJson(source: string, body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    throw new SourceError(source, "response is not JSON");
  }
}

// ── SOFR: Federal Reserve Bank of New York Markets API ───────────────────────

const NYFED = "https://markets.newyorkfed.org/api/rates/secured/sofr";

/** `refRates[]` with `effectiveDate` (the observation date), `percentRate` and `revisionIndicator`. */
export function parseSofr(body: string, source: string, url: string): RawObservation[] {
  const json = parseJson(source, body);
  if (!json || !Array.isArray(json.refRates)) throw new SourceError(source, "missing refRates");
  return json.refRates.map((r: any) => {
    if (r?.type !== "SOFR") throw new SourceError(source, `unexpected rate type ${r?.type}`);
    if (typeof r.effectiveDate !== "string" || r.percentRate === undefined || r.percentRate === null) {
      throw new SourceError(source, "row is missing effectiveDate or percentRate");
    }
    return {
      benchmark: "SOFR" as const,
      observationDate: r.effectiveDate,
      // JSON numbers lose trailing zeros (3.80 arrives as 3.8); the decimal value is unchanged.
      ratePercent: String(r.percentRate),
      source, sourceReference: url,
      revisionIndicator: typeof r.revisionIndicator === "string" ? r.revisionIndicator : undefined,
    };
  });
}

export const sofrAdapter: RateAdapter = {
  benchmark: "SOFR",
  async fetchLatest(count) {
    const primary = `${NYFED}/last/${count}.json`;
    try {
      const body = await fetchText("NEW_YORK_FED_API", primary);
      return { source: "NEW_YORK_FED_API", url: primary, body, observations: parseSofr(body, "NEW_YORK_FED_API", primary) };
    } catch (err) {
      const end = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - (count + 10) * 2 * 86_400_000).toISOString().slice(0, 10);
      const fallback = `${NYFED}/search.json?startDate=${start}&endDate=${end}`;
      const body = await fetchText("NEW_YORK_FED_SEARCH", fallback).catch((e) => {
        throw new SourceError("NEW_YORK_FED_API", `${(err as Error).message}; fallback also failed: ${(e as Error).message}`);
      });
      const rows = parseSofr(body, "NEW_YORK_FED_SEARCH", fallback);
      return { source: "NEW_YORK_FED_SEARCH", url: fallback, body, observations: rows.slice(0, count) };
    }
  },
};

// ── KESONIA: Central Bank of Kenya published table ───────────────────────────

const CBK_TABLE = "https://www.centralbank.go.ke/wp-admin/admin-ajax.php?action=get_wdtable&table_id=194";

function tableForm(start: number, length: number): string {
  return new URLSearchParams({
    draw: "1", "columns[0][data]": "0", "columns[1][data]": "1",
    start: String(start), length: String(length), "search[value]": "",
  }).toString();
}

/** Rows are `["DD/MM/YYYY", "8.7504"]`, oldest first; the date is the observation date. */
export function parseKesonia(body: string, source: string, url: string): { total: number; rows: RawObservation[] } {
  const json = parseJson(source, body);
  if (!json || !Array.isArray(json.data)) throw new SourceError(source, "missing data rows");
  const total = Number(json.recordsTotal);
  if (!Number.isInteger(total) || total < 0) throw new SourceError(source, "missing recordsTotal");
  const rows = json.data.map((row: unknown) => {
    if (!Array.isArray(row) || row.length < 2) throw new SourceError(source, "row is not [date, rate]");
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(row[0]).trim());
    if (!m) throw new SourceError(source, `unexpected date "${row[0]}"`);
    return {
      benchmark: "KESONIA" as const,
      observationDate: `${m[3]}-${m[2]}-${m[1]}`,
      ratePercent: String(row[1]).trim(),
      source, sourceReference: url,
    };
  });
  return { total, rows };
}

export const kesoniaAdapter: RateAdapter = {
  benchmark: "KESONIA",
  async fetchLatest(count) {
    const post = (start: number, length: number) =>
      fetchText("CBK_KESONIA_TABLE", CBK_TABLE, {
        method: "POST",
        body: tableForm(start, length),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    // The table is oldest first: read the size, then the last `count` rows.
    const head = parseKesonia(await post(0, 1), "CBK_KESONIA_TABLE", CBK_TABLE);
    const body = await post(Math.max(0, head.total - count), count);
    const { rows } = parseKesonia(body, "CBK_KESONIA_TABLE", CBK_TABLE);
    return { source: "CBK_KESONIA_TABLE", url: CBK_TABLE, body, observations: rows.reverse() };
  },
};

export const ADAPTERS: Partial<Record<BenchmarkId, RateAdapter>> = {
  SOFR: sofrAdapter,
  KESONIA: kesoniaAdapter,
};
