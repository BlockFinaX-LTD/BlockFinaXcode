/**
 * Signing methods — the migration prompt and the settings screen.
 *
 * Two surfaces over one idea: which credentials can authorise a payment from
 * this wallet.
 *
 * The migration prompt is dismissible and never blocks. Rift's guide is
 * explicit that v1 and v2 wallets keep working, and gating a customer out of
 * their own money to push a security upgrade would be a worse outcome than the
 * upgrade is a benefit.
 *
 * The one thing it does push hard is a second method. A passkey lives on one
 * device; lose it with nothing else enrolled and recovery is a support ticket
 * to Rift, because a non-custodial wallet cannot be re-keyed by anyone. For a
 * customer in Accra on a single Android handset that is a real way to lose
 * access to real money, so declining the backup is written as a warning the
 * user reads and accepts, not as a quiet default.
 */

import { useEffect, useState } from "react";
import { Fingerprint, ShieldCheck, AlertTriangle, Plus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/** Dismissal is per session, deliberately — skipping should defer, not opt out. */
const DISMISS_KEY = "bfx_v3_prompt_dismissed";

export function useSigningState(accessToken: string | null) {
  const [methods, setMethods] = useState<MethodsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      setMethods(await getMethods(accessToken));
    } catch {
      // A failed status check must not lock anyone out of reads. Treat it as
      // unknown and let the app carry on.
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

// ── Migration prompt ──────────────────────────────────────────────────────

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
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === "1");
  const { toast } = useToast();

  if (dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  // Try to enrol BOTH passkey + Google in one migrate call — that gives the
  // wallet a device-bound signer AND an account-recovery lever the moment
  // it hits v3. Either one alone is fine; the migration only fails if BOTH
  // do. Matches Rift's own V3EnrolmentBanner behaviour.
  const runWith = async (want: { passkey: boolean; google: boolean }) => {
    setBusy(true);
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
            failures.push(`Passkey: ${msg}`);
          }
        }
      }

      if (want.google) {
        if (!googleSigningConfigured()) {
          failures.push("Google sign-in isn't configured on this deployment.");
        } else {
          try {
            enrolled.push(await enrolGoogle());
          } catch (err) {
            const msg = err instanceof RiftV3Error ? err.message : String(err);
            failures.push(`Google: ${msg}`);
          }
        }
      }

      if (!enrolled.length) {
        toast({
          title: "Couldn't set up device signing",
          description:
            failures.join(" ") + " Nothing was changed — your wallet still works as before.",
          variant: "destructive",
        });
        setBusy(false);
        return;
      }

      // v2 wallets are password-bound and the old password authorises the
      // reseal. v1 wallets have none and must not be asked for one.
      await migrateToV3(accessToken, enrolled, version === "v2" ? password : undefined);

      const summary = enrolled.map((m) => (m.kind === "passkey" ? biometricName() : "Google")).join(" + ");
      toast({
        title: "Wallet secured",
        description: `Payments now need ${summary}. ${failures.length ? "Add other methods later under Settings → Signing." : ""}`,
      });
      onDone();
    } catch (err: any) {
      console.error("[rift-v3] migrate failed:", err);
      const msg =
        err instanceof RiftV3Error && err.code === "RESEAL_FAILED"
          ? "Rift rejected the signing key. If your wallet has a password, check it and try again."
          : err?.message || "Something went wrong.";
      toast({ title: "Couldn't secure the wallet", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const run = () => runWith({ passkey: true, google: googleSigningConfigured() });
  const runPasskeyOnly = () => runWith({ passkey: true, google: false });
  const runGoogleOnly = () => runWith({ passkey: false, google: true });

  return (
    <div className="relative rounded-2xl border border-border bg-muted/40 p-4">
      <button
        onClick={dismiss}
        aria-label="Not now"
        className="absolute right-3 top-3 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl bg-[hsl(var(--navy))]/10 p-2">
          <Fingerprint className="h-5 w-5 text-[hsl(var(--navy))]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Secure your wallet with {biometricName()}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Right now a password can move your money. Turn this on and every payment needs{" "}
            {biometricName()} on this device — so a stolen password isn't enough on its own.
          </p>

          {version === "v2" && (
            <div className="mt-3">
              <label className="text-xs text-muted-foreground">Your current wallet password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 h-9"
                autoComplete="current-password"
              />
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={run} disabled={busy || (version === "v2" && !password)}>
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : googleSigningConfigured() ? (
                `Use ${biometricName()} + Google`
              ) : (
                `Use ${biometricName()}`
              )}
            </Button>
            {googleSigningConfigured() && (
              <Button
                size="sm"
                variant="outline"
                onClick={runGoogleOnly}
                disabled={busy || (version === "v2" && !password)}
              >
                Continue with Google
              </Button>
            )}
            {googleSigningConfigured() && passkeysSupported() && (
              <Button
                size="sm"
                variant="ghost"
                onClick={runPasskeyOnly}
                disabled={busy || (version === "v2" && !password)}
              >
                {biometricName()} only
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
          {googleSigningConfigured() && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Enrolling {biometricName()} + Google together means you can still recover your
              wallet from another device if you lose this one.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Settings screen ───────────────────────────────────────────────────────

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
  const [busy, setBusy] = useState(false);
  const [platformAuth, setPlatformAuth] = useState<"yes" | "no" | "unknown">("unknown");
  const { toast } = useToast();

  useEffect(() => {
    void diagnostics().then((d) => setPlatformAuth(d.platformAuthenticator));
  }, []);

  // Pick which existing method authorises the add-method call. If the wallet
  // has both passkey + Google enrolled, prefer whichever the user actually
  // has active support for on this browser. addMethod calls this closure
  // during the 4-step handshake.
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
    setBusy(true);
    try {
      // Approve with a credential Rift has actually enrolled — see the note
      // in enrolledCredential() for why an unconstrained assertion is unsafe.
      await addMethod(
        accessToken,
        approveWithExisting,
        () => createPasskey(userLabel, userId),
      );
      // Any change to enrolled methods invalidates a saved preference —
      // the user may want to pick fresh now that the options list changed.
      forgetPreferredMethod(userId);
      toast({ title: "Added", description: "This device can now approve payments." });
      await refresh();
    } catch (err: any) {
      handleAddError(err, "device");
    } finally {
      setBusy(false);
    }
  };

  const addGoogle = async () => {
    setBusy(true);
    try {
      await addMethod(accessToken, approveWithExisting, () => enrolGoogle());
      forgetPreferredMethod(userId);
      toast({ title: "Added", description: "This Google account can now approve payments." });
      await refresh();
    } catch (err: any) {
      handleAddError(err, "Google");
    } finally {
      setBusy(false);
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
              ? "This device is already registered. To add another, open the app on that device and press this there."
              : "That Google account is already linked to this wallet."
            : err?.message || "Something went wrong.",
      variant: duplicate ? undefined : "destructive",
    });
  };

  if (loading && !methods) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  // Anyone who migrated before the local record existed has no record of it,
  // and if the status endpoint is missing there is nothing left to prove they
  // did. migrate-to-v3 is idempotent — it answers alreadyMigrated on a repeat
  // and changes nothing — so re-running it is safe and writes the record that
  // was missing. Without this button the fix cannot reach the one account that
  // already migrated.
  const statusUnknown = !methods;
  const noLocalRecord = !wasMigratedLocally(null);

  const enrolled = methods?.enrolled ?? [];
  const onlyOne = enrolled.length === 1;
  const noBiometric = platformAuth === "no";

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Signing methods</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Anything listed here can approve a payment from your wallet.
        </p>
      </div>

      {enrolled.length === 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> No signing method yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            You'll need one before you can send money or buy cover.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {enrolled.map((m, i) => {
            // For multi-Google display: derive a stable label from either the
            // backend-supplied label, or the sub prefix as a distinguishable
            // fallback so a wallet with two Google accounts doesn't show two
            // identical rows.
            const googleLabel = (() => {
              if (m.label) return m.label;
              if (m.kind !== "oidc") return null;
              const totalGoogle = enrolled.filter((e) => e.kind === "oidc").length;
              if (totalGoogle > 1 && m.sub) return `Google (${m.sub.slice(0, 6)}…)`;
              return "Google";
            })();
            return (
              <li
                key={i}
                className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 text-sm"
              >
                {m.kind === "passkey" ? (
                  <Fingerprint className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate">
                  {m.kind === "passkey" ? (m.label || "This device") : googleLabel}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* The single-method warning. Rift cannot re-key a non-custodial wallet,
          so one method on one phone is one lost phone away from a support case. */}
      {onlyOne && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-xs font-medium">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" /> Add a backup
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            You have one way to approve payments. If you lose this device, getting back in means
            contacting support — nobody can reset the wallet for you. Adding a second method now
            takes a few seconds.
          </p>
        </div>
      )}

      {(statusUnknown || (!signingReady && noLocalRecord)) && (
        <Button
          size="sm"
          className="w-full"
          disabled={busy || !passkeysSupported()}
          onClick={async () => {
            setBusy(true);
            try {
              const method = await createPasskey(userLabel, userId);
              const r: any = await migrateToV3(accessToken, [method]);
              toast({
                title: r?.alreadyMigrated ? "Already set up" : "Device signing enabled",
                description: `Payments will now ask for ${biometricName()} instead of a code.`,
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
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Enable device signing"}
        </Button>
      )}

      {/* isUserVerifyingPlatformAuthenticatorAvailable() answering "no" means
          this device has no fingerprint or face reader the browser can use.
          Offering to register it anyway produces a prompt that cannot be
          satisfied, which is how this looked on the phone. */}
      {noBiometric && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-xs font-medium">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" /> No fingerprint or face
            reader on this device
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            This browser reports no biometric it can use, so a passkey can't be created here. Check
            that Face ID or the fingerprint unlock is set up in your device settings, and that you're
            in Safari or Chrome rather than a browser inside another app.
          </p>
        </div>
      )}

      {/* ── Add-method actions ────────────────────────────────────────
          Anything already enrolled can be added again — Rift lets one
          wallet carry many passkeys AND many Google accounts. Each is a
          distinct signing/recovery lever. */}
      <div className="space-y-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={addPasskey}
          disabled={busy || !passkeysSupported() || noBiometric}
          className={cn(
            "w-full",
            onlyOne && !enrolled.some((m) => m.kind === "passkey") && "border-amber-500/40",
          )}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {enrolled.some((m) => m.kind === "passkey")
                ? "Add another device's passkey"
                : "Register this device"}
            </>
          )}
        </Button>

        {googleSigningConfigured() && (
          <Button
            size="sm"
            variant="outline"
            onClick={addGoogle}
            disabled={busy}
            className={cn(
              "w-full",
              onlyOne && !enrolled.some((m) => m.kind === "oidc") && "border-amber-500/40",
            )}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {enrolled.some((m) => m.kind === "oidc")
                  ? "Link another Google account"
                  : "Link a Google account"}
              </>
            )}
          </Button>
        )}
      </div>

      {!passkeysSupported() && !googleSigningConfigured() && (
        <p className="text-xs text-muted-foreground">
          This browser doesn't support passkeys. Try Chrome or Safari on a phone with a fingerprint
          or face unlock.
        </p>
      )}
      {!passkeysSupported() && googleSigningConfigured() && (
        <p className="text-xs text-muted-foreground">
          This browser can't create passkeys — Google is the option here.
        </p>
      )}

      {signingReady && (
        <p className="text-[11px] text-muted-foreground">
          Your wallet keys never leave your device unencrypted, and BlockFinaX cannot move your funds.
        </p>
      )}

      <Diagnostics version={methods?.version ?? null} enrolled={enrolled.length} />
    </div>
  );
}


/**
 * Everything the client resolved, on screen.
 *
 * Collapsed by default — a customer never needs it. It exists because the
 * alternative was diagnosing a failure from a photograph of a laptop, and
 * every value in here was already knowable, just invisible.
 */
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
    <div className="pt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2"
      >
        {open ? "Hide technical details" : "Technical details"}
      </button>

      {open && (
        <div className="mt-2 space-y-1 rounded-xl border border-border bg-muted/30 p-3">
          {!d && <p className="text-[11px] text-muted-foreground">Checking…</p>}
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3 text-[11px]">
              <span className="shrink-0 text-muted-foreground">{k}</span>
              <span
                className={cn(
                  "min-w-0 break-all text-right font-mono",
                  /NOT|NO$|YES|should be/.test(v) && "text-amber-600",
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
              className="mt-1 text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2"
            >
              Copy all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
