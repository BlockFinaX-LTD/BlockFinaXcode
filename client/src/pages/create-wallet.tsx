/**
 * create-wallet.tsx — Streamlined one-tap wallet creation
 *
 * Flow (post-auth):
 *   1. Generates wallet automatically using the user's PIN as the encryption key.
 *   2. Stores the seed phrase temporarily in sessionStorage so the home page can
 *      show a backup reminder popup.
 *   3. Redirects straight to /home — no multi-step wizard.
 *
 * For users with an existing wallet, an "Import wallet" link is provided.
 */

import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Wallet, ArrowRight, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWallet } from '@/hooks/use-wallet';
import { walletManager } from '@/lib/wallet';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';

export const BACKUP_MNEMONIC_KEY = 'bfx_pending_backup';
const PIN_SESSION_KEY = 'bfx_pin_session';

export default function CreateWallet() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { createWalletFromMnemonic } = useWallet();
  const createRef = useRef(createWalletFromMnemonic);
  createRef.current = createWalletFromMnemonic;

  const [status, setStatus] = useState<'idle' | 'creating' | 'done' | 'error'>('idle');
  const [referralCode] = useState(() => new URLSearchParams(window.location.search).get('ref'));

  const pin = sessionStorage.getItem(PIN_SESSION_KEY);

  const handleCreate = async () => {
    if (!pin) {
      toast({ title: 'Session expired', description: 'Please sign in again to create your wallet.', variant: 'destructive' });
      setLocation('/auth');
      return;
    }
    setStatus('creating');
    try {
      // Capture the mnemonic before it gets encrypted, so we can show a backup reminder
      const { mnemonic } = walletManager.generateWallet();
      sessionStorage.setItem(BACKUP_MNEMONIC_KEY, mnemonic);

      const newWallet = await createRef.current(pin, mnemonic, 'My Wallet');
      if (!newWallet) throw new Error('Wallet creation failed');

      // Apply referral bonus if the user came via a referral link
      if (referralCode && newWallet.address) {
        try {
          const res = await fetch(`/api/referrals/use/${referralCode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ referredWalletAddress: newWallet.address }),
          });
          if (res.ok) {
            const data = await res.json();
            toast({ title: 'Referral bonus applied!', description: `You earned ${data.pointsAwarded || 50} bonus points!` });
          }
        } catch {}
      }

      setStatus('done');
      setTimeout(() => setLocation('/home'), 800);
    } catch (err: any) {
      toast({ title: 'Failed to create wallet', description: err.message, variant: 'destructive' });
      setStatus('error');
    }
  };

  // Auto-start if PIN is available (coming straight from set-pin)
  useEffect(() => {
    if (pin && status === 'idle') handleCreate();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />

      <Card className="w-full max-w-sm relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardContent className="pt-10 pb-10 text-center space-y-6">
          <img src={logoPath} alt="BlockFinaX" className="h-10 w-10 object-contain mx-auto" />

          {(status === 'idle' || status === 'creating') && (
            <>
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                {status === 'creating'
                  ? <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  : <Wallet className="h-8 w-8 text-primary" />
                }
              </div>
              <div>
                <h1 className="text-xl font-bold">
                  {status === 'creating' ? 'Creating your wallet…' : 'Set up your wallet'}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {status === 'creating'
                    ? 'This only takes a second'
                    : 'Your secure blockchain wallet will be created and protected by your PIN'
                  }
                </p>
              </div>

              {status === 'idle' && (
                <>
                  <Button className="w-full h-12" onClick={handleCreate}>
                    <Wallet className="h-4 w-4 mr-2" />
                    Create my wallet
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full text-sm"
                    onClick={() => setLocation('/import-wallet')}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    I already have a wallet — import it
                  </Button>
                </>
              )}
            </>
          )}

          {status === 'done' && (
            <>
              <div className="h-16 w-16 rounded-full bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center mx-auto">
                <Wallet className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Wallet ready!</h1>
                <p className="text-sm text-muted-foreground mt-1">Taking you to your dashboard…</p>
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <p className="text-sm text-destructive">Something went wrong. Please try again.</p>
              <Button className="w-full" onClick={handleCreate}>Retry</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
