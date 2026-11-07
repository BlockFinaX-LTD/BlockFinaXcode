/**
 * The Terms of Use and Privacy Policy card. Shown after sign-in until the account has
 * accepted the current versions, and again whenever either changes (server/legal).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api, signOutPasskey } from '@/lib/wallets/passkey-wallet';
import { PRIVACY_EFFECTIVE_DATE, PRIVACY_VERSION, TERMS_EFFECTIVE_DATE, TERMS_VERSION } from '@shared/legal';
import { Spin } from './ui';

interface LegalStatus { needsAcceptance: boolean; updated: boolean }

/** Keyed by user, so a different person signing in on the same browser is asked again. */
export function useLegalStatus(userId: number | null) {
  return useQuery({ queryKey: ['legal-status', userId], enabled: userId !== null, queryFn: () => api<LegalStatus>('/api/legal/status'), staleTime: Infinity, retry: 2 });
}

export function LegalCard({ updated }: { updated: boolean }) {
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/legal/accept', { terms: TERMS_VERSION, privacy: PRIVACY_VERSION });
      qc.setQueriesData({ queryKey: ['legal-status'] }, { needsAcceptance: false, updated });
    } catch (e) {
      setError((e as Error).message || 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  }

  async function signOut() {
    await signOutPasskey().catch(() => undefined);
    window.location.href = '/';
  }

  return (
    <div className="bx-onboard">
      <div className="bx-onboard-card" role="dialog" aria-labelledby="legal-title" style={{ maxWidth: 520 }}>
        <h1 id="legal-title" style={{ margin: 0, fontSize: 18 }}>{updated ? 'We have updated our terms' : 'Terms of Use and Privacy Policy'}</h1>
        <p className="sub" style={{ marginTop: 8, lineHeight: 1.55 }}>
          {updated
            ? 'Please review the updated documents below. You need to accept them to keep using BlockFinaX.'
            : 'Before you continue, please read and accept our Terms of Use and Privacy Policy.'}
        </p>

        <div style={{ display: 'grid', gap: 8, marginTop: 18 }}>
          <a className="bx-legal-doc" href="/terms" target="_blank" rel="noreferrer">
            <span><b>Terms of Use</b><span className="muted"> · Version {TERMS_VERSION} · Effective {TERMS_EFFECTIVE_DATE}</span></span>
            <ExternalLink />
          </a>
          <a className="bx-legal-doc" href="/privacy" target="_blank" rel="noreferrer">
            <span><b>Privacy Policy</b><span className="muted"> · Version {PRIVACY_VERSION} · Effective {PRIVACY_EFFECTIVE_DATE}</span></span>
            <ExternalLink />
          </a>
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18, fontSize: 14, lineHeight: 1.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16 }} />
          <span>I have read and agree to the <a href="/terms" target="_blank" rel="noreferrer" className="underline">Terms of Use</a>, and I acknowledge the <a href="/privacy" target="_blank" rel="noreferrer" className="underline">Privacy Policy</a>.</span>
        </label>

        {error && <p className="bx-error">{error}</p>}

        <button className="bx-btn block" style={{ marginTop: 18 }} disabled={!agreed || busy} onClick={accept}>{busy ? <Spin /> : null} Continue</button>
        <button className="bx-btn ghost block" style={{ marginTop: 8 }} onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
