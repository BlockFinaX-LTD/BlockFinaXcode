/**
 * auth.tsx — Unified authentication entry page
 *
 * Options:
 *   1. Continue with Google (requires GOOGLE_CLIENT_ID env var)
 *   2. Continue with Email (magic link)
 *   3. Use Face ID / Fingerprint (WebAuthn passkey)
 *   4. Import existing wallet (seed phrase / private key)
 *
 * After any successful auth, redirects to /set-pin (new users) or /home (returning users).
 */

import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, ArrowRight, Fingerprint, Download, ArrowLeft } from 'lucide-react';
import { SiGoogle } from 'react-icons/si';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';
import { isWebAuthnSupported, authenticateWithPasskey, getPasskeyLabel } from '@/lib/webauthn';
import { decryptPinFromLocalStorage, hasLocalPin } from '@/lib/auth-crypto';
import { SESSION_KEY } from '@/hooks/use-auth';
import { pinStore } from '@/lib/pin-store';

type View = 'main' | 'email';

export default function Auth() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [view, setView] = useState<View>('main');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [passkeyLabel, setPasskeyLabel] = useState('Face ID / Fingerprint');
  const [webauthnAvailable, setWebauthnAvailable] = useState(false);
  const [hasStoredPin, setHasStoredPin] = useState(false);

  const googleConfigured = !!(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

  // Check WebAuthn support and whether a passkey is already registered on this device
  useEffect(() => {
    getPasskeyLabel().then(setPasskeyLabel);
    setWebauthnAvailable(isWebAuthnSupported());
    setHasStoredPin(hasLocalPin());
  }, []);

  // Popup-based Google sign-in — opens a small window for the OAuth flow,
  // listens for the session token via postMessage, then navigates in-place.
  const handleGoogleClick = useCallback(() => {
    const width = 500;
    const height = 620;
    const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
    const top = Math.round(window.screenY + (window.outerHeight - height) / 2);
    const popup = window.open(
      '/api/auth/google/start?popup=1',
      'google-oauth',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );
    if (!popup) {
      // Popup was blocked — fall back to redirect
      window.location.href = '/api/auth/google/start';
      return;
    }
    setIsLoading(true);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'google-auth') return;
      window.removeEventListener('message', onMessage);
      setIsLoading(false);

      if (event.data.error) {
        const msg = event.data.error === 'access_denied' ? 'Sign-in was cancelled.' : `Google sign-in failed: ${event.data.error}`;
        toast({ title: 'Google sign-in failed', description: msg, variant: 'destructive' });
        return;
      }

      if (event.data.token) {
        localStorage.setItem(SESSION_KEY, event.data.token);
        const hasLocalWallet = !!localStorage.getItem('wallet_encrypted');
        setLocation(hasLocalWallet ? '/unlock-wallet' : '/set-pin');
      }
    };

    window.addEventListener('message', onMessage);

    // Clean up if user closes the popup manually
    const pollClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollClosed);
        window.removeEventListener('message', onMessage);
        setIsLoading(false);
      }
    }, 500);
  }, [setLocation, toast]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: 'Enter a valid email address', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      // Save poll token so the "check your email" page can detect cross-device login
      if (data.pollToken) {
        sessionStorage.setItem('bfx_poll_token', data.pollToken);
      }
      // Dev mode: if no SMTP configured, server returns the verification URL directly
      if (data.devUrl) {
        toast({ title: 'Dev mode: magic link', description: 'Click the link in the console or use the URL returned by the API.' });
        console.log('[Auth] Magic link URL:', data.devUrl);
        // In dev, auto-redirect to the verify URL
        window.location.href = data.devUrl;
        return;
      }
      setLocation(`/auth/email-sent?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      toast({ title: 'Failed to send link', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskey = async () => {
    setIsLoading(true);
    try {
      // Get challenge from server
      const challengeRes = await fetch('/api/auth/webauthn/auth-challenge', { method: 'POST' });
      const options = await challengeRes.json();
      // Prompt Face ID / fingerprint
      const authResponse = await authenticateWithPasskey(options);
      // Send assertion to server
      const res = await fetch('/api/auth/webauthn/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: authResponse }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      localStorage.setItem(SESSION_KEY, data.sessionToken);
      // Try to auto-unlock wallet using device unlock key + stored encrypted PIN
      if (data.deviceUnlockKey && hasLocalPin()) {
        const pin = await decryptPinFromLocalStorage(data.deviceUnlockKey);
        if (pin) {
          pinStore.set(pin);
        }
      }
      setLocation('/home');
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        toast({ title: 'Cancelled', description: 'Face ID / fingerprint was cancelled.' });
      } else {
        toast({ title: 'Face ID failed', description: err.message || 'Please try PIN instead.', variant: 'destructive' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />

      <Card className="w-full max-w-sm relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardContent className="pt-8 pb-8 space-y-6">

          {/* Logo + title */}
          <div className="text-center space-y-2">
            <img src={logoPath} alt="BlockFinaX" className="h-10 w-10 object-contain mx-auto" />
            <h1 className="text-2xl font-bold">Welcome to BlockFinaX</h1>
            <p className="text-sm text-muted-foreground">P2P hedging for African markets</p>
          </div>

          {view === 'main' && (
            <div className="space-y-3">
              {/* Google — only shown when VITE_GOOGLE_CLIENT_ID is set */}
              {googleConfigured && (
                <Button
                  variant="outline"
                  className="w-full h-12 text-sm font-medium"
                  onClick={handleGoogleClick}
                  disabled={isLoading}
                >
                  <SiGoogle className="h-4 w-4 mr-3 text-[#4285F4]" />
                  Continue with Google
                </Button>
              )}

              {/* Email */}
              <Button
                variant="outline"
                className="w-full h-12 text-sm font-medium"
                onClick={() => setView('email')}
                disabled={isLoading}
              >
                <Mail className="h-4 w-4 mr-3 text-muted-foreground" />
                Continue with Email
              </Button>

              {/* Face ID / Fingerprint — only show if device supports it */}
              {webauthnAvailable && (
                <Button
                  variant="outline"
                  className="w-full h-12 text-sm font-medium"
                  onClick={handlePasskey}
                  disabled={isLoading}
                >
                  {isLoading
                    ? <Loader2 className="h-4 w-4 mr-3 animate-spin" />
                    : <Fingerprint className="h-4 w-4 mr-3 text-muted-foreground" />
                  }
                  {hasStoredPin ? `Unlock with ${passkeyLabel}` : passkeyLabel}
                </Button>
              )}

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <Separator />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>

              {/* Import wallet */}
              <Button
                variant="ghost"
                className="w-full h-12 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setLocation('/import-wallet')}
                disabled={isLoading}
              >
                <Download className="h-4 w-4 mr-3" />
                Import existing wallet
              </Button>

              {/* Existing users with password wallets */}
              <p className="text-center text-xs text-muted-foreground pt-1">
                Have an existing BlockFinaX wallet?{' '}
                <button
                  className="text-primary hover:underline font-medium"
                  onClick={() => setLocation('/unlock-wallet')}
                >
                  Unlock it here
                </button>
              </p>
            </div>
          )}

          {view === 'email' && (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <button
                type="button"
                onClick={() => setView('main')}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>

              <div className="space-y-2">
                <Label htmlFor="email">Your email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoFocus
                  autoComplete="email"
                />
              </div>

              <Button type="submit" className="w-full h-12" disabled={isLoading}>
                {isLoading
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <ArrowRight className="h-4 w-4 mr-2" />
                }
                Send sign-in link
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                We'll email you a link — no password needed.
              </p>
            </form>
          )}

          <p className="text-center text-xs text-muted-foreground border-t pt-4">
            By continuing you agree to our{' '}
            <a href="/terms" className="underline hover:text-foreground">Terms</a>
            {' & '}
            <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
