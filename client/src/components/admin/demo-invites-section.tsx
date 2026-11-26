/**
 * Admin: testnet invitation links for outside reviewers (server/demo-invites).
 * Create a link with a name, a lifetime, how many reviewers it admits and how much test USDC
 * each wallet gets; copy it once; revoke it at any time.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Copy, Link2, Loader2 } from "lucide-react";
import { adminCall as api } from "@/lib/admin-api";

interface Invite {
  id: number; label: string; created_at: string; expires_at: string; revoked_at: string | null; max_accounts: number;
  fund_usdc: string; country: string; note: string | null; used: number; state: "active" | "expired" | "revoked" | "full";
  accounts: { user_id: number; name: string | null; created_at: string; funded_at: string | null; fund_tx: string | null }[];
}

const STATE: Record<Invite["state"], { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-green-100 text-green-800" },
  full: { label: "All places taken", cls: "bg-amber-100 text-amber-800" },
  expired: { label: "Expired", cls: "bg-gray-100 text-gray-600" },
  revoked: { label: "Revoked", cls: "bg-red-100 text-red-700" },
};
const day = (s: string) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function DemoInvitesSection({ token }: { token: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ label: "", days: "30", maxAccounts: "5", fundUsdc: "10000", country: "US", note: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["/api/admin/demo-invites"], queryFn: () => api("/api/admin/demo-invites", token) as Promise<{ invites: Invite[] }>, retry: false });

  const create = async () => {
    setBusy("create");
    try {
      const r = await api("/api/admin/demo-invites", token, {
        label: form.label, days: Number(form.days), maxAccounts: Number(form.maxAccounts), fundUsdc: Number(form.fundUsdc), country: form.country, note: form.note,
      });
      setLink(r.link);
      setForm((f) => ({ ...f, label: "", note: "" }));
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/demo-invites"] });
    } catch (e) {
      toast({ title: "Could not create the invitation", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const revoke = async (i: Invite) => {
    if (!window.confirm(`Revoke the invitation for ${i.label}? Its reviewers will be signed out and cannot sign in again.`)) return;
    setBusy(`revoke-${i.id}`);
    try {
      const r = await api(`/api/admin/demo-invites/${i.id}/revoke`, token, {});
      toast({ title: "Invitation revoked", description: `${r.sessionsEnded} open session(s) ended.` });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/demo-invites"] });
    } catch (e) {
      toast({ title: "Could not revoke", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); toast({ title: "Link copied" }); } catch { /* the link is shown to select by hand */ }
  };

  const field = (key: keyof typeof form, label: string, props: Record<string, unknown> = {}) => (
    <label className="text-sm space-y-1">
      <span className="text-gray-600">{label}</span>
      <Input value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} {...props} />
    </label>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Invitations</h2>
        <p className="text-sm text-gray-500 mt-1">
          Testnet links for outside reviewers: a partner, an investor, a platform evaluating BlockFinaX. Each reviewer creates
          their own passkey and wallet, gets test USDC, and can use cover, perps and Swap. No admin access, no access to other users.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {field("label", "Who it is for", { placeholder: "TradingView" })}
            {field("days", "Days it lasts (1 to 90)", { inputMode: "numeric" })}
            {field("maxAccounts", "Reviewers it admits (1 to 50)", { inputMode: "numeric" })}
            {field("fundUsdc", "Test USDC per wallet", { inputMode: "numeric" })}
            {field("country", "Reviewers' country (two letters)", { maxLength: 2 })}
            {field("note", "Note (only you see it)")}
          </div>
          <Button onClick={create} disabled={busy === "create" || form.label.trim().length < 2}>
            {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}Create invitation link
          </Button>
          {link && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
              <p className="text-sm font-medium text-green-900">Copy this link now. For security it is shown only once.</p>
              <div className="flex gap-2">
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                <Button variant="outline" onClick={copy}><Copy className="h-4 w-4 mr-1" />Copy</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {list.isLoading && <Loader2 className="h-5 w-5 animate-spin text-gray-400" />}
      {list.error && <p className="text-sm text-gray-500">Invitations are only available on testnet.</p>}
      <div className="space-y-3">
        {(list.data?.invites ?? []).map((i) => (
          <Card key={i.id}>
            <CardContent className="pt-5 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <b>{i.label}</b>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATE[i.state].cls}`}>{STATE[i.state].label}</span>
                <span className="text-xs text-gray-500">
                  {i.used} of {i.max_accounts} reviewers, {Number(i.fund_usdc).toLocaleString("en-US")} test USDC each, until {day(i.expires_at)}
                </span>
                {!i.revoked_at && (
                  <Button size="sm" variant="outline" className="ml-auto text-red-600" disabled={busy === `revoke-${i.id}`} onClick={() => revoke(i)}>
                    {busy === `revoke-${i.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : "Revoke"}
                  </Button>
                )}
              </div>
              {i.note && <p className="text-xs text-gray-500">{i.note}</p>}
              {i.accounts.length > 0 && (
                <ul className="text-xs text-gray-600 space-y-0.5">
                  {i.accounts.map((a) => (
                    <li key={a.user_id}>
                      {a.name ?? `User ${a.user_id}`}, joined {day(a.created_at)}, {a.funded_at ? (a.fund_tx ? "funded" : "funding") : "not funded yet"}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
