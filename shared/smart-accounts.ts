/**
 * OpenZeppelin smart accounts on Stellar: the encodings BlockFinaX organisation accounts use.
 *
 * Shared by the browser (signing) and the server (deploying, relaying, verifying). The
 * account contract, verifier and policies are OpenZeppelin's audited-family deployments
 * (stellar-accounts 0.8.0); BlockFinaX adds one policy of its own, the transfer allow-list.
 *
 * Signing, in short. Every signer on an authorisation entry signs the same 32-byte auth
 * digest, which commits to the entry, its expiry, the account address and the context
 * rule ids the signer claims. A passkey signs it through WebAuthn: the digest is the
 * WebAuthn challenge, and the verifier contract checks the assertion. The signature goes
 * into the entry as an AuthPayload map { context_rule_ids, signers: { signer: bytes } }.
 */
import { Address, xdr } from "@stellar/stellar-sdk";
import { computeEntryAuthDigest, KNOWN_AUTH_DIGEST_SCHEMES, type AuthDigestScheme } from "smart-account-kit";
import type { OrganisationContracts, PlannedContext, PlannedPolicy } from "./organisations";
import {
  readAuthPayload, upsertAuthPayloadSigner, webAuthnSignatureBytes, writeAuthPayload, type ContractSigner,
} from "./vendor/oz-auth-payload";

export type { ContractSigner } from "./vendor/oz-auth-payload";

/** stellar-accounts 0.8.0, the account code new organisation accounts run. */
export const OZ_ACCOUNT_WASM_HASH = "c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1";

/** Account code the app trusts for an organisation account. Add a hash here only after review. */
export const OZ_ACCEPTED_ACCOUNT_WASM_HASHES: readonly string[] = [OZ_ACCOUNT_WASM_HASH];

/** Where an organisation account's settings live on a chain (config/chains/*.json, `smartAccounts`). */
export interface SmartAccountChainConfig {
  accountWasmHash: string;
  webauthnVerifier: string;
  thresholdPolicy: string;
  spendingLimitPolicy: string;
  /** BlockFinaX's transfer allow-list policy. Null until it is deployed: operators cannot be added before then. */
  transferAllowlistPolicy: string | null;
}

export function authDigestScheme(wasmHash: string): AuthDigestScheme {
  const scheme = (KNOWN_AUTH_DIGEST_SCHEMES as Record<string, AuthDigestScheme>)[wasmHash];
  if (!scheme) throw new Error(`No known signing scheme for account code ${wasmHash.slice(0, 12)}...`);
  return scheme;
}

// ── Base64url, portable ──────────────────────────────────────────────────────
// The browser's Buffer polyfill (buffer 6.x) has no "base64url" encoding and throws
// "Unknown encoding". Plain base64 works everywhere, so convert through it.

export function fromBase64Url(value: string): Buffer {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Passkey signers ──────────────────────────────────────────────────────────

/** The 65-byte uncompressed P-256 key (0x04 || x || y) from x and y as 0x-hex (how wallet_passkeys stores them). */
export function uncompressedKey(x: string, y: string): Buffer {
  const xb = Buffer.from(x.replace(/^0x/, ""), "hex");
  const yb = Buffer.from(y.replace(/^0x/, ""), "hex");
  if (xb.length !== 32 || yb.length !== 32) throw new Error("A P-256 key needs 32-byte x and y");
  return Buffer.concat([Buffer.from([4]), xb, yb]);
}

/** WebAuthn verifier key data: the 65-byte public key followed by the raw credential id. */
export function webauthnKeyData(publicKey: Uint8Array, credentialIdBase64Url: string): Buffer {
  const key = Buffer.from(publicKey);
  if (key.length !== 65 || key[0] !== 0x04) throw new Error("A passkey public key must be 65 bytes, uncompressed");
  const id = fromBase64Url(credentialIdBase64Url);
  if (id.length === 0) throw new Error("A passkey credential id is required");
  return Buffer.concat([key, id]);
}

/** A passkey as an on-chain signer: External(WebAuthn verifier, key data). */
export function passkeySigner(webauthnVerifier: string, publicKey: Uint8Array, credentialIdBase64Url: string): ContractSigner {
  return { tag: "External", values: [webauthnVerifier, webauthnKeyData(publicKey, credentialIdBase64Url)] };
}

/** The credential id inside a passkey signer's key data, or null for any other signer. */
export function credentialIdOf(signer: ContractSigner, webauthnVerifier: string): string | null {
  if (signer.tag !== "External" || signer.values[0] !== webauthnVerifier) return null;
  const data = Buffer.from(signer.values[1]);
  return data.length > 65 ? toBase64Url(data.subarray(65)) : null;
}

// ── Policy install parameters ────────────────────────────────────────────────

const field = (name: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(name), val });

/** OpenZeppelin SimpleThresholdAccountParams { threshold: u32 }. */
export function thresholdParams(threshold: number): xdr.ScVal {
  if (!Number.isInteger(threshold) || threshold < 1) throw new Error("A threshold must be a whole number of at least 1");
  return xdr.ScVal.scvMap([field("threshold", xdr.ScVal.scvU32(threshold))]);
}

