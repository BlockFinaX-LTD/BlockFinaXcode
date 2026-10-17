/**
 * Testnet sign-in with the BlockFinaX passkey wallet.
 *
 * Creating a passkey creates the BlockFinaX account and its smart accounts (Stellar now,
 * Base Sepolia at its first transaction). Signing in uses the same passkey. The passkey
 * also approves every transaction; email or Google cannot recover a lost passkey.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import logoPath from "@/assets/logo.png";
import { usePasskeySession } from "@/lib/identity";
import { signInWithPasskey, signUpWithPasskey } from "@/lib/wallets/passkey-wallet";

export function PasskeyAuth() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, setSession } = usePasskeySession();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && !busy && !warning) setLocation("/home");
  }, [isAuthenticated, busy, warning, setLocation]);

  async function run(label: string, action: () => Promise<Awaited<ReturnType<typeof signInWithPasskey>> & { errors?: string[] }>) {
    setBusy(label);
    setError(null);
    setWarning(null);
    try {
      const session = await action();
      if (session.errors?.length) setWarning(`Signed in. Some accounts are not ready yet: ${session.errors.join("; ")}. Signing in again retries.`);
      setSession(session);
    } catch (e) {
      const message = (e as Error).message || "Something went wrong";
      setError(/NotAllowedError|cancel/i.test(message) ? "The passkey request was cancelled. Try again when you are ready." : message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="flex flex-col items-center gap-3 text-center max-w-xs w-full">
        <img src={logoPath} alt="BlockFinaX" className="h-14 w-14 object-contain" />
        <div className="space-y-1">
          <h1 className="bfx-display text-[20px] font-semibold tracking-tight">BlockFinaX</h1>
          <p className="text-[12.5px] text-muted-foreground">Cross-border payments &amp; cover</p>
          <p className="text-xs text-amber-500">TESTNET · Stellar and Base Sepolia · Test tokens only</p>
        </div>

        <div className="flex flex-col items-stretch gap-2 mt-4 w-full">
          <Button className="w-full h-11 rounded-xl" disabled={!!busy} onClick={() => run("Waiting for your passkey...", signInWithPasskey)}>
            {busy?.startsWith("Waiting") ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in with passkey"}
          </Button>
          <div className="text-left mt-3">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              New here? Your name <span className="opacity-60 normal-case tracking-normal font-normal">(optional)</span>
            </label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ama Mensah" className="mt-1.5 h-11 rounded-xl" />
          </div>
          <Button variant="outline" className="w-full h-11 rounded-xl" disabled={!!busy} onClick={() => run("Creating your wallet...", () => signUpWithPasskey(name))}>
            {busy?.startsWith("Creating") ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating your wallet...</> : "Create wallet with a passkey"}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground mt-3 leading-snug">
          Your passkey signs you in and approves every transaction. It stays on your device. Keep it
          available: we cannot recover a lost passkey.
        </p>
        {warning && (
          <div className="text-xs text-amber-500 mt-2 space-y-2">
            <p>{warning}</p>
            <Button size="sm" variant="outline" onClick={() => { setWarning(null); setLocation("/home"); }}>Continue</Button>
          </div>
        )}
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>
    </div>
  );
}
