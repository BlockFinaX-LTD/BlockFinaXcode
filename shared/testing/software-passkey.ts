/**
 * A software stand-in for a phone's passkey, for tests and testnet scripts only.
 *
 * It produces genuine WebAuthn-shaped assertions with a P-256 key held in memory:
 * authenticator data with user-present and user-verified flags, client data whose
 * challenge is the auth digest, and a DER ECDSA signature over
 * authenticatorData || sha256(clientDataJSON), exactly what a browser returns.
 * Never use it for real money: the key is a plain in-memory secret.
 */
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { passkeySigner, passkeySignatureBytes, type ContractSigner, type DigestSigner } from "../smart-accounts";

interface SoftwarePasskey extends DigestSigner {
  readonly credentialId: string;
  readonly publicKey: Buffer;
  readonly privateKey: KeyObject;
  /** The raw assertion for a challenge, as a browser would return it (base64url fields). */
  assert(challenge: Buffer): { authenticatorData: string; clientDataJSON: string; signature: string };
}

export function softwarePasskey(webauthnVerifier: string, opts: { rpId?: string; origin?: string; credentialId?: Buffer } = {}): SoftwarePasskey {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  const credentialId = (opts.credentialId ?? createHash("sha256").update(raw).digest().subarray(0, 16)).toString("base64url");
  const rpId = opts.rpId ?? "localhost";
  const origin = opts.origin ?? "http://localhost:5173";
  const signer: ContractSigner = passkeySigner(webauthnVerifier, raw, credentialId);

  const assert = (challenge: Buffer) => {
    const flags = Buffer.from([0x05]); // user present + user verified
    const authenticatorData = Buffer.concat([createHash("sha256").update(rpId).digest(), flags, Buffer.alloc(4)]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: challenge.toString("base64url"), origin, crossOrigin: false }));
    const signed = Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]);
    const der = sign("sha256", signed, { key: privateKey, dsaEncoding: "der" });
    return { authenticatorData: authenticatorData.toString("base64url"), clientDataJSON: clientDataJSON.toString("base64url"), signature: der.toString("base64url") };
  };

  return {
    credentialId, publicKey: raw, privateKey, signer, assert,
    async signAuthDigest(digest: Buffer) {
      return passkeySignatureBytes(assert(digest));
    },
  };
}
