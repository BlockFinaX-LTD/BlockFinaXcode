/**
 * auth-gate.tsx — Gates /auth so randos can't reach the Rift signup widget.
 *
 * Rules for passing:
 *   1. The visitor came from the approval email — `?t=<signin-token>` in
 *      the URL. We verify the token server-side, persist it in localStorage,
 *      strip the query, and let them through.
 *   2. The visitor already has a stored signin token that's still valid.
 *   3. The visitor already has an authenticated Rift session (returning
 *      user opening the app on a device that previously signed in).
 *
 * Otherwise we render a wall pointing them to /apply.
 *
 * Note this gate stacks BELOW AccessGate, which lives in App.tsx and runs
 * after the Rift widget completes sign-in. AuthGate hides the widget from
 * non-approved visitors; AccessGate then enforces the allowlist on the
 * resulting Rift account's email.
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useIdentity as useRift } from '@/lib/identity';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRight } from 'lucide-react';
import {
  getStoredSigninToken,
  setStoredSigninToken,
  verifySigninToken,
} from '@/lib/access';
import logoPath from '@/assets/logo.png';

type Phase =
  | { kind: 'checking' }
  | { kind: 'allowed' }
  | { kind: 'denied'; reason: 'none' | 'expired' | 'revoked' };

// True on first paint if the Rift provider has a persisted session in storage
// (same pattern AuthGuard in App.tsx uses). Lets us short-circuit the gate
// for returning users without flickering the wall.
function hasStoredRiftSession(): boolean {
  if (typeof window === 'undefined') return false;
  try { return !!window.localStorage.getItem('rift:identity'); } catch { return false; }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useRift();
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // 1) Already authenticated via Rift → no gate. AccessGate downstream
      //    enforces the allowlist on the resulting email.
      if (isAuthenticated || hasStoredRiftSession()) {
        if (!cancelled) setPhase({ kind: 'allowed' });
        return;
      }

      // 2) Token in URL?
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('t');
      if (urlToken) {
        const result = await verifySigninToken(urlToken);
        if (cancelled) return;
        if (result.valid && result.expiresAt) {
          setStoredSigninToken(urlToken, result.expiresAt);
          params.delete('t');
          const cleaned =
            window.location.pathname +
            (params.toString() ? `?${params}` : '') +
            window.location.hash;
          window.history.replaceState({}, '', cleaned);
          setPhase({ kind: 'allowed' });
          return;
        }
      }

      // 3) Stored token still valid?
      const stored = getStoredSigninToken();
      if (stored) {
        const result = await verifySigninToken(stored.token);
        if (cancelled) return;
        if (result.valid) {
          // Pick up the renewed expiry the server may have pushed forward.
          if (result.expiresAt) setStoredSigninToken(stored.token, result.expiresAt);
          setPhase({ kind: 'allowed' });
          return;
        }
        const reason: 'expired' | 'revoked' =
          result.reason === 'revoked' ? 'revoked' : 'expired';
        setPhase({ kind: 'denied', reason });
        return;
      }

      if (!cancelled) setPhase({ kind: 'denied', reason: 'none' });
    }

    run();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  if (phase.kind === 'checking') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <img src={logoPath} alt="BlockFinaX" className="h-12 w-12 object-contain mx-auto mb-3" />
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking access&hellip;
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === 'allowed') return <>{children}</>;

  const headline =
    phase.reason === 'expired'
      ? 'Your sign-in link has expired'
      : phase.reason === 'revoked'
      ? 'This sign-in link is no longer valid'
      : 'Sign-in is by invitation only';

  const sub =
    phase.reason === 'expired'
      ? 'Request access again to get a fresh link.'
      : phase.reason === 'revoked'
      ? 'Reach out if you need a new link.'
      : 'Submit a short application and we&rsquo;ll send you a sign-in link once you&rsquo;re approved.';

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <img src={logoPath} alt="BlockFinaX" className="h-12 w-12 object-contain mx-auto mb-5" />
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 leading-tight">
          {headline}
        </h1>
        <p
          className="mt-3 text-sm sm:text-base text-gray-500 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: sub }}
        />

        <div className="mt-7 flex flex-col items-center gap-3">
          <Button
            onClick={() => setLocation('/apply')}
            className="w-full sm:w-auto h-11 sm:min-w-[200px] rounded-full px-7 bg-gray-900 text-white hover:bg-gray-800"
          >
            Request access <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation('/')}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Back to home
          </Button>
        </div>
      </div>
    </div>
  );
}
