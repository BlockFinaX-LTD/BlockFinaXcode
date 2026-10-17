/**
 * Official-source adapters, one per benchmark (oracle architecture section 2).
 *
 * Each adapter knows its source's URL, format, observation-date field, precision and
 * revision field. Parsing is pure so tests can feed recorded and malformed payloads.
 * Adapters never validate ranges or calendars; `validateObservation` does that.
 */
import { getBenchmark, type BenchmarkId } from "@shared/rates/benchmarks";
import { addDays, isBusinessDay, localParts } from "./calendar";
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
  return parseNyFed(body, source, url, "SOFR");
}

export function parseNyFed(body: string, source: string, url: string, type: "SOFR" | "EFFR"): RawObservation[] {
  const json = parseJson(source, body);
  if (!json || !Array.isArray(json.refRates)) throw new SourceError(source, "missing refRates");
  return json.refRates.map((r: any) => {
    if (r?.type !== type) throw new SourceError(source, `unexpected rate type ${r?.type}`);
    if (typeof r.effectiveDate !== "string" || r.percentRate === undefined || r.percentRate === null) {
      throw new SourceError(source, "row is missing effectiveDate or percentRate");
    }
    return {
      benchmark: type,
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

// ── EFFR: Federal Reserve Bank of New York Markets API ───────────────────────

export const effrAdapter: RateAdapter = {
  benchmark: "EFFR",
  async fetchLatest(count) {
    const url = `https://markets.newyorkfed.org/api/rates/unsecured/effr/last/${count}.json`;
    const body = await fetchText("NEW_YORK_FED_EFFR_API", url);
    return { source: "NEW_YORK_FED_EFFR_API", url, body, observations: parseNyFed(body, "NEW_YORK_FED_EFFR_API", url, "EFFR") };
  },
};

// ── €STR: European Central Bank Data Portal (SDMX JSON) ──────────────────────

/** One series; observation keys index the time dimension; values are numbers in percent. */
export function parseEstr(body: string, source: string, url: string): RawObservation[] {
  const json = parseJson(source, body);
  const series = json?.dataSets?.[0]?.series;
  const times = json?.structure?.dimensions?.observation?.[0]?.values;
  if (!series || !Array.isArray(times)) throw new SourceError(source, "missing series or time dimension");
  const first = Object.values(series)[0] as any;
  if (!first?.observations) throw new SourceError(source, "missing observations");
  return Object.entries(first.observations as Record<string, unknown[]>).map(([k, v]) => {
    const date = times[Number(k)]?.id;
    if (typeof date !== "string" || v?.[0] === undefined || v[0] === null) throw new SourceError(source, "row is missing a date or value");
    return { benchmark: "ESTR" as const, observationDate: date, ratePercent: String(v[0]), source, sourceReference: url };
  }).sort((a, b) => b.observationDate.localeCompare(a.observationDate));
}

export const estrAdapter: RateAdapter = {
  benchmark: "ESTR",
  async fetchLatest(count) {
    const url = `https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?format=jsondata&lastNObservations=${count}`;
    const body = await fetchText("ECB_DATA_API", url);
    return { source: "ECB_DATA_API", url, body, observations: parseEstr(body, "ECB_DATA_API", url) };
  },
};

// ── NOFR: Central Bank of Nigeria ────────────────────────────────────────────

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Rows `{ ratedate: "October-15-2026", nofr: "20.00" }`, newest first. */
export function parseNofr(body: string, source: string, url: string): RawObservation[] {
  const json = parseJson(source, body);
  if (!Array.isArray(json)) throw new SourceError(source, "response is not a list");
  return json.map((r: any) => {
    const m = /^([A-Za-z]+)-(\d{1,2})-(\d{4})$/.exec(String(r?.ratedate ?? "").trim());
    const month = m ? MONTHS.indexOf(m[1]) + 1 : 0;
    if (!m || !month || r?.nofr === undefined) throw new SourceError(source, `unexpected row ${JSON.stringify(r).slice(0, 80)}`);
    return {
      benchmark: "NOFR" as const,
      observationDate: `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`,
      ratePercent: String(r.nofr).trim(), source, sourceReference: url,
    };
  });
}

export const nofrAdapter: RateAdapter = {
  benchmark: "NOFR",
  async fetchLatest(count) {
    const url = "https://www.cbn.gov.ng/api/GetAllNOF_Rates";
    const body = await fetchText("CBN_NOFR_API", url);
    const rows = parseNofr(body, "CBN_NOFR_API", url).sort((a, b) => b.observationDate.localeCompare(a.observationDate));
    return { source: "CBN_NOFR_API", url, body, observations: rows.slice(0, count) };
  },
};

// ── Bank of Ghana: wpDataTables pages ────────────────────────────────────────

const BOG = "https://www.bog.gov.gh";

/** "16 Oct 2026" -> "2026-10-16". */
export function parseDayMonYear(text: string): string | null {
  const m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(text.trim());
  if (!m) return null;
  const month = MONTHS.findIndex((x) => x.startsWith(m[2])) + 1;
  return month ? `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/** BoG serves this table server-side: read the page's nonce, then ask for the newest rows. */
export const ghanaInterbankAdapter: RateAdapter = {
  benchmark: "GHS_INTERBANK",
  async fetchLatest(count) {
    const source = "BOG_INTERBANK_TABLE";
    const page = `${BOG}/treasury-and-the-markets/interbank-interest-rates/`;
    const html = await fetchText(source, page, { headers: { Accept: "text/html" } });
    const nonce = /wdtNonceFrontendServerSide_69" name="wdtNonceFrontendServerSide_69" value="([a-z0-9]+)"/.exec(html)?.[1];
    if (!nonce) throw new SourceError(source, "table nonce not found on the page");
    const url = `${BOG}/wp-admin/admin-ajax.php?action=get_wdtable&table_id=69`;
    const body = await fetchText(source, url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: page },
      body: new URLSearchParams({
        draw: "1", "columns[0][data]": "0", "columns[1][data]": "1", "columns[2][data]": "2",
        "order[0][column]": "0", "order[0][dir]": "desc", start: "0", length: String(count), "search[value]": "", wdtNonce: nonce,
      }).toString(),
    });
    const json = parseJson(source, body);
    if (!Array.isArray(json?.data)) throw new SourceError(source, "missing data rows");
    const observations = json.data.map((row: unknown[]) => {
      const date = parseDayMonYear(String(row?.[1] ?? ""));
      if (!date) throw new SourceError(source, `unexpected date "${row?.[1]}"`);
      return { benchmark: "GHS_INTERBANK" as const, observationDate: date, ratePercent: String(row[2]).trim(), source, sourceReference: page };
    });
    return { source, url, body, observations };
  },
};

// ── Policy rates: decisions to a daily "rate in force" ──────────────────────

export interface Decision { effectiveDate: string; ratePercent: string }

/**
 * The rate in force on each weekday, newest first, from a list of decisions with effective
 * dates (settlement rules section 2, ADR-RATE-005). Today counts only after 17:00 local, so a
 * decision announced during the day is never missed.
 */
export function inForceSeries(id: BenchmarkId, decisions: Decision[], count: number, source: string, url: string, now = new Date()): RawObservation[] {
  const b = getBenchmark(id);
  const sorted = [...decisions].sort((x, y) => x.effectiveDate.localeCompare(y.effectiveDate));
  if (!sorted.length) return [];
  const local = localParts(now, b.timeZone);
  let day = local.time >= (b.publicationTime ?? "17:00") ? local.date : addDays(local.date, -1);
  const out: RawObservation[] = [];
  while (out.length < count && day >= sorted[0].effectiveDate) {
    if (isBusinessDay(b.calendar, day)) {
      let rate: string | null = null;
      for (const d of sorted) if (d.effectiveDate <= day) rate = d.ratePercent;
      if (rate !== null) out.push({ benchmark: id, observationDate: day, ratePercent: rate, source, sourceReference: url });
    }
    day = addDays(day, -1);
  }
  return out;
}

/** "14.0" and " 9.00 " both mean a rate in percent; normalise to two decimals. */
const twoDp = (x: string) => {
  const n = Number(String(x).trim());
  if (!Number.isFinite(n)) throw new Error(`not a number: ${x}`);
  return n.toFixed(2);
};

/** Bank of Ghana policy rate history: an HTML table with an Effective Date column. */
export function parseGhanaPolicyTable(html: string, source: string): Decision[] {
  const table = /<table[^>]*wpDataTable[^>]*>([\s\S]*?)<\/table>/.exec(html)?.[1];
  if (!table) throw new SourceError(source, "policy table not found");
  const strip = (x: string) => x.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  const out: Decision[] = [];
  for (const row of table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []).map(strip);
    if (cells.length < 4) continue;
    const date = parseDayMonYear(cells[2]);
    if (date && /^\d+(\.\d+)?$/.test(cells[3])) out.push({ effectiveDate: date, ratePercent: twoDp(cells[3]) });
  }
  if (!out.length) throw new SourceError(source, "no decisions in the policy table");
  return out;
}

export const ghanaPolicyAdapter: RateAdapter = {
  benchmark: "GHS_MPR",
  async fetchLatest(count) {
    const source = "BOG_POLICY_TABLE";
    const url = `${BOG}/monetary-policy/policy-rate-trends/`;
    const body = await fetchText(source, url, { headers: { Accept: "text/html" } });
    return { source, url, body: body.slice(0, 50_000), observations: inForceSeries("GHS_MPR", parseGhanaPolicyTable(body, source), count, source, url) };
  },
};

/** Central Bank of Kenya: CBR by MPC meeting date, `["07/10/2026", " 8.75 "]`. */
export const kenyaPolicyAdapter: RateAdapter = {
  benchmark: "KES_CBR",
  async fetchLatest(count) {
    const source = "CBK_CBR_TABLE";
    const url = "https://www.centralbank.go.ke/wp-admin/admin-ajax.php?action=get_wdtable&table_id=15";
    const body = await fetchText(source, url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tableForm(0, 500),
    });
    const json = parseJson(source, body);
    if (!Array.isArray(json?.data)) throw new SourceError(source, "missing data rows");
    const decisions = json.data.map((row: unknown[]) => {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(row?.[0] ?? "").trim());
      if (!m) throw new SourceError(source, `unexpected date "${row?.[0]}"`);
      return { effectiveDate: `${m[3]}-${m[2]}-${m[1]}`, ratePercent: twoDp(String(row[1])) };
    });
    return { source, url, body, observations: inForceSeries("KES_CBR", decisions, count, source, "https://www.centralbank.go.ke/rates/central-bank-rate/") };
  },
};

/** Bank of England database: Bank Rate (IUDBEDR) for each London business day. */
export function parseBoeCsv(body: string, source: string): Decision[] {
  const lines = body.trim().split(/\r?\n/);
  if (!/^DATE,IUDBEDR/.test(lines[0] ?? "")) throw new SourceError(source, "unexpected CSV header");
  return lines.slice(1).map((line) => {
    const [d, v] = line.split(",");
    const date = parseDayMonYear(d);
    if (!date || !v) throw new SourceError(source, `unexpected row "${line}"`);
    return { effectiveDate: date, ratePercent: twoDp(v) };
  });
}

export const ukBankRateAdapter: RateAdapter = {
  benchmark: "UK_BANK_RATE",
  async fetchLatest(count) {
    const source = "BOE_IADB_BANK_RATE";
    const from = new Date(Date.now() - (count * 1.6 + 30) * 86_400_000);
    const fmt = `${String(from.getUTCDate()).padStart(2, "0")}/${MONTHS[from.getUTCMonth()].slice(0, 3)}/${from.getUTCFullYear()}`;
    const url = `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${fmt}&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y`;
    const body = await fetchText(source, url, { headers: { Accept: "text/csv" } });
    return { source, url, body, observations: inForceSeries("UK_BANK_RATE", parseBoeCsv(body, source), count, source, "https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate") };
  },
};

export const ADAPTERS: Partial<Record<BenchmarkId, RateAdapter>> = {
  SOFR: sofrAdapter,
  EFFR: effrAdapter,
  ESTR: estrAdapter,
  KESONIA: kesoniaAdapter,
  NOFR: nofrAdapter,
  GHS_INTERBANK: ghanaInterbankAdapter,
  GHS_MPR: ghanaPolicyAdapter,
  KES_CBR: kenyaPolicyAdapter,
  UK_BANK_RATE: ukBankRateAdapter,
};
