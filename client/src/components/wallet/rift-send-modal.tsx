/**
 * rift-send-modal.tsx — Send crypto via Rift SDK
 *
 * Three-step modal: Form → Authorize → Done.
 * Uses rift.transactions.send() — gasless transfers, paid in USDC.
 * Auth credential is collected at the authorize step (re-auth per tx).
 */

import { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, ArrowRight, CheckCircle, Loader2, Send, ExternalLink } from 'lucide-react';
import {
  sendCrypto, sendOtp, getAuthMethod, getChainBalances,
  type ChainName, type TokenSymbol,
} from '@/lib/rift-client';
import { useRiftBalances } from '@/hooks/use-rift-balances';

type Step = 'form' | 'authorize' | 'done';

interface RiftSendModalProps {
  open: boolean;
  onClose: () => void;
}

const CHAIN_LABELS: Record<string, string> = {
  BASE: 'Base', POLYGON: 'Polygon', ARBITRUM: 'Arbitrum', ETHEREUM: 'Ethereum',
  LISK: 'Lisk', BNB: 'BNB Chain', BSC: 'BNB Chain', OPTIMISM: 'Optimism', CELO: 'Celo',
  AVAX: 'Avalanche', BERACHAIN: 'Berachain',
};

// The SDK's getChainBalance returns numeric chain IDs as the `chain` field, but
// rift.transactions.send() requires the enum name. Map one to the other.
const CHAIN_ID_TO_NAME: Record<string, ChainName> = {
  '1':     'ETHEREUM',
  '10':    'OPTIMISM',
  '56':    'BNB',
  '137':   'POLYGON',
  '1135':  'LISK',
  '8453':  'BASE',
  '42161': 'ARBITRUM',
  '42220': 'CELO',
  '43114': 'AVAX',
};

function normalizeChain(raw: string | number | undefined): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  // If it's numeric, map via CHAIN_ID_TO_NAME. Otherwise upper-case it.
  if (/^\d+$/.test(s)) return CHAIN_ID_TO_NAME[s] || s;
  return s.toUpperCase();
}

