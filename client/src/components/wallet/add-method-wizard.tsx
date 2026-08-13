/**
 * add-method-wizard.tsx — full-modal wizard for the add-recovery-method flow.
 *
 * The problem it solves: adding a new signing method fires TWO native OS
 * popups back-to-back (authenticate with your existing method, then enrol
 * the new one). Both look identical from the OS's perspective (same Google
 * account chooser, same Touch ID prompt) so users cancel the wrong one or
 * accept the wrong account. This wizard wraps both gestures in an in-app
 * modal that names each step BEFORE the popup fires:
 *
 *   Step 1 of 3 — "Confirm it's you"        → then OS popup #1
 *   Step 2 of 3 — "Add your new {method}"   → then OS popup #2
 *   Step 3 of 3 — "Linking to your wallet…" → server /methods call
 *
 * ── Popup-blocker constraint ───────────────────────────────────────────
 *
 * Browsers block `navigator.credentials.get()` and OAuth `window.open()`
 * when they aren't invoked in the SAME task as a user gesture. That means:
 *
 *   ❌ click → resolve async gate → driver awaits → calls gesture   (blocked)
 *   ✅ click → SYNC call to gesture, THEN await its promise         (allowed)
 *
 * So the wizard doesn't route clicks through Promise gates. Each step's
 * "Continue" button synchronously invokes the gesture function; the
 * wizard's state machine is a plain useState progression driven by
 * .then() callbacks. The challenge is fetched on mount, ahead of step 1,
 * so step 1's click has zero awaits before hitting the WebAuthn / OAuth
 * call.
 *
 * The server /methods finalise call runs at the end via addMethod's own
 * pass-through form — we hand it already-produced authProof and newMethod
 * via callback stubs, so addMethod only really does the POST.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Check, X, AlertCircle, ShieldCheck } from "lucide-react";
import { FiSmartphone } from "react-icons/fi";
import {
  createPasskey,
  enrolGoogle,
  fetchAddMethodChallenge,
  finaliseAddMethod,
  preloadGoogleIdentityScript,
  RiftV3Error,
  biometricName,
  type AuthProof,
  type EnrolledMethod,
} from "@/lib/rift-v3";
import { cn } from "@/lib/utils";

export type NewMethodKind = "passkey" | "oidc";

interface Props {
  open: boolean;
  /** Kind of method being added. */
  newMethodKind: NewMethodKind;
  /** Rift API token. */
  accessToken: string;
  /** Passkey userName presented to the platform authenticator. */
  userLabel: string;
  /** Rift user id — passkey rpUserId + preference key. */
  userId: string;
  /**
   * Every passkey cred_id already enrolled for this wallet. Passed to
   * navigator.credentials.create as excludeCredentials so the browser
   * surfaces "use another device" (QR) instead of silently reusing the
   * current authenticator and looping on duplicate registration.
   */
  existingPasskeyCredIds?: string[];
  /**
   * Authenticates the user with an already-enrolled method. Same signature
   * signing-methods.tsx uses today. May itself open a sub-picker when
   * multiple methods are enrolled — that's fine, it renders on top of
   * this wizard's step-1 card.
   */
  approveWithExisting: (challengeHex: string) => Promise<AuthProof>;
  onSuccess: () => void;
  onClose: () => void;
}

type Phase =
  | "loading"    // fetching the challenge — briefly, before step 1
  | "confirm"    // step 1: waiting for click
  | "authing"    // step 1 in flight: OS popup #1 fired
  | "enrol"      // step 2: waiting for click
  | "enroling"   // step 2 in flight: OS popup #2 fired
  | "linking"    // step 3: server POST /methods
  | "done"
  | "error";

const STEP_INDEX: Record<Phase, number> = {
  loading: 0,
  confirm: 0,
  authing: 0,
  enrol: 1,
  enroling: 1,
  linking: 2,
  done: 2,
  error: 0,
};

