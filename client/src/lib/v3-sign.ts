/**
 * V3 transaction signing — preview, consent on the device, submit.
 *
 * ## Why there is a confirmation step
 *
 * The obvious shape is: build the operation, then ask the device to sign it.
 * That fails in practice. Browsers require a passkey prompt to follow a recent
 * user gesture, and the preview is a network round-trip — by the time the hash
 * comes back the click that started it has often gone stale, and the prompt is
 * refused with the same NotAllowedError a cancellation produces.
 *
 * So the flow is: preview, then show a dialog whose button supplies a fresh
 * gesture, then sign. The dialog also earns its place on its own terms, since
 * it is the last screen before money moves and can show what is being approved.
 *
 * ## Falling back
 *
 * trySignWithV3 returns null rather than throwing when the wallet is not on v3,
 * has no enrolled method, or the wallet API cannot be reached. The caller then
 * runs the old one-time-code path, so a customer who has not migrated keeps
 * transacting exactly as before. A refusal by the user, or a failure once
 * signing has genuinely started, does throw — that is a real outcome and
 * silently retrying it with a weaker credential would be wrong.
 */

import { getRiftAccessToken } from "./rift-token-bridge";
import {
  getMethods,
  previewTransaction,
  previewUserOperation,
  submitPrepared,
  assertPasskey,
  assertGoogle,
  googleSigningConfigured,
  isSigningReady,
  biometricPrompt,
  noteDeviceSigningDecline,
  wasMigratedLocally,
  passkeysSupported,
  platformAuthenticatorUsable,
  RiftV3Error,
  type AuthProof,
  type EnrolledEntry,
  type MethodsResponse,
} from "./rift-v3";

// ── Signing-state cache ───────────────────────────────────────────────────
//
// A purchase is several calls; asking Rift whether this wallet is on v3 before
// each one is a round-trip that cannot change its answer mid-flow.

let cached: { at: number; state: MethodsResponse } | null = null;
const STATE_TTL_MS = 60_000;

export function clearSigningStateCache(): void {
  cached = null;
}

async function signingState(accessToken: string): Promise<MethodsResponse | null> {
  if (cached && Date.now() - cached.at < STATE_TTL_MS) return cached.state;
  try {
    const state = await getMethods(accessToken);
    cached = { at: Date.now(), state };
    return state;
  } catch (err) {
    console.warn("[v3-sign] couldn't read wallet methods — falling back to a code:", err);
    return null;
  }
}

/**
 * Why device signing was declined, or null if it wasn't.
 *
 * Every branch below used to return null in silence, which is correct
 * behaviour and useless to diagnose: a wallet that never migrated and a wallet
 * whose status call failed produce the same one-time-code prompt, and from the
 * outside they are indistinguishable. Each now names itself.
 */
async function declineReason(accessToken: string | null): Promise<string | null> {
  if (!accessToken) return "no access token — not signed in, or the token refresh failed";

  const state = await signingState(accessToken);
  if (state) {
    if (state.version !== "v3") return `wallet is ${state.version ?? "unknown"}, not v3 — it hasn't migrated`;
    if (!state.enrolled.length) return "wallet is v3 but has no enrolled signing method";
    return null;
  }

  // No status to read. That is not evidence the wallet is un-migrated — the
  // endpoint is absent from Rift's published API reference and may simply not
  // exist. If migration succeeded on this browser we recorded it ourselves,
  // and that is better evidence than a 404.
  if (wasMigratedLocally(null)) {
    console.info("[v3-sign] status endpoint unavailable; using the local migration record");
    return null;
  }
  return "wallet status unreadable and no local migration record — falling back to a code";
}

/** Whether this wallet approves on the device, so no one-time code is needed. */
export async function walletUsesDeviceSigning(): Promise<boolean> {
  try {
    const accessToken = await getRiftAccessToken();
    if (!accessToken) return false;
    const state = await signingState(accessToken);
    return !!state && isSigningReady(state);
  } catch {
    return false;
  }
}

