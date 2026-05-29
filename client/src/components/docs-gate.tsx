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
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, FileText, ArrowRight } from 'lucide-react';
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
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-md w-full rounded-2xl">
        <CardContent className="pt-8 pb-7 text-center space-y-5">
          <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <FileText className="h-7 w-7" strokeWidth={1.7} />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-primary font-semibold bg-primary/10 rounded-full px-2.5 py-1 mb-3">
              <Lock className="h-3 w-3" />
              Private docs
            </div>
            <h1 className="bfx-display text-xl font-semibold tracking-tight">
              Request access to the docs
            </h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              The whitepaper, pitch deck and data room are behind a magic-link
              gate while we're in private beta. Submit the form and we'll email
              you a 7-day access link.
            </p>
          </div>

          <Button onClick={() => setLocation('/docs/request')} className="w-full rounded-xl h-11">
            Request docs access <ArrowRight className="h-4 w-4 ml-1" />
          </Button>

          <div>
            <Button variant="ghost" size="sm" onClick={() => setLocation('/')}>Back to home</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
