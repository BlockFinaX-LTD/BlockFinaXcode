/**
 * Organisation accounts: the rules that decide who may do what with a business's money.
 *
 * Pure and dependency-free so the same logic runs in the browser, on the server and in
 * tests. Nothing here talks to a chain; it produces plans that other code executes.
 *
 * An organisation owns one OpenZeppelin smart account on Stellar. Its members are people,
 * each with their own sign-in and their own passkey. A member's role decides which of the
 * account's context rules their passkey is a signer on:
 *
 *   admin     the Default rule. Can do anything: withdraw to any address, add and remove
 *             members, change settings. A threshold policy says how many admins must
 *             approve (1 at launch; the setting exists so two-admin approval is a config
 *             change later, never a new contract).
 *   operator  three rules scoped to single contracts: the currency pool, the rate pool,
 *             and USDC. The USDC rule carries the transfer allow-list policy, so the only
 *             USDC an operator can move is a payment into a BlockFinaX pool. Every pool
 *             function pays money back to the account that owns the position or deposit,
 *             never to an address the caller chooses, so an operator cannot get money out.
 *   viewer    no signer anywhere. Sees balances, positions and statements. Signs nothing.
 *
 * Spend limits exist as an optional OpenZeppelin spending-limit policy on the operators'
 * USDC rule. They are off at launch; turning one on is an admin transaction, not a new
 * contract.
 */

export type OrganisationRole = "admin" | "operator" | "viewer";
export const ORGANISATION_ROLES: readonly OrganisationRole[] = ["admin", "operator", "viewer"];

export type MemberStatus = "invited" | "accepted" | "active" | "removing" | "removed";

/** What each role may do, as the app and the server enforce it (the chain enforces it too). */
export const ROLE_PERMISSIONS = {
  admin: { view: true, buyCover: true, provideLiquidity: true, withdrawToAnyAddress: true, manageMembers: true, changeSettings: true },
  operator: { view: true, buyCover: true, provideLiquidity: true, withdrawToAnyAddress: false, manageMembers: false, changeSettings: false },
  viewer: { view: true, buyCover: false, provideLiquidity: false, withdrawToAnyAddress: false, manageMembers: false, changeSettings: false },
} as const satisfies Record<OrganisationRole, Record<string, boolean>>;

export type Permission = keyof (typeof ROLE_PERMISSIONS)["admin"];

export function can(role: OrganisationRole | null | undefined, permission: Permission): boolean {
  return Boolean(role && ROLE_PERMISSIONS[role]?.[permission]);
}

export function isRole(value: unknown): value is OrganisationRole {
  return typeof value === "string" && (ORGANISATION_ROLES as readonly string[]).includes(value);
}

/** OpenZeppelin smart-account limits (stellar-accounts 0.8.0). */
export const MAX_SIGNERS_PER_RULE = 15;
export const MAX_RULE_NAME_BYTES = 20;

/** The names the app gives its rules; each fits the 20-byte limit. */
export const RULE_NAMES = {
  admins: "Admins",
  operatorsPool: "Operators: pool",
  operatorsRatePool: "Operators: rates",
  operatorsUsdc: "Operators: USDC",
} as const;

/** The on-chain ids of an organisation's rules. Operator rules exist only while it has operators. */
export interface OrganisationRuleIds {
  admins: number;
  operatorsPool: number | null;
  operatorsRatePool: number | null;
  operatorsUsdc: number | null;
}

export interface OrganisationContracts {
  currencyPool: string;
  /** The rate pool, when this deployment runs one. */
  ratePool: string | null;
  usdc: string;
  thresholdPolicy: string;
  transferAllowlistPolicy: string;
}

/** A member as the planner sees them: their passkey identity and role. */
export interface MemberSigner {
  memberId: number;
  role: OrganisationRole;
  /** Stable key for the passkey (its credential id), so two members never share one. */
  credentialId: string;
}

export type PlannedContext =
  | { tag: "Default" }
  | { tag: "CallContract"; contract: string };

export type PlannedPolicy =
  | { kind: "threshold"; policy: string; threshold: number }
  | { kind: "transferAllowlist"; policy: string; recipients: string[] };

