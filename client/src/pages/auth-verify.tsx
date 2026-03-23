/**
 * auth-verify.tsx — Magic link token verification page
 *
 * Loaded when the user clicks the magic link from their email.
 * URL: /auth/verify?token=<hex_token>
 *
 * On success: stores session token in localStorage → redirects to /set-pin or /home.
 * On failure: shows an error with a link back to /auth.
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';
import { SESSION_KEY } from '@/hooks/use-auth';

type Status = 'verifying' | 'success' | 'error';

export default function AuthVerify() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>('verifying');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setErrorMsg('No verification token found in the URL.');
      setStatus('error');
      return;
    }

    fetch(`/api/auth/verify/${token}`)
      .then(res => res.json())
      .then(data => {
        if (!data.ok) throw new Error(data.message || 'Verification failed');
        localStorage.setItem(SESSION_KEY, data.sessionToken);
        setStatus('success');
        // Short delay so user sees the success state
        setTimeout(() => {
          // If this device already has an encrypted wallet, go to unlock screen.
          // Otherwise send new users through PIN setup → wallet creation.
          const hasWallet = !!localStorage.getItem('wallet_encrypted');
          setLocation(hasWallet ? '/unlock-wallet' : '/set-pin');
        }, 1200);
      })
      .catch((err: Error) => {
        setErrorMsg(err.message);
        setStatus('error');
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />

      <Card className="w-full max-w-sm relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardContent className="pt-10 pb-10 text-center space-y-5">
          <img src={logoPath} alt="BlockFinaX" className="h-10 w-10 object-contain mx-auto" />

          {status === 'verifying' && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
              <p className="text-sm text-muted-foreground">Verifying your sign-in link…</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
              <div>
                <h2 className="text-lg font-semibold">Signed in!</h2>
                <p className="text-sm text-muted-foreground mt-1">Redirecting you now…</p>
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-12 w-12 text-destructive mx-auto" />
              <div>
                <h2 className="text-lg font-semibold">Link expired</h2>
                <p className="text-sm text-muted-foreground mt-1">{errorMsg}</p>
              </div>
              <Button className="w-full" onClick={() => setLocation('/auth')}>
                Try again
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
