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
import { useWallet } from '@/hooks/use-wallet';
import { Loader2, Fingerprint, AlertTriangle, ShieldAlert } from 'lucide-react';
import logoPath from '@/assets/logo.png';
import { useToast } from '@/hooks/use-toast';
import { isWebAuthnSupported, authenticateWithPasskey, getPasskeyLabel } from '@/lib/webauthn';
import { decryptPinFromLocalStorage, hasLocalPin } from '@/lib/auth-crypto';
import { SESSION_KEY } from '@/hooks/use-auth';
import { pinStore } from '@/lib/pin-store';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const ATTEMPTS_KEY = 'wallet_pin_attempts';
const BG = '#F5EFE6';
const DARK = '#1a1a2e';

interface AttemptsRecord { count: number; resetAt: number; }

function loadAttempts(): AttemptsRecord {
  try { const raw = localStorage.getItem(ATTEMPTS_KEY); return raw ? JSON.parse(raw) : { count: 0, resetAt: 0 }; }
  catch { return { count: 0, resetAt: 0 }; }
}
function saveAttempts(rec: AttemptsRecord) { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(rec)); }
function clearAttempts() { localStorage.removeItem(ATTEMPTS_KEY); }
function formatCountdown(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function PinDots({ filled, error }: { filled: number; error: boolean }) {
  return (
    <div className="flex gap-4 justify-center my-8">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-3.5 w-3.5 rounded-full transition-all duration-150"
          style={{
            border: error ? `2px solid #ef4444` : `2px solid ${i < filled ? DARK : '#a0a0b0'}`,
            background: error ? '#ef4444' : i < filled ? DARK : 'transparent',
            transform: i < filled ? 'scale(1.15)' : 'scale(1)',
          }}
        />
      ))}
    </div>
  );
}