/** One on-chain step. Each is its own transaction: the account allows one change per authorisation. */
export type ChainStep =
  | { op: "add_signer"; rule: keyof OrganisationRuleIds; credentialId: string }
  | { op: "remove_signer"; rule: keyof OrganisationRuleIds; credentialId: string }
  | {
      op: "add_context_rule";
      rule: Exclude<keyof OrganisationRuleIds, "admins">;
      name: string;
      context: PlannedContext;
      credentialIds: string[];
      policies: PlannedPolicy[];
    }
  | { op: "remove_context_rule"; rule: Exclude<keyof OrganisationRuleIds, "admins"> }
  | { op: "set_threshold"; rule: "admins"; threshold: number };

export class OrganisationRuleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

const fail = (code: string, message: string): never => {
  throw new OrganisationRuleError(code, message);
};

/** The rule a role's passkey sits on, for each target the role can sign for. */
function operatorRules(contracts: OrganisationContracts): Array<Exclude<keyof OrganisationRuleIds, "admins">> {
  return contracts.ratePool ? ["operatorsPool", "operatorsRatePool", "operatorsUsdc"] : ["operatorsPool", "operatorsUsdc"];
}

function operatorRuleSpec(rule: Exclude<keyof OrganisationRuleIds, "admins">, contracts: OrganisationContracts, credentialIds: string[]): ChainStep {
  const recipients = [contracts.currencyPool, ...(contracts.ratePool ? [contracts.ratePool] : [])];
  switch (rule) {
    case "operatorsPool":
      return { op: "add_context_rule", rule, name: RULE_NAMES.operatorsPool, context: { tag: "CallContract", contract: contracts.currencyPool }, credentialIds, policies: [{ kind: "threshold", policy: contracts.thresholdPolicy, threshold: 1 }] };
    case "operatorsRatePool":
      if (!contracts.ratePool) return fail("NO_RATE_POOL", "This deployment has no rate pool");
      return { op: "add_context_rule", rule, name: RULE_NAMES.operatorsRatePool, context: { tag: "CallContract", contract: contracts.ratePool! }, credentialIds, policies: [{ kind: "threshold", policy: contracts.thresholdPolicy, threshold: 1 }] };
    case "operatorsUsdc":
      // The allow-list policy also requires at least one authenticated signer, so no
      // threshold policy is needed: any one operator may pay a listed pool.
      return { op: "add_context_rule", rule, name: RULE_NAMES.operatorsUsdc, context: { tag: "CallContract", contract: contracts.usdc }, credentialIds, policies: [{ kind: "transferAllowlist", policy: contracts.transferAllowlistPolicy, recipients }] };
  }
}

export interface OrganisationState {
  ruleIds: OrganisationRuleIds;
  /** Members whose passkeys are on the account now (status active). */
  active: MemberSigner[];
  /** How many admins must approve an admin action (the admins rule's threshold). */
  adminApprovals: number;
  contracts: OrganisationContracts;
}

function countRole(state: OrganisationState, role: OrganisationRole) {
  return state.active.filter((m) => m.role === role).length;
}

/**
 * The steps that put a new member's passkey on the account for their role.
 * A viewer needs none. The first operator creates the operator rules.
 */
export function planAddMember(state: OrganisationState, member: MemberSigner): ChainStep[] {
  if (state.active.some((m) => m.credentialId === member.credentialId)) {
    fail("PASSKEY_IN_USE", "That passkey is already on this organisation's account");
  }
  if (member.role === "viewer") return [];
  if (member.role === "admin") {
    if (countRole(state, "admin") >= MAX_SIGNERS_PER_RULE) fail("TOO_MANY_ADMINS", `An organisation can have at most ${MAX_SIGNERS_PER_RULE} admins`);
    return [{ op: "add_signer", rule: "admins", credentialId: member.credentialId }];
  }
  if (countRole(state, "operator") >= MAX_SIGNERS_PER_RULE) fail("TOO_MANY_OPERATORS", `An organisation can have at most ${MAX_SIGNERS_PER_RULE} operators`);
  return operatorRules(state.contracts).map((rule) =>
    state.ruleIds[rule] === null
      ? operatorRuleSpec(rule, state.contracts, [member.credentialId])
      : ({ op: "add_signer", rule, credentialId: member.credentialId } as ChainStep),
  );
}

