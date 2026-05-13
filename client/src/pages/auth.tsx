/**
 * auth.tsx — Sign in / sign up via the Rift hosted widget
 *
 * Auth is fully delegated to @rift-finance/react. The widget handles email
 * OTP, phone OTP, Google, and Apple flows; a Rift smart wallet is
 * auto-provisioned on first sign-in. We just open the modal and redirect
 * once isAuthenticated flips true.
 *
 * UX: we auto-open the widget on mount so the user doesn't have to click
 * anything. While Rift's iframe is fetching, a branded loading screen sits
 * behind it (logo + spinner) so the page doesn't flash empty white. The
 * widget's full-page backdrop (configured in App.tsx) covers the loader
 * the moment the iframe paints.
 *
 * If the user closes the modal we surface fallback Sign-in / Create-account
 * buttons so they can re-open it.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useRift } from '@rift-finance/react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import logoPath from '@/assets/logo.png';

export default function Auth() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isOpen, open, error } = useRift();

  // Track whether the user has interacted with the widget at least once.
  // If they open and then close it, we stop auto-reopening and show the
  // fallback buttons. Without this we'd loop them straight back into the
  // sign-in flow even if they explicitly dismissed it.
  const [hasInteracted, setHasInteracted] = useState(false);
  const didAutoOpen = useRef(false);

  // Auto-open the widget once on mount. This kicks off the iframe fetch
  // immediately so the user lands on /auth and the modal appears as fast
  // as Rift can serve it — no extra click needed.
  useEffect(() => {
    if (isAuthenticated || didAutoOpen.current || hasInteracted) return;
    didAutoOpen.current = true;
    open({ mode: 'signin' });
  }, [isAuthenticated, hasInteracted, open]);

  // Once the widget has been open at least once and is now closed, treat
  // that as an explicit dismiss — flip to the fallback view.
  useEffect(() => {
    if (didAutoOpen.current && !isOpen) {
      // Tiny debounce so the initial isOpen=false → true transition doesn't
      // count as a "closed" state.
      const t = setTimeout(() => setHasInteracted(true), 200);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Redirect home the moment the widget signs the user in.
  useEffect(() => {
    if (isAuthenticated) setLocation('/home');
  }, [isAuthenticated, setLocation]);

  // Loading screen — shown while the widget is opening, during its initial
  // iframe load, and during the "signing you in" handoff. The widget covers
  // this whole screen once it's ready, so the user sees branding + spinner
  // until that moment instead of empty white.
  const showLoader = !hasInteracted && !error;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      {showLoader && (
        <div className="flex flex-col items-center gap-4 text-center">
          <img src={logoPath} alt="BlockFinaX" className="h-16 w-16 object-contain" />
          <div className="space-y-1">
            <h1 className="bfx-display text-[20px] font-semibold tracking-tight">BlockFinaX</h1>
            <p className="text-[12.5px] text-muted-foreground">Cross-border payments &amp; cover</p>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground mt-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            {isAuthenticated ? 'Signing you in…' : 'Loading sign-in…'}
          </div>
        </div>
      )}

      {/* Fallback when the user has explicitly closed the widget */}
      {!showLoader && !isAuthenticated && (
        <div className="flex flex-col items-center gap-3 text-center max-w-xs w-full">
          <img src={logoPath} alt="BlockFinaX" className="h-14 w-14 object-contain" />
          <div className="space-y-1">
            <h1 className="bfx-display text-[20px] font-semibold tracking-tight">BlockFinaX</h1>
            <p className="text-[12.5px] text-muted-foreground">Cross-border payments &amp; cover</p>
          </div>
          <div className="flex flex-col items-center gap-2 mt-3 w-full">
            <Button className="w-full h-11 rounded-xl" onClick={() => open({ mode: 'signin' })}>
              Sign in
            </Button>
            <Button variant="outline" className="w-full h-11 rounded-xl" onClick={() => open({ mode: 'signup' })}>
              Create account
            </Button>
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
