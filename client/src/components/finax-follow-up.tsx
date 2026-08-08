/**
 * The consent form Finax can put on screen.
 *
 * Finax decides when to offer; it never does the asking in its own words. The
 * wording next to the checkbox is imported from the shared schema and sent back
 * to the server, which refuses the submission if it does not match its own copy
 * — so what gets recorded as consent is always exactly what was displayed.
 *
 * The checkbox starts unticked and the button stays disabled until it is
 * ticked. A pre-ticked box is not consent under the GDPR, and an "I agree"
 * button with the terms elsewhere on the page is the pattern regulators single
 * out. Declining is a plain visible button, not a small grey link.
 */

import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import { CONSENT_WORDING } from "@shared/lead-schema";
import { cn } from "@/lib/utils";

interface Props {
  threadId: string;
  onDone: () => void;
  onDismiss: () => void;
}

export function FinaxFollowUp({ threadId, onDone, onDismiss }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          name: name.trim() || undefined,
          email: email.trim(),
          consentText: CONSENT_WORDING,
          consented: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Something went wrong.");
      setSent(true);
      setTimeout(onDone, 2200);
    } catch (err: any) {
      setError(err.message || "Couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 px-3.5 py-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Check className="h-4 w-4 text-emerald-600" /> Thanks — we'll be in touch.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          You can unsubscribe from any message we send.
        </p>
      </div>
    );
  }

  const field =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--navy))]/30";

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-muted/40 px-3.5 py-3">
      <p className="text-sm font-medium">Want us to follow up?</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Entirely optional — you can keep using the site either way.
      </p>

      <div className="mt-3 space-y-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (optional)"
          autoComplete="name"
          className={field}
        />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          className={field}
        />
      </div>

      <label className="mt-3 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[hsl(var(--navy))]"
        />
        <span className="text-[11px] leading-snug text-muted-foreground">{CONSENT_WORDING}</span>
      </label>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={!agreed || busy}
          className={cn(
            "rounded-lg bg-[hsl(var(--navy))] px-3 py-1.5 text-xs font-semibold text-white",
            "transition-opacity disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send it"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          No thanks
        </button>
      </div>

      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        See our{" "}
        <a href="/privacy" target="_blank" rel="noreferrer" className="underline">
          privacy policy
        </a>
        .
      </p>
    </form>
  );
}