/**
 * The credential ids Rift reports as enrolled.
 *
 * Authoritative in a way nothing on the device is: passkeys created by
 * migrations that failed server-side still exist locally and are
 * indistinguishable to the browser from the one that succeeded.
 */
async function enrolledCredIds(accessToken: string): Promise<string[] | undefined> {
  const state = await signingState(accessToken);
  const ids = state?.passkeyCredIds;
  return Array.isArray(ids) && ids.length ? ids : undefined;
}

// ── The confirmation prompt ───────────────────────────────────────────────

export interface PendingSign {
  title: string;
  detail?: string;
  /** Called from the button, so the passkey prompt has a live user gesture. */
  approve: () => void;
  cancel: () => void;
}

let pending: PendingSign | null = null;
let listener: ((p: PendingSign | null) => void) | null = null;

export function subscribeV3Sign(cb: (p: PendingSign | null) => void): () => void {
  listener = cb;
  cb(pending);
  return () => {
    listener = null;
  };
}

function askToApprove(title: string, detail?: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pending = {
      title,
      detail,
      approve: () => {
        pending = null;
        listener?.(null);
        resolve();
      },
      cancel: () => {
        pending = null;
        listener?.(null);
        reject(new RiftV3Error("CANCELLED", "Cancelled."));
      },
    };
    listener?.(pending);
  });
}

// ── Method chooser ────────────────────────────────────────────────────────
//
// When a wallet has more than one enrolled method (passkey + Google, or
// several Google accounts), signing needs to know which one to try. The
// UI provides a modal via subscribeMethodChooser and resolves the promise
// with the user's pick. Falls through to a passkey default if the chooser
// is never registered (headless test contexts).

export type MethodPick =
  | { kind: "passkey" }
  | { kind: "oidc"; sub?: string };

export interface PendingChoice {
  /** All eligible enrolled methods, so the modal can render one per entry. */
  options: EnrolledEntry[];
  /** Called by the modal after the user picks a method. */
  pick: (choice: MethodPick) => void;
  /** Called when the modal is dismissed without a pick. */
  cancel: () => void;
  /** True after `pick` fires — modal shows a spinner while sign is running. */
  busy?: boolean;
}

let pendingChoice: PendingChoice | null = null;
let chooserListener: ((p: PendingChoice | null) => void) | null = null;

export function subscribeMethodChooser(cb: (p: PendingChoice | null) => void): () => void {
  chooserListener = cb;
  cb(pendingChoice);
  return () => {
    chooserListener = null;
  };
}

/**
 * Public wrapper — opens the method-chooser modal so callers outside
 * the sign path can also ask the user which enrolled method to use.
 *
 * Two callers today:
 *   1. produceAuthProof (internal — signing a transaction)
 *   2. Settings > Signing add-method flow (external — approve adding a
 *      new signing method with one of the existing methods). Without
 *      this, addMethod always fell back to passkey and dead-ended on
 *      the browser's cross-device QR when the passkey wasn't on this
 *      device but Google WAS available.
 */
export function pickEnrolledMethod(options: EnrolledEntry[]): Promise<MethodPick> {
  return askForMethod(options);
}

function askForMethod(options: EnrolledEntry[]): Promise<MethodPick> {
  return new Promise<MethodPick>((resolve, reject) => {
    if (!chooserListener) {
      // No UI mounted — fall back silently. Prefer passkey when it exists.
      const hasPasskey = options.some((o) => o.kind === "passkey");
      resolve(hasPasskey ? { kind: "passkey" } : { kind: "oidc" });
      return;
    }
    pendingChoice = {
      options,
      pick: (choice) => {
        pendingChoice = null;
        chooserListener?.(null);
        resolve(choice);
      },
      cancel: () => {
        pendingChoice = null;
        chooserListener?.(null);
        reject(new RiftV3Error("CANCELLED", "Cancelled."));
      },
    };
    chooserListener?.(pendingChoice);
  });
}

