/**
 * create-wallet.tsx — Streamlined one-tap wallet creation
 *
 * Flow (post-auth on a device with no local wallet):
 *   1. Checks server for existing wallets registered to this account.
 *      – If found: shows an "import your existing wallet" screen instead of
 *        creating a new one. Prevents duplicate wallets across devices.
 *      – If none: auto-creates a new wallet using the PIN from sessionStorage.
 *   2. On creation: stores seed phrase temporarily in sessionStorage so the
 *      home page can show a backup reminder popup.
 *   3. Redirects straight to /home.
 */

import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Wallet, ArrowRight, Download, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWallet } from '@/hooks/use-wallet';
import { walletManager } from '@/lib/wallet';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';
import { SESSION_KEY } from '@/hooks/use-auth';

export const BACKUP_MNEMONIC_KEY = 'bfx_pending_backup';
const PIN_SESSION_KEY = 'bfx_pin_session';

type CheckState = 'checking' | 'existing' | 'new' | 'creating' | 'done' | 'error';

export default function CreateWallet() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { createWalletFromMnemonic } = useWallet();
  const createRef = useRef(createWalletFromMnemonic);
  createRef.current = createWalletFromMnemonic;

  const [checkState, setCheckState] = useState<CheckState>('checking');
  const [existingAddresses, setExistingAddresses] = useState<string[]>([]);
  const [referralCode] = useState(() => new URLSearchParams(window.location.search).get('ref'));

  const pin = sessionStorage.getItem(PIN_SESSION_KEY);

  // Step 1: check if this user already has wallets on the server
  useEffect(() => {
    const token = localStorage.getItem(SESSION_KEY);
    if (!token) {
      setCheckState('new');
      return;
    }
    fetch('/api/auth/me/wallets', {
      headers: { 'x-session-token': token },
    })
      .then(r => r.json())
      .then(data => {
        const list: { address: string }[] = data.wallets || [];
        if (list.length > 0) {
          setExistingAddresses(list.map(w => w.address));
          setCheckState('existing');
        } else {
          setCheckState('new');
        }
      })
      .catch(() => setCheckState('new')); // on network error, fall through to create
  }, []);

  // Step 2: auto-create once we know there's no existing wallet
  const hasAutoCreated = useRef(false);
  useEffect(() => {
    if (checkState === 'new' && !hasAutoCreated.current) {
      hasAutoCreated.current = true;
      handleCreate();
    }
  }, [checkState]);

  const handleCreate = async () => {
    if (!pin) {
      toast({ title: 'Session expired', description: 'Please sign in again.', variant: 'destructive' });
      setLocation('/auth');
      return;
    }
    setCheckState('creating');
    try {
      const { mnemonic } = walletManager.generateWallet();
      sessionStorage.setItem(BACKUP_MNEMONIC_KEY, mnemonic);

      const newWallet = await createRef.current(pin, mnemonic, 'My Wallet');
      if (!newWallet) throw new Error('Wallet creation failed');

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

      setCheckState('done');
      setTimeout(() => setLocation('/home'), 800);
    } catch (err: any) {
      toast({ title: 'Failed to create wallet', description: err.message, variant: 'destructive' });
      setCheckState('error');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />

      <Card className="w-full max-w-sm relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardContent className="pt-10 pb-10 text-center space-y-6">
          <img src={logoPath} alt="BlockFinaX" className="h-10 w-10 object-contain mx-auto" />

          {/* Checking server for existing wallets */}
          {checkState === 'checking' && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
              <p className="text-sm text-muted-foreground">Checking your account…</p>
            </>
          )}

          {/* User already has a wallet — prompt to import */}
          {checkState === 'existing' && (
            <>
              <div className="h-16 w-16 rounded-full bg-amber-50 dark:bg-amber-950 flex items-center justify-center mx-auto">
                <AlertTriangle className="h-8 w-8 text-amber-500" />
              </div>
              <div>
                <h1 className="text-xl font-bold">You already have a wallet</h1>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Your account already has{' '}
                  {existingAddresses.length === 1 ? 'a wallet' : `${existingAddresses.length} wallets`}{' '}
                  registered. To use the same wallet on this device, import it using your seed phrase.
                </p>
              </div>

              <div className="rounded-lg bg-muted/60 p-3 text-left space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Existing wallet address:</p>
                {existingAddresses.map(addr => (
                  <p key={addr} className="text-xs font-mono break-all text-foreground">
                    {addr}
                  </p>
                ))}
              </div>

              <div className="space-y-2">
                <Button className="w-full h-12" onClick={() => setLocation('/import-wallet')}>
                  <Download className="h-4 w-4 mr-2" />
                  Import my existing wallet
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
                <p className="text-xs text-muted-foreground">
                  You'll need the 12-word seed phrase from your original device.
                </p>
              </div>
            </>
          )}

          {/* Auto-creating new wallet */}
          {(checkState === 'new' || checkState === 'creating') && (
            <>
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Creating your wallet…</h1>
                <p className="text-sm text-muted-foreground mt-1">This only takes a second</p>
              </div>
            </>
          )}

          {/* Done */}
          {checkState === 'done' && (
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

          {/* Error */}
          {checkState === 'error' && (
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
