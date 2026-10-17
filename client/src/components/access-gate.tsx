/**
 * access-gate.tsx — Gates app routes behind the allowlist.
 *
 * After Rift sign-in, we resolve the user's email via the wallet SDK,
 * call /api/access/check, and either let them through or render the
 * "Pending review / Apply" wall. Cached for 5 min in sessionStorage.
 *
 * Used in App.tsx around protected routes.
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useIdentity as useRift } from '@/lib/identity';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Clock, Lock, CheckCircle, XCircle } from 'lucide-react';
import { checkAccess, type AccessStatus } from '@/lib/access';
import { getMe } from '@/lib/rift-client';
import logoPath from '@/assets/logo.png';

type GateState =
  | { phase: 'loading' }
  | { phase: 'allowed' }
  | { phase: 'denied'; email: string | null; status: AccessStatus };

interface Props {
  children: React.ReactNode;
}

export function AccessGate({ children }: Props) {
  const { isAuthenticated, user } = useRift();
  const [, setLocation] = useLocation();
  const [state, setState] = useState<GateState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!isAuthenticated || !user) {
        // Not signed in — nothing to gate. The AuthGuard will redirect to /auth.
        if (!cancelled) setState({ phase: 'loading' });
        return;
      }
      // The widget's RiftUser only has uuid + address — we need the email from
      // the SDK profile call to do the allowlist check.
      const me = await getMe();
      const email = (me as any)?.email?.toLowerCase?.() || null;
      if (!email) {
        if (!cancelled) setState({ phase: 'denied', email: null, status: 'none' });
        return;
      }
      const { allowed, status } = await checkAccess(email);
      if (cancelled) return;
      setState(allowed ? { phase: 'allowed' } : { phase: 'denied', email, status });
    }
    check();
    return () => { cancelled = true; };
  }, [isAuthenticated, user?.user]);

  // Not signed in OR while checking — show a clean spinner.
  if (state.phase === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <img src={logoPath} alt="BlockFinaX" className="h-14 w-14 object-contain mx-auto mb-3" />
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === 'allowed') return <>{children}</>;

  // Denied — surface the right message based on status
  const { email, status } = state;
  const isPending = status === 'pending';
  const isRejected = status === 'rejected';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-md w-full rounded-2xl">
        <CardContent className="pt-8 pb-7 text-center space-y-5">
          <div
            className={`mx-auto h-14 w-14 rounded-full flex items-center justify-center ${
              isPending
                ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
                : isRejected
                ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400'
                : 'bg-primary/10 text-primary'
            }`}
          >
            {isPending ? <Clock className="h-7 w-7" strokeWidth={1.8} />
              : isRejected ? <XCircle className="h-7 w-7" strokeWidth={1.8} />
              : <Lock className="h-7 w-7" strokeWidth={1.8} />}
          </div>

          <div>
            <h1 className="bfx-display text-xl font-semibold tracking-tight">
              {isPending ? 'Your application is in review'
                : isRejected ? 'Access not granted yet'
                : 'Request access to continue'}
            </h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {isPending ? (
                <>We received your application{email ? <> for <span className="font-mono-data text-foreground">{email}</span></> : null}. Most decisions land within 48 hours — we'll email you the moment you're in.</>
              ) : isRejected ? (
                <>We're not opening access in your segment quite yet, but we're keeping your details and will reach out as soon as we expand.</>
              ) : (
                <>You're signed in as <span className="font-mono-data text-foreground">{email || 'this account'}</span>, but it's not on the allowlist yet. Apply once below and we'll review within 48 hours.</>
              )}
            </p>
          </div>

          {!isPending && !isRejected && (
            <Button
              onClick={() => setLocation('/apply')}
              className="w-full rounded-xl h-11"
            >
              Apply for access
            </Button>
          )}

          {(isPending || isRejected) && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle className="h-3 w-3 text-emerald-500" />
              We'll email <span className="font-mono-data text-foreground">{email}</span> when there's news
            </div>
          )}

          <div className="pt-2">
            <Button variant="ghost" size="sm" onClick={() => setLocation('/')}>
              Back to home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