// ── Preferred-method storage ─────────────────────────────────────────────
//
// A user who's picked their preferred method once shouldn't have to pick
// again on every subsequent signature. Remembered per-user (indexed by
// their Rift externalId / user id) so a shared-device scenario doesn't
// pollute another user's preference. Cleared on explicit "change method".

const PREF_KEY = "bfx_v3_preferred_method";

interface PreferredMethods {
  [userId: string]: MethodPick & { savedAt: number };
}

function readPreferences(): PreferredMethods {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") as PreferredMethods;
  } catch {
    return {};
  }
}

export function getPreferredMethod(userId: string | null | undefined): MethodPick | null {
  if (!userId) return null;
  const all = readPreferences();
  const saved = all[userId];
  if (!saved) return null;
  // 30-day TTL so a stale preference doesn't linger if the enrolled
  // methods list has changed.
  if (Date.now() - saved.savedAt > 30 * 24 * 60 * 60 * 1000) return null;
  return { kind: saved.kind, ...(saved.kind === "oidc" && saved.sub ? { sub: saved.sub } : {}) } as MethodPick;
}

export function setPreferredMethod(userId: string | null | undefined, choice: MethodPick): void {
  if (!userId) return;
  try {
    const all = readPreferences();
    all[userId] = { ...choice, savedAt: Date.now() };
    localStorage.setItem(PREF_KEY, JSON.stringify(all));
  } catch {
    /* private mode — pay the chooser each time */
  }
}