export function RiftSendModal({ open, onClose }: RiftSendModalProps) {
  const { toast } = useToast();
  const { balances, refreshAll, isLoading: isLoadingBalances } = useRiftBalances();

  const [step, setStep] = useState<Step>('form');
  const [chain, setChain] = useState<ChainName>('BASE');
  const [token, setToken] = useState<TokenSymbol>('USDC');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');

  // Auth fields (one of these is filled depending on user's auth method)
  const [otpCode, setOtpCode] = useState('');
  const [password, setPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);

  const [isSending, setIsSending] = useState(false);
  const [resultHash, setResultHash] = useState<string | null>(null);

  const authMethod = getAuthMethod();

  // Reset everything when modal closes; refresh balances when modal opens
  useEffect(() => {
    if (!open) {
      setStep('form');
      setChain('BASE');
      setToken('USDC');
      setTo('');
      setAmount('');
      setOtpCode('');
      setPassword('');
      setOtpSent(false);
      setResultHash(null);
    } else {
      // Always pull fresh balances when the modal opens
      refreshAll();
    }
  }, [open, refreshAll]);

  // Only stablecoins can be sent — no ETH / MATIC / native tokens
  const SENDABLE_TOKENS = new Set(['USDC', 'USDT']);

  // ── Owned balances only (amount > 0) AND sendable (USDC/USDT) ──────
  const owned = balances.filter(b =>
    Number(b.amount) > 0 &&
    SENDABLE_TOKENS.has(String(b.token || '').toUpperCase())
  );

  // Unique chains the user actually holds tokens on. The SDK returns chain
  // IDs (e.g. "8453") as the `chain` field, so we normalize to the enum name
  // before keying. The display name prefers SDK's `chainName` when present.
  const chainDisplayNames = new Map<string, string>();
  for (const b of owned) {
    const key = normalizeChain(b.chain);
    if (!key) continue;
    const rawLabel = (b as any).chainName?.toString().trim() || CHAIN_LABELS[key] || key;
    const pretty = /[a-z]/.test(rawLabel) ? rawLabel : rawLabel.charAt(0) + rawLabel.slice(1).toLowerCase();
    if (!chainDisplayNames.has(key)) chainDisplayNames.set(key, pretty);
  }
  const availableChains = Array.from(chainDisplayNames.keys());

  // Unique tokens for the selected chain
  const tokensForChain = owned
    .filter(b => normalizeChain(b.chain) === normalizeChain(chain))
    .map(b => String(b.token || '').toUpperCase());
  const availableTokens = Array.from(new Set(tokensForChain));

  // Matched balance for selected (chain, token)
  const matched = owned.find(b =>
    normalizeChain(b.chain) === normalizeChain(chain) &&
    String(b.token || '').toUpperCase() === String(token).toUpperCase()
  );
  const available = Number(matched?.amount || 0);

  // Debug: log once so we can see exactly what the SDK returns
  useEffect(() => {
    if (balances.length > 0) {
      console.log('[RiftSendModal] balances sample:', balances.slice(0, 3));
    }
  }, [balances.length]);

  // ONE-SHOT auto-pick when the modal opens: if the user has balance anywhere,
  // preselect that chain+token. After that, the user is in full control.
  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (!open) { autoPickedRef.current = false; return; }
    if (autoPickedRef.current) return;
    if (balances.length === 0) return;
    const first = balances.find(b => Number(b.amount) > 0);
    if (first) {
      setChain(normalizeChain(first.chain) as ChainName);
      setToken(String(first.token).toUpperCase() as TokenSymbol);
    }
    autoPickedRef.current = true;
  }, [open, balances]);

  // When the user changes the chain and the current token isn't available there,
  // auto-pick the first token that IS available on the new chain.
  useEffect(() => {
    if (availableTokens.length === 0) return;
    if (!availableTokens.includes(String(token).toUpperCase())) {
      setToken(availableTokens[0] as TokenSymbol);
    }
  }, [chain, availableTokens.join(',')]);

  const isValid = (): boolean => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return false;
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) return false;
    if (num > available) return false;
    return true;
  };

  // ── Step 1 → Step 2: validate then move to authorization ────────────
  const handleContinue = () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      toast({ title: 'Invalid address', description: 'Recipient must be a 0x… address', variant: 'destructive' });
      return;
    }
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      toast({ title: 'Invalid amount', variant: 'destructive' });
      return;
    }
    if (num > available) {
      toast({ title: 'Insufficient balance', description: `You have ${available} ${token} on ${chain}`, variant: 'destructive' });
      return;
    }
    setStep('authorize');

    // If the user logged in via OTP, send a fresh code automatically so they
    // don't have to click "Send code". Password users still get a form.
    if (authMethod && authMethod.kind !== 'password' && !otpSent) {
      handleSendOtp();
    }
  };

  // ── Send a fresh OTP for transaction authorization ─────────────────
  const handleSendOtp = async () => {
    if (!authMethod || authMethod.kind === 'password') return;
    setIsSendingOtp(true);
    try {
      if (authMethod.kind === 'email') await sendOtp({ email: authMethod.email });
      else if (authMethod.kind === 'phone') await sendOtp({ phone: authMethod.phoneNumber });
      setOtpSent(true);
      toast({ title: 'Code sent', description: 'Check your inbox to authorize the transfer.' });
    } catch (err: any) {
      toast({ title: 'Failed to send code', description: err?.message, variant: 'destructive' });
    } finally {
      setIsSendingOtp(false);
    }
  };

  // ── Submit transaction ─────────────────────────────────────────────
  const handleSend = async () => {
    if (!authMethod) {
      toast({ title: 'Not signed in', variant: 'destructive' });
      return;
    }

    setIsSending(true);
    try {
      let credentials: any;
      if (authMethod.kind === 'password') {
        if (!password) throw new Error('Password is required');
        credentials = { externalId: authMethod.externalId, password };
      } else if (authMethod.kind === 'email') {
        if (!otpCode) throw new Error('OTP code is required');
        credentials = { email: authMethod.email, otpCode };
      } else {
        if (!otpCode) throw new Error('OTP code is required');
        credentials = { phoneNumber: authMethod.phoneNumber, otpCode };
      }

      const res = await sendCrypto({
        to,
        value: amount,
        token,
        // The SDK expects the enum name ("BASE", "POLYGON", etc.) not the chain ID.
        chain: normalizeChain(chain) as ChainName,
        type: 'gasless',
        ...credentials,
      });

      setResultHash(res?.transactionHash || null);
      setStep('done');
      refreshAll();
    } catch (err: any) {
      toast({
        title: 'Transfer failed',
        description: err?.message || 'Please verify your credentials and try again',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Send crypto
          </DialogTitle>
          {step === 'form' && (
            <DialogDescription>Gasless transfer powered by Rift Finance</DialogDescription>
          )}
          {step === 'authorize' && (
            <DialogDescription>Authorize this transfer with your credentials</DialogDescription>
          )}
        </DialogHeader>

        {/* ── STEP 1: FORM ── */}
        {step === 'form' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Chain</Label>
                <Select value={chain} onValueChange={(v) => setChain(v as ChainName)} disabled={availableChains.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder={isLoadingBalances ? 'Loading…' : 'Pick a chain'} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableChains.map(c => (
                      <SelectItem key={c} value={c}>
                        {chainDisplayNames.get(c) || c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Token</Label>
                <Select value={token} onValueChange={(v) => setToken(v as TokenSymbol)} disabled={availableTokens.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder={availableTokens.length === 0 ? '—' : 'Pick a token'} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTokens.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* No holdings hint */}
            {!isLoadingBalances && owned.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No tokens to send yet. Fund your wallet to get started.
              </p>
            )}

            <div>
              <Label className="text-xs">Recipient address</Label>
              <Input
                placeholder="0x…"
                value={to}
                onChange={(e) => setTo(e.target.value.trim())}
                className="font-mono text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">Amount</Label>
                <button
                  type="button"
                  onClick={() => setAmount(String(available))}
                  className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  disabled={isLoadingBalances}
                >
                  {isLoadingBalances && balances.length === 0 ? (
                    <><Loader2 className="h-3 w-3 animate-spin" /> Loading…</>
                  ) : (
                    <>Available: {available.toLocaleString(undefined, { maximumFractionDigits: 6 })} {token}</>
                  )}
                </button>
              </div>
              <Input
                type="number" inputMode="decimal" min="0" step="any"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1" onClick={handleContinue} disabled={!isValid()}>
                Continue <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 2: AUTHORIZE ── */}
        {step === 'authorize' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 px-3 py-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">To</span><span className="font-mono">{to.slice(0, 10)}…{to.slice(-6)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-semibold">{amount} {token}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Chain</span><span>{chainDisplayNames.get(normalizeChain(chain)) || chain}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Gas</span><span className="text-green-600">Sponsored</span></div>
            </div>

            {!authMethod && (
              <p className="text-sm text-red-500">Auth method unknown — please sign in again.</p>
            )}

            {authMethod?.kind === 'password' && (
              <div>
                <Label className="text-xs">Password (for {authMethod.externalId})</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </div>
            )}

            {authMethod?.kind === 'email' && (
              <>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Email code (sent to {authMethod.email})</Label>
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={handleSendOtp} disabled={isSendingOtp}>
                    {isSendingOtp ? 'Sending…' : (otpSent ? 'Resend' : 'Send code')}
                  </Button>
                </div>
                <Input
                  type="text" inputMode="text" autoCapitalize="characters" maxLength={6}
                  placeholder={otpSent ? 'ABCD' : 'Code will arrive shortly…'}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6))}
                  className="font-mono text-center tracking-[0.4em]"
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  We sent a new code to <strong>{authMethod.email}</strong>. Enter it to authorize this transfer.
                </p>
              </>
            )}

            {authMethod?.kind === 'phone' && (
              <>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">SMS code (sent to {authMethod.phoneNumber})</Label>
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={handleSendOtp} disabled={isSendingOtp}>
                    {isSendingOtp ? 'Sending…' : (otpSent ? 'Resend' : 'Send code')}
                  </Button>
                </div>
                <Input
                  type="text" inputMode="text" autoCapitalize="characters" maxLength={6}
                  placeholder={otpSent ? 'ABCD' : 'Code will arrive shortly…'}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6))}
                  className="font-mono text-center tracking-[0.4em]"
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  We sent a new code to <strong>{authMethod.phoneNumber}</strong>. Enter it to authorize this transfer.
                </p>
              </>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep('form')} disabled={isSending}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button className="flex-1" onClick={handleSend} disabled={isSending}>
                {isSending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                Send {amount} {token}
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: DONE ── */}
        {step === 'done' && (
          <div className="space-y-4 text-center py-2">
            <div className="h-14 w-14 rounded-full bg-green-50 dark:bg-green-950 mx-auto flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Sent!</h3>
              <p className="text-sm text-muted-foreground">
                {amount} {token} sent on {chain}
              </p>
            </div>
            {resultHash && (
              <a
                href={(() => {
                  const c = normalizeChain(chain);
                  if (c === 'BASE') return `https://basescan.org/tx/${resultHash}`;
                  if (c === 'BNB' || c === 'BSC') return `https://bscscan.com/tx/${resultHash}`;
                  if (c === 'POLYGON') return `https://polygonscan.com/tx/${resultHash}`;
                  if (c === 'ARBITRUM') return `https://arbiscan.io/tx/${resultHash}`;
                  if (c === 'OPTIMISM') return `https://optimistic.etherscan.io/tx/${resultHash}`;
                  if (c === 'LISK') return `https://blockscout.lisk.com/tx/${resultHash}`;
                  if (c === 'CELO') return `https://celoscan.io/tx/${resultHash}`;
                  if (c === 'AVAX') return `https://snowtrace.io/tx/${resultHash}`;
                  return `https://etherscan.io/tx/${resultHash}`;
                })()}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-mono"
              >
                {resultHash.slice(0, 12)}…{resultHash.slice(-8)} <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <Button className="w-full" onClick={onClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
