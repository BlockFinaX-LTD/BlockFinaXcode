/**
 * Compliance workflows that need their own records: complaints, business identity checks
 * (KYB), suspicious-activity cases, deletion requests and Travel Rule details. Every change
 * is also written to the hash-linked log (log.ts), so the history of each one can be proved.
 *
 * Tables are created on first use, like the rest of the v2 server.
 */
import { createHash } from "node:crypto";
import { ApplicationError } from "@shared/domain/types";
import { RETENTION } from "@shared/records/retention";
import { record, type Actor } from "./log";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

let ready: Promise<void> | null = null;
export async function recordsDb(): Promise<Db> {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  const db = pool as unknown as Db;
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      organisation_id integer,
      category text NOT NULL,
      subject text NOT NULL,
      description text NOT NULL,
      reference text,
      status text NOT NULL DEFAULT 'open',
      received_at timestamptz NOT NULL DEFAULT now(),
      acknowledged_at timestamptz,
      resolved_at timestamptz,
      outcome text,
      response text,
      handled_by text
    );
    CREATE TABLE IF NOT EXISTS kyb_submissions (
      id serial PRIMARY KEY,
      organisation_id integer NOT NULL,
      submitted_by integer NOT NULL,
      status text NOT NULL DEFAULT 'submitted',
      company jsonb NOT NULL,
      people jsonb NOT NULL,
      submitted_at timestamptz NOT NULL DEFAULT now(),
      reviewed_by text,
      reviewed_at timestamptz,
      reviewer_notes text
    );
    CREATE TABLE IF NOT EXISTS kyb_documents (
      id serial PRIMARY KEY,
      submission_id integer NOT NULL REFERENCES kyb_submissions(id),
      kind text NOT NULL,
      name text NOT NULL,
      mime text NOT NULL,
      data bytea NOT NULL,
      sha256 text NOT NULL,
      uploaded_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sar_cases (
      id serial PRIMARY KEY,
      title text NOT NULL,
      subject_type text NOT NULL,
      subject_id text NOT NULL,
      alert_ids integer[] NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'open',
      opened_by text NOT NULL,
      opened_at timestamptz NOT NULL DEFAULT now(),
      decision text,
      decided_by text,
      decided_at timestamptz,
      report_reference text,
      reported_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS sar_case_notes (
      id serial PRIMARY KEY,
      case_id integer NOT NULL REFERENCES sar_cases(id),
      author text NOT NULL,
      body text NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS deletion_requests (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      requested_at timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'received',
      completed_at timestamptz,
      handled_by text,
      summary jsonb
    );
    CREATE TABLE IF NOT EXISTS travel_rule_records (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      organisation_id integer,
      chain text NOT NULL,
      asset text NOT NULL,
      amount numeric NOT NULL,
      to_address text NOT NULL,
      beneficiary_name text NOT NULL,
      beneficiary_type text NOT NULL,
      beneficiary_vasp text,
      beneficiary_country text,
      originator jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `).then(() => undefined).catch((err) => { ready = null; throw err; });
  await ready;
  return db;
}

const text = (v: unknown, field: string, max = 2000, required = true): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new ApplicationError("INVALID_REQUEST", `${field} is required`);
  if (s.length > max) throw new ApplicationError("INVALID_REQUEST", `${field} is too long (${max} characters at most)`);
  return s;
};
const user = (id: number): Actor => ({ type: "user", id: String(id) });
const staff = (email: string): Actor => ({ type: "staff", id: email });

// ── Complaints ───────────────────────────────────────────────────────────────

export const COMPLAINT_CATEGORIES = ["cover_or_payout", "pricing", "deposit_or_withdrawal", "account_or_access", "service", "other"] as const;
/** Days we commit to: acknowledge within 2 business days, resolve within 15. */
export const COMPLAINT_SLA = { acknowledgeDays: 2, resolveDays: 15 } as const;

export async function submitComplaint(userId: number, organisationId: number | null, input: { category?: unknown; subject?: unknown; description?: unknown; reference?: unknown }) {
  const db = await recordsDb();
  const category = COMPLAINT_CATEGORIES.includes(input.category as any) ? String(input.category) : "other";
  const { rows: [c] } = await db.query(
    `INSERT INTO complaints (user_id, organisation_id, category, subject, description, reference) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [userId, organisationId, category, text(input.subject, "Subject", 200), text(input.description, "Description", 5000), text(input.reference, "Reference", 200, false) || null],
  );
  await record({ actor: user(userId), action: "complaint.received", subject: { type: "complaint", id: String(c.id) }, data: { category, organisationId } });
  return c;
}

export async function myComplaints(userId: number) {
  const db = await recordsDb();
  const { rows } = await db.query(`SELECT id, category, subject, status, received_at, acknowledged_at, resolved_at, response FROM complaints WHERE user_id = $1 ORDER BY id DESC`, [userId]);
  return rows;
}

export async function listComplaints(status?: string) {
  const db = await recordsDb();
  const { rows } = await db.query(
    `SELECT *, EXTRACT(EPOCH FROM (COALESCE(resolved_at, now()) - received_at)) / 86400 AS days_open FROM complaints ${status ? "WHERE status = $1" : ""} ORDER BY id DESC LIMIT 500`,
    status ? [status] : [],
  );
  return rows.map((r) => ({
    ...r,
    days_open: Number(r.days_open),
    acknowledge_overdue: !r.acknowledged_at && Number(r.days_open) > COMPLAINT_SLA.acknowledgeDays,
    resolve_overdue: !r.resolved_at && Number(r.days_open) > COMPLAINT_SLA.resolveDays,
  }));
}

export async function updateComplaint(id: number, by: string, input: { status?: unknown; outcome?: unknown; response?: unknown }) {
  const db = await recordsDb();
  const status = ["acknowledged", "resolved", "closed"].includes(String(input.status)) ? String(input.status) : null;
  if (!status) throw new ApplicationError("INVALID_REQUEST", "status must be acknowledged, resolved or closed");
  const outcome = text(input.outcome, "Outcome", 2000, status !== "acknowledged");
  const response = text(input.response, "Response", 5000, false);
  const { rows: [c] } = await db.query(
    `UPDATE complaints SET status = $2, handled_by = $3,
       acknowledged_at = COALESCE(acknowledged_at, now()),
       resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN COALESCE(resolved_at, now()) ELSE resolved_at END,
       outcome = COALESCE(NULLIF($4,''), outcome), response = COALESCE(NULLIF($5,''), response)
     WHERE id = $1 RETURNING *`,
    [id, status, by, outcome, response],
  );
  if (!c) throw new ApplicationError("INVALID_REQUEST", "Complaint not found");
  await record({ actor: staff(by), action: `complaint.${status}`, subject: { type: "complaint", id: String(id) }, data: { outcome: outcome || undefined } });
  return c;
}

// ── KYB: business identity checks ────────────────────────────────────────────

export const KYB_DOC_KINDS = ["certificate_of_incorporation", "company_register_extract", "proof_of_address", "director_id", "owner_id", "ownership_structure", "other"] as const;
export const KYB_MAX_DOC_BYTES = 5 * 1024 * 1024;
const KYB_TYPES = ["application/pdf", "image/png", "image/jpeg"];

async function requireOrgAdmin(db: Db, userId: number, organisationId: number) {
  const { rows: [m] } = await db.query(
    `SELECT role FROM business_account_members WHERE organisation_id = $1 AND user_id = $2 AND status = 'active'`,
    [organisationId, userId],
  ).catch(() => ({ rows: [] as any[] }));
  if (!m || m.role !== "admin") throw new ApplicationError("UNAUTHORIZED", "Only an admin of this business can submit its details");
}

export async function submitKyb(userId: number, organisationId: number, input: { company?: any; people?: any }) {
  const db = await recordsDb();
  await requireOrgAdmin(db, userId, organisationId);
  const c = input.company ?? {};
  const company = {
    legalName: text(c.legalName, "Legal name", 200),
    registrationNumber: text(c.registrationNumber, "Registration number", 100),
    country: text(c.country, "Country of registration", 100),
    incorporationDate: text(c.incorporationDate, "Date of incorporation", 20),
    registeredAddress: text(c.registeredAddress, "Registered address", 500),
    businessActivity: text(c.businessActivity, "Business activity", 1000),
    sourceOfFunds: text(c.sourceOfFunds, "Source of funds", 1000),
    website: text(c.website, "Website", 200, false) || null,
  };
  const list = Array.isArray(input.people) ? input.people : [];
  if (!list.length) throw new ApplicationError("INVALID_REQUEST", "Add at least one director and every owner of 25% or more");
  if (list.length > 20) throw new ApplicationError("INVALID_REQUEST", "Up to 20 people");
  const people = list.map((p: any, i: number) => {
    const roles = ["director", "owner", "director_and_owner"];
    const role = roles.includes(p?.role) ? p.role : null;
    if (!role) throw new ApplicationError("INVALID_REQUEST", `Person ${i + 1}: role must be director, owner or both`);
    const pct = p?.ownershipPct === undefined || p?.ownershipPct === "" ? null : Number(p.ownershipPct);
    if (role !== "director" && !(pct !== null && pct >= 0 && pct <= 100)) throw new ApplicationError("INVALID_REQUEST", `Person ${i + 1}: ownership must be between 0 and 100%`);
    return {
      name: text(p?.name, `Person ${i + 1}: name`, 200),
      role,
      nationality: text(p?.nationality, `Person ${i + 1}: nationality`, 100),
      dateOfBirth: text(p?.dateOfBirth, `Person ${i + 1}: date of birth`, 20),
      ownershipPct: pct,
      isPep: Boolean(p?.isPep),
    };
  });
  if (!people.some((p: any) => p.role !== "owner")) throw new ApplicationError("INVALID_REQUEST", "Add at least one director");
  const { rows: [s] } = await db.query(
    `INSERT INTO kyb_submissions (organisation_id, submitted_by, company, people) VALUES ($1,$2,$3,$4) RETURNING id, status, submitted_at`,
    [organisationId, userId, JSON.stringify(company), JSON.stringify(people)],
  );
  await record({ actor: user(userId), action: "kyb.submitted", subject: { type: "organisation", id: String(organisationId) }, data: { submissionId: s.id, people: people.length, peps: people.filter((p: any) => p.isPep).length } });
  return s;
}

export async function uploadKybDocument(userId: number, organisationId: number, submissionId: number, input: { kind?: unknown; name?: unknown; type?: unknown; data?: unknown }) {
  const db = await recordsDb();
  await requireOrgAdmin(db, userId, organisationId);
  const { rows: [s] } = await db.query(`SELECT id, status FROM kyb_submissions WHERE id = $1 AND organisation_id = $2`, [submissionId, organisationId]);
  if (!s) throw new ApplicationError("INVALID_REQUEST", "Submission not found");
  if (s.status === "approved") throw new ApplicationError("INVALID_REQUEST", "This submission is already approved");
  const kind = KYB_DOC_KINDS.includes(input.kind as any) ? String(input.kind) : "other";
  const mime = String(input.type ?? "");
  if (!KYB_TYPES.includes(mime)) throw new ApplicationError("INVALID_REQUEST", "Upload a PDF, PNG or JPEG");
  const bytes = Buffer.from(String(input.data ?? ""), "base64");
  if (!bytes.length || bytes.length > KYB_MAX_DOC_BYTES) throw new ApplicationError("INVALID_REQUEST", "Files must be under 5 MB");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { rows: [d] } = await db.query(
    `INSERT INTO kyb_documents (submission_id, kind, name, mime, data, sha256) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, kind, name, sha256, uploaded_at`,
    [submissionId, kind, text(input.name, "File name", 200), mime, bytes, sha256],
  );
  await record({ actor: user(userId), action: "kyb.document_uploaded", subject: { type: "organisation", id: String(organisationId) }, data: { submissionId, documentId: d.id, kind, sha256 } });
  return d;
}

export async function kybStatus(userId: number, organisationId: number) {
  const db = await recordsDb();
  await requireOrgAdmin(db, userId, organisationId);
  const { rows: [s] } = await db.query(`SELECT id, status, company, people, submitted_at, reviewed_at, reviewer_notes FROM kyb_submissions WHERE organisation_id = $1 ORDER BY id DESC LIMIT 1`, [organisationId]);
  if (!s) return null;
  const { rows: docs } = await db.query(`SELECT id, kind, name, sha256, uploaded_at FROM kyb_documents WHERE submission_id = $1 ORDER BY id`, [s.id]);
  return { ...s, documents: docs };
}

export async function listKyb(status?: string) {
  const db = await recordsDb();
  const { rows } = await db.query(
    `SELECT k.id, k.organisation_id, k.status, k.company->>'legalName' AS legal_name, k.company->>'country' AS country, k.submitted_at, k.reviewed_by, k.reviewed_at,
            (SELECT count(*) FROM kyb_documents d WHERE d.submission_id = k.id)::int AS documents
     FROM kyb_submissions k ${status ? "WHERE k.status = $1" : ""} ORDER BY k.id DESC LIMIT 500`,
    status ? [status] : [],
  );
  return rows;
}

export async function kybDetail(id: number, by: string) {
  const db = await recordsDb();
  const { rows: [s] } = await db.query(`SELECT * FROM kyb_submissions WHERE id = $1`, [id]);
  if (!s) throw new ApplicationError("INVALID_REQUEST", "Submission not found");
  const { rows: docs } = await db.query(`SELECT id, kind, name, mime, sha256, uploaded_at FROM kyb_documents WHERE submission_id = $1 ORDER BY id`, [id]);
  await record({ actor: staff(by), action: "data.viewed", subject: { type: "kyb_submission", id: String(id) }, data: { what: "KYB submission" } });
  return { ...s, documents: docs };
}

export async function kybDocument(submissionId: number, documentId: number, by: string) {
  const db = await recordsDb();
  const { rows: [d] } = await db.query(`SELECT name, mime, data FROM kyb_documents WHERE id = $1 AND submission_id = $2`, [documentId, submissionId]);
  if (!d) throw new ApplicationError("INVALID_REQUEST", "Document not found");
  await record({ actor: staff(by), action: "data.viewed", subject: { type: "kyb_document", id: String(documentId) }, data: { submissionId } });
  return d as { name: string; mime: string; data: Buffer };
}

export async function decideKyb(id: number, by: string, input: { decision?: unknown; notes?: unknown }) {
  const db = await recordsDb();
  const decision = ["approved", "rejected", "more_info"].includes(String(input.decision)) ? String(input.decision) : null;
  if (!decision) throw new ApplicationError("INVALID_REQUEST", "decision must be approved, rejected or more_info");
  const notes = text(input.notes, "Notes", 2000, decision !== "approved");
  const { rows: [s] } = await db.query(
    `UPDATE kyb_submissions SET status = $2, reviewed_by = $3, reviewed_at = now(), reviewer_notes = NULLIF($4,'') WHERE id = $1 RETURNING id, organisation_id, status`,
    [id, decision, by, notes],
  );
  if (!s) throw new ApplicationError("INVALID_REQUEST", "Submission not found");
  await record({ actor: staff(by), action: `kyb.${decision}`, subject: { type: "organisation", id: String(s.organisation_id) }, data: { submissionId: id, notes: notes || undefined } });
  return s;
}

// ── Suspicious activity cases ────────────────────────────────────────────────

export async function openCase(by: string, input: { title?: unknown; subjectType?: unknown; subjectId?: unknown; alertIds?: unknown; note?: unknown }) {
  const db = await recordsDb();
  const subjectType = ["user", "wallet", "organisation", "transaction"].includes(String(input.subjectType)) ? String(input.subjectType) : null;
  if (!subjectType) throw new ApplicationError("INVALID_REQUEST", "subjectType must be user, wallet, organisation or transaction");
  const alertIds = Array.isArray(input.alertIds) ? input.alertIds.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100) : [];
  const { rows: [c] } = await db.query(
    `INSERT INTO sar_cases (title, subject_type, subject_id, alert_ids, opened_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [text(input.title, "Title", 200), subjectType, text(input.subjectId, "Subject", 200), alertIds, by],
  );
  const note = text(input.note, "Note", 5000, false);
  if (note) await db.query(`INSERT INTO sar_case_notes (case_id, author, body) VALUES ($1,$2,$3)`, [c.id, by, note]);
  await record({ actor: staff(by), action: "case.opened", subject: { type: "case", id: String(c.id) }, data: { subjectType, subjectId: c.subject_id, alertIds } });
  return c;
}

export async function addCaseNote(id: number, by: string, body: unknown) {
  const db = await recordsDb();
  const { rows: [c] } = await db.query(`SELECT status FROM sar_cases WHERE id = $1`, [id]);
  if (!c) throw new ApplicationError("INVALID_REQUEST", "Case not found");
  const { rows: [n] } = await db.query(`INSERT INTO sar_case_notes (case_id, author, body) VALUES ($1,$2,$3) RETURNING *`, [id, by, text(body, "Note", 5000)]);
  await record({ actor: staff(by), action: "case.note_added", subject: { type: "case", id: String(id) }, data: { noteId: n.id } });
  return n;
}

export async function decideCase(id: number, by: string, input: { status?: unknown; decision?: unknown; reportReference?: unknown }) {
  const db = await recordsDb();
  const status = ["investigating", "closed_no_action", "reported"].includes(String(input.status)) ? String(input.status) : null;
  if (!status) throw new ApplicationError("INVALID_REQUEST", "status must be investigating, closed_no_action or reported");
  const decision = text(input.decision, "Reason for the decision", 5000, status !== "investigating");
  const reference = text(input.reportReference, "Report reference", 200, status === "reported");
  const { rows: [c] } = await db.query(
    `UPDATE sar_cases SET status = $2,
       decision = COALESCE(NULLIF($3,''), decision),
       decided_by = CASE WHEN $2 <> 'investigating' THEN $4 ELSE decided_by END,
       decided_at = CASE WHEN $2 <> 'investigating' THEN now() ELSE decided_at END,
       report_reference = COALESCE(NULLIF($5,''), report_reference),
       reported_at = CASE WHEN $2 = 'reported' THEN now() ELSE reported_at END
     WHERE id = $1 RETURNING *`,
    [id, status, decision, by, reference],
  );
  if (!c) throw new ApplicationError("INVALID_REQUEST", "Case not found");
  await record({ actor: staff(by), action: `case.${status}`, subject: { type: "case", id: String(id) }, data: { reportReference: reference || undefined } });
  return c;
}

export async function listCases(status?: string) {
  const db = await recordsDb();
  const { rows } = await db.query(`SELECT * FROM sar_cases ${status ? "WHERE status = $1" : ""} ORDER BY id DESC LIMIT 500`, status ? [status] : []);
  return rows;
}

export async function caseDetail(id: number, by: string) {
  const db = await recordsDb();
  const { rows: [c] } = await db.query(`SELECT * FROM sar_cases WHERE id = $1`, [id]);
  if (!c) throw new ApplicationError("INVALID_REQUEST", "Case not found");
  const { rows: notes } = await db.query(`SELECT * FROM sar_case_notes WHERE case_id = $1 ORDER BY id`, [id]);
  await record({ actor: staff(by), action: "data.viewed", subject: { type: "case", id: String(id) }, data: { what: "suspicious activity case" } });
  return { ...c, notes };
}

// ── Deletion requests ────────────────────────────────────────────────────────

export async function requestDeletion(userId: number) {
  const db = await recordsDb();
  const { rows: [open] } = await db.query(`SELECT id, status, requested_at FROM deletion_requests WHERE user_id = $1 AND status = 'received'`, [userId]);
  if (open) return open;
  const { rows: [r] } = await db.query(`INSERT INTO deletion_requests (user_id) VALUES ($1) RETURNING id, status, requested_at`, [userId]);
  await record({ actor: user(userId), action: "deletion.requested", subject: { type: "user", id: String(userId) } });
  return r;
}

export async function myDeletionRequest(userId: number) {
  const db = await recordsDb();
  const { rows: [r] } = await db.query(`SELECT id, status, requested_at, completed_at, summary FROM deletion_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [userId]);
  return r ?? null;
}

export async function listDeletionRequests() {
  const db = await recordsDb();
  const { rows } = await db.query(`SELECT * FROM deletion_requests ORDER BY id DESC LIMIT 500`);
  return rows;
}

/**
 * Carry out a deletion request: remove or anonymise what the retention policy lets us, and
 * report what is kept and until when. Identity, transaction and other regulated records stay
 * until their period ends; sign-in is closed by removing the email and Google link.
 */
export async function completeDeletion(id: number, by: string) {
  const db = await recordsDb();
  const { rows: [r] } = await db.query(`SELECT * FROM deletion_requests WHERE id = $1`, [id]);
  if (!r) throw new ApplicationError("INVALID_REQUEST", "Request not found");
  if (r.status !== "received") throw new ApplicationError("INVALID_REQUEST", "This request is already handled");
  const done: string[] = [];
  const tryRun = async (label: string, sql: string, params: unknown[]) => {
    try { const res: any = await db.query(sql, params); done.push(`${label}: ${res.rowCount ?? res.rows?.length ?? 0}`); } catch { /* table absent on this deployment */ }
  };
  await tryRun("profile anonymised", `UPDATE user_accounts SET name = NULL, avatar_url = NULL, google_id = NULL, email = 'deleted-' || id || '@deleted.invalid' WHERE id = $1`, [r.user_id]);
  await tryRun("sessions ended", `DELETE FROM auth_sessions WHERE user_id = $1`, [r.user_id]);
  // Finax conversations are kept per wallet (cus_<wallet>_<thread>).
  await tryRun("assistant conversations deleted", `DELETE FROM agent_messages WHERE scope = 'customer' AND EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = $1 AND agent_messages.thread_id LIKE 'cus_' || lower(w.address) || '_%')`, [r.user_id]);
  const kept = Object.entries(RETENTION).filter(([, rule]) => rule.onRequest === "keep").map(([key, rule]) => ({ key, label: rule.label, years: rule.years }));
  const summary = { done, kept };
  await db.query(`UPDATE deletion_requests SET status = 'completed', completed_at = now(), handled_by = $2, summary = $3 WHERE id = $1`, [id, by, JSON.stringify(summary)]);
  await record({ actor: staff(by), action: "deletion.completed", subject: { type: "user", id: String(r.user_id) }, data: summary });
  return summary;
}

// ── Travel Rule ──────────────────────────────────────────────────────────────

/** Transfers at or above this (USD) need recipient details. Configurable per deployment. */
export function travelRuleThreshold(): number {
  const v = Number(process.env.TRAVEL_RULE_THRESHOLD_USD);
  return Number.isFinite(v) && v > 0 ? v : 1000;
}

export interface TravelRuleInput { beneficiaryName?: unknown; beneficiaryType?: unknown; beneficiaryVasp?: unknown; beneficiaryCountry?: unknown }

/** Check and store recipient details for a transfer at or above the threshold. Returns null below it. */
export async function travelRuleFor(userId: number, organisationId: number | null, t: { chain: string; asset: string; amount: number; to: string }, input: TravelRuleInput | undefined) {
  if (!(t.amount >= travelRuleThreshold())) return null;
  const type = ["self", "person", "business"].includes(String(input?.beneficiaryType)) ? String(input!.beneficiaryType) : null;
  if (!input || !type) {
    throw new ApplicationError("TRAVEL_RULE_REQUIRED", `Transfers of $${travelRuleThreshold().toLocaleString("en-US")} or more need the recipient's details`);
  }
  const db = await recordsDb();
  const { rows: [acct] } = await db.query(`SELECT name, email FROM user_accounts WHERE id = $1`, [userId]).catch(() => ({ rows: [] as any[] }));
  const originator = { userId, organisationId, name: acct?.name ?? null };
  const name = type === "self" ? (acct?.name || "Account holder (self)") : text(input.beneficiaryName, "Recipient name", 200);
  const { rows: [rec] } = await db.query(
    `INSERT INTO travel_rule_records (user_id, organisation_id, chain, asset, amount, to_address, beneficiary_name, beneficiary_type, beneficiary_vasp, beneficiary_country, originator)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [userId, organisationId, t.chain, t.asset, t.amount, t.to, name, type, text(input.beneficiaryVasp, "Recipient's exchange or wallet provider", 200, false) || null,
      text(input.beneficiaryCountry, "Recipient's country", 100, false) || null, JSON.stringify(originator)],
  );
  await record({ actor: user(userId), action: "travel_rule.captured", subject: { type: "travel_rule", id: String(rec.id) }, data: { chain: t.chain, asset: t.asset, amount: t.amount, to: t.to, beneficiaryType: type } });
  return rec.id as number;
}

export async function listTravelRule(limit = 500) {
  const db = await recordsDb();
  const { rows } = await db.query(`SELECT * FROM travel_rule_records ORDER BY id DESC LIMIT $1`, [limit]);
  return rows;
}