/** BlockFinaX TransferAllowlistParams { recipients: Vec<Address> }. */
export function transferAllowlistParams(recipients: readonly string[]): xdr.ScVal {
  if (recipients.length === 0) throw new Error("At least one recipient is required");
  return xdr.ScVal.scvMap([field("recipients", xdr.ScVal.scvVec(recipients.map((r) => Address.fromString(r).toScVal())))]);
}

/** OpenZeppelin SpendingLimitAccountParams { period_ledgers: u32, spending_limit: i128 } (keys in name order). */
export function spendingLimitParams(limitUnits: bigint, periodLedgers: number): xdr.ScVal {
  if (limitUnits <= BigInt(0) || !Number.isInteger(periodLedgers) || periodLedgers <= 0) throw new Error("A spending limit and period must be positive");
  const lo = limitUnits & BigInt("0xffffffffffffffff");
  const hi = limitUnits >> BigInt(64);
  const i128 = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: xdr.Int64.fromString(hi.toString()), lo: xdr.Uint64.fromString(lo.toString()) }));
  return xdr.ScVal.scvMap([field("period_ledgers", xdr.ScVal.scvU32(periodLedgers)), field("spending_limit", i128)]);
}

export function policyParams(p: PlannedPolicy): xdr.ScVal {
  return p.kind === "threshold" ? thresholdParams(p.threshold) : transferAllowlistParams(p.recipients);
}

/** A planned context in the shape the account bindings take. */
export function bindingsContext(c: PlannedContext) {
  return c.tag === "Default"
    ? ({ tag: "Default", values: undefined } as const)
    : ({ tag: "CallContract", values: [c.contract] as const } as const);
}

/** The contracts an organisation account deals with, from chain config. */
export function organisationContracts(input: {
  currencyPool: string; ratePool: string | null; usdc: string; smartAccounts: SmartAccountChainConfig;
}): OrganisationContracts {
  return {
    currencyPool: input.currencyPool,
    ratePool: input.ratePool,
    usdc: input.usdc,
    thresholdPolicy: input.smartAccounts.thresholdPolicy,
    transferAllowlistPolicy: input.smartAccounts.transferAllowlistPolicy ?? "",
  };
}

// ── Authorisation entries ────────────────────────────────────────────────────

/**
 * The contract each context of an authorisation belongs to, in the order the account
 * checks them: the authorised call first, then each nested call it authorises, depth
 * first. A nested contract deployment is reported as "create:<wasm>" so it never matches
 * an operator rule.
 */
export function authContextTargets(entry: xdr.SorobanAuthorizationEntry): string[] {
  const out: string[] = [];
  const walk = (inv: xdr.SorobanAuthorizedInvocation) => {
    const fn = inv.function();
    if (fn.switch().name === "sorobanAuthorizedFunctionTypeContractFn") {
      out.push(Address.fromScAddress(fn.contractFn().contractAddress()).toString());
    } else {
      out.push("create:contract");
    }
    for (const child of inv.subInvocations()) walk(child);
  };
  walk(entry.rootInvocation());
  return out;
}

/** The address an authorisation entry authorises for, or null when it is the source account's. */
export function authEntryAddress(entry: xdr.SorobanAuthorizationEntry): string | null {
  const c = entry.credentials();
  switch (c.switch().name) {
    case "sorobanCredentialsAddress": return Address.fromScAddress(c.address().address()).toString();
    case "sorobanCredentialsAddressV2": return Address.fromScAddress(c.addressV2().address()).toString();
    default: return null;
  }
}

/**
 * Upgrade V1 address credentials to V2 (CAP-71). Simulation returns V1; the relay accepts
 * only V2, whose signature preimage binds the authorising address.
 */
export function toAddressBound(entry: xdr.SorobanAuthorizationEntry): xdr.SorobanAuthorizationEntry {
  const c = entry.credentials();
  if (c.switch().name === "sorobanCredentialsAddress") {
    entry.credentials(xdr.SorobanCredentials.sorobanCredentialsAddressV2(c.address()));
  } else if (c.switch().name !== "sorobanCredentialsAddressV2") {
    throw new Error("Only address credentials can be signed by an organisation account");
  }
  return entry;
}

/** Smart-account functions that change who controls the account. */
export const ACCOUNT_ADMIN_FUNCTIONS = new Set([
  "add_policy", "remove_policy", "add_signer", "remove_signer", "add_context_rule", "remove_context_rule",
  "batch_add_signer", "update_context_rule_name", "update_context_rule_valid_until",
]);
/** Never signed through the app: upgrades and arbitrary execution go through review, not a button. */
export const ACCOUNT_REFUSED_FUNCTIONS = new Set(["upgrade", "execute"]);

/** The function names an authorisation tree calls on the account itself. */
export function accountSelfCalls(entry: xdr.SorobanAuthorizationEntry, account: string): string[] {
  const names: string[] = [];
  const walk = (inv: xdr.SorobanAuthorizedInvocation) => {
    const fn = inv.function();
    if (fn.switch().name === "sorobanAuthorizedFunctionTypeContractFn") {
      const args = fn.contractFn();
      if (Address.fromScAddress(args.contractAddress()).toString() === account) names.push(args.functionName().toString());
    }
    for (const child of inv.subInvocations()) walk(child);
  };
  walk(entry.rootInvocation());
  return names;
}

