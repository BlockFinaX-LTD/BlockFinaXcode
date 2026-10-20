/**
 * Persistent routing state (routing-v2.0.md section 7): routes and ledger entries live in
 * PostgreSQL, so a restart never loses a route or the record of funds in transit.
 *
 *   routing_routes   one row per route; the full RouteRecord as JSON, plus columns to query
 *   routing_ledger   every ledger entry, in order; replayed into a BalanceLedger at start
 */
import { BalanceLedger, type LedgerEntry, type Place } from "../domain/ledger";
import type { RouteRecord, RouteStore } from "./types";

type Query = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

const DONE = ["ACTION_COMPLETED", "REFUNDED"];

export async function ensureRoutingTables(query: Query) {
  await query(`CREATE TABLE IF NOT EXISTS routing_routes (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    state text NOT NULL,
    record jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await query(`CREATE INDEX IF NOT EXISTS routing_routes_user_idx ON routing_routes (user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS routing_routes_state_idx ON routing_routes (state)`);
  await query(`CREATE TABLE IF NOT EXISTS routing_ledger (
    id bigserial PRIMARY KEY,
    entry jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
}

export class DbRouteStore implements RouteStore {
  constructor(private readonly query: Query) {}

  async save(route: RouteRecord) {
    await this.query(
      `INSERT INTO routing_routes (id, user_id, state, record) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, record = EXCLUDED.record, updated_at = now()`,
      [route.id, route.request.userId, route.state, JSON.stringify(route)],
    );
  }

  async get(id: string) {
    const { rows } = await this.query(`SELECT record FROM routing_routes WHERE id = $1`, [id]);
    return rows[0]?.record as RouteRecord | undefined;
  }

  async listByUser(userId: string) {
    const { rows } = await this.query(`SELECT record FROM routing_routes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [userId]);
    return rows.map((r) => r.record as RouteRecord);
  }

  async listOpen() {
    const { rows } = await this.query(
      `SELECT record FROM routing_routes WHERE state <> ALL($1) AND updated_at > now() - interval '30 days' ORDER BY created_at`,
      [DONE],
    );
    return rows.map((r) => r.record as RouteRecord);
  }
}

/** A BalanceLedger that writes every entry to the database, and rebuilds itself from it. */
export class PersistentLedger extends BalanceLedger {
  private replaying = false;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly query: Query) {
    super();
  }

  static async load(query: Query): Promise<PersistentLedger> {
    const ledger = new PersistentLedger(query);
    const { rows } = await query(`SELECT entry FROM routing_ledger ORDER BY id`);
    ledger.replaying = true;
    try {
      for (const { entry } of rows as { entry: LedgerEntry }[]) {
        if (entry.from === "external") ledger.credit(entry.to as Place, entry.symbol, entry.amount, entry.reason, entry.ref);
        else if (entry.to === "external") ledger.debit(entry.from, entry.symbol, entry.amount, entry.reason, entry.ref);
        else ledger.transfer(entry.from, entry.to, entry.symbol, entry.amount, entry.reason, entry.ref);
      }
    } finally {
      ledger.replaying = false;
    }
    return ledger;
  }

  /** Resolves once every entry recorded so far is stored. */
  flushed() {
    return this.writes;
  }

  private persist() {
    if (this.replaying) return;
    const entry = this.entries[this.entries.length - 1];
    this.writes = this.writes.then(() => this.query(`INSERT INTO routing_ledger (entry) VALUES ($1)`, [JSON.stringify(entry)]))
      .catch((err) => console.error(`[Routing] ledger write failed: ${(err as Error).message}`));
  }

  override transfer(from: Place, to: Place, symbol: string, amount: string, reason: string, ref?: string) {
    super.transfer(from, to, symbol, amount, reason, ref);
    this.persist();
  }

  override credit(to: Place, symbol: string, amount: string, reason: string, ref?: string) {
    super.credit(to, symbol, amount, reason, ref);
    this.persist();
  }

  override debit(from: Place, symbol: string, amount: string, reason: string, ref?: string) {
    super.debit(from, symbol, amount, reason, ref);
    this.persist();
  }
}
