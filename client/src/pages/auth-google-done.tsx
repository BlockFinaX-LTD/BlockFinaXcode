/**
 * auth-google-done.tsx — Post-Google-OAuth landing page
 *
 * The server redirects here after successfully exchanging the OAuth code:
 *   /auth/google/done#token=<sessionToken>          (normal redirect flow)
 *   /auth/google/done?popup=1#token=<sessionToken>  (popup flow)
 *
 * In popup mode: posts the token to the opener window and closes itself.
 * In normal mode: stores the token and navigates the current window.
 */

import { useEffect, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { SESSION_KEY } from '@/hooks/use-auth';

export default function AuthGoogleDone() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qParams = new URLSearchParams(window.location.search);
    const isPopup = qParams.get('popup') === '1';
    const qError = qParams.get('error');

    if (qError) {
      const msg = `Google sign-in failed: ${qError}`;
      if (isPopup && window.opener) {
        window.opener.postMessage({ type: 'google-auth', error: qError }, window.location.origin);
        window.close();
      } else {
        setError(msg);
      }
      return;
    }

    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const token = params.get('token');

    if (!token) {
      const msg = 'No session token received. Please try again.';
      if (isPopup && window.opener) {
        window.opener.postMessage({ type: 'google-auth', error: 'no_token' }, window.location.origin);
        window.close();
      } else {
        setError(msg);
      }
      return;
    }

    if (isPopup && window.opener) {
      // Send token to the parent window and close the popup
      window.opener.postMessage({ type: 'google-auth', token }, window.location.origin);
      window.close();
      return;
    }

    // Normal (non-popup) redirect flow
    localStorage.setItem(SESSION_KEY, token);
    window.history.replaceState(null, '', window.location.pathname);
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
