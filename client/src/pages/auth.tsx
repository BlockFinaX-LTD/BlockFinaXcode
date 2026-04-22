/**
 * auth.tsx — Sign in / sign up via Rift Finance
 *
 * Three login methods:
 *   1. Email + OTP code
 *   2. Phone + OTP code
 *   3. External ID + Password (no OTP)
 *
 * Plus a Sign Up tab for new users.
 *
 * After successful login, Rift's smart wallets are auto-deployed across
 * all chains (Base, Polygon, Arbitrum, Lisk, BNB, etc.). User lands on /home.
 */

import { useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, Phone, Key, UserPlus } from 'lucide-react';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';
import { sendOtp, login as riftLogin, signup as riftSignup } from '@/lib/rift-client';

type LoginMethod = 'email' | 'phone' | 'password';
type View = 'signin' | 'signup' | 'otp';

export default function Auth() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [view, setView] = useState<View>('signin');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('email');
  const [isLoading, setIsLoading] = useState(false);

  // Sign-in fields
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [externalId, setExternalId] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');

  // Sign-up fields
  const [signupForm, setSignupForm] = useState({
    externalId: '',
    password: '',
    displayName: '',
    email: '',
    phoneNumber: '',
  });

  // ── Send OTP (email or phone) ───────────────────────────────────────────
  const handleSendOtp = async () => {
    if (loginMethod === 'email' && !email) {
      toast({ title: 'Enter your email', variant: 'destructive' });
      return;
    }
    if (loginMethod === 'phone' && !phone) {
      toast({ title: 'Enter your phone number', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      await sendOtp(loginMethod === 'email' ? { email } : { phone });
      toast({ title: 'Code sent', description: `Check your ${loginMethod}` });
      setView('otp');
    } catch (err: any) {
      toast({ title: 'Failed to send code', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Login ───────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    setIsLoading(true);
    try {
      let params: Parameters<typeof riftLogin>[0];
      if (loginMethod === 'email') params = { email, otpCode };
      else if (loginMethod === 'phone') params = { phoneNumber: phone, otpCode };
      else params = { externalId, password };

      await riftLogin(params);
      toast({ title: 'Welcome back!' });
      setLocation('/home');
    } catch (err: any) {
      toast({ title: 'Login failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Signup ──────────────────────────────────────────────────────────────
  const handleSignup = async () => {
    const { externalId: sId, password: pw, displayName, email: e, phoneNumber: ph } = signupForm;
    if (!sId || !pw || !displayName) {
      toast({ title: 'Username, password, and display name required', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      await riftSignup({
        externalId: sId,
        password: pw,
        displayName,
        email: e || undefined,
        phoneNumber: ph || undefined,
      });
      // Auto-login after signup with externalId + password
      await riftLogin({ externalId: sId, password: pw });
      toast({ title: 'Account created!', description: 'Your wallet is ready.' });
      setLocation('/home');
    } catch (err: any) {
      toast({ title: 'Signup failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
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

          {view !== 'otp' && (
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>

              {/* ── SIGN IN ── */}
              <TabsContent value="signin" className="space-y-4 mt-4">
                <Tabs value={loginMethod} onValueChange={(v) => setLoginMethod(v as LoginMethod)}>
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
                        value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
                      />
                    </div>
                    <Button onClick={handleSendOtp} disabled={isLoading || !email} className="w-full">
                      {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                      Send Code
                    </Button>
                  </TabsContent>

                  <TabsContent value="phone" className="space-y-3 mt-4">
                    <div>
                      <Label htmlFor="phone" className="text-sm">Phone (with country code)</Label>
                      <Input
                        id="phone" type="tel" placeholder="+254712345678"
                        value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus
                      />
                    </div>
                    <Button onClick={handleSendOtp} disabled={isLoading || !phone} className="w-full">
                      {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Phone className="h-4 w-4 mr-2" />}
                      Send Code
                    </Button>
                  </TabsContent>

                  <TabsContent value="password" className="space-y-3 mt-4">
                    <div>
                      <Label htmlFor="ext-id" className="text-sm">Username</Label>
                      <Input
                        id="ext-id" type="text" placeholder="your-username"
                        value={externalId} onChange={(e) => setExternalId(e.target.value)} autoFocus
                      />
                    </div>
                    <div>
                      <Label htmlFor="pw" className="text-sm">Password</Label>
                      <Input
                        id="pw" type="password" placeholder="••••••••"
                        value={password} onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <Button onClick={handleLogin} disabled={isLoading || !externalId || !password} className="w-full">
                      {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Key className="h-4 w-4 mr-2" />}
                      Sign In
                    </Button>
                  </TabsContent>
                </Tabs>
              </TabsContent>

              {/* ── SIGN UP ── */}
              <TabsContent value="signup" className="space-y-3 mt-4">
                <div>
                  <Label htmlFor="su-name" className="text-sm">Display name</Label>
                  <Input
                    id="su-name" type="text" placeholder="Jane Doe"
                    value={signupForm.displayName}
                    onChange={(e) => setSignupForm(s => ({ ...s, displayName: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="su-username" className="text-sm">Username</Label>
                  <Input
                    id="su-username" type="text" placeholder="janedoe"
                    value={signupForm.externalId}
                    onChange={(e) => setSignupForm(s => ({ ...s, externalId: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="su-pw" className="text-sm">Password</Label>
                  <Input
                    id="su-pw" type="password" placeholder="••••••••"
                    value={signupForm.password}
                    onChange={(e) => setSignupForm(s => ({ ...s, password: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="su-email" className="text-sm">Email <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="su-email" type="email" placeholder="you@example.com"
                    value={signupForm.email}
                    onChange={(e) => setSignupForm(s => ({ ...s, email: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="su-phone" className="text-sm">Phone <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="su-phone" type="tel" placeholder="+254712345678"
                    value={signupForm.phoneNumber}
                    onChange={(e) => setSignupForm(s => ({ ...s, phoneNumber: e.target.value }))}
                  />
                </div>

                <Button
                  onClick={handleSignup}
                  disabled={isLoading || !signupForm.externalId || !signupForm.password || !signupForm.displayName}
                  className="w-full"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
                  Create Account
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Smart wallets auto-deployed across Base, Polygon, Arbitrum, Lisk &amp; more.
                </p>
              </TabsContent>
            </Tabs>
          )}

          {/* ── OTP ENTRY ── */}
          {view === 'otp' && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                  {loginMethod === 'phone' ? <Phone className="h-6 w-6 text-primary" /> : <Mail className="h-6 w-6 text-primary" />}
                </div>
                <p className="text-sm text-muted-foreground">
                  Code sent to <span className="font-medium text-foreground">{loginMethod === 'phone' ? phone : email}</span>
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
                className="text-center text-2xl font-mono tracking-[0.5em] h-14 uppercase"
                autoFocus
              />

              <Button onClick={handleLogin} disabled={isLoading || otpCode.length !== 4} className="w-full h-11">
                {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Verify &amp; Sign In
              </Button>

              <Button
                variant="ghost" size="sm" className="w-full text-muted-foreground"
                onClick={() => { setView('signin'); setOtpCode(''); }}
              >
                Use a different {loginMethod}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
