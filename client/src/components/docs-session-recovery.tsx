import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Investor sessions are in memory. Re-establish one from the durable docs
// credential before the data room or whitepaper checks it after a restart.
export function DocsSessionRecovery({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem('bfx_docs_token');
        if (!raw) return;
        const stored = JSON.parse(raw);
        if (!stored.token) return;
        const res = await fetch(`/api/docs/verify?t=${encodeURIComponent(stored.token)}`);
        // A temporary network error should not destroy a working session.
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.valid && data.investorToken) {
          localStorage.setItem('bfx_investor_token', data.investorToken);
          localStorage.setItem('bfx_docs_token', JSON.stringify({ token: stored.token, expiresAt: data.expiresAt }));
        } else {
          localStorage.removeItem('bfx_docs_token');
          localStorage.removeItem('bfx_investor_token');
        }
      } catch { /* Let the existing data-room gate handle missing credentials. */ }
      finally { if (!cancelled) setChecking(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  if (checking) return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  return <>{children}</>;
}
