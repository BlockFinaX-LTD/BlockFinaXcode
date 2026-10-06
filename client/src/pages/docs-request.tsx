/**
 * docs-request.tsx — Request a 7-day docs magic link.
 */

import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      if (data.status !== 'pending') throw new Error('Unexpected response. Please try again.');
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
      <div className="min-h-screen bg-white flex flex-col">
        <Header onBack={() => setLocation('/')} />
        <main className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8">
          <div className="w-full max-w-md text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-5">
              <CheckCircle className="h-7 w-7 text-emerald-600" strokeWidth={1.8} />
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">
              Request received
            </h1>
            <p className="mt-3 text-sm sm:text-base text-gray-500 leading-relaxed">
              We&rsquo;ll review your request for{' '}
              <span className="font-medium text-gray-900 break-words">{email}</span>. If approved, you&rsquo;ll receive a 7-day access link
              for our strategy and technical documentation.
            </p>
            <p className="mt-4 text-xs text-gray-400">
              No access link is sent until an admin approves your request.
            </p>
            <div className="mt-8">
              <Button
                variant="outline"
                onClick={() => setLocation('/')}
                className="rounded-full px-6 h-10 border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                Back to home
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Header onBack={() => setLocation('/')} />

      <main className="flex-1 flex items-start justify-center px-4 sm:px-6 lg:px-8 pt-10 sm:pt-16 pb-20">
        <div className="w-full max-w-md">
          <div className="mb-8 sm:mb-10">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900 leading-[1.1]">
              Access the docs
            </h1>
            <p className="mt-3 text-sm sm:text-base text-gray-500 leading-relaxed">
              The strategy materials and technical documentation are behind a 7-day magic link.
              Submit your email for review. We&rsquo;ll send a link once your request is approved.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <Field label="Work email" required>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="h-11 rounded-lg border-gray-200 focus-visible:ring-gray-900 focus-visible:ring-1 focus-visible:ring-offset-0"
                required
                autoFocus
              />
            </Field>

            <Field label="Name" hint="Optional">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className="h-11 rounded-lg border-gray-200 focus-visible:ring-gray-900 focus-visible:ring-1 focus-visible:ring-offset-0"
              />
            </Field>

            <Field label="What are you evaluating?" hint="Optional — partnership, treasury, investment, etc.">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Treasury hedging for a Lagos-based fintech"
                className="rounded-lg border-gray-200 resize-none focus-visible:ring-gray-900 focus-visible:ring-1 focus-visible:ring-offset-0"
              />
            </Field>

            <Button
              type="submit"
              disabled={!valid || submitting}
              className="w-full h-11 rounded-full bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-white"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting&hellip;
                </>
              ) : (
                'Request access'
              )}
            </Button>

            <p className="text-[11px] text-gray-400 text-center pt-2 leading-relaxed">
              Each link is unique and tracked. We revoke tokens that get shared publicly.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-gray-100">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors -ml-1 px-1.5 py-1 rounded-md"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back</span>
        </button>
        <div className="flex items-center gap-2">
          <img src={logoPath} alt="BlockFinaX" className="h-6 w-6 object-contain" />
          <span className="text-sm font-medium tracking-tight text-gray-900">BlockFinaX</span>
        </div>
      </div>
    </header>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-[12px] font-medium text-gray-700">
        {label}
        {required && <span className="text-gray-400 ml-0.5">*</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="text-[11px] text-gray-400 mt-1.5">{hint}</p>}
    </div>
  );
}
