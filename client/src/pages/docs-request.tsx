/**
 * docs-request.tsx — Form to request a 7-day docs magic link.
 */

import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle, Loader2, FileText, Lock } from 'lucide-react';
import logoPath from '@/assets/logo.png';

export default function DocsRequestPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/docs/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error('Request failed');
      setSent(true);
    } catch (err: any) {
      toast({
        title: 'Could not send',
        description: err?.message || 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full rounded-2xl">
          <CardContent className="pt-8 pb-7 text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle className="h-7 w-7 text-emerald-600" strokeWidth={1.8} />
            </div>
            <h1 className="bfx-display text-xl font-semibold tracking-tight">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              We've sent a magic link to{' '}
              <span className="font-mono-data text-foreground">{email}</span>. Click it to read
              the whitepaper, pitch deck and data room. The link is valid for 7 days.
            </p>
            <p className="text-[11px] text-muted-foreground">
              Don't see it? Check your spam folder, or wait a couple of minutes — Resend can be
              a little slow on first delivery.
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
          <span className="bfx-display text-[15px] font-semibold tracking-tight">Request docs access</span>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-8">
        <div className="text-center mb-6">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
            <FileText className="h-6 w-6" strokeWidth={1.7} />
          </div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-primary font-semibold bg-primary/10 rounded-full px-2.5 py-1 mb-2">
            <Lock className="h-3 w-3" />
            Private beta
          </div>
          <h1 className="bfx-display text-xl font-semibold tracking-tight">
            BlockFinaX docs
          </h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Whitepaper, pitch deck, data room. Submit your email and we'll send you a magic link
            within a couple of minutes — valid for <strong>7 days</strong>.
          </p>
        </div>

        <Card className="rounded-2xl">
          <CardContent className="p-5">
            <form onSubmit={onSubmit} className="space-y-4">
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
              </div>
              <div>
                <Label htmlFor="name" className="text-xs">Name (optional)</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  className="mt-1.5 rounded-xl"
                />
              </div>
              <div>
                <Label htmlFor="reason" className="text-xs">What are you evaluating? (optional)</Label>
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. partnership, treasury use, investment evaluation"
                  className="mt-1.5 rounded-xl resize-none"
                />
              </div>
              <Button
                type="submit"
                disabled={!valid || submitting}
                className="w-full rounded-xl h-11"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</>
                ) : (
                  'Send magic link'
                )}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                We don't pass your email to anyone else. Tokens are tracked and revocable.
              </p>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
