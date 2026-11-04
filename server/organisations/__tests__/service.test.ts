import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChainStep, OrganisationRuleIds } from "@shared/organisations";
import { InMemoryOrganisationRepository } from "../repository";
import { OrganisationError, OrganisationService, type OrganisationGateway, type PasskeyIdentity } from "../service";

const contracts = { currencyPool: "CPOOL", ratePool: null, usdc: "CUSDC", thresholdPolicy: "CTHRESH", transferAllowlistPolicy: "CALLOW" };

function world(opts: { confirmFails?: boolean } = {}) {
  const repo = new InMemoryOrganisationRepository();
  const users = new Map<number, { email: string; passkey: PasskeyIdentity | null }>();
  const prepared: ChainStep[] = [];
  let nextRule = 1;
  const gateway: OrganisationGateway = {
    networkKey: "stellar-testnet",
    contracts: () => contracts,
    signerFor: (p) => ({ tag: "External", values: ["CVERIFIER", Buffer.concat([p.publicKey, Buffer.from(p.credentialId)])] }),
    deploy: async (id) => ({ contract: `CORG${id}`, wasmHash: "c514" }),
    prepare: async (_a: string, _r: OrganisationRuleIds, step: ChainStep, signerFor) => {
      if ("credentialId" in step) signerFor(step.credentialId);
      prepared.push(step);
      return `xdr:${step.op}:${step.rule}`;
    },
    confirm: async (_a, _r, step) => (opts.confirmFails ? { ok: false, reason: "not on chain" } : { ok: true, ruleId: step.op === "add_context_rule" ? nextRule++ : undefined }),
  };
  const service = new OrganisationService(repo, gateway, {
    passkeyOf: async (id) => users.get(id)?.passkey ?? null,
    emailOf: async (id) => users.get(id)?.email ?? null,
  });
  const user = (id: number, email: string, withPasskey = true) =>
    users.set(id, { email, passkey: withPasskey ? { credentialId: `cred-${id}`, publicKey: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, id)]) } : null });
  return { repo, service, user, prepared, users };
}

const H = (n: number) => n.toString(16).padStart(64, "0");
async function code(p: Promise<unknown>) {
  try { await p; return "NO_ERROR"; } catch (e) { if (e instanceof OrganisationError) return e.code; throw e; }
}

/** Run every pending step of a change to the end. */
async function approveAll(s: OrganisationService, admin: number, org: number, memberId: number, first: unknown) {
  let r = first as { done?: boolean; stepsLeft?: number };
  let n = 0;
  while (!r.done) r = (await s.confirm(admin, org, memberId, H(++n))) as typeof r;
  return r as { done: true; member: { status: string; role: string } };
}

async function setup() {
  const w = world();
  w.user(1, "founder@acme.ng");
  const org = await w.service.create(1, "Acme Imports Ltd");
  return { ...w, org };
}

async function addMember(w: Awaited<ReturnType<typeof setup>>, id: number, email: string, role: "admin" | "operator" | "viewer") {
  w.user(id, email);
  const { member, token } = await w.service.invite(1, w.org.id, { email, role });
  await w.service.accept(id, token);
  if (role !== "viewer") await approveAll(w.service, 1, w.org.id, member.id, await w.service.start(1, w.org.id, member.id, { kind: "activate" }));
  return member.id;
}

test("creating an organisation deploys its account with the creator as the only admin", async () => {
  const { org } = await setup();
  assert.equal(org.status, "active");
  assert.equal(org.account, "CORG1");
  assert.equal(org.myRole, "admin");
  assert.deepEqual(org.members.map((m) => [m.email, m.role, m.status]), [["founder@acme.ng", "admin", "active"]]);
});

test("one person can create only a few business accounts", async () => {
  const w = world();
  w.user(1, "founder@acme.ng");
  for (let i = 0; i < 3; i++) await w.service.create(1, `Business ${i + 1}`);
  assert.equal(await code(w.service.create(1, "Business 4")), "TOO_MANY_ORGANISATIONS");
});

