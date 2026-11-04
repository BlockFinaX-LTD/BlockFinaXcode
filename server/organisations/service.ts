/**
 * Organisation accounts: who may do what, and how a change reaches the chain.
 *
 * The flow for every change to who controls the account:
 *   1. an admin starts it (activate an accepted member, remove someone, change a role);
 *      the service plans the on-chain steps with shared/organisations.ts and stores them;
 *   2. for each step the service prepares an unsigned transaction, the admin approves it
 *      with their passkey in the browser, and the relay submits it;
 *   3. the admin reports the transaction hash, and the service confirms the step by
 *      reading the chain (the hash is only a hint: the rule and signer are read back);
 *   4. after the last step the member's status and role change.
 *
 * Removing someone cuts their access in the app the moment the removal starts: their
 * membership stops being "active", and every organisation request checks that. The
 * on-chain removal then takes their passkey off the account.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  can, isRole, planAddMember, planChangeRole, planRemoveMember, validateOrganisationName, OrganisationRuleError,
  type ChainStep, type MemberSigner, type OrganisationContracts, type OrganisationRole, type OrganisationRuleIds, type OrganisationState,
} from "@shared/organisations";
import type { ContractSigner } from "@shared/smart-accounts";
import type { MemberRow, OrganisationRepository, OrganisationRow, PendingKind } from "./repository";

export const INVITE_DAYS = 7;
/** Each new business account costs the fee payer a deployment, so one person may create only a few. */
export const MAX_CREATED_PER_USER = 3;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class OrganisationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}
const err = (status: number, code: string, message: string) => new OrganisationError(status, code, message);

/** A member's passkey as the chain knows it. */
export interface PasskeyIdentity { credentialId: string; publicKey: Buffer }

export interface PasskeyLookup {
  /** The passkey this user signs with (their first, primary passkey). */
  passkeyOf(userId: number): Promise<PasskeyIdentity | null>;
  emailOf(userId: number): Promise<string | null>;
}

/** Everything that touches the chain, so the rules can be tested without one. */
export interface OrganisationGateway {
  networkKey: string;
  contracts(): OrganisationContracts;
  signerFor(passkey: PasskeyIdentity): ContractSigner;
  deploy(organisationId: number, admin: ContractSigner): Promise<{ contract: string; wasmHash: string }>;
  prepare(account: string, ruleIds: OrganisationRuleIds, step: ChainStep, signerFor: (credentialId: string) => ContractSigner): Promise<string>;
  /** Confirm a step from chain state. For a new rule, returns its id. */
  confirm(account: string, ruleIds: OrganisationRuleIds, step: ChainStep, hash: string, signerFor: (credentialId: string) => ContractSigner): Promise<{ ok: boolean; ruleId?: number; reason?: string }>;
}

