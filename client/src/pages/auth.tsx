/**
 * auth.tsx — Sign in / sign up via the Rift hosted widget
 *
 * Auth is delegated to @rift-finance/react (email/phone OTP, Google, Apple); a
 * Rift smart wallet is auto-provisioned on first sign-in. We render a branded
 * screen with Sign in / Create account and an OPTIONAL referral-code field, then
 * open the widget on click and redirect once isAuthenticated flips true.
 *
 * Referral: the code is prefilled from /auth?ref=CODE (a referral link) or typed
 * here, and persisted to localStorage so it's attributed right after the Rift
 * signup completes (see RiftPostSigninSync in App.tsx). The server only honors
 * it for a genuinely new wallet.
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useRift } from '@rift-finance/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Gift } from 'lucide-react';
import logoPath from '@/assets/logo.png';

export default function Auth() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, open, error } = useRift();
  const [refCode, setRefCode] = useState('');

  // Prefill the referral code from the URL (referral link) or a prior visit.
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('ref');
      const code = (fromUrl || localStorage.getItem('bfx_ref') || '').trim().toUpperCase();
      if (code) { setRefCode(code); localStorage.setItem('bfx_ref', code); }
    } catch { /* ignore */ }
  }, []);

  const onRefChange = (val: string) => {
    const code = val.trim().toUpperCase();
    setRefCode(code);
    try {
      if (code) localStorage.setItem('bfx_ref', code);
      else localStorage.removeItem('bfx_ref');
    } catch { /* ignore */ }
  };

  // Redirect home the moment the widget signs the user in.
  useEffect(() => {
    if (isAuthenticated) setLocation('/home');
  }, [isAuthenticated, setLocation]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      {isAuthenticated ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Signing you in…
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center max-w-xs w-full">
          <img src={logoPath} alt="BlockFinaX" className="h-14 w-14 object-contain" />
          <div className="space-y-1">
            <h1 className="bfx-display text-[20px] font-semibold tracking-tight">BlockFinaX</h1>
            <p className="text-[12.5px] text-muted-foreground">Cross-border payments &amp; cover</p>
          </div>

          <div className="flex flex-col items-stretch gap-2 mt-4 w-full">
            <Button className="w-full h-11 rounded-xl" onClick={() => open({ mode: 'signin' })}>
              Sign in
            </Button>
            <Button variant="outline" className="w-full h-11 rounded-xl" onClick={() => open({ mode: 'signup' })}>
              Create account
            </Button>
          </div>

          {/* Optional referral code — for people signing up with a friend's code. */}
          <div className="w-full text-left mt-4">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Gift className="h-3 w-3" /> Referral code <span className="opacity-60 normal-case tracking-normal font-normal">(optional)</span>
            </label>
            <Input
              value={refCode}
              onChange={(e) => onRefChange(e.target.value)}
              placeholder="BFX-XXXXXX"
              className="mt-1.5 h-11 rounded-xl font-mono tracking-wider uppercase"
              autoCapitalize="characters"
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
              Got a code from a friend? Enter it before creating your account — you'll both earn points once you make your first move.
            </p>
          </div>

          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}
