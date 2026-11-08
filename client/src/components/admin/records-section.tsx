/**
 * Records: the compliance record for BlockFinaX staff (server/records).
 *
 *   Log            the hash-linked log: verify it, see daily Stellar anchors, filter entries
 *   Complaints     acknowledge and resolve, with the response the customer sees
 *   Business checks  KYB submissions: details, documents, decision
 *   Cases          suspicious activity: open, add notes, close or record a report
 *   Deletion       carry out deletion requests
 *   Travel Rule    recipient details captured for larger transfers
 *   Report         a regulator summary for any period, as JSON or CSV
 *
 * Opening a business check or a case is itself recorded as a view, and every change here is
 * recorded as a staff action, with who did it.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

async function call<T>(url: string, token: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "x-admin-token": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || json?.message || `Request failed (${res.status})`);
  return json as T;
}

const TABS = ["Log", "Complaints", "Business checks", "Cases", "Deletion", "Travel Rule", "Report"] as const;
type Tab = (typeof TABS)[number];
const when = (d?: string | null) => (d ? new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const today = () => new Date().toISOString().slice(0, 10);

export function RecordsSection({ token }: { token: string }) {
  const [tab, setTab] = useState<Tab>("Log");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>{t}</Button>)}
      </div>
      {tab === "Log" && <LogTab token={token} />}
      {tab === "Complaints" && <ComplaintsTab token={token} />}
      {tab === "Business checks" && <KybTab token={token} />}
      {tab === "Cases" && <CasesTab token={token} />}
      {tab === "Deletion" && <DeletionTab token={token} />}
      {tab === "Travel Rule" && <TravelRuleTab token={token} />}
      {tab === "Report" && <ReportTab token={token} />}
    </div>
  );
}

function useAct(token: string, keys: string[]) {
  const { toast } = useToast();
  const qc = useQueryClient();
  return async (url: string, method: string, body: unknown, done: string) => {
    try {
      await call(url, token, method, body);
      toast({ title: done });
      for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
      return true;
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
      return false;
    }
  };
}

// ── Log ──────────────────────────────────────────────────────────────────────

function LogTab({ token }: { token: string }) {
  const [action, setAction] = useState("");
  const [subject, setSubject] = useState("");
  const verify = useQuery({ queryKey: ["rec-verify"], queryFn: () => call<{ ok: boolean; entries: number; lastHash: string; brokenAt?: number; reason?: string }>("/api/admin/records/verify", token) });
  const anchors = useQuery({ queryKey: ["rec-anchors"], queryFn: () => call<{ anchors: any[] }>("/api/admin/records/anchors", token) });
  const log = useQuery({
    queryKey: ["rec-log", action, subject],
    queryFn: () => call<{ entries: any[] }>(`/api/admin/records/log?limit=200${action ? `&action=${encodeURIComponent(action)}` : ""}${subject ? `&subjectId=${encodeURIComponent(subject)}` : ""}`, token),
  });
  const act = useAct(token, ["rec-anchors"]);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Integrity</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {verify.isLoading ? "Checking every entry..." : verify.data?.ok
            ? <div className="text-green-700">Intact: all {verify.data.entries} entries match their hashes. Latest hash <code>{verify.data.lastHash.slice(0, 16)}…</code></div>
            : <div className="text-red-700">Broken at entry {verify.data?.brokenAt}: {verify.data?.reason}. Investigate before relying on the log.</div>}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void verify.refetch()}>Verify again</Button>
            <Button size="sm" variant="outline" onClick={() => act("/api/admin/records/anchor", "POST", {}, "Anchor checked")}>Anchor yesterday now</Button>
          </div>
          <div className="text-xs text-muted-foreground">Daily anchors on Stellar (the last entry hash of each day):</div>
          {(anchors.data?.anchors ?? []).slice(0, 7).map((a) => (
            <div key={a.day} className="text-xs">{String(a.day).slice(0, 10)} · {a.tx_hash ? <>tx <code>{a.tx_hash.slice(0, 12)}…</code></> : <span className="text-red-700">not anchored: {a.error}</span>}</div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Entries</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input placeholder="Action, e.g. staff.action or cover.*" value={action} onChange={(e) => setAction(e.target.value)} />
            <Input placeholder="Subject id" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="max-h-[520px] overflow-auto text-xs">
            {(log.data?.entries ?? []).map((e) => (
              <details key={e.id} className="border-b py-1">
                <summary className="cursor-pointer">#{e.id} · {when(e.at)} · <b>{e.action}</b> · {e.actor.type} {e.actor.id}{e.subject ? ` · ${e.subject.type} ${e.subject.id}` : ""}</summary>
                <pre className="whitespace-pre-wrap break-all bg-muted p-2 rounded mt-1">{JSON.stringify(e.data ?? null, null, 2)}</pre>
                <div className="text-muted-foreground">hash {e.hash}</div>
              </details>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Complaints ───────────────────────────────────────────────────────────────

function ComplaintsTab({ token }: { token: string }) {
  const list = useQuery({ queryKey: ["rec-complaints"], queryFn: () => call<{ complaints: any[] }>("/api/admin/records/complaints", token) });
  const act = useAct(token, ["rec-complaints"]);
  const [draft, setDraft] = useState<Record<number, { outcome: string; response: string }>>({});
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Complaints register</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!(list.data?.complaints ?? []).length && <div className="text-muted-foreground">No complaints.</div>}
        {(list.data?.complaints ?? []).map((c) => {
          const d = draft[c.id] ?? { outcome: "", response: "" };
          return (
            <div key={c.id} className="border rounded p-3 space-y-2">
              <div className="flex justify-between gap-2">
                <div><b>#{c.id} {c.subject}</b> · {c.category} · user {c.user_id}{c.reference ? ` · ref ${c.reference}` : ""}</div>
                <div className={c.acknowledge_overdue || c.resolve_overdue ? "text-red-700" : ""}>{c.status} · {Math.floor(c.days_open)} days{c.resolve_overdue ? " · overdue" : c.acknowledge_overdue ? " · reply overdue" : ""}</div>
              </div>
              <div className="whitespace-pre-wrap">{c.description}</div>
              {c.outcome && <div className="text-muted-foreground">Outcome: {c.outcome}{c.handled_by ? ` (${c.handled_by})` : ""}</div>}
              {c.status !== "closed" && (
                <>
                  <Input placeholder="Outcome (internal)" value={d.outcome} onChange={(e) => setDraft({ ...draft, [c.id]: { ...d, outcome: e.target.value } })} />
                  <Textarea placeholder="Response the customer sees" value={d.response} onChange={(e) => setDraft({ ...draft, [c.id]: { ...d, response: e.target.value } })} />
                  <div className="flex gap-2">
                    {c.status === "open" && <Button size="sm" variant="outline" onClick={() => act(`/api/admin/records/complaints/${c.id}`, "PATCH", { status: "acknowledged", response: d.response }, "Acknowledged")}>Acknowledge</Button>}
                    <Button size="sm" onClick={() => act(`/api/admin/records/complaints/${c.id}`, "PATCH", { status: "resolved", ...d }, "Resolved")}>Resolve</Button>
                    <Button size="sm" variant="outline" onClick={() => act(`/api/admin/records/complaints/${c.id}`, "PATCH", { status: "closed", ...d }, "Closed")}>Close</Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Business checks (KYB) ────────────────────────────────────────────────────

function KybTab({ token }: { token: string }) {
  const list = useQuery({ queryKey: ["rec-kyb"], queryFn: () => call<{ submissions: any[] }>("/api/admin/records/kyb", token) });
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Business checks</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {!(list.data?.submissions ?? []).length && <div className="text-muted-foreground">No submissions.</div>}
          {(list.data?.submissions ?? []).map((s) => (
            <button key={s.id} className={`w-full text-left border rounded p-2 ${open === s.id ? "bg-muted" : ""}`} onClick={() => setOpen(s.id)}>
              <b>{s.legal_name}</b> · {s.country} · {s.status} · {s.documents} documents · {when(s.submitted_at)}
            </button>
          ))}
        </CardContent>
      </Card>
      {open && <KybDetail token={token} id={open} />}
    </div>
  );
}

function KybDetail({ token, id }: { token: string; id: number }) {
  const detail = useQuery({ queryKey: ["rec-kyb-detail", id], queryFn: () => call<{ submission: any }>(`/api/admin/records/kyb/${id}`, token) });
  const act = useAct(token, ["rec-kyb", "rec-kyb-detail"]);
  const [notes, setNotes] = useState("");
  const s = detail.data?.submission;
  if (!s) return <Card><CardContent className="p-4 text-sm">Loading...</CardContent></Card>;
  const openDoc = async (docId: number) => {
    const res = await fetch(`/api/admin/records/kyb/${id}/documents/${docId}`, { headers: { "x-admin-token": token } });
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank", "noopener");
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{s.company.legalName}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {Object.entries(s.company).map(([k, v]) => <div key={k}><span className="text-muted-foreground">{k}:</span> {String(v ?? "")}</div>)}
        <div className="font-semibold pt-2">People</div>
        {s.people.map((p: any, i: number) => (
          <div key={i} className={p.isPep ? "text-amber-700" : ""}>{p.name} · {p.role} · {p.nationality} · born {p.dateOfBirth}{p.ownershipPct !== null ? ` · ${p.ownershipPct}%` : ""}{p.isPep ? " · PEP" : ""}</div>
        ))}
        <div className="font-semibold pt-2">Documents</div>
        {s.documents.map((d: any) => <div key={d.id}><button className="underline" onClick={() => void openDoc(d.id)}>{d.kind}: {d.name}</button> <span className="text-xs text-muted-foreground">sha256 {d.sha256.slice(0, 12)}…</span></div>)}
        <div className="pt-2">Status: <b>{s.status}</b>{s.reviewed_by ? ` · ${s.reviewed_by}, ${when(s.reviewed_at)}` : ""}{s.reviewer_notes ? ` · ${s.reviewer_notes}` : ""}</div>
        <Textarea placeholder="Notes (required to reject or ask for more)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => act(`/api/admin/records/kyb/${id}/decision`, "POST", { decision: "approved", notes }, "Approved")}>Approve</Button>
          <Button size="sm" variant="outline" onClick={() => act(`/api/admin/records/kyb/${id}/decision`, "POST", { decision: "more_info", notes }, "Asked for more")}>Ask for more</Button>
          <Button size="sm" variant="outline" onClick={() => act(`/api/admin/records/kyb/${id}/decision`, "POST", { decision: "rejected", notes }, "Rejected")}>Reject</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Suspicious activity cases ────────────────────────────────────────────────

function CasesTab({ token }: { token: string }) {
  const list = useQuery({ queryKey: ["rec-cases"], queryFn: () => call<{ cases: any[] }>("/api/admin/records/cases", token) });
  const act = useAct(token, ["rec-cases"]);
  const [open, setOpen] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", subjectType: "user", subjectId: "", alertIds: "", note: "" });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Suspicious activity cases</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="text-xs text-muted-foreground">Never tell the customer a case exists.</div>
          <Input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <div className="flex gap-2">
            <select className="border rounded px-2 text-sm" value={form.subjectType} onChange={(e) => setForm({ ...form, subjectType: e.target.value })}>
              <option value="user">User</option><option value="wallet">Wallet</option><option value="organisation">Business</option><option value="transaction">Transaction</option>
            </select>
            <Input placeholder="User id, address or hash" value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} />
          </div>
          <Input placeholder="Alert ids, comma separated (optional)" value={form.alertIds} onChange={(e) => setForm({ ...form, alertIds: e.target.value })} />
          <Textarea placeholder="Why this case is opened" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <Button size="sm" onClick={async () => {
            if (await act("/api/admin/records/cases", "POST", { ...form, alertIds: form.alertIds.split(",").map((x) => Number(x.trim())).filter(Boolean) }, "Case opened")) setForm({ title: "", subjectType: "user", subjectId: "", alertIds: "", note: "" });
          }}>Open case</Button>
          <div className="pt-2 space-y-1">
            {(list.data?.cases ?? []).map((c) => (
              <button key={c.id} className={`w-full text-left border rounded p-2 ${open === c.id ? "bg-muted" : ""}`} onClick={() => setOpen(c.id)}>
                #{c.id} <b>{c.title}</b> · {c.subject_type} {c.subject_id} · {c.status}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      {open && <CaseDetail token={token} id={open} />}
    </div>
  );
}

function CaseDetail({ token, id }: { token: string; id: number }) {
  const detail = useQuery({ queryKey: ["rec-case", id], queryFn: () => call<{ case: any }>(`/api/admin/records/cases/${id}`, token) });
  const act = useAct(token, ["rec-cases", "rec-case"]);
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState("");
  const [reference, setReference] = useState("");
  const c = detail.data?.case;
  if (!c) return <Card><CardContent className="p-4 text-sm">Loading...</CardContent></Card>;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">#{c.id} {c.title}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>{c.subject_type} {c.subject_id} · opened by {c.opened_by}, {when(c.opened_at)} · alerts {c.alert_ids?.join(", ") || "none"}</div>
        <div>Status: <b>{c.status}</b>{c.decided_by ? ` · ${c.decided_by}, ${when(c.decided_at)}` : ""}{c.report_reference ? ` · report ${c.report_reference}` : ""}</div>
        {c.decision && <div className="text-muted-foreground">Decision: {c.decision}</div>}
        <div className="font-semibold pt-2">Notes</div>
        {c.notes.map((n: any) => <div key={n.id} className="border-b pb-1"><span className="text-xs text-muted-foreground">{n.author}, {when(n.at)}</span><div className="whitespace-pre-wrap">{n.body}</div></div>)}
        <Textarea placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" variant="outline" onClick={async () => { if (await act(`/api/admin/records/cases/${id}/notes`, "POST", { body: note }, "Note added")) setNote(""); }}>Add note</Button>
        <div className="font-semibold pt-2">Decision</div>
        <Textarea placeholder="Reason for the decision" value={decision} onChange={(e) => setDecision(e.target.value)} />
        <Input placeholder="Report reference (when reported to the FIU)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => act(`/api/admin/records/cases/${id}/decision`, "POST", { status: "investigating", decision }, "Marked as investigating")}>Investigating</Button>
          <Button size="sm" variant="outline" onClick={() => act(`/api/admin/records/cases/${id}/decision`, "POST", { status: "closed_no_action", decision }, "Closed, no action")}>Close, no action</Button>
          <Button size="sm" onClick={() => act(`/api/admin/records/cases/${id}/decision`, "POST", { status: "reported", decision, reportReference: reference }, "Recorded as reported")}>Reported</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Deletion ─────────────────────────────────────────────────────────────────

function DeletionTab({ token }: { token: string }) {
  const list = useQuery({ queryKey: ["rec-deletion"], queryFn: () => call<{ requests: any[] }>("/api/admin/records/deletion", token) });
  const act = useAct(token, ["rec-deletion"]);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Deletion requests</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="text-xs text-muted-foreground">Completing a request anonymises the profile, ends sessions and deletes Finax conversations. Identity, transaction and other regulated records are kept for their retention period. Check there is no open case first.</div>
        {!(list.data?.requests ?? []).length && <div className="text-muted-foreground">No requests.</div>}
        {(list.data?.requests ?? []).map((r) => (
          <div key={r.id} className="border rounded p-2 flex justify-between gap-2">
            <div>#{r.id} · user {r.user_id} · {when(r.requested_at)} · <b>{r.status}</b>{r.handled_by ? ` · ${r.handled_by}` : ""}
              {r.summary?.done && <div className="text-xs text-muted-foreground">{r.summary.done.join("; ")}</div>}
            </div>
            {r.status === "received" && <Button size="sm" onClick={() => act(`/api/admin/records/deletion/${r.id}/complete`, "POST", {}, "Deletion completed")}>Complete</Button>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Travel Rule ──────────────────────────────────────────────────────────────

function TravelRuleTab({ token }: { token: string }) {
  const list = useQuery({ queryKey: ["rec-travel"], queryFn: () => call<{ records: any[]; thresholdUsd: number }>("/api/admin/records/travel-rule", token) });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Travel Rule records (from ${list.data?.thresholdUsd ?? "..."})</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-1">
        {!(list.data?.records ?? []).length && <div className="text-muted-foreground">No transfers at or above the threshold yet.</div>}
        {(list.data?.records ?? []).map((r) => (
          <div key={r.id} className="border-b py-1">
            {when(r.created_at)} · user {r.user_id} · ${Number(r.amount).toLocaleString()} {r.asset} on {r.chain} → <b>{r.beneficiary_name}</b> ({r.beneficiary_type}){r.beneficiary_vasp ? ` · ${r.beneficiary_vasp}` : ""}{r.beneficiary_country ? ` · ${r.beneficiary_country}` : ""}
            <div className="text-xs text-muted-foreground break-all">{r.to_address}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Report ───────────────────────────────────────────────────────────────────

function ReportTab({ token }: { token: string }) {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const report = useQuery({ queryKey: ["rec-report", from, to], queryFn: () => call<any>(`/api/admin/records/report?from=${from}&to=${to}`, token) });
  const download = async () => {
    const res = await fetch(`/api/admin/records/report?from=${from}&to=${to}&format=csv`, { headers: { "x-admin-token": token } });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `blockfinax-report-${from}-to-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Regulatory report</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex gap-2 items-center">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
          <span>to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
          <Button size="sm" variant="outline" onClick={() => void download()}>Download CSV</Button>
        </div>
        <pre className="whitespace-pre-wrap break-all bg-muted p-3 rounded text-xs">{report.isLoading ? "Building..." : JSON.stringify(report.data, null, 2)}</pre>
      </CardContent>
    </Card>
  );
}
