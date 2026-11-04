/**
 * What the sponsored relay will send for an organisation account, by role. The chain
 * enforces the same rules through the account's context rules; this is the second layer,
 * so a request a role may not make fails before anyone pays for it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Account, Address, Keypair, Operation, StrKey, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { inspectPoolCall, type ExtraContractPolicy } from "../stellar-relay";
import { ACCOUNT_ADMIN_FUNCTIONS } from "@shared/smart-accounts";

const NP = "Test SDF Network ; September 2015";
const c = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const ORG = c(7);
const USDC = c(1);
const POOL = c(4);
const OUTSIDER = c(9);

/** One contract call, authorised by `wallet`, as the relay receives it. */
function envelope(target: string, fn: string, args: xdr.ScVal[], wallet = ORG) {
  const op = Operation.invokeContractFunction({ contract: target, function: fn, args });
  const invoke = (op as any).body().invokeHostFunctionOp().hostFunction().invokeContract();
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: Address.fromString(wallet).toScAddress(), nonce: xdr.Int64.fromString("1"), signatureExpirationLedger: 10, signature: xdr.ScVal.scvVoid(),
    } as any)),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invoke), subInvocations: [] }),
  });
  return new TransactionBuilder(new Account(Keypair.random().publicKey(), "1"), { fee: "100", networkPassphrase: NP })
    .addOperation(Operation.invokeContractFunction({ contract: target, function: fn, args, auth: [auth] })).setTimeout(60).build().toXDR();
}

const addr = (a: string) => nativeToScVal(a, { type: "address" });
const amount = (n: number) => nativeToScVal(BigInt(n), { type: "i128" });
const withdraw = () => envelope(USDC, "transfer", [addr(ORG), addr(OUTSIDER), amount(5)]);
const approve = () => envelope(USDC, "approve", [addr(ORG), addr(OUTSIDER), amount(5), nativeToScVal(100, { type: "u32" })]);
const deposit = () => envelope(POOL, "deposit", [nativeToScVal(1, { type: "u32" }), addr(ORG), amount(5)]);
const accountCall = (fn: string) => envelope(ORG, fn, [nativeToScVal(0, { type: "u32" })]);

/** The extra contracts the adapter allows an organisation admin: the account's own admin functions. */
const adminExtra: ExtraContractPolicy[] = [{ contract: ORG, methods: new Set(ACCOUNT_ADMIN_FUNCTIONS), walletArg: {}, permissionless: new Set() }];
const operatorAllow = { tokenTransfers: false, tokenApprovals: false };

test("personal wallets keep today's behaviour: a transfer out is relayed", () => {
  assert.ok(inspectPoolCall(withdraw(), NP, ORG, POOL, [USDC]));
});

test("an operator cannot send money out or approve an allowance", () => {
  assert.throws(() => inspectPoolCall(withdraw(), NP, ORG, POOL, [USDC], [], [], operatorAllow), /cannot send money out/);
  assert.throws(() => inspectPoolCall(approve(), NP, ORG, POOL, [USDC], [], [OUTSIDER], operatorAllow), /cannot approve/);
});

test("an operator can deposit into a pool from the organisation account", () => {
  assert.ok(inspectPoolCall(deposit(), NP, ORG, POOL, [USDC], [], [], operatorAllow));
});

test("an operator cannot change the account", () => {
  assert.throws(() => inspectPoolCall(accountCall("add_signer"), NP, ORG, POOL, [USDC], [], [], operatorAllow), /not approved/);
});

test("an admin can withdraw and change the account", () => {
  assert.ok(inspectPoolCall(withdraw(), NP, ORG, POOL, [USDC], adminExtra));
  for (const fn of ["add_signer", "remove_signer", "add_context_rule", "remove_context_rule"]) {
    assert.ok(inspectPoolCall(accountCall(fn), NP, ORG, POOL, [USDC], adminExtra), fn);
  }
});

test("nobody can upgrade the account or run arbitrary execution through the relay", () => {
  assert.throws(() => inspectPoolCall(accountCall("upgrade"), NP, ORG, POOL, [USDC], adminExtra), /not approved/);
  assert.throws(() => inspectPoolCall(accountCall("execute"), NP, ORG, POOL, [USDC], adminExtra), /not approved/);
});

test("a call must be authorised by the account it acts for", () => {
  const someoneElse = envelope(POOL, "deposit", [nativeToScVal(1, { type: "u32" }), addr(ORG), amount(5)], OUTSIDER);
  assert.throws(() => inspectPoolCall(someoneElse, NP, ORG, POOL, [USDC], [], [], operatorAllow), /authorized by your connected wallet/);
});
