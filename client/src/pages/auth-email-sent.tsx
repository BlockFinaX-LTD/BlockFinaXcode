/**
 * auth-email-sent.tsx — "Check your email" screen with cross-device polling
 *
 * After the magic link email is sent, the PC waits here. Every 3 seconds it
 * asks the server "has this link been verified yet?" — if the user clicks the
 * link on their phone (or any other device), the server picks it up and this
 * page automatically logs in the PC without any extra steps.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mail, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';
import { SESSION_KEY } from '@/hooks/use-auth';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // stop polling after 15 min (link expiry)

export default function AuthEmailSent() {
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email') || 'your inbox';

  const [loginDetected, setLoginDetected] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const pollToken = sessionStorage.getItem('bfx_poll_token');
    if (!pollToken) return; // nothing to poll for

    const stopPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };

    const poll = async () => {
      try {
        const res = await fetch(`/api/auth/magic-link/poll?token=${pollToken}`);
        const data = await res.json();
        if (data.ok && data.sessionToken) {
          stopPolling();
          sessionStorage.removeItem('bfx_poll_token');
          localStorage.setItem(SESSION_KEY, data.sessionToken);
          setLoginDetected(true);
          // Brief pause so the user sees the success state, then navigate
          setTimeout(() => {
            const hasWallet = !!localStorage.getItem('wallet_encrypted');
            setLocation(hasWallet ? '/unlock-wallet' : '/set-pin');
          }, 1500);
        }
      } catch {
        // Network blip — just wait for the next tick
      }
    };

    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    // Stop polling when the link expires anyway
    timeoutRef.current = setTimeout(stopPolling, POLL_TIMEOUT_MS);

    return stopPolling;
  }, []);

  if (loginDetected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
        <FinanceAnimatedBackground />
        <Card className="w-full max-w-md relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
          <CardContent className="pt-8 pb-8 text-center space-y-6">
            <img src={logoPath} alt="BlockFinaX" className="h-10 w-10 object-contain mx-auto" />
            <div className="flex flex-col items-center gap-3">
              <div className="h-16 w-16 rounded-full bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h1 className="text-2xl font-bold">Signed in!</h1>
              <p className="text-muted-foreground text-sm">Link verified. Taking you in now…</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />
      <Card className="w-full max-w-md relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardContent className="pt-8 pb-8 text-center space-y-6">
          <div className="flex justify-center">
            <img src={logoPath} alt="BlockFinaX" className="h-10 w-10 object-contain" />
          </div>

          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
              <Mail className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold">Check your email</h1>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
              We sent a sign-in link to <strong>{email}</strong>.
              Click the link in the email to continue — it expires in 15 minutes.
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Waiting for you to click the link…</span>
          </div>

          <div className="space-y-1 text-sm text-muted-foreground">
            <p>No email? Check your spam folder.</p>
            <p>Once you click the link anywhere — phone or PC — this page logs you in automatically.</p>
          </div>

          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setLocation('/auth')}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to sign in
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
