import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { createRequire } from "node:module";
import { Address, Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import { computeEntryAuthDigest } from "smart-account-kit";
import {
  authContextTargets, compactLowS, credentialIdOf, fromBase64Url, OZ_ACCOUNT_WASM_HASH, passkeySignatureBytes, passkeySigner, signOrganisationEntry,
  spendingLimitParams, thresholdParams, toBase64Url, transferAllowlistParams, uncompressedKey, webauthnKeyData,
} from "../smart-accounts";
import { readAuthPayload } from "../vendor/oz-auth-payload";
import { softwarePasskey } from "../testing/software-passkey";

const NETWORK = "Test SDF Network ; September 2015";
const contract = () => StrKey.encodeContract(Keypair.random().rawPublicKey());
const VERIFIER = contract();
const ACCOUNT = contract();
const POOL = contract();
const USDC = contract();

function invoke(target: string, fn: string, args: xdr.ScVal[], subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(target).toScAddress(), functionName: fn, args,
    })),
    subInvocations: subs,
  });
}

/** An unsigned V1 entry for the account, as simulation returns it. */
function entryFor(root: xdr.SorobanAuthorizedInvocation) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: Address.fromString(ACCOUNT).toScAddress(), nonce: xdr.Int64.fromString("42"), signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: root,
  });
}

const buyCover = () => invoke(POOL, "buy_protection", [Address.fromString(ACCOUNT).toScVal()], [
  invoke(USDC, "transfer", [Address.fromString(ACCOUNT).toScVal(), Address.fromString(POOL).toScVal(), xdr.ScVal.scvI32(5)]),
]);
const opts = (ids: number[]) => ({ networkPassphrase: NETWORK, accountWasmHash: OZ_ACCOUNT_WASM_HASH, contextRuleIds: ids, expiration: 1_000 });

test("compactLowS gives a 64-byte low-S signature that still verifies", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const n = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  for (let i = 0; i < 40; i++) {
    const msg = Buffer.from(`message ${i}`);
    const compact = compactLowS(sign("sha256", msg, { key: privateKey, dsaEncoding: "der" }));
    assert.equal(compact.length, 64);
    assert.ok(BigInt("0x" + compact.subarray(32).toString("hex")) <= n / 2n, "S must be low");
    assert.ok(verify("sha256", msg, { key: publicKey, dsaEncoding: "ieee-p1363" }, compact));
  }
  assert.throws(() => compactLowS(Buffer.from("3000", "hex")));
});

test("passkey key data is the 65-byte key then the credential id, and round-trips", () => {
  const key = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]);
  const data = webauthnKeyData(key, Buffer.from("cred").toString("base64url"));
  assert.equal(data.length, 65 + 4);
  assert.equal(credentialIdOf(passkeySigner(VERIFIER, key, Buffer.from("cred").toString("base64url")), VERIFIER), Buffer.from("cred").toString("base64url"));
  assert.equal(credentialIdOf(passkeySigner(VERIFIER, key, "Y3JlZA"), contract()), null, "another verifier is not a passkey of ours");
  assert.throws(() => webauthnKeyData(Buffer.alloc(64), "Y3JlZA"));
  assert.deepEqual(uncompressedKey("0x" + "11".repeat(32), "0x" + "22".repeat(32)), Buffer.concat([Buffer.from([4]), Buffer.alloc(32, 0x11), Buffer.alloc(32, 0x22)]));
});

test("passkey encoding works with the browser's Buffer polyfill, which has no base64url", async () => {
  // The browser runs this code on buffer 6.x, not Node's Buffer. Run it the same way here.
  // "buffer/" (trailing slash) loads the npm polyfill the browser bundle uses, not Node's built-in module.
  const { Buffer: Polyfill } = createRequire(import.meta.url)("buffer/") as { Buffer: typeof Buffer };
  assert.throws(() => Polyfill.from("AQID", "base64url" as BufferEncoding), /Unknown encoding/, "precondition: the polyfill lacks base64url");
  const pk = softwarePasskey(VERIFIER);
  const assertion = pk.assert(Buffer.alloc(32, 9));
  const nodeResult = { key: webauthnKeyData(pk.publicKey, pk.credentialId), sig: passkeySignatureBytes(assertion) };
  const original = globalThis.Buffer;
  (globalThis as { Buffer: unknown }).Buffer = Polyfill;
  try {
    assert.deepEqual(Buffer.from(webauthnKeyData(pk.publicKey, pk.credentialId)), Buffer.from(nodeResult.key));
    assert.equal(credentialIdOf(passkeySigner(VERIFIER, pk.publicKey, pk.credentialId), VERIFIER), pk.credentialId);
    assert.deepEqual(Buffer.from(passkeySignatureBytes(assertion)), Buffer.from(nodeResult.sig));
    assert.equal(toBase64Url(fromBase64Url(pk.credentialId)), pk.credentialId);
  } finally {
    (globalThis as { Buffer: unknown }).Buffer = original;
  }
});

test("base64url helpers match Node's encoding", () => {
  for (let n = 0; n < 40; n++) {
    const bytes = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255));
    assert.equal(toBase64Url(bytes), bytes.toString("base64url"));
    assert.deepEqual(fromBase64Url(bytes.toString("base64url")), bytes);
  }
});

