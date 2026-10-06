import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

type DocRequest = {
  id: number; email: string; name: string | null; reason: string | null;
  status: string; deliveryError: string | null; createdAt: string; reviewedAt: string | null;
};
type DocToken = { id: number; email: string; expiresAt: string; revokedAt: string | null };

export function DocumentsSection({ token }: { token: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function api(path: string, body?: object, method = 'GET') {
    const res = await fetch(path, {
      method, headers: { 'x-admin-token': token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
    return data;
  }
  const requests = useQuery<{ requests: DocRequest[] }>({
    queryKey: ['admin-docs-requests', token], queryFn: () => api('/api/admin/docs/requests'), refetchInterval: 15000,
  });
  const tokens = useQuery<{ tokens: DocToken[] }>({
    queryKey: ['admin-docs-tokens', token], queryFn: () => api('/api/admin/docs/tokens'), refetchInterval: 15000,
  });
  async function act(path: string, body?: object, method = 'POST') {
    setBusy(true);
    try {
      await api(path, body, method);
      await Promise.all([requests.refetch(), tokens.refetch()]);
      toast({ title: method === 'DELETE' ? 'Access link revoked' : body && 'action' in body && body.action === 'reject' ? 'Request rejected' : 'Access email sent' });
    } catch (err) {
      toast({ title: 'Could not complete action', description: (err as Error).message, variant: 'destructive' });
    } finally { setBusy(false); }
  }
  async function openDocs(technical = false) {
    setBusy(true);
    try {
      const data = await api('/api/admin/docs/session', {}, 'POST');
      // Both sites receive the same server-issued admin token.
      window.location.assign(technical ? `${data.technicalUrl}/?t=${encodeURIComponent(data.token)}` : `/docs?t=${encodeURIComponent(data.token)}`);
    } catch (err) {
      toast({ title: 'Could not open documents', description: (err as Error).message, variant: 'destructive' });
      setBusy(false);
    }
  }
  return <div className="space-y-6 max-w-5xl">
    <div>
      <h1 className="text-2xl font-semibold">Documents</h1>
      <p className="text-sm text-gray-500 mt-1">Approve visitors before sending a 7-day, read-only access link.</p>
      <div className="flex flex-wrap gap-2 mt-4">
        <Button disabled={busy} onClick={() => openDocs()}>Open strategy documents</Button>
        <Button disabled={busy} variant="outline" onClick={() => openDocs(true)}>Open technical documents</Button>
      </div>
    </div>
    <Card><CardHeader><CardTitle>Visitor requests</CardTitle></CardHeader><CardContent className="space-y-3">
      {requests.isLoading && <p>Loading requests…</p>}
      {requests.isError && <p className="text-red-600">Could not load requests. <button className="underline" onClick={() => requests.refetch()}>Retry</button></p>}
      {requests.data?.requests.length === 0 && <p className="text-sm text-gray-500">No document requests yet.</p>}
      {requests.data?.requests.map(r => <div key={r.id} className="rounded-lg border p-4 space-y-2">
        <div className="flex flex-wrap justify-between gap-2"><strong>{r.name || r.email}</strong><span className="text-sm text-gray-500">{r.status}</span></div>
        <p className="text-sm break-all">{r.email}</p>
        {r.reason && <p className="text-sm text-gray-600 whitespace-pre-wrap">{r.reason}</p>}
        {r.deliveryError && <p className="text-sm text-red-600">{r.deliveryError}</p>}
        <div className="flex gap-2">
          {r.status === 'pending' && <><Button disabled={busy} onClick={() => act(`/api/admin/docs/requests/${r.id}`, { action: 'approve' })}>Approve & send link</Button><Button disabled={busy} variant="outline" onClick={() => act(`/api/admin/docs/requests/${r.id}`, { action: 'reject' })}>Reject</Button></>}
          {r.status === 'approved' && <Button disabled={busy} variant="outline" onClick={() => act(`/api/admin/docs/requests/${r.id}`, { action: 'resend' })}>Send new link</Button>}
          {r.status === 'sending' && r.reviewedAt && Date.now() - Date.parse(r.reviewedAt) > 300000 && <Button disabled={busy} variant="outline" onClick={() => act(`/api/admin/docs/requests/${r.id}`, { action: 'approve' })}>Retry interrupted delivery</Button>}
        </div>
      </div>)}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Issued access links</CardTitle></CardHeader><CardContent className="space-y-3">
      {tokens.isError && <p className="text-red-600">Could not load access links.</p>}
      {tokens.data?.tokens.map(t => <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="text-sm"><p className="break-all">{t.email}</p><p className="text-gray-500">{t.revokedAt ? 'Revoked' : `Expires ${new Date(t.expiresAt).toLocaleDateString()}`}</p></div>
        {!t.revokedAt && <Button disabled={busy} size="sm" variant="outline" onClick={() => act(`/api/admin/docs/tokens/${t.id}`, undefined, 'DELETE')}>Revoke link</Button>}
      </div>)}
    </CardContent></Card>
  </div>;
}
