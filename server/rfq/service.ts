/**
 * Request a quote: when no pool sells the cover a business wants, it asks approved
 * underwriters for a price.
 *
 *   1. The business files a request (pair, direction, amount, duration; optional strike,
 *      cap and most it will pay). Minimum 5,000 protected; open for 3 days.
 *   2. An underwriter answers with a firm offer: strike, cap and premium. They approve,
 *      with their passkey, a transaction creating a private pool with exactly those terms
 *      and funded with the most the cover can pay. It is stored, not sent: nothing is
 *      locked, and its signature expires with the offer (1 hour for cover under 30 days,
 *      24 hours otherwise).
 *   3. The business accepts: the server submits the stored transaction, then signs a
 *      quote for that pool at the offered premium, and the business buys it as usual.
 *      If the underwriter no longer has the money, the offer fails and others stay open.
 *
 * Underwriters see requests without the business's identity. Approval: every
 * underwriter for now; RFQ_BLOCKED_USERS (comma-separated user ids) removes one.
 */
import { randomUUID } from "node:crypto";

export const MIN_REQUEST_USD = 5_000;
export const REQUEST_OPEN_HOURS = 72;

/** How long an offer stays valid: 1 hour for cover under 30 days, 24 hours otherwise. */
export function offerValiditySeconds(tenorDays: number) {
  return tenorDays < 30 ? 3_600 : 86_400;
}

export function isApprovedUnderwriter(userId: number, env: NodeJS.ProcessEnv = process.env) {
  const blocked = (env.RFQ_BLOCKED_USERS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return !blocked.includes(String(userId));
}

export interface QuoteRequestRow {
  id: string;
  user_id: number;
  pair: string;
  direction: "up" | "down";
  notional: string;
  tenor_days: number;
  strike: string | null;
  cap: string | null;
  max_premium: string | null;
  reason: string | null;
  status: "open" | "filled" | "cancelled" | "expired";
  created_at: Date;
  expires_at: Date;
}

export interface OfferRow {
  id: string;
  request_id: string;
  underwriter_user_id: number;
  underwriter_wallet: string;
  strike: string;
  cap: string;
  spot: string;
  premium: string;
  fair_rate_e6: number;
  max_payout: string;
  liquidity: string;
  status: "draft" | "open" | "accepted" | "bought" | "failed" | "withdrawn";
  valid_until: Date;
  signed_xdr: string | null;
  pool_id: number | null;
  error: string | null;
  created_at: Date;
}

let ready: Promise<void> | null = null;
export async function rfqDb() {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS quote_requests (
      id text PRIMARY KEY,
      user_id integer NOT NULL,
      pair text NOT NULL,
      direction text NOT NULL,
      notional text NOT NULL,
      tenor_days integer NOT NULL,
      strike text,
      cap text,
      max_premium text,
      reason text,
      status text NOT NULL DEFAULT 'open',
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS quote_requests_user_idx ON quote_requests (user_id);
    CREATE TABLE IF NOT EXISTS quote_offers (
      id text PRIMARY KEY,
      request_id text NOT NULL REFERENCES quote_requests(id),
      underwriter_user_id integer NOT NULL,
      underwriter_wallet text NOT NULL,
      strike text NOT NULL,
      cap text NOT NULL,
      spot text NOT NULL,
      premium text NOT NULL,
      fair_rate_e6 integer NOT NULL,
      max_payout text NOT NULL,
      liquidity text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      valid_until timestamptz NOT NULL,
      signed_xdr text,
      pool_id integer,
      error text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS quote_offers_request_idx ON quote_offers (request_id);
  `).then(() => undefined);
  await ready;
  return pool;
}

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

/** Requests past their window close; offers past their validity no longer count. */
export async function expireOld() {
  const db = await rfqDb();
  await db.query(`UPDATE quote_requests SET status = 'expired' WHERE status = 'open' AND expires_at < now()`);
}
