import { test } from "node:test";
import assert from "node:assert/strict";
import {
  can, contextRuleIdsFor, planAddMember, planChangeRole, planRemoveMember, planSetAdminApprovals,
  validateOrganisationName, OrganisationRuleError, RULE_NAMES, MAX_RULE_NAME_BYTES,
  type MemberSigner, type OrganisationContracts, type OrganisationState,
} from "../organisations";

const contracts: OrganisationContracts = {
  currencyPool: "CPOOL", ratePool: "CRATE", usdc: "CUSDC", thresholdPolicy: "CTHRESH", transferAllowlistPolicy: "CALLOW",
};
const admin = (id: number): MemberSigner => ({ memberId: id, role: "admin", credentialId: `cred-${id}` });
const operator = (id: number): MemberSigner => ({ memberId: id, role: "operator", credentialId: `cred-${id}` });
const viewer = (id: number): MemberSigner => ({ memberId: id, role: "viewer", credentialId: `cred-${id}` });

function state(active: MemberSigner[], extra: Partial<OrganisationState> = {}): OrganisationState {
  const hasOps = active.some((m) => m.role === "operator");
  return {
    ruleIds: { admins: 0, operatorsPool: hasOps ? 1 : null, operatorsRatePool: hasOps ? 2 : null, operatorsUsdc: hasOps ? 3 : null },
    active, adminApprovals: 1, contracts, ...extra,
  };
}

const code = (fn: () => unknown) => {
  try { fn(); } catch (e) { if (e instanceof OrganisationRuleError) return e.code; throw e; }
  return "NO_ERROR";
};

test("permissions: only admins withdraw or manage members; viewers sign nothing", () => {
  assert.equal(can("admin", "withdrawToAnyAddress"), true);
  assert.equal(can("operator", "withdrawToAnyAddress"), false);
  assert.equal(can("operator", "buyCover"), true);
  assert.equal(can("operator", "manageMembers"), false);
  assert.equal(can("viewer", "buyCover"), false);
  assert.equal(can("viewer", "view"), true);
  assert.equal(can(null, "view"), false);
});

test("rule names fit the 20-byte on-chain limit", () => {
  for (const name of Object.values(RULE_NAMES)) assert.ok(Buffer.byteLength(name, "utf8") <= MAX_RULE_NAME_BYTES, name);
});

test("adding an admin is one signer on the admins rule", () => {
  assert.deepEqual(planAddMember(state([admin(1)]), admin(2)), [{ op: "add_signer", rule: "admins", credentialId: "cred-2" }]);
});

test("adding a viewer touches nothing on chain", () => {
  assert.deepEqual(planAddMember(state([admin(1)]), viewer(9)), []);
});

test("the first operator creates the scoped rules, with the allow-list on USDC", () => {
  const steps = planAddMember(state([admin(1)]), operator(2));
  assert.deepEqual(steps.map((s) => s.op), ["add_context_rule", "add_context_rule", "add_context_rule"]);
  const usdc = steps.find((s) => s.op === "add_context_rule" && s.rule === "operatorsUsdc");
  assert.ok(usdc && usdc.op === "add_context_rule");
  assert.deepEqual(usdc.context, { tag: "CallContract", contract: "CUSDC" });
  assert.deepEqual(usdc.policies, [{ kind: "transferAllowlist", policy: "CALLOW", recipients: ["CPOOL", "CRATE"] }]);
  const pool = steps.find((s) => s.op === "add_context_rule" && s.rule === "operatorsPool");
  assert.ok(pool && pool.op === "add_context_rule");
  assert.deepEqual(pool.policies, [{ kind: "threshold", policy: "CTHRESH", threshold: 1 }], "any one operator may act");
});

test("without a rate pool, operators get only the pool and USDC rules", () => {
  const s = state([admin(1)], { contracts: { ...contracts, ratePool: null } });
  const steps = planAddMember(s, operator(2));
  assert.deepEqual(steps.map((x) => (x as { rule: string }).rule), ["operatorsPool", "operatorsUsdc"]);
  const usdc = steps.find((x) => (x as { rule: string }).rule === "operatorsUsdc");
  assert.ok(usdc && usdc.op === "add_context_rule");
  assert.deepEqual((usdc.policies[0] as { recipients: string[] }).recipients, ["CPOOL"]);
});

test("later operators are added to the existing rules", () => {
  const steps = planAddMember(state([admin(1), operator(2)]), operator(3));
  assert.deepEqual(steps, [
    { op: "add_signer", rule: "operatorsPool", credentialId: "cred-3" },
    { op: "add_signer", rule: "operatorsRatePool", credentialId: "cred-3" },
    { op: "add_signer", rule: "operatorsUsdc", credentialId: "cred-3" },
  ]);
});

