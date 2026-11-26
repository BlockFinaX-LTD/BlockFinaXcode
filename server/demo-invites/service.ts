/**
 * Demo invitations (testnet only): a link that lets an outside reviewer (a partner, an
 * investor, a platform evaluating us) try BlockFinaX without the email-code step.
 *
 * What the link does, and does not do:
 *   - It replaces only the email-code sign-in. The reviewer still creates their own passkey,
 *     which deploys their own smart wallet, exactly as any user does. No key is created or held
 *     for them, and nothing about passkeys, wallets or contracts changes.
 *   - Each acceptance makes a new, ordinary user account (no admin rights; admin uses its own
 *     token), linked to the invitation in demo_accounts.
 *   - Only a SHA-256 fingerprint of the link's secret is stored, so the database cannot rebuild
 *     a link. An invitation has an expiry, a number of accounts it can create, and can be revoked.
 *   - When an invitation is revoked or expires, its accounts can no longer sign in, and their
 *     open sessions are ended.
 *   - Nothing here exists unless the server runs as testnet (demoInvitesEnabled).
 */
import { createHash, randomBytes } from "node:crypto";

interface Db { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> }

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS demo_invites (
    id serial PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    label text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    max_accounts integer NOT NULL,
    fund_usdc numeric NOT NULL,
    country text NOT NULL DEFAULT 'US',
    note text
  );
  CREATE TABLE IF NOT EXISTS demo_accounts (
    user_id integer PRIMARY KEY,
    invite_id integer NOT NULL REFERENCES demo_invites(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    funded_at timestamptz,
    fund_tx text
  );
  CREATE INDEX IF NOT EXISTS demo_accounts_invite ON demo_accounts (invite_id);
`;

/** True only on a testnet deployment: the routes and checks below do nothing anywhere else. */
export function demoInvitesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BLOCKFINAX_ENV === "testnet" && env.NETWORK_MODE === "testnet";
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(24).toString("base64url");

export const LIMITS = { maxDays: 90, maxAccounts: 50, maxFundUsdc: 100_000 };

export interface InviteInput { label: string; days: number; maxAccounts: number; fundUsdc: number; country: string; note: string | null }

/** Check and trim what an admin typed. Throws with a readable reason. */
export function parseInvite(b: any): InviteInput {
  const label = String(b?.label ?? "").trim();
  if (label.length < 2 || label.length > 60) throw new Error("Give the invitation a name of 2 to 60 characters, such as the company it is for.");
  const days = Math.round(Number(b?.days ?? 30));
  if (!(days >= 1 && days <= LIMITS.maxDays)) throw new Error(`The invitation can last 1 to ${LIMITS.maxDays} days.`);
  const maxAccounts = Math.round(Number(b?.maxAccounts ?? 5));
  if (!(maxAccounts >= 1 && maxAccounts <= LIMITS.maxAccounts)) throw new Error(`An invitation can admit 1 to ${LIMITS.maxAccounts} reviewers.`);
  const fundUsdc = Math.round(Number(b?.fundUsdc ?? 10_000));
  if (!(fundUsdc >= 0 && fundUsdc <= LIMITS.maxFundUsdc)) throw new Error(`Funding can be 0 to ${LIMITS.maxFundUsdc.toLocaleString("en-US")} test USDC.`);
  const country = String(b?.country ?? "US").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("Use a two-letter country code, such as US or GB.");
  const note = String(b?.note ?? "").trim().slice(0, 300) || null;
  return { label, days, maxAccounts, fundUsdc, country, note };
}

export type InviteState = "active" | "expired" | "revoked" | "full";

export function stateOf(row: { expires_at: Date | string; revoked_at: Date | string | null; max_accounts: number; used?: number | string | null }, now = Date.now()): InviteState {
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() <= now) return "expired";
  if (Number(row.used ?? 0) >= Number(row.max_accounts)) return "full";
  return "active";
}

/** Whether an invitation still lets its accounts in (a full invitation still does). */
export const stillOpen = (s: InviteState) => s === "active" || s === "full";

let ready: Promise<void> | null = null;
export function ensureSchema(db: Db): Promise<void> {
  return (ready ??= db.query(SCHEMA).then(() => undefined).catch((e) => { ready = null; throw e; }));
}

export async function inviteByToken(db: Db, token: string) {
  await ensureSchema(db);
  const r = await db.query(
    `SELECT i.*, (SELECT count(*) FROM demo_accounts a WHERE a.invite_id = i.id) AS used FROM demo_invites i WHERE token_hash = $1`,
    [hashToken(token)],
  );
  return r.rows[0] ?? null;
}

/**
 * Whether this user may sign in. Ordinary users always may; a demo account only while its
 * invitation is neither revoked nor expired. On any deployment other than testnet, or if the
 * tables cannot be read, it answers yes: this check only ever narrows access for demo accounts.
 */
export async function demoAccessAllowed(db: Db, userId: number): Promise<boolean> {
  if (!demoInvitesEnabled()) return true;
  try {
    await ensureSchema(db);
    const r = await db.query(
      `SELECT i.expires_at, i.revoked_at FROM demo_accounts a JOIN demo_invites i ON i.id = a.invite_id WHERE a.user_id = $1`,
      [userId],
    );
    if (!r.rows.length) return true;
    const row = r.rows[0];
    return !row.revoked_at && new Date(row.expires_at).getTime() > Date.now();
  } catch {
    return true;
  }
}

/** End every open session of accounts whose invitation is revoked or expired. */
export async function endClosedSessions(db: Db, inviteId?: number): Promise<number> {
  await ensureSchema(db);
  const r = await db.query(
    `DELETE FROM auth_sessions s USING demo_accounts a, demo_invites i
     WHERE s.user_id = a.user_id AND a.invite_id = i.id
       AND (${inviteId ? "i.id = $1" : "i.revoked_at IS NOT NULL OR i.expires_at <= now()"})`,
    inviteId ? [inviteId] : [],
  );
  return r.rowCount ?? 0;
}
