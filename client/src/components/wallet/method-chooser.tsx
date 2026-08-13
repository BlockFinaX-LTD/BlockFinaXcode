/**
 * method-chooser.tsx — "Which method do you want to sign with?"
 *
 * Only ever renders when a wallet has 2+ enrolled methods (passkey +
 * Google, or multiple Google accounts) AND the caller didn't force a
 * preference. Follows the same singleton pattern as V3SignDialog —
 * mounted once at the app root; v3-sign.ts's produceAuthProof calls
 * askForMethod() which drives this UI.
 *
 * z-index sits ABOVE V3SignDialog because it opens FROM inside the
 * sign flow (user clicked Approve → produceAuthProof needs to know
 * which method → this modal appears on top of the sign dialog).
 * pointer-events-auto + click-stop-propagation guard against parent
 * modal focus-traps swallowing taps.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { FiSmartphone } from "react-icons/fi";
import { subscribeMethodChooser, type PendingChoice } from "@/lib/v3-sign";
import { biometricName } from "@/lib/rift-v3";
import { cn } from "@/lib/utils";

/** Google-brand SVG glyph — inline so no external font/CDN request. */
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
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

export function MethodChooser() {
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // which button is busy

  useEffect(() =>
    subscribeMethodChooser((p) => {
      setPending(p);
      setBusy(null);
    }),
  []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) pending.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, busy]);

  if (!pending) return null;

  const googleOptions = pending.options.filter((o) => o.kind === "oidc");
  const hasPasskey = pending.options.some((o) => o.kind === "passkey");

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
          if (!busy) pending.cancel();
        }}
      >
        <div
          className="absolute inset-0 bg-[#0F2A38]/55 backdrop-blur-[3px]"
          aria-hidden
        />

        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="method-chooser-title"
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
          <div className="mx-auto mb-6 h-1 w-10 rounded-full bg-neutral-200 dark:bg-neutral-700 sm:hidden" />

          <h2
            id="method-chooser-title"
            className="text-center text-[18px] font-semibold text-neutral-900 dark:text-neutral-100"
          >
            Choose signing method
          </h2>
          <p className="mt-2 text-center text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Any enrolled method can approve this. Pick one.
          </p>

          <div className="mt-6 space-y-2">
            {hasPasskey && (
              <MethodButton
                icon={<FiSmartphone className="h-5 w-5" />}
                iconTint="navy"
                label={biometricName()}
                busy={busy === "passkey"}
                disabled={!!busy}
                onClick={() => {
                  setBusy("passkey");
                  pending.pick({ kind: "passkey" });
                }}
              />
            )}

            {googleOptions.map((opt, i) => {
              const key = `oidc-${opt.sub ?? i}`;
              const label = (() => {
                if (opt.label) return opt.label;
                if (googleOptions.length > 1 && opt.sub) {
                  return `Google · ${opt.sub.slice(0, 6)}…`;
                }
                return "Continue with Google";
              })();
              return (
                <MethodButton
                  key={key}
                  icon={<GoogleGlyph className="h-5 w-5" />}
                  iconTint="none"
                  label={label}
                  busy={busy === key}
                  disabled={!!busy}
                  onClick={() => {
                    setBusy(key);
                    pending.pick({ kind: "oidc", sub: opt.sub });
                  }}
                />
              );
            })}

            <button
              type="button"
              disabled={!!busy}
              onClick={pending.cancel}
              className={cn(
                "mt-2 w-full rounded-2xl px-4 py-3",
                "text-[13px] font-medium text-neutral-500 dark:text-neutral-400",
                "transition-colors duration-150",
                "hover:bg-neutral-100 dark:hover:bg-neutral-800",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              Cancel
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * One-tap-per-method button. Shared visual language regardless of icon —
 * passkey button gets an accent-tinted icon frame, Google button stays
 * neutral so Google's coloured glyph carries its own identity.
 */
function MethodButton({
  icon,
  iconTint,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  iconTint: "navy" | "none";
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-4 py-3.5",
        "border border-neutral-200 dark:border-neutral-800",
        "bg-white dark:bg-neutral-900",
        "text-left text-[14px] font-medium text-neutral-900 dark:text-neutral-100",
        "transition-all duration-150",
        "hover:border-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
        "active:scale-[0.995]",
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          iconTint === "navy"
            ? "bg-[hsl(var(--navy))]/10 text-[hsl(var(--navy))]"
            : "bg-neutral-100 dark:bg-neutral-800",
        )}
      >
        {icon}
      </div>
      <span className="flex-1 truncate">{label}</span>
      {busy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400" />
      ) : (
        <svg
          className="h-4 w-4 shrink-0 text-neutral-300 dark:text-neutral-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </button>
  );
}
