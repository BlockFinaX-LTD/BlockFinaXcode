/**
 * Testnet sign-in for the BlockFinaX passkey wallet.
 *
 * Step 1: sign in with an email code or Google (recoverable identity).
 * Profile: first time only, "Let's create your profile" (name, country, individual or
 *          business). The server already knows whether the email or Google account
 *          exists: an account with a wallet or a saved profile skips this.
 * Step 2: first time only, create the wallet passkey. That creates the user's smart
 *         accounts on Stellar and Base Sepolia, and the passkey approves every transaction.
 * Returning users can also sign in directly with the passkey.
 *
 * On the connector site it is a plain "Log in or sign up" card and stops after step 1:
 * connectors use the portal, which needs an account but no wallet.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import logoPath from "@/assets/logo.png";
import logoMark from "@/assets/logo-transparent.png";
import { takeReturnPath, usePasskeySession } from "@/lib/identity";
import {
  acceptGoogleRedirect, api, createWalletPasskey, currentPasskeySession, finishEmailSignIn,
  preparePasskeyOptions, signInWithPasskey, signOutPasskey, startEmailSignIn, startGoogleSignIn,
} from "@/lib/wallets/passkey-wallet";
import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import { ProfileStep } from "./profile-step";

const GOOGLE_ERRORS: Record<string, string> = {
  google_not_configured: "Google sign-in is not set up on testnet yet. Use your email instead.",
  invalid_state: "The Google sign-in took too long. Please try again.",
};

const forConnectors = typeof window !== "undefined" && /^connector\./i.test(window.location.hostname);

export function PasskeyAuth() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, signedIn, session, setSession } = usePasskeySession();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // Whether a signed-in account without a wallet still has to give its profile.
  // If the check fails, carry on to the passkey: the profile must never lock anyone out.
  const [profile, setProfile] = useState<"checking" | "needed" | "done">("checking");
  const needsWallet = signedIn && !session?.credentialId && !forConnectors;
  useEffect(() => {
    if (!needsWallet) return;
    let live = true;
    api<{ completed: boolean }>("/api/v2/onboarding")
      .then((v) => { if (live) setProfile(v.completed ? "done" : "needed"); })
      .catch(() => { if (live) setProfile("done"); });
    return () => { live = false; };
  }, [needsWallet, session?.user.id]);

  // Back from Google: keep the session it created and carry on to the passkey step.
  useEffect(() => {
    const googleError = new URLSearchParams(window.location.search).get("error");
    if (googleError) setError(GOOGLE_ERRORS[googleError] ?? "Google sign-in failed. Please try again.");
    if (acceptGoogleRedirect()) void currentPasskeySession().then(setSession);
  }, [setSession]);

  useEffect(() => {
    if ((isAuthenticated || (forConnectors && signedIn)) && !busy && !warning) setLocation(takeReturnPath());
  }, [isAuthenticated, signedIn, busy, warning, setLocation]);

  // Fetch the passkey options while the screen shows, so a tap goes straight to the prompt.
  const passkeyScreen = needsWallet && profile === "done";
  useEffect(() => { if (passkeyScreen) preparePasskeyOptions("register"); }, [passkeyScreen]);
  useEffect(() => { if (!signedIn && !forConnectors) preparePasskeyOptions("signin"); }, [signedIn]);
  const [tab, setTab] = useState<"signin" | "create">("signin");

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (e) {
      const err = e as Error;
      const message = err.message || "Something went wrong";
      if (err.name === "NotAllowedError" || /not allowed|cancel|timed out/i.test(message)) {
        setError("The passkey was not approved. Tap the button again and approve with Face ID, Touch ID or your device PIN.");
      } else {
        setError(message);
      }
      // A refused prompt used its challenge; have a fresh one ready for the next tap.
      if (label === "create") preparePasskeyOptions("register");
      if (label === "passkey") preparePasskeyOptions("signin");
    } finally {
      setBusy(null);
    }
  }

  const spinner = (label: string) => (busy === label ? <Loader2 className="h-4 w-4 animate-spin" /> : null);

  const header = (
    <>
      <img src={logoPath} alt="BlockFinaX" className="h-14 w-14 object-contain" />
      <div className="space-y-1">
        <h1 className="bfx-display text-[20px] font-semibold tracking-tight">BlockFinaX</h1>
        <p className="text-[12.5px] text-muted-foreground">Cross-border payments &amp; cover</p>
        <p className="text-xs text-amber-500">TESTNET</p>
      </div>
    </>
  );

  const signOut = () => void signOutPasskey().then(() => { setProfile("checking"); setSession(null); });

  if (needsWallet && profile === "checking") {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (needsWallet && profile === "needed") {
    return <ProfileStep email={session?.user.email} defaultName={session?.user.name} onDone={() => setProfile("done")} onSignOut={signOut} />;
  }

  // Step 2: signed in, wallet passkey not created yet.
  if (needsWallet) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
        <div className="flex flex-col items-center gap-3 text-center max-w-xs w-full">
          {header}
          <p className="text-[13px] mt-4">
            Signed in{session?.user.email ? ` as ${session.user.email}` : ""}. Now create your wallet passkey.
          </p>
          <p className="text-[11.5px] text-muted-foreground leading-snug">
            Your passkey stays on this device and approves every transaction. It creates your wallet on Stellar. Your
            email or Google account signs you in, but it cannot move funds.
          </p>
          <Button className="w-full h-11 rounded-xl mt-2" disabled={!!busy} onClick={() => run("create", async () => {
            const created = await createWalletPasskey();
            // The agreement shown on the sign-in screen is recorded once, when the account is created.
            await api('/api/legal/accept', { terms: TERMS_VERSION, privacy: PRIVACY_VERSION }).catch(() => undefined);
            if (created.errors?.length) setWarning("Your wallet is ready, but part of the setup is still finishing. Signing in again retries.");
            setSession(created);
          })}>
            {spinner("create") ?? <><KeyRound className="h-4 w-4 mr-2" />Create wallet passkey</>}
          </Button>
          {busy === "create" && <p className="text-[11px] text-muted-foreground">Creating your accounts. This takes about 10 seconds.</p>}
          <button className="text-[11.5px] text-muted-foreground underline mt-2" onClick={signOut}>
            Use a different account
          </button>
          {warning && (
            <div className="text-xs text-amber-500 mt-2 space-y-2">
              <p>{warning}</p>
              <Button size="sm" variant="outline" onClick={() => { setWarning(null); setLocation(takeReturnPath()); }}>Continue</Button>
            </div>
          )}
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>
      </div>
    );
  }

  // Step 1: sign in.
  if (forConnectors) return legacyScreen();
  const creating = tab === "create";
  return (
    <div className="bfx-signin min-h-screen flex flex-col items-center justify-start sm:justify-center px-5 pt-10 pb-10 sm:py-10" style={{ background: "radial-gradient(600px 420px at 100% 0%, rgba(37,99,235,0.10), transparent 70%), radial-gradient(520px 380px at 0% 100%, rgba(37,99,235,0.07), transparent 70%), hsl(var(--background))" }}>
      <div className="flex flex-col items-center text-center">
        <img src={logoMark} alt="" className="h-16 w-16 object-contain" />
        <h1 className="bfx-display mt-3 text-[26px] font-bold tracking-tight">BlockFinaX</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Cross-border payments &amp; FX cover</p>
        {import.meta.env.VITE_NETWORK_MODE !== "mainnet" && <span className="mt-3 rounded-full bg-amber-100 px-3 py-0.5 text-[11.5px] font-semibold tracking-wider text-amber-700">TESTNET</span>}
      </div>

      <div className="mt-7 w-full max-w-[400px] rounded-2xl border border-border bg-card px-6 pb-6 pt-2 shadow-[0_12px_40px_rgba(15,23,41,0.07)]">
        <div className="mb-5 grid grid-cols-2 border-b border-border" role="tablist">
          {(["signin", "create"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setError(""); }}
              className={`-mb-px border-b-2 py-3 text-[15px] font-semibold transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 text-left">
          {!requestId ? (
            <>
              <label className="text-[13px] font-semibold" htmlFor="bfx-email">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="bfx-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="h-12 rounded-xl pl-10 text-[15px]" autoComplete="email" />
              </div>
              <Button className="h-12 w-full rounded-xl text-[15px]" disabled={!!busy || !email.includes("@")} onClick={() => run("send", async () => {
                setRequestId(await startEmailSignIn(email));
              })}>
                {spinner("send") ?? <><Mail className="mr-2 h-4 w-4" />Email me a code</>}
              </Button>
            </>
          ) : (
            <>
              <label className="text-[13px] font-semibold">Code sent to {email}</label>
              <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="h-12 rounded-xl text-center font-mono tracking-[0.4em]" autoComplete="one-time-code" />
              <Button className="h-12 w-full rounded-xl text-[15px]" disabled={!!busy || code.length !== 6} onClick={() => run("verify", async () => {
                setSession(await finishEmailSignIn(email, requestId, code));
              })}>
                {spinner("verify") ?? (creating ? "Create account" : "Sign in")}
              </Button>
              <button className="text-[12px] text-muted-foreground underline" onClick={() => { setRequestId(null); setCode(""); }}>
                Use a different email or resend
              </button>
            </>
          )}

          <div className="my-1 flex items-center gap-3 text-[12px] text-muted-foreground"><div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" /></div>

          <Button variant="outline" className="h-12 w-full rounded-xl text-[15px] font-semibold" disabled={!!busy} onClick={startGoogleSignIn}>
            <GoogleMark />Continue with Google
          </Button>
          {!creating && (
            <Button variant="outline" className="h-12 w-full rounded-xl text-[15px] font-semibold" disabled={!!busy} onClick={() => run("passkey", async () => {
              setSession(await signInWithPasskey());
            })}>
              {spinner("passkey") ?? <><KeyRound className="mr-2 h-4 w-4" />Sign in with your passkey</>}
            </Button>
          )}

          <div className="mt-1 flex items-start gap-3 rounded-xl bg-muted/60 p-3.5 text-[12.5px] leading-snug text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-primary" />
            <span>{creating
              ? "Create your account with email or Google, add your name and country, then create a passkey for your wallet."
              : "New users: sign in with email or Google, add your name and country, then create a passkey for your wallet."}</span>
          </div>
          {error && <p className="text-[12.5px] text-red-500">{error}</p>}
        </div>
      </div>

      <p className="mt-6 max-w-[360px] text-center text-[12px] leading-relaxed text-muted-foreground">
        By signing up or continuing, you agree to our{" "}
        <a href="/terms" target="_blank" rel="noreferrer" className="underline">Terms of Use</a> and acknowledge our{" "}
        <a href="/privacy" target="_blank" rel="noreferrer" className="underline">Privacy Policy</a>.
      </p>
    </div>
  );

  /** The Connector Programme keeps its own compact sign-in. */
  function legacyScreen() {
    return (

    <div className={`min-h-screen flex flex-col items-center justify-center p-6 ${forConnectors ? "bg-muted/40" : "bg-background"}`}>
      <div className={forConnectors
        ? "flex flex-col items-center gap-3 text-center w-full max-w-sm rounded-2xl border border-border bg-card px-8 py-10 shadow-sm"
        : "flex flex-col items-center gap-3 text-center max-w-xs w-full"}>
        {forConnectors ? (
          <>
            <img src={logoPath} alt="BlockFinaX" className="h-12 w-12 object-contain" />
            <h1 className="bfx-display text-[24px] font-semibold tracking-tight mt-2">Log in or sign up</h1>
            <p className="text-[13px] text-muted-foreground -mt-1">to the BlockFinaX Connector Programme</p>
            {import.meta.env.VITE_NETWORK_MODE !== "mainnet" && <p className="text-xs text-amber-500">TESTNET</p>}
          </>
        ) : header}
        <div className="flex flex-col items-stretch gap-2 mt-4 w-full text-left">
          {!requestId ? (
            <>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="h-11 rounded-xl" autoComplete="email" />
              <Button className="w-full h-11 rounded-xl" disabled={!!busy || !email.includes("@")} onClick={() => run("send", async () => {
                setRequestId(await startEmailSignIn(email));
              })}>
                {spinner("send") ?? <><Mail className="h-4 w-4 mr-2" />Email me a code</>}
              </Button>
            </>
          ) : (
            <>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Code sent to {email}</label>
              <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="h-11 rounded-xl font-mono tracking-[0.4em] text-center" autoComplete="one-time-code" />
              <Button className="w-full h-11 rounded-xl" disabled={!!busy || code.length !== 6} onClick={() => run("verify", async () => {
                setSession(await finishEmailSignIn(email, requestId, code));
              })}>
                {spinner("verify") ?? "Sign in"}
              </Button>
              <button className="text-[11.5px] text-muted-foreground underline" onClick={() => { setRequestId(null); setCode(""); }}>
                Use a different email or resend
              </button>
            </>
          )}
          <div className="flex items-center gap-2 my-2 text-[11px] text-muted-foreground"><div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" /></div>
          <Button variant="outline" className="w-full h-11 rounded-xl" disabled={!!busy} onClick={startGoogleSignIn}>
            Continue with Google
          </Button>
          <Button variant="ghost" className="w-full h-10 rounded-xl text-[12.5px]" disabled={!!busy} onClick={() => run("passkey", async () => {
            const s = await signInWithPasskey();
            setSession(s);
          })}>
            {spinner("passkey") ?? <><KeyRound className="h-4 w-4 mr-2" />Sign in with your passkey</>}
          </Button>
        </div>
        {forConnectors ? (
          <p className="text-[11.5px] text-muted-foreground mt-2 leading-snug">
            New here? Signing in creates your account.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
            New users: sign in with email or Google, add your name and country, then create a passkey for your wallet.
          </p>
        )}
        <p className="text-[11px] text-muted-foreground mt-3 leading-snug">
          By signing up or continuing with email or Google, you agree to our{" "}
          <a href="/terms" target="_blank" rel="noreferrer" className="underline">Terms of Use</a> and acknowledge our{" "}
          <a href="/privacy" target="_blank" rel="noreferrer" className="underline">Privacy Policy</a>.
        </p>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>
    </div>
  
    );
  }
}

/** Google's "G", in its own colours. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="mr-2.5 h-[18px] w-[18px]" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
