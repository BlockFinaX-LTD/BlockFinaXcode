/**
 * /invite/:token: a testnet invitation for an outside reviewer.
 *
 * First visit: the link starts the account (no email code), the reviewer creates their own
 * wallet passkey, the wallet is funded with test USDC, and the app opens.
 * Return visits: sign in with the same passkey, here or on the normal sign-in page.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import logoPath from "@/assets/logo-mark.png";
import { usePasskeySession } from "@/lib/identity";
import { acceptDemoInvite, api, createWalletPasskey, signInWithPasskey } from "@/lib/wallets/passkey-wallet";
import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";

interface InviteView { label: string; state: "active" | "expired" | "revoked" | "full"; expiresAt: string; fundUsdc: number }

export default function DemoInvitePage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [, setLocation] = useLocation();
  const { setSession } = usePasskeySession();
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<InviteView>(`/api/demo/invites/${encodeURIComponent(token)}`)
      .then((v) => { if (live) setInvite(v); })
      .catch((e: Error) => { if (live) setProblem(e.message); });
    return () => { live = false; };
  }, [token]);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try { await action(); } catch (e) {
      const err = e as Error;
      setError(err.name === "NotAllowedError" || /not allowed|cancel|timed out/i.test(err.message)
        ? "The passkey was not approved. Tap the button again and approve with Face ID, Touch ID or your device PIN."
        : err.message || "Something went wrong");
    } finally { setBusy(null); }
  };

  const start = () => run("start", async () => {
    setStep("Starting your account");
    await acceptDemoInvite(token);
    setStep("Creating your wallet passkey");
    const created = await createWalletPasskey();
    await api("/api/legal/accept", { terms: TERMS_VERSION, privacy: PRIVACY_VERSION }).catch(() => undefined);
    setStep("Adding test USDC to your wallet");
    await api("/api/demo/fund", {}).catch((e: Error) => console.warn("Demo funding:", e.message));
    setSession(created);
    setLocation("/hedge");
  });

  const signIn = () => run("signin", async () => {
    const session = await signInWithPasskey();
    setSession(session);
    setLocation("/hedge");
  });

  const open = invite && (invite.state === "active" || invite.state === "full");
  const until = invite ? new Date(invite.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="flex flex-col items-center gap-3 text-center max-w-sm w-full">
        <img src={logoPath} alt="BlockFinaX" className="h-14 w-14 object-contain" />
        <h1 className="bfx-display text-[20px] font-semibold tracking-tight">BlockFinaX</h1>
        <p className="text-xs text-amber-500">TESTNET</p>

        {!invite && !problem && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mt-4" />}
        {problem && <p className="text-[13px] mt-4">{problem}</p>}

        {invite && !open && (
          <p className="text-[13px] mt-4">
            {invite.state === "revoked" ? "This invitation has been withdrawn." : "This invitation has expired."} Ask the BlockFinaX team for a new link.
          </p>
        )}

        {invite && open && (
          <>
            <p className="text-[14px] font-medium mt-4">You are invited to try BlockFinaX, {invite.label}.</p>
            <p className="text-[12.5px] text-muted-foreground leading-snug">
              Hedge currency risk and trade USDC/NGN, USDC/GHS, USDC/KES and USDC/ZAR perpetuals on Stellar testnet.
              {invite.fundUsdc > 0 ? ` Your wallet gets ${invite.fundUsdc.toLocaleString("en-US")} test USDC to try everything.` : ""}
              {" "}Nothing here uses real money. Access is open until {until}.
            </p>

            {invite.state === "active" && (
              <Button className="w-full h-11 rounded-xl mt-3" disabled={!!busy} onClick={start}>
                {busy === "start" ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{step}</> : <><KeyRound className="h-4 w-4 mr-2" />Create your passkey and start</>}
              </Button>
            )}
            {busy === "start" && <p className="text-[11px] text-muted-foreground">This takes about 20 seconds.</p>}
            <Button variant="outline" className="w-full h-11 rounded-xl" disabled={!!busy} onClick={signIn}>
              {busy === "signin" ? <Loader2 className="h-4 w-4 animate-spin" /> : "I have been here before: sign in with my passkey"}
            </Button>
            {invite.state === "full" && <p className="text-[12px] text-muted-foreground">Every new place on this invitation is taken, but reviewers who already joined can sign in.</p>}

            <div className="flex items-start gap-2 text-left text-[11.5px] text-muted-foreground mt-3">
              <ShieldCheck className="h-4 w-4 flex-none mt-0.5" />
              <span>Your passkey stays on your device and approves every transaction. It creates your own wallet; BlockFinaX never holds its keys.</span>
            </div>
          </>
        )}

        {error && <p className="text-[12.5px] text-red-500 mt-2">{error}</p>}
      </div>
    </div>
  );
}
