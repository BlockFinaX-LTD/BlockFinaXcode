/**
 * Onboarding records: who an account belongs to, and the organisation behind it.
 *
 * One row per user in account_onboarding. An organisation account also creates an
 * organisations row with the user as its first admin in organisation_members, so
 * invitations and approvals can be added later without moving data.
 *
 * Saving never waits for sanctions screening. The names are screened in the
 * background; a hit raises a compliance alert for review. Trading is gated
 * separately, by the verification tiers.
 */
import type { OnboardingInput } from "@shared/onboarding";

export interface OnboardingRow {
  user_id: number;
  account_type: "individual" | "organisation";
  full_name: string;
  country: string;
  phone: string | null;
  job_title: string | null;
  intents: string[];
  organisation_id: number | null;
  screening_status: "pending" | "clear" | "hit" | "inconclusive";
  completed_at: Date;
  updated_at: Date;
}

export interface OrganisationRow {
  id: number;
  legal_name: string;
  registration_country: string;
  registration_number: string;
  industry: string;
  monthly_volume: string;
  verification_status: string;
  created_by: number;
  created_at: Date;
}

let ready: Promise<void> | null = null;
export async function onboardingDb() {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS organisations (
      id serial PRIMARY KEY,
      legal_name text NOT NULL,
      registration_country text NOT NULL,
      registration_number text NOT NULL,
      industry text NOT NULL,
      monthly_volume text NOT NULL,
      verification_status text NOT NULL DEFAULT 'unverified',
      created_by integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS organisation_members (
      organisation_id integer NOT NULL REFERENCES organisations(id),
      user_id integer NOT NULL,
      role text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organisation_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS organisation_members_user_idx ON organisation_members (user_id);
    CREATE TABLE IF NOT EXISTS account_onboarding (
      user_id integer PRIMARY KEY,
      account_type text NOT NULL,
      full_name text NOT NULL,
      country text NOT NULL,
      phone text,
      job_title text,
      intents text[] NOT NULL,
      organisation_id integer REFERENCES organisations(id),
      screening_status text NOT NULL DEFAULT 'pending',
      screening_detail jsonb,
      completed_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `).then(() => undefined);
  await ready;
  return pool;
}

/**
 * Onboarding went live on 26 October 2026. Accounts created before then already use the
 * workspace, so they are not stopped by the first-run form; they can still fill it in later.
 */
export const ONBOARDING_STARTED = new Date("2026-10-27T00:00:00Z");

export function predatesOnboarding(createdAt: Date | null | undefined) {
  return !!createdAt && createdAt.getTime() < ONBOARDING_STARTED.getTime();
}

export async function accountCreatedAt(userId: number): Promise<Date | null> {
  const db = await onboardingDb();
  const { rows } = await db.query(`SELECT created_at FROM user_accounts WHERE id = $1`, [userId]);
  return (rows[0] as { created_at: Date | null } | undefined)?.created_at ?? null;
}

export async function getOnboarding(userId: number) {
  const db = await onboardingDb();
  const { rows } = await db.query(`SELECT * FROM account_onboarding WHERE user_id = $1`, [userId]);
  const row = rows[0] as OnboardingRow | undefined;
  if (!row) return null;
  let organisation: OrganisationRow | null = null;
  if (row.organisation_id) {
    const org = await db.query(`SELECT * FROM organisations WHERE id = $1`, [row.organisation_id]);
    organisation = (org.rows[0] as OrganisationRow | undefined) ?? null;
  }
  return { row, organisation };
}

/**
 * Saves the form. Editing keeps the same organisation; switching from organisation
 * to individual detaches it (the organisation row stays, for the record).
 */
export async function saveOnboarding(userId: number, input: OnboardingInput) {
  const db = await onboardingDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT * FROM account_onboarding WHERE user_id = $1 FOR UPDATE`, [userId]);
    let organisationId: number | null = null;
    if (input.accountType === "organisation") {
      const current = (existing.rows[0] as OnboardingRow | undefined)?.organisation_id ?? null;
      const orgValues = [input.legalName, input.registrationCountry, input.registrationNumber, input.industry, input.monthlyVolume];
      if (current) {
        await client.query(
          `UPDATE organisations SET legal_name = $1, registration_country = $2, registration_number = $3, industry = $4,
             monthly_volume = $5, updated_at = now() WHERE id = $6`,
          [...orgValues, current],
        );
        organisationId = current;
      } else {
        const created = await client.query(
          `INSERT INTO organisations (legal_name, registration_country, registration_number, industry, monthly_volume, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [...orgValues, userId],
        );
        organisationId = (created.rows[0] as { id: number }).id;
        await client.query(
          `INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'admin')`,
          [organisationId, userId],
        );
      }
    }
    await client.query(
      `INSERT INTO account_onboarding (user_id, account_type, full_name, country, phone, job_title, intents, organisation_id, screening_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       ON CONFLICT (user_id) DO UPDATE SET account_type = EXCLUDED.account_type, full_name = EXCLUDED.full_name,
         country = EXCLUDED.country, phone = EXCLUDED.phone, job_title = EXCLUDED.job_title, intents = EXCLUDED.intents,
         organisation_id = EXCLUDED.organisation_id, screening_status = 'pending', updated_at = now()`,
      [userId, input.accountType, input.fullName, input.country, input.phone ?? null, input.jobTitle ?? null, input.intents, organisationId],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

type Screen = (args: { name: string; country?: string | null; entityType?: "individual" | "business" }) =>
  Promise<{ status: "clear" | "hit" | "inconclusive"; topScore: number; matches: { name: string }[] }>;
type Alert = (args: { kind: "sanctions_hit"; severity: "high"; title: string; detail: string; meta: Record<string, unknown> }) => Promise<void>;

/** The worst of several screening results: a hit outranks inconclusive, which outranks clear. */
export function combineScreening(results: ("clear" | "hit" | "inconclusive")[]): "clear" | "hit" | "inconclusive" {
  if (results.includes("hit")) return "hit";
  if (results.includes("inconclusive")) return "inconclusive";
  return "clear";
}

/** Screens the person and, for an organisation, its legal name. Never throws. */
export async function screenOnboarding(userId: number, input: OnboardingInput, deps?: { screen?: Screen; alert?: Alert }) {
  try {
    const screen: Screen = deps?.screen ?? (await import("../compliance/sanctions")).screenName;
    const alert: Alert = deps?.alert ?? (await import("../compliance/limits")).raiseAlert;
    const subjects: { name: string; country: string; entityType: "individual" | "business" }[] = [
      { name: input.fullName, country: input.country, entityType: "individual" },
    ];
    if (input.accountType === "organisation" && input.legalName) {
      subjects.push({ name: input.legalName, country: input.registrationCountry ?? input.country, entityType: "business" });
    }
    const results = await Promise.all(subjects.map((s) => screen(s)));
    const status = combineScreening(results.map((r) => r.status));
    const detail = subjects.map((s, i) => ({ subject: s.name, status: results[i]!.status, topScore: results[i]!.topScore, matches: results[i]!.matches.slice(0, 3) }));
    const db = await onboardingDb();
    await db.query(`UPDATE account_onboarding SET screening_status = $2, screening_detail = $3 WHERE user_id = $1`, [userId, status, JSON.stringify(detail)]);
    if (status === "hit") {
      await alert({
        kind: "sanctions_hit",
        severity: "high",
        title: `Possible sanctions match at sign-up: ${detail.filter((d) => d.status === "hit").map((d) => d.subject).join(", ")}`,
        detail: "Screened from the onboarding form. Review before this account is verified to trade.",
        meta: { userId, source: "onboarding", detail },
      });
    }
    return status;
  } catch (err: any) {
    console.error("[onboarding] screening failed:", err?.message);
    return "inconclusive" as const;
  }
}
