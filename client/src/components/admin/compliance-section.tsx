/**
 * Compliance — the admin surface for AML/CFT.
 *
 *   Queue      KYC submissions awaiting a decision, with documents and the
 *              sanctions screening already run against them
 *   Alerts     what monitoring has flagged, with the 24-hour review clock
 *              policy §4 commits to
 *   Screening  run a name or address by hand; see which lists are loaded
 *
 * The reviewer is shown the screening result before the approve button,
 * because a decision made without looking at it is the one that matters.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck, ShieldAlert, Users, Search, Check, X, Clock, Loader2, ArrowLeft,
  AlertTriangle, FileText, ExternalLink, RefreshCw, Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { KYC_TIERS, ALERT_LABELS, type AlertKind } from "@shared/compliance-schema";

async function api(url: string, token: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers, "x-admin-token": token },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

const usd = (n: number) => "$" + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const short = (a?: string | null) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? "—");
const when = (d?: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

type Tab = "queue" | "alerts" | "screening";

export function ComplianceSection({ token }: { token: string }) {
  const [tab, setTab] = useState<Tab>("queue");
  const [open, setOpen] = useState<number | null>(null);

  const { data: summary } = useQuery({
    queryKey: ["compliance-summary", token],
    queryFn: () => api("/api/admin/compliance/summary", token),
    refetchInterval: 60_000,
  });

  if (open !== null) {
    return <Review token={token} id={open} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Scale className="h-5 w-5" /> Compliance
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Verification, sanctions screening and transaction monitoring, against the thresholds in the AML policy.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting review" value={summary?.submissions?.awaitingReview ?? 0} icon={Clock} tone="text-amber-600" />
        <Stat label="Open alerts" value={summary?.alerts?.open ?? 0} icon={ShieldAlert} tone="text-red-600" />
        <Stat label="Verified customers" value={summary?.submissions?.approved ?? 0} icon={ShieldCheck} tone="text-emerald-600" />
        <Stat label="Screenings run" value={summary?.screenings?.total ?? 0} icon={Search} />
      </div>

      <div className="flex gap-1 border-b border-border">
        {([
          ["queue", "Queue", Users, summary?.submissions?.awaitingReview],
          ["alerts", "Alerts", ShieldAlert, summary?.alerts?.open],
          ["screening", "Screening", Search, 0],
        ] as const).map(([k, label, Icon, count]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors",
              tab === k ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {count ? (
              <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                {count}
              </span>
            ) : null}
            {tab === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {tab === "queue" && <Queue token={token} onOpen={setOpen} />}
      {tab === "alerts" && <Alerts token={token} />}
      {tab === "screening" && <Screening token={token} summary={summary} />}
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone = "text-muted-foreground" }: { label: string; value: number; icon: any; tone?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        </div>
        <Icon className={cn("h-5 w-5", tone)} />
      </CardContent>
    </Card>
  );
}

// ── Queue ─────────────────────────────────────────────────────────────────

function Queue({ token, onOpen }: { token: string; onOpen: (id: number) => void }) {
  const [status, setStatus] = useState("submitted");
  const { data: rows = [] } = useQuery({
    queryKey: ["compliance-queue", token, status],
    queryFn: () => api(`/api/admin/compliance/queue?status=${status}`, token),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {["submitted", "in_review", "approved", "rejected", "all"].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
              status === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <ShieldCheck className="h-6 w-6 text-muted-foreground" />
            <p className="font-medium">Nothing waiting</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Verification requests appear here. Anything held by a screening hit is marked <em>in review</em>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Wants</th>
                  <th className="hidden px-5 py-3 font-medium sm:table-cell">Type</th>
                  <th className="hidden px-5 py-3 font-medium lg:table-cell">Wallet</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="hidden px-5 py-3 font-medium md:table-cell">Submitted</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr
                    key={r.id}
                    onClick={() => onOpen(r.id)}
                    className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-medium">{r.fullName || r.companyName || "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.country || "—"}</div>
                    </td>
                    <td className="px-5 py-3.5">Tier {r.requestedTier}</td>
                    <td className="hidden px-5 py-3.5 capitalize text-muted-foreground sm:table-cell">{r.entityType}</td>
                    <td className="hidden px-5 py-3.5 font-mono text-xs text-muted-foreground lg:table-cell">{short(r.walletAddress)}</td>
                    <td className="px-5 py-3.5">
                      <StatusPill status={r.status} pep={r.isPep} />
                    </td>
                    <td className="hidden px-5 py-3.5 text-muted-foreground md:table-cell">{when(r.submittedAt)}</td>
                    <td className="px-5 py-3.5 text-right text-xs text-muted-foreground">
                      {r.documentCount} doc{r.documentCount === 1 ? "" : "s"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusPill({ status, pep }: { status: string; pep?: boolean }) {
  const map: Record<string, string> = {
    submitted: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    in_review: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    rejected: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", map[status] ?? map.submitted)}>
        {status.replace("_", " ")}
      </span>
      {pep && (
        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
          PEP
        </span>
      )}
    </span>
  );
}

// ── Review ────────────────────────────────────────────────────────────────

function Review({ token, id, onBack }: { token: string; id: number; onBack: () => void }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [tier, setTier] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["compliance-submission", token, id],
    queryFn: () => api(`/api/admin/compliance/submission/${id}`, token),
  });

  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      api(`/api/admin/compliance/submission/${id}/review`, token, {
        method: "POST",
        body: JSON.stringify({
          decision,
          grantedTier: decision === "approved" ? Number(tier || data?.requestedTier) : 0,
          notes,
        }),
      }),
    onSuccess: (r: any) => {
      toast({
        title: r.status === "approved" ? `Approved at Tier ${r.tier}` : "Rejected",
        description: r.status === "rejected" ? "They'll see your note and can resubmit." : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["compliance-queue"] });
      queryClient.invalidateQueries({ queryKey: ["compliance-summary"] });
      onBack();
    },
    onError: (e: any) => toast({ title: "Couldn't record that", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
    </div>;
  }

  const decided = data.status === "approved" || data.status === "rejected";
  const hits = (data.screenings ?? []).filter((s: any) => s.matched);
  const inconclusive = (data.screenings ?? []).filter((s: any) => s.error);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="mt-0.5 gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Compliance
        </Button>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{data.fullName || data.companyName}</h2>
            <StatusPill status={data.status} pep={data.isPep} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Requesting Tier {data.requestedTier} · {data.entityType} · {short(data.walletAddress)}
          </p>
        </div>
      </div>

      {/* Screening first — the reviewer should see this before deciding. */}
      <Card className={cn(hits.length && "border-red-300 dark:border-red-900")}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            {hits.length ? <ShieldAlert className="h-4 w-4 text-red-600" /> : <ShieldCheck className="h-4 w-4 text-emerald-600" />}
            Sanctions screening
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {(data.screenings ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No screening on record for this submission.</p>
          )}
          {(data.screenings ?? []).map((s: any) => (
            <div key={s.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {s.subjectType === "wallet" ? "Wallet" : "Name"} · {s.subject.length > 40 ? short(s.subject) : s.subject}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    s.matched
                      ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                      : s.error
                        ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                  )}
                >
                  {s.matched ? `${Math.round(s.topScore * 100)}% match` : s.error ? "inconclusive" : "clear"}
                </span>
              </div>
              {s.error && <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">{s.error}</p>}
              {(s.matches ?? []).map((m: any, i: number) => (
                <div key={i} className="mt-2 rounded-md bg-muted/50 p-2.5">
                  <p className="text-xs font-medium">{m.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {Math.round(m.score * 100)}% · {(m.datasets ?? []).join(" · ")}
                    {m.country ? ` · ${m.country}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ))}
          {(hits.length > 0 || inconclusive.length > 0) && (
            <p className="rounded-md border border-border bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
              A match is not a decision. Name screening produces false positives — confirm identity against the
              documents below before refusing anyone, and record what you found in the note.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0 text-sm">
              {[
                ["Full name", data.fullName],
                ["Date of birth", data.dateOfBirth],
                ["Nationality", data.nationality],
                ["Country", data.country],
                ["Address", data.address],
                ["Phone", data.phone],
                ["Email", data.email],
                ["ID", data.idType && data.idNumber ? `${data.idType} · ${data.idNumber}` : data.idNumber],
                ["Company", data.companyName],
                ["Registration no.", data.registrationNumber],
                ["Beneficial owners", data.beneficialOwners],
                ["Source of funds", data.sourceOfFunds],
                ["Source of wealth", data.sourceOfWealth],
                ["Expected volume", data.expectedMonthlyVolume],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k as string} className="flex items-start justify-between gap-4 border-b border-border/50 pb-2 last:border-0">
                    <span className="text-xs text-muted-foreground">{k}</span>
                    <span className="max-w-[60%] whitespace-pre-wrap text-right">{v as string}</span>
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Documents</CardTitle></CardHeader>
            <CardContent className="space-y-3 pt-0">
              {(data.documents ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No documents attached.</p>
              )}
              {(data.documents ?? []).map((d: any, i: number) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{d.label}</span>
                    <a
                      href={d.dataUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{d.filename}</p>
                  {d.mime?.startsWith("image/") && (
                    <img src={d.dataUrl} alt={d.label} className="mt-2 max-h-64 w-auto rounded-md border border-border" />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Current standing</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0 text-xs">
              <Row k="Tier" v={`${data.standing?.tier} — ${data.standing?.tierDef?.name}`} />
              <Row k="Moved (30d)" v={usd(data.standing?.cashMovedUsd)} />
              <Row k="Payout exposure" v={usd(data.standing?.payoutExposureUsd)} />
            </CardContent>
          </Card>

          {!decided && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Decision</CardTitle></CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="space-y-1.5">
                  <Label className="text-xs">Grant tier</Label>
                  <Select value={tier || String(data.requestedTier)} onValueChange={setTier}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {KYC_TIERS.filter((t) => t.tier > 0).map((t) => (
                        <SelectItem key={t.tier} value={String(t.tier)} className="text-xs">
                          Tier {t.tier} — {t.name} ({usd(t.cashMovedUsd)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Note</Label>
                  <Textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="What you checked, and what you concluded. Shown to them if rejected."
                    className="text-xs"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 gap-1.5 text-xs" disabled={decide.isPending} onClick={() => decide.mutate("approved")}>
                    <Check className="h-3 w-3" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs text-destructive" disabled={decide.isPending} onClick={() => decide.mutate("rejected")}>
                    <X className="h-3 w-3" /> Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {decided && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Decided</CardTitle></CardHeader>
              <CardContent className="space-y-2 pt-0 text-xs">
                <Row k="Outcome" v={data.status} />
                <Row k="By" v={data.reviewedBy ?? "—"} />
                <Row k="When" v={when(data.reviewedAt)} />
                {data.reviewerNotes && <p className="rounded-md bg-muted/50 p-2.5 leading-relaxed">{data.reviewerNotes}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex items-start justify-between gap-3">
    <span className="text-muted-foreground">{k}</span>
    <span className="text-right">{v}</span>
  </div>
);

// ── Alerts ────────────────────────────────────────────────────────────────

function Alerts({ token }: { token: string }) {
  const { toast } = useToast();
  const [status, setStatus] = useState("open");
  const { data, refetch } = useQuery({
    queryKey: ["compliance-alerts", token, status],
    queryFn: () => api(`/api/admin/compliance/alerts?status=${status}`, token),
    refetchInterval: 60_000,
  });

  const resolve = useMutation({
    mutationFn: ({ id, s, note }: { id: number; s: string; note: string }) =>
      api(`/api/admin/compliance/alerts/${id}/resolve`, token, {
        method: "POST",
        body: JSON.stringify({ status: s, resolution: note }),
      }),
    onSuccess: () => {
      toast({ title: "Recorded" });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["compliance-summary"] });
    },
  });

  const alerts = data?.alerts ?? [];

  return (
    <div className="space-y-4">
      {data?.overdue > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
          <p className="text-sm text-red-900 dark:text-red-200">
            <strong>{data.overdue}</strong> alert{data.overdue === 1 ? "" : "s"} open more than 24 hours.
            Policy §4 commits to reviewing flagged activity within that window.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {["open", "cleared", "escalated", "all"].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
              status === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {alerts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <ShieldCheck className="h-6 w-6 text-muted-foreground" />
            <p className="font-medium">Nothing flagged</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Monitoring raises an alert on large transactions, cumulative thresholds, structuring and
              sanctions matches.
            </p>
          </CardContent>
        </Card>
      ) : (
        alerts.map((a: any) => {
          const overdue = a.status === "open" && a.openedAt && Date.now() - new Date(a.openedAt).getTime() > 86_400_000;
          return (
            <Card key={a.id} className={cn(overdue && "border-red-300 dark:border-red-900")}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{a.title}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          a.severity === "high"
                            ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {ALERT_LABELS[a.kind as AlertKind] ?? a.kind}
                      </span>
                      {overdue && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900 dark:text-red-200">
                          overdue
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {short(a.walletAddress)} · {when(a.openedAt)}
                    </p>
                  </div>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{a.status}</span>
                </div>

                <p className="text-sm leading-relaxed">{a.detail}</p>

                {a.status === "open" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                      onClick={() => resolve.mutate({ id: a.id, s: "cleared", note: "Reviewed — no further action." })}>
                      <Check className="h-3 w-3" /> Clear
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs text-destructive"
                      onClick={() => resolve.mutate({ id: a.id, s: "escalated", note: "Escalated for suspicious transaction reporting." })}>
                      <AlertTriangle className="h-3 w-3" /> Escalate to STR
                    </Button>
                  </div>
                )}
                {a.resolution && (
                  <p className="rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
                    {a.resolution} — {a.resolvedBy} · {when(a.resolvedAt)}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ── Screening ─────────────────────────────────────────────────────────────

function Screening({ token, summary }: { token: string; summary: any }) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [result, setResult] = useState<any>(null);

  const screen = useMutation({
    mutationFn: () => api("/api/admin/compliance/screen", token, { method: "POST", body: JSON.stringify({ subject }) }),
    onSuccess: (r) => setResult(r),
    onError: (e: any) => toast({ title: "Screening failed", description: e.message, variant: "destructive" }),
  });

  const rescreen = useMutation({
    mutationFn: () => api("/api/admin/compliance/rescreen", token, { method: "POST" }),
    onSuccess: (r: any) =>
      toast({
        title: `Re-screened ${r.screened}`,
        description: r.hits ? `${r.hits} need review.` : "No new matches.",
      }),
    onError: (e: any) => toast({ title: "Re-screening failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Screen a name or wallet</CardTitle>
          <p className="text-xs text-muted-foreground">
            Checked against OFAC SDN and the UN Consolidated List, including aliases and designated addresses.
            The EU and Ghana FIC lists are a manual check.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex gap-2">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Full name, company, or 0x wallet address"
              onKeyDown={(e) => { if (e.key === "Enter" && subject.trim()) screen.mutate(); }}
            />
            <Button disabled={!subject.trim() || screen.isPending} onClick={() => screen.mutate()} className="gap-2">
              {screen.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Screen
            </Button>
          </div>

          {result && (
            <div
              className={cn(
                "rounded-lg border p-4",
                result.status === "hit"
                  ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                  : result.status === "inconclusive"
                    ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
                    : "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40",
              )}
            >
              <p className="text-sm font-medium">
                {result.status === "hit" ? "Possible match" : result.status === "inconclusive" ? "Inconclusive" : "No match"}
              </p>
              {result.error && <p className="mt-1 text-xs">{result.error}</p>}
              {result.coverage?.length > 0 && (
                <p className="mt-1 text-[11px] opacity-80">Checked against: {result.coverage.join(", ")}</p>
              )}
              {(result.matches ?? []).map((m: any, i: number) => (
                <div key={i} className="mt-2 rounded-md bg-background/60 p-2.5">
                  <p className="text-xs font-medium">{m.name}</p>
                  <p className="mt-0.5 text-[11px] opacity-80">
                    {Math.round(m.score * 100)}% · {(m.datasets ?? []).join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Ongoing screening</CardTitle></CardHeader>
        <CardContent className="space-y-3 pt-0">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Policy §5 requires screening on an ongoing basis, not just at onboarding — designations change, and a
            customer clear last month may not be clear today.
          </p>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={rescreen.isPending} onClick={() => rescreen.mutate()}>
            {rescreen.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Re-screen approved customers
          </Button>
          {summary?.screenings && (
            <p className="text-xs text-muted-foreground">
              {summary.screenings.total} screenings on record · {summary.screenings.hits} matched
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
