/**
 * unlock-wallet.tsx — Unlock existing wallet with 6-digit PIN or Face ID
 *
 * Brute-force protection:
 *   - 5 wrong PIN attempts triggers a 15-minute lockout
 *   - Attempt count + reset timestamp persisted in localStorage
 *   - Countdown timer shown during lockout
 *   - On success, attempt counter is cleared
 */

import { useState, useEffect, useCallback } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useWallet } from '@/hooks/use-wallet';
import { Loader2, Fingerprint, Lock, AlertTriangle, ShieldAlert } from 'lucide-react';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';
import { useToast } from '@/hooks/use-toast';
import { isWebAuthnSupported, authenticateWithPasskey, getPasskeyLabel } from '@/lib/webauthn';
import { decryptPinFromLocalStorage, hasLocalPin } from '@/lib/auth-crypto';
import { SESSION_KEY } from '@/hooks/use-auth';
import { pinStore } from '@/lib/pin-store';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPTS_KEY = 'wallet_pin_attempts';

interface AttemptsRecord {
  count: number;
  resetAt: number;
}

function loadAttempts(): AttemptsRecord {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return { count: 0, resetAt: 0 };
    return JSON.parse(raw);
  } catch {
    return { count: 0, resetAt: 0 };
  }
}

function saveAttempts(rec: AttemptsRecord): void {
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(rec));
}

function clearAttempts(): void {
  localStorage.removeItem(ATTEMPTS_KEY);
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

function PinKeypad({ onDigit, onDelete, disabled }: { onDigit: (d: string) => void; onDelete: () => void; disabled?: boolean }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div className="grid grid-cols-3 gap-3 max-w-[240px] mx-auto">
      {keys.map((key, i) =>
        key === '' ? <div key={`pad-empty-${i}`} /> : (
          <button
            key={`pad-${i}`}
            type="button"
            disabled={disabled}
            className="h-14 w-full rounded-xl text-xl font-semibold bg-muted hover:bg-muted/80 active:scale-95 transition-all duration-100 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
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
  const { unlockWallet, deleteWallet } = useWallet();
  const { toast } = useToast();

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [faceIdLoading, setFaceIdLoading] = useState(false);
  const [webauthnAvailable, setWebauthnAvailable] = useState(false);
  const [passkeyLabel, setPasskeyLabel] = useState('Face ID');
  const [hasStoredPin, setHasStoredPin] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [attempts, setAttempts] = useState<AttemptsRecord>(() => loadAttempts());
  const [countdown, setCountdown] = useState(0);

  const isLockedOut = attempts.count >= MAX_ATTEMPTS && Date.now() < attempts.resetAt;
  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attempts.count);

  // Countdown timer during lockout
  useEffect(() => {
    if (!isLockedOut) return;
    const tick = () => {
      const remaining = attempts.resetAt - Date.now();
      if (remaining <= 0) {
        clearAttempts();
        setAttempts({ count: 0, resetAt: 0 });
        setCountdown(0);
      } else {
        setCountdown(remaining);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isLockedOut, attempts.resetAt]);

  useEffect(() => {
    setWebauthnAvailable(isWebAuthnSupported());
    getPasskeyLabel().then(setPasskeyLabel);
    setHasStoredPin(hasLocalPin());
    // If previous lockout has expired, clear it
    const rec = loadAttempts();
    if (rec.count >= MAX_ATTEMPTS && Date.now() >= rec.resetAt) {
      clearAttempts();
      setAttempts({ count: 0, resetAt: 0 });
    }
  }, []);

  const recordFailure = useCallback(() => {
    const now = Date.now();
    setAttempts(prev => {
      const isNew = prev.resetAt === 0 || now >= prev.resetAt;
      const count = isNew ? 1 : prev.count + 1;
      const resetAt = isNew ? now + LOCKOUT_MS : prev.resetAt;
      const next = { count, resetAt };
      saveAttempts(next);
      return next;
    });
  }, []);

  const attemptUnlock = useCallback(async (password: string) => {
    if (isLockedOut) return;
    setUnlocking(true);
    try {
      const wallet = await unlockWallet(password);
      if (wallet) {
        clearAttempts();
        pinStore.set(password);
        window.location.replace('/home');
        return;
      }
      recordFailure();
      setPinError(true);
      setPin('');
      setTimeout(() => setPinError(false), 1000);
    } catch {
      recordFailure();
      setPinError(true);
      setPin('');
      setTimeout(() => setPinError(false), 1000);
    } finally {
      setUnlocking(false);
    }
  }, [isLockedOut, unlockWallet, recordFailure]);

  const addDigit = (digit: string) => {
    if (pin.length >= 6 || isLockedOut) return;
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

            {/* ── Locked out state ── */}
            {isLockedOut ? (
              <div className="space-y-4 py-4">
                <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
                  <ShieldAlert className="h-7 w-7 text-destructive" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-destructive">Too many attempts</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    For your security, wallet is temporarily locked.
                  </p>
                </div>
                <div className="rounded-xl bg-muted p-4">
                  <p className="text-3xl font-mono font-bold tabular-nums text-foreground">
                    {formatCountdown(countdown)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Try again in</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Forgot your PIN?{' '}
                  <Link href="/import-wallet" className="text-primary hover:underline">
                    Re-import with seed phrase
                  </Link>
                </p>
              </div>
            ) : (
              <>
                {/* Face ID quick unlock */}
                {webauthnAvailable && hasStoredPin && (
                  <div className="pb-2">
                    <Button
                      variant="outline"
                      className="w-full h-12 font-medium"
                      onClick={handleFaceId}
                      disabled={faceIdLoading || unlocking}
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

                {/* Attempts warning */}
                {attempts.count > 0 && attempts.count < MAX_ATTEMPTS && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    {attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining before lockout
                  </p>
                )}

                <PinDots filled={pin.length} error={pinError} />

                {unlocking
                  ? <div className="flex justify-center py-6"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                  : <PinKeypad onDigit={addDigit} onDelete={deleteDigit} disabled={isLockedOut} />
                }
              </>
            )}
          </div>

          {/* Footer links */}
          {!isLockedOut && (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
