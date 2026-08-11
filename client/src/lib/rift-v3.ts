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

/** Standard base64 → base64url, for APIs that expect the URL alphabet. */
export function toB64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64 (either alphabet) → bytes, for allowCredentials. */
function b64ToBytes(b64: string): Uint8Array {
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm.padEnd(Math.ceil(norm.length / 4) * 4, "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The credential Rift actually enrolled.
 *
 * Every failed migration attempt still ran navigator.credentials.create()
 * successfully — the passkey was written to the device and only the server
 * call afterwards failed. Those orphans are indistinguishable to the browser
 * from the one that worked, and with no allowCredentials it is free to sign
 * with any of them. Rift then rejects a proof from a credential it never
 * enrolled, which is a 400 on submit-prepared and nothing more descriptive.
 *
 * So the id that survived enrolment is recorded and used to constrain the
 * assertion. Absent a record, the assertion stays unconstrained — the platform
 * picker is still better than refusing to try.
 */
const CRED_KEY = "bfx_v3_cred";

export function rememberEnrolledCredential(credIdB64: string): void {
  try {
    localStorage.setItem(CRED_KEY, credIdB64);
  } catch {
    /* private mode — fall back to an unconstrained assertion */
  }
}

function enrolledCredential(): string | null {
  try {
    return localStorage.getItem(CRED_KEY);
  } catch {
    return null;
  }
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
    // Rift's 400s have arrived with no message field, leaving only a status
    // code to work from. Log the whole body so the reason is available.
    console.warn(`[rift-v3] ${res.status} on ${path}:`, text.slice(0, 600));
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

/**
 * Wallet-management paths, tried both ways.
 *
 * Rift's two guides disagree: the CEO's document writes
 * `/wallet/migrate-to-v3`, the COO's writes `/v1/wallet/migrate-to-v3`. The
 * unprefixed form is what our first successful migration used, so it works —
 * but the add-method endpoints are on the same family and untested, and an
 * unauthenticated probe cannot tell them apart because auth runs ahead of
 * routing and answers 401 for every path including nonsense ones.
 *
 * So rather than pick, call one and fall back to the other on a 404, then
 * remember which answered. Costs one wasted request, once, and removes a class
 * of failure that would otherwise surface as a dead button.
 */
let walletPrefix: string | null = WALLET_PREFIX || null;

async function callWallet<T>(
  suffix: string,
  accessToken: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const order = walletPrefix !== null ? [walletPrefix] : ["", "/v1"];
  let last: unknown;
  for (const prefix of order) {
    try {
      const out = await call<T>(`${prefix}/wallet${suffix}`, accessToken, init);
      walletPrefix = prefix; // Remember what answered, for every later call.
      return out;
    } catch (err) {
      last = err;
      // 404 is the obvious "wrong path", but a gateway that doesn't know the
      // route can answer 400 or 405 just as easily. 401 and 403 are never
      // routing — they mean the request arrived and was rejected, and retrying
      // elsewhere would only hide that.
      const routingShaped =
        err instanceof RiftV3Error && (err.status === 404 || err.status === 400 || err.status === 405);
      if (!routingShaped) throw err;
    }
  }
  throw last;
}

/**
 * What this device actually calls its biometric check.
 *
 * Telling an iPhone owner to use Touch ID is wrong on every model since the
 * X, and it reads as a screen written for somebody else's phone. The reverse
 * is just as bad: a Mac has no Face ID, and an iPhone SE still has a button.
 *
 * iOS is therefore deliberately left as both. There is no reliable way to tell
 * Face ID from Touch ID in a browser — the honest phrase covers every iPhone,
 * and is shorter than being wrong.
 */
export function biometricName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  const touch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 1;
  // iPadOS reports a Mac user agent; touch points give it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch)) return "Face ID / Touch ID";
  if (/Macintosh|Mac OS X/.test(ua)) return "Touch ID";
  if (/Android/.test(ua)) return "your fingerprint";
  // Everyone else (Windows, Linux, Chromebook, unknown) reads the same
  // brand-neutral copy — never surface OS chrome like "Windows Hello".
  return "your device";
}

/** The same thing as an action, for progress lines. */
export function biometricPrompt(): string {
  const n = biometricName();
  return n.startsWith("your") ? `Waiting for ${n}…` : `Waiting for ${n}…`;
}

/**
 * What this browser and this build actually resolved to.
 *
 * Written after several rounds of diagnosing a failure from a photograph of a
 * screen. Everything here is already knowable at runtime; the only reason it
 * was hard was that none of it was visible.
 */
export interface V3Diagnostics {
  apiBase: string;
  walletPrefix: string;
  apiKeyPrefix: string;
  relyingPartyId: string;
  passkeysSupported: boolean;
  platformAuthenticator: "yes" | "no" | "unknown";
  inIframe: boolean;
  inAppBrowser: string | null;
  secureContext: boolean;
}

/** Names the embedding app when the page is inside one, else null. */
function detectInAppBrowser(): string | null {
  const ua = navigator.userAgent || "";
  const known: [RegExp, string][] = [
    [/FBAN|FBAV|FB_IAB/, "Facebook"],
    [/Instagram/, "Instagram"],
    [/LinkedInApp/, "LinkedIn"],
    [/Twitter/, "X / Twitter"],
    [/WhatsApp/, "WhatsApp"],
    [/Line\//, "LINE"],
    [/MicroMessenger/, "WeChat"],
    [/Snapchat/, "Snapchat"],
    [/TikTok|BytedanceWebview/, "TikTok"],
  ];
  for (const [re, name] of known) if (re.test(ua)) return name;
  // iOS in-app browsers are all WebKit and often unnamed. A missing standalone
  // flag alongside no recognised browser token is the usual tell.
  if (/iPhone|iPad/.test(ua) && !/Safari\//.test(ua)) return "an embedded browser";
  return null;
}

let lastDecline: string | null = null;

/** Recorded by the signing path; surfaced in the diagnostics panel. */
export function noteDeviceSigningDecline(reason: string | null): void {
  lastDecline = reason;
}
export function getDeviceSigningDecline(): string | null {
  return lastDecline;
}

export async function diagnostics(): Promise<V3Diagnostics> {
  let platform: V3Diagnostics["platformAuthenticator"] = "unknown";
  try {
    if (window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) {
      platform = (await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
        ? "yes"
        : "no";
    }
  } catch {
    /* leave unknown */
  }
  return {
    apiBase: API_BASE,
    walletPrefix: walletPrefix === null ? "(not yet resolved)" : walletPrefix || "(none)",
    apiKeyPrefix: API_KEY ? API_KEY.slice(0, 3) : "(unset)",
    relyingPartyId: relyingPartyId(),
    passkeysSupported: passkeysSupported(),
    platformAuthenticator: platform,
    inIframe: window.top !== window.self,
    inAppBrowser: detectInAppBrowser(),
    secureContext: window.isSecureContext,
  };
}

/**
 * A local record that this wallet migrated.
 *
 * Device signing was gated on GET /wallet/methods, which appears in both
 * migration guides and in neither of Rift's API references — the published
 * endpoint list under /v1/wallet covers identity, signatures, chains and the
 * two user-operation calls, and nothing else. When it 404s the status is
 * unreadable, and an unreadable status was being treated as "not migrated",
 * so a wallet that had successfully migrated kept being asked for a code.
 *
 * migrate-to-v3 returning success is first-hand evidence that does not depend
 * on any other endpoint existing. It is written down here and used whenever
 * the status call cannot answer. Keyed by address so a different account on
 * the same browser does not inherit it.
 */
const MIGRATED_KEY = "bfx_v3_migrated";

export function rememberMigrated(address: string | null | undefined): void {
  try {
    const all = JSON.parse(localStorage.getItem(MIGRATED_KEY) || "{}");
    all[(address || "self").toLowerCase()] = Date.now();
    localStorage.setItem(MIGRATED_KEY, JSON.stringify(all));
  } catch {
    /* private mode, or storage full — the status endpoint may still answer */
  }
}

export function wasMigratedLocally(address: string | null | undefined): boolean {
  try {
    const all = JSON.parse(localStorage.getItem(MIGRATED_KEY) || "{}");
    return !!all[(address || "self").toLowerCase()];
  } catch {
    return false;
  }
}

// ── Status ────────────────────────────────────────────────────────────────

export async function getV3Status(accessToken: string): Promise<{ version: WalletVersion }> {
  return callWallet("/v3-status", accessToken);
}

export async function getMethods(accessToken: string): Promise<MethodsResponse> {
  const r = await callWallet<MethodsResponse>("/methods", accessToken);
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
export async function assertPasskey(hashHex: string, allowedCredIds?: string[]): Promise<AuthProof> {
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
        // Restrict to the credentials Rift says are enrolled.
        //
        // GET /wallet/methods returns passkeyCredIds, and that is authoritative
        // in a way nothing on this device is. Every failed migration still ran
        // credentials.create() successfully — the passkey was written and only
        // the server call afterwards failed — so this Mac carries several that
        // Rift has never seen. Unconstrained, the browser is free to sign with
        // one of them, and a proof from an unenrolled credential is refused
        // with a bare 400.
        //
        // Falls back to a locally remembered id, then to no constraint at all,
        // since the platform picker beats refusing to try.
        ...(() => {
          const ids = (allowedCredIds?.length ? allowedCredIds : [enrolledCredential()].filter(Boolean) as string[]);
          if (!ids.length) return {};
          return {
            allowCredentials: ids.map((id) => ({ type: "public-key" as const, id: b64ToBytes(id) })),
          };
        })(),
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
  //
  // LOCAL-TEST OVERRIDE: set VITE_ALLOW_LOCALHOST_MIGRATION=true in .env to
  // bypass this guard. Only use for throwaway test accounts on localhost;
  // any account migrated this way will only sign from localhost afterwards.
  const localCredential = relyingPartyId() === "localhost";
  const productionWallet = /riftfi\.xyz|service\./.test(API_BASE);
  const allowLocalhostMigration = String(
    import.meta.env.VITE_ALLOW_LOCALHOST_MIGRATION || "",
  ).toLowerCase() === "true";
  if (localCredential && productionWallet && !allowLocalhostMigration) {
    throw new RiftV3Error(
      "UNSUPPORTED",
      "Passkeys made on localhost only work on localhost. Run this on the live domain " +
        "so the credential is bound to blockfinax.com — migration cannot be undone.",
    );
  }
  const out = await callWallet<MigrateResult>("/migrate-to-v3", accessToken, {
    method: "POST",
    // enrolledMethods per the CEO's guide; enrolled_methods is what the COO's
    // note writes. Sending both costs nothing and one of them is right.
    body: {
      enrolledMethods,
      enrolled_methods: enrolledMethods,
      ...(oldPassword ? { oldPassword } : {}),
    },
  });
  rememberMigrated(null);

  // Only when this call actually enrolled it. A repeat returns
  // alreadyMigrated and changes nothing server-side, so the passkey created
  // moments earlier was never registered — recording it would constrain every
  // future assertion to a credential Rift has never seen, turning an
  // intermittent failure into a certain one.
  const pk = enrolledMethods.find((m) => m.kind === "passkey");
  if (!out?.alreadyMigrated && pk && "cred_id_b64" in pk) {
    rememberEnrolledCredential(pk.cred_id_b64);
  }
  return out;
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
  const { challengeHex } = await callWallet<{ challengeHex: string }>(
    "/methods/challenge",
    accessToken,
    { method: "POST" },
  );
  const authProof = await approve(challengeHex);
  const newMethod = await enrolNew();
  return callWallet("/methods", accessToken, { method: "POST", body: { authProof, newMethod } });
}

/**
 * Standalone challenge fetch — used by the AddMethodWizard so it can
 * pre-fetch the challenge on open (before showing step 1). That way step
 * 1's "Continue" click can call approveWithExisting synchronously, without
 * an intervening network round-trip that would lose the browser's user-
 * activation grant and get the WebAuthn / OAuth popup blocked.
 *
 * Same call as addMethod's first step — reuses callWallet so it inherits
 * the same VITE_RIFT_API_BASE + walletPrefix fallback plumbing.
 */
export async function fetchAddMethodChallenge(accessToken: string): Promise<string> {
  const { challengeHex } = await callWallet<{ challengeHex: string }>(
    "/methods/challenge",
    accessToken,
    { method: "POST" },
  );
  return challengeHex;
}

/**
 * Finalise add-method with an ALREADY-produced authProof + newMethod.
 * Pairs with fetchAddMethodChallenge above — the wizard calls this after
 * step 2 to POST /methods without re-fetching a challenge.
 *
 * DO NOT call addMethod() with `async () => cachedProof` as the approve
 * callback: addMethod fetches a FRESH challenge internally, and the
 * server verifies authProof against that new challenge — the cached
 * proof (bound to the original wizard-open challenge) will not match
 * and the enclave rejects with RESEAL_FAILED.
 */
export async function finaliseAddMethod(
  accessToken: string,
  authProof: AuthProof,
  newMethod: EnrolledMethod,
): Promise<{ ok: boolean; ownerAddress?: string; addedKind?: string }> {
  return callWallet("/methods", accessToken, {
    method: "POST",
    body: { authProof, newMethod },
  });
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

/**
 * Preview for a raw contract call.
 *
 * The token-transfer preview only understands {token, chain, recipient,
 * amount}; buying cover or depositing liquidity is a call to the Diamond with
 * calldata, which is what this variant is for. Rift's guide names the endpoint
 * but not its body, so the shape mirrors what the existing signer call already
 * sends for the same operation.
 */
export async function previewUserOperation(
  accessToken: string,
  params: { chain: string; to: string; data?: string; value?: string },
): Promise<PreviewResult> {
  return call("/v1/wallet/user-operations/preview", accessToken, {
    method: "POST",
    body: {
      chain: params.chain,
      transactionData: { to: params.to, data: params.data || "0x", value: params.value || "0" },
      // Sent flat as well: the guide does not state which shape this endpoint
      // expects and an ignored extra field is cheaper than a failed call.
      to: params.to,
      data: params.data || "0x",
      value: params.value || "0",
    },
  });
}

/**
 * Which base64 alphabet the enclave accepts.
 *
 * Rift's schema names the fields cred_id_b64, client_data_json_b64,
 * authenticator_data_b64 and signature_b64 without saying which base64 that
 * is. It matters more than it looks: the front door is Node, whose decoder
 * takes either alphabet happily, but the signing happens inside a Rust enclave
 * — and Rust's base64 crate is strict, so a URL_SAFE decoder handed "+", "/"
 * or "=" simply fails. The enclave then returns null and the API reports
 * "consent factor missing/wrong", which is what came back.
 *
 * WebAuthn uses base64url throughout its own spec, so that is tried first.
 * Whichever succeeds is remembered, so the second prompt happens at most once
 * per browser.
 */
const ALPHABET_KEY = "bfx_v3_b64";
type Alphabet = "url" | "std";

function preferredAlphabet(): Alphabet {
  try {
    const v = localStorage.getItem(ALPHABET_KEY);
    return v === "std" ? "std" : "url";
  } catch {
    return "url";
  }
}

function rememberAlphabet(a: Alphabet): void {
  try {
    localStorage.setItem(ALPHABET_KEY, a);
  } catch {
    /* private mode — pay the retry each time */
  }
}

function inAlphabet(p: AuthProof, a: Alphabet): AuthProof {
  if (p.kind !== "passkey" || a === "std") return p;
  return {
    kind: "passkey",
    cred_id_b64: toB64Url(p.cred_id_b64),
    client_data_json_b64: toB64Url(p.client_data_json_b64),
    authenticator_data_b64: toB64Url(p.authenticator_data_b64),
    signature_b64: toB64Url(p.signature_b64),
  };
}

export async function submitPrepared(
  accessToken: string,
  ticketId: string,
  authProof: AuthProof,
  /** Called when the first alphabet is refused, to obtain a fresh ticket and
   *  proof — the old ticket is single-use and cannot be replayed. */
  reprepare?: () => Promise<{ ticketId: string; authProof: AuthProof }>,
): Promise<{ hash: string; transactionHash?: string; userOperationHash?: string; chainId?: number }> {
  const path = "/v1/wallet/user-operations/submit-prepared";
  const first = preferredAlphabet();

  try {
    const out = await call<any>(path, accessToken, {
      method: "POST",
      body: { ticketId, authProof: inAlphabet(authProof, first) },
    });
    rememberAlphabet(first);
    return out;
  } catch (err) {
    // Any 400 is worth one attempt in the other alphabet. Matching on the
    // wording of the message was too clever: it keyed on "consent factor" and
    // "enclave sign", and the moment Rift changed that text the retry stopped
    // firing silently — so the second alphabet was never actually tried.
    const worthRetrying = err instanceof RiftV3Error && err.status === 400 && !!reprepare;
    if (!worthRetrying) throw err;

    const other: Alphabet = first === "url" ? "std" : "url";
    console.warn(`[rift-v3] enclave refused the ${first} alphabet; re-preparing and trying ${other}`);
    const fresh = await reprepare!();
    const out = await call<any>(path, accessToken, {
      method: "POST",
      body: { ticketId: fresh.ticketId, authProof: inAlphabet(fresh.authProof, other) },
    });
    rememberAlphabet(other);
    return out;
  }
}

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

// ── OIDC (Google) signing ─────────────────────────────────────────────────
//
// A passkey is the primary method for a v3 wallet, but Google is the
// account-recovery lever — if the phone is lost, the id_token from a
// Google sign-in can produce a valid AuthProof because the enclave
// verifies Google's signature and matches the id_token's `nonce` claim
// against the user-operation hash.
//
// One Rift wallet can enrol many Google accounts. Each is a distinct
// EnrolledMethod (kind: "oidc") with its own (iss, sub) pair, and each
// can independently authorise a signature.

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();

/**
 * Decode a Google id_token payload without verifying the signature.
 * The enclave does the verify — we just need `iss` + `sub` for the
 * enrolment payload and `email` for the settings display.
 */
export function decodeOidcMethodFromIdToken(
  idToken: string,
  fallbackIss = "https://accounts.google.com",
): (EnrolledMethod & { email?: string }) | null {
  try {
    const [, payloadB64] = idToken.split(".");
    if (!payloadB64) return null;
    const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(pad);
    const payload = JSON.parse(json) as { iss?: string; sub?: string; email?: string };
    if (!payload?.sub) return null;
    return {
      kind: "oidc",
      iss: payload.iss || fallbackIss,
      sub: payload.sub,
      ...(payload.email ? { email: payload.email } : {}),
    };
  } catch {
    return null;
  }
}

/** Load Google's gsi/client script once, cached across calls. */
let gsiScriptPromise: Promise<void> | null = null;
/**
 * Preload the Google Identity Services script so the first prompt() call
 * doesn't spend hundreds of ms fetching accounts.google.com/gsi/client.
 * Callers (AddMethodWizard, upgrade prompt) invoke this on mount so by
 * the time the user clicks "Continue" the script is ready and the
 * click-to-prompt path has zero awaits.
 */
export function preloadGoogleIdentityScript(): Promise<void> {
  if (!googleSigningConfigured()) return Promise.resolve();
  return loadGoogleIdentityScript().catch(() => {
    /* preload is best-effort; the real call will re-attempt & surface any error */
  });
}

function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if ((window as any).google?.accounts?.id) return Promise.resolve();
  if (gsiScriptPromise) return gsiScriptPromise;
  gsiScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-gsi-client]");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Google Identity script")),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.gsiClient = "1";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Google Identity script"));
    document.head.appendChild(script);
  });
  return gsiScriptPromise;
}

/**
 * Prompt the user with Google's One Tap; if that can't render (mobile
 * Safari, in-app browsers, users not signed in to Google), fall back to
 * the standard "Sign in with Google" button in an overlay. Either way
 * returns a JWT whose `nonce` equals `hashHex` — the shape the enclave
 * needs to verify against the user-operation hash.
 *
 * For signing: pass `hashHex` = user-operation hash.
 * For enrolment: pass any 32 random bytes as hex — the enclave doesn't
 * check nonce on the /methods enrol path.
 */
async function requestGoogleIdToken(hashHex: string, timeoutMs = 90_000): Promise<string> {
  if (!GOOGLE_CLIENT_ID) {
    throw new RiftV3Error("UNSUPPORTED", "Google sign-in isn't configured (VITE_GOOGLE_CLIENT_ID).");
  }
  await loadGoogleIdentityScript();
  const google = (window as any).google;
  if (!google?.accounts?.id) {
    throw new RiftV3Error("UNSUPPORTED", "Google Identity Services failed to load.");
  }
  // Google's `nonce` claim is a string. The hex hash matches what the
  // enclave normalises before comparing to user_op_hash bytes.
  const nonce = hashHex.startsWith("0x") ? hashHex.slice(2) : hashHex;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      try {
        google.accounts.id.cancel();
      } catch {
        /* ignore */
      }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new RiftV3Error("CANCELLED", "Google sign-in timed out."));
    }, timeoutMs);

    try {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        nonce,
        use_fedcm_for_prompt: true,
        callback: (resp: { credential?: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!resp?.credential) {
            reject(new RiftV3Error("CANCELLED", "Google returned no credential."));
            return;
          }
          resolve(resp.credential);
        },
      });
      google.accounts.id.prompt(
        (notification: {
          isNotDisplayed?: () => boolean;
          isSkippedMoment?: () => boolean;
          isDismissedMoment?: () => boolean;
        }) => {
          if (settled) return;
          if (
            notification.isNotDisplayed?.() ||
            notification.isSkippedMoment?.() ||
            notification.isDismissedMoment?.()
          ) {
            showFallbackGoogleButton(google, GOOGLE_CLIENT_ID, nonce, (jwt, err) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              if (err) reject(err);
              else if (jwt) resolve(jwt);
              else reject(new RiftV3Error("CANCELLED", "Google sign-in returned no credential."));
            });
          }
        },
      );
    } catch (e: any) {
      settled = true;
      clearTimeout(timer);
      reject(new RiftV3Error("UNKNOWN", String(e?.message || e)));
    }
  });
}

