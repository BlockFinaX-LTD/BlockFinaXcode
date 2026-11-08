/**
 * Periodic summary for a regulator (for example the Bank of Ghana) or a partner bank: what
 * was sold, what was paid, who our customers are by verification tier, and how compliance
 * work went, for any date range. Built from the compliance log and the workflow tables, so
 * every figure traces back to recorded entries.
 */
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

async function getDb(): Promise<Db> {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  return pool as unknown as Db;
}

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn(); } catch { return fallback; } };

export interface RegulatoryReport {
  period: { from: string; to: string };
  generatedAt: string;
  cover: { quotesAccepted: number; notionalUsd: number; premiumUsd: number; maxPayoutUsd: number; byPair: Record<string, { count: number; notionalUsd: number }> };
  transactions: Record<string, number>;
  customers: { newAccounts: number; byKycTier: Record<string, number>; businessesVerified: number; businessChecksPending: number };
  compliance: { alertsBySeverity: Record<string, number>; casesOpened: number; casesReported: number; travelRuleTransfers: number; travelRuleUsd: number };
  complaints: { received: number; resolved: number; open: number; averageDaysToResolve: number | null; overdue: number };
  staff: { actions: number; dataViews: number };
  log: { entries: number; lastHash: string | null };
}

export async function regulatoryReport(from: string, to: string): Promise<RegulatoryReport> {
  const db = await getDb();
  const range = [from, to];

  const quotes = await safe(async () => (await db.query(
    `SELECT data FROM compliance_log WHERE action = 'cover.quote_accepted' AND at >= $1 AND at < $2`, range)).rows, [] as any[]);
  const byPair: Record<string, { count: number; notionalUsd: number }> = {};
  let notional = 0, premium = 0, maxPayout = 0;
  for (const { data } of quotes) {
    const e = data?.quote?.economic ?? {};
    const n = Number(e.notional) || 0;
    notional += n; premium += Number(e.totalCost) || 0; maxPayout += Number(e.maxPayout) || 0;
    const pair = String(data?.pair ?? e.pair ?? "unknown");
    byPair[pair] = { count: (byPair[pair]?.count ?? 0) + 1, notionalUsd: (byPair[pair]?.notionalUsd ?? 0) + n };
  }

  const tx = await safe(async () => (await db.query(
    `SELECT data->>'method' AS method, count(*)::int AS n FROM compliance_log WHERE action = 'transaction.relayed' AND at >= $1 AND at < $2 AND data->>'state' <> 'FAILED' GROUP BY 1`, range)).rows, [] as any[]);
  const transactions = Object.fromEntries(tx.map((r) => [r.method ?? "unknown", r.n]));

  const newAccounts = await safe(async () => Number((await db.query(`SELECT count(*) AS n FROM user_accounts WHERE created_at >= $1 AND created_at < $2`, range)).rows[0].n), 0);
  const tiers = await safe(async () => (await db.query(`SELECT COALESCE(kyc_tier, 0)::text AS tier, count(*)::int AS n FROM user_profiles GROUP BY 1`)).rows, [] as any[]);
  const kyb = await safe(async () => (await db.query(`SELECT status, count(*)::int AS n FROM kyb_submissions GROUP BY 1`)).rows, [] as any[]);
  const alerts = await safe(async () => (await db.query(`SELECT severity, count(*)::int AS n FROM compliance_alerts WHERE opened_at >= $1 AND opened_at < $2 GROUP BY 1`, range)).rows, [] as any[]);
  const cases = await safe(async () => (await db.query(
    `SELECT count(*) FILTER (WHERE opened_at >= $1 AND opened_at < $2)::int AS opened, count(*) FILTER (WHERE reported_at >= $1 AND reported_at < $2)::int AS reported FROM sar_cases`, range)).rows[0], { opened: 0, reported: 0 });
  const travel = await safe(async () => (await db.query(`SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::float AS usd FROM travel_rule_records WHERE created_at >= $1 AND created_at < $2`, range)).rows[0], { n: 0, usd: 0 });
  const complaints = await safe(async () => (await db.query(
    `SELECT count(*) FILTER (WHERE received_at >= $1 AND received_at < $2)::int AS received,
            count(*) FILTER (WHERE resolved_at >= $1 AND resolved_at < $2)::int AS resolved,
            count(*) FILTER (WHERE resolved_at IS NULL)::int AS open,
            avg(EXTRACT(EPOCH FROM (resolved_at - received_at)) / 86400) FILTER (WHERE resolved_at >= $1 AND resolved_at < $2) AS avg_days,
            count(*) FILTER (WHERE resolved_at IS NULL AND received_at < now() - interval '15 days')::int AS overdue
     FROM complaints`, range)).rows[0], { received: 0, resolved: 0, open: 0, avg_days: null, overdue: 0 });
  const staff = await safe(async () => (await db.query(
    `SELECT count(*) FILTER (WHERE action = 'staff.action')::int AS actions, count(*) FILTER (WHERE action = 'data.viewed')::int AS views FROM compliance_log WHERE at >= $1 AND at < $2`, range)).rows[0], { actions: 0, views: 0 });
  const log = await safe(async () => (await db.query(`SELECT count(*)::int AS n, (SELECT hash FROM compliance_log ORDER BY id DESC LIMIT 1) AS last FROM compliance_log`)).rows[0], { n: 0, last: null });

  return {
    period: { from, to },
    generatedAt: new Date().toISOString(),
    cover: { quotesAccepted: quotes.length, notionalUsd: notional, premiumUsd: premium, maxPayoutUsd: maxPayout, byPair },
    transactions,
    customers: {
      newAccounts,
      byKycTier: Object.fromEntries(tiers.map((r) => [`tier_${r.tier}`, r.n])),
      businessesVerified: kyb.find((r) => r.status === "approved")?.n ?? 0,
      businessChecksPending: kyb.filter((r) => r.status === "submitted" || r.status === "more_info").reduce((s, r) => s + r.n, 0),
    },
    compliance: { alertsBySeverity: Object.fromEntries(alerts.map((r) => [r.severity, r.n])), casesOpened: cases.opened, casesReported: cases.reported, travelRuleTransfers: travel.n, travelRuleUsd: travel.usd },
    complaints: { received: complaints.received, resolved: complaints.resolved, open: complaints.open, averageDaysToResolve: complaints.avg_days === null ? null : Number(Number(complaints.avg_days).toFixed(1)), overdue: complaints.overdue },
    staff: { actions: staff.actions, dataViews: staff.views },
    log: { entries: log.n, lastHash: log.last },
  };
}

/** The same report as rows of "section,item,value" for a spreadsheet. */
export function reportCsv(r: RegulatoryReport): string {
  const rows: string[][] = [["section", "item", "value"]];
  const walk = (section: string, obj: Record<string, unknown>, prefix = "") => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object") walk(section, v as Record<string, unknown>, `${prefix}${k}.`);
      else rows.push([section, `${prefix}${k}`, v === null || v === undefined ? "" : String(v)]);
    }
  };
  for (const [section, value] of Object.entries(r)) {
    if (value && typeof value === "object") walk(section, value as Record<string, unknown>);
    else rows.push([section, "", String(value)]);
  }
  return rows.map((row) => row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}
