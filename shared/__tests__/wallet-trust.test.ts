import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  PASSKEY_WALLET_WASM_HASH, assertionMatchesKey, depositAddressFor, derToRaw, keyXY, passkeyOwner, rawKeyFromSpki, trustedChains,
} from "../wallet-trust";

const subtle = globalThis.crypto.subtle;

/** WebCrypto signs as r || s; WebAuthn returns DER. Build the DER form a passkey would return. */
function rawToDer(sig: Uint8Array): Uint8Array {
  const int = (v: Uint8Array) => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    let b = v.slice(i);
    if (b[0]! & 0x80) b = Uint8Array.from([0, ...b]);
    return Uint8Array.from([0x02, b.length, ...b]);
  };
  const r = int(sig.slice(0, 32)), s = int(sig.slice(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

async function passkey() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const spki = new Uint8Array(await subtle.exportKey("spki", pair.publicKey));
  const assert_ = async (challenge: Uint8Array) => {
    const b64 = Buffer.from(challenge).toString("base64url");
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: b64, origin: "https://testnet.blockfinax.com" }));
    const authenticatorData = crypto.getRandomValues(new Uint8Array(37));
    const hash = new Uint8Array(await subtle.digest("SHA-256", clientDataJSON));
    const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, Uint8Array.from([...authenticatorData, ...hash])));
    return { authenticatorData, clientDataJSON, signature: rawToDer(sig) };
  };
  return { raw, spki, assert: assert_ };
}

test("a passkey signature is accepted only against its own key and challenge", async () => {
  const me = await passkey(), other = await passkey();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const a = await me.assert(challenge);
  assert.equal(await assertionMatchesKey(me.raw, a, challenge), true);
  assert.equal(await assertionMatchesKey(other.raw, a, challenge), false, "someone else's key");
  assert.equal(await assertionMatchesKey(me.raw, a, crypto.getRandomValues(new Uint8Array(32))), false, "replayed for another challenge");
  assert.equal(await assertionMatchesKey(me.raw, a), true, "without a challenge, the signature alone");
});

test("keys convert between the forms passkeys, Stellar and Base use", async () => {
  const me = await passkey();
  assert.deepEqual(rawKeyFromSpki(me.spki), me.raw);
  const { x, y } = keyXY(me.raw);
  assert.equal(x.length, 66);
  assert.equal(passkeyOwner(x, y), ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [x, y]));
  assert.throws(() => keyXY(new Uint8Array(64)));
  assert.throws(() => derToRaw(new Uint8Array([1, 2, 3])));
});

test("deposit addresses are recomputed from the bundled testnet factory", () => {
  const base = trustedChains("testnet").find((c) => c.key === "base-sepolia")!;
  const wallet = "CCTESTWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const a = depositAddressFor(base.cctp!.depositFactory!, base.cctp!.depositImplementation!, wallet);
  assert.ok(ethers.isAddress(a));
  assert.notEqual(a, depositAddressFor(base.cctp!.depositFactory!, base.cctp!.depositImplementation!, wallet.replace("T", "U")));
  assert.equal(PASSKEY_WALLET_WASM_HASH.length, 64);
  assert.ok(trustedChains("mainnet").some((c) => c.family === "stellar"));
});
