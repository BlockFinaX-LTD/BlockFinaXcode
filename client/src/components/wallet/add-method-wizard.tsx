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
 * How it drives the raw addMethod primitive: addMethod takes two async
 * callbacks — `approve(challengeHex)` and `enrolNew()`. Rather than
 * splitting the primitive apart (which would need re-fetching challenges,
 * re-running approve, etc — see git history for the bad version), the
 * wizard hands addMethod callbacks that BLOCK until the user has clicked
 * "Continue" in the corresponding step AND the OS gesture has completed.
 * That way addMethod runs exactly once, exactly as designed, but with UI
 * framing between each of its internal steps.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Check, X, AlertCircle, ShieldCheck } from "lucide-react";
import { FiSmartphone } from "react-icons/fi";
import {
  addMethod,
  createPasskey,
  enrolGoogle,
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
  /** Rift API token — passed straight through to addMethod. */
  accessToken: string;
  /** Display label for passkey enrolment (shown to the user's authenticator). */
  userLabel: string;
  /** Rift user id — passkey rpUserId + preference key. */
  userId: string;
  /**
   * Function that authenticates the user with an ALREADY-enrolled method.
   * Same signature the raw addMethod flow uses. When multiple methods are
   * enrolled this internally shows the pickEnrolledMethod chooser —
   * that's fine, it renders on top of this wizard's step-1 card.
   */
  approveWithExisting: (challengeHex: string) => Promise<AuthProof>;
  onSuccess: () => void;
  onClose: () => void;
}

type Phase =
  | "confirm"     // step 1: waiting for user to click "Continue"
  | "authing"    // step 1 in flight: OS popup #1 fired
  | "enrol"      // step 2: waiting for user to click "Continue"
  | "enroling"   // step 2 in flight: OS popup #2 fired
  | "linking"    // step 3: server POST /methods
  | "done"
  | "error";

const STEP_INDEX: Record<Phase, number> = {
  confirm: 0,
  authing: 0,
  enrol: 1,
  enroling: 1,
  linking: 2,
  done: 2,
  error: 0,
};

/**
 * Waits until the user clicks "Continue" in the current step, returning
 * their choice (`"go"` to fire the gesture, `"cancel"` to abandon the
 * whole flow). Implemented as a promise-per-step that useAddMethodFlow
 * resolves when the user's click handler fires.
 */
interface Gate {
  wait: () => Promise<"go" | "cancel">;
  resolve: (v: "go" | "cancel") => void;
}
function makeGate(): Gate {
  let resolve: (v: "go" | "cancel") => void = () => {};
  const wait = () =>
    new Promise<"go" | "cancel">((r) => {
      resolve = r;
    });
  return {
    wait,
    resolve: (v) => resolve(v),
  };
}

