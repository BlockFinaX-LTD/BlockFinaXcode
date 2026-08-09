/**
 * signing-methods.tsx — the migration prompt and the settings screen.
 *
 * Two surfaces over one idea: which credentials can authorise a
 * payment from this wallet. Visual language mirrors Rift's
 * v3-enrolment-banner + wallet-methods settings — deep-teal accent,
 * rounded-2xl+3xl cards, custom lock/Google/passkey glyphs, motion
 * animations, brand-neutral copy.
 *
 * Migration prompt is dismissible per session — Rift's guide is
 * explicit that v1/v2 wallets keep working; gating a customer out of
 * their money to push a security upgrade is a worse outcome than the
 * upgrade is a benefit. Adding a second method is where we push
 * harder — a single passkey on a single device is one lost phone
 * away from a support ticket.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2, Plus, X, ChevronRight } from "lucide-react";
import { FiSmartphone } from "react-icons/fi";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  diagnostics,
  getDeviceSigningDecline,
  getMethods,
  wasMigratedLocally,
  migrateToV3,
  createPasskey,
  assertPasskey,
  assertGoogle,
  enrolGoogle,
  googleSigningConfigured,
  addMethod,
  passkeysSupported,
  isSigningReady,
  RiftV3Error,
  biometricName,
  type MethodsResponse,
  type EnrolledMethod,
  type V3Diagnostics,
} from "@/lib/rift-v3";
import { forgetPreferredMethod } from "@/lib/v3-sign";

/** Session-scoped dismissal — skipping should defer, not opt out. */
const DISMISS_KEY = "bfx_v3_prompt_dismissed";

// ── Shared glyphs ────────────────────────────────────────────────────────

