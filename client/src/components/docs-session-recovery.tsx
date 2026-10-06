import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getAdminDocsSession } from '@/lib/admin-docs-session';
import { useRift } from '@rift-finance/react';

// Investor sessions are in memory. Re-establish one from the durable docs
// credential before the data room or whitepaper checks it after a restart.
export function DocsSessionRecovery({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, getAccessToken } = useRift();
  const [checking, setChecking] = useState(true);
  const [pendingHydration, setPendingHydration] = useState(() => {
    try { return !!localStorage.getItem('rift:identity'); } catch { return false; }
  });
  useEffect(() => {
    if (isAuthenticated) { setPendingHydration(false); return; }
    if (!pendingHydration) return;
    const timer = setTimeout(() => setPendingHydration(false), 2000);
    return () => clearTimeout(timer);
  }, [isAuthenticated, pendingHydration]);
  useEffect(() => {
    if (pendingHydration && !isAuthenticated) return;
    let cancelled = false;
    setChecking(true);
    (async () => {
      try {
        const dashboardSession = await getAdminDocsSession();
        if (cancelled) return;
        if (dashboardSession?.token && dashboardSession.expiresAt && dashboardSession.investorToken) {
          localStorage.setItem('bfx_docs_token', JSON.stringify({ token: dashboardSession.token, expiresAt: dashboardSession.expiresAt }));
          localStorage.setItem('bfx_investor_token', dashboardSession.investorToken);
          return;
        }
        // Direct admin entry uses the same server allowlist as the docs hub.
        // Ordinary signed-in visitors do not qualify for this bypass.
        if (isAuthenticated) {
          try {
            const accessToken = await getAccessToken();
            if (cancelled) return;
            const res = await fetch('/api/docs/admin-bypass', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accessToken }),
            });
            if (res.ok) {
              const data = await res.json();
              if (cancelled) return;
              if (data.token && data.expiresAt && data.investorToken) {
                localStorage.setItem('bfx_docs_token', JSON.stringify({ token: data.token, expiresAt: data.expiresAt }));
                localStorage.setItem('bfx_investor_token', data.investorToken);
                return;
              }
            }
          } catch { /* Fall back to an existing approved visitor credential. */ }
        }
        if (cancelled) return;
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
  }, [isAuthenticated, getAccessToken, pendingHydration]);
  if (checking || (pendingHydration && !isAuthenticated)) return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  return <>{children}</>;
}
