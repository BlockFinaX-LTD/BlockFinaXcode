/**
 * Rift V3 — device-bound signing.
 *
 * ## What actually changes
 *
 * Until now a signature could be produced from a session token, or a session
 * token plus a password. Both are bearer secrets: whoever holds one can
 * authorise anything. V3 replaces that with a proof that is bound to the exact
 * operation being signed — a WebAuthn assertion whose challenge, or a Google
 * id_token whose nonce, equals the user-operation hash. A proof for one
 * transaction cannot be replayed on another, and Rift cannot manufacture one.
 *
 * Nothing else moves. Balances, history, addresses and the way the backend
 * identifies a caller are all unchanged; only the moment of signing differs.
 *
 * ## Why enrolment offers Google as well as a passkey
 *
 * A passkey lives on one device. Rift's guide is explicit that losing your only
 * enrolled method is an account-recovery case handled by their support, not a
 * self-serve reset — the wallet is non-custodial, so nobody can re-key it.
 *
 * BlockFinaX's customers are traders in Ghana and Nigeria, often on shared or
 * low-end Android handsets. A single-passkey account is a lost phone away from
 * a support ticket. Rift accepts several methods in one migrate call, so this
 * module always tries to enrol a passkey *and* link Google together, and the
 * UI treats declining the second one as a warning rather than a default.
 *
 * ## Endpoint prefix
 *
 * The wallet-management calls are documented without a version prefix
 * (`/wallet/v3-status`) while the transaction calls carry one
 * (`/v1/transactions/preview`). That asymmetry is what the guide says, so it is
 * what this module sends; if sandbox 404s on the unprefixed paths, set
 * VITE_RIFT_WALLET_PREFIX=/v1 and everything moves together.
 */

const API_BASE = (import.meta.env.VITE_RIFT_API_BASE || "https://service.riftfi.xyz").replace(/\/$/, "");
const WALLET_PREFIX = (import.meta.env.VITE_RIFT_WALLET_PREFIX || "").replace(/\/$/, "");
const API_KEY = (import.meta.env.VITE_RIFT_PUBLIC_KEY || import.meta.env.VITE_RIFT_API_KEY || "").trim();

/**
 * Who is offered the upgrade.
 *
 * Migration is a one-way door. There is no endpoint to remove a signing
 * method and no path from v3 back to v1, so a wallet enrolled against a
 * passkey that turns out not to work is a support case at Rift rather than
 * something this codebase can undo.
 *
 * That asymmetry is the whole reason this gate exists. It is not caution about
 * the code — it is that the first real migration should happen on a wallet
 * whose owner is sitting next to the person who can fix it. Set
 * VITE_V3_ROLLOUT to a comma-separated list of emails to widen it, or to "all"
 * once a migration has been done and a payment signed with the result.
 */
const ROLLOUT = (import.meta.env.VITE_V3_ROLLOUT || "anthonykumako@blockfinax.com,anthonykumako8@gmail.com")
  .split(",")
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

export function v3RolloutAllows(email: string | null | undefined): boolean {
  if (ROLLOUT.includes("all")) return true;
  if (!email) return false;
  return ROLLOUT.includes(email.trim().toLowerCase());
}

/** For a status line in the UI, so the current scope is never a guess. */
export function v3RolloutScope(): string {
  return ROLLOUT.includes("all") ? "everyone" : `${ROLLOUT.length} allow-listed account(s)`;
}

// ── Types ─────────────────────────────────────────────────────────────────

export type WalletVersion = "v1" | "v2" | "v3" | null;

export type EnrolledMethod =
  | { kind: "oidc"; iss: string; sub: string; email?: string }
  | { kind: "passkey"; cred_id_b64: string; cose_pubkey_b64: string };

export interface EnrolledEntry {
  kind: "passkey" | "oidc";
  label?: string;
  iss?: string;
  sub?: string;
}

export interface MethodsResponse {
  version: WalletVersion;
  ownerAddress?: string;
  enrolled: EnrolledEntry[];
  passkeyCredIds?: string[];
}

export type AuthProof =
  | { kind: "oidc"; id_token: string }
  | {
      kind: "passkey";
      cred_id_b64: string;
      client_data_json_b64: string;
      authenticator_data_b64: string;
      signature_b64: string;
    };

