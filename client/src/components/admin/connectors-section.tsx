/**
 * Connectors — the admin side of the connector portal (server/connectors).
 *
 *   Members        applications and members; open one to approve, record
 *                  rewards and payments, and offer contractor engagements
 *   Registrations  prospects waiting for a decision, across all members
 *   Offers         opportunities posted to the portal's offers board, and who is interested
 *
 * Approving a registration sends the member their Approval Notice by email. Marking it
 * live starts the 12-month reward period.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Users, ClipboardList, AlertTriangle, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { AREAS, LEDGER_LABELS, MODULES, areaByKey, type LedgerKind } from "@shared/connector-programme";

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

const usd = (n: number) => `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const thisQuarter = () => { const d = new Date(); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };

const STATUS_TONE: Record<string, string> = {
  applied: "bg-amber-100 text-amber-800", active: "bg-green-100 text-green-800", paused: "bg-gray-200 text-gray-700",
  ended: "bg-gray-200 text-gray-700", declined: "bg-gray-200 text-gray-700",
  pending: "bg-amber-100 text-amber-800", approved: "bg-blue-100 text-blue-800", live: "bg-green-100 text-green-800", closed: "bg-gray-200 text-gray-700",
  offered: "bg-amber-100 text-amber-800", accepted: "bg-blue-100 text-blue-800", completed: "bg-green-100 text-green-800", cancelled: "bg-gray-200 text-gray-700",
  clear: "bg-green-100 text-green-800", hit: "bg-red-100 text-red-800", inconclusive: "bg-amber-100 text-amber-800",
};
function Pill({ s }: { s: string }) {
  return <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-medium", STATUS_TONE[s] ?? "bg-gray-100 text-gray-700")}>{s}</span>;
}

export function ConnectorsSection({ token }: { token: string }) {
  const [tab, setTab] = useState<"members" | "registrations" | "offers">("members");
  const [open, setOpen] = useState<number | null>(null);
  if (open !== null) return <MemberDetail token={token} userId={open} onBack={() => setOpen(null)} />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Connectors</h1>
        <p className="text-sm text-gray-500">Members of the Connector Programme and the introductions they register.</p>
      </div>
      <div className="flex gap-2">
        <Button variant={tab === "members" ? "default" : "outline"} size="sm" onClick={() => setTab("members")}><Users className="h-4 w-4 mr-1" />Members</Button>
        <Button variant={tab === "registrations" ? "default" : "outline"} size="sm" onClick={() => setTab("registrations")}><ClipboardList className="h-4 w-4 mr-1" />Registrations</Button>
        <Button variant={tab === "offers" ? "default" : "outline"} size="sm" onClick={() => setTab("offers")}><Megaphone className="h-4 w-4 mr-1" />Offers</Button>
      </div>
      {tab === "members" && <Members token={token} onOpen={setOpen} />}
      {tab === "registrations" && <RegistrationQueue token={token} onOpen={setOpen} />}
      {tab === "offers" && <Offers token={token} onOpen={setOpen} />}
    </div>
  );
}

function Members({ token, onOpen }: { token: string; onOpen: (id: number) => void }) {
  const q = useQuery({ queryKey: ["admin-connectors", token], queryFn: () => api("/api/v2/admin/connectors", token) });
  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-gray-400" />;
  if (q.error) return <p className="text-sm text-red-600">{(q.error as Error).message}</p>;
  const members = q.data.members as any[];
  if (!members.length) return <Card><CardContent className="p-6 text-sm text-gray-500">No applications yet. Members apply at connector.blockfinax.com.</CardContent></Card>;
  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500 border-b">
            <tr><th className="p-3">Member</th><th className="p-3">Kind</th><th className="p-3">Status</th><th className="p-3">Screening</th><th className="p-3">Training</th><th className="p-3">To do</th><th className="p-3 text-right">Owed</th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => onOpen(m.userId)}>
                <td className="p-3"><div className="font-medium">{m.fullName}</div><div className="text-xs text-gray-500">{m.organisation ? `${m.organisation} · ` : ""}{m.country} · {m.email}</div></td>
                <td className="p-3">{m.kind}</td>
                <td className="p-3"><Pill s={m.status} /></td>
                <td className="p-3"><Pill s={m.screening} /></td>
                <td className="p-3">{m.lessonsPassed} of {m.lessonsTotal}</td>
                <td className="p-3 text-xs">
                  {m.pending ? `${m.pending} to review` : <span className="text-gray-400">nothing</span>}
                </td>
                <td className="p-3 text-right tabular-nums">{usd(m.owed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function RegistrationQueue({ token, onOpen }: { token: string; onOpen: (id: number) => void }) {
  const [status, setStatus] = useState("pending");
  const q = useQuery({ queryKey: ["admin-connector-regs", token, status], queryFn: () => api(`/api/v2/admin/connector-registrations?status=${status}`, token) });
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {["pending", "approved", "live", "declined", "closed"].map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>{s}</Button>
        ))}
      </div>
      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : !(q.data?.registrations as any[])?.length ? (
        <Card><CardContent className="p-6 text-sm text-gray-500">Nothing {status}.</CardContent></Card>
      ) : (q.data.registrations as any[]).map((r) => <RegistrationCard key={r.id} token={token} r={r} onOpenMember={() => onOpen(r.userId)} />)}
    </div>
  );
}

function RegistrationCard({ token, r, onOpenMember }: { token: string; r: any; onOpenMember?: () => void }) {
  const { toast } = useToast();
  const area = areaByKey(r.area);
  const [terms, setTerms] = useState(r.rewardTerms ?? area?.reward ?? "");
  const [bonus, setBonus] = useState(r.bonusUsd ?? "");
  const [counts, setCounts] = useState<boolean>(r.countsForReview ?? !!area?.revenueShare);
  const [note, setNote] = useState("");
  const [firstRevenue, setFirstRevenue] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const decide = async (status: string) => {
    setBusy(true);
    try {
      await api(`/api/v2/admin/connector-registrations/${r.id}/decide`, token, { status, rewardTerms: terms, bonusUsd: bonus === "" ? null : Number(bonus), countsForReview: counts, note, periodStart: firstRevenue });
      toast({ title: `Marked ${status}`, description: "The member has been emailed." });
      await queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("admin-connector") });
    } catch (e) { toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold">{r.organisation} <span className="text-gray-500 font-normal">· {area?.label} · {r.country}</span></div>
            <div className="text-xs text-gray-500">
              {r.memberName && <>By {onOpenMember ? <button className="underline" onClick={onOpenMember}>{r.memberName}</button> : r.memberName} · </>}
              {r.contactName}{r.contactRole ? `, ${r.contactRole}` : ""}{r.contactEmail ? ` · ${r.contactEmail}` : ""}{r.website ? ` · ${r.website}` : ""} · {day(r.createdAt)}
            </div>
          </div>
          <Pill s={r.status} />
        </div>
        <p className="text-sm">{r.need}</p>
        {r.conflictWith === "existing_customer" && (
          <p className="text-sm text-amber-700 flex gap-2 items-center"><AlertTriangle className="h-4 w-4" />Matches an existing BlockFinaX customer. Clause 3.3: it does not qualify unless you agree otherwise.</p>
        )}
        {r.periodEnd && <p className="text-xs text-gray-500">Reward period {day(r.periodStart)} to {day(r.periodEnd)}</p>}
        {r.status !== "declined" && r.status !== "closed" && (
          <div className="grid md:grid-cols-2 gap-2">
            <Input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Reward terms" aria-label="Reward terms" />
            <Input value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="Bonus in US dollars, if any" aria-label="Bonus" inputMode="decimal" />
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the member (shown to them)" aria-label="Note" />
            {r.status === "approved" && (
              <label className="flex items-center gap-2 text-sm">First revenue date <Input type="date" className="w-auto" value={firstRevenue} onChange={(e) => setFirstRevenue(e.target.value)} /></label>
            )}
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          {r.status === "pending" && <>
            <Button size="sm" disabled={busy} onClick={() => decide("approved")}>Approve</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("declined")}>Decline</Button>
          </>}
          {r.status === "approved" && <Button size="sm" disabled={busy} onClick={() => decide("live")}>Mark live (first revenue)</Button>}
          {(r.status === "approved" || r.status === "live") && <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("closed")}>Close</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

function MemberDetail({ token, userId, onBack }: { token: string; userId: number; onBack: () => void }) {
  const { toast } = useToast();
  const key = ["admin-connector", token, userId];
  const q = useQuery({ queryKey: key, queryFn: () => api(`/api/v2/admin/connectors/${userId}`, token) });
  const [busy, setBusy] = useState(false);
  const [statusNote, setStatusNote] = useState("");
  const [line, setLine] = useState({ kind: "revenue_share" as LedgerKind, quarter: thisQuarter(), amountUsd: "", registrationId: "", note: "", reference: "" });
  const [eng, setEng] = useState({ title: "", scope: "", feeTerms: "", startsOn: "", endsOn: "" });

  const run = async (url: string, body: unknown, done: string) => {
    setBusy(true);
    try {
      await api(url, token, body);
      toast({ title: done });
      await queryClient.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith("admin-connector") });
      return true;
    } catch (e) { toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" }); return false; }
    finally { setBusy(false); }
  };

  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-gray-400" />;
  if (q.error) return <p className="text-sm text-red-600">{(q.error as Error).message}</p>;
  const d = q.data;
  const m = d.member;
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />All members</Button>
      <div className="flex gap-3 items-center flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">{m.fullName}</h1><Pill s={m.status} /><Pill s={m.screening} />
        <span className="text-sm text-gray-500">{m.kind} · {m.email} · {m.country}{m.referralCode ? ` · code ${m.referralCode}` : ""}</span>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Membership</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {m.organisation && <p><b>Organisation:</b> {m.organisation}</p>}
          {m.markets && <p><b>Markets:</b> {m.markets}</p>}
          <p><b>Areas:</b> {(m.areas as string[]).map((a) => areaByKey(a)?.label ?? a).join(", ")}</p>
          {m.about && <p className="whitespace-pre-wrap"><b>Background:</b> {m.about}</p>}
          {m.payoutDetails && <p className="whitespace-pre-wrap"><b>Payout details:</b> {m.payoutDetails}</p>}
          {m.screening === "hit" && <p className="text-red-700">Possible sanctions match. Review the alert in Compliance before approving.</p>}
          {d.missing.length > 0 && <p className="text-gray-500">Still to do: {d.missing.join("; ")}</p>}
          <Input value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="Internal note (not shown to the member)" aria-label="Internal note" />
          <div className="flex gap-2 flex-wrap">
            {m.status !== "active" && <Button size="sm" disabled={busy} onClick={() => run(`/api/v2/admin/connectors/${userId}/status`, { status: "active", note: statusNote }, "Member approved and emailed")}>Approve</Button>}
            {m.status === "active" && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(`/api/v2/admin/connectors/${userId}/status`, { status: "paused", note: statusNote }, "Paused")}>Pause</Button>}
            {m.status === "applied" && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(`/api/v2/admin/connectors/${userId}/status`, { status: "declined", note: statusNote }, "Declined")}>Decline</Button>}
            {(m.status === "active" || m.status === "paused") && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(`/api/v2/admin/connectors/${userId}/status`, { status: "ended", note: statusNote }, "Ended")}>End membership</Button>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Terms and training</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!d.signatures.length && <p className="text-gray-500">Terms not accepted yet.</p>}
          {d.signatures.map((s: any) => (
            <div key={s.id} className="flex justify-between gap-3 flex-wrap border-b pb-2">
              <span>Accepted by {s.typedName} · {s.document === "contractor" ? "Contractor Terms" : "Connector Programme Terms"} {s.version} · {new Date(s.signedAt).toUTCString()}{s.binding ? "" : " · test acceptance"}
                <br /><span className="text-xs text-gray-400 break-all">SHA-256 {s.hash}</span></span>
            </div>
          ))}
          <p className="pt-2">
            Training: {MODULES.map((mod) => {
              const l = d.lessons.find((x: any) => x.id === mod.id);
              return `${mod.title} ${l ? (l.passed ? "passed" : `${Math.round(l.score * 100)}%, ${l.attempts} tries`) : "not started"}`;
            }).join(" · ")}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="font-semibold">Registrations</h2>
        {!d.registrations.length ? <p className="text-sm text-gray-500">None yet.</p> : d.registrations.map((r: any) => <RegistrationCard key={r.id} token={token} r={r} />)}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Referrals ({d.referrals.length})</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          {!d.referrals.length ? <p className="text-gray-500">None yet.</p> : d.referrals.map((r: any) => (
            <div key={r.id} className="flex justify-between border-b py-1">
              <span>User {r.id} · {r.name ?? "no name"} · {r.email} · joined {day(r.joinedAt)}</span>
              <span className="tabular-nums">{r.contracts} contracts · est. {usd(r.estimatedShare)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Rewards ledger · earned {usd(d.statement.earned)} · paid {usd(d.statement.paid)} · owed {usd(d.statement.owed)}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {d.ledger.map((l: any) => (
            <div key={l.id} className="flex justify-between border-b py-1 gap-3">
              <span>{LEDGER_LABELS[l.kind as LedgerKind]} · {l.quarter}{l.note ? ` · ${l.note}` : ""}{l.reference ? ` · ${l.reference}` : ""} <span className="text-xs text-gray-400">by {l.createdBy}</span></span>
              <span className="tabular-nums">{usd(l.amountUsd)}</span>
            </div>
          ))}
          <div className="grid md:grid-cols-3 gap-2 pt-2">
            <select className="border rounded-md px-2 py-2 text-sm" aria-label="Line kind" value={line.kind} onChange={(e) => setLine({ ...line, kind: e.target.value as LedgerKind })}>
              {(Object.keys(LEDGER_LABELS) as LedgerKind[]).map((k) => <option key={k} value={k}>{LEDGER_LABELS[k]}</option>)}
            </select>
            <Input value={line.quarter} onChange={(e) => setLine({ ...line, quarter: e.target.value })} placeholder="2027-Q1" aria-label="Quarter" />
            <Input value={line.amountUsd} onChange={(e) => setLine({ ...line, amountUsd: e.target.value })} placeholder="Amount in US dollars" aria-label="Amount" inputMode="decimal" />
            <select className="border rounded-md px-2 py-2 text-sm" aria-label="Registration" value={line.registrationId} onChange={(e) => setLine({ ...line, registrationId: e.target.value })}>
              <option value="">No specific registration</option>
              {d.registrations.filter((r: any) => r.status === "approved" || r.status === "live").map((r: any) => <option key={r.id} value={r.id}>{r.organisation}</option>)}
            </select>
            <Input value={line.note} onChange={(e) => setLine({ ...line, note: e.target.value })} placeholder="Note shown to the member" aria-label="Note" />
            <Input value={line.reference} onChange={(e) => setLine({ ...line, reference: e.target.value })} placeholder="Payment reference or transaction" aria-label="Reference" />
          </div>
          <Button size="sm" disabled={busy || !line.amountUsd} onClick={async () => {
            if (await run(`/api/v2/admin/connectors/${userId}/ledger`, { ...line, amountUsd: Number(line.amountUsd) }, "Recorded")) setLine({ ...line, amountUsd: "", note: "", reference: "" });
          }}>Record line</Button>
        </CardContent>
      </Card>

      {m.kind === "contractor" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Engagements</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {d.engagements.map((e: any) => (
              <div key={e.id} className="border-b pb-2 space-y-1">
                <div className="flex justify-between gap-2"><b>{e.title}</b><Pill s={e.status} /></div>
                <p className="whitespace-pre-wrap text-gray-600">{e.scope}</p>
                <p>Fees: {e.feeTerms}{e.acceptedName ? ` · accepted by ${e.acceptedName} on ${day(e.acceptedAt)}` : ""}</p>
                {(e.status === "offered" || e.status === "accepted") && (
                  <div className="flex gap-2">
                    {e.status === "accepted" && <Button size="sm" disabled={busy} onClick={() => run(`/api/v2/admin/connector-engagements/${e.id}/status`, { status: "completed" }, "Completed")}>Mark completed</Button>}
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(`/api/v2/admin/connector-engagements/${e.id}/status`, { status: "cancelled" }, "Cancelled")}>Cancel</Button>
                  </div>
                )}
              </div>
            ))}
            <div className="grid gap-2 pt-2">
              <Input value={eng.title} onChange={(e) => setEng({ ...eng, title: e.target.value })} placeholder="Title, for example: Lagos importer workshop" aria-label="Engagement title" />
              <Textarea value={eng.scope} onChange={(e) => setEng({ ...eng, scope: e.target.value })} placeholder="Scope of work and deliverables" aria-label="Scope" rows={4} />
              <Input value={eng.feeTerms} onChange={(e) => setEng({ ...eng, feeTerms: e.target.value })} placeholder="Fees, for example: US$800 fixed, invoiced on completion" aria-label="Fees" />
              <div className="flex gap-2 items-center text-sm flex-wrap">Starts <Input type="date" className="w-auto" value={eng.startsOn} onChange={(e) => setEng({ ...eng, startsOn: e.target.value })} />
                Ends <Input type="date" className="w-auto" value={eng.endsOn} onChange={(e) => setEng({ ...eng, endsOn: e.target.value })} /></div>
            </div>
            <Button size="sm" disabled={busy} onClick={async () => {
              if (await run(`/api/v2/admin/connectors/${userId}/engagements`, eng, "Engagement offered and emailed")) setEng({ title: "", scope: "", feeTerms: "", startsOn: "", endsOn: "" });
            }}>Offer engagement</Button>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-gray-400">Areas available: {AREAS.length}. Approval emails are the member's Approval Notice under the Connector Programme Terms.</p>
    </div>
  );
}

const EMPTY_OFFER = { title: "", summary: "", details: "", reward: "", area: "", country: "", audience: "all", closesOn: "", notify: true };

function Offers({ token, onOpen }: { token: string; onOpen: (id: number) => void }) {
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["admin-connector-offers", token], queryFn: () => api("/api/v2/admin/connector-offers", token) });
  const [form, setForm] = useState({ ...EMPTY_OFFER });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (url: string, body: unknown, done: string) => {
    setBusy(true);
    try {
      const r = await api(url, token, body);
      toast({ title: done, description: typeof r?.emailed === "number" && r.emailed ? `Emailed ${r.emailed} member${r.emailed === 1 ? "" : "s"}.` : undefined });
      await queryClient.invalidateQueries({ queryKey: ["admin-connector-offers", token] });
      return true;
    } catch (e) { toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" }); return false; }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      {!adding ? <Button size="sm" onClick={() => setAdding(true)}>Post an offer</Button> : (
        <Card>
          <CardHeader><CardTitle className="text-base">New offer</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title, for example: Introduction to a Kenyan commercial bank" aria-label="Title" />
            <Input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="One-line summary shown on the board" aria-label="Summary" />
            <Textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Details: what you need, who fits, what happens next" aria-label="Details" rows={4} />
            <Input value={form.reward} onChange={(e) => setForm({ ...form, reward: e.target.value })} placeholder="Reward, for example: US$1,000 bonus when the bank is live, plus 25% revenue share" aria-label="Reward" />
            <div className="grid md:grid-cols-4 gap-2">
              <select className="border rounded-md px-2 py-2 text-sm" aria-label="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
                <option value="">Any area</option>
                {AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
              <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase().slice(0, 2) })} placeholder="Country code, e.g. KE" aria-label="Country" />
              <select className="border rounded-md px-2 py-2 text-sm" aria-label="Audience" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                <option value="all">Everyone</option><option value="connector">Connectors</option><option value="contractor">Contractors</option>
              </select>
              <label className="flex items-center gap-2 text-sm">Closes <Input type="date" className="w-auto" value={form.closesOn} onChange={(e) => setForm({ ...form, closesOn: e.target.value })} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} />Email active members it is for</label>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={async () => { if (await run("/api/v2/admin/connector-offers", form, "Offer posted")) { setForm({ ...EMPTY_OFFER }); setAdding(false); } }}>Post offer</Button>
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : !(q.data?.offers as any[])?.length ? (
        <Card><CardContent className="p-6 text-sm text-gray-500">No offers yet.</CardContent></Card>
      ) : (q.data.offers as any[]).map((o) => (
        <Card key={o.id}>
          <CardContent className="p-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold">{o.title}</div>
                <div className="text-xs text-gray-500">{[areaByKey(o.area)?.label, o.country, o.audience === "all" ? "everyone" : `${o.audience}s`, o.closesOn ? `closes ${day(o.closesOn)}` : null, `posted ${day(o.createdAt)}`].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="flex gap-2 items-center">
                <Pill s={o.status === "open" ? "active" : "closed"} />
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(`/api/v2/admin/connector-offers/${o.id}/status`, { status: o.status === "open" ? "closed" : "open" }, o.status === "open" ? "Closed" : "Reopened")}>
                  {o.status === "open" ? "Close" : "Reopen"}
                </Button>
              </div>
            </div>
            <p>{o.summary}</p>
            <p className="text-gray-600">Reward: {o.reward}</p>
            <div className="border-t pt-2 space-y-2">
              <div className="text-xs font-medium text-gray-500">{o.responses.length ? `${o.responses.length} interested` : "No responses yet"}</div>
              {o.responses.map((r: any) => (
                <div key={r.userId} className="flex justify-between gap-3 flex-wrap border-b pb-2">
                  <span><button className="underline font-medium" onClick={() => onOpen(r.userId)}>{r.name}</button> <span className="text-gray-500">· {r.kind} · {r.country} · {day(r.at)}</span>
                    <br /><span className="text-gray-600">{r.note}</span></span>
                  {r.status === "interested" ? (
                    <span className="flex gap-2">
                      <Button size="sm" disabled={busy} onClick={() => run(`/api/v2/admin/connector-offers/${o.id}/responses/${r.userId}`, { status: "selected" }, "Selected and emailed")}>Select</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => run(`/api/v2/admin/connector-offers/${o.id}/responses/${r.userId}`, { status: "not_selected" }, "Marked not selected and emailed")}>Not this time</Button>
                    </span>
                  ) : <Pill s={r.status === "selected" ? "approved" : r.status} />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