/** Signs a 32-byte auth digest and returns the bytes the account's verifier reads. */
export interface DigestSigner {
  readonly signer: ContractSigner;
  signAuthDigest(digest: Buffer): Promise<Buffer>;
}

export interface SignOrganisationEntryOptions {
  networkPassphrase: string;
  accountWasmHash: string;
  contextRuleIds: number[];
  /** Signature expiry ledger. Kept short: a few minutes of ledgers, never days. */
  expiration: number;
}

/**
 * Add one signer's signature to an organisation account's authorisation entry.
 *
 * Refuses upgrades and arbitrary `execute`. An admin change must be the only thing the
 * entry authorises, so a signature for "add this member" can never ride along with a
 * payment. A partly signed entry keeps its signatures; the rule ids and expiry must then
 * match, because the existing signatures cover them.
 */
export async function signOrganisationEntry(
  entry: xdr.SorobanAuthorizationEntry,
  account: string,
  signer: DigestSigner,
  options: SignOrganisationEntryOptions,
): Promise<xdr.SorobanAuthorizationEntry> {
  if (authEntryAddress(entry) !== account) throw new Error("This authorisation is not for the organisation account");
  const self = accountSelfCalls(entry, account);
  if (self.some((n) => ACCOUNT_REFUSED_FUNCTIONS.has(n))) throw new Error("Account upgrades and arbitrary execution are not signed in the app");
  if (self.some((n) => ACCOUNT_ADMIN_FUNCTIONS.has(n))) {
    const root = entry.rootInvocation().function();
    const rootIsSelf = root.switch().name === "sorobanAuthorizedFunctionTypeContractFn"
      && Address.fromScAddress(root.contractFn().contractAddress()).toString() === account;
    if (self.length !== 1 || !rootIsSelf || entry.rootInvocation().subInvocations().length !== 0) {
      throw new Error("An account change must be the only thing an approval authorises");
    }
  }
  if (!options.contextRuleIds.length) throw new Error("Context rule ids are required");
  if (options.contextRuleIds.length !== authContextTargets(entry).length) throw new Error("One context rule id is needed for each part of the approval");

  toAddressBound(entry);
  const creds = entry.credentials().addressV2();
  const payload = readAuthPayload(creds.signature());
  const existingExpiry = creds.signatureExpirationLedger();
  if (payload.signers.size > 0) {
    if (existingExpiry !== options.expiration) throw new Error("Existing approvals cover a different expiry");
    if (payload.context_rule_ids.join(",") !== options.contextRuleIds.join(",")) throw new Error("Existing approvals use different rules");
  }
  const { authDigest } = computeEntryAuthDigest(options.networkPassphrase, entry, options.expiration, options.contextRuleIds, authDigestScheme(options.accountWasmHash));
  const bytes = await signer.signAuthDigest(Buffer.from(authDigest));
  upsertAuthPayloadSigner(payload, signer.signer, Buffer.from(bytes));
  payload.context_rule_ids = [...options.contextRuleIds];
  creds.signatureExpirationLedger(options.expiration);
  creds.signature(writeAuthPayload(payload));
  return entry;
}

// ── WebAuthn signatures ──────────────────────────────────────────────────────

const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

/** A DER ECDSA signature (what WebAuthn returns) as 64-byte r || s with low S, which Stellar requires. */
export function compactLowS(der: Uint8Array): Buffer {
  const b = Buffer.from(der);
  if (b.length < 8 || b[0] !== 0x30 || b[1] >= 0x80 || b[1] !== b.length - 2 || b[2] !== 0x02) throw new Error("Malformed DER signature");
  const rLen = b[3];
  if (rLen < 1 || rLen > 33 || 4 + rLen + 2 > b.length || b[4 + rLen] !== 0x02) throw new Error("Malformed DER signature");
  const sLen = b[5 + rLen];
  if (sLen < 1 || sLen > 33 || 6 + rLen + sLen !== b.length) throw new Error("Malformed DER signature");
  const r = BigInt("0x" + b.subarray(4, 4 + rLen).toString("hex"));
  let s = BigInt("0x" + b.subarray(6 + rLen).toString("hex"));
  if (s > P256_N / BigInt(2)) s = P256_N - s;
  const hex32 = (v: bigint) => Buffer.from(v.toString(16).padStart(64, "0"), "hex");
  return Buffer.concat([hex32(r), hex32(s)]);
}

/** The signature bytes for a WebAuthn assertion over an auth digest. */
export function passkeySignatureBytes(assertion: { authenticatorData: string; clientDataJSON: string; signature: string }): Buffer {
  return webAuthnSignatureBytes({
    authenticatorData: fromBase64Url(assertion.authenticatorData),
    clientDataJSON: fromBase64Url(assertion.clientDataJSON),
    signature: compactLowS(fromBase64Url(assertion.signature)),
  });
}