function PinKeypad({ onDigit, onDelete, disabled }: { onDigit: (d: string) => void; onDelete: () => void; disabled?: boolean }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div className="grid grid-cols-3 gap-3 max-w-[260px] mx-auto">
      {keys.map((key, i) =>
        key === '' ? <div key={`pad-empty-${i}`} /> : (
          <button
            key={`pad-${i}`}
            type="button"
            disabled={disabled}
            onClick={() => key === '⌫' ? onDelete() : onDigit(key)}
            className="h-16 w-full rounded-2xl text-xl font-semibold transition-all active:scale-95 disabled:opacity-40"
            style={{ background: '#ffffff', color: DARK, border: '1.5px solid #e0d8ce' }}
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

  useEffect(() => {
    if (!isLockedOut) return;
    const tick = () => {
      const remaining = attempts.resetAt - Date.now();
      if (remaining <= 0) { clearAttempts(); setAttempts({ count: 0, resetAt: 0 }); setCountdown(0); }
      else setCountdown(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isLockedOut, attempts.resetAt]);

  useEffect(() => {
    setWebauthnAvailable(isWebAuthnSupported());
    getPasskeyLabel().then(setPasskeyLabel);
    setHasStoredPin(hasLocalPin());
    const rec = loadAttempts();
    if (rec.count >= MAX_ATTEMPTS && Date.now() >= rec.resetAt) {
      clearAttempts(); setAttempts({ count: 0, resetAt: 0 });
    }
  }, []);

  const recordFailure = useCallback(() => {
    const now = Date.now();
    setAttempts(prev => {
      const isNew = prev.resetAt === 0 || now >= prev.resetAt;
      const count = isNew ? 1 : prev.count + 1;
      const resetAt = isNew ? now + LOCKOUT_MS : prev.resetAt;
      const rec = { count, resetAt };
      saveAttempts(rec);
      return rec;
    });
  }, []);

  const attemptUnlock = useCallback(async (candidate: string) => {
    setUnlocking(true);
    try {
      const wallet = await unlockWallet(candidate);
      if (wallet) {
        clearAttempts();
        setAttempts({ count: 0, resetAt: 0 });
        pinStore.clear();
        setLocation('/home');
      } else {
        setPinError(true);
        setPin('');
        recordFailure();
        setTimeout(() => setPinError(false), 600);
      }
    } finally {
      setUnlocking(false);
    }
  }, [unlockWallet, setLocation, recordFailure]);

  const addDigit = useCallback((d: string) => {
    if (isLockedOut || unlocking) return;
    setPin(prev => {
      const next = prev + d;
      if (next.length === 6) { setTimeout(() => attemptUnlock(next), 50); }
      return next.length <= 6 ? next : prev;
    });
  }, [isLockedOut, unlocking, attemptUnlock]);

  const deleteDigit = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
  }, []);

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
        if (storedPin) { await attemptUnlock(storedPin); return; }
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
    setLocation('/wallet');
  };

  return (
    <div className="min-h-screen flex flex-col items-center" style={{ backgroundColor: BG }}>

      {/* Logo */}
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm px-6 pt-16 pb-4">
        <img src={logoPath} alt="BlockFinaX" className="w-20 h-20 object-contain mb-5" style={{ mixBlendMode: 'multiply' }} />
        <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: DARK }}>
          {isLockedOut ? 'Wallet locked' : 'Welcome back'}
        </h1>
        <p className="mt-2 text-sm text-center" style={{ color: '#6b6b80' }}>
          {isLockedOut
            ? 'Too many incorrect attempts'
            : pinError
            ? 'Wrong PIN — try again'
            : 'Enter your 6-digit PIN to unlock'}
        </p>
      </div>

      {/* Main content area */}
      <div className="w-full max-w-sm px-6 pb-6 flex flex-col items-center">

        {isLockedOut ? (
          /* Lockout screen */
          <div className="w-full text-center space-y-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2"
              style={{ background: 'rgba(239,68,68,0.12)' }}>
              <ShieldAlert className="h-8 w-8 text-red-500" />
            </div>
            <div className="rounded-2xl p-5" style={{ background: '#ffffff', border: '1.5px solid #e0d8ce' }}>
              <p className="text-4xl font-mono font-bold tabular-nums" style={{ color: DARK }}>
                {formatCountdown(countdown)}
              </p>
              <p className="text-sm mt-1" style={{ color: '#6b6b80' }}>Try again in</p>
            </div>
            <p className="text-xs" style={{ color: '#6b6b80' }}>
              Forgot your PIN?{' '}
              <Link href="/import-wallet" className="underline font-medium" style={{ color: DARK }}>
                Re-import with seed phrase
              </Link>
            </p>
          </div>
        ) : (
          /* Normal unlock */
          <>
            {/* Face ID */}
            {webauthnAvailable && hasStoredPin && (
              <button
                onClick={handleFaceId}
                disabled={faceIdLoading || unlocking}
                className="w-full py-4 rounded-2xl text-base font-semibold mb-6 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                style={{ background: '#ffffff', color: DARK, border: '1.5px solid #e0d8ce' }}
              >
                {faceIdLoading
                  ? <Loader2 className="h-5 w-5 animate-spin" />
                  : <Fingerprint className="h-5 w-5" />
                }
                Unlock with {passkeyLabel}
              </button>
            )}

            {/* Attempts warning */}
            {attempts.count > 0 && (
              <p className="text-xs mb-2 font-medium text-amber-600">
                {attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} left before lockout
              </p>
            )}

            <PinDots filled={pin.length} error={pinError} />

            {unlocking
              ? <div className="py-8"><Loader2 className="h-10 w-10 animate-spin mx-auto" style={{ color: DARK }} /></div>
              : <PinKeypad onDigit={addDigit} onDelete={deleteDigit} disabled={isLockedOut} />
            }
          </>
        )}
      </div>

      {/* Footer links */}
      {!isLockedOut && (
        <div className="w-full max-w-sm px-6 pb-10 pt-4 space-y-3 text-center">
          <p className="text-xs" style={{ color: '#6b6b80' }}>
            New device?{' '}
            <Link href="/import-wallet" className="underline font-medium" style={{ color: DARK }}>
              Import wallet
            </Link>
            {' · '}
            <Link href="/auth" className="underline font-medium" style={{ color: DARK }}>
              Sign in
            </Link>
          </p>

          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-xs text-red-500 underline"
            >
              <AlertTriangle className="inline h-3 w-3 mr-1" />
              Remove wallet from this device
            </button>
          ) : (
            <div className="rounded-2xl p-4 space-y-3" style={{ background: '#fff', border: '1.5px solid #e0d8ce' }}>
              <p className="text-xs" style={{ color: '#6b6b80' }}>
                This only removes the wallet from this device. Your funds are safe if you have your seed phrase.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: '#fff', color: DARK, border: '1.5px solid #e0d8ce' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteWallet}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom accent */}
      <div className="w-full h-1.5 bg-gradient-to-r from-orange-400 via-red-500 to-orange-600" />
    </div>
  );
}
