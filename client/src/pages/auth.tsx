/**
 * auth.tsx — Sign in / sign up via the Rift hosted widget
 *
 * Auth is fully delegated to @rift-finance/react. The widget handles email
 * OTP, phone OTP, Google, and Apple flows; a Rift smart wallet is
 * auto-provisioned on first sign-in. We just open the modal and redirect
 * once isAuthenticated flips true.
 *
 * Page renders a minimal fallback (just the logo) — the widget owns the UI.
 * If the user closes the modal, we surface a "Reopen sign-in" button.
 */

import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useRift } from '@rift-finance/react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import logoPath from '@/assets/logo.png';

export default function Auth() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isOpen, open, error } = useRift();

  // Redirect home the moment the widget signs the user in.
  useEffect(() => {
    if (isAuthenticated) setLocation('/home');
  }, [isAuthenticated, setLocation]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="flex flex-col items-center gap-3 text-center max-w-xs">
        <img src={logoPath} alt="BlockFinaX" className="h-14 w-14 object-contain" />
        <h1 className="text-base font-semibold tracking-tight">BlockFinaX</h1>

        {isAuthenticated ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Signing you in…
          </div>
        ) : isOpen ? null : (
          <div className="flex flex-col items-center gap-2 mt-4 w-full">
            <Button className="w-full" onClick={() => open({ mode: 'signin' })}>
              Sign in
            </Button>
            <Button variant="outline" className="w-full" onClick={() => open({ mode: 'signup' })}>
              Create account
            </Button>
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
