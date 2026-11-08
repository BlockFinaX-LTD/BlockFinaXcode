/**
 * Accounts: who signed up, when, and how far they got (wallet, terms), with one page per
 * person showing everything we hold about them. Opening a person's page is recorded in the
 * compliance log (server/records/accounts.ts).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

async function call<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { "x-admin-token": token } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || json?.message || `Request failed (${res.status})`);
  return json as T;
}
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const when = (d?: string | null) => (d ? new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

interface Summary { total: number; last7: number; last14: number; last30: number; byDay: { day: string; n: number }[]; funnel: { with_wallet: number; accepted_terms: number; active7: number } }

export function AccountsSection({ token }: { token: string }) {
  const [days, setDays] = useState(14);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const summary = useQuery({ queryKey: ["acc-summary", days], queryFn: () => call<Summary>(`/api/admin/records/accounts/summary?days=${days}`, token) });
  const list = useQuery({ queryKey: ["acc-list", search], queryFn: () => call<{ accounts: any[] }>(`/api/admin/records/accounts?search=${encodeURIComponent(search)}`, token) });
  const s = summary.data;
  const max = Math.max(1, ...(s?.byDay ?? []).map((d) => d.n));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[["All accounts", s?.total], ["Last 7 days", s?.last7], ["Last 14 days", s?.last14], ["Last 30 days", s?.last30], ["Created a wallet", s?.funnel.with_wallet], ["Signed in, last 7 days", s?.funnel.active7]].map(([k, v]) => (
          <Card key={String(k)}><CardContent className="p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-xl font-semibold">{v ?? "…"}</div></CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Sign-ups per day</CardTitle>
          <div className="flex gap-1">{[14, 30, 90].map((d) => <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>{d} days</Button>)}</div>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-28">
            {(s?.byDay ?? []).map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.day}: ${d.n}`}>
                <div className="text-[10px] text-muted-foreground">{d.n || ""}</div>
                <div className="w-full rounded-t bg-blue-600" style={{ height: `${(d.n / max) * 100}%`, minHeight: d.n ? 2 : 0 }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>{s?.byDay[0]?.day}</span><span>{s?.byDay[s.byDay.length - 1]?.day}</span></div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Accounts</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Search by email, name, id or wallet address" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-[560px] overflow-auto text-sm">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 text-xs text-muted-foreground py-1 border-b"><span>Person</span><span>Signed up</span><span>Wallet</span></div>
              {(list.data?.accounts ?? []).map((a) => (
                <button key={a.id} className={`w-full grid grid-cols-[1fr_auto_auto] gap-2 text-left py-1.5 border-b hover:bg-muted ${open === a.id ? "bg-muted" : ""}`} onClick={() => setOpen(a.id)}>
                  <span className="min-w-0"><span className="font-medium">{a.name || a.email || `Account ${a.id}`}</span><span className="block text-xs text-muted-foreground truncate">{a.email} · #{a.id}{a.businesses ? ` · ${a.businesses} business` : ""}</span></span>
                  <span className="text-xs">{day(a.created_at)}</span>
                  <span className="text-xs">{a.wallet ? short(a.wallet) : <span className="text-muted-foreground">None yet</span>}</span>
                </button>
              ))}
              {list.data && !list.data.accounts.length && <div className="text-muted-foreground py-4">No accounts match.</div>}
            </div>
          </CardContent>
        </Card>
        {open && <AccountDetail token={token} id={open} />}
      </div>
    </div>
  );
}

function AccountDetail({ token, id }: { token: string; id: number }) {
  const d = useQuery({ queryKey: ["acc-detail", id], queryFn: () => call<any>(`/api/admin/records/accounts/${id}`, token) });
  if (d.isLoading) return <Card><CardContent className="p-4 text-sm">Loading…</CardContent></Card>;
  if (d.error) return <Card><CardContent className="p-4 text-sm text-red-700">{(d.error as Error).message}</CardContent></Card>;
  const x = d.data;
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-3 py-0.5"><span className="text-muted-foreground">{k}</span><span className="text-right break-all">{v}</span></div>;
  const Block = ({ title, children, empty }: { title: string; children: React.ReactNode; empty: boolean }) => (
    <div className="pt-2"><div className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">{title}</div>{empty ? <div className="text-muted-foreground text-xs">None</div> : children}</div>
  );
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{x.account.name || x.account.email}</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-1">
        <Row k="Email" v={x.account.email} />
        <Row k="Account id" v={`#${x.account.id}`} />
        <Row k="Signed up" v={when(x.account.created_at)} />
        <Row k="Last sign-in" v={when(x.sessions[0]?.created_at) || "Never"} />
        <Block title="Wallets" empty={!x.wallets.length}>{x.wallets.map((w: any) => <Row key={w.address} k={`${w.network_key} · ${w.account_type ?? w.wallet_provider}`} v={<code className="text-xs">{w.address}</code>} />)}</Block>
        <Block title="Passkeys" empty={!x.passkeys.length}>{x.passkeys.map((p: any) => <Row key={p.id} k="Added" v={when(p.created_at)} />)}</Block>
        <Block title="Identity check" empty={!x.kyc.length}>{x.kyc.map((k: any) => <Row key={k.wallet_address} k={`Tier ${k.kyc_tier ?? 0}`} v={`${k.kyc_status ?? "not started"}${k.country ? ` · ${k.country}` : ""}`} />)}</Block>
        <Block title="Terms and privacy" empty={!x.terms.length}>{x.terms.map((t: any, i: number) => <Row key={i} k={`${t.document} ${t.version}`} v={`${when(t.accepted_at)}${t.ip ? ` · ${t.ip}` : ""}`} />)}</Block>
        <Block title="Businesses" empty={!x.businesses.length}>{x.businesses.map((b: any) => <Row key={b.id} k={b.name} v={`${b.role} · ${b.status}`} />)}</Block>
        <Block title="Complaints" empty={!x.complaints.length}>{x.complaints.map((c: any) => <Row key={c.id} k={`#${c.id} ${c.subject}`} v={`${c.status} · ${day(c.received_at)}`} />)}</Block>
        <Block title="Deletion requests" empty={!x.deletion.length}>{x.deletion.map((r: any) => <Row key={r.id} k={`#${r.id}`} v={`${r.status} · ${day(r.requested_at)}`} />)}</Block>
        <Block title="Recent activity in the audit log" empty={!x.activity.length}>
          <div className="max-h-48 overflow-auto">{x.activity.map((a: any) => <Row key={a.id} k={a.action} v={when(a.at)} />)}</div>
        </Block>
        <div className="text-xs text-muted-foreground pt-2">Opening this page is recorded in the audit log.</div>
      </CardContent>
    </Card>
  );
}