/** Named so the UI can react to each without string-matching a message. */
export type RiftV3ErrorCode =
  | "NOT_V3"
  | "CHALLENGE_MISSING_OR_EXPIRED"
  | "RESEAL_FAILED"
  | "TICKET_EXPIRED"
  | "CANCELLED"
  | "UNSUPPORTED"
  | "UNKNOWN";

export class RiftV3Error extends Error {
  constructor(public code: RiftV3ErrorCode, message: string, public status?: number) {
    super(message);
    this.name = "RiftV3Error";
  }
}

// ── base64url ─────────────────────────────────────────────────────────────
//
// WebAuthn deals in ArrayBuffers; Rift wants base64. Standard base64 is used
// for the payload fields (the guide's `_b64` suffix), so these do not strip
// padding or swap the alphabet.

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * The COSE-encoded public key, pulled out of the authenticator data.
 *
 * `AuthenticatorAttestationResponse.getPublicKey()` looks like the obvious
 * source and is the wrong one: it returns SubjectPublicKeyInfo DER. Rift's
 * field is `cose_pubkey_b64` and the enclave parses COSE (ECDSA P-256, alg
 * -7), so SPKI arrives as an unparseable blob and the migration is refused
 * server-side with nothing useful visible in the browser.
 *
 * The layout, from the WebAuthn spec:
 *
 *     0..31   rpIdHash
 *     32      flags        bit 6 (0x40) AT, bit 7 (0x80) ED
 *     33..36  signCount
 *     37..52  aaguid                 } only when AT is set
 *     53..54  credentialIdLength     }
 *     55..    credentialId           }
 *     then    credentialPublicKey (COSE_Key, CBOR)
 *     then    extensions (CBOR)      only when ED is set
 *
 * Everything after the credential id is the COSE key, provided no extensions
 * follow it. This module requests none, so ED should never be set; if it is,
 * finding where the key ends would need a CBOR walker and guessing would send
 * a key with trailing bytes, so it raises instead.
 */
function coseKeyFromAuthData(authData: ArrayBuffer): ArrayBuffer {
  const d = new Uint8Array(authData);
  if (d.length < 55) {
    throw new RiftV3Error("UNSUPPORTED", "The authenticator returned unexpectedly short data.");
  }
  const flags = d[32];
  if ((flags & 0x40) === 0) {
    throw new RiftV3Error("UNSUPPORTED", "The authenticator returned no credential data.");
  }
  if ((flags & 0x80) !== 0) {
    throw new RiftV3Error("UNSUPPORTED", "This authenticator added extensions we can't parse.");
  }
  const credIdLen = (d[53] << 8) | d[54];
  const start = 55 + credIdLen;
  if (start >= d.length) {
    throw new RiftV3Error("UNSUPPORTED", "The authenticator returned no public key.");
  }
  return d.slice(start).buffer;
}

/**
 * A hex hash becomes the raw challenge bytes.
 *
 * The enclave compares the challenge inside the signed clientDataJSON against
 * the user-operation hash. Passing the hex *string* instead of its bytes is the
 * classic way to get a proof that verifies locally and is rejected server-side,
 * so the conversion happens in exactly one place.
 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/**
 * The relying-party id for WebAuthn.
 *
 * Deliberately the registrable domain rather than the exact host: a passkey
 * created on www.blockfinax.com must still work if the user later lands on the
 * apex, and rpId is the only thing that decides that. localhost is special-cased
 * because WebAuthn permits it without TLS.
 */
