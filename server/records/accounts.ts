/**
 * People who signed up, for BlockFinaX staff: sign-up numbers over time, a searchable list,
 * and everything we hold about one person in one place (account, wallets, passkeys, identity
 * check, terms, businesses, complaints, deletion requests and their audit trail).
 * Opening one person's record is itself written to the compliance log.
 */
import { record } from "./log";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
async function getDb(): Promise<Db> {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  return pool as unknown as Db;
}
const rows = async (db: Db, sql: string, params: unknown[] = []) => { try { return (await db.query(sql, params)).rows; } catch { return []; } };

export async function accountsSummary(days = 30) {
  const db = await getDb();
  const n = Math.min(Math.max(days, 1), 365);
  const [totals] = await rows(db, `
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last7,
           count(*) FILTER (WHERE created_at >= now() - interval '14 days')::int AS last14,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS last30
    FROM user_accounts`);
  const byDay = await rows(db, `
    SELECT to_char(d::date, 'YYYY-MM-DD') AS day, count(u.id)::int AS n
    FROM generate_series((now() - ($1 || ' days')::interval)::date, now()::date, interval '1 day') d
    LEFT JOIN user_accounts u ON u.created_at::date = d::date
    GROUP BY 1 ORDER BY 1`, [String(n - 1)]);
  const [funnel] = await rows(db, `
    SELECT count(DISTINCT w.user_id)::int AS with_wallet,
           (SELECT count(DISTINCT user_id)::int FROM legal_acceptances) AS accepted_terms,
           (SELECT count(DISTINCT user_id)::int FROM auth_sessions WHERE created_at >= now() - interval '7 days') AS active7
    FROM chain_wallet_accounts w WHERE w.status = 'active'`);
  return { ...(totals ?? { total: 0, last7: 0, last14: 0, last30: 0 }), byDay, funnel: funnel ?? { with_wallet: 0, accepted_terms: 0, active7: 0 } };
}

export async function listAccounts(search = "", limit = 200) {
  const db = await getDb();
  const q = `%${search.trim().toLowerCase()}%`;
  return rows(db, `
    SELECT u.id, u.email, u.name, u.created_at,
           (SELECT max(s.created_at) FROM auth_sessions s WHERE s.user_id = u.id) AS last_sign_in,
           (SELECT w.address FROM chain_wallet_accounts w WHERE w.user_id = u.id AND w.status = 'active' ORDER BY w.id LIMIT 1) AS wallet,
           (SELECT count(*)::int FROM webauthn_credentials c WHERE c.user_id = u.id) AS passkeys,
           (SELECT max(l.accepted_at) FROM legal_acceptances l WHERE l.user_id = u.id) AS terms_accepted_at,
           (SELECT count(*)::int FROM business_account_members m WHERE m.user_id = u.id AND m.status = 'active') AS businesses
    FROM user_accounts u
    WHERE ($1 = '%%' OR lower(coalesce(u.email,'')) LIKE $1 OR lower(coalesce(u.name,'')) LIKE $1 OR u.id::text = trim($2)
           OR EXISTS (SELECT 1 FROM chain_wallet_accounts w WHERE w.user_id = u.id AND lower(w.address) LIKE $1))
    ORDER BY u.created_at DESC NULLS LAST LIMIT $3`, [q, search, Math.min(Math.max(limit, 1), 1000)]);
}

export async function accountDetail(id: number, staff: string) {
  const db = await getDb();
  const [account] = await rows(db, `SELECT id, email, name, avatar_url, created_at FROM user_accounts WHERE id = $1`, [id]);
  if (!account) return null;
  const wallets = await rows(db, `SELECT network_key, address, wallet_provider, account_type, status, created_at FROM chain_wallet_accounts WHERE user_id = $1 ORDER BY id`, [id]);
  const addresses = wallets.map((w) => String(w.address).toLowerCase());
  const [passkeys, sessions, kyc, terms, businesses, complaints, deletion, activity] = await Promise.all([
    rows(db, `SELECT id, created_at FROM webauthn_credentials WHERE user_id = $1 ORDER BY id`, [id]),
    rows(db, `SELECT created_at, expires_at FROM auth_sessions WHERE user_id = $1 ORDER BY id DESC LIMIT 10`, [id]),
    rows(db, `SELECT wallet_address, kyc_status, kyc_tier, country, submitted_at, reviewed_at FROM user_profiles WHERE lower(wallet_address) = ANY($1)`, [addresses]),
    rows(db, `SELECT document, version, accepted_at, ip FROM legal_acceptances WHERE user_id = $1 ORDER BY id`, [id]),
    rows(db, `SELECT b.id, b.name, b.status, m.role FROM business_account_members m JOIN business_accounts b ON b.id = m.organisation_id WHERE m.user_id = $1 AND m.status = 'active'`, [id]),
    rows(db, `SELECT id, category, subject, status, received_at FROM complaints WHERE user_id = $1 ORDER BY id DESC`, [id]),
    rows(db, `SELECT id, status, requested_at, completed_at FROM deletion_requests WHERE user_id = $1 ORDER BY id DESC`, [id]),
    rows(db, `SELECT id, at, action, subject_type, subject_id FROM compliance_log WHERE (actor_type = 'user' AND actor_id = $1) OR (subject_type = 'user' AND subject_id = $1) ORDER BY id DESC LIMIT 50`, [String(id)]),
  ]);
  await record({ actor: { type: "staff", id: staff }, action: "data.viewed", subject: { type: "user", id: String(id) }, data: { what: "account record" } });
  return { account, wallets, passkeys, sessions, kyc, terms, businesses, complaints, deletion, activity };
}
