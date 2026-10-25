/**
 * Contact page (public, /contact). Two columns: who we are and other ways to reach us on the
 * left, the enquiry form on the right. Submits to POST /api/sales-requests, which stores the
 * request and emails the team.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, Check, Mail } from 'lucide-react';

const ENQUIRIES = [
  'General enquiries',
  'Protection for my business',
  'Underwriting and liquidity',
  'Partnerships',
  'API and integrations',
  'Media and press',
  'Security and vulnerability reporting',
  'Compliance and legal',
  'Complaints and feedback',
] as const;

const input =
  'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-[15px] text-[#0a0e1a] placeholder:text-gray-400 outline-none focus:border-[#1a4480] focus:ring-2 focus:ring-[#1a4480]/15 transition';

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block mb-2 text-sm font-semibold text-[#0a0e1a]">
        {label} {required ? '*' : <span className="font-normal text-gray-500">(optional)</span>}
      </span>
      {children}
      {hint && <span className="block mt-2 text-[13px] text-gray-500">{hint}</span>}
    </label>
  );
}

export default function ContactPage() {
  const preset = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('enquiry');
  const [form, setForm] = useState({
    name: '', email: '', company: '', jobTitle: '', phone: '',
    enquiry: ENQUIRIES.find((e) => e === preset) ?? '',
    message: '',
  });
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setState('sending');
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    try {
      const res = await fetch('/api/sales-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, source: 'contact page' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Something went wrong. Please try again.');
      setState('sent');
    } catch (err) {
      setError((err as Error).message);
      setState('idle');
    }
  }

  return (
    <div className="min-h-screen bg-white text-[#0a0e1a]">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 no-underline">
            <img src="/favicon.png" alt="" className="w-7 h-7 rounded-md" />
            <span className="font-semibold tracking-tight text-[#0a0e1a]">BlockFinaX</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/" className="hidden sm:inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 no-underline px-3 py-2 rounded-full">
              <ArrowLeft className="h-4 w-4" /> Home
            </Link>
            <Link href="/hedge" className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-[#1a4480] hover:bg-[#153a6e] no-underline px-5 py-2.5 rounded-full transition-colors">
              Launch App <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-gray-100">
        {/* Left: who we are */}
        <section className="min-w-0 pt-14 pb-10 lg:pt-20 lg:pr-14">
          <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.02] break-words">Contact BlockFinaX</h1>
          <p className="mt-6 text-lg text-gray-500 leading-relaxed max-w-md">
            Get in touch about protecting your business, providing liquidity, integrating the protocol or another enquiry.
          </p>

          <div className="mt-12 space-y-3 max-w-md">
            <a href="mailto:hello@blockfinax.com" className="flex items-center gap-3 rounded-xl border border-gray-100 px-4 py-3 no-underline text-[#0a0e1a] hover:border-gray-200 hover:bg-gray-50 transition">
              <Mail className="h-5 w-5 text-[#1a4480]" />
              <span><span className="block text-sm font-semibold">Email us</span><span className="block text-sm text-gray-500">hello@blockfinax.com</span></span>
            </a>
          </div>
        </section>

        {/* Right: the form */}
        <section className="min-w-0 pt-6 pb-20 lg:pt-20 lg:pl-14">
          {state === 'sent' ? (
            <div className="rounded-2xl border border-gray-100 p-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#1a4480]/10">
                <Check className="h-6 w-6 text-[#1a4480]" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Thanks, we have your message</h2>
              <p className="mt-3 text-gray-500">The right team will reply to {form.email}, usually within two working days.</p>
              <Link href="/" className="mt-6 inline-flex text-sm font-medium text-[#1a4480]">Back to the website</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-6">
              <div>
                <h2 className="text-4xl font-semibold tracking-tight">How can we help?</h2>
                <p className="mt-4 text-gray-500 leading-relaxed">Tell us who you represent and what you need. We'll direct your enquiry to the right team.</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-5">
                <Field label="Full name" required>
                  <input className={input} required maxLength={120} autoComplete="name" placeholder="Enter your full name" value={form.name} onChange={set('name')} />
                </Field>
                <Field label="Email address" required>
                  <input className={input} required type="email" maxLength={254} autoComplete="email" placeholder="Enter your email address" value={form.email} onChange={set('email')} />
                </Field>
              </div>

              <Field label="Company or organisation" required hint='Enquiring independently? Enter "Independent".'>
                <input className={input} required maxLength={160} autoComplete="organization" placeholder="Who do you represent?" value={form.company} onChange={set('company')} />
              </Field>

              <Field label="Job title or role">
                <input className={input} maxLength={120} autoComplete="organization-title" placeholder="Enter your role" value={form.jobTitle} onChange={set('jobTitle')} />
              </Field>

              <div className="grid sm:grid-cols-2 gap-5">
                <Field label="Phone number">
                  <input className={input} type="tel" maxLength={40} autoComplete="tel" placeholder="Include your country code" value={form.phone} onChange={set('phone')} />
                </Field>
                <Field label="Enquiry type" required>
                  <select className={`${input} ${form.enquiry ? '' : 'text-gray-400'}`} required value={form.enquiry} onChange={set('enquiry')}>
                    <option value="" disabled>Select an enquiry type</option>
                    {ENQUIRIES.map((e) => <option key={e} value={e} className="text-[#0a0e1a]">{e}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Message" required>
                <textarea className={`${input} min-h-[140px] resize-y`} required maxLength={2000} placeholder="How can we help?" value={form.message} onChange={set('message')} />
              </Field>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="text-[13px] text-gray-500 space-y-1">
                <p>* Required fields</p>
                <p>How we handle your information: <Link href="/privacy" className="text-[#1a4480] underline">Privacy Policy</Link></p>
              </div>

              <button type="submit" disabled={state === 'sending'} className="w-full rounded-full bg-[#1a4480] hover:bg-[#153a6e] disabled:opacity-60 text-white font-medium py-3.5 transition-colors">
                {state === 'sending' ? 'Sending…' : 'Send enquiry'}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
