/**
 * v3-sign-dialog.tsx — the single sign approval dialog.
 *
 * Singleton, mounted at the app root next to <MethodChooser/>. Every
 * v3 signing path (send, hedge, bridge, add-to-pool, buy-cover, claim,
 * etc.) opens this modal AFTER preview and BEFORE the platform passkey
 * prompt. Its "Approve" button click is what supplies the fresh user
 * gesture WebAuthn requires — without this dialog the passkey prompt
 * is refused with "document not focused" on iOS Safari and Chrome.
 *
 * Visual language mirrors Rift's own send-flow modal:
 *   - deep-teal wash backdrop, blurred
 *   - white card with 3xl rounding on desktop, top-3xl bottom-sheet on
 *     mobile so the thumb doesn't have to reach the middle of the screen
 *   - accent-primary tinted icon frame (soft) around a padlock glyph
 *   - motion enter/exit so it doesn't just pop in
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { subscribeV3Sign, type PendingSign } from "@/lib/v3-sign";
import { biometricName } from "@/lib/rift-v3";
import { cn } from "@/lib/utils";

/**
 * Custom padlock SVG — matches the shape Rift's v3-enrolment-banner uses
 * so the two dialogs feel like they came from the same designer.
 * Deliberately not lucide's Lock — this one has a chunkier proportion
 * that reads as "secure your money" not "settings gear".
 */
function LockGlyph({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" />
    </svg>
  );
}

export function V3SignDialog() {
  const [pending, setPending] = useState<PendingSign | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() =>
    subscribeV3Sign((p) => {
      setPending(p);
      setBusy(false);
    }),
  []);

  // Escape / backdrop dismiss — but never while a signature is mid-flight.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) pending.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, busy]);

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          className="fixed inset-0 z-[210] flex items-end justify-center p-0 sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => !busy && pending.cancel()}
        >
          {/* Backdrop wash — deep teal + blur. Matches Rift's send modal. */}
          <div
            className="absolute inset-0 bg-[#0F2A38]/55 backdrop-blur-[3px]"
            aria-hidden
          />

          {/* Card — bottom-sheet on mobile, centred card on desktop. */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="v3-sign-title"
            className={cn(
              "relative w-full max-w-md",
              "bg-white dark:bg-neutral-900",
              "rounded-t-3xl sm:rounded-3xl",
              "shadow-2xl",
              "px-6 pt-8 pb-6",
            )}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grabber (mobile only) — visual cue this is dismissable */}
            <div className="mx-auto mb-6 h-1 w-10 rounded-full bg-neutral-200 dark:bg-neutral-700 sm:hidden" />

            {/* Icon tile */}
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--navy))]/10">
              <LockGlyph className="h-7 w-7 text-[hsl(var(--navy))]" />
            </div>

            {/* Title + detail */}
            <h2
              id="v3-sign-title"
              className="text-center text-[18px] font-semibold leading-tight text-neutral-900 dark:text-neutral-100"
            >
              {pending.title}
            </h2>
            <p className="mt-2 text-center text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              {pending.detail ?? `You'll approve this with ${biometricName()}.`}
            </p>

            {/* Actions */}
            <div className="mt-6 space-y-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  // MUST fire from inside this handler — the passkey
                  // prompt only accepts recent user activation, and the
                  // preview round-trip already burned the click that
                  // opened this dialog.
                  setBusy(true);
                  pending.approve();
                }}
                className={cn(
                  "flex w-full items-center justify-center gap-2",
                  "rounded-2xl bg-[hsl(var(--navy))] px-4 py-3.5",
                  "text-[14px] font-semibold text-white",
                  "transition-opacity duration-150",
                  "hover:opacity-95 active:opacity-90",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                )}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Waiting for {biometricName()}…</span>
                  </>
                ) : (
                  <span>Approve</span>
                )}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={pending.cancel}
                className={cn(
                  "w-full rounded-2xl px-4 py-3",
                  "text-[13px] font-medium text-neutral-500 dark:text-neutral-400",
                  "transition-colors duration-150",
                  "hover:bg-neutral-100 dark:hover:bg-neutral-800",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                )}
              >
                Cancel
              </button>
            </div>

            {/* Footer — non-custodial trust marker. Kept quiet but present. */}
            <p className="mt-5 text-center text-[11px] leading-snug text-neutral-400 dark:text-neutral-500">
              BlockFinaX can't sign for you. Only your device holds the key.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