export function forgetPreferredMethod(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    const all = readPreferences();
    delete all[userId];
    localStorage.setItem(PREF_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

// ── Cascade: which auth proof to produce for a given hash ────────────────
//
// Follows Rift's `resolveAuthProof` shape:
//   - preference "auto": if user has a saved preferred method, use it;
//     if multiple methods enrolled, pop the chooser; else use the only one
//   - preference "passkey" or "google": use that, throw if not enrolled
// Passkey failures inside "auto" transparently cascade to Google when it's
// also enrolled — saves a full transaction retry when the OS prompt hiccups.

export type SigningPreference = "auto" | "passkey" | "google";

async function produceAuthProof(
  accessToken: string,
  hashHex: string,
  preference: SigningPreference,
  userId: string | null,
): Promise<AuthProof> {
  const state = await signingState(accessToken);
  const enrolled = state?.enrolled ?? [];
  const hasPasskey = enrolled.some((e) => e.kind === "passkey");
  const oidcOptions = enrolled.filter((e) => e.kind === "oidc");
  const hasGoogle = oidcOptions.length > 0 && googleSigningConfigured();

  // Whether the passkey can actually be presented here, not just whether the
  // browser has the API. Only meaningful when there is somewhere else to go:
  // with no Google linked we attempt the passkey regardless, because a failed
  // attempt at the only enrolled method beats refusing to try it.
  const canPasskey = hasPasskey && (!hasGoogle || (await platformAuthenticatorUsable()));

  const usePasskey = async (): Promise<AuthProof> =>
    assertPasskey(hashHex, await enrolledCredIds(accessToken));
  const useGoogle = async (): Promise<AuthProof> => assertGoogle(hashHex);

  // Explicit overrides — the caller (or the chooser) has already decided.
  if (preference === "passkey") {
    if (!passkeysSupported() || !hasPasskey) {
      throw new RiftV3Error("UNSUPPORTED", "No passkey enrolled for this wallet.");
    }
    return usePasskey();
  }
  if (preference === "google") {
    if (!hasGoogle) {
      throw new RiftV3Error("UNSUPPORTED", "No Google account linked to this wallet.");
    }
    // No passkey fallback here, deliberately. This branch is only reached when
    // the user picked Google — from the chooser, or because the passkey is
    // already known not to work. Quietly trying the passkey anyway means the
    // answer to "Google didn't work" is a WebAuthn prompt, and when the
    // credential lives on another device that prompt is a cross-device QR
    // code: an unreadable answer to a question the user didn't ask, with the
    // actual Google error swallowed on the way past. Whatever went wrong here
    // needs to reach the user, because it is usually configuration.
    return useGoogle();
  }

  // "auto" mode from here.
  const saved = getPreferredMethod(userId);
  if (saved) {
    const usable =
      (saved.kind === "passkey" && canPasskey) || (saved.kind === "oidc" && hasGoogle);
    const alternatives = (canPasskey ? 1 : 0) + (hasGoogle ? oidcOptions.length : 0);
    if (usable) {
      try {
        return await (saved.kind === "passkey" ? usePasskey() : useGoogle());
      } catch (err) {
        // A remembered choice that just failed must not stay remembered. It
        // used to: the attempt was a bare return, so the throw ended the
        // signing and left the preference behind to do exactly the same thing
        // next time. For a passkey enrolled on another device that is a
        // permanent trap — every payment opens a cross-device QR, cancelling
        // it is the only way out, and the Google account on the same wallet is
        // never reached.
        //
        // Forgetting on cancellation too, not just on error. Someone who
        // dismisses a QR they cannot use has refused that method, not the
        // payment, and the two are indistinguishable from here. The cost of
        // being wrong is one extra tap on the chooser; the cost of the trap is
        // a wallet nobody can spend from.
        if (!alternatives || alternatives === 1) throw err;
        forgetPreferredMethod(userId);
        console.warn("[v3-sign] remembered method failed — asking again", err);
      }
    }
    // Saved preference is stale (method removed) — fall through to chooser.
  }

  // Only one usable method → don't ask, just sign.
  if (hasPasskey && !hasGoogle) return usePasskey();
  if (hasGoogle && !hasPasskey && oidcOptions.length === 1) return useGoogle();

  // Multiple enrolled methods — pop the chooser.
  const eligible: EnrolledEntry[] = [
    ...(canPasskey ? [{ kind: "passkey" as const, label: "This device" }] : []),
    ...(hasGoogle ? oidcOptions : []),
  ];
  if (eligible.length === 0) {
    throw new RiftV3Error("UNSUPPORTED", "No enrolled method can sign on this browser.");
  }
  if (eligible.length === 1) {
    // Passkey unsupported but multiple Google accounts, OR everything
    // filtered to one option. Still no chooser needed.
    return eligible[0].kind === "passkey" ? usePasskey() : useGoogle();
  }
  const pick = await askForMethod(eligible);
  setPreferredMethod(userId, pick);
  try {
    if (pick.kind === "passkey") return await usePasskey();
    return await useGoogle();
  } catch (err) {
    // The pick failed. Don't leave the stale preference behind — next attempt
    // should re-ask so the user can pick the working method.
    forgetPreferredMethod(userId);
    throw err;
  }
}

// ── The flow ──────────────────────────────────────────────────────────────

export interface ContractCall {
  chain: string;
  to: string;
  data?: string;
  value?: string;
}

/**
 * Signs a contract call with the user's device, or returns null if this wallet
 * cannot yet do that.
 *
 * Null means "not applicable, use the old path". Throwing means the device
 * signing was attempted and did not succeed.
 */
export async function trySignWithV3(
  call: ContractCall,
  opts: {
    title?: string;
    detail?: string;
    onStep?: (s: string) => void;
    /** Force a specific method for this signature. "auto" (default) uses the
     *  saved preference or asks. Set from a "Sign with Google" fallback UI. */
    preference?: SigningPreference;
    /** Rift user id (externalId or Rift user id). Preference is stored per
     *  user so a shared browser doesn't pollute another account's default. */
    userId?: string | null;
  } = {},
): Promise<string | null> {
  let accessToken = "";
  try {
    accessToken = await getRiftAccessToken();
  } catch (err) {
    console.warn("[v3-sign] no access token:", err);
  }

  const reason = await declineReason(accessToken || null);
  noteDeviceSigningDecline(reason);
  if (reason) {
    console.warn(`[v3-sign] using the one-time-code path — ${reason}`);
    return null;
  }
  console.info("[v3-sign] signing on this device — no code will be sent");

  opts.onStep?.("Preparing transaction…");
  let preview;
  try {
    preview = await previewUserOperation(accessToken, call);
  } catch (err) {
    // The wallet is on v3 but the preview endpoint refused. That is worth
    // knowing about rather than quietly reverting to a one-time code, because
    // the fallback would still work and the bug would stay hidden.
    console.error("[v3-sign] preview failed:", err);
    throw err;
  }
  if (!preview?.userOpHashHex || !preview?.ticketId) {
    throw new RiftV3Error("UNKNOWN", "Rift didn't return an operation to sign.");
  }

  await askToApprove(opts.title ?? "Approve this transaction", opts.detail);

  opts.onStep?.(biometricPrompt());
  const preference: SigningPreference = opts.preference ?? "auto";
  const proof = await produceAuthProof(accessToken, preview.userOpHashHex, preference, opts.userId ?? null);

  opts.onStep?.("Submitting…");
  const res = await submitPrepared(accessToken, preview.ticketId, proof, async () => {
    // The ticket is single-use, so a second attempt needs a fresh one — and a
    // fresh hash means a fresh signature, hence a second prompt. This happens
    // at most once per browser; the working alphabet is remembered.
    const again = await previewUserOperation(accessToken, call);
    return {
      ticketId: again.ticketId,
      authProof: await produceAuthProof(accessToken, again.userOpHashHex, preference, opts.userId ?? null),
    };
  });
  const hash = res?.hash || res?.transactionHash;
  if (!hash) throw new RiftV3Error("UNKNOWN", "Rift returned no transaction hash.");
  return hash;
}

export interface TokenTransfer {
  token: string;
  chain: string;
  recipient: string;
  amount: string;
}

/**
 * The same flow for a plain token transfer.
 *
 * Separate from trySignWithV3 only because Rift builds the two operations from
 * different endpoints — a transfer is described by token and amount, a contract
 * call by calldata. Everything after the preview is identical.
 */
export async function trySendTokenWithV3(
  transfer: TokenTransfer,
  opts: {
    detail?: string;
    onStep?: (s: string) => void;
    preference?: SigningPreference;
    userId?: string | null;
  } = {},
): Promise<string | null> {
  let accessToken = "";
  try {
    accessToken = await getRiftAccessToken();
  } catch (err) {
    console.warn("[v3-sign] no access token:", err);
  }

  const reason = await declineReason(accessToken || null);
  noteDeviceSigningDecline(reason);
  if (reason) {
    console.warn(`[v3-sign] using the one-time-code path — ${reason}`);
    return null;
  }
  console.info("[v3-sign] signing on this device — no code will be sent");

  opts.onStep?.("Preparing transfer…");
  const preview = await previewTransaction(accessToken, transfer);
  if (!preview?.userOpHashHex || !preview?.ticketId) {
    throw new RiftV3Error("UNKNOWN", "Rift didn't return an operation to sign.");
  }

  await askToApprove(
    `Send ${transfer.amount} ${transfer.token}`,
    opts.detail ?? `To ${transfer.recipient.slice(0, 10)}…${transfer.recipient.slice(-4)} on ${transfer.chain}`,
  );

  opts.onStep?.(biometricPrompt());
  const preference: SigningPreference = opts.preference ?? "auto";
  const proof = await produceAuthProof(accessToken, preview.userOpHashHex, preference, opts.userId ?? null);

  opts.onStep?.("Submitting…");
  const res = await submitPrepared(accessToken, preview.ticketId, proof, async () => {
    const again = await previewTransaction(accessToken, transfer);
    return {
      ticketId: again.ticketId,
      authProof: await produceAuthProof(accessToken, again.userOpHashHex, preference, opts.userId ?? null),
    };
  });
  const hash = res?.hash || res?.transactionHash;
  if (!hash) throw new RiftV3Error("UNKNOWN", "Rift returned no transaction hash.");
  return hash;
}
