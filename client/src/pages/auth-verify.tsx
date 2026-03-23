/**
 * auth-verify.tsx — Magic link token verification page
 *
 * Loaded when the user clicks the magic link from their email.
 * URL: /auth/verify?token=<hex_token>
 *
 * On success: shows confirmation + "go back to original device" message.
 * User can also choose to continue on this device (enter PIN here).
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, ArrowRight, MonitorSmartphone } from 'lucide-react';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';
import { SESSION_KEY } from '@/hooks/use-auth';

type Status = 'verifying' | 'success' | 'error';

export default function AuthVerify() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>('verifying');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasLocalWallet, setHasLocalWallet] = useState(false);

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
        setHasLocalWallet(!!localStorage.getItem('wallet_encrypted'));
        setStatus('success');
      })
      .catch((err: Error) => {
        setErrorMsg(err.message);
        setStatus('error');
      });
  }, []);

  const continueHere = () => {
    setLocation(hasLocalWallet ? '/unlock-wallet' : '/set-pin');
  };

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
                <h2 className="text-lg font-semibold">Link verified!</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Your sign-in is confirmed.
                </p>
              </div>

              <div className="rounded-lg bg-muted/60 p-4 flex gap-3 items-start text-left">
                <MonitorSmartphone className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Switch back to your original browser or device — it should log you in automatically.
                </p>
              </div>

              <div className="space-y-2 pt-1">
                <p className="text-xs text-muted-foreground">Or continue on this device:</p>
                <Button className="w-full" onClick={continueHere}>
                  {hasLocalWallet ? 'Enter PIN to unlock' : 'Set up PIN here'}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
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
