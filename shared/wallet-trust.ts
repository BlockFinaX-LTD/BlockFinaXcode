/**
 * What the app checks for itself before it trusts a wallet or an address the server names.
 *
 * A compromised server could create a new user's wallet with someone else's key as signer,
 * give it different code, or show a deposit address that forwards to someone else. These
 * helpers let the browser check all of that against the chain, using values built into the
 * app (the chain settings below are bundled at build time, never fetched from the server):
 *
 *   - the wallet's code fingerprint equals the pinned Passkey Kit wallet;
 *   - the user's passkey is a signer, with the key the passkey actually signs with
 *     (proved by checking a passkey signature against the on-chain key);
 *   - the Base account and every deposit address are recomputed from that verified key
 *     and wallet, exactly as the contracts compute them.
 *
 * Pure and dependency-light so it runs in the browser and in tests.
 */
import { ethers } from "ethers";
import testnetChains from "../config/chains/testnet.json";
import mainnetChains from "../config/chains/mainnet.json";

/** The Passkey Kit smart wallet code every BlockFinaX Stellar wallet must run. */
export const PASSKEY_WALLET_WASM_HASH = "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0";

/** Coinbase Smart Wallet factory (same address on every EVM network). */
export const CSW_FACTORY = "0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a";

export interface TrustedChain {
  key: string;
  family: "stellar" | "evm";
  name: string;
  networkId: string;
  rpcUrls: string[];
  cctp?: { depositFactory?: string; depositImplementation?: string };
}

/** The chain settings this build was made with. */
export function trustedChains(environment: "testnet" | "mainnet"): TrustedChain[] {
  const cfg = (environment === "mainnet" ? mainnetChains : testnetChains) as { chains: TrustedChain[] };
  return cfg.chains;
}

// ── Addresses, computed exactly as the contracts compute them ──────────────

/** Coinbase Smart Wallet owner bytes for a P-256 key: abi.encode(x, y). */
export function passkeyOwner(x: string, y: string): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [x, y]);
}

/** EIP-1167 minimal proxy creation code for the deposit implementation. */
function cloneCode(implementation: string) {
  return ethers.concat(["0x3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation, "0x5af43d82803e903d91602b57fd5bf3"]);
}

/** The deposit address for a Stellar wallet, as StellarDepositFactory.addressFor computes it. */
export function depositAddressFor(factory: string, implementation: string, recipient: string): string {
  return ethers.getCreate2Address(factory, ethers.keccak256(ethers.toUtf8Bytes(recipient)), ethers.keccak256(cloneCode(implementation)));
}

// ── P-256 keys and passkey signatures ──────────────────────────────────────

const toBytes = (v: Uint8Array | ArrayBuffer) => (v instanceof Uint8Array ? v : new Uint8Array(v));

/** The 65-byte uncompressed key (0x04 || x || y) from a P-256 SubjectPublicKeyInfo. */
export function rawKeyFromSpki(spki: Uint8Array): Uint8Array {
  const raw = spki.slice(spki.length - 65);
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error("Not an uncompressed P-256 public key");
  return raw;
}

/** x and y as 0x-prefixed 32-byte hex, from a 65-byte uncompressed key. */
export function keyXY(raw: Uint8Array): { x: string; y: string } {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error("Not an uncompressed P-256 public key");
  return { x: ethers.hexlify(raw.slice(1, 33)), y: ethers.hexlify(raw.slice(33, 65)) };
}

/** A DER ECDSA signature (what WebAuthn returns) as the 64-byte r || s WebCrypto expects. */
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("Not a DER signature");
  let i = 2;
  const read = () => {
    if (der[i] !== 0x02) throw new Error("Malformed DER signature");
    const len = der[i + 1]!;
    let v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error("Malformed DER signature");
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = read(), s = read();
  const sig = new Uint8Array(64);
  sig.set(r, 0); sig.set(s, 32);
  return sig;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
export const fromBase64Url = b64url;

/**
 * Whether a WebAuthn assertion was made by the holder of `rawKey`. When `challenge` is
 * given, the assertion must also be for that challenge, so an old one cannot be replayed.
 */
export async function assertionMatchesKey(
  rawKey: Uint8Array,
  assertion: { authenticatorData: Uint8Array | ArrayBuffer; clientDataJSON: Uint8Array | ArrayBuffer; signature: Uint8Array | ArrayBuffer },
  challenge?: Uint8Array,
): Promise<boolean> {
  const subtle = globalThis.crypto.subtle;
  const clientData = toBytes(assertion.clientDataJSON);
  if (challenge) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(clientData));
      if (parsed.type !== "webauthn.get") return false;
      const got = b64url(String(parsed.challenge));
      if (got.length !== challenge.length || got.some((b, i) => b !== challenge[i])) return false;
    } catch {
      return false;
    }
  }
  const key = await subtle.importKey("raw", rawKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const hash = new Uint8Array(await subtle.digest("SHA-256", clientData));
  const auth = toBytes(assertion.authenticatorData);
  const signed = new Uint8Array(auth.length + hash.length);
  signed.set(auth, 0); signed.set(hash, auth.length);
  return subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(toBytes(assertion.signature)), signed);
}