test("one passkey cannot belong to two members", () => {
  assert.equal(code(() => planAddMember(state([admin(1)]), { memberId: 2, role: "operator", credentialId: "cred-1" })), "PASSKEY_IN_USE");
});

test("the last admin can never be removed", () => {
  assert.equal(code(() => planRemoveMember(state([admin(1), operator(2)]), admin(1))), "LAST_ADMIN");
});

test("removing an admin lowers the approvals first when they would exceed the admins left", () => {
  const steps = planRemoveMember(state([admin(1), admin(2)], { adminApprovals: 2 }), admin(2));
  assert.deepEqual(steps, [
    { op: "set_threshold", rule: "admins", threshold: 1 },
    { op: "remove_signer", rule: "admins", credentialId: "cred-2" },
  ]);
});

test("removing an admin keeps the approvals when enough admins remain", () => {
  const steps = planRemoveMember(state([admin(1), admin(2), admin(3)], { adminApprovals: 2 }), admin(3));
  assert.deepEqual(steps, [{ op: "remove_signer", rule: "admins", credentialId: "cred-3" }]);
});

test("removing the last operator removes the operator rules entirely", () => {
  const steps = planRemoveMember(state([admin(1), operator(2)]), operator(2));
  assert.deepEqual(steps.map((s) => s.op), ["remove_context_rule", "remove_context_rule", "remove_context_rule"]);
});

test("removing one of several operators removes only their passkey", () => {
  const steps = planRemoveMember(state([admin(1), operator(2), operator(3)]), operator(3));
  assert.ok(steps.every((s) => s.op === "remove_signer" && s.credentialId === "cred-3"));
  assert.equal(steps.length, 3);
});

test("changing a role adds the new access before removing the old", () => {
  const steps = planChangeRole(state([admin(1), admin(2)]), admin(2), "operator");
  assert.equal(steps[0].op, "add_context_rule");
  assert.deepEqual(steps.at(-1), { op: "remove_signer", rule: "admins", credentialId: "cred-2" });
});

test("the last admin cannot be demoted", () => {
  assert.equal(code(() => planChangeRole(state([admin(1)]), admin(1), "viewer")), "LAST_ADMIN");
});

test("approvals can never exceed the number of admins", () => {
  assert.equal(code(() => planSetAdminApprovals(state([admin(1)]), 2)), "BAD_APPROVALS");
  assert.equal(code(() => planSetAdminApprovals(state([admin(1)]), 0)), "BAD_APPROVALS");
  assert.deepEqual(planSetAdminApprovals(state([admin(1), admin(2)]), 2), [{ op: "set_threshold", rule: "admins", threshold: 2 }]);
  assert.deepEqual(planSetAdminApprovals(state([admin(1), admin(2)]), 1), []);
});

test("an admin signs every context under the admins rule", () => {
  const s = state([admin(1), operator(2)]);
  assert.deepEqual(contextRuleIdsFor("admin", ["CPOOL", "CUSDC"], s.ruleIds, contracts), [0, 0]);
  assert.deepEqual(contextRuleIdsFor("admin", ["CUSDC"], s.ruleIds, contracts), [0], "withdrawals are admin business");
});

test("an operator buying cover names the pool rule, then the USDC rule", () => {
  const s = state([admin(1), operator(2)]);
  assert.deepEqual(contextRuleIdsFor("operator", ["CPOOL", "CUSDC"], s.ruleIds, contracts), [1, 3]);
  assert.deepEqual(contextRuleIdsFor("operator", ["CRATE", "CUSDC"], s.ruleIds, contracts), [2, 3]);
});

test("an operator cannot sign for anything outside their scope", () => {
  const s = state([admin(1), operator(2)]);
  assert.equal(code(() => contextRuleIdsFor("operator", ["COTHER"], s.ruleIds, contracts)), "OUTSIDE_OPERATOR_SCOPE");
  assert.equal(code(() => contextRuleIdsFor("operator", ["CPOOL", "COTHER"], s.ruleIds, contracts)), "OUTSIDE_OPERATOR_SCOPE");
});

test("an operator cannot sign before the operator rules exist", () => {
  const s = state([admin(1)]);
  assert.equal(code(() => contextRuleIdsFor("operator", ["CPOOL"], s.ruleIds, contracts)), "OUTSIDE_OPERATOR_SCOPE");
});

test("viewers cannot sign at all", () => {
  assert.equal(code(() => contextRuleIdsFor("viewer", ["CPOOL"], state([admin(1)]).ruleIds, contracts)), "VIEWER_CANNOT_SIGN");
});

test("organisation names are trimmed and bounded", () => {
  assert.equal(validateOrganisationName("  Acme   Imports  Ltd "), "Acme Imports Ltd");
  assert.equal(code(() => validateOrganisationName("A")), "BAD_NAME");
  assert.equal(code(() => validateOrganisationName("x".repeat(81))), "BAD_NAME");
});