test("creating an organisation needs a passkey", async () => {
  const w = world();
  w.user(1, "a@b.co", false);
  assert.equal(await code(w.service.create(1, "Acme")), "NO_PASSKEY");
});

test("only admins invite, and invitations are checked", async () => {
  const w = await setup();
  await addMember(w, 2, "ops@acme.ng", "operator");
  assert.equal(await code(w.service.invite(2, w.org.id, { email: "x@acme.ng", role: "viewer" })), "NOT_ALLOWED");
  assert.equal(await code(w.service.invite(1, w.org.id, { email: "not-an-email", role: "viewer" })), "BAD_EMAIL");
  assert.equal(await code(w.service.invite(1, w.org.id, { email: "x@acme.ng", role: "owner" })), "BAD_ROLE");
  assert.equal(await code(w.service.invite(1, w.org.id, { email: "OPS@acme.ng", role: "viewer" })), "ALREADY_MEMBER");
  assert.equal(await code(w.service.invite(99, w.org.id, { email: "x@acme.ng", role: "viewer" })), "NOT_A_MEMBER");
});

test("an invitation works once, only for the invited email, and expires", async () => {
  const w = await setup();
  w.user(3, "someone.else@gmail.com");
  w.user(4, "ops@acme.ng");
  const { token } = await w.service.invite(1, w.org.id, { email: "ops@acme.ng", role: "operator" });
  assert.equal(await code(w.service.accept(3, token)), "WRONG_ACCOUNT", "a forwarded link is useless");
  assert.deepEqual(await w.service.accept(4, token), { organisationId: w.org.id, status: "accepted" });
  assert.equal(await code(w.service.accept(4, token)), "BAD_INVITE", "single use");

  const late = await w.service.invite(1, w.org.id, { email: "late@acme.ng", role: "viewer" });
  const expired = new OrganisationService(w.repo, (w.service as any).gateway, (w.service as any).passkeys, () => new Date(Date.now() + 8 * 86_400_000));
  w.user(5, "late@acme.ng");
  assert.equal(await code(expired.accept(5, late.token)), "INVITE_EXPIRED");
});

test("a viewer is active as soon as they accept, with nothing on chain", async () => {
  const w = await setup();
  await addMember(w, 2, "accounts@acme.ng", "viewer");
  const view = await w.service.view(2, w.org.id);
  assert.equal(view.myRole, "viewer");
  assert.equal(w.prepared.length, 0);
  assert.equal(await code(w.service.invite(2, w.org.id, { email: "x@acme.ng", role: "viewer" })), "NOT_ALLOWED");
});

test("activating the first operator creates their rules and records the rule ids", async () => {
  const w = await setup();
  await addMember(w, 2, "ops@acme.ng", "operator");
  assert.deepEqual(w.prepared.map((s) => s.op), ["add_context_rule", "add_context_rule"]);
  const acting = await w.service.acting(2, w.org.id);
  assert.equal(acting.role, "operator");
  assert.deepEqual(acting.ruleIds, { admins: 0, operatorsPool: 1, operatorsRatePool: null, operatorsUsdc: 2 });
});

test("a second operator is added to the existing rules", async () => {
  const w = await setup();
  await addMember(w, 2, "ops@acme.ng", "operator");
  w.prepared.length = 0;
  await addMember(w, 3, "ops2@acme.ng", "operator");
  assert.deepEqual(w.prepared.map((s) => s.op), ["add_signer", "add_signer"]);
});

test("someone accepted but not yet activated cannot act", async () => {
  const w = await setup();
  w.user(2, "ops@acme.ng");
  const { token } = await w.service.invite(1, w.org.id, { email: "ops@acme.ng", role: "operator" });
  await w.service.accept(2, token);
  assert.equal(await code(w.service.acting(2, w.org.id)), "NOT_A_MEMBER");
});

