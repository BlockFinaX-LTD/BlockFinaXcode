/**
 * investor-gate.tsx — admits only a live data-room session.
 *
 * The whitepaper used to be a website route behind the magic-link docs gate,
 * linked from the public navigation. It is an investor document, so it now
 * lives under /data-room/whitepaper and is reachable only by someone who has
 * already entered the data room.
 *
 * Deliberately narrower than DocsGate. That gate has four ways in — a URL key,
 * a magic-link token, a stored docs token, an admin bypass — and any of them
 * would reopen the whitepaper to people outside the data room, which is the
 * thing being removed. Here there is one credential: the investor session the
 * data-room password issues.
 *
 * A visitor without one is sent to /data-room rather than shown a wall. There
 * is exactly one way to get in and it is one click away, so a second "request
 * access" screen would only be a longer route to the same password box.
 */

import { useEffect, useState } from 'react';
import { Redirect } from 'wouter';
import { Loader2 } from 'lucide-react';

/** Kept in sync with SESSION_KEY in data-room.tsx and docs-gate.tsx. */
const INVESTOR_SESSION_KEY = 'bfx_investor_token';

type Phase = 'checking' | 'allowed' | 'denied';

export function InvestorGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(INVESTOR_SESSION_KEY);
      } catch {
        /* storage blocked — treat as no session */
      }
      if (!stored) {
        if (!cancelled) setPhase('denied');
        return;
      }
      // The server decides. A token in localStorage is a claim, not a
      // credential — this is the same call the data room makes on its own
      // load, against sessions only the correct password creates.
      try {
        const res = await fetch('/api/investor/verify', {
          headers: { 'x-investor-token': stored },
        });
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        setPhase(data?.valid ? 'allowed' : 'denied');
      } catch {
        if (!cancelled) setPhase('denied');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (phase === 'denied') return <Redirect to="/data-room" />;
  return <>{children}</>;
}