export function relyingPartyId(): string {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "localhost";
  const parts = host.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : host;
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

// ── HTTP ──────────────────────────────────────────────────────────────────

async function call<T>(
  path: string,
  accessToken: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-API-Key": API_KEY,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }

  if (!res.ok) {
    const code = (body?.code || body?.error) as string | undefined;
    const known: RiftV3ErrorCode[] = ["NOT_V3", "CHALLENGE_MISSING_OR_EXPIRED", "RESEAL_FAILED"];
    throw new RiftV3Error(
      (known.includes(code as RiftV3ErrorCode) ? code : "UNKNOWN") as RiftV3ErrorCode,
      body?.message || `${res.status} on ${path}`,
      res.status,
    );
  }
  // Rift wraps some payloads in { data } and returns others bare.
  return (body?.data ?? body) as T;
}

const wallet = (p: string) => `${WALLET_PREFIX}/wallet${p}`;

// ── Status ────────────────────────────────────────────────────────────────

export async function getV3Status(accessToken: string): Promise<{ version: WalletVersion }> {
  return call(wallet("/v3-status"), accessToken);
}

export async function getMethods(accessToken: string): Promise<MethodsResponse> {
  const r = await call<MethodsResponse>(wallet("/methods"), accessToken);
  return { ...r, enrolled: Array.isArray(r?.enrolled) ? r.enrolled : [] };
}

/**
 * Whether this user can authorise a transaction right now.
 *
 * Distinct from being signed in, and the guide is emphatic about the
 * difference: a v1/v2 wallet, or a v3 wallet with nothing enrolled, is fully
 * authenticated and cannot sign. Write actions gate on this; reads never do.
 */
export function isSigningReady(m: Pick<MethodsResponse, "version" | "enrolled">): boolean {
  return m.version === "v3" && m.enrolled.length > 0;
}

// ── Enrolment on the device ───────────────────────────────────────────────

/** Creates a passkey and returns it in the shape Rift enrols. */
export async function createPasskey(userLabel: string, userId: string): Promise<EnrolledMethod> {
  if (!passkeysSupported()) {
    throw new RiftV3Error("UNSUPPORTED", "This device can't create a passkey.");
  }
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { id: relyingPartyId(), name: "BlockFinaX" },
        user: {
          id: new TextEncoder().encode(userId).slice(0, 64),
          name: userLabel,
          displayName: userLabel,
        },
        // ES256 then RS256. The enclave verifies ECDSA over P-256 (COSE -7),
        // so that is listed first and is what every platform authenticator uses.
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
  } catch (err: any) {
    // NotAllowedError is what a browser reports for a genuine cancellation and
    // equally for a timeout, an insecure context, a mismatched relying-party
    // id, or an in-app webview that quietly refuses WebAuthn. Treating them
    // all as "the user said no" is why this failed silently on a phone with
    // nothing on screen to explain it, so the original is kept for the UI.
    const cancelled = err?.name === "NotAllowedError";
    console.error("[rift-v3] passkey creation failed:", err?.name, err?.message);
    throw new RiftV3Error(
      cancelled ? "CANCELLED" : "UNSUPPORTED",
      cancelled
        ? "The passkey prompt closed without completing. If you didn't dismiss it, this browser may " +
          "be blocking passkeys — open the site directly rather than inside another app."
        : String(err?.message || err),
    );
  }
  if (!cred) throw new RiftV3Error("CANCELLED", "Your device didn't return a passkey.");

  const response = cred.response as AuthenticatorAttestationResponse;
  const getAuthData = (response as any).getAuthenticatorData as undefined | (() => ArrayBuffer);
  if (typeof getAuthData !== "function") {
    throw new RiftV3Error(
      "UNSUPPORTED",
      "This browser is too old to enrol a passkey. Try an up-to-date Chrome or Safari.",
    );
  }
  return {
    kind: "passkey",
    cred_id_b64: bufToB64(cred.rawId),
    cose_pubkey_b64: bufToB64(coseKeyFromAuthData(getAuthData.call(response))),
  };
}

/**
 * Signs a hash with an existing passkey, producing the proof the enclave wants.
 *
 * `allowCredentials` is left unset on purpose so the platform's own picker
 * resolves which passkey to use — the guide recommends this where a user may
 * have several across devices.
 */
export async function assertPasskey(hashHex: string): Promise<AuthProof> {
  if (!passkeysSupported()) {
    throw new RiftV3Error("UNSUPPORTED", "This device can't use a passkey.");
  }
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: hexToBytes(hashHex),
        rpId: relyingPartyId(),
        userVerification: "required",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
  } catch (err: any) {
    throw new RiftV3Error(
      err?.name === "NotAllowedError" ? "CANCELLED" : "UNKNOWN",
      err?.name === "NotAllowedError" ? "Cancelled." : String(err?.message || err),
    );
  }
  if (!cred) throw new RiftV3Error("CANCELLED", "Cancelled.");

  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    kind: "passkey",
    cred_id_b64: bufToB64(cred.rawId),
    client_data_json_b64: bufToB64(r.clientDataJSON),
    authenticator_data_b64: bufToB64(r.authenticatorData),
    signature_b64: bufToB64(r.signature),
  };
}

// ── Migration ─────────────────────────────────────────────────────────────

export interface MigrateResult {
  alreadyMigrated: boolean;
  fromVersion?: WalletVersion;
}

