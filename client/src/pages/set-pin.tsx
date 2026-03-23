/**
 * set-pin.tsx — PIN setup + optional Face ID / passkey registration
 *
 * Flow:
 *   1. User enters a 6-digit PIN
 *   2. Confirms the PIN
 *   3. Optionally registers Face ID / fingerprint to unlock without PIN in future
 *   4. Navigates to /home (or /create-wallet if no wallet yet)
 *
 * The PIN is stored in the server-side wallet record as PBKDF2(PIN, salt).
 * If Face ID is registered, the PIN is also encrypted and stored in localStorage
 * so future Face ID unlocks are seamless.
 */

import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Fingerprint, ArrowRight, Check, Lock } from 'lucide-react';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';
import { isWebAuthnSupported, registerPasskey, getPasskeyLabel } from '@/lib/webauthn';
import { generateSalt, encryptPinForLocalStorage } from '@/lib/auth-crypto';
import { SESSION_KEY } from '@/hooks/use-auth';

type Step = 'enter' | 'confirm' | 'passkey' | 'done';

function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <div className="flex gap-3 justify-center my-6">
      {Array.from({ length }).map((_, i) => (
        <div
          key={i}
          className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
            i < filled ? 'bg-primary border-primary scale-110' : 'border-muted-foreground/40'
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
        key === '' ? (
          <div key={i} />
        ) : (
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

export default function SetPin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('enter');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [webauthnAvailable, setWebauthnAvailable] = useState(false);
  const [passkeyLabel, setPasskeyLabel] = useState('Face ID');
  const [pinSalt] = useState(() => generateSalt());

  useEffect(() => {
    setWebauthnAvailable(isWebAuthnSupported());
    getPasskeyLabel().then(setPasskeyLabel);
  }, []);

  const addDigit = (digit: string, target: 'pin' | 'confirm') => {
    if (target === 'pin') {
      if (pin.length >= 6) return;
      const next = pin + digit;
      setPin(next);
      if (next.length === 6) setTimeout(() => setStep('confirm'), 200);
    } else {
      if (confirmPin.length >= 6) return;
      const next = confirmPin + digit;
      setConfirmPin(next);
      if (next.length === 6) {
        setTimeout(() => handleConfirm(next), 200);
      }
    }
  };

  const deleteDigit = (target: 'pin' | 'confirm') => {
    if (target === 'pin') setPin(p => p.slice(0, -1));
    else setConfirmPin(p => p.slice(0, -1));
  };

  const handleConfirm = async (confirmedPin: string) => {
    if (confirmedPin !== pin) {
      toast({ title: "PINs don't match", description: 'Please try again.', variant: 'destructive' });
      setConfirmPin('');
      setPin('');
      setStep('enter');
      return;
    }
    // Save PIN salt to server
    setIsLoading(true);
    try {
      const token = localStorage.getItem(SESSION_KEY);
      await fetch('/api/auth/pin-salt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token || '' },
        body: JSON.stringify({ pinSalt }),
      });
      sessionStorage.setItem('bfx_pin_session', pin);
      if (webauthnAvailable) {
        setStep('passkey');
      } else {
        setStep('done');
      }
    } catch {
      toast({ title: 'Error saving PIN', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegisterPasskey = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem(SESSION_KEY);
      const challengeRes = await fetch('/api/auth/webauthn/register-challenge', {
        method: 'POST',
        headers: { 'x-session-token': token || '' },
      });
      const options = await challengeRes.json();
      const registration = await registerPasskey(options);
      const verifyRes = await fetch('/api/auth/webauthn/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token || '' },
        body: JSON.stringify({ response: registration }),
      });
      const data = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(data.message);
      // Encrypt the PIN and store it in localStorage, protected by the device unlock key
      await encryptPinForLocalStorage(pin, data.deviceUnlockKey);
      toast({ title: `${passkeyLabel} enabled!`, description: 'You can now unlock instantly with biometrics.' });
      setStep('done');
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setStep('done'); // User cancelled — that's fine, PIN still works
      } else {
        toast({ title: 'Passkey setup failed', description: err.message, variant: 'destructive' });
        setStep('done');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinish = () => {
    // New users won't have a wallet yet — send them to create one.
    // Returning users who re-authenticated go straight to the app.
    const hasWallet = !!localStorage.getItem('wallet_encrypted');
    setLocation(hasWallet ? '/home' : '/create-wallet');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />

      <Card className="w-full max-w-sm relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardContent className="pt-8 pb-8 space-y-4">

          <div className="text-center space-y-1">
            <img src={logoPath} alt="BlockFinaX" className="h-9 w-9 object-contain mx-auto mb-3" />

            {step === 'enter' && (
              <>
                <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center mx-auto">
                  <Lock className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <h1 className="text-xl font-bold mt-3">Set your PIN</h1>
                <p className="text-sm text-muted-foreground">Choose a 6-digit PIN to protect your wallet</p>
                <PinDots length={6} filled={pin.length} />
                <PinKeypad onDigit={d => addDigit(d, 'pin')} onDelete={() => deleteDigit('pin')} />
              </>
            )}

            {step === 'confirm' && (
              <>
                <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center mx-auto">
                  <Lock className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <h1 className="text-xl font-bold mt-3">Confirm your PIN</h1>
                <p className="text-sm text-muted-foreground">Enter your PIN again to confirm</p>
                <PinDots length={6} filled={confirmPin.length} />
                {isLoading
                  ? <div className="flex justify-center py-4"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                  : <PinKeypad onDigit={d => addDigit(d, 'confirm')} onDelete={() => deleteDigit('confirm')} />
                }
              </>
            )}

            {step === 'passkey' && (
              <div className="space-y-5 py-2">
                <div className="h-16 w-16 rounded-full bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center mx-auto">
                  <Fingerprint className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Enable {passkeyLabel}?</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Skip your PIN next time — just use your{' '}
                    {passkeyLabel.toLowerCase()} to unlock instantly.
                  </p>
                </div>
                <Button
                  className="w-full h-12"
                  onClick={handleRegisterPasskey}
                  disabled={isLoading}
                >
                  {isLoading
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Fingerprint className="h-4 w-4 mr-2" />
                  }
                  Enable {passkeyLabel}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setStep('done')}
                  disabled={isLoading}
                >
                  Maybe later
                </Button>
              </div>
            )}

            {step === 'done' && (
              <div className="space-y-5 py-2">
                <div className="h-16 w-16 rounded-full bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center mx-auto">
                  <Check className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">You're all set!</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your wallet is protected. Let's get started.
                  </p>
                </div>
                <Button className="w-full h-12" onClick={handleFinish}>
                  Go to wallet <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
