/**
 * AuthPayload encoding for OpenZeppelin Stellar smart accounts.
 *
 * Copied from smart-account-kit 0.10.0 (dist/kit/auth-payload.js), which does not export
 * these functions. Licensed under the Apache License, Version 2.0:
 * http://www.apache.org/licenses/LICENSE-2.0
 * Copyright the smart-account-kit authors. Changes: typed for this codebase, and only
 * the functions BlockFinaX needs to write an admin authorisation are kept.
 *
 * Keep in step with the kit version in package.json: if the kit changes this format,
 * signatures written here stop verifying on chain (the organisation tests catch the
 * shape, a testnet run catches the rest).
 */
import { Address, xdr } from "@stellar/stellar-sdk";

export type ContractSigner =
  | { tag: "Delegated"; values: readonly [string] }
  | { tag: "External"; values: readonly [string, Buffer] };

interface AuthPayload {
  context_rule_ids: number[];
  signers: Map<ContractSigner, Buffer>;
}

function signerToScVal(signer: ContractSigner): xdr.ScVal {
  if (signer.tag === "Delegated") {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Delegated"), xdr.ScVal.scvAddress(Address.fromString(signer.values[0]).toScAddress())]);
  }
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("External"),
    xdr.ScVal.scvAddress(Address.fromString(signer.values[0]).toScAddress()),
    xdr.ScVal.scvBytes(signer.values[1]),
  ]);
}

function parseSignerScVal(value: xdr.ScVal): ContractSigner {
  if (value.switch().name !== "scvVec") throw new Error("Signer key is not encoded as a vector");
  const items = value.vec() ?? [];
  if (items.length < 2 || items[0].switch().name !== "scvSymbol") throw new Error("Signer key is not a valid enum encoding");
  const variant = items[0].sym().toString();
  if (variant === "Delegated" && items[1].switch().name === "scvAddress") {
    return { tag: "Delegated", values: [Address.fromScAddress(items[1].address()).toString()] };
  }
  if (variant === "External" && items.length >= 3 && items[1].switch().name === "scvAddress" && items[2].switch().name === "scvBytes") {
    return { tag: "External", values: [Address.fromScAddress(items[1].address()).toString(), Buffer.from(items[2].bytes())] };
  }
  throw new Error(`Unknown or malformed signer variant: ${variant}`);
}

export function signersEqual(a: ContractSigner, b: ContractSigner): boolean {
  if (a.tag !== b.tag || a.values[0] !== b.values[0]) return false;
  return a.tag === "Delegated" || Buffer.from(a.values[1] as Buffer).equals(Buffer.from((b as { values: readonly [string, Buffer] }).values[1]));
}

function emptyAuthPayload(): AuthPayload {
  return { context_rule_ids: [], signers: new Map() };
}

export function readAuthPayload(signature: xdr.ScVal): AuthPayload {
  if (signature.switch().name === "scvVoid") return emptyAuthPayload();
  if (signature.switch().name !== "scvMap") throw new Error("Smart account auth signature is not encoded as AuthPayload");
  const payload = emptyAuthPayload();
  for (const entry of signature.map() ?? []) {
    const key = entry.key();
    if (key.switch().name !== "scvSymbol") continue;
    const field = key.sym().toString();
    if (field === "context_rule_ids") {
      const value = entry.val();
      if (value.switch().name !== "scvVec") throw new Error("AuthPayload.context_rule_ids is not a vector");
      payload.context_rule_ids = (value.vec() ?? []).map((item) => {
        if (item.switch().name !== "scvU32") throw new Error("AuthPayload.context_rule_ids contains a non-u32 value");
        return item.u32();
      });
    }
    if (field === "signers") {
      const value = entry.val();
      if (value.switch().name !== "scvMap") throw new Error("AuthPayload.signers is not a map");
      for (const signerEntry of value.map() ?? []) {
        const signerValue = signerEntry.val();
        if (signerValue.switch().name !== "scvBytes") throw new Error("AuthPayload.signers contains a non-bytes signature value");
        payload.signers.set(parseSignerScVal(signerEntry.key()), Buffer.from(signerValue.bytes()));
      }
    }
  }
  return payload;
}

/**
 * The host's ordering for map keys (not a byte comparison of XDR: lengths are compared
 * element-wise, so a shorter prefix sorts first). The account rejects an unsorted map.
 */
function compareScVal(a: xdr.ScVal, b: xdr.ScVal): number {
  const aType = a.switch().value;
  const bType = b.switch().value;
  if (aType !== bType) return aType < bType ? -1 : 1;
  switch (a.switch().name) {
    case "scvVec": {
      const av = a.vec() ?? [];
      const bv = b.vec() ?? [];
      for (let i = 0; i < Math.min(av.length, bv.length); i += 1) {
        const cmp = compareScVal(av[i], bv[i]);
        if (cmp !== 0) return cmp;
      }
      return av.length - bv.length;
    }
    case "scvMap": {
      const am = a.map() ?? [];
      const bm = b.map() ?? [];
      for (let i = 0; i < Math.min(am.length, bm.length); i += 1) {
        const keyCmp = compareScVal(am[i].key(), bm[i].key());
        if (keyCmp !== 0) return keyCmp;
        const valCmp = compareScVal(am[i].val(), bm[i].val());
        if (valCmp !== 0) return valCmp;
      }
      return am.length - bm.length;
    }
    case "scvSymbol":
      return Buffer.compare(Buffer.from(a.sym().toString(), "utf8"), Buffer.from(b.sym().toString(), "utf8"));
    case "scvString":
      return Buffer.compare(Buffer.from(a.str().toString(), "utf8"), Buffer.from(b.str().toString(), "utf8"));
    case "scvBytes":
      return Buffer.compare(Buffer.from(a.bytes()), Buffer.from(b.bytes()));
    case "scvAddress":
      return Buffer.compare(a.address().toXDR(), b.address().toXDR());
    default:
      return Buffer.compare(a.toXDR(), b.toXDR());
  }
}

export function writeAuthPayload(payload: AuthPayload): xdr.ScVal {
  const signerEntries = Array.from(payload.signers.entries()).map(([signer, signatureBytes]) =>
    new xdr.ScMapEntry({ key: signerToScVal(signer), val: xdr.ScVal.scvBytes(signatureBytes) }));
  signerEntries.sort((a, b) => compareScVal(a.key(), b.key()));
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("context_rule_ids"), val: xdr.ScVal.scvVec(payload.context_rule_ids.map((id) => xdr.ScVal.scvU32(id))) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signers"), val: xdr.ScVal.scvMap(signerEntries) }),
  ]);
}

export function upsertAuthPayloadSigner(payload: AuthPayload, signer: ContractSigner, signatureBytes: Buffer): void {
  for (const existing of Array.from(payload.signers.keys())) {
    if (signersEqual(existing, signer)) {
      payload.signers.delete(existing);
      break;
    }
  }
  payload.signers.set(signer, signatureBytes);
}

/** The WebAuthn signature bytes the WebAuthn verifier reads (XDR of WebAuthnSigData). */
export function webAuthnSignatureBytes(sig: { authenticatorData: Buffer; clientDataJSON: Buffer; signature: Buffer }): Buffer {
  return Buffer.from(xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("authenticator_data"), val: xdr.ScVal.scvBytes(sig.authenticatorData) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("client_data"), val: xdr.ScVal.scvBytes(sig.clientDataJSON) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signature"), val: xdr.ScVal.scvBytes(sig.signature) }),
  ]).toXDR());
}