export interface MemberView {
  id: number; email: string; role: OrganisationRole; status: MemberRow["status"]; userId: number | null;
  pending: { kind: PendingKind; role: OrganisationRole | null; stepsLeft: number } | null;
}
export interface OrganisationView {
  id: number; name: string; networkKey: string; account: string | null; status: OrganisationRow["status"];
  adminApprovals: number; myRole: OrganisationRole; members: MemberView[];
  /** What the browser needs to sign for the account and to check it independently. */
  ruleIds: OrganisationRuleIds; accountWasmHash: string | null;
  me: { memberId: number; credentialId: string | null; publicKey: string | null };
}
export interface PreparedStep { memberId: number; step: ChainStep; stepsLeft: number; xdr: string; account: string }

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class OrganisationService {
  constructor(
    private readonly repo: OrganisationRepository,
    private readonly gateway: OrganisationGateway,
    private readonly passkeys: PasskeyLookup,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── Creating and reading ───────────────────────────────────────────────────

  /** Create an organisation with its creator as the only admin, and deploy its account. */
  async create(userId: number, name: unknown): Promise<OrganisationView> {
    const clean = this.guard(() => validateOrganisationName(name));
    const created = (await this.repo.membershipsOf(userId)).filter(({ organisation }) => organisation.createdBy === userId).length;
    if (created >= MAX_CREATED_PER_USER) {
      throw err(429, "TOO_MANY_ORGANISATIONS", `You can create up to ${MAX_CREATED_PER_USER} business accounts. Contact BlockFinaX if you need more.`);
    }
    const passkey = await this.passkeys.passkeyOf(userId);
    if (!passkey) throw err(400, "NO_PASSKEY", "Create your wallet passkey first. It becomes your key to the organisation account.");
    const email = (await this.passkeys.emailOf(userId)) ?? `user-${userId}`;
    const org = await this.repo.createOrganisation({
      name: clean, networkKey: this.gateway.networkKey, accountAddress: null, accountWasmHash: null, status: "deploying",
      adminApprovals: 1, ruleIds: { admins: 0, operatorsPool: null, operatorsRatePool: null, operatorsUsdc: null }, createdBy: userId,
    });
    await this.repo.addMember({
      organisationId: org.id, userId, email, role: "admin", status: "active", credentialId: passkey.credentialId,
      publicKey: passkey.publicKey.toString("base64url"), inviteTokenHash: null, inviteExpiresAt: null, invitedBy: null,
      pendingKind: null, pendingRole: null, pendingSteps: [], activatedAt: this.now(), removedAt: null,
    });
    await this.repo.addEvent({ organisationId: org.id, actorUserId: userId, kind: "created", detail: { name: clean }, txHash: null });
    await this.deploy(org.id, userId);
    return this.view(userId, org.id);
  }

  /** Deploy (or retry deploying) an organisation's account. The address is fixed per organisation, so a retry is safe. */
  async deploy(organisationId: number, userId: number): Promise<OrganisationRow> {
    const { organisation, member } = await this.requireMember(userId, organisationId, "changeSettings", { allowDeploying: true });
    if (organisation.status === "active") return organisation;
    if (!member.credentialId || !member.publicKey) throw err(400, "NO_PASSKEY", "Your passkey is missing");
    try {
      const signer = this.gateway.signerFor({ credentialId: member.credentialId, publicKey: Buffer.from(member.publicKey, "base64url") });
      const { contract, wasmHash } = await this.gateway.deploy(organisationId, signer);
      await this.repo.addEvent({ organisationId, actorUserId: userId, kind: "account_deployed", detail: { account: contract }, txHash: null });
      return this.repo.updateOrganisation(organisationId, { accountAddress: contract, accountWasmHash: wasmHash, status: "active" });
    } catch (e) {
      await this.repo.updateOrganisation(organisationId, { status: "failed" });
      throw err(502, "DEPLOY_FAILED", `The organisation account could not be created: ${(e as Error).message}`);
    }
  }

  async list(userId: number) {
    return (await this.repo.membershipsOf(userId)).map(({ organisation, member }) => ({
      id: organisation.id, name: organisation.name, account: organisation.accountAddress, status: organisation.status,
      myRole: member.role, myStatus: member.status,
    }));
  }

  async view(userId: number, organisationId: number): Promise<OrganisationView> {
    const { organisation, member } = await this.requireMember(userId, organisationId, "view", { allowDeploying: true });
    const members = await this.repo.members(organisationId);
    return {
      id: organisation.id, name: organisation.name, networkKey: organisation.networkKey, account: organisation.accountAddress,
      status: organisation.status, adminApprovals: organisation.adminApprovals, myRole: member.role,
      ruleIds: organisation.ruleIds, accountWasmHash: organisation.accountWasmHash,
      me: { memberId: member.id, credentialId: member.credentialId, publicKey: member.publicKey },
      members: members.filter((m) => m.status !== "removed").map((m) => ({
        id: m.id, email: m.email, role: m.role, status: m.status, userId: m.userId,
        pending: m.pendingKind ? { kind: m.pendingKind, role: m.pendingRole, stepsLeft: m.pendingSteps.length } : null,
      })),
    };
  }

  async history(userId: number, organisationId: number, limit = 50) {
    await this.requireMember(userId, organisationId, "view");
    return this.repo.events(organisationId, Math.min(Math.max(limit, 1), 200));
  }

  /**
   * The organisation account a member acts as, for the protocol routes. Viewers resolve
   * too (they read balances and positions); the relay decides what each role may send.
   */
  async acting(userId: number, organisationId: number): Promise<{ account: string; role: OrganisationRole; ruleIds: OrganisationRuleIds; contracts: OrganisationContracts }> {
    const { organisation, member } = await this.requireMember(userId, organisationId, "view");
    return { account: organisation.accountAddress!, role: member.role, ruleIds: organisation.ruleIds, contracts: this.gateway.contracts() };
  }

  // ── Invitations ────────────────────────────────────────────────────────────

  /** Invite someone by email. Returns the one-time token for the invitation link. */
  async invite(userId: number, organisationId: number, input: { email?: unknown; role?: unknown }): Promise<{ member: MemberView; token: string }> {
    const { organisation } = await this.requireMember(userId, organisationId, "manageMembers");
    const email = String(input.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) throw err(400, "BAD_EMAIL", "Enter a valid email address");
    if (!isRole(input.role)) throw err(400, "BAD_ROLE", "Choose admin, operator or viewer");
    const existing = (await this.repo.members(organisationId)).find((m) => m.email === email && m.status !== "removed");
    if (existing) throw err(409, "ALREADY_MEMBER", "That person is already a member or has an invitation");
    const token = randomBytes(32).toString("base64url");
    const member = await this.repo.addMember({
      organisationId, userId: null, email, role: input.role, status: "invited", credentialId: null, publicKey: null,
      inviteTokenHash: hashToken(token), inviteExpiresAt: new Date(this.now().getTime() + INVITE_DAYS * 86_400_000), invitedBy: userId,
      pendingKind: null, pendingRole: null, pendingSteps: [], activatedAt: null, removedAt: null,
    });
    await this.repo.addEvent({ organisationId: organisation.id, actorUserId: userId, kind: "invited", detail: { email, role: input.role }, txHash: null });
    return { member: this.memberView(member), token };
  }

  /**
   * Accept an invitation. The signed-in user's email must be the invited one, so a
   * forwarded link is useless. A viewer is active at once; anyone who will sign waits for
   * an admin to put their passkey on the account.
   */
  async accept(userId: number, token: unknown): Promise<{ organisationId: number; status: MemberRow["status"] }> {
    if (typeof token !== "string" || token.length < 20) throw err(400, "BAD_INVITE", "This invitation link is not valid");
    const member = await this.repo.memberByInviteHash(hashToken(token));
    if (!member || member.status !== "invited") throw err(404, "BAD_INVITE", "This invitation has been used or withdrawn");
    if (!member.inviteExpiresAt || member.inviteExpiresAt < this.now()) throw err(410, "INVITE_EXPIRED", "This invitation has expired. Ask for a new one.");
    const email = (await this.passkeys.emailOf(userId))?.toLowerCase();
    if (email !== member.email) throw err(403, "WRONG_ACCOUNT", `This invitation is for ${member.email}. Sign in with that email to accept it.`);
    const already = (await this.repo.members(member.organisationId)).find((m) => m.userId === userId && m.status !== "removed");
    if (already) throw err(409, "ALREADY_MEMBER", "You are already a member of this organisation");

    const passkey = member.role === "viewer" ? null : await this.passkeys.passkeyOf(userId);
    if (member.role !== "viewer" && !passkey) throw err(400, "NO_PASSKEY", "Create your wallet passkey first, then open the invitation again");
    if (passkey) {
      const clash = (await this.repo.members(member.organisationId)).find((m) => m.credentialId === passkey.credentialId && m.status !== "removed");
      if (clash) throw err(409, "PASSKEY_IN_USE", "That passkey already belongs to another member");
    }
    const status = member.role === "viewer" ? "active" : "accepted";
    await this.repo.updateMember(member.id, {
      userId, status, inviteTokenHash: null, credentialId: passkey?.credentialId ?? null,
      publicKey: passkey ? passkey.publicKey.toString("base64url") : null, activatedAt: status === "active" ? this.now() : null,
    });
    await this.repo.addEvent({ organisationId: member.organisationId, actorUserId: userId, kind: "accepted", detail: { email: member.email, role: member.role }, txHash: null });
    return { organisationId: member.organisationId, status };
  }

  /** Withdraw an invitation that is not yet on the account. */
  async revokeInvite(userId: number, organisationId: number, memberId: number) {
    await this.requireMember(userId, organisationId, "manageMembers");
    const m = await this.memberOf(organisationId, memberId);
    if (m.status !== "invited" && m.status !== "accepted") throw err(409, "NOT_AN_INVITE", "Only an invitation that is not yet active can be withdrawn");
    if (m.pendingSteps.length) throw err(409, "CHANGE_IN_PROGRESS", "Finish or cancel the change in progress first");
    await this.repo.updateMember(memberId, { status: "removed", inviteTokenHash: null, removedAt: this.now() });
    await this.repo.addEvent({ organisationId, actorUserId: userId, kind: "invite_withdrawn", detail: { email: m.email }, txHash: null });
  }

  // ── On-chain changes ───────────────────────────────────────────────────────

  /** Start a change: activate an accepted member, remove a member, or change a role. Returns the first step. */
  async start(userId: number, organisationId: number, memberId: number, change: { kind?: unknown; role?: unknown }): Promise<PreparedStep | { done: true; member: MemberView }> {
    const { organisation, member: actor } = await this.requireMember(userId, organisationId, "manageMembers");
    const target = await this.memberOf(organisationId, memberId);
    const members = await this.repo.members(organisationId);
    const busy = members.find((m) => m.pendingSteps.length > 0);
    if (busy && busy.id !== target.id) throw err(409, "CHANGE_IN_PROGRESS", "Finish the change already in progress first");
    if (target.pendingSteps.length) return this.prepareNext(organisation, target);

    const state = this.state(organisation, members);
    const asSigner = (m: MemberRow, role: OrganisationRole = m.role): MemberSigner => ({ memberId: m.id, role, credentialId: m.credentialId ?? `none-${m.id}` });
    let kind: PendingKind;
    let steps: ChainStep[];
    let pendingRole: OrganisationRole | null = null;
    if (change.kind === "activate") {
      if (target.status !== "accepted") throw err(409, "NOT_ACCEPTED", "Only someone who has accepted their invitation can be activated");
      kind = "activate";
      steps = this.guard(() => planAddMember(state, asSigner(target)));
    } else if (change.kind === "remove") {
      if (target.status !== "active") throw err(409, "NOT_ACTIVE", "Only an active member can be removed. Withdraw an invitation instead.");
      if (target.id === actor.id && target.role === "admin" && members.filter((m) => m.role === "admin" && m.status === "active").length <= 1) {
        throw err(409, "LAST_ADMIN", "An organisation must keep at least one admin");
      }
      kind = "remove";
      steps = this.guard(() => planRemoveMember(state, asSigner(target)));
      // Access in the app ends now, before the chain catches up.
      await this.repo.updateMember(target.id, { status: "removing" });
    } else if (change.kind === "role") {
      if (target.status !== "active") throw err(409, "NOT_ACTIVE", "Only an active member's role can change");
      if (!isRole(change.role)) throw err(400, "BAD_ROLE", "Choose admin, operator or viewer");
      let subject = target;
      if (change.role !== "viewer" && !target.credentialId) {
        // A viewer joined without a passkey on record; one is needed before they can sign.
        const passkey = target.userId ? await this.passkeys.passkeyOf(target.userId) : null;
        if (!passkey) throw err(400, "NO_PASSKEY", "This member must create their wallet passkey before they can sign");
        if (members.some((m) => m.credentialId === passkey.credentialId && m.status !== "removed")) throw err(409, "PASSKEY_IN_USE", "That passkey already belongs to another member");
        subject = await this.repo.updateMember(target.id, { credentialId: passkey.credentialId, publicKey: passkey.publicKey.toString("base64url") });
      }
      kind = "role";
      pendingRole = change.role;
      steps = this.guard(() => planChangeRole(state, asSigner(subject), change.role as OrganisationRole));
    } else {
      throw err(400, "BAD_CHANGE", "Unknown change");
    }

    if (steps.length === 0) return { done: true, member: this.memberView(await this.finish(organisation, target, kind, pendingRole, userId)) };
    const updated = await this.repo.updateMember(target.id, { pendingKind: kind, pendingRole, pendingSteps: steps });
    await this.repo.addEvent({ organisationId, actorUserId: userId, kind: `${kind}_started`, detail: { email: target.email, role: pendingRole ?? target.role, steps: steps.length }, txHash: null });
    return this.prepareNext(organisation, updated);
  }

  /** Prepare the current step again (a prepared transaction expires after a few minutes). */
  async next(userId: number, organisationId: number, memberId: number): Promise<PreparedStep> {
    const { organisation } = await this.requireMember(userId, organisationId, "manageMembers");
    const target = await this.memberOf(organisationId, memberId);
    if (!target.pendingSteps.length) throw err(409, "NOTHING_PENDING", "There is no change in progress for this member");
    return this.prepareNext(organisation, target);
  }

  /** Confirm the current step from the chain, then return the next one or the finished member. */
  async confirm(userId: number, organisationId: number, memberId: number, hash: unknown): Promise<PreparedStep | { done: true; member: MemberView }> {
    const { organisation } = await this.requireMember(userId, organisationId, "manageMembers");
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) throw err(400, "BAD_HASH", "A transaction hash is required");
    const target = await this.memberOf(organisationId, memberId);
    const step = target.pendingSteps[0];
    if (!step) throw err(409, "NOTHING_PENDING", "There is no change in progress for this member");

    const members = await this.repo.members(organisationId);
    const result = await this.gateway.confirm(organisation.accountAddress!, organisation.ruleIds, step, hash, this.signerLookup(members));
    if (!result.ok) throw err(409, "NOT_CONFIRMED", result.reason ?? "The chain does not show this change yet. Try again in a moment.");

    let org = organisation;
    if (step.op === "add_context_rule") {
      if (result.ruleId === undefined) throw err(502, "NO_RULE_ID", "The new rule's id could not be read");
      org = await this.repo.updateOrganisation(organisationId, { ruleIds: { ...organisation.ruleIds, [step.rule]: result.ruleId } });
    } else if (step.op === "remove_context_rule") {
      org = await this.repo.updateOrganisation(organisationId, { ruleIds: { ...organisation.ruleIds, [step.rule]: null } });
    }
    const rest = target.pendingSteps.slice(1);
    const updated = await this.repo.updateMember(target.id, { pendingSteps: rest });
    await this.repo.addEvent({ organisationId, actorUserId: userId, kind: "step_confirmed", detail: { email: target.email, op: step.op, rule: step.rule }, txHash: hash });
    if (rest.length) return this.prepareNext(org, updated);
    return { done: true, member: this.memberView(await this.finish(org, updated, target.pendingKind!, target.pendingRole, userId)) };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async finish(org: OrganisationRow, m: MemberRow, kind: PendingKind, role: OrganisationRole | null, actor: number): Promise<MemberRow> {
    const patch: Partial<MemberRow> = { pendingKind: null, pendingRole: null, pendingSteps: [] };
    if (kind === "activate") Object.assign(patch, { status: "active", activatedAt: this.now() });
    if (kind === "remove") Object.assign(patch, { status: "removed", removedAt: this.now() });
    if (kind === "role" && role) Object.assign(patch, { role });
    const done = await this.repo.updateMember(m.id, patch);
    await this.repo.addEvent({ organisationId: org.id, actorUserId: actor, kind: kind === "activate" ? "activated" : kind === "remove" ? "removed" : "role_changed", detail: { email: m.email, role: done.role }, txHash: null });
    return done;
  }

  private async prepareNext(org: OrganisationRow, m: MemberRow): Promise<PreparedStep> {
    if (!org.accountAddress || org.status !== "active") throw err(409, "NOT_DEPLOYED", "The organisation account is not ready yet");
    const step = m.pendingSteps[0];
    const members = await this.repo.members(org.id);
    try {
      const xdr = await this.gateway.prepare(org.accountAddress, org.ruleIds, step, this.signerLookup(members));
      return { memberId: m.id, step, stepsLeft: m.pendingSteps.length, xdr, account: org.accountAddress };
    } catch (e) {
      throw err(502, "PREPARE_FAILED", (e as Error).message);
    }
  }

  private signerLookup(members: MemberRow[]) {
    return (credentialId: string): ContractSigner => {
      const m = members.find((x) => x.credentialId === credentialId && x.publicKey);
      if (!m) throw err(409, "UNKNOWN_PASSKEY", "A member's passkey is missing");
      return this.gateway.signerFor({ credentialId, publicKey: Buffer.from(m.publicKey!, "base64url") });
    };
  }

  private state(org: OrganisationRow, members: MemberRow[]): OrganisationState {
    return {
      ruleIds: org.ruleIds, adminApprovals: org.adminApprovals, contracts: this.gateway.contracts(),
      active: members.filter((m) => m.status === "active" && m.credentialId).map((m) => ({ memberId: m.id, role: m.role, credentialId: m.credentialId! })),
    };
  }

  private async memberOf(organisationId: number, memberId: number) {
    const m = await this.repo.member(Number(memberId));
    if (!m || m.organisationId !== organisationId || m.status === "removed") throw err(404, "NO_MEMBER", "No such member");
    return m;
  }

  /** The caller's active membership, with a permission check. */
  private async requireMember(userId: number, organisationId: number, permission: Parameters<typeof can>[1], opts: { allowDeploying?: boolean } = {}) {
    const organisation = await this.repo.organisation(Number(organisationId));
    if (!organisation) throw err(404, "NO_ORGANISATION", "No such organisation");
    const member = (await this.repo.members(organisation.id)).find((m) => m.userId === userId && m.status === "active");
    if (!member) throw err(403, "NOT_A_MEMBER", "You are not an active member of this organisation");
    if (!can(member.role, permission)) throw err(403, "NOT_ALLOWED", "Your role does not allow this");
    if (!opts.allowDeploying && (organisation.status !== "active" || !organisation.accountAddress)) {
      throw err(409, "NOT_DEPLOYED", "The organisation account is not ready yet");
    }
    return { organisation, member };
  }

  private memberView(m: MemberRow): MemberView {
    return {
      id: m.id, email: m.email, role: m.role, status: m.status, userId: m.userId,
      pending: m.pendingKind ? { kind: m.pendingKind, role: m.pendingRole, stepsLeft: m.pendingSteps.length } : null,
    };
  }

  private guard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof OrganisationRuleError) throw err(409, e.code, e.message);
      throw e;
    }
  }
}
