/**
 * Connector portal storage (connector.blockfinax.com).
 *
 *   connectors              one row per member: connector or independent contractor
 *   connector_signatures    typed-name signatures, with the hash of the exact text signed
 *   connector_lessons       training results per module
 *   connector_registrations prospects and opportunities, with BlockFinaX's decision
 *   connector_referrals     users who signed up through a member's referral link
 *   connector_ledger        rewards earned and payments made, per quarter
 *   connector_engagements   contractor work offers and their acceptance
 *
 * Tables are created on first use, like the other v2 modules.
 */
import { createHash, randomUUID } from "node:crypto";
import { AGREEMENTS, agreementText, type DocumentKind } from "@shared/connector-programme";

let ready: Promise<void> | null = null;

export async function connectorDb() {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  const pending = (ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS connectors (
      user_id integer PRIMARY KEY,
      kind text NOT NULL DEFAULT 'connector',
      full_name text NOT NULL,
      organisation text,
      country text NOT NULL,
      email text NOT NULL,
      phone text,
      markets text,
      areas jsonb NOT NULL DEFAULT '[]',
      about text,
      status text NOT NULL DEFAULT 'applied',
      screening_status text NOT NULL DEFAULT 'pending',
      screening_detail jsonb,
      referral_code text UNIQUE,
      payout_details text,
      admin_note text,
      decided_by text,
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS connector_signatures (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      document text NOT NULL,
      version text NOT NULL,
      text_hash text NOT NULL,
      typed_name text NOT NULL,
      full_name text NOT NULL,
      email text NOT NULL,
      binding boolean NOT NULL,
      ip text,
      user_agent text,
      signed_at timestamptz NOT NULL DEFAULT now(),
      countersigned_by text,
      countersigned_at timestamptz,
      UNIQUE (user_id, document, version)
    );
    CREATE TABLE IF NOT EXISTS connector_lessons (
      user_id integer NOT NULL,
      module_id text NOT NULL,
      score real NOT NULL,
      passed boolean NOT NULL,
      attempts integer NOT NULL DEFAULT 1,
      passed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, module_id)
    );
    CREATE TABLE IF NOT EXISTS connector_registrations (
      id text PRIMARY KEY,
      user_id integer NOT NULL,
      area text NOT NULL,
      organisation text NOT NULL,
      org_key text NOT NULL,
      domain text,
      website text,
      contact_name text NOT NULL,
      contact_role text,
      contact_email text,
      country text NOT NULL,
      need text NOT NULL,
      permission boolean NOT NULL,
      conflict_with text,
      status text NOT NULL DEFAULT 'pending',
      reward_terms text,
      bonus_usd numeric(14,2),
      counts_for_review boolean NOT NULL DEFAULT false,
      period_start timestamptz,
      period_end timestamptz,
      decision_note text,
      decided_by text,
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS connector_registrations_user_idx ON connector_registrations (user_id);
    CREATE INDEX IF NOT EXISTS connector_registrations_key_idx ON connector_registrations (org_key);
    CREATE INDEX IF NOT EXISTS connector_registrations_domain_idx ON connector_registrations (domain);
    CREATE TABLE IF NOT EXISTS connector_referrals (
      referred_user_id integer PRIMARY KEY,
      connector_user_id integer NOT NULL,
      code text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS connector_referrals_connector_idx ON connector_referrals (connector_user_id);
    CREATE TABLE IF NOT EXISTS connector_ledger (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      registration_id text,
      referred_user_id integer,
      kind text NOT NULL,
      quarter text NOT NULL,
      amount_usd numeric(14,2) NOT NULL,
      note text,
      reference text,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS connector_ledger_user_idx ON connector_ledger (user_id);
    CREATE TABLE IF NOT EXISTS connector_engagements (
      id text PRIMARY KEY,
      user_id integer NOT NULL,
      title text NOT NULL,
      scope text NOT NULL,
      fee_terms text NOT NULL,
      starts_on date,
      ends_on date,
      status text NOT NULL DEFAULT 'offered',
      accepted_name text,
      accepted_at timestamptz,
      text_hash text,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS connector_engagements_user_idx ON connector_engagements (user_id);
  `).then(() => undefined));
  pending.catch(() => { ready = null; });
  await pending;
  return pool;
}

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** The hash stored with a signature: of the exact agreement text, so later edits are detectable. */
export function agreementHash(kind: DocumentKind) {
  return sha256(agreementText(AGREEMENTS[kind]));
}

/** The text an engagement acceptance covers. */
export function engagementText(e: { id: string; title: string; scope: string; fee_terms: string; starts_on: string | null; ends_on: string | null }) {
  return [`Engagement ${e.id}: ${e.title}`, `Scope: ${e.scope}`, `Fees: ${e.fee_terms}`, `Dates: ${e.starts_on ?? "open"} to ${e.ends_on ?? "open"}`,
    `Under the Independent Contractor Agreement ${AGREEMENTS.contractor.version}`].join("\n");
}

export interface ConnectorRow {
  user_id: number;
  kind: "connector" | "contractor";
  full_name: string;
  organisation: string | null;
  country: string;
  email: string;
  phone: string | null;
  markets: string | null;
  areas: string[];
  about: string | null;
  status: "applied" | "active" | "paused" | "ended" | "declined";
  screening_status: "pending" | "clear" | "hit" | "inconclusive";
  screening_detail: unknown;
  referral_code: string | null;
  payout_details: string | null;
  admin_note: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function getMember(userId: number): Promise<ConnectorRow | null> {
  const db = await connectorDb();
  const { rows } = await db.query(`SELECT * FROM connectors WHERE user_id = $1`, [userId]);
  return rows[0] ?? null;
}

export async function signedDocuments(userId: number) {
  const db = await connectorDb();
  const { rows } = await db.query(`SELECT * FROM connector_signatures WHERE user_id = $1 ORDER BY signed_at DESC`, [userId]);
  return rows as {
    id: number; document: DocumentKind; version: string; text_hash: string; typed_name: string; full_name: string; email: string;
    binding: boolean; signed_at: Date; countersigned_by: string | null; countersigned_at: Date | null;
  }[];
}

/** Whether the member has signed the current version of the agreement their membership needs. */
export async function hasCurrentSignature(userId: number, kind: DocumentKind) {
  const docs = await signedDocuments(userId);
  return docs.some((d) => d.document === kind && d.version === AGREEMENTS[kind].version);
}

export async function passedModules(userId: number): Promise<string[]> {
  const db = await connectorDb();
  const { rows } = await db.query(`SELECT module_id FROM connector_lessons WHERE user_id = $1 AND passed`, [userId]);
  return rows.map((r: { module_id: string }) => r.module_id);
}

/** Screens the member's name and organisation; a hit raises a compliance alert. Never throws. */
export async function screenMember(userId: number, m: { fullName: string; organisation?: string | null; country: string }) {
  try {
    const { screenName } = await import("../compliance/sanctions");
    const { raiseAlert } = await import("../compliance/limits");
    const { combineScreening } = await import("../onboarding/service");
    const subjects: { name: string; country: string; entityType: "individual" | "business" }[] = [
      { name: m.fullName, country: m.country, entityType: "individual" },
    ];
    if (m.organisation) subjects.push({ name: m.organisation, country: m.country, entityType: "business" });
    const results = await Promise.all(subjects.map((s) => screenName(s)));
    const status = combineScreening(results.map((r) => r.status));
    const detail = subjects.map((s, i) => ({ subject: s.name, status: results[i]!.status, topScore: results[i]!.topScore, matches: results[i]!.matches.slice(0, 3) }));
    const db = await connectorDb();
    await db.query(`UPDATE connectors SET screening_status = $2, screening_detail = $3 WHERE user_id = $1`, [userId, status, JSON.stringify(detail)]);
    if (status === "hit") {
      await raiseAlert({
        kind: "sanctions_hit", severity: "high",
        title: `Possible sanctions match on a connector application: ${detail.filter((d) => d.status === "hit").map((d) => d.subject).join(", ")}`,
        detail: "Screened from the connector portal application. Review before approving the member.",
        meta: { userId, source: "connector", detail },
      });
    }
    return status;
  } catch (err: any) {
    console.error("[connectors] screening failed:", err?.message);
    return "inconclusive" as const;
  }
}

/** Mails BlockFinaX's admins. Never throws: a failed email must not fail the request. */
export async function notifyAdmins(subject: string, lines: string[]) {
  try {
    const { sendEmail, shell, escapeHtml, ADMIN_EMAILS, APP_URL } = await import("../email");
    const body = lines.map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`).join("")
      + `<p style="margin:16px 0 0"><a href="${APP_URL}/admin">Open the admin dashboard</a></p>`;
    await sendEmail({ to: ADMIN_EMAILS, subject, html: shell(subject, body, { tag: "Connector portal" }) });
  } catch (err: any) {
    console.error("[connectors] admin email failed:", err?.message);
  }
}

/** Mails a member. Never throws. */
export async function notifyMember(to: string, subject: string, lines: string[]) {
  try {
    const { sendEmail, shell, escapeHtml } = await import("../email");
    const body = lines.map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`).join("")
      + `<p style="margin:16px 0 0"><a href="${portalUrl()}">Open the connector portal</a></p>`;
    await sendEmail({ to, subject, html: shell(subject, body, { tag: "Connector portal" }) });
  } catch (err: any) {
    console.error("[connectors] member email failed:", err?.message);
  }
}

/** Where the portal lives: CONNECTOR_PORTAL_URL, else the app's own /connector page. */
export function portalUrl() {
  const configured = (process.env.CONNECTOR_PORTAL_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return `${(process.env.PUBLIC_APP_URL || "https://www.blockfinax.com").replace(/\/$/, "")}/connector`;
}

/**
 * Whether signatures are accepted, and whether they bind. Testnet: open, marked as test
 * signatures. Mainnet: closed until CONNECTOR_AGREEMENT_APPROVED=true, set once counsel
 * has approved the text; then binding.
 */
export function signingPolicy(environment: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  const approved = env.CONNECTOR_AGREEMENT_APPROVED === "true";
  if (environment === "mainnet") return { open: approved, binding: approved };
  return { open: true, binding: false };
}
