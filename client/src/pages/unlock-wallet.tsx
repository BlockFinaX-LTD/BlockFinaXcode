/**
 * unlock-wallet.tsx — Unlock existing wallet with PIN or Face ID
 *
 * Shows a PIN keypad matching the set-pin experience.
 * Face ID / fingerprint decrypts the stored PIN automatically and unlocks
 * without the user having to type anything.
 */

import { useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useWallet } from '@/hooks/use-wallet';
import { Loader2, Fingerprint, Lock, AlertTriangle } from 'lucide-react';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';
import { useToast } from '@/hooks/use-toast';
import { isWebAuthnSupported, authenticateWithPasskey, getPasskeyLabel } from '@/lib/webauthn';
import { decryptPinFromLocalStorage, hasLocalPin } from '@/lib/auth-crypto';
import { SESSION_KEY } from '@/hooks/use-auth';

function PinDots({ filled, error }: { filled: number; error: boolean }) {
  return (
    <div className="flex gap-3 justify-center my-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
            error
              ? 'bg-destructive border-destructive'
              : i < filled
              ? 'bg-primary border-primary scale-110'
              : 'border-muted-foreground/40'
          }`}
        />
      ))}
    </div>
  );
}

function PinKeypad({ onDigit, onDelete }: { onDigit: (d: string) => void; onDelete: () => void }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div className="grid grid-cols-3 gap-3 max-w-[240px] mx-auto">
      {keys.map((key, i) =>
        key === '' ? <div key={i} /> : (
          <button
            key={key}
            type="button"
            className="h-14 w-full rounded-xl text-xl font-semibold bg-muted hover:bg-muted/80 active:scale-95 transition-all duration-100 flex items-center justify-center"
            onClick={() => (key === '⌫' ? onDelete() : onDigit(key))}
          >
            {key}
          </button>
        )
      )}
    </div>
  );
}

export default function UnlockWallet() {
  const [, setLocation] = useLocation();
  const { unlockWallet, isLoading, deleteWallet } = useWallet();
  const { toast } = useToast();

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [faceIdLoading, setFaceIdLoading] = useState(false);
  const [webauthnAvailable, setWebauthnAvailable] = useState(false);
  const [passkeyLabel, setPasskeyLabel] = useState('Face ID');
  const [hasStoredPin, setHasStoredPin] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    setWebauthnAvailable(isWebAuthnSupported());
    getPasskeyLabel().then(setPasskeyLabel);
    setHasStoredPin(hasLocalPin());
  }, []);

  const attemptUnlock = async (password: string) => {
    try {
      const wallet = await unlockWallet(password);
      if (wallet) {
        sessionStorage.setItem('bfx_pin_session', password);
        window.location.replace('/home');
      } else {
        setPinError(true);
        setPin('');
        setTimeout(() => setPinError(false), 1000);
      }
    } catch {
      setPinError(true);
      setPin('');
      setTimeout(() => setPinError(false), 1000);
    }
  };

  const addDigit = (digit: string) => {
    if (pin.length >= 6) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 6) setTimeout(() => attemptUnlock(next), 200);
  };

  const deleteDigit = () => setPin(p => p.slice(0, -1));

  const handleFaceId = async () => {
    setFaceIdLoading(true);
    try {
      const challengeRes = await fetch('/api/auth/webauthn/auth-challenge', { method: 'POST' });
      const options = await challengeRes.json();
      const authResponse = await authenticateWithPasskey(options);
      const res = await fetch('/api/auth/webauthn/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: authResponse }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      localStorage.setItem(SESSION_KEY, data.sessionToken);
      if (data.deviceUnlockKey && hasLocalPin()) {
        const storedPin = await decryptPinFromLocalStorage(data.deviceUnlockKey);
        if (storedPin) {
          await attemptUnlock(storedPin);
          return;
        }
      }
      // Face ID worked but no PIN cached — ask for PIN
      toast({ title: `${passkeyLabel} verified`, description: 'Please enter your PIN to unlock.' });
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        toast({ title: `${passkeyLabel} failed`, description: err.message, variant: 'destructive' });
      }
    } finally {
      setFaceIdLoading(false);
    }
  };

  const handleDeleteWallet = () => {
    deleteWallet();
    setLocation('/auth');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />

      <Card className="w-full max-w-sm relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardContent className="pt-8 pb-8 space-y-4">
          <div className="text-center space-y-1">
            <img src={logoPath} alt="BlockFinaX" className="h-9 w-9 object-contain mx-auto mb-3" />

            {/* Face ID quick unlock */}
            {webauthnAvailable && hasStoredPin && (
              <div className="pb-2">
                <Button
                  variant="outline"
                  className="w-full h-12 font-medium"
                  onClick={handleFaceId}
                  disabled={faceIdLoading || isLoading}
                >
                  {faceIdLoading
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Fingerprint className="h-4 w-4 mr-2 text-primary" />
                  }
                  Unlock with {passkeyLabel}
                </Button>
                <p className="text-xs text-muted-foreground mt-3">or enter your PIN</p>
              </div>
            )}

            {/* PIN keypad */}
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Lock className={`h-5 w-5 ${pinError ? 'text-destructive' : 'text-primary'}`} />
            </div>
            <h1 className="text-xl font-bold">
              {pinError ? 'Wrong PIN, try again' : 'Enter your PIN'}
            </h1>
            <p className="text-sm text-muted-foreground">Your 6-digit PIN to unlock your wallet</p>

            <PinDots filled={pin.length} error={pinError} />

            {isLoading
              ? <div className="flex justify-center py-4"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
              : <PinKeypad onDigit={addDigit} onDelete={deleteDigit} />
            }
          </div>

          {/* Footer links */}
          <div className="pt-4 space-y-3 border-t border-border">
            <p className="text-xs text-center text-muted-foreground">
              New device?{' '}
              <Link href="/import-wallet" className="text-primary hover:underline">Import with seed phrase</Link>
              {' · '}
              <Link href="/auth" className="text-primary hover:underline">Sign in</Link>
            </p>

            {!showDeleteConfirm ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                Remove wallet from this device
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-center text-muted-foreground">
                  This removes the wallet from this device only. Your funds are safe if you have your seed phrase.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)} className="flex-1">Cancel</Button>
                  <Button variant="destructive" size="sm" onClick={handleDeleteWallet} className="flex-1">Remove</Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
