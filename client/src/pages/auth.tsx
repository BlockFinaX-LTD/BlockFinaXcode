/**
 * auth.tsx — Sign in / sign up via Rift Finance
 *
 * Explicit Sign In vs Sign Up tabs. Inside each, pick one of 3 methods:
 *   1. Email + OTP        — SDK: signup({email, displayName}) / login({email, otpCode})
 *   2. Phone + OTP        — SDK: signup({phoneNumber, displayName}) / login({phoneNumber, otpCode})
 *   3. Username + Password — SDK: signup({externalId, password, displayName}) / login({externalId, password})
 *
 * displayName is auto-derived from the identifier so users don't fill extra fields.
 */

import { useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, Phone, Key } from 'lucide-react';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';
import { sendOtp, login as riftLogin, signup as riftSignup } from '@/lib/rift-client';

type Mode = 'signin' | 'signup';
type Method = 'email' | 'phone' | 'password';

export default function Auth() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>('signin');
  const [method, setMethod] = useState<Method>('email');
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');

  const resetOtp = () => { setOtpCode(''); setOtpSent(false); };

  // ── Sign in (email/phone): just send OTP, no signup call ────────────────
  const handleSigninSendCode = async () => {
    const identifier = method === 'email' ? email : phone;
    if (!identifier) {
      toast({ title: `Enter your ${method}`, variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      await sendOtp(method === 'email' ? { email } : { phone });
      setOtpSent(true);
      toast({ title: 'Code sent', description: `Check your ${method}` });
    } catch (err: any) {
      toast({ title: 'Failed to send code', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Sign up (email/phone): create account then send OTP ─────────────────
  // If account already exists (409), fall through and send OTP anyway — the
  // user just goes through the login flow.
  const handleSignupSendCode = async () => {
    const identifier = method === 'email' ? email : phone;
    if (!identifier) {
      toast({ title: `Enter your ${method}`, variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const displayName = method === 'email' ? email.split('@')[0] : phone;
      let alreadyExists = false;
      try {
        await riftSignup(
          method === 'email'
            ? { email, displayName }
            : { phoneNumber: phone, displayName }
        );
      } catch (err: any) {
        if (err?.status === 409) alreadyExists = true;
        else throw err;
      }
      await sendOtp(method === 'email' ? { email } : { phone });
      setOtpSent(true);
      toast({
        title: alreadyExists ? 'Account already exists' : 'Account created',
        description: alreadyExists ? 'Signing you in instead — check your ' + method + ' for a code' : `Check your ${method} for a code`,
      });
    } catch (err: any) {
      toast({ title: 'Signup failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Verify OTP → login ──────────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    setIsLoading(true);
    try {
      await riftLogin(method === 'email' ? { email, otpCode } : { phoneNumber: phone, otpCode });
      toast({ title: mode === 'signup' ? 'Welcome!' : 'Welcome back!' });
      setLocation('/home');
    } catch (err: any) {
      toast({ title: 'Login failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Password sign in ────────────────────────────────────────────────────
  const handlePasswordSignin = async () => {
    if (!username || !password) {
      toast({ title: 'Username and password required', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      await riftLogin({ externalId: username, password });
      toast({ title: 'Welcome back!' });
      setLocation('/home');
    } catch (err: any) {
      toast({ title: 'Login failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Password sign up ────────────────────────────────────────────────────
  // If username already taken (409), try logging in with the supplied password.
  // That way a returning user who clicks "Create Account" is handled gracefully.
  const handlePasswordSignup = async () => {
    if (!username || !password) {
      toast({ title: 'Username and password required', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      let alreadyExists = false;
      try {
        await riftSignup({ externalId: username, password, displayName: username });
      } catch (err: any) {
        if (err?.status === 409) alreadyExists = true;
        else throw err;
      }
      await riftLogin({ externalId: username, password });
      toast({ title: alreadyExists ? 'Welcome back!' : 'Account created!' });
      setLocation('/home');
    } catch (err: any) {
      toast({ title: 'Signup failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  const identifierLabel = method === 'phone' ? phone : email;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />

      <Card className="w-full max-w-md relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardContent className="pt-8 pb-8 space-y-6">
          <div className="text-center space-y-1">
            <img src={logoPath} alt="BlockFinaX" className="h-10 w-10 object-contain mx-auto" />
            <h1 className="text-xl font-bold">Welcome to BlockFinaX</h1>
            <p className="text-xs text-muted-foreground">P2P hedging & cross-border payments</p>
          </div>

          {otpSent ? (
            <div className="space-y-4">
              <div className="text-center">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                  {method === 'phone' ? <Phone className="h-6 w-6 text-primary" /> : <Mail className="h-6 w-6 text-primary" />}
                </div>
                <p className="text-sm text-muted-foreground">
                  Code sent to <span className="font-medium text-foreground">{identifierLabel}</span>
                </p>
              </div>

              <Input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="one-time-code"
                maxLength={4}
                placeholder="ABCD"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4))}
                onKeyDown={(e) => { if (e.key === 'Enter' && otpCode.length === 4) handleVerifyOtp(); }}
                className="text-center text-2xl font-mono tracking-[0.5em] h-14 uppercase"
                autoFocus
              />

              <Button onClick={handleVerifyOtp} disabled={isLoading || otpCode.length !== 4} className="w-full h-11">
                {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Continue
              </Button>

              <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={resetOtp}>
                Back
              </Button>
            </div>
          ) : (
            <Tabs value={mode} onValueChange={(v) => { setMode(v as Mode); resetOtp(); }}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>

              {/* Method selector, shared across both modes */}
              <Tabs value={method} onValueChange={(v) => setMethod(v as Method)} className="mt-4">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="email"><Mail className="h-3 w-3 mr-1" />Email</TabsTrigger>
                  <TabsTrigger value="phone"><Phone className="h-3 w-3 mr-1" />Phone</TabsTrigger>
                  <TabsTrigger value="password"><Key className="h-3 w-3 mr-1" />Password</TabsTrigger>
                </TabsList>

                <TabsContent value="email" className="space-y-3 mt-4">
                  <div>
                    <Label htmlFor="email" className="text-sm">Email</Label>
                    <Input
                      id="email" type="email" placeholder="you@example.com"
                      value={email} onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && email) (mode === 'signup' ? handleSignupSendCode : handleSigninSendCode)(); }}
                      autoFocus
                    />
                  </div>
                  <Button
                    onClick={mode === 'signup' ? handleSignupSendCode : handleSigninSendCode}
                    disabled={isLoading || !email} className="w-full"
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                    {mode === 'signup' ? 'Create account' : 'Send sign-in code'}
                  </Button>
                </TabsContent>

                <TabsContent value="phone" className="space-y-3 mt-4">
                  <div>
                    <Label htmlFor="phone" className="text-sm">Phone (with country code)</Label>
                    <Input
                      id="phone" type="tel" placeholder="+254712345678"
                      value={phone} onChange={(e) => setPhone(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && phone) (mode === 'signup' ? handleSignupSendCode : handleSigninSendCode)(); }}
                      autoFocus
                    />
                  </div>
                  <Button
                    onClick={mode === 'signup' ? handleSignupSendCode : handleSigninSendCode}
                    disabled={isLoading || !phone} className="w-full"
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Phone className="h-4 w-4 mr-2" />}
                    {mode === 'signup' ? 'Create account' : 'Send sign-in code'}
                  </Button>
                </TabsContent>

                <TabsContent value="password" className="space-y-3 mt-4">
                  <div>
                    <Label htmlFor="username" className="text-sm">Username</Label>
                    <Input
                      id="username" type="text" placeholder="your-username"
                      value={username} onChange={(e) => setUsername(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label htmlFor="pw" className="text-sm">Password</Label>
                    <Input
                      id="pw" type="password" placeholder="••••••••"
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && username && password) (mode === 'signup' ? handlePasswordSignup : handlePasswordSignin)(); }}
                    />
                  </div>
                  <Button
                    onClick={mode === 'signup' ? handlePasswordSignup : handlePasswordSignin}
                    disabled={isLoading || !username || !password} className="w-full"
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Key className="h-4 w-4 mr-2" />}
                    {mode === 'signup' ? 'Create account' : 'Sign in'}
                  </Button>
                </TabsContent>
              </Tabs>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
