/**
 * apply.tsx — Private-beta access request form
 *
 * Comprehensive but compact (single screen on desktop, scrolls on mobile):
 * Name · Email · Country · Role · Company / Project · Use case ·
 * How heard · Telegram or X handle.
 * Posts to /api/access/request → admin notified, user gets confirmation.
 */

import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle, Loader2, Lock } from 'lucide-react';
import { submitAccessRequest } from '@/lib/access';
import logoPath from '@/assets/logo.png';

const AFRICAN_COUNTRIES = [
  'Ghana', 'Nigeria', 'Kenya', 'South Africa', 'Tanzania', 'Uganda',
  'Ethiopia', 'Rwanda', 'Senegal', 'Côte d\'Ivoire', 'Cameroon', 'Morocco',
  'Egypt', 'Tunisia', 'Algeria', 'Mozambique', 'Zambia', 'Zimbabwe',
  'Botswana', 'Namibia', 'Malawi', 'DRC', 'Angola', 'Madagascar',
  'Mali', 'Burkina Faso', 'Niger', 'Benin', 'Togo', 'Sierra Leone',
  'Liberia', 'Guinea', 'Gambia',
];

const OTHER_COUNTRIES = [
  'United States', 'United Kingdom', 'Canada', 'Germany', 'France',
  'Netherlands', 'Switzerland', 'UAE', 'Singapore', 'India', 'Brazil',
  'Australia',
];

const ROLE_OPTIONS = [
  'Importer / Exporter',
  'SME / Business owner',
  'Treasury / CFO',
  'Crypto trader',
  'Liquidity provider / Market maker',
  'Investor / VC',
  'Developer / Builder',
  'Researcher / Analyst',
  'Journalist',
  'Other',
];

const HEARD_FROM = [
  'X / Twitter',
  'Telegram / Discord',
  'LinkedIn',
  'A friend or partner',
  'Search / Google',
  'Conference / Event',
  'Other',
];

export default function ApplyPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [useCase, setUseCase] = useState('');
  const [heardFrom, setHeardFrom] = useState('');
  const [socialHandle, setSocialHandle] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const canSubmit = name.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await submitAccessRequest({
        name: name.trim(),
        email: email.trim(),
        country: country || undefined,
        role: role || undefined,
        company: company.trim() || undefined,
        useCase: useCase.trim() || undefined,
        heardFrom: heardFrom || undefined,
        socialHandle: socialHandle.trim() || undefined,
      });
      setDone(true);
    } catch (err: any) {
      toast({
        title: 'Could not submit',
        description: err?.message || 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full rounded-2xl">
          <CardContent className="pt-8 pb-7 text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle className="h-7 w-7 text-emerald-600" strokeWidth={1.8} />
            </div>
            <h1 className="bfx-display text-xl font-semibold tracking-tight">
              We got your application
            </h1>
            <p className="text-sm text-muted-foreground">
              Thanks, {name.split(' ')[0]}. We've sent a confirmation to{' '}
              <span className="font-medium text-foreground font-mono-data">{email}</span> and the
              team is reviewing. Most decisions come back within 48 hours.
            </p>
            <div className="pt-2">
              <Button variant="outline" onClick={() => setLocation('/')} className="rounded-xl">
                Back to home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur border-b border-border/60">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation('/')}
            className="h-9 w-9 rounded-full"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <img src={logoPath} alt="BlockFinaX" className="h-7 w-7 object-contain" />
          <span className="bfx-display text-[15px] font-semibold tracking-tight">Apply for access</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6">
        {/* Intro */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-primary font-semibold bg-primary/10 rounded-full px-2.5 py-1 mb-3">
            <Lock className="h-3 w-3" />
            Private beta
          </div>
          <h1 className="bfx-display text-2xl font-semibold tracking-tight">
            Request access to BlockFinaX
          </h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            We're onboarding partners and early users one cohort at a time so we can listen, fix,
            and ship fast. Tell us a little about who you are and what you're trying to do — we'll
            email you when you're in. Most decisions land within <strong>48 hours</strong>.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* Identity */}
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Identity
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="name" className="text-xs">Full name *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    className="mt-1.5 rounded-xl"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="email" className="text-xs">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="mt-1.5 rounded-xl"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Use the same email you'll sign in with.
                  </p>
                </div>
                <div>
                  <Label htmlFor="country" className="text-xs">Country</Label>
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger id="country" className="mt-1.5 rounded-xl">
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="__africa" disabled>— Africa —</SelectItem>
                      {AFRICAN_COUNTRIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                      <SelectItem value="__other" disabled>— Other —</SelectItem>
                      {OTHER_COUNTRIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="social" className="text-xs">Telegram or X handle</Label>
                  <Input
                    id="social"
                    value={socialHandle}
                    onChange={(e) => setSocialHandle(e.target.value)}
                    placeholder="@yourhandle"
                    className="mt-1.5 rounded-xl"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Role */}
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                What brings you here
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="role" className="text-xs">Your role</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger id="role" className="mt-1.5 rounded-xl">
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="company" className="text-xs">Company / Project</Label>
                  <Input
                    id="company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="If applicable"
                    className="mt-1.5 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="useCase" className="text-xs">What FX problem are you trying to solve?</Label>
                <Textarea
                  id="useCase"
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  rows={4}
                  placeholder="e.g. We pay suppliers in USD but earn in NGN and our margin gets eaten when the naira moves. We want to lock in cost."
                  className="mt-1.5 rounded-xl resize-none"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Specifics help us understand who to prioritise. Optional but appreciated.
                </p>
              </div>

              <div>
                <Label htmlFor="heard" className="text-xs">How did you hear about us?</Label>
                <Select value={heardFrom} onValueChange={setHeardFrom}>
                  <SelectTrigger id="heard" className="mt-1.5 rounded-xl">
                    <SelectValue placeholder="Choose one" />
                  </SelectTrigger>
                  <SelectContent>
                    {HEARD_FROM.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLocation('/')}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="rounded-xl h-11 sm:min-w-40">
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>
              ) : (
                'Submit application'
              )}
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground text-center pt-2">
            By submitting you agree to our{' '}
            <a href="/terms" className="underline">terms</a> and{' '}
            <a href="/privacy" className="underline">privacy policy</a>.
          </p>
        </form>
      </main>
    </div>
  );
}