export function AddMethodWizard({
  open,
  newMethodKind,
  accessToken,
  userLabel,
  userId,
  existingPasskeyCredIds,
  approveWithExisting,
  onSuccess,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  // Cached across steps: fetched on mount, consumed by step 1's click.
  const challengeRef = useRef<string | null>(null);
  // Filled by step 1's OS popup, consumed by step 3's finalise.
  const authProofRef = useRef<AuthProof | null>(null);
  // Filled by step 2's OS popup, consumed by step 3's finalise.
  const newMethodRef = useRef<EnrolledMethod | null>(null);
  // Guards against onSuccess/onClose firing after the wizard has been
  // closed manually (avoids stale-callback races when the user hits X
  // mid-flight).
  const closedRef = useRef(false);

  const newMethodName = newMethodKind === "passkey" ? biometricName() : "Google";

  // Pre-fetch the challenge on open so step 1's click can hit the OS
  // popup with zero awaits between click and navigator.credentials.get().
  // Also warm the Google Identity Services script so a Google gesture
  // doesn't spend hundreds of ms fetching gsi/client under the user's
  // click activation and lose it.
  useEffect(() => {
    if (!open) return;
    closedRef.current = false;
    challengeRef.current = null;
    authProofRef.current = null;
    newMethodRef.current = null;
    setErrorMsg("");
    setPhase("loading");
    void preloadGoogleIdentityScript();
    void (async () => {
      try {
        const ch = await fetchChallenge(accessToken);
        if (closedRef.current) return;
        challengeRef.current = ch;
        setPhase("confirm");
      } catch (err: any) {
        if (closedRef.current) return;
        setErrorMsg(err?.message || "Couldn't start. Try again.");
        setPhase("error");
      }
    })();
    return () => {
      closedRef.current = true;
    };
  }, [open, accessToken]);

  // ── Step 1 click — MUST call approveWithExisting synchronously ──────────
  //
  // Any await here between the click and the gesture call would lose user
  // activation and get the popup blocked. `approveWithExisting` returns a
  // Promise but the gesture call itself (navigator.credentials.get /
  // google.accounts.oauth2.requestAccessToken) fires synchronously inside
  // it — so calling this function from within the click handler is safe.
  const onConfirmClick = () => {
    const challenge = challengeRef.current;
    if (!challenge) return; // shouldn't happen — button is disabled while loading
    setPhase("authing");
    approveWithExisting(challenge)
      .then((proof) => {
        if (closedRef.current) return;
        authProofRef.current = proof;
        setPhase("enrol");
      })
      .catch((err: any) => {
        if (closedRef.current) return;
        if (err instanceof RiftV3Error && err.code === "CANCELLED") {
          setPhase("confirm");
          return;
        }
        setErrorMsg(
          err instanceof RiftV3Error && err.code === "CHALLENGE_MISSING_OR_EXPIRED"
            ? "That took too long. Try again."
            : err?.message || "Couldn't confirm it's you.",
        );
        setPhase("error");
      });
  };

  // ── Step 2 click — MUST call createPasskey/enrolGoogle synchronously ────
  const onEnrolClick = () => {
    setPhase("enroling");
    const enrolPromise =
      newMethodKind === "passkey"
        ? createPasskey(userLabel, userId, {
            // Pass every enrolled cred_id so the browser knows to surface
            // "use another device" (QR) rather than silently re-registering
            // the current authenticator and looping on duplicate errors.
            excludeCredIds: existingPasskeyCredIds ?? [],
          })
        : enrolGoogle();
    enrolPromise
      .then((method) => {
        if (closedRef.current) return;
        newMethodRef.current = method;
        // Server finalise — no gesture, safe to run inline.
        void runLink();
      })
      .catch((err: any) => {
        if (closedRef.current) return;
        if (err instanceof RiftV3Error && err.code === "CANCELLED") {
          setPhase("enrol");
          return;
        }
        setErrorMsg(err?.message || `Couldn't add ${newMethodName}.`);
        setPhase("error");
      });
  };

  const runLink = async () => {
    const proof = authProofRef.current;
    const method = newMethodRef.current;
    if (!proof || !method) {
      setErrorMsg("Lost track of the confirmation. Try again.");
      setPhase("error");
      return;
    }
    setPhase("linking");
    try {
      // POST /methods directly with the already-produced proof + method.
      // Using addMethod() here would re-fetch a fresh challenge, and the
      // server would verify our authProof (bound to the wizard-open
      // challenge) against the new challenge — mismatch → RESEAL_FAILED.
      // finaliseAddMethod hits /methods without a challenge fetch.
      await finaliseAddMethod(accessToken, proof, method);
      if (closedRef.current) return;
      setPhase("done");
      setTimeout(() => {
        if (closedRef.current) return;
        onSuccess();
        onClose();
      }, 900);
    } catch (err: any) {
      if (closedRef.current) return;
      const duplicate = err instanceof RiftV3Error && /duplicate/i.test(err.message);
      setErrorMsg(
        duplicate
          ? newMethodKind === "passkey"
            ? "This device's passkey is already linked. Open BlockFinaX on the other device and add it there."
            : "This Google account is already linked to your wallet."
          : err instanceof RiftV3Error && err.code === "CHALLENGE_MISSING_OR_EXPIRED"
          ? "That took too long. Try again from step 1."
          : err?.message || `Couldn't link ${newMethodName}. Try again.`,
      );
      setPhase("error");
    }
  };

  // Retry re-runs from step 1 with a fresh challenge (addMethod's
  // /methods call rejects a re-used challenge, and the auth-proof is
  // bound to it, so once step 3 errors we need to redo everything).
  const onRetry = () => {
    challengeRef.current = null;
    authProofRef.current = null;
    newMethodRef.current = null;
    setErrorMsg("");
    setPhase("loading");
    void (async () => {
      try {
        const ch = await fetchChallenge(accessToken);
        if (closedRef.current) return;
        challengeRef.current = ch;
        setPhase("confirm");
      } catch (err: any) {
        if (closedRef.current) return;
        setErrorMsg(err?.message || "Couldn't start. Try again.");
        setPhase("error");
      }
    })();
  };

  const doClose = () => {
    closedRef.current = true;
    onClose();
  };

  if (!open) return null;

  const stepIdx = STEP_INDEX[phase];
  const canClose = phase !== "authing" && phase !== "enroling" && phase !== "linking";

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[220] flex items-end justify-center p-0 sm:items-center sm:p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (canClose) doClose();
        }}
      >
        <div
          className="absolute inset-0 bg-[#0F2A38]/60 backdrop-blur-[3px]"
          aria-hidden
        />

        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-method-title"
          className={cn(
            "relative w-full max-w-md",
            "bg-white dark:bg-neutral-900",
            "rounded-t-3xl sm:rounded-3xl",
            "shadow-2xl",
            "overflow-hidden",
          )}
          initial={{ y: 40, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header: title + close, plus progress rail */}
          <div className="px-6 pt-6">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-200 dark:bg-neutral-700 sm:hidden" />

            <div className="flex items-center justify-between">
              <h2
                id="add-method-title"
                className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Add a signing method
              </h2>
              {canClose && (
                <button
                  aria-label="Close"
                  onClick={doClose}
                  className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {phase !== "done" && phase !== "error" && (
              <ProgressRail activeIdx={stepIdx} />
            )}
          </div>

          {/* Body — switches per phase */}
          <div className="px-6 pb-6 pt-4">
            {phase === "loading" && (
              <div className="flex flex-col items-center py-8 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
                <p className="mt-3 text-[12px] text-neutral-500 dark:text-neutral-400">
                  Getting ready…
                </p>
              </div>
            )}

            {(phase === "confirm" || phase === "authing") && (
              <StepBody
                stepLabel="Step 1 of 3"
                title="Confirm it's you"
                icon={<ShieldCheck className="h-6 w-6 text-[hsl(var(--navy))]" />}
                body={
                  <>
                    To add {newMethodName === "Google" ? "a Google account" : `a new ${newMethodName}`},
                    first prove it's you with a method you already have.
                  </>
                }
                cta="Continue"
                ctaBusy={phase === "authing"}
                ctaBusyLabel="Waiting for confirmation…"
                onCta={onConfirmClick}
                onCancel={doClose}
              />
            )}

            {(phase === "enrol" || phase === "enroling") && (
              <StepBody
                stepLabel="Step 2 of 3"
                title={newMethodKind === "passkey" ? "Add your new device" : "Add your new Google account"}
                icon={
                  newMethodKind === "passkey" ? (
                    <FiSmartphone className="h-6 w-6 text-[hsl(var(--navy))]" />
                  ) : (
                    <GoogleGlyph className="h-6 w-6" />
                  )
                }
                body={
                  newMethodKind === "passkey" ? (
                    (existingPasskeyCredIds?.length ?? 0) > 0 ? (
                      <>
                        Your browser will ask you to add a passkey. Use {biometricName()} on
                        this device, or pick "use another device" / "use a phone" to scan a
                        QR code with a different phone.
                      </>
                    ) : (
                      <>
                        Your browser will ask for {biometricName()} to create a passkey on
                        this device. Follow the next prompt.
                      </>
                    )
                  ) : (
                    <>
                      Your browser will open a Google account chooser. Pick the account you want
                      to link — it doesn't have to be the one you used to sign in.
                    </>
                  )
                }
                cta="Continue"
                ctaBusy={phase === "enroling"}
                ctaBusyLabel={
                  newMethodKind === "passkey"
                    ? `Waiting for ${biometricName()}…`
                    : "Waiting for Google…"
                }
                onCta={onEnrolClick}
                onCancel={doClose}
              />
            )}

            {phase === "linking" && (
              <div className="flex flex-col items-center py-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--navy))]" />
                <p className="mt-4 text-[14px] font-medium text-neutral-900 dark:text-neutral-100">
                  Linking to your wallet…
                </p>
                <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
                  Almost done — one moment.
                </p>
              </div>
            )}

            {phase === "done" && (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                  <Check className="h-7 w-7 text-green-600 dark:text-green-400" />
                </div>
                <p className="mt-4 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
                  {newMethodName} added
                </p>
                <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
                  You can now approve payments with it.
                </p>
              </div>
            )}

            {phase === "error" && (
              <div className="py-2">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 dark:bg-red-950/30">
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
                      Couldn't finish
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                      {errorMsg}
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex gap-2">
                  <button
                    type="button"
                    onClick={onRetry}
                    className={cn(
                      "flex-1 rounded-2xl bg-[hsl(var(--navy))] px-4 py-3",
                      "text-[14px] font-semibold text-white",
                      "hover:opacity-95 transition-opacity duration-150",
                    )}
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={doClose}
                    className={cn(
                      "rounded-2xl border border-neutral-200 dark:border-neutral-800 px-4 py-3",
                      "text-[14px] font-medium text-neutral-600 dark:text-neutral-400",
                      "hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors duration-150",
                    )}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ProgressRail({ activeIdx }: { activeIdx: number }) {
  return (
    <div className="mt-4 flex items-center gap-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors duration-200",
            i <= activeIdx
              ? "bg-[hsl(var(--navy))]"
              : "bg-neutral-200 dark:bg-neutral-800",
          )}
        />
      ))}
    </div>
  );
}

