/**
 * The compliance record: one append-only, hash-linked log of everything a regulator, a
 * partner or a dispute may ask about later.
 *
 * Each entry stores the hash of the entry before it, and its own hash covers its content and
 * that link. Changing or removing any entry breaks every hash after it, which `verifyLog`
 * finds. The database also refuses UPDATE, DELETE and TRUNCATE on the table, so the only way
 * to "edit" history is to drop the trigger first, and the daily anchor on Stellar
 * (anchor.ts) proves what the chain looked like before that.
 *
 * What goes in (`action` names):
 *   cover.quote_accepted     the quote and key facts a customer was shown before signing
 *   fixing.submitted         an FX settlement rate: source, value, time, operator, transaction
 *   staff.action             any admin change: who, what, when, result
 *   data.viewed              staff opened sensitive data (KYC, a customer's cover, documents)
 *   email.sent               what we told a customer and when
 *   complaint.*, case.*, kyb.*, deletion.*, travel_rule.*   their own workflows
 *
 * Personal data that may later have to be erased does not go in the log body: entries refer
 * to records by id, and the records themselves follow the retention policy
 * (shared/records/retention.ts). Email addresses are stored as a hash.
 */
import { createHash } from "node:crypto";

export type ActorType = "user" | "staff" | "system" | "oracle";
export interface Actor { type: ActorType; id: string }
interface RecordInput {
  actor: Actor;
  action: string;
  subject?: { type: string; id: string };
  data?: unknown;
}
interface LogEntry extends RecordInput {
  id: number;
  at: string;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);
/** One lock id for the whole log, so entries are chained strictly in order. */
const LOCK = 7_331_001;

/** JSON with keys sorted at every level, so the same content always hashes the same. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function entryHash(prevHash: string, e: { at: string; actor: Actor; action: string; subject?: RecordInput["subject"]; data?: unknown }): string {
  return createHash("sha256")
    .update(prevHash)
    .update(canonical({ at: e.at, actor: e.actor, action: e.action, subject: e.subject ?? null, data: e.data ?? null }))
    .digest("hex");
}

/** Hash an identifier we must be able to match later but should not store in clear (an email). */
export function hashId(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>; connect?: () => Promise<any> };

let ready: Promise<void> | null = null;
async function getDb(): Promise<Db> {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  return pool as unknown as Db;
}

async function ensureLog(db?: Db) {
  const d = db ?? (await getDb());
  ready ??= d.query(`
    CREATE TABLE IF NOT EXISTS compliance_log (
      id bigserial PRIMARY KEY,
      at timestamptz NOT NULL,
      actor_type text NOT NULL,
      actor_id text NOT NULL,
      action text NOT NULL,
      subject_type text,
      subject_id text,
      data jsonb,
      prev_hash text NOT NULL,
      hash text NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS compliance_log_action_idx ON compliance_log (action, at);
    CREATE INDEX IF NOT EXISTS compliance_log_subject_idx ON compliance_log (subject_type, subject_id);
    CREATE OR REPLACE FUNCTION compliance_log_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'compliance_log is append-only';
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS compliance_log_no_change ON compliance_log;
    CREATE TRIGGER compliance_log_no_change BEFORE UPDATE OR DELETE ON compliance_log
      FOR EACH ROW EXECUTE FUNCTION compliance_log_append_only();
    DROP TRIGGER IF EXISTS compliance_log_no_truncate ON compliance_log;
    CREATE TRIGGER compliance_log_no_truncate BEFORE TRUNCATE ON compliance_log
      FOR EACH STATEMENT EXECUTE FUNCTION compliance_log_append_only();
  `).then(() => undefined).catch((err) => { ready = null; throw err; });
  await ready;
}

/** Append one entry. Serialised by an advisory lock so the hash chain never forks. */
export async function record(input: RecordInput, db?: Db): Promise<LogEntry> {
  const d = db ?? (await getDb());
  await ensureLog(d);
  const client = d.connect ? await d.connect() : d;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK]);
    const { rows: [last] } = await client.query("SELECT hash FROM compliance_log ORDER BY id DESC LIMIT 1");
    const prevHash: string = last?.hash ?? GENESIS;
    const at = new Date().toISOString();
    const hash = entryHash(prevHash, { at, actor: input.actor, action: input.action, subject: input.subject, data: input.data });
    const { rows: [row] } = await client.query(
      `INSERT INTO compliance_log (at, actor_type, actor_id, action, subject_type, subject_id, data, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [at, input.actor.type, input.actor.id, input.action, input.subject?.type ?? null, input.subject?.id ?? null,
        input.data === undefined ? null : JSON.stringify(input.data), prevHash, hash],
    );
    await client.query("COMMIT");
    return { id: Number(row.id), at, prevHash, hash, ...input };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release?.();
  }
}

/**
 * Record without ever failing the caller: a missing database (tests, scripts) or a log
 * outage must not stop a purchase or an email. Failures are logged loudly instead.
 */
export function recordSoon(input: RecordInput): void {
  record(input).catch((err) => console.error(`[records] could not record ${input.action}: ${(err as Error).message}`));
}

function rowToEntry(r: any): LogEntry {
  return {
    id: Number(r.id),
    at: new Date(r.at).toISOString(),
    actor: { type: r.actor_type, id: r.actor_id },
    action: r.action,
    subject: r.subject_type ? { type: r.subject_type, id: r.subject_id } : undefined,
    data: r.data ?? undefined,
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}

/** Recompute every hash in order. Reports the first entry that does not match. */
export async function verifyLog(db?: Db): Promise<{ ok: boolean; entries: number; lastHash: string; brokenAt?: number; reason?: string }> {
  const d = db ?? (await getDb());
  await ensureLog(d);
  let prev = GENESIS, count = 0, after = 0;
  for (;;) {
    const { rows } = await d.query("SELECT * FROM compliance_log WHERE id > $1 ORDER BY id LIMIT 5000", [after]);
    if (!rows.length) break;
    for (const r of rows) {
      const e = rowToEntry(r);
      if (e.prevHash !== prev) return { ok: false, entries: count, lastHash: prev, brokenAt: e.id, reason: "link to the previous entry does not match" };
      const expected = entryHash(prev, { at: e.at, actor: e.actor, action: e.action, subject: e.subject, data: e.data });
      if (expected !== e.hash) return { ok: false, entries: count, lastHash: prev, brokenAt: e.id, reason: "content does not match its hash" };
      prev = e.hash;
      count++;
      after = e.id;
    }
  }
  return { ok: true, entries: count, lastHash: prev };
}

export async function listLog(filter: { action?: string; subjectType?: string; subjectId?: string; actorId?: string; from?: string; to?: string; limit?: number }, db?: Db): Promise<LogEntry[]> {
  const d = db ?? (await getDb());
  await ensureLog(d);
  const where: string[] = [], params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (filter.action) add(filter.action.endsWith("*") ? "action LIKE ?" : "action = ?", filter.action.replace(/\*$/, "%"));
  if (filter.subjectType) add("subject_type = ?", filter.subjectType);
  if (filter.subjectId) add("subject_id = ?", filter.subjectId);
  if (filter.actorId) add("actor_id = ?", filter.actorId);
  if (filter.from) add("at >= ?", filter.from);
  if (filter.to) add("at < ?", filter.to);
  params.push(Math.min(Math.max(filter.limit ?? 200, 1), 2000));
  const { rows } = await d.query(
    `SELECT * FROM compliance_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(rowToEntry);
}
