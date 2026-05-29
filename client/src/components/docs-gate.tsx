/**
 * docs-gate.tsx — Gates whitepaper / data-room / pitch behind a magic link.
 *
 * Flow:
 *   1. URL hits with ?t=<raw-token> → POST verify → if valid, store the token
 *      in localStorage (per browser) → render the docs
 *   2. URL without ?t — check the stored token → if still valid, render
 *   3. Otherwise show the "Request access" wall with a button to /docs/request
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, ArrowRight } from 'lucide-react';
import logoPath from '@/assets/logo.png';

const STORAGE_KEY = 'bfx_docs_token';

interface StoredToken {
  token: string;
  expiresAt: string;
}

async function verify(token: string): Promise<{ valid: boolean; expiresAt?: string }> {
  try {
    const res = await fetch(`/api/docs/verify?t=${encodeURIComponent(token)}`);
    if (!res.ok) return { valid: false };
    return res.json();
  } catch {
    return { valid: false };
  }
}

function getStoredToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function setStoredToken(token: string, expiresAt: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, expiresAt }));
  } catch {
    /* ignore */
  }
}

type Phase = 'checking' | 'allowed' | 'denied';

export function DocsGate({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<Phase>('checking');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      // 1) Token in URL → verify + store
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('t');
      if (urlToken) {
        const result = await verify(urlToken);
        if (cancelled) return;
        if (result.valid && result.expiresAt) {
          setStoredToken(urlToken, result.expiresAt);
          // Strip ?t= from the URL so the token doesn't sit in browser history
          params.delete('t');
          const search = params.toString();
          const cleaned = window.location.pathname + (search ? `?${search}` : '');
          window.history.replaceState({}, '', cleaned);
          setPhase('allowed');
          return;
        }
        // Bad token — fall through to stored check
      }
      // 2) Stored token still valid?
      const stored = getStoredToken();
      if (stored) {
        const result = await verify(stored.token);
        if (cancelled) return;
        if (result.valid) { setPhase('allowed'); return; }
        // expired/revoked on the server — clear and continue
        localStorage.removeItem(STORAGE_KEY);
      }
      if (!cancelled) setPhase('denied');
    }
    run();
    return () => { cancelled = true; };
  }, []);

  if (phase === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <img src={logoPath} alt="BlockFinaX" className="h-14 w-14 object-contain mx-auto mb-3" />
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verifying access…
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'allowed') return <>{children}</>;

  // Denied
  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center mb-5">
          <FileText className="h-5 w-5 text-gray-700" strokeWidth={1.7} />
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">
          Access the docs
        </h1>
        <p className="mt-3 text-sm sm:text-base text-gray-500 leading-relaxed">
          The strategy materials and technical documentation are behind a 7-day
          magic-link gate. Request access and we&rsquo;ll email you a link.
        </p>

        <div className="mt-7 flex flex-col items-center gap-3">
          <Button
            onClick={() => setLocation('/docs/request')}
            className="w-full sm:w-auto h-11 sm:min-w-[200px] rounded-full px-7 bg-gray-900 text-white hover:bg-gray-800"
          >
            Request access <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation('/')}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Back to home
          </Button>
        </div>
      </div>
    </div>
  );
}