/** Chunky padlock — the "secure your money" glyph. Matches V3SignDialog. */
function LockGlyph({ className }: { className?: string }) {
  return (
    <svg
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

/** Google-brand SVG. Same one MethodChooser uses so they're visually consistent. */
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
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

export function useSigningState(accessToken: string | null) {
  const [methods, setMethods] = useState<MethodsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      setMethods(await getMethods(accessToken));
    } catch {
      setMethods(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  return {
    methods,
    loading,
    refresh,
    needsMigration: !!methods && methods.version !== "v3",
    needsSetup: !!methods && methods.version === "v3" && methods.enrolled.length === 0,
    signingReady: !!methods && isSigningReady(methods),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SigningUpgradePrompt — the migration card on the landing page
// ═══════════════════════════════════════════════════════════════════════

export function SigningUpgradePrompt({
  accessToken,
  version,
  userLabel,
  userId,
  onDone,
}: {
  accessToken: string;
  version: string | null;
  userLabel: string;
  userId: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<"both" | "google" | "passkey" | null>(null);
  const [password, setPassword] = useState("");
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === "1",
  );
  const { toast } = useToast();

  if (dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const runWith = async (
    which: "both" | "google" | "passkey",
    want: { passkey: boolean; google: boolean },
  ) => {
    setBusy(which);
    try {
      const enrolled: EnrolledMethod[] = [];
      const failures: string[] = [];

      if (want.passkey) {
        if (!passkeysSupported()) {
          failures.push("Passkeys aren't supported in this browser.");
        } else {
          try {
            enrolled.push(await createPasskey(userLabel, userId));
          } catch (err) {
            const msg = err instanceof RiftV3Error ? err.message : String(err);
            failures.push(msg);
          }
        }
      }

      if (want.google) {
        if (!googleSigningConfigured()) {
          failures.push("Google sign-in isn't set up on this deployment.");
        } else {
          try {
            enrolled.push(await enrolGoogle());
          } catch (err) {
            const msg = err instanceof RiftV3Error ? err.message : String(err);
            failures.push(msg);
          }
        }
      }

      if (!enrolled.length) {
        toast({
          title: "Couldn't secure your wallet",
          description: failures.join(" ") + " Nothing changed — your wallet still works as before.",
          variant: "destructive",
        });
        setBusy(null);
        return;
      }

      await migrateToV3(accessToken, enrolled, version === "v2" ? password : undefined);

      const summary = enrolled.map((m) => (m.kind === "passkey" ? biometricName() : "Google")).join(" + ");
      toast({
        title: "Wallet secured",
        description: `Payments now approved with ${summary}.`,
      });
      onDone();
    } catch (err: any) {
      console.error("[rift-v3] migrate failed:", err);
      const msg =
        err instanceof RiftV3Error && err.code === "RESEAL_FAILED"
          ? "That signing key was rejected. If your wallet has a password, check it and try again."
          : err?.message || "Something went wrong.";
      toast({ title: "Couldn't secure your wallet", description: msg, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const canGoogle = googleSigningConfigured();
  const canPasskey = passkeysSupported();
  const isBusy = busy !== null;
  const needsPassword = version === "v2" && !password;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "relative overflow-hidden rounded-3xl",
        "border border-neutral-200 dark:border-neutral-800",
        "bg-white dark:bg-neutral-900",
        "p-6",
        "shadow-sm",
      )}
    >
      <button
        onClick={dismiss}
        aria-label="Dismiss for this session"
        className="absolute right-4 top-4 rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--navy))]/10">
        <LockGlyph className="h-6 w-6 text-[hsl(var(--navy))]" />
      </div>

      <h3 className="mt-4 text-[18px] font-semibold text-neutral-900 dark:text-neutral-100">
        Secure your wallet
      </h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        {canPasskey && canGoogle ? (
          <>
            Choose how you'd like to approve payments. {biometricName()} is fastest — Google is a
            good backup if you switch devices.
          </>
        ) : canPasskey ? (
          <>
            Turn this on and every payment needs {biometricName()} on this device — a stolen
            password isn't enough on its own.
          </>
        ) : (
          <>
            Connect a Google account to approve payments and recover your wallet on other
            devices.
          </>
        )}
      </p>

      {version === "v2" && (
        <div className="mt-4">
          <label className="text-[12px] font-medium text-neutral-600 dark:text-neutral-400">
            Current wallet password
          </label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password you signed in with"
            autoComplete="current-password"
            className="mt-1.5 h-10 rounded-xl border-neutral-200 dark:border-neutral-800"
          />
          <p className="mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-500">
            Needed once to unlock your wallet.
          </p>
        </div>
      )}

      <div className="mt-5 space-y-2">
        {/* Primary: whichever combination this browser can offer */}
        {canPasskey && canGoogle ? (
          <PrimaryCTA
            icon={<LockGlyph className="h-4 w-4" />}
            label={`Use ${biometricName()} + Google`}
            busy={busy === "both"}
            disabled={isBusy || needsPassword}
            onClick={() => runWith("both", { passkey: true, google: true })}
          />
        ) : canPasskey ? (
          <PrimaryCTA
            icon={<FiSmartphone className="h-4 w-4" />}
            label={`Use ${biometricName()}`}
            busy={busy === "passkey"}
            disabled={isBusy || needsPassword}
            onClick={() => runWith("passkey", { passkey: true, google: false })}
          />
        ) : (
          <PrimaryCTA
            icon={<GoogleGlyph className="h-4 w-4" />}
            label="Continue with Google"
            busy={busy === "google"}
            disabled={isBusy || needsPassword}
            onClick={() => runWith("google", { passkey: false, google: true })}
          />
        )}

        {/* Alternates only when the primary is the combined option */}
        {canPasskey && canGoogle && (
          <div className="flex gap-2">
            <SecondaryCTA
              icon={<GoogleGlyph className="h-4 w-4" />}
              label="Google only"
              busy={busy === "google"}
              disabled={isBusy || needsPassword}
              onClick={() => runWith("google", { passkey: false, google: true })}
            />
            <SecondaryCTA
              icon={<FiSmartphone className="h-4 w-4" />}
              label={`${biometricName()} only`}
              busy={busy === "passkey"}
              disabled={isBusy || needsPassword}
              onClick={() => runWith("passkey", { passkey: true, google: false })}
            />
          </div>
        )}
      </div>

      <button
        onClick={dismiss}
        disabled={isBusy}
        className="mt-3 w-full rounded-xl py-2 text-[12px] font-medium text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300 disabled:opacity-40"
      >
        Not now
      </button>

      <p className="mt-4 text-center text-[11px] leading-snug text-neutral-400 dark:text-neutral-500">
        Enable later from Settings → Signing. BlockFinaX can't sign for you.
      </p>
    </motion.div>
  );
}

function PrimaryCTA({
  icon,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
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
        "flex w-full items-center justify-center gap-2",
        "rounded-2xl bg-[hsl(var(--navy))] px-4 py-3",
        "text-[14px] font-semibold text-white",
        "transition-opacity duration-150",
        "hover:opacity-95 active:opacity-90",
        "disabled:opacity-60 disabled:cursor-not-allowed",
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      <span>{busy ? "Setting up…" : label}</span>
    </button>
  );
}

function SecondaryCTA({
  icon,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
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
        "flex flex-1 items-center justify-center gap-1.5",
        "rounded-2xl border border-neutral-200 dark:border-neutral-800",
        "bg-white dark:bg-neutral-900",
        "px-3 py-2.5",
        "text-[12px] font-medium text-neutral-700 dark:text-neutral-300",
        "transition-colors duration-150",
        "hover:bg-neutral-50 dark:hover:bg-neutral-800/50",
        "disabled:opacity-40 disabled:cursor-not-allowed",
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      <span className="truncate">{busy ? "…" : label}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SigningMethods — the Settings → Signing surface (full page section)
// ═══════════════════════════════════════════════════════════════════════

export function SigningMethods({
  accessToken,
  userLabel,
  userId,
}: {
  accessToken: string;
  userLabel: string;
  userId: string;
}) {
  const { methods, loading, refresh, signingReady } = useSigningState(accessToken);
  const [busy, setBusy] = useState<"passkey" | "google" | "enable" | null>(null);
  const [platformAuth, setPlatformAuth] = useState<"yes" | "no" | "unknown">("unknown");
  const { toast } = useToast();

  useEffect(() => {
    void diagnostics().then((d) => setPlatformAuth(d.platformAuthenticator));
  }, []);

  const approveWithExisting = (challengeHex: string) => {
    const enrolledIds = methods?.passkeyCredIds;
    const hasPasskey = (methods?.enrolled ?? []).some((m) => m.kind === "passkey");
    const hasOidc = (methods?.enrolled ?? []).some((m) => m.kind === "oidc");
    if (hasPasskey && passkeysSupported()) return assertPasskey(challengeHex, enrolledIds);
    if (hasOidc && googleSigningConfigured()) return assertGoogle(challengeHex);
    if (hasPasskey) return assertPasskey(challengeHex, enrolledIds);
    return assertGoogle(challengeHex);
  };

  const addPasskey = async () => {
    setBusy("passkey");
    try {
      await addMethod(accessToken, approveWithExisting, () => createPasskey(userLabel, userId));
      forgetPreferredMethod(userId);
      toast({ title: "Device added", description: "This device can now approve payments." });
      await refresh();
    } catch (err: any) {
      handleAddError(err, "device");
    } finally {
      setBusy(null);
    }
  };

  const addGoogle = async () => {
    setBusy("google");
    try {
      await addMethod(accessToken, approveWithExisting, () => enrolGoogle());
      forgetPreferredMethod(userId);
      toast({ title: "Google linked", description: "This account can now approve payments." });
      await refresh();
    } catch (err: any) {
      handleAddError(err, "Google");
    } finally {
      setBusy(null);
    }
  };

  const handleAddError = (err: any, what: "device" | "Google") => {
    if (err instanceof RiftV3Error && err.code === "CANCELLED") return;
    const duplicate = err instanceof RiftV3Error && /duplicate/i.test(err.message);
    toast({
      title: duplicate ? "Already added" : "Couldn't add it",
      description:
        err instanceof RiftV3Error && err.code === "CHALLENGE_MISSING_OR_EXPIRED"
          ? "That took too long — please try again."
          : duplicate
          ? what === "device"
            ? "This device's passkey is already linked. Open BlockFinaX on the other device and add it there."
            : "This Google account is already linked to your wallet."
          : err?.message || "Something went wrong.",
      variant: duplicate ? undefined : "destructive",
    });
  };

  if (loading && !methods) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  const enrolled = methods?.enrolled ?? [];
  const onlyOne = enrolled.length === 1;
  const noBiometric = platformAuth === "no";
  const statusUnknown = !methods;
  const noLocalRecord = !wasMigratedLocally(null);
  const needsEnable = statusUnknown || (!signingReady && noLocalRecord);
  const isBusy = busy !== null;
  const googleOptions = enrolled.filter((m) => m.kind === "oidc");

  return (
    <div className="space-y-8">
      {/* ── Empty state (fresh wallet) ─────────────────────────── */}
      {enrolled.length === 0 && !needsEnable && (
        <EmptyState onEnable={addPasskey} busy={isBusy} />
      )}

      {/* ── Un-migrated wallet: "Enable device signing" one-shot ── */}
      {needsEnable && (
        <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[hsl(var(--navy))]/10">
            <LockGlyph className="h-5 w-5 text-[hsl(var(--navy))]" />
          </div>
          <h3 className="mt-4 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
            Set up device signing
          </h3>
          <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
            Turn on {biometricName()} for this device so payments no longer need a one-time code.
          </p>
          <button
            disabled={isBusy || !passkeysSupported()}
            onClick={async () => {
              setBusy("enable");
              try {
                const method = await createPasskey(userLabel, userId);
                const r: any = await migrateToV3(accessToken, [method]);
                toast({
                  title: r?.alreadyMigrated ? "Already set up" : "Device signing enabled",
                  description: `Payments will now ask for ${biometricName()}.`,
                });
                await refresh();
              } catch (err: any) {
                if (!(err instanceof RiftV3Error && err.code === "CANCELLED")) {
                  toast({
                    title: "Couldn't enable it",
                    description: err?.message || "Something went wrong.",
                    variant: "destructive",
                  });
                }
              } finally {
                setBusy(null);
              }
            }}
            className={cn(
              "mt-4 flex w-full items-center justify-center gap-2",
              "rounded-2xl bg-[hsl(var(--navy))] px-4 py-3",
              "text-[14px] font-semibold text-white",
              "hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed",
              "transition-opacity duration-150",
            )}
          >
            {busy === "enable" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FiSmartphone className="h-4 w-4" />
            )}
            <span>{busy === "enable" ? "Enabling…" : "Enable device signing"}</span>
          </button>
        </div>
      )}

      {/* ── Enrolled list ─────────────────────────────────────── */}
      {enrolled.length > 0 && (
        <section>
          <SectionHeader label="Enrolled" />
          <ul className="mt-3 space-y-2">
            {enrolled.map((m, i) => (
              <EnrolledRow
                key={i}
                method={m}
                indexOfKind={googleOptions.findIndex((g) => g === m)}
                totalGoogle={googleOptions.length}
              />
            ))}
          </ul>

          {onlyOne && (
            <SingleMethodWarning />
          )}
        </section>
      )}

      {/* ── Add another ─────────────────────────────────────── */}
      {enrolled.length > 0 && (
        <section>
          <SectionHeader
            label="Add another"
            helper="Any enrolled method can approve payments. Add another so you can still access your wallet if you lose one."
          />

          <div className="mt-3 space-y-2">
            {passkeysSupported() && !noBiometric && (
              <AddButton
                icon={<FiSmartphone className="h-5 w-5" />}
                iconTint="navy"
                label={
                  enrolled.some((m) => m.kind === "passkey")
                    ? "Add another device's passkey"
                    : `Enable ${biometricName()} on this device`
                }
                busy={busy === "passkey"}
                disabled={isBusy}
                onClick={addPasskey}
                highlight={onlyOne && !enrolled.some((m) => m.kind === "passkey")}
              />
            )}
            {googleSigningConfigured() && (
              <AddButton
                icon={<GoogleGlyph className="h-5 w-5" />}
                iconTint="none"
                label={
                  enrolled.some((m) => m.kind === "oidc")
                    ? "Link another Google account"
                    : "Link a Google account"
                }
                busy={busy === "google"}
                disabled={isBusy}
                onClick={addGoogle}
                highlight={onlyOne && !enrolled.some((m) => m.kind === "oidc")}
              />
            )}
          </div>

          {noBiometric && (
            <p className="mt-3 text-[12px] text-neutral-500 dark:text-neutral-400">
              This browser reports no fingerprint or face reader. Check that {biometricName()} is set
              up in your device settings, and open BlockFinaX in Safari or Chrome (not an in-app
              browser).
            </p>
          )}
        </section>
      )}

      {signingReady && (
        <p className="text-center text-[11px] text-neutral-400 dark:text-neutral-500">
          Your wallet keys never leave your device unencrypted. BlockFinaX cannot move your funds.
        </p>
      )}

      <Diagnostics version={methods?.version ?? null} enrolled={enrolled.length} />
    </div>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────

function SectionHeader({ label, helper }: { label: string; helper?: string }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
        {label}
      </h4>
      {helper && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          {helper}
        </p>
      )}
    </div>
  );
}

function EnrolledRow({
  method,
  indexOfKind,
  totalGoogle,
}: {
  method: { kind: "passkey" | "oidc"; label?: string; sub?: string; iss?: string };
  indexOfKind: number;
  totalGoogle: number;
}) {
  const isPasskey = method.kind === "passkey";
  const primary = isPasskey
    ? method.label || biometricName()
    : method.label ||
      (totalGoogle > 1 && method.sub ? `Google · ${method.sub.slice(0, 6)}…` : "Google");
  const secondary = isPasskey ? "This device" : "Signs with Google";

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3">
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          isPasskey
            ? "bg-[hsl(var(--navy))]/10 text-[hsl(var(--navy))]"
            : "bg-neutral-100 dark:bg-neutral-800",
        )}
      >
        {isPasskey ? <FiSmartphone className="h-5 w-5" /> : <GoogleGlyph className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-neutral-900 dark:text-neutral-100">
          {primary}
        </p>
        <p className="truncate text-[12px] text-neutral-500 dark:text-neutral-400">{secondary}</p>
      </div>
    </li>
  );
}

function AddButton({
  icon,
  iconTint,
  label,
  busy,
  disabled,
  onClick,
  highlight,
}: {
  icon: React.ReactNode;
  iconTint: "navy" | "none";
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-4 py-3",
        "border bg-white dark:bg-neutral-900",
        highlight
          ? "border-amber-300 dark:border-amber-500/40"
          : "border-neutral-200 dark:border-neutral-800",
        "text-left transition-all duration-150",
        "hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
        "active:scale-[0.997]",
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
      <span className="flex-1 text-[14px] font-medium text-neutral-900 dark:text-neutral-100">
        {label}
      </span>
      {busy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400" />
      ) : (
        <Plus className="h-4 w-4 shrink-0 text-neutral-400" />
      )}
    </button>
  );
}

function SingleMethodWarning() {
  return (
    <div className="mt-3 flex gap-3 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/5 px-4 py-3">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-amber-900 dark:text-amber-200">
          Add a backup
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-amber-800/80 dark:text-amber-200/70">
          You have one way to approve payments. If you lose this device, getting back in means
          contacting support — nobody can reset the wallet for you.
        </p>
      </div>
    </div>
  );
}

function EmptyState({ onEnable, busy }: { onEnable: () => void; busy: boolean }) {
  return (
    <div className="rounded-3xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/5 p-5">
      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
      <h3 className="mt-3 text-[15px] font-semibold text-amber-900 dark:text-amber-200">
        No signing method yet
      </h3>
      <p className="mt-1 text-[13px] text-amber-800/80 dark:text-amber-200/70">
        Add a way to approve payments before sending money or buying cover.
      </p>
      <button
        onClick={onEnable}
        disabled={busy}
        className="mt-3 rounded-xl bg-[hsl(var(--navy))] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-95 disabled:opacity-60"
      >
        Enable device signing
      </button>
    </div>
  );
}

// ── Diagnostics (unchanged, collapsed styling refresh) ──────────────

function Diagnostics({ version, enrolled }: { version: string | null; enrolled: number }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<V3Diagnostics | null>(null);

  useEffect(() => {
    if (open && !d) void diagnostics().then(setD);
  }, [open, d]);

  const rows: [string, string][] = d
    ? [
        ["Wallet version", version ?? "unknown"],
        ["Last signing attempt", getDeviceSigningDecline() ?? "device signing (or not tried yet)"],
        ["Methods enrolled", String(enrolled)],
        ["Passkeys in this browser", d.passkeysSupported ? "supported" : "NOT supported"],
        ["Fingerprint / face available", d.platformAuthenticator],
        ["Secure context (https)", d.secureContext ? "yes" : "NO"],
        ["Inside an iframe", d.inIframe ? "YES — passkeys may be blocked" : "no"],
        ["In-app browser", d.inAppBrowser ? `${d.inAppBrowser} — open in Safari or Chrome` : "no"],
        ["Passkey domain", d.relyingPartyId],
        ["API", d.apiBase],
        ["Wallet path prefix", d.walletPrefix],
        ["API key type", d.apiKeyPrefix === "pk_" ? "pk_ (publishable)" : `${d.apiKeyPrefix} — should be pk_`],
      ]
    : [];

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[11px] font-medium text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        {open ? "Hide technical details" : "Technical details"}
      </button>

      {open && (
        <div className="mt-2 space-y-1 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/40 p-3">
          {!d && <p className="text-[11px] text-neutral-500">Checking…</p>}
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3 text-[11px]">
              <span className="shrink-0 text-neutral-500 dark:text-neutral-400">{k}</span>
              <span
                className={cn(
                  "min-w-0 break-all text-right font-mono text-neutral-700 dark:text-neutral-300",
                  /NOT|NO$|YES|should be/.test(v) && "text-amber-600 dark:text-amber-400",
                )}
              >
                {v}
              </span>
            </div>
          ))}
          {d && (
            <button
              onClick={() =>
                navigator.clipboard?.writeText(rows.map(([k, v]) => `${k}: ${v}`).join("\n"))
              }
              className="mt-1 text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              Copy all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
