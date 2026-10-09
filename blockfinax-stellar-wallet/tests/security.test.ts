import { test } from "node:test";
import assert from "node:assert/strict";
import { Challenges, issueSession, readSession } from "../server/security.js";
import { Store } from "../server/store.js";
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { inspectPayment } from "../server/policy.js";
const secret = "a".repeat(64);
test("sessions reject tampering and other signing keys", async () => {
  const token = await issueSession("alice", secret);
  assert.equal(await readSession(token, secret), "alice");
  await assert.rejects(() => readSession(token, "b".repeat(64)));
  await assert.rejects(() => readSession(token.slice(0, -5) + "xxxxx", secret));
});
test("a challenge is consumed once, including failed verification attempts", () => {
  const store = new Challenges();
  store.put("alice", "challenge");
  assert.equal(store.take("alice"), "challenge");
  assert.throws(() => store.take("alice"));
});
test("wallets cannot be reassigned", () => {
  const db = new Store(":memory:");
  db.db
    .prepare("INSERT INTO wallets VALUES(?,?,?,?,?,?)")
    .run("alice", "C-wallet", "credential", "key", 0, "[]");
  assert.throws(() =>
    db.db
      .prepare("INSERT INTO wallets VALUES(?,?,?,?,?,?)")
      .run("bob", "C-wallet", "credential2", "key", 0, "[]"),
  );
  db.db.close();
});
const from = Address.contract(Buffer.alloc(32, 1)).toString();
const other = Address.contract(Buffer.alloc(32, 2)).toString();
const token = Asset.native().contractId(Networks.TESTNET);
const source = Keypair.random().publicKey();
function envelope(
  sender = from,
  to = other,
  amount = 10000000n,
  target = token,
  method = "transfer",
  authorization = from,
) {
  const invocation = new xdr.InvokeContractArgs({
    contractAddress: new Address(target).toScAddress(),
    functionName: method,
    args: [
      new Address(sender).toScVal(),
      new Address(to).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    ],
  });
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: new Address(authorization).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 1000,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          invocation,
        ),
      subInvocations: [],
    }),
  });
  return new TransactionBuilder(new Account(source, "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(invocation),
        auth: [auth],
      }),
    )
    .setTimeout(30)
    .build()
    .toXDR();
}
test("sponsorship accepts only the signed wallet approved token transfer", () => {
  assert.equal(
    inspectPayment(envelope(), Networks.TESTNET, from, token).amount,
    10000000n,
  );
  for (const bad of [
    envelope(other),
    envelope(from, other, -1n),
    envelope(from, other, 1001_0000000n),
    envelope(from, other, 1n, other),
    envelope(from, other, 1n, token, "mint"),
    envelope(from, other, 1n, token, "transfer", other),
    envelope(from, from),
  ])
    assert.throws(() => inspectPayment(bad, Networks.TESTNET, from, token));
});
