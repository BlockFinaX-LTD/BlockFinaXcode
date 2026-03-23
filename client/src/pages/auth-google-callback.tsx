/**
 * auth-google-callback.tsx — Handle Google OAuth redirect
 *
 * Google redirects here after the user authenticates. The access token
 * arrives in the URL hash (#access_token=...). We extract it, post it to
 * the server, store the session, then navigate to the right page.
 */

import { useEffect, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { SESSION_KEY } from '@/hooks/use-auth';

export default function AuthGoogleCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);

    const accessToken = params.get('access_token');
    const oauthError = params.get('error');

    // Also check query string (some flows put error there)
    const qParams = new URLSearchParams(window.location.search);
    const qError = qParams.get('error');

    if (oauthError || qError) {
      const msg = oauthError || qError || 'unknown_error';
      if (msg === 'access_denied') {
        window.location.replace('/auth');
        return;
      }
      setError(`Google sign-in failed: ${msg}`);
      return;
    }

    if (!accessToken) {
      setError('No access token received from Google.');
      return;
    }

    // Exchange the access token for a BlockFinaX session
    fetch('/api/auth/google-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) throw new Error(data.message || 'Auth failed');
        localStorage.setItem(SESSION_KEY, data.sessionToken);
        // If wallet already on this device, send to unlock; otherwise set a PIN
        const hasLocalWallet = !!localStorage.getItem('wallet_encrypted');
        window.location.replace(hasLocalWallet ? '/unlock-wallet' : '/set-pin');
      })
      .catch(err => {
        setError(err.message || 'Google sign-in failed. Please try again.');
      });
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