function StepBody({
  stepLabel,
  title,
  icon,
  body,
  cta,
  ctaBusy,
  ctaBusyLabel,
  onCta,
  onCancel,
}: {
  stepLabel: string;
  title: string;
  icon: React.ReactNode;
  body: React.ReactNode;
  cta: string;
  ctaBusy: boolean;
  ctaBusyLabel: string;
  onCta: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
        {stepLabel}
      </p>

      <div className="mt-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--navy))]/10">
        {icon}
      </div>

      <h3 className="mt-4 text-[18px] font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        {body}
      </p>

      <div className="mt-6 space-y-2">
        <button
          type="button"
          disabled={ctaBusy}
          onClick={onCta}
          className={cn(
            "flex w-full items-center justify-center gap-2",
            "rounded-2xl bg-[hsl(var(--navy))] px-4 py-3",
            "text-[14px] font-semibold text-white",
            "hover:opacity-95 transition-opacity duration-150",
            "disabled:opacity-60 disabled:cursor-not-allowed",
          )}
        >
          {ctaBusy && <Loader2 className="h-4 w-4 animate-spin" />}
          <span>{ctaBusy ? ctaBusyLabel : cta}</span>
        </button>
        {!ctaBusy && (
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              "w-full rounded-2xl px-4 py-2",
              "text-[13px] font-medium text-neutral-500 dark:text-neutral-400",
              "hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors duration-150",
            )}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

// Challenge fetch lives in rift-v3.ts (fetchAddMethodChallenge) so it
// reuses the same callWallet base+prefix plumbing as every other call.
const fetchChallenge = fetchAddMethodChallenge;
