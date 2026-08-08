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
  isSigningReady,
  RiftV3Error,
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
  } catch {
    return null;
  }
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
  opts: { title?: string; detail?: string; onStep?: (s: string) => void } = {},
): Promise<string | null> {
  let accessToken: string;
  try {
    accessToken = await getRiftAccessToken();
  } catch {
    return null;
  }
  if (!accessToken) return null;

  const state = await signingState(accessToken);
  if (!state || !isSigningReady(state)) return null;

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

  opts.onStep?.("Waiting for your fingerprint…");
  const proof = await assertPasskey(preview.userOpHashHex);

  opts.onStep?.("Submitting…");
  const res = await submitPrepared(accessToken, preview.ticketId, proof);
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
  opts: { detail?: string; onStep?: (s: string) => void } = {},
): Promise<string | null> {
  let accessToken: string;
  try {
    accessToken = await getRiftAccessToken();
  } catch {
    return null;
  }
  if (!accessToken) return null;

  const state = await signingState(accessToken);
  if (!state || !isSigningReady(state)) return null;

  opts.onStep?.("Preparing transfer…");
  const preview = await previewTransaction(accessToken, transfer);
  if (!preview?.userOpHashHex || !preview?.ticketId) {
    throw new RiftV3Error("UNKNOWN", "Rift didn't return an operation to sign.");
  }

  await askToApprove(
    `Send ${transfer.amount} ${transfer.token}`,
    opts.detail ?? `To ${transfer.recipient.slice(0, 10)}…${transfer.recipient.slice(-4)} on ${transfer.chain}`,
  );

  opts.onStep?.("Waiting for your fingerprint…");
  const proof = await assertPasskey(preview.userOpHashHex);

  opts.onStep?.("Submitting…");
  const res = await submitPrepared(accessToken, preview.ticketId, proof);
  const hash = res?.hash || res?.transactionHash;
  if (!hash) throw new RiftV3Error("UNKNOWN", "Rift returned no transaction hash.");
  return hash;
}