export function AddMethodWizard({
  open,
  newMethodKind,
  accessToken,
  userLabel,
  userId,
  approveWithExisting,
  onSuccess,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [errorRetryPhase, setErrorRetryPhase] = useState<Phase>("confirm");

  // Gates the running addMethod call awaits at each step. Refs so click
  // handlers can resolve them without triggering a re-render loop.
  const confirmGateRef = useRef<Gate | null>(null);
  const enrolGateRef = useRef<Gate | null>(null);
  // Set to true when the wizard is intentionally closing (so the async
  // addMethod driver knows to stop rather than surface a "cancelled" error).
  const closingRef = useRef(false);

  const newMethodName = newMethodKind === "passkey" ? biometricName() : "Google";

  const enterError = (msg: string, retryFrom: Phase) => {
    setErrorMsg(msg);
    setErrorRetryPhase(retryFrom);
    setPhase("error");
  };

  // Drives one full add-method attempt. Re-runnable — used both on first
  // open and on Retry.
  const drive = async () => {
    setPhase("confirm");
    setErrorMsg("");
    confirmGateRef.current = makeGate();
    enrolGateRef.current = makeGate();
    closingRef.current = false;

    try {
      await addMethod(
        accessToken,
        // approve — the "confirm it's you" leg
        async (challengeHex) => {
          const decision = await confirmGateRef.current!.wait();
          if (decision === "cancel") throw new RiftV3Error("CANCELLED", "Cancelled.");
          setPhase("authing");
          try {
            return await approveWithExisting(challengeHex);
          } catch (err: any) {
            if (err instanceof RiftV3Error && err.code === "CANCELLED") {
              // User backed out of the OS popup. Reset step 1 so they can
              // Retry from within the same wizard — don't blow up the whole flow.
              setPhase("confirm");
              confirmGateRef.current = makeGate();
              // Recurse via a fresh await: throw a sentinel here would
              // cascade to error UI, but re-awaiting the gate keeps us
              // in step 1 until the user either retries or cancels.
              const retryDecision = await confirmGateRef.current!.wait();
              if (retryDecision === "cancel") throw new RiftV3Error("CANCELLED", "Cancelled.");
              setPhase("authing");
              return await approveWithExisting(challengeHex);
            }
            throw err;
          }
        },
        // enrolNew — the "add new method" leg
        async () => {
          setPhase("enrol");
          enrolGateRef.current = makeGate();
          const decision = await enrolGateRef.current.wait();
          if (decision === "cancel") throw new RiftV3Error("CANCELLED", "Cancelled.");
          setPhase("enroling");
          try {
            return newMethodKind === "passkey"
              ? await createPasskey(userLabel, userId)
              : await enrolGoogle();
          } catch (err: any) {
            if (err instanceof RiftV3Error && err.code === "CANCELLED") {
              setPhase("enrol");
              enrolGateRef.current = makeGate();
              const retryDecision = await enrolGateRef.current.wait();
              if (retryDecision === "cancel") throw new RiftV3Error("CANCELLED", "Cancelled.");
              setPhase("enroling");
              return newMethodKind === "passkey"
                ? await createPasskey(userLabel, userId)
                : await enrolGoogle();
            }
            throw err;
          }
        },
      );
      // addMethod's third leg (POST /methods) runs synchronously right
      // after enrolNew resolves — from our perspective that's step 3.
      // Show the "linking" spinner briefly so the flow doesn't jump
      // straight from OS popup to success without acknowledgement.
      setPhase("linking");
      // Small buffer so the linking phase is perceivable — the actual
      // POST inside addMethod has already resolved by the time we get here.
      await new Promise((r) => setTimeout(r, 250));
      setPhase("done");
      setTimeout(() => {
        if (!closingRef.current) {
          onSuccess();
          onClose();
        }
      }, 900);
    } catch (err: any) {
      if (closingRef.current) return;
      if (err instanceof RiftV3Error && err.code === "CANCELLED") {
        onClose();
        return;
      }
      const duplicate = err instanceof RiftV3Error && /duplicate/i.test(err.message);
      enterError(
        duplicate
          ? newMethodKind === "passkey"
            ? "This device's passkey is already linked. Open BlockFinaX on the other device and add it there."
            : "This Google account is already linked to your wallet."
          : err instanceof RiftV3Error && err.code === "CHALLENGE_MISSING_OR_EXPIRED"
          ? "That took too long. Try again."
          : err?.message || `Couldn't add ${newMethodName}.`,
        // Reset from step 1 since the challenge is now stale.
        "confirm",
      );
    }
  };

  // Kick the driver every time the wizard opens fresh.
  useEffect(() => {
    if (open) {
      void drive();
    } else {
      // Closing — stop any in-flight gate so drive() unblocks cleanly.
      closingRef.current = true;
      confirmGateRef.current?.resolve("cancel");
      enrolGateRef.current?.resolve("cancel");
    }
    // Intentionally deps: [open]. drive() closes over the callback props
    // but we accept the trade-off — reopening always resets to step 1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const stepIdx = STEP_INDEX[phase];
  const canClose = phase !== "authing" && phase !== "enroling" && phase !== "linking";
  const cancelViaGate = () => {
    // Any pending gate: resolving "cancel" lets drive() unwind and call
    // onClose. Belt & braces: also flip closingRef so the catch block
    // doesn't try to show an error.
    closingRef.current = true;
    confirmGateRef.current?.resolve("cancel");
    enrolGateRef.current?.resolve("cancel");
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9998] flex items-end justify-center p-0 sm:items-center sm:p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (canClose) cancelViaGate();
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
                  onClick={cancelViaGate}
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
                onCta={() => confirmGateRef.current?.resolve("go")}
                onCancel={cancelViaGate}
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
                    <>
                      Your browser will ask for {biometricName()} to create a passkey on this
                      device. Follow the next prompt.
                    </>
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
                onCta={() => enrolGateRef.current?.resolve("go")}
                onCancel={cancelViaGate}
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
                    onClick={() => {
                      // Kick a fresh drive from scratch. Old gates are
                      // stale — drive() creates new ones.
                      void drive();
                      // Local variable so the closure captures the intended
                      // retry point (not currently used but reserved for
                      // more granular retry-from-step-N in future).
                      void errorRetryPhase;
                    }}
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
                    onClick={cancelViaGate}
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
