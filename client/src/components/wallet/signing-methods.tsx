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
  addMethod,
  passkeysSupported,
  isSigningReady,
  RiftV3Error,
  biometricName,
  type MethodsResponse,
  type EnrolledMethod,
  type V3Diagnostics,
} from "@/lib/rift-v3";

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

  const run = async () => {
    setBusy(true);
    try {
      const enrolled: EnrolledMethod[] = [];
      let why: RiftV3Error | null = null;

      if (!passkeysSupported()) {
        why = new RiftV3Error("UNSUPPORTED", "This browser doesn't support passkeys at all.");
      } else {
        try {
          enrolled.push(await createPasskey(userLabel, userId));
        } catch (err) {
          why = err instanceof RiftV3Error ? err : new RiftV3Error("UNKNOWN", String(err));
        }
      }

      // Previously a cancellation returned here in silence. On a phone that was
      // indistinguishable from the button doing nothing — and iOS reports a
      // blocked or timed-out prompt with the same error a real cancellation
      // uses, so the silent path swallowed genuine failures too. Always say
      // something; a dismissed prompt is the only case that isn't an error.
      if (!enrolled.length) {
        toast({
          title: why?.code === "CANCELLED" ? "Not completed" : `Couldn't set up ${biometricName()}`,
          description:
            (why?.message ?? "Your device didn't provide a passkey.") +
            " You can also secure the wallet by linking Google under Settings → Signing.",
          variant: why?.code === "CANCELLED" ? undefined : "destructive",
        });
        setBusy(false);
        return;
      }

      // v2 wallets are password-bound and the old password authorises the
      // reseal. v1 wallets have none and must not be asked for one.
      await migrateToV3(accessToken, enrolled, version === "v2" ? password : undefined);

      toast({
        title: "Wallet secured",
        description: `Payments now need ${biometricName()} on this device. Add a backup method next.`,
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

          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={run} disabled={busy || (version === "v2" && !password)}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Turn it on"}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
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
  const { toast } = useToast();

  const addPasskey = async () => {
    setBusy(true);
    try {
      // Approve with a credential Rift has actually enrolled.
      //
      // This was unconstrained, so the browser was free to sign the challenge
      // with any passkey for this domain — including the orphans left by
      // migrations that failed server-side, which exist on the device and are
      // indistinguishable to the picker. A proof from a credential the enclave
      // has never seen is exactly the "enclave rejected the authProof" branch
      // of RESEAL_FAILED.
      const enrolledIds = methods?.passkeyCredIds;
      await addMethod(
        accessToken,
        (challengeHex) => assertPasskey(challengeHex, enrolledIds),
        () => createPasskey(userLabel, userId),
      );
      toast({ title: "Added", description: "This device can now approve payments." });
      await refresh();
    } catch (err: any) {
      if (!(err instanceof RiftV3Error && err.code === "CANCELLED")) {
        const duplicate =
          err instanceof RiftV3Error && /duplicate/i.test(err.message);
        toast({
          title: duplicate ? "Already added" : "Couldn't add it",
          description:
            err instanceof RiftV3Error && err.code === "CHALLENGE_MISSING_OR_EXPIRED"
              ? "That took too long — please try again."
              : duplicate
                ? "This device is already registered. To add another, open the app on that device and press this there."
                : err?.message || "Something went wrong.",
          variant: duplicate ? undefined : "destructive",
        });
      }
    } finally {
      setBusy(false);
    }
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
          {enrolled.map((m, i) => (
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
                {m.label || (m.kind === "passkey" ? "This device" : "Google")}
              </span>
            </li>
          ))}
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

      <Button
        size="sm"
        variant="outline"
        onClick={addPasskey}
        disabled={busy || !passkeysSupported()}
        className={cn("w-full", onlyOne && "border-amber-500/40")}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Register this device
          </>
        )}
      </Button>

      {!passkeysSupported() && (
        <p className="text-xs text-muted-foreground">
          This browser doesn't support passkeys. Try Chrome or Safari on a phone with a fingerprint
          or face unlock.
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
