import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useWallet } from '@/hooks/use-wallet';
import { walletManager } from '@/lib/wallet';
import { Loader2, Eye, EyeOff, Copy, Check, ArrowRight, ArrowLeft, User, Lock, Shield, CheckCircle2, Mail } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from "@/assets/logo.png";

const stepInfoSchema = z.object({
  name: z.string().min(1, 'Wallet name is required'),
  email: z.string().email('Please enter a valid email address'),
});

const stepSecuritySchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type StepInfoData = z.infer<typeof stepInfoSchema>;
type StepSecurityData = z.infer<typeof stepSecuritySchema>;

function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = [
    { num: 1, label: 'Info', icon: User },
    { num: 2, label: 'Security', icon: Lock },
    { num: 3, label: 'Backup', icon: Shield },
    { num: 4, label: 'Verify', icon: CheckCircle2 },
    { num: 5, label: 'Done', icon: Check },
  ];

  return (
    <div className="flex items-center justify-between w-full mb-8 px-2">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const isActive = currentStep === s.num;
        const isCompleted = currentStep > s.num;
        return (
          <div key={s.num} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${
                  isCompleted
                    ? 'bg-primary text-primary-foreground'
                    : isActive
                    ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={`text-[10px] mt-1 font-medium ${isActive || isCompleted ? 'text-primary' : 'text-muted-foreground'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mt-[-12px] transition-all duration-300 ${currentStep > s.num ? 'bg-primary' : 'bg-muted'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function CreateWallet() {
  const [, setLocation] = useLocation();
  const { createWalletFromMnemonic, isLoading } = useWallet();
  const { toast } = useToast();

  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [mnemonic, setMnemonic] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [mnemonicCopied, setMnemonicCopied] = useState(false);
  const [verificationWords, setVerificationWords] = useState<number[]>([]);
  const [verificationInput, setVerificationInput] = useState<string[]>([]);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) setReferralCode(ref);
  }, []);

  const infoForm = useForm<StepInfoData>({
    resolver: zodResolver(stepInfoSchema),
    defaultValues: { name: formData.name, email: formData.email },
  });

  const securityForm = useForm<StepSecurityData>({
    resolver: zodResolver(stepSecuritySchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const handleStep1Next = async () => {
    const valid = await infoForm.trigger();
    if (!valid) return;
    const values = infoForm.getValues();
    setFormData(prev => ({ ...prev, name: values.name, email: values.email }));
    setCurrentStep(2);
  };

  const handleStep2Next = async () => {
    const valid = await securityForm.trigger();
    if (!valid) return;
    if (!acceptTerms) {
      toast({ variant: "destructive", title: "Terms Required", description: "You must accept the terms to continue" });
      return;
    }
    const values = securityForm.getValues();
    setFormData(prev => ({ ...prev, password: values.password }));
    const { mnemonic: newMnemonic } = walletManager.generateWallet();
    setMnemonic(newMnemonic);
    const words = newMnemonic.split(' ');
    const positions: number[] = [];
    while (positions.length < 3) {
      const pos = Math.floor(Math.random() * words.length);
      if (!positions.includes(pos)) positions.push(pos);
    }
    positions.sort((a, b) => a - b);
    setVerificationWords(positions);
    setVerificationInput(new Array(3).fill(''));
    setCurrentStep(3);
  };

  const handleCopyMnemonic = async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      setMnemonicCopied(true);
      toast({ title: "Copied!", description: "Seed phrase copied to clipboard" });
      setTimeout(() => setMnemonicCopied(false), 2000);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to copy" });
    }
  };

  const handleVerificationChange = (index: number, value: string) => {
    const newInput = [...verificationInput];
    newInput[index] = value.toLowerCase().trim();
    setVerificationInput(newInput);
  };

  const handleVerifyAndCreate = async () => {
    const mnemonicWords = mnemonic.split(' ');
    const isValid = verificationWords.every((pos, index) => mnemonicWords[pos] === verificationInput[index]);
    if (!isValid) {
      toast({ variant: "destructive", title: "Verification Failed", description: "The words you entered don't match your seed phrase" });
      return;
    }

    setIsCreating(true);
    try {
      const newWallet = await createWalletFromMnemonic(formData.password, mnemonic, formData.name);

      if (newWallet?.address && formData.email) {
        try {
          await fetch('/api/wallets/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: newWallet.address, email: formData.email }),
          });
        } catch {}
      }

      if (referralCode && newWallet?.address) {
        try {
          const response = await fetch(`/api/referrals/use/${referralCode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ referredWalletAddress: newWallet.address }),
          });
          if (response.ok) {
            const data = await response.json();
            toast({ title: "Referral Bonus Applied!", description: `You earned ${data.pointsAwarded || 50} bonus points!` });
          }
        } catch {}
      }

      setCurrentStep(5);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to create wallet. Please try again." });
    } finally {
      setIsCreating(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="flex justify-start -mt-2">
              <Link href="/wallet" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Link>
            </div>
            <div className="text-center space-y-2">
              <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <User className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-xl font-bold">Your Information</h2>
              <p className="text-sm text-muted-foreground">Give your wallet a name and add your email</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Wallet Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. My Trading Wallet"
                  {...infoForm.register('name')}
                  className={infoForm.formState.errors.name ? 'border-destructive' : ''}
                />
                {infoForm.formState.errors.name && (
                  <p className="text-sm text-destructive">{infoForm.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    className={`pl-10 ${infoForm.formState.errors.email ? 'border-destructive' : ''}`}
                    {...infoForm.register('email')}
                  />
                </div>
                {infoForm.formState.errors.email && (
                  <p className="text-sm text-destructive">{infoForm.formState.errors.email.message}</p>
                )}
              </div>
            </div>

            <Button onClick={handleStep1Next} className="w-full">
              Continue <ArrowRight className="ml-2 h-4 w-4" />
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already have a wallet?{' '}
              <Link href="/import-wallet" className="text-primary hover:underline">Import existing wallet</Link>
            </p>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <Lock className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-xl font-bold">Set Your Password</h2>
              <p className="text-sm text-muted-foreground">This password encrypts your wallet on this device</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="At least 8 characters"
                    {...securityForm.register('password')}
                    className={securityForm.formState.errors.password ? 'border-destructive' : ''}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {securityForm.formState.errors.password && (
                  <p className="text-sm text-destructive">{securityForm.formState.errors.password.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Re-enter your password"
                    {...securityForm.register('confirmPassword')}
                    className={securityForm.formState.errors.confirmPassword ? 'border-destructive' : ''}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {securityForm.formState.errors.confirmPassword && (
                  <p className="text-sm text-destructive">{securityForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>

              <div className="flex items-start space-x-2 pt-2">
                <Checkbox
                  id="acceptTerms"
                  checked={acceptTerms}
                  onCheckedChange={(checked) => setAcceptTerms(checked === true)}
                />
                <Label htmlFor="acceptTerms" className="text-sm leading-snug">
                  I understand that I am responsible for saving my seed phrase and that it cannot be recovered
                </Label>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setCurrentStep(1)} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={handleStep2Next} className="flex-1">
                Continue <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <Shield className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-xl font-bold">Backup Seed Phrase</h2>
              <p className="text-sm text-muted-foreground">Write down these 12 words in order and store them safely</p>
            </div>

            <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-lg">
              <div className="flex items-start space-x-2">
                <Shield className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p className="font-medium text-destructive">Never share your seed phrase</p>
                  <p>Anyone with these words can access your funds. Store them offline.</p>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 bg-muted rounded-lg">
                {mnemonic.split(' ').map((word, index) => (
                  <div key={index} className="flex items-center space-x-2 p-2 bg-background rounded border text-sm">
                    <span className="text-xs text-muted-foreground w-5 text-right">{index + 1}</span>
                    <span className="font-mono font-medium">{word}</span>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyMnemonic}
                className="absolute top-2 right-2"
              >
                {mnemonicCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setCurrentStep(2)} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setCurrentStep(4)} className="flex-1">
                I've Saved It <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-xl font-bold">Verify Your Backup</h2>
              <p className="text-sm text-muted-foreground">Enter the requested words to confirm you saved your seed phrase</p>
            </div>

            <div className="space-y-4">
              {verificationWords.map((wordIndex, index) => (
                <div key={index} className="space-y-2">
                  <Label className="text-sm">Word #{wordIndex + 1}</Label>
                  <Input
                    placeholder={`Enter word ${wordIndex + 1}`}
                    value={verificationInput[index]}
                    onChange={(e) => handleVerificationChange(index, e.target.value)}
                    className="font-mono"
                  />
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setCurrentStep(3)} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button
                onClick={handleVerifyAndCreate}
                disabled={verificationInput.some(w => !w.trim()) || isCreating || isLoading}
                className="flex-1"
              >
                {isCreating || isLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating...</>
                ) : (
                  <>Create Wallet <ArrowRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-6 text-center">
            <div className="space-y-3">
              <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
              </div>
              <h2 className="text-2xl font-bold">Wallet Created!</h2>
              <p className="text-muted-foreground">Your BlockFinaX wallet is ready. You can now send, receive, and manage your funds.</p>
            </div>

            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Wallet Name</span>
                <span className="font-medium">{formData.name}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium">{formData.email}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Network</span>
                <span className="font-medium">Lisk Sepolia (Testnet)</span>
              </div>
            </div>

            <Button onClick={() => setLocation('/home')} className="w-full" size="lg">
              Go to Home <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />
      <Card className="w-full max-w-md relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardContent className="pt-6 pb-6">
          <div className="flex items-center justify-center space-x-2 mb-1">
            <img src={logoPath} alt="BlockFinaX Logo" className="w-7 h-7 object-contain" />
            <span className="font-bold text-lg">BlockFinaX</span>
          </div>
          {currentStep < 5 && <StepIndicator currentStep={currentStep} />}
          {currentStep === 5 && <div className="mb-4" />}
          {renderStepContent()}
        </CardContent>
      </Card>
    </div>
  );
}
