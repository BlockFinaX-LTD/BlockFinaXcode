/**
 * import-wallet.tsx — Import existing wallet with seed phrase or private key
 *
 * Flow (industry-standard, matches Trust Wallet / Coinbase Wallet):
 *   Step 1 — enter seed phrase or private key (with live address preview)
 *   Step 2 — set a 6-digit PIN
 *   Step 3 — confirm PIN
 *   Step 4 — wallet is saved, encrypted with the PIN, redirect to /home
 *
 * No separate password step. The PIN is the encryption key, consistent with
 * the create-wallet flow and the unlock-wallet PIN pad.
 */

import { useState, useEffect, useRef } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWallet } from '@/hooks/use-wallet';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Eye, EyeOff, CheckCircle2, ArrowLeft, ArrowRight, Lock,
} from 'lucide-react';
import logoPath from '@/assets/logo.png';
import { ethers } from 'ethers';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';

type Step = 'input' | 'pin' | 'confirm';

function PinDots({ filled, error }: { filled: number; error?: boolean }) {
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
        key === '' ? (
          <div key={`pad-empty-${i}`} />
        ) : (
          <button
            key={`pad-${i}`}
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

export default function ImportWallet() {
  const [, setLocation] = useLocation();
  const { importWallet, isLoading } = useWallet();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('input');
  const [importType, setImportType] = useState<'mnemonic' | 'private_key'>('mnemonic');
  const [walletName, setWalletName] = useState('Imported Wallet');
  const [mnemonicValue, setMnemonicValue] = useState('');
  const [privateKeyValue, setPrivateKeyValue] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [previewAddress, setPreviewAddress] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinMismatch, setPinMismatch] = useState(false);

  const importingRef = useRef(false);

  const currentInput = importType === 'mnemonic' ? mnemonicValue : privateKeyValue;

  useEffect(() => {
    setPreviewAddress(null);
    const raw = currentInput?.trim();
    if (!raw) return;
    const timer = setTimeout(() => {
      try {
        if (importType === 'mnemonic') {
          const cleaned = raw.replace(/\s+/g, ' ');
          const words = cleaned.split(' ');
          if (words.length !== 12 && words.length !== 24) return;
          const w = ethers.Wallet.fromPhrase(cleaned);
          setPreviewAddress(w.address);
        } else {
          if (!raw.startsWith('0x') || raw.length !== 66) return;
          const w = new ethers.Wallet(raw);
          setPreviewAddress(w.address);
        }
      } catch {
        setPreviewAddress(null);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [mnemonicValue, privateKeyValue, importType]);

  const handleNext = () => {
    setInputError(null);
    const raw = currentInput?.trim();
    if (!raw) {
      setInputError('Please enter your seed phrase or private key.');
      return;
    }
    if (importType === 'mnemonic') {
      const words = raw.replace(/\s+/g, ' ').split(' ');
      if (words.length !== 12 && words.length !== 24) {
        setInputError('Seed phrase must be 12 or 24 words.');
        return;
      }
    } else {
      if (!raw.startsWith('0x') || raw.length !== 66) {
        setInputError('Private key must start with 0x and be 66 characters long.');
        return;
      }
    }
    setStep('pin');
  };

  const addDigitPin = (digit: string) => {
    if (pin.length >= 6) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 6) setTimeout(() => setStep('confirm'), 200);
  };

  const addDigitConfirm = (digit: string) => {
    if (confirmPin.length >= 6) return;
    const next = confirmPin + digit;
    setConfirmPin(next);
    if (next.length === 6) setTimeout(() => handleImport(next), 200);
  };

  const handleImport = async (confirmedPin: string) => {
    if (confirmedPin !== pin) {
      setPinMismatch(true);
      setTimeout(() => {
        setPinMismatch(false);
        setConfirmPin('');
        setPin('');
        setStep('pin');
      }, 800);
      return;
    }

    if (importingRef.current) return;
    importingRef.current = true;

    try {
      const input = importType === 'mnemonic'
        ? mnemonicValue.trim().replace(/\s+/g, ' ')
        : privateKeyValue.trim();
      await importWallet(pin, input, importType, walletName || 'Imported Wallet');
      setLocation('/home');
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Import Failed',
        description: error instanceof Error ? error.message : 'Could not import wallet. Check your seed phrase or private key.',
      });
      setConfirmPin('');
      setPin('');
      setStep('pin');
    } finally {
      importingRef.current = false;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />

      <Card className="w-full max-w-sm relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardContent className="pt-8 pb-8">

          {/* ── Step 1: Input ── */}
          {step === 'input' && (
            <div className="space-y-5">
              <div className="text-center space-y-1">
                <Link href="/wallet" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground float-left">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </Link>
                <div className="pt-6">
                  <img src={logoPath} alt="BlockFinaX" className="h-9 w-9 object-contain mx-auto mb-3" />
                  <h1 className="text-xl font-bold">Import Wallet</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Restore your wallet from a seed phrase or private key
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Wallet Name</Label>
                <Input
                  id="name"
                  placeholder="Imported Wallet"
                  value={walletName}
                  onChange={e => setWalletName(e.target.value)}
                />
              </div>

              <Tabs value={importType} onValueChange={v => { setImportType(v as any); setInputError(null); }}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="mnemonic">Seed Phrase</TabsTrigger>
                  <TabsTrigger value="private_key">Private Key</TabsTrigger>
                </TabsList>

                <TabsContent value="mnemonic" className="space-y-2 mt-3">
                  <Label>Seed Phrase (12 or 24 words)</Label>
                  <Textarea
                    placeholder="Enter your seed phrase separated by spaces"
                    rows={4}
                    value={mnemonicValue}
                    onChange={e => { setMnemonicValue(e.target.value); setInputError(null); }}
                    className={inputError ? 'border-destructive' : ''}
                  />
                </TabsContent>

                <TabsContent value="private_key" className="space-y-2 mt-3">
                  <Label>Private Key</Label>
                  <div className="relative">
                    <Input
                      type={showPrivateKey ? 'text' : 'password'}
                      placeholder="0x..."
                      value={privateKeyValue}
                      onChange={e => { setPrivateKeyValue(e.target.value); setInputError(null); }}
                      className={inputError ? 'border-destructive' : ''}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowPrivateKey(v => !v)}
                    >
                      {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>

              {inputError && <p className="text-sm text-destructive">{inputError}</p>}

              {previewAddress && (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Wallet address detected</p>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 break-all font-mono mt-0.5">{previewAddress}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Make sure this is the address where your funds are held.</p>
                  </div>
                </div>
              )}

              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">Security notice</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  Only import on a trusted device. Your seed phrase gives full access to your wallet.
                </p>
              </div>

              <Button
                className="w-full h-12"
                onClick={handleNext}
                disabled={!currentInput?.trim()}
              >
                Continue <ArrowRight className="h-4 w-4 ml-2" />
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                Don't have a wallet?{' '}
                <Link href="/create-wallet" className="text-primary hover:underline">Create new wallet</Link>
              </p>
            </div>
          )}

          {/* ── Step 2: Set PIN ── */}
          {step === 'pin' && (
            <div className="text-center space-y-1">
              <button
                onClick={() => { setStep('input'); setPin(''); }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground float-left"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <div className="pt-6">
                <img src={logoPath} alt="BlockFinaX" className="h-9 w-9 object-contain mx-auto mb-3" />
                <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center mx-auto">
                  <Lock className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <h1 className="text-xl font-bold mt-3">Set your PIN</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Choose a 6-digit PIN to unlock your wallet
                </p>
                <PinDots filled={pin.length} />
                <PinKeypad onDigit={addDigitPin} onDelete={() => setPin(p => p.slice(0, -1))} />
              </div>
            </div>
          )}

          {/* ── Step 3: Confirm PIN ── */}
          {step === 'confirm' && (
            <div className="text-center space-y-1">
              <button
                onClick={() => { setStep('pin'); setConfirmPin(''); }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground float-left"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <div className="pt-6">
                <img src={logoPath} alt="BlockFinaX" className="h-9 w-9 object-contain mx-auto mb-3" />
                <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center mx-auto">
                  <Lock className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <h1 className="text-xl font-bold mt-3">
                  {pinMismatch ? "PINs don't match" : 'Confirm your PIN'}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {pinMismatch ? 'Please start again' : 'Enter your PIN again to confirm'}
                </p>
                <PinDots filled={confirmPin.length} error={pinMismatch} />
                {isLoading || importingRef.current
                  ? <div className="flex justify-center py-6"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                  : <PinKeypad onDigit={addDigitConfirm} onDelete={() => setConfirmPin(p => p.slice(0, -1))} />
                }
              </div>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
