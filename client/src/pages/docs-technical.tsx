import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Admin authentication lives on www. Transfer only the issued docs credential
// to the configured technical-docs site, which verifies it with the same server.
export default function TechnicalDocs() {
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = JSON.parse(localStorage.getItem('bfx_docs_token') || 'null');
        if (!stored?.token) throw new Error('Open an approved document link or sign in with your admin account to continue.');
        const res = await fetch('/api/docs/site');
        if (!res.ok) throw new Error('Could not reach the documentation site. Please retry.');
        const { url } = await res.json();
        const destination = new URL(url);
        destination.searchParams.set('t', stored.token);
        if (!cancelled) window.location.replace(destination.toString());
      } catch (err) { if (!cancelled) setError((err as Error).message); }
    })();
    return () => { cancelled = true; };
  }, []);
  return <div className="min-h-screen flex items-center justify-center p-6 bg-background">
    <div className="text-center max-w-md">
      {error ? <><p className="mb-4">{error}</p><Button onClick={() => window.location.reload()}>Retry</Button> <a href="/admin" className="underline ml-3">Admin sign-in</a></> : <p className="flex gap-2 items-center"><Loader2 className="h-5 w-5 animate-spin" />Opening technical documents…</p>}
    </div>
  </div>;
}
