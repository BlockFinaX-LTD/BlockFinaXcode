/**
 * Testnet sign-in for the BlockFinaX passkey wallet.
 *
 * Step 1: sign in with an email code or Google (recoverable identity).
 * Step 2: first time only, create the wallet passkey. That creates the user's smart
 *         accounts on Stellar and Base Sepolia, and the passkey approves every transaction.
 * Returning users can also sign in directly with the passkey.
 *
 * On the connector site it is a plain "Log in or sign up" card and stops after step 1:
 * connectors use the portal, which needs an account but no wallet.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import logoPath from "@/assets/logo.png";
import { takeReturnPath, usePasskeySession } from "@/lib/identity";
import { CONNECTORS_INFO_HREF } from "@/lib/app-links";
import {
  acceptGoogleRedirect, createWalletPasskey, currentPasskeySession, finishEmailSignIn, signInWithPasskey,
  signOutPasskey, startEmailSignIn, startGoogleSignIn,
} from "@/lib/wallets/passkey-wallet";

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

  // Back from Google: keep the session it created and carry on to the passkey step.
  useEffect(() => {
    const googleError = new URLSearchParams(window.location.search).get("error");
    if (googleError) setError(GOOGLE_ERRORS[googleError] ?? "Google sign-in failed. Please try again.");
    if (acceptGoogleRedirect()) void currentPasskeySession().then(setSession);
  }, [setSession]);

  useEffect(() => {
    if ((isAuthenticated || (forConnectors && signedIn)) && !busy && !warning) setLocation(takeReturnPath());
  }, [isAuthenticated, signedIn, busy, warning, setLocation]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (e) {
      const message = (e as Error).message || "Something went wrong";
      setError(/NotAllowedError|cancel|timed out/i.test(message) ? "The passkey request was cancelled. Try again when you are ready." : message);
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

  // Step 2: signed in, wallet passkey not created yet.
  if (signedIn && !session?.credentialId && !forConnectors) {
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
            if (created.errors?.length) setWarning("Your wallet is ready, but part of the setup is still finishing. Signing in again retries.");
            setSession(created);
          })}>
            {spinner("create") ?? <><KeyRound className="h-4 w-4 mr-2" />Create wallet passkey</>}
          </Button>
          {busy === "create" && <p className="text-[11px] text-muted-foreground">Creating your accounts. This takes about 10 seconds.</p>}
          <button className="text-[11.5px] text-muted-foreground underline mt-2" onClick={() => void signOutPasskey().then(() => setSession(null))}>
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
            New here? Signing in creates your account.{" "}
            <a href={CONNECTORS_INFO_HREF} className="underline">What is the Connector Programme?</a>
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
            New users: sign in with email or Google, then create a passkey for your wallet.
          </p>
        )}
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>
    </div>
  );
}
