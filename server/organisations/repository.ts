/**
 * Storage for organisations, their members and their history.
 *
 * Holds no key material. A member's passkey appears only as its credential id and public
 * key, which are public by nature. Invitation tokens are stored as SHA-256 hashes.
 *
 * Tables are created on first use (as the connector and RFQ modules do), so testnet and
 * production need no separate migration step.
 */
import type { ChainStep, MemberStatus, OrganisationRole, OrganisationRuleIds } from "@shared/organisations";

export type OrganisationStatus = "deploying" | "active" | "failed";
export type PendingKind = "activate" | "remove" | "role";

export interface OrganisationRow {
  id: number;
  name: string;
  networkKey: string;
  accountAddress: string | null;
  accountWasmHash: string | null;
  status: OrganisationStatus;
  adminApprovals: number;
  ruleIds: OrganisationRuleIds;
  createdBy: number;
  createdAt: Date;
}

export interface MemberRow {
  id: number;
  organisationId: number;
  userId: number | null;
  email: string;
  role: OrganisationRole;
  status: MemberStatus;
  credentialId: string | null;
  /** The passkey's 65-byte uncompressed public key, base64url. */
  publicKey: string | null;
  inviteTokenHash: string | null;
  inviteExpiresAt: Date | null;
  invitedBy: number | null;
  /** An on-chain change in progress: the steps still to approve, in order. */
  pendingKind: PendingKind | null;
  pendingRole: OrganisationRole | null;
  pendingSteps: ChainStep[];
  createdAt: Date;
  activatedAt: Date | null;
  removedAt: Date | null;
}

export interface EventRow {
  id: number;
  organisationId: number;
  actorUserId: number | null;
  kind: string;
  detail: Record<string, unknown>;
  txHash: string | null;
  createdAt: Date;
}

export interface OrganisationRepository {
  createOrganisation(o: Omit<OrganisationRow, "id" | "createdAt">): Promise<OrganisationRow>;
  updateOrganisation(id: number, patch: Partial<Omit<OrganisationRow, "id" | "createdAt">>): Promise<OrganisationRow>;
  organisation(id: number): Promise<OrganisationRow | null>;
  addMember(m: Omit<MemberRow, "id" | "createdAt">): Promise<MemberRow>;
  updateMember(id: number, patch: Partial<Omit<MemberRow, "id" | "organisationId" | "createdAt">>): Promise<MemberRow>;
  member(id: number): Promise<MemberRow | null>;
  members(organisationId: number): Promise<MemberRow[]>;
  memberByInviteHash(hash: string): Promise<MemberRow | null>;
  membershipsOf(userId: number): Promise<Array<{ organisation: OrganisationRow; member: MemberRow }>>;
  addEvent(e: Omit<EventRow, "id" | "createdAt">): Promise<void>;
  events(organisationId: number, limit: number): Promise<EventRow[]>;
}

// ── In memory (tests) ────────────────────────────────────────────────────────

export class InMemoryOrganisationRepository implements OrganisationRepository {
  private orgs: OrganisationRow[] = [];
  private mems: MemberRow[] = [];
  private evs: EventRow[] = [];

  async createOrganisation(o: Omit<OrganisationRow, "id" | "createdAt">) {
    const row = { ...o, id: this.orgs.length + 1, createdAt: new Date() };
    this.orgs.push(row);
    return { ...row };
  }
  async updateOrganisation(id: number, patch: Partial<OrganisationRow>) {
    const row = this.orgs.find((o) => o.id === id);
    if (!row) throw new Error("No such organisation");
    Object.assign(row, patch);
    return { ...row, ruleIds: { ...row.ruleIds } };
  }
  async organisation(id: number) {
    const row = this.orgs.find((o) => o.id === id);
    return row ? { ...row, ruleIds: { ...row.ruleIds } } : null;
  }
  async addMember(m: Omit<MemberRow, "id" | "createdAt">) {
    const row = { ...m, id: this.mems.length + 1, createdAt: new Date() };
    this.mems.push(row);
    return { ...row };
  }
  async updateMember(id: number, patch: Partial<MemberRow>) {
    const row = this.mems.find((m) => m.id === id);
    if (!row) throw new Error("No such member");
    Object.assign(row, patch);
    return { ...row, pendingSteps: [...row.pendingSteps] };
  }
  async member(id: number) {
    const row = this.mems.find((m) => m.id === id);
    return row ? { ...row, pendingSteps: [...row.pendingSteps] } : null;
  }
  async members(organisationId: number) {
    return this.mems.filter((m) => m.organisationId === organisationId).map((m) => ({ ...m, pendingSteps: [...m.pendingSteps] }));
  }
  async memberByInviteHash(hash: string) {
    const row = this.mems.find((m) => m.inviteTokenHash === hash);
    return row ? { ...row } : null;
  }
  async membershipsOf(userId: number) {
    return this.mems
      .filter((m) => m.userId === userId && m.status !== "removed")
      .map((m) => ({ organisation: { ...this.orgs.find((o) => o.id === m.organisationId)! }, member: { ...m } }));
  }
  async addEvent(e: Omit<EventRow, "id" | "createdAt">) {
    this.evs.push({ ...e, id: this.evs.length + 1, createdAt: new Date() });
  }
  async events(organisationId: number, limit: number) {
    return this.evs.filter((e) => e.organisationId === organisationId).slice(-limit).reverse();
  }
}