test("policy install parameters encode as the contracts' structs", () => {
  const t = thresholdParams(2);
  assert.equal(t.map()![0].key().sym().toString(), "threshold");
  assert.equal(t.map()![0].val().u32(), 2);
  const a = transferAllowlistParams([POOL]);
  assert.equal(a.map()![0].key().sym().toString(), "recipients");
  assert.equal(Address.fromScVal(a.map()![0].val().vec()![0]).toString(), POOL);
  const s = spendingLimitParams(10n ** 12n, 17_280);
  assert.deepEqual(s.map()!.map((e) => e.key().sym().toString()), ["period_ledgers", "spending_limit"], "keys must be in name order");
  assert.throws(() => thresholdParams(0));
  assert.throws(() => transferAllowlistParams([]));
});

test("a cover purchase has two contexts: the pool call, then the USDC premium", () => {
  assert.deepEqual(authContextTargets(entryFor(buyCover())), [POOL, USDC]);
});

test("an operator signature: upgraded to V2, rule ids bound, digest matches the kit, passkey verifies", async () => {
  const pk = softwarePasskey(VERIFIER);
  const entry = entryFor(buyCover());
  await signOrganisationEntry(entry, ACCOUNT, pk, opts([1, 3]));

  assert.equal(entry.credentials().switch().name, "sorobanCredentialsAddressV2");
  const creds = entry.credentials().addressV2();
  assert.equal(creds.signatureExpirationLedger(), 1_000);
  const payload = readAuthPayload(creds.signature());
  assert.deepEqual(payload.context_rule_ids, [1, 3]);
  assert.equal(payload.signers.size, 1);

  // The digest the passkey signed is the one the kit (and so the account) computes.
  const expected = computeEntryAuthDigest(NETWORK, xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR()), 1_000, [1, 3], "preimage-v1").authDigest;
  const sigData = xdr.ScVal.fromXDR([...payload.signers.values()][0]);
  const get = (k: string) => Buffer.from(sigData.map()!.find((e) => e.key().sym().toString() === k)!.val().bytes());
  const clientData = JSON.parse(get("client_data").toString());
  assert.equal(clientData.challenge, Buffer.from(expected).toString("base64url"));
  const signed = Buffer.concat([get("authenticator_data"), createHash("sha256").update(get("client_data")).digest()]);
  assert.ok(verify("sha256", signed, { key: createPublicKey(pk.privateKey), dsaEncoding: "ieee-p1363" }, get("signature")), "the passkey signature verifies over authenticatorData || sha256(clientData)");
});

test("changing the rule ids after signing would change the digest", async () => {
  const entry = entryFor(buyCover());
  await signOrganisationEntry(entry, ACCOUNT, softwarePasskey(VERIFIER), opts([1, 3]));
  const a = computeEntryAuthDigest(NETWORK, xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR()), 1_000, [1, 3], "preimage-v1").authDigest;
  const b = computeEntryAuthDigest(NETWORK, xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR()), 1_000, [0, 0], "preimage-v1").authDigest;
  assert.notDeepEqual(Buffer.from(a), Buffer.from(b));
});

test("a second admin adds their approval to the same entry", async () => {
  const entry = entryFor(invoke(USDC, "transfer", [Address.fromString(ACCOUNT).toScVal(), Address.fromString(contract()).toScVal(), xdr.ScVal.scvI32(5)]));
  await signOrganisationEntry(entry, ACCOUNT, softwarePasskey(VERIFIER), opts([0]));
  await signOrganisationEntry(entry, ACCOUNT, softwarePasskey(VERIFIER), opts([0]));
  assert.equal(readAuthPayload(entry.credentials().addressV2().signature()).signers.size, 2);
  await assert.rejects(signOrganisationEntry(entry, ACCOUNT, softwarePasskey(VERIFIER), opts([1])), /different rules/);
  await assert.rejects(signOrganisationEntry(entry, ACCOUNT, softwarePasskey(VERIFIER), { ...opts([0]), expiration: 2_000 }), /different expiry/);
});

test("an account change must be the only thing an approval authorises", async () => {
  const pk = softwarePasskey(VERIFIER);
  // Alone at the root: allowed.
  await signOrganisationEntry(entryFor(invoke(ACCOUNT, "add_signer", [xdr.ScVal.scvU32(0)])), ACCOUNT, pk, opts([0]));
  // Riding along inside another call: refused.
  const sneaky = invoke(POOL, "buy_protection", [], [invoke(ACCOUNT, "add_signer", [xdr.ScVal.scvU32(0)])]);
  await assert.rejects(signOrganisationEntry(entryFor(sneaky), ACCOUNT, pk, opts([0, 0])), /only thing/);
  // Upgrades and arbitrary execution: never signed in the app.
  await assert.rejects(signOrganisationEntry(entryFor(invoke(ACCOUNT, "upgrade", [])), ACCOUNT, pk, opts([0])), /not signed in the app/);
  await assert.rejects(signOrganisationEntry(entryFor(invoke(ACCOUNT, "execute", [])), ACCOUNT, pk, opts([0])), /not signed in the app/);
});

test("refuses entries for another account and a wrong number of rule ids", async () => {
  const pk = softwarePasskey(VERIFIER);
  await assert.rejects(signOrganisationEntry(entryFor(buyCover()), contract(), pk, opts([1, 3])), /not for the organisation account/);
  await assert.rejects(signOrganisationEntry(entryFor(buyCover()), ACCOUNT, pk, opts([1])), /One context rule id/);
});
