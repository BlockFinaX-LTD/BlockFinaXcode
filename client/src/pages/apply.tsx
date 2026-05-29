/**
 * apply.tsx — Access request form.
 *
 * Compact, professional intake: Name · Email · Country · Role ·
 * Company / Project · Use case · How heard · Telegram or X handle.
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
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
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

const FIELD_LABEL = 'text-[12px] font-medium text-gray-700';

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

  const canSubmit =
    name.trim().length > 1 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    !submitting;

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
      <div className="min-h-screen bg-white flex flex-col">
        <Header onBack={() => setLocation('/')} />
        <main className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8">
          <div className="w-full max-w-md text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-5">
              <CheckCircle className="h-7 w-7 text-emerald-600" strokeWidth={1.8} />
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">
              Application received
            </h1>
            <p className="mt-3 text-sm sm:text-base text-gray-500 leading-relaxed">
              Thanks{name ? `, ${name.split(' ')[0]}` : ''}. We&rsquo;ve sent a
              confirmation to{' '}
              <span className="font-medium text-gray-900 break-words">{email}</span>{' '}
              and the team will be in touch within 48 hours.
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
    <div className="min-h-screen bg-white">
      <Header onBack={() => setLocation('/')} />

      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-20">
        <div className="mb-10 sm:mb-12">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900 leading-[1.1]">
            Request access
          </h1>
          <p className="mt-3 text-sm sm:text-base text-gray-500 leading-relaxed max-w-xl">
            A few details so we can route you to the right cohort. We typically respond within
            48 hours.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-10">
          {/* Identity */}
          <FormSection title="About you">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-5">
              <Field label="Full name" required>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  className="h-11 rounded-lg border-gray-200 focus-visible:ring-gray-900 focus-visible:ring-1 focus-visible:ring-offset-0"
                  required
                />
              </Field>
              <Field label="Work email" required hint="Use the address you'll sign in with">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="h-11 rounded-lg border-gray-200 focus-visible:ring-gray-900 focus-visible:ring-1 focus-visible:ring-offset-0"
                  required
                />
              </Field>
              <Field label="Country">
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger className="h-11 rounded-lg border-gray-200 focus:ring-gray-900 focus:ring-1 focus:ring-offset-0">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__africa" disabled className="text-xs uppercase tracking-wider text-gray-400">
                      Africa
                    </SelectItem>
                    {AFRICAN_COUNTRIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                    <SelectItem value="__other" disabled className="text-xs uppercase tracking-wider text-gray-400">
                      Other
                    </SelectItem>
                    {OTHER_COUNTRIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Telegram or X handle" hint="Optional">
                <Input
                  value={socialHandle}
                  onChange={(e) => setSocialHandle(e.target.value)}
                  placeholder="@yourhandle"
                  className="h-11 rounded-lg border-gray-200 focus-visible:ring-gray-900 focus-visible:ring-1 focus-visible:ring-offset-0"
                />
              </Field>
            </div>
          </FormSection>

          {/* Context */}
          <FormSection title="Your context">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-5">
              <Field label="Role">
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="h-11 rounded-lg border-gray-200 focus:ring-gray-900 focus:ring-1 focus:ring-offset-0">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Company / project" hint="Optional">
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="If applicable"
                  className="h-11 rounded-lg border-gray-200 focus-visible:ring-gray-900 focus-visible:ring-1 focus-visible:ring-offset-0"
                />
              </Field>
            </div>

            <div className="mt-5">
              <Field label="What FX problem are you trying to solve?" hint="Optional — specifics help us route you faster">
                <Textarea
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  rows={4}
                  placeholder="e.g. We earn in NGN and pay suppliers in USD; margin gets eaten when the naira moves."
                  className="rounded-lg border-gray-200 resize-none focus-visible:ring-gray-900 focus-visible:ring-1 focus-visible:ring-offset-0"
                />
              </Field>
            </div>

            <div className="mt-5">
              <Field label="How did you hear about us?">
                <Select value={heardFrom} onValueChange={setHeardFrom}>
                  <SelectTrigger className="h-11 rounded-lg border-gray-200 focus:ring-gray-900 focus:ring-1 focus:ring-offset-0">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {HEARD_FROM.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </FormSection>

          {/* Submit */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <p className="text-[11px] sm:text-xs text-gray-400 leading-relaxed">
              By submitting, you agree to our{' '}
              <a href="/terms" className="text-gray-600 hover:text-gray-900 underline underline-offset-2">terms</a>{' '}
              and{' '}
              <a href="/privacy" className="text-gray-600 hover:text-gray-900 underline underline-offset-2">privacy policy</a>.
            </p>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="w-full sm:w-auto h-11 sm:min-w-[170px] rounded-full px-7 bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-white"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting&hellip;
                </>
              ) : (
                'Submit'
              )}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

// ── Local UI primitives so the form looks consistent ─────────────────────

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

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400 mb-4">
        {title}
      </p>
      {children}
    </section>
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
      <Label className={FIELD_LABEL}>
        {label}
        {required && <span className="text-gray-400 ml-0.5">*</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="text-[11px] text-gray-400 mt-1.5">{hint}</p>}
    </div>
  );
}