/**
 * The steps that take a member's passkey off the account.
 *
 * Refuses to remove the last admin: an account with no admin can never change again.
 * If removing an admin would leave fewer admins than the approvals setting, the
 * threshold is lowered first, in its own step, because OpenZeppelin's threshold policy
 * is not told when a rule's signers change.
 */
export function planRemoveMember(state: OrganisationState, member: MemberSigner): ChainStep[] {
  if (!state.active.some((m) => m.memberId === member.memberId)) {
    if (member.role === "viewer") return [];
    fail("NOT_ACTIVE", "That member is not on the account");
  }
  if (member.role === "viewer") return [];
  if (member.role === "admin") {
    const admins = countRole(state, "admin");
    if (admins <= 1) fail("LAST_ADMIN", "An organisation must keep at least one admin. Add another admin first.");
    const steps: ChainStep[] = [];
    if (state.adminApprovals > admins - 1) steps.push({ op: "set_threshold", rule: "admins", threshold: admins - 1 });
    steps.push({ op: "remove_signer", rule: "admins", credentialId: member.credentialId });
    return steps;
  }
  const lastOperator = countRole(state, "operator") === 1;
  return operatorRules(state.contracts).map((rule) =>
    lastOperator ? ({ op: "remove_context_rule", rule } as ChainStep) : ({ op: "remove_signer", rule, credentialId: member.credentialId } as ChainStep),
  );
}

/**
 * Changing a role adds the new access before taking away the old, so a member who is
 * the last admin is never left in between with nobody able to act.
 */
export function planChangeRole(state: OrganisationState, member: MemberSigner, to: OrganisationRole): ChainStep[] {
  if (member.role === to) return [];
  if (member.role === "admin" && countRole(state, "admin") <= 1) {
    fail("LAST_ADMIN", "An organisation must keep at least one admin. Make someone else an admin first.");
  }
  const add = planAddMember({ ...state, active: state.active.filter((m) => m.memberId !== member.memberId) }, { ...member, role: to });
  const remove = planRemoveMember(state, member);
  return [...add, ...remove];
}

/** Raise or lower how many admins must approve. Never above the number of admins. */
export function planSetAdminApprovals(state: OrganisationState, approvals: number): ChainStep[] {
  const admins = countRole(state, "admin");
  if (!Number.isInteger(approvals) || approvals < 1) fail("BAD_APPROVALS", "At least one approval is required");
  if (approvals > admins) fail("BAD_APPROVALS", `There are only ${admins} admins, so at most ${admins} approvals can be required`);
  return approvals === state.adminApprovals ? [] : [{ op: "set_threshold", rule: "admins", threshold: approvals }];
}

/**
 * Which rule each authorisation context should be checked against.
 *
 * OpenZeppelin's account matches each context of an authorisation (the call itself, then
 * every nested call it authorises, depth first) to the rule the signer names, position by
 * position. A purchase of cover is two contexts: the pool call and the USDC premium
 * transfer inside it. An admin names the Default rule for all of them; an operator names
 * the scoped rule for each target, and anything outside those targets is refused here
 * rather than failing on chain.
 */
export function contextRuleIdsFor(role: OrganisationRole, targets: readonly string[], ruleIds: OrganisationRuleIds, contracts: OrganisationContracts): number[] {
  if (targets.length === 0) fail("NO_CONTEXTS", "Nothing to authorise");
  if (role === "viewer") return fail("VIEWER_CANNOT_SIGN", "Viewers can see the account but cannot approve anything");
  if (role === "admin") return targets.map(() => ruleIds.admins);
  return targets.map((target) => {
    const rule = target === contracts.currencyPool ? ruleIds.operatorsPool
      : contracts.ratePool && target === contracts.ratePool ? ruleIds.operatorsRatePool
      : target === contracts.usdc ? ruleIds.operatorsUsdc
      : null;
    if (rule === null || rule === undefined) return fail("OUTSIDE_OPERATOR_SCOPE", "Operators can only buy cover and manage liquidity. Ask an admin for anything else.");
    return rule;
  });
}

/** Organisation names: what people type when creating one. */
export function validateOrganisationName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (trimmed.length < 2) fail("BAD_NAME", "Enter the organisation's name");
  if (trimmed.length > 80) fail("BAD_NAME", "Keep the name under 80 characters");
  return trimmed;
}
