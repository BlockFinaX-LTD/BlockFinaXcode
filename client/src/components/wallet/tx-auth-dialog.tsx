/**
 * tx-auth-dialog.tsx — Singleton auth dialog for on-chain transactions
 *
 * Mounted once at the app root. Listens for tx auth requests via
 * subscribeTxAuth and resolves the pending promise once the user enters
 * their credentials (OTP or password depending on login method).
 */

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { subscribeTxAuth, type Pending } from '@/lib/tx-auth';
import { getAuthMethod, sendOtp } from '@/lib/rift-client';

export function TxAuthDialog() {
  const { toast } = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [password, setPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  // Suppress rendering entirely while we probe device signing on first
  // open. Otherwise the OTP <Input placeholder="Code will arrive shortly…"/>
  // paints for ~150ms before the probe resolves and we auto-cancel — the
  // "OTP flashes then goes to Approve popup" bug the user reported.
  // null = probing; true = suppress this dialog entirely; false = show it.
  const [suppressed, setSuppressed] = useState<boolean | null>(null);

  const authMethod = getAuthMethod();

  // Subscribe to tx-auth requests
  useEffect(() => {
    return subscribeTxAuth(setPending);
  }, []);

  // When a request lands, first probe whether this wallet uses device
  // signing. If yes, self-cancel — hedge-contract.ts's fallback to
  // requestTxAuth is only meant for pre-v3 wallets; the check is fresh
  // here so any race that opens TxAuthDialog for a v3 wallet is
  // corrected before any UI paints.
  useEffect(() => {
    if (!pending) {
      // reset on close
      setOtpCode('');
      setPassword('');
      setOtpSent(false);
      setSuppressed(null);
      return;
    }
    let cancelled = false;
    setSuppressed(null); // probing
    void (async () => {
      let onDevice = false;
      try {
        const { walletUsesDeviceSigning } = await import('@/lib/v3-sign');
        onDevice = await walletUsesDeviceSigning();
      } catch {
        onDevice = false;
      }
      if (cancelled) return;
      if (onDevice) {
        // Device signing is active for this wallet. TxAuthDialog would
        // ask for a code that will never be checked because the actual
        // signature comes from a passkey / Google id_token, not an OTP.
        // Reject the pending request so the caller can retry via the
        // v3 path. hedge-contract.ts treats a cancel like any other
        // failure and surfaces the error to the user.
        setSuppressed(true);
        pending.reject(new Error('Wallet uses device signing — retry via passkey / Google.'));
        return;
      }
      setSuppressed(false);
      if (authMethod && authMethod.kind !== 'password' && !otpSent) {
        void handleSendOtp();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const handleSendOtp = async () => {
    if (!authMethod || authMethod.kind === 'password') return;
    setIsSendingOtp(true);
    try {
      if (authMethod.kind === 'email') await sendOtp({ email: authMethod.email });
      else if (authMethod.kind === 'phone') await sendOtp({ phone: authMethod.phoneNumber });
      setOtpSent(true);
      toast({
        title: 'Code sent',
        description:
          authMethod?.kind === 'phone'
            ? 'Check your phone for the code to authorize the transaction.'
            : 'Check your inbox to authorize the transaction. It may land in spam.',
      });
    } catch (err: any) {
      toast({ title: 'Failed to send code', description: err?.message, variant: 'destructive' });
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleSubmit = () => {
    if (!pending || !authMethod) return;
    try {
      if (authMethod.kind === 'password') {
        if (!password) throw new Error('Password required');
        pending.resolve({ externalId: authMethod.externalId, password });
      } else if (authMethod.kind === 'email') {
        if (!otpCode) throw new Error('Code required');
        pending.resolve({ email: authMethod.email, otpCode });
      } else {
        if (!otpCode) throw new Error('Code required');
        pending.resolve({ phoneNumber: authMethod.phoneNumber, otpCode });
      }
    } catch (err: any) {
      toast({ title: 'Missing credential', description: err.message, variant: 'destructive' });
    }
  };

  const handleCancel = () => {
    pending?.reject(new Error('User cancelled authorization'));
  };

  // Only paint the dialog once the device-signing probe resolves AND
  // says this wallet does NOT use device signing. While probing
  // (suppressed === null) or when suppressed (=== true), nothing renders
  // — no OTP flash before the caller re-tries via v3.
  const open = !!pending && suppressed === false;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            {pending?.title || 'Authorize transaction'}
          </DialogTitle>
          {pending?.description && <DialogDescription>{pending.description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!authMethod && (
            <p className="text-sm text-red-500">Not signed in. Please log in again.</p>
          )}

          {authMethod?.kind === 'password' && (
            <div>
              <Label className="text-xs">Password (for {authMethod.externalId})</Label>
              <Input
                type="password" autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              />
            </div>
          )}

          {authMethod?.kind === 'email' && (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Email code (sent to {authMethod.email})</Label>
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={handleSendOtp} disabled={isSendingOtp}>
                  {isSendingOtp ? 'Sending…' : 'Send code'}
                </Button>
              </div>
              <Input
                type="text" inputMode="text" autoCapitalize="characters" maxLength={6}
                placeholder={otpSent ? 'ABCD' : 'Code will arrive shortly…'}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                className="font-mono text-center tracking-[0.4em]"
                autoFocus
              />
              {/* Whose email to look for.
                  The code is generated, sent and verified by Rift — POST /otp/send
                  takes an address and nothing else, so there is no sender or
                  branding field for us to set. Saying so is the part we control:
                  without it, someone waits for a BlockFinaX email that is never
                  coming, and eventually finds "Rift" in spam and distrusts it. */}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The code comes from <strong>riftfi.com</strong>, our wallet provider —
                not from BlockFinaX. Check your spam folder if it hasn't arrived within a minute.
              </p>
            </>
          )}

          {authMethod?.kind === 'phone' && (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-xs">SMS code (sent to {authMethod.phoneNumber})</Label>
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={handleSendOtp} disabled={isSendingOtp}>
                  {isSendingOtp ? 'Sending…' : 'Send code'}
                </Button>
              </div>
              <Input
                type="text" inputMode="text" autoCapitalize="characters" maxLength={6}
                placeholder={otpSent ? 'ABCD' : 'Code will arrive shortly…'}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                className="font-mono text-center tracking-[0.4em]"
                autoFocus
              />
            </>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={handleCancel}>Cancel</Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={!authMethod || (authMethod.kind === 'password' ? !password : otpCode.length < 4)}
            >
              Authorize
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground text-center">
            Your credential will be cached for 5 minutes so chained transactions (e.g. approve + execute) don't re-prompt.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