// ── Postgres ─────────────────────────────────────────────────────────────────

type Pool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const ORG_COLS = "id, name, network_key, account_address, account_wasm_hash, status, admin_approvals, rule_ids, created_by, created_at";
const MEMBER_COLS = "id, organisation_id, user_id, email, role, status, credential_id, public_key, invite_token_hash, invite_expires_at, invited_by, pending_kind, pending_role, pending_steps, created_at, activated_at, removed_at";

const orgFrom = (r: any): OrganisationRow => ({
  id: r.id, name: r.name, networkKey: r.network_key, accountAddress: r.account_address, accountWasmHash: r.account_wasm_hash,
  status: r.status, adminApprovals: r.admin_approvals, ruleIds: r.rule_ids, createdBy: r.created_by, createdAt: r.created_at,
});
const memberFrom = (r: any): MemberRow => ({
  id: r.id, organisationId: r.organisation_id, userId: r.user_id, email: r.email, role: r.role, status: r.status,
  credentialId: r.credential_id, publicKey: r.public_key, inviteTokenHash: r.invite_token_hash, inviteExpiresAt: r.invite_expires_at,
  invitedBy: r.invited_by, pendingKind: r.pending_kind, pendingRole: r.pending_role, pendingSteps: r.pending_steps ?? [],
  createdAt: r.created_at, activatedAt: r.activated_at, removedAt: r.removed_at,
});

const ORG_FIELDS: Record<string, string> = {
  name: "name", networkKey: "network_key", accountAddress: "account_address", accountWasmHash: "account_wasm_hash", status: "status",
  adminApprovals: "admin_approvals", ruleIds: "rule_ids", createdBy: "created_by",
};
const MEMBER_FIELDS: Record<string, string> = {
  userId: "user_id", email: "email", role: "role", status: "status", credentialId: "credential_id", publicKey: "public_key",
  inviteTokenHash: "invite_token_hash", inviteExpiresAt: "invite_expires_at", invitedBy: "invited_by", pendingKind: "pending_kind",
  pendingRole: "pending_role", pendingSteps: "pending_steps", activatedAt: "activated_at", removedAt: "removed_at",
};
const JSON_FIELDS = new Set(["ruleIds", "pendingSteps"]);

function setClause(patch: Record<string, unknown>, fields: Record<string, string>, start = 2) {
  const keys = Object.keys(patch).filter((k) => fields[k]);
  return {
    sql: keys.map((k, i) => `${fields[k]} = $${i + start}`).join(", "),
    values: keys.map((k) => (JSON_FIELDS.has(k) ? JSON.stringify(patch[k]) : patch[k])),
  };
}

export class PostgresOrganisationRepository implements OrganisationRepository {
  private ready: Promise<unknown> | null = null;
  constructor(private readonly pool: Pool) {}

  private ensure() {
    return (this.ready ??= this.pool.query(`
      CREATE TABLE IF NOT EXISTS business_accounts (
        id serial PRIMARY KEY,
        name text NOT NULL,
        network_key text NOT NULL,
        account_address text UNIQUE,
        account_wasm_hash text,
        status text NOT NULL DEFAULT 'deploying',
        admin_approvals integer NOT NULL DEFAULT 1,
        rule_ids jsonb NOT NULL,
        created_by integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS business_account_members (
        id serial PRIMARY KEY,
        organisation_id integer NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
        user_id integer,
        email text NOT NULL,
        role text NOT NULL,
        status text NOT NULL,
        credential_id text,
        public_key text,
        invite_token_hash text UNIQUE,
        invite_expires_at timestamptz,
        invited_by integer,
        pending_kind text,
        pending_role text,
        pending_steps jsonb NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now(),
        activated_at timestamptz,
        removed_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS business_account_members_org_idx ON business_account_members (organisation_id);
      CREATE INDEX IF NOT EXISTS business_account_members_user_idx ON business_account_members (user_id);
      CREATE TABLE IF NOT EXISTS business_account_events (
        id serial PRIMARY KEY,
        organisation_id integer NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
        actor_user_id integer,
        kind text NOT NULL,
        detail jsonb NOT NULL DEFAULT '{}',
        tx_hash text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS business_account_events_org_idx ON business_account_events (organisation_id, id DESC);
    `).catch((e) => { this.ready = null; throw e; }));
  }