/**
 * Moves a v1/v2 wallet onto device-bound signing.
 *
 * Idempotent, so a retry after a dropped connection is safe. `oldPassword` is
 * only needed for a v2 wallet — BlockFinaX has password-authenticated users, so
 * the caller must read the version first and ask for it when it says v2.
 */
export async function migrateToV3(
  accessToken: string,
  enrolledMethods: EnrolledMethod[],
  oldPassword?: string,
): Promise<MigrateResult> {
  if (!enrolledMethods.length) {
    throw new RiftV3Error("UNKNOWN", "At least one signing method is required.");
  }

  // A passkey is bound to the relying-party id that created it, and on a dev
  // machine that is "localhost". Enrolling one against a production wallet
  // would migrate it — irreversibly, since there is no remove-method endpoint
  // — to a credential that only exists on this laptop and cannot be used from
  // blockfinax.com. Refuse rather than let a real wallet be stranded.
  const localCredential = relyingPartyId() === "localhost";
  const productionWallet = /riftfi\.xyz|service\./.test(API_BASE);
  if (localCredential && productionWallet) {
    throw new RiftV3Error(
      "UNSUPPORTED",
      "Passkeys made on localhost only work on localhost. Run this on the live domain " +
        "so the credential is bound to blockfinax.com — migration cannot be undone.",
    );
  }
  return call(wallet("/migrate-to-v3"), accessToken, {
    method: "POST",
    body: { enrolledMethods, ...(oldPassword ? { oldPassword } : {}) },
  });
}

// ── Adding a method to a wallet already on v3 ─────────────────────────────

/**
 * The four-step handshake: get a challenge, approve it with a method already
 * enrolled, create the new one, submit both together.
 *
 * The approval step is what stops an attacker with a stolen session from
 * quietly adding their own key, so it is never skipped — where only one method
 * exists it is simply the approver, with no chooser shown.
 */
export async function addMethod(
  accessToken: string,
  approve: (challengeHex: string) => Promise<AuthProof>,
  enrolNew: () => Promise<EnrolledMethod>,
): Promise<{ ok: boolean; ownerAddress?: string; addedKind?: string }> {
  const { challengeHex } = await call<{ challengeHex: string }>(
    wallet("/methods/challenge"),
    accessToken,
    { method: "POST" },
  );
  const authProof = await approve(challengeHex);
  const newMethod = await enrolNew();
  return call(wallet("/methods"), accessToken, { method: "POST", body: { authProof, newMethod } });
}

// ── Signing ───────────────────────────────────────────────────────────────

export interface PreviewResult {
  userOpHashHex: string;
  ticketId: string;
  ttlMs?: number;
  smartAccountAddress?: string;
  chainId?: number;
}

export async function previewTransaction(
  accessToken: string,
  params: { token: string; chain: string; recipient: string; amount: string },
): Promise<PreviewResult> {
  return call("/v1/transactions/preview", accessToken, { method: "POST", body: params });
}

export async function submitPrepared(
  accessToken: string,
  ticketId: string,
  authProof: AuthProof,
): Promise<{ hash: string; transactionHash?: string; userOperationHash?: string; chainId?: number }> {
  return call("/v1/wallet/user-operations/submit-prepared", accessToken, {
    method: "POST",
    body: { ticketId, authProof },
  });
}

/**
 * Preview, consent, submit — with one silent retry.
 *
 * The ticket lives 60 seconds. A customer reading a confirmation screen, or
 * reaching for a phone to approve, will sometimes exceed that, and the guide is
 * clear this should not surface as an error: re-run the preview and ask again.
 * The retry is capped at one so a genuine failure still reaches the user.
 */
export async function sendTransactionV3(
  accessToken: string,
  params: { token: string; chain: string; recipient: string; amount: string },
  consent: (hashHex: string) => Promise<AuthProof>,
): Promise<{ hash: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { userOpHashHex, ticketId } = await previewTransaction(accessToken, params);
    const proof = await consent(userOpHashHex); // a cancel throws and is not retried
    try {
      return await submitPrepared(accessToken, ticketId, proof);
    } catch (err) {
      const expired =
        err instanceof RiftV3Error && (err.status === 410 || /ticket|expired/i.test(err.message));
      if (!expired || attempt === 1) throw err;
    }
  }
  throw new RiftV3Error("TICKET_EXPIRED", "That took a little too long — please try again.");
}
