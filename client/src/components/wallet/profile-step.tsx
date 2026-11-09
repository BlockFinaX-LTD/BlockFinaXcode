/**
 * "Let's create your profile": shown once, right after a new account first signs in with
 * email or Google and before it creates its wallet passkey. Accounts that already have a
 * wallet or a profile never see it.
 *
 * Asks only the person's name, their country of residence and whether they start as a
 * hedger or an underwriter (both stay one switch apart in the app; a business account is
 * added from the app too). The email comes from sign-up. Saved through
 * POST /api/v2/onboarding, which also starts sanctions screening.
 */
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import logoPath from "@/assets/logo.png";
import { api } from "@/lib/wallets/passkey-wallet";
import { COUNTRIES, PRIORITY_COUNTRIES, validateOnboarding } from "@shared/onboarding";

type StartAs = "hedger" | "underwriter";

/** A first guess from the device's time zone, for the countries we cover first. */
const ZONES: Record<string, string> = {
  "Africa/Accra": "GH", "Africa/Lagos": "NG", "Africa/Nairobi": "KE", "Africa/Johannesburg": "ZA", "Africa/Cairo": "EG",
};
function guessCountry() {
  try { return ZONES[Intl.DateTimeFormat().resolvedOptions().timeZone] ?? ""; } catch { return ""; }
}

function useCountries() {
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames(["en"], { type: "region" }); } catch { /* older browsers show codes */ }
    const label = (code: string) => names?.of(code) ?? code;
    const first = PRIORITY_COUNTRIES.map((c) => ({ code: c as string, name: label(c) }));
    const rest = COUNTRIES.slice(PRIORITY_COUNTRIES.length).map((c) => ({ code: c, name: label(c) })).sort((a, b) => a.name.localeCompare(b.name));
    return { first, rest };
  }, []);
}

const field = "w-full h-11 rounded-xl border border-input bg-background px-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-ring";

export function ProfileStep({ email, defaultName, onDone, onSignOut }: {
  email?: string | null;
  defaultName?: string | null;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const { first, rest } = useCountries();
  const [fullName, setFullName] = useState(defaultName ?? "");
  const [country, setCountry] = useState(guessCountry);
  const [startAs, setStartAs] = useState<StartAs>("hedger");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every sign-up starts as a personal account; the workspace opens on the side they chose.
  const form = { accountType: "individual" as const, fullName, country, intents: [startAs === "underwriter" ? "underwrite" : "payables"] };
  const { problems } = validateOnboarding(form);

  async function submit() {
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/v2/onboarding", form);
      try { localStorage.setItem("bfx:cover-role", startAs); } catch { /* the app opens as a hedger */ }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card px-8 py-10 shadow-sm">
        <img src={logoPath} alt="BlockFinaX" className="h-10 w-10 object-contain mb-5" />
        <h1 className="bfx-display text-[24px] font-semibold tracking-tight">Let's create your profile</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          {email}{email ? " · " : ""}
          <button className="text-primary underline-offset-2 hover:underline" onClick={onSignOut}>Log out</button>
        </p>

        <div className="mt-7 space-y-5">
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">Full name</span>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className="h-11 rounded-xl" placeholder="As on your ID" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">Country of residence</span>
            <select className={field} value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">Choose a country</option>
              {first.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              <option disabled>──────────</option>
              {rest.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">I want to</span>
            <select className={field} value={startAs} onChange={(e) => setStartAs(e.target.value as StartAs)}>
              <option value="hedger">Protect payments or income (Hedger)</option>
              <option value="underwriter">Earn premiums by backing cover (Underwriter)</option>
            </select>
          </label>
        </div>

        {tried && problems[0] && <p className="text-xs text-red-500 mt-4">{problems[0]}</p>}
        {error && <p className="text-xs text-red-500 mt-4">{error}</p>}
        <Button className="w-full h-11 rounded-xl mt-7" disabled={busy} onClick={submit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
        </Button>
        <p className="text-[11.5px] text-muted-foreground mt-4 leading-snug">
          Next you create your passkey. You can switch between Hedger and Underwriter, or add a business account, at any time in the app.
        </p>
      </div>
    </div>
  );
}