  async createOrganisation(o: Omit<OrganisationRow, "id" | "createdAt">) {
    await this.ensure();
    const { rows } = await this.pool.query(
      `INSERT INTO business_accounts (name, network_key, account_address, account_wasm_hash, status, admin_approvals, rule_ids, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${ORG_COLS}`,
      [o.name, o.networkKey, o.accountAddress, o.accountWasmHash, o.status, o.adminApprovals, JSON.stringify(o.ruleIds), o.createdBy],
    );
    return orgFrom(rows[0]);
  }
  async updateOrganisation(id: number, patch: Partial<OrganisationRow>) {
    await this.ensure();
    const s = setClause(patch as Record<string, unknown>, ORG_FIELDS);
    if (!s.sql) return (await this.organisation(id))!;
    const { rows } = await this.pool.query(`UPDATE business_accounts SET ${s.sql} WHERE id = $1 RETURNING ${ORG_COLS}`, [id, ...s.values]);
    return orgFrom(rows[0]);
  }
  async organisation(id: number) {
    await this.ensure();
    const { rows } = await this.pool.query(`SELECT ${ORG_COLS} FROM business_accounts WHERE id = $1`, [id]);
    return rows[0] ? orgFrom(rows[0]) : null;
  }
  async addMember(m: Omit<MemberRow, "id" | "createdAt">) {
    await this.ensure();
    const { rows } = await this.pool.query(
      `INSERT INTO business_account_members (organisation_id, user_id, email, role, status, credential_id, public_key, invite_token_hash,
         invite_expires_at, invited_by, pending_kind, pending_role, pending_steps, activated_at, removed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${MEMBER_COLS}`,
      [m.organisationId, m.userId, m.email, m.role, m.status, m.credentialId, m.publicKey, m.inviteTokenHash, m.inviteExpiresAt,
        m.invitedBy, m.pendingKind, m.pendingRole, JSON.stringify(m.pendingSteps), m.activatedAt, m.removedAt],
    );
    return memberFrom(rows[0]);
  }
  async updateMember(id: number, patch: Partial<MemberRow>) {
    await this.ensure();
    const s = setClause(patch as Record<string, unknown>, MEMBER_FIELDS);
    if (!s.sql) return (await this.member(id))!;
    const { rows } = await this.pool.query(`UPDATE business_account_members SET ${s.sql} WHERE id = $1 RETURNING ${MEMBER_COLS}`, [id, ...s.values]);
    return memberFrom(rows[0]);
  }
  async member(id: number) {
    await this.ensure();
    const { rows } = await this.pool.query(`SELECT ${MEMBER_COLS} FROM business_account_members WHERE id = $1`, [id]);
    return rows[0] ? memberFrom(rows[0]) : null;
  }
  async members(organisationId: number) {
    await this.ensure();
    const { rows } = await this.pool.query(`SELECT ${MEMBER_COLS} FROM business_account_members WHERE organisation_id = $1 ORDER BY id`, [organisationId]);
    return rows.map(memberFrom);
  }
  async memberByInviteHash(hash: string) {
    await this.ensure();
    const { rows } = await this.pool.query(`SELECT ${MEMBER_COLS} FROM business_account_members WHERE invite_token_hash = $1`, [hash]);
    return rows[0] ? memberFrom(rows[0]) : null;
  }
  async membershipsOf(userId: number) {
    await this.ensure();
    const { rows } = await this.pool.query(
      `SELECT ${MEMBER_COLS.split(", ").map((c) => `m.${c}`).join(", ")}, ${ORG_COLS.split(", ").map((c) => `o.${c} AS o_${c}`).join(", ")}
       FROM business_account_members m JOIN business_accounts o ON o.id = m.organisation_id
       WHERE m.user_id = $1 AND m.status <> 'removed' ORDER BY o.id`,
      [userId],
    );
    return rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const c of ORG_COLS.split(", ")) o[c] = r[`o_${c}`];
      return { organisation: orgFrom(o), member: memberFrom(r) };
    });
  }
  async addEvent(e: Omit<EventRow, "id" | "createdAt">) {
    await this.ensure();
    await this.pool.query(
      `INSERT INTO business_account_events (organisation_id, actor_user_id, kind, detail, tx_hash) VALUES ($1,$2,$3,$4,$5)`,
      [e.organisationId, e.actorUserId, e.kind, JSON.stringify(e.detail), e.txHash],
    );
  }
  async events(organisationId: number, limit: number) {
    await this.ensure();
    const { rows } = await this.pool.query(
      `SELECT id, organisation_id, actor_user_id, kind, detail, tx_hash, created_at FROM business_account_events
       WHERE organisation_id = $1 ORDER BY id DESC LIMIT $2`,
      [organisationId, limit],
    );
    return rows.map((r) => ({ id: r.id, organisationId: r.organisation_id, actorUserId: r.actor_user_id, kind: r.kind, detail: r.detail, txHash: r.tx_hash, createdAt: r.created_at }));
  }
}