test("removing a member cuts their access before the chain steps finish", async () => {
  const w = await setup();
  const op = await addMember(w, 2, "ops@acme.ng", "operator");
  const first = await w.service.start(1, w.org.id, op, { kind: "remove" });
  assert.equal(await code(w.service.acting(2, w.org.id)), "NOT_A_MEMBER", "access ends at once");
  const done = await approveAll(w.service, 1, w.org.id, op, first);
  assert.equal(done.member.status, "removed");
  assert.deepEqual((await w.service.acting(1, w.org.id)).ruleIds, { admins: 0, operatorsPool: null, operatorsRatePool: null, operatorsUsdc: null }, "last operator's rules are gone");
});

test("the last admin cannot be removed or demoted", async () => {
  const w = await setup();
  const me = (await w.service.view(1, w.org.id)).members[0].id;
  assert.equal(await code(w.service.start(1, w.org.id, me, { kind: "remove" })), "LAST_ADMIN");
  assert.equal(await code(w.service.start(1, w.org.id, me, { kind: "role", role: "viewer" })), "LAST_ADMIN");
  assert.equal((await w.service.acting(1, w.org.id)).role, "admin", "nothing changed");
});

test("only one change runs at a time", async () => {
  const w = await setup();
  w.user(2, "a@acme.ng"); w.user(3, "b@acme.ng");
  const a = await w.service.invite(1, w.org.id, { email: "a@acme.ng", role: "admin" });
  const b = await w.service.invite(1, w.org.id, { email: "b@acme.ng", role: "admin" });
  await w.service.accept(2, a.token); await w.service.accept(3, b.token);
  await w.service.start(1, w.org.id, a.member.id, { kind: "activate" });
  assert.equal(await code(w.service.start(1, w.org.id, b.member.id, { kind: "activate" })), "CHANGE_IN_PROGRESS");
});

test("a step the chain does not show is not marked done", async () => {
  const w = world({ confirmFails: true });
  w.user(1, "f@acme.ng"); w.user(2, "a@acme.ng");
  const org = await w.service.create(1, "Acme");
  const { member, token } = await w.service.invite(1, org.id, { email: "a@acme.ng", role: "admin" });
  await w.service.accept(2, token);
  await w.service.start(1, org.id, member.id, { kind: "activate" });
  assert.equal(await code(w.service.confirm(1, org.id, member.id, H(1))), "NOT_CONFIRMED");
  assert.equal(await code(w.service.confirm(1, org.id, member.id, "not-a-hash")), "BAD_HASH");
  assert.equal((await w.service.view(1, org.id)).members.find((m) => m.id === member.id)?.pending?.stepsLeft, 1);
});

test("promoting a viewer looks up their passkey, then puts it on the account", async () => {
  const w = await setup();
  const viewer = await addMember(w, 2, "accounts@acme.ng", "viewer");
  const done = await approveAll(w.service, 1, w.org.id, viewer, await w.service.start(1, w.org.id, viewer, { kind: "role", role: "admin" }));
  assert.equal(done.member.role, "admin");
  assert.deepEqual(w.prepared.at(-1), { op: "add_signer", rule: "admins", credentialId: "cred-2" });
});

test("an invitation not yet on the account can be withdrawn", async () => {
  const w = await setup();
  const { member, token } = await w.service.invite(1, w.org.id, { email: "x@acme.ng", role: "operator" });
  await w.service.revokeInvite(1, w.org.id, member.id);
  w.user(5, "x@acme.ng");
  assert.equal(await code(w.service.accept(5, token)), "BAD_INVITE");
});

test("the history records each change with its transaction", async () => {
  const w = await setup();
  await addMember(w, 2, "ops@acme.ng", "operator");
  const kinds = (await w.service.history(1, w.org.id)).map((e) => e.kind);
  for (const k of ["created", "account_deployed", "invited", "accepted", "activate_started", "step_confirmed", "activated"]) assert.ok(kinds.includes(k), k);
});