function showFallbackGoogleButton(
  google: any,
  clientId: string,
  nonce: string,
  done: (jwt: string | null, err?: RiftV3Error) => void,
): void {
  const overlay = document.createElement("div");
  overlay.setAttribute("data-bfx-gsi-fallback", "1");
  // z-index has to sit ABOVE every modal in the app — the AddMethodWizard
  // is at z-[9998] and MethodChooser at z-[9999], so anything under 10000
  // renders behind them and the user can never click the Sign-In button.
  // 2000 (previous) hid the fallback behind the wizard, producing an
  // apparent "Waiting for Google…" hang on step 2.
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:10001;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);";
  const card = document.createElement("div");
  card.style.cssText =
    "background:#fff;border-radius:20px;padding:20px;max-width:340px;width:100%;box-shadow:0 8px 24px rgba(0,0,0,0.15);display:flex;flex-direction:column;gap:12px;align-items:center;text-align:center;";
  const heading = document.createElement("p");
  heading.textContent = "Continue with Google";
  heading.style.cssText = "margin:0;font:600 15px/1.3 system-ui,-apple-system,sans-serif;color:#111;";
  const sub = document.createElement("p");
  sub.textContent = "Tap the button below to sign in.";
  sub.style.cssText = "margin:0;font:400 12px/1.4 system-ui,-apple-system,sans-serif;color:#555;";
  const btnHolder = document.createElement("div");
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.style.cssText =
    "background:transparent;border:0;color:#666;font:500 13px/1 system-ui,-apple-system,sans-serif;padding:8px;margin-top:4px;cursor:pointer;";
  card.append(heading, sub, btnHolder, cancel);
  overlay.append(card);
  document.body.appendChild(overlay);

  const cleanup = () => {
    try {
      overlay.remove();
    } catch {
      /* ignore */
    }
  };
  cancel.onclick = () => {
    cleanup();
    done(null, new RiftV3Error("CANCELLED", "Google sign-in cancelled."));
  };

  try {
    google.accounts.id.initialize({
      client_id: clientId,
      nonce,
      use_fedcm_for_prompt: false,
      callback: (resp: { credential?: string }) => {
        cleanup();
        if (resp?.credential) done(resp.credential);
        else done(null, new RiftV3Error("CANCELLED", "Google returned no credential."));
      },
    });
    google.accounts.id.renderButton(btnHolder, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      logo_alignment: "left",
    });
  } catch (err: any) {
    cleanup();
    done(null, err instanceof RiftV3Error ? err : new RiftV3Error("UNKNOWN", String(err?.message || err)));
  }
}

/** Enrol a Google account: prompts sign-in, returns the EnrolledMethod. */
export async function enrolGoogle(): Promise<EnrolledMethod & { email?: string }> {
  // Random challenge — enrolment doesn't bind to a specific op hash;
  // Rift's /methods endpoint doesn't check nonce, it just extracts sub.
  const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const idToken = await requestGoogleIdToken(randomHex);
  const method = decodeOidcMethodFromIdToken(idToken);
  if (!method) {
    throw new RiftV3Error("UNKNOWN", "Google returned an unreadable token.");
  }
  return method;
}

/** Signs a user-operation hash with Google — the enclave verifies the JWT. */
export async function assertGoogle(hashHex: string): Promise<AuthProof> {
  const idToken = await requestGoogleIdToken(hashHex);
  return { kind: "oidc", id_token: idToken };
}

export function googleSigningConfigured(): boolean {
  return !!GOOGLE_CLIENT_ID;
}
