/**
 * auth-google-done.tsx — Post-Google-OAuth landing page
 *
 * The server redirects here after successfully exchanging the OAuth code:
 *   /auth/google/done#token=<sessionToken>
 *
 * We read the token from the URL hash (never sent to any server), store it
 * in localStorage, then navigate the user to the right next step.
 */

import { useEffect, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { SESSION_KEY } from '@/hooks/use-auth';

export default function AuthGoogleDone() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for error forwarded in query string from server
    const qParams = new URLSearchParams(window.location.search);
    const qError = qParams.get('error');
    if (qError) {
      setError(`Google sign-in failed: ${qError}`);
      return;
    }

    // Token arrives in the URL hash so it's never sent to any server
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const token = params.get('token');

    if (!token) {
      setError('No session token received. Please try again.');
      return;
    }

    // Store session and navigate
    localStorage.setItem(SESSION_KEY, token);
    // Clear the token from the URL immediately
    window.history.replaceState(null, '', window.location.pathname);

    // If wallet already exists on this device → unlock; otherwise set up PIN
    const hasLocalWallet = !!localStorage.getItem('wallet_encrypted');
    window.location.replace(hasLocalWallet ? '/unlock-wallet' : '/set-pin');
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
        <XCircle className="h-10 w-10 text-destructive" />
        <p className="text-sm text-destructive text-center max-w-xs">{error}</p>
        <a href="/auth" className="text-sm text-primary hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center gap-3">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <span className="text-sm text-muted-foreground">Signing you in with Google…</span>
    </div>
  );
}
