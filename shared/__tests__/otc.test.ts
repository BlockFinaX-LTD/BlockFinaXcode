/**
 * OTC amounts, roles and the relay rule for the escrow.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Account, Address, Keypair, Operation, StrKey, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { fromUnits, localAmount, otcErrorMessage, OTC_USER_METHODS, OTC_WALLET_ARG, roleIn, sideFromCode, statusFromCode, toUnits } from "../otc";
import { inspectPoolCall } from "../../server/chain/stellar-relay";

test("amounts convert exactly and refuse anything odd", () => {
  assert.equal(toUnits("25", 7), BigInt(250_000_000));
  assert.equal(toUnits("0.0000001", 7), BigInt(1));
  assert.equal(toUnits("1.123456789", 7), BigInt(11_234_567)); // extra decimals are dropped, never rounded up
  assert.equal(fromUnits(BigInt(250_000_000), 7), "25");
  assert.equal(fromUnits(BigInt(1_520_500_000), 6), "1520.5");
  for (const bad of ["-1", "1e5", "abc", "", "1.2.3"]) assert.throws(() => toUnits(bad, 7));
});

test("the local amount is USDC times the rate, to the kobo", () => {
  assert.equal(localAmount("250", "1520"), "380000");
  assert.equal(localAmount("1.5", "1520.25"), "2280.38"); // 2280.375 rounds half up
  assert.equal(localAmount("0.0000001", "1520"), "0");
});

test("chain codes map to words", () => {
  assert.equal(sideFromCode(0), "sell");
  assert.equal(sideFromCode(1), "buy");
  assert.equal(statusFromCode(4), "disputed");
  assert.equal(statusFromCode(6), "resolved_refunded");
  assert.equal(otcErrorMessage("HostError: Error(Contract, #14)"), "The buyer still has time to pay");
  assert.equal(otcErrorMessage("something else"), null);
});

test("who releases and who pays", () => {
  const order = { usdcFrom: "MERCHANT", usdcTo: "USER" };
  assert.deepEqual(roleIn(order, "MERCHANT"), { releases: true, pays: false });
  assert.deepEqual(roleIn(order, "USER"), { releases: false, pays: true });
  assert.deepEqual(roleIn(order, "OTHER"), { releases: false, pays: false });
});

// ── Relay ──

const NP = "Test SDF Network ; September 2015";
const c = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const ME = c(7);
const SOMEONE = c(8);
const OTC = c(5);
const POOL = c(4);

function envelope(fn: string, args: xdr.ScVal[], signer = ME) {
  const op = Operation.invokeContractFunction({ contract: OTC, function: fn, args });
  const invoke = (op as any).body().invokeHostFunctionOp().hostFunction().invokeContract();
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: Address.fromString(signer).toScAddress(), nonce: xdr.Int64.fromString("1"), signatureExpirationLedger: 10, signature: xdr.ScVal.scvVoid(),
    } as any)),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invoke), subInvocations: [] }),
  });
  return new TransactionBuilder(new Account(Keypair.random().publicKey(), "1"), { fee: "100", networkPassphrase: NP })
    .addOperation(Operation.invokeContractFunction({ contract: OTC, function: fn, args, auth: [auth] })).setTimeout(60).build().toXDR();
}

const addr = (a: string) => nativeToScVal(a, { type: "address" });
const u64 = (n: number) => nativeToScVal(BigInt(n), { type: "u64" });
const i128 = (n: number) => nativeToScVal(BigInt(n), { type: "i128" });
const otcPolicy = [{ contract: OTC, methods: new Set<string>(OTC_USER_METHODS), walletArg: OTC_WALLET_ARG, permissionless: new Set<string>() }];

test("the relay sends a user's own escrow calls", () => {
  assert.ok(inspectPoolCall(envelope("open_order", [addr(ME), u64(1), i128(10)]), NP, ME, POOL, [], otcPolicy));
  assert.ok(inspectPoolCall(envelope("release", [u64(1)]), NP, ME, POOL, [], otcPolicy));
  assert.ok(inspectPoolCall(envelope("cancel", [addr(ME), u64(1)]), NP, ME, POOL, [], otcPolicy));
});

test("the relay refuses escrow calls naming someone else, signed by someone else, or the owner's functions", () => {
  assert.throws(() => inspectPoolCall(envelope("open_order", [addr(SOMEONE), u64(1), i128(10)]), NP, ME, POOL, [], otcPolicy), /connected wallet/);
  assert.throws(() => inspectPoolCall(envelope("dispute", [addr(SOMEONE), u64(1)]), NP, ME, POOL, [], otcPolicy), /connected wallet/);
  assert.throws(() => inspectPoolCall(envelope("release", [u64(1)], SOMEONE), NP, ME, POOL, [], otcPolicy), /authorized by your connected wallet/);
  for (const fn of ["resolve", "set_merchant", "upgrade", "set_fee", "withdraw_fees", "set_paused"]) {
    assert.throws(() => inspectPoolCall(envelope(fn, [u64(1)]), NP, ME, POOL, [], otcPolicy), /not approved/);
  }
});

test("business operators may only buy USDC through the relay; admins may do everything", async () => {
  const { OTC_OPERATOR_METHODS } = await import("../otc");
  const operatorPolicy = [{ contract: OTC, methods: new Set<string>(OTC_OPERATOR_METHODS), walletArg: OTC_WALLET_ARG, permissionless: new Set<string>() }];
  const operatorAllow = { tokenTransfers: false, tokenApprovals: false };
  assert.ok(inspectPoolCall(envelope("open_order", [addr(ME), u64(1), i128(10)]), NP, ME, POOL, [], operatorPolicy, [], operatorAllow));
  assert.ok(inspectPoolCall(envelope("mark_paid", [u64(1)]), NP, ME, POOL, [], operatorPolicy, [], operatorAllow));
  for (const fn of ["release", "create_offer", "close_offer", "withdraw_from_offer", "update_offer"]) {
    assert.throws(() => inspectPoolCall(envelope(fn, [u64(1)]), NP, ME, POOL, [], operatorPolicy, [], operatorAllow), /not approved/, fn);
  }
});

test("payment methods: bank and mobile money are checked and tidied", async () => {
  const { parsePaymentMethod, describeMethod } = await import("../otc");
  assert.deepEqual(parsePaymentMethod({ type: "bank", bankName: " GTBank ", accountNumber: "0123 456 789", accountName: "Ada  Ltd" }),
    { type: "bank", bankName: "GTBank", accountNumber: "0123456789", accountName: "Ada Ltd" });
  assert.deepEqual(parsePaymentMethod({ type: "momo", provider: "MTN MoMo", phone: "+233 24-123-4567", accountName: "Kofi" }),
    { type: "momo", provider: "MTN MoMo", phone: "+233241234567", accountName: "Kofi" });
  assert.throws(() => parsePaymentMethod({ type: "bank", bankName: "GTBank", accountNumber: "", accountName: "Ada" }), /account number/);
  assert.throws(() => parsePaymentMethod({ type: "momo", provider: "MTN MoMo", phone: "call me", accountName: "Kofi" }), /mobile money number/);
  assert.throws(() => parsePaymentMethod({ type: "cash" }), /bank transfer or mobile money/);
  assert.equal(describeMethod({ type: "momo", provider: "M-Pesa", phone: "+254700000000", accountName: "Wanjiku" }), "M-Pesa · +254700000000 · Wanjiku");
});
