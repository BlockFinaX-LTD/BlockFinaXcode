/**
 * OTC: the BlockFinaX side of the OTC escrow (server/otc).
 *
 *   Merchants   applications; approving one registers the wallet on chain with the
 *               arbiter key, removing one stops new offers
 *   Orders      live orders and disputes; open one to see the proof, the messages and the
 *               on-chain state, then release the USDC to the payer or refund it
 *
 * A ruling can only pay the order to the person who paid in local currency, or return it.
 * The escrow allows nothing else.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, FileText, Loader2, Scale, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeMethod, localAmount, type PaymentMethod } from "@shared/otc";

async function api(url: string, token: string, body?: unknown) {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || json?.message || `Request failed (${res.status})`);
  return json;
}

const TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800", approved: "bg-green-100 text-green-800", declined: "bg-gray-200 text-gray-700", removed: "bg-gray-200 text-gray-700",
  open: "bg-amber-100 text-amber-800", paid: "bg-blue-100 text-blue-800", disputed: "bg-red-100 text-red-800", released: "bg-green-100 text-green-800",
  cancelled: "bg-gray-200 text-gray-700", resolved_released: "bg-green-100 text-green-800", resolved_refunded: "bg-gray-200 text-gray-700",
};
const Pill = ({ s }: { s: string }) => <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-medium", TONE[s] ?? "bg-gray-100 text-gray-700")}>{s.replace("_", " ")}</span>;
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const short = (a: string) => `${a.slice(0, 5)}...${a.slice(-4)}`;

export function OtcSection({ token }: { token: string }) {
  const [tab, setTab] = useState<"merchants" | "orders">("orders");
  const [open, setOpen] = useState<number | null>(null);
  if (open !== null) return <OrderReview token={token} id={open} onBack={() => setOpen(null)} />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">OTC</h1>
        <p className="text-sm text-gray-500">Approved merchants trading USDC for local currency, with the USDC held in escrow on Stellar.</p>
      </div>
      <div className="flex gap-2">
        <Button variant={tab === "orders" ? "default" : "outline"} size="sm" onClick={() => setTab("orders")}><Scale className="h-4 w-4 mr-1" />Orders and disputes</Button>
        <Button variant={tab === "merchants" ? "default" : "outline"} size="sm" onClick={() => setTab("merchants")}><Store className="h-4 w-4 mr-1" />Merchants</Button>
      </div>
      {tab === "orders" ? <Orders token={token} onOpen={setOpen} /> : <Merchants token={token} />}
    </div>
  );
}

function Merchants({ token }: { token: string }) {
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["admin-otc-merchants", token], queryFn: () => api("/api/v2/admin/otc/merchants", token) });
  const [busy, setBusy] = useState<number | null>(null);
  async function decide(userId: number, decision: "approve" | "decline" | "remove") {
    const note = decision === "approve" ? "" : prompt(decision === "decline" ? "Why not? (kept internal)" : "Why remove them? (kept internal)") ?? "";
    setBusy(userId);
    try {
      await api(`/api/v2/admin/otc/merchants/${userId}`, token, { decision, note });
      toast({ title: decision === "approve" ? "Merchant approved on chain" : decision === "decline" ? "Application declined" : "Merchant removed" });
      void queryClient.invalidateQueries({ queryKey: ["admin-otc-merchants"] });
    } catch (e) {
      toast({ title: "Not done", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(null); }
  }
  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-gray-400" />;
  if (q.error) return <p className="text-sm text-red-600">{(q.error as Error).message}</p>;
  const merchants = q.data.merchants as any[];
  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        {!q.data.arbiter && <p className="p-4 text-sm text-red-600">OTC_ARBITER_SECRET is not set on this server, so approvals and rulings cannot be sent.</p>}
        {!merchants.length ? <p className="p-6 text-sm text-gray-500">No applications yet. Users apply under OTC, Merchant, in the app.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500"><tr><th className="p-3">Merchant</th><th className="p-3">Currencies</th><th className="p-3">Payment details</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody>
              {merchants.map((m) => (
                <tr key={m.userId} className="border-t align-top">
                  <td className="p-3"><div className="font-medium">{m.displayName}</div><div className="text-xs text-gray-500">User {m.userId} · {short(m.wallet)} · applied {when(m.appliedAt)}</div>{m.about && <div className="text-xs text-gray-600 mt-1 max-w-xs">{m.about}</div>}</td>
                  <td className="p-3">{m.markets.join(", ")}</td>
                  <td className="p-3 text-xs whitespace-pre-wrap max-w-xs">{Object.entries(m.paymentDetails as Record<string, PaymentMethod[]>).flatMap(([c, list]) => (Array.isArray(list) ? list : []).map((d) => `${c}: ${describeMethod(d)}`)).join("\n") || "None"}</td>
                  <td className="p-3"><Pill s={m.status} />{m.note && <div className="text-xs text-gray-500 mt-1">{m.note}</div>}</td>
                  <td className="p-3 whitespace-nowrap space-x-2">
                    {(m.status === "pending" || m.status === "declined" || m.status === "removed") && <Button size="sm" disabled={busy !== null} onClick={() => decide(m.userId, "approve")}>{busy === m.userId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}</Button>}
                    {m.status === "pending" && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => decide(m.userId, "decline")}>Decline</Button>}
                    {m.status === "approved" && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => decide(m.userId, "remove")}>Remove</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function Orders({ token, onOpen }: { token: string; onOpen: (id: number) => void }) {
  const [filter, setFilter] = useState<"disputed" | "active" | "all">("disputed");
  const q = useQuery({ queryKey: ["admin-otc-orders", token, filter], queryFn: () => api(`/api/v2/admin/otc/orders?filter=${filter}`, token), refetchInterval: 30_000 });
  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <div className="flex gap-2 p-3 border-b">
          {(["disputed", "active", "all"] as const).map((f) => <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>{f === "disputed" ? "Disputes" : f === "active" ? "In progress" : "All"}</Button>)}
        </div>
        {q.isLoading ? <div className="p-4"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div> : q.error ? <p className="p-4 text-sm text-red-600">{(q.error as Error).message}</p> : !(q.data.orders as any[]).length ? <p className="p-6 text-sm text-gray-500">Nothing here.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500"><tr><th className="p-3">Order</th><th className="p-3">Merchant</th><th className="p-3">Amount</th><th className="p-3">Opened</th><th className="p-3">Status</th></tr></thead>
            <tbody>
              {(q.data.orders as any[]).map((o) => (
                <tr key={o.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => onOpen(o.id)}>
                  <td className="p-3 font-medium">#{o.id} · merchant {o.side === "sell" ? "sells" : "buys"}</td>
                  <td className="p-3">{o.merchant.name}</td>
                  <td className="p-3">{Number(o.amount).toLocaleString()} USDC · {Number(o.localAmount).toLocaleString()} {o.currency}</td>
                  <td className="p-3">{when(o.openedAt)}</td>
                  <td className="p-3"><Pill s={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function OrderReview({ token, id, onBack }: { token: string; id: number; onBack: () => void }) {
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["admin-otc-order", token, id], queryFn: () => api(`/api/v2/admin/otc/orders/${id}`, token) });
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["admin-otc-order"] }); void queryClient.invalidateQueries({ queryKey: ["admin-otc-orders"] }); };

  async function rule(releaseToReceiver: boolean) {
    if (!confirm(releaseToReceiver ? "Release the USDC to the person who paid in local currency?" : "Return the USDC to where it came from?")) return;
    setBusy(true);
    try {
      await api(`/api/v2/admin/otc/orders/${id}/resolve`, token, { releaseToReceiver, note });
      toast({ title: "Ruling sent on chain" });
      refresh();
    } catch (e) {
      toast({ title: "Ruling not sent", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  }
  async function viewProof() {
    const res = await fetch(`/api/v2/admin/otc/orders/${id}/proof`, { headers: { "x-admin-token": token } });
    if (!res.ok) { toast({ title: "No proof uploaded", variant: "destructive" }); return; }
    window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
  }
  async function send() {
    if (!message.trim()) return;
    await api(`/api/v2/admin/otc/orders/${id}/messages`, token, { body: message });
    setMessage("");
    refresh();
  }

  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-gray-400" />;
  if (q.error) return <p className="text-sm text-red-600">{(q.error as Error).message}</p>;
  const o = q.data.order;
  const payer = o.usdcTo, holder = o.usdcFrom;
  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
      <Card><CardContent className="p-5 space-y-2 text-sm">
        <div className="flex items-center gap-3"><h2 className="text-xl font-bold">Order #{o.id}</h2><Pill s={o.status} /></div>
        <p>Merchant <b>{o.merchant.name}</b> {o.side === "sell" ? "sells" : "buys"} <b>{o.amount} USDC</b> at {o.rate} {o.currency}, so <b>{localAmount(o.amount, o.rate)} {o.currency}</b> is owed.</p>
        <p>Pays in {o.currency} and receives the USDC: <code>{short(payer)}</code>{payer === o.merchant.wallet ? " (merchant)" : " (user)"}. Holds the USDC in escrow: <code>{short(holder)}</code>{holder === o.merchant.wallet ? " (merchant)" : " (user)"}.</p>
        <p>Opened {when(o.openedAt)} · pay by {when(o.payBy)} · marked paid {when(o.paidAt) || "no"}</p>
        <p className="whitespace-pre-wrap">Payment was to go to: {o.payTo ? describeMethod(o.payTo) : "not recorded"}</p>
        {o.hasProof && <Button size="sm" variant="outline" onClick={viewProof}><FileText className="h-4 w-4 mr-1" />See the payment proof</Button>}
      </CardContent></Card>
      {o.dispute && (
        <Card><CardContent className="p-5 space-y-3 text-sm">
          <h3 className="font-semibold">Dispute opened by {o.dispute.openedBy === o.merchant.wallet ? "the merchant" : "the user"}</h3>
          <p className="whitespace-pre-wrap">{o.dispute.reason}</p>
          {o.dispute.outcome ? <p>Ruled: <b>{o.dispute.outcome}</b>. {o.dispute.note}</p> : o.status === "disputed" && (
            <>
              <p className="text-gray-600">Check the proof against the receiving account's statement before ruling. Ask both sides for evidence in the messages below.</p>
              <Textarea placeholder="Why (both sides will read this)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button disabled={busy || note.trim().length < 5} onClick={() => rule(true)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Payment arrived: release to payer"}</Button>
                <Button variant="outline" disabled={busy || note.trim().length < 5} onClick={() => rule(false)}>No payment: refund</Button>
              </div>
            </>
          )}
        </CardContent></Card>
      )}
      <Card><CardContent className="p-5 space-y-2 text-sm">
        <h3 className="font-semibold">Messages</h3>
        {(q.data.messages as any[]).map((m) => <div key={m.id} className="border-t pt-2"><div className="text-xs text-gray-500">{m.from} · {when(m.createdAt)}</div><div className="whitespace-pre-wrap">{m.body}</div></div>)}
        <div className="flex gap-2 pt-2"><Textarea placeholder="Message both sides as BlockFinaX" value={message} onChange={(e) => setMessage(e.target.value)} /><Button onClick={send}>Send</Button></div>
      </CardContent></Card>
    </div>
  );
}
