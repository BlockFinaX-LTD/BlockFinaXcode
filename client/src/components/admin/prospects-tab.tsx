/**
 * prospects-tab.tsx, the cold outbound pipeline.
 *
 * Discovery finds businesses, Finax works out what they are and writes the
 * first email, Anthony reads and approves, and only then does anything send.
 *
 * ## Why approving and sending are separate buttons
 *
 * A model writing to thousands of strangers in a founder's name goes wrong all
 * at once. Approving is a person saying they read this specific message, so it
 * is its own act, and editing a message clears the approval rather than keeping
 * a record that says he read something he did not.
 *
 * ## Why blocked rows are shown rather than hidden
 *
 * A named person in Ghana or the EU cannot be cold emailed without consent, and
 * those rows stay visible with the reason attached. They are still good
 * research: that person is exactly who to look for on LinkedIn, where the
 * outreach tool already works. Hiding them would throw the work away and make
 * the pipeline look emptier than it is.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, Sparkles, Send, Check, ExternalLink, ShieldAlert, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Prospect {
  id: number;
  company: string; website: string | null; country: string | null;
  description: string | null; industry: string | null;
  email: string; addressKind: string;
  segment: string; fit: string | null; fitScore: number | null;
  sendable: boolean; sendableReason: string | null;
  status: string; draftSubject: string | null; draftBody: string | null;
  approvedAt: string | null; sentAt: string | null;
  /** Resend's own id. The only proof the message actually left. */
  providerMessageId: string | null;
}

interface Health {
  sent: number; bounced: number; complained: number;
  bounceRate: number; complaintRate: number;
  halted: boolean; reason: string | null; meaningful: boolean;
}

interface Config {
  canSend: boolean; reason: string | null; warning: string | null; from: string | null;
  bcc: string | null; replyTo: string | null;
  discovery: boolean; sentToday: number; dailyCap: number;
  health: Health;
  schedule: {
    configured: boolean; lastRunAt: string | null; nextRunAt: string | null;
    position: number; total: number; seedsPerCycle: number;
    queueCap: number; waiting: number; paused: boolean;
    lastResult: { at: string; inserted: number; drafted: number; lines: string[] } | null;
  };
  seeds: { queries: Record<string, string[]>; locations: string[] };
}

const SEGMENTS: Record<string, { label: string; tone: string }> = {
  hedger:      { label: "Needs cover",   tone: "text-emerald-600 dark:text-emerald-500" },
  underwriter: { label: "Could underwrite", tone: "text-violet-600 dark:text-violet-400" },
  psp:         { label: "Payments",      tone: "text-blue-600 dark:text-blue-400" },
  bank:        { label: "Bank",          tone: "text-amber-600 dark:text-amber-500" },
  unknown:     { label: "Unsorted",      tone: "text-muted-foreground" },
};

async function api(url: string, token: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers, "x-admin-token": token },
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || b.message || `Request failed (${res.status})`);
  }
  return res.json();
}

export function ProspectsTab({ token, enabled }: { token: string; enabled: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [segment, setSegment] = useState("all");
  const [query, setQuery] = useState("food importer");
  const [location, setLocation] = useState("Accra, Ghana");
  const [seedSegment, setSeedSegment] = useState("hedger");

  const { data: cfg } = useQuery<Config>({
    queryKey: ["prospects-config", token],
    queryFn: () => api("/api/prospects/config", token),
    refetchInterval: 60_000,
  });

  const { data, isLoading } = useQuery<{
    prospects: Prospect[]; total: number;
    counts: Record<string, number>; segments: Record<string, number>;
  }>({
    queryKey: ["prospects", status, segment, token],
    queryFn: () => api(`/api/prospects?status=${status}&segment=${segment}`, token),
  });

  const discover = useMutation({
    mutationFn: () => api("/api/prospects/discover", token, {
      method: "POST",
      body: JSON.stringify({ query, location, segment: seedSegment, limit: 60 }),
    }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast({
        title: r.inserted ? `${r.inserted} new businesses` : "Nothing new found",
        // Say what happened at every stage. "Nothing found" cannot distinguish
        // an empty search from a crawl that found sites with no contact page.
        description:
          `${r.found} found, ${r.withSite} had a website, ${r.withEmail} had an address, ` +
          `${r.duplicates} already known` +
          (r.errors?.length ? ` · ${r.errors[0]}` : ""),
        variant: r.inserted ? undefined : "destructive",
      });
    },
    onError: (e: Error) => toast({ title: "Discovery failed", description: e.message, variant: "destructive" }),
  });

  const write = useMutation({
    mutationFn: () => api("/api/prospects/write", token, { method: "POST", body: JSON.stringify({ limit: 20 }) }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast({
        title: r.written ? `${r.written} researched and drafted` : "Nothing left to draft",
        description: r.remaining ? `${r.remaining} still waiting. Run it again.` : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Could not draft", description: e.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/prospects/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prospects"] }),
  });

  const approve = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) =>
      api(`/api/prospects/${id}/approve`, token, { method: "POST", body: JSON.stringify({ approved: on }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prospects"] }),
    onError: (e: Error) => toast({ title: "Could not approve", description: e.message, variant: "destructive" }),
  });

  const sendOne = useMutation({
    mutationFn: (id: number) => api(`/api/prospects/${id}/send`, token, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospects-config"] });
      toast({ title: "Sent" });
    },
    onError: (e: Error) => toast({ title: "Could not send", description: e.message, variant: "destructive" }),
  });

  const resume = useMutation({
    mutationFn: () => api("/api/prospects/resume", token, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospects-config"] });
      toast({ title: "Sending resumed" });
    },
  });

  const sendAll = useMutation({
    mutationFn: () => api("/api/prospects/send-approved", token, { method: "POST" }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      qc.invalidateQueries({ queryKey: ["prospects-config"] });
      toast({
        title: `${r.sent} sent`,
        description: r.failures?.length ? `${r.failures.length} failed: ${r.failures[0]?.error ?? ""}` : undefined,
        variant: r.sent ? undefined : "destructive",
      });
    },
    onError: (e: Error) => toast({ title: "Could not send", description: e.message, variant: "destructive" }),
  });

  const bulk = useMutation({
    mutationFn: ({ action }: { action: "rewrite" | "discard" }) =>
      api("/api/prospects/bulk", token, {
        method: "POST",
        body: JSON.stringify({ action, status }),
      }),
    onSuccess: (r: { action: string; affected: number }) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      toast({
        title: r.action === "rewrite"
          ? `${r.affected} queued to be written again`
          : `${r.affected} discarded`,
        description: r.action === "rewrite"
          ? "Press Research and draft to write them with the current wording."
          : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Could not do that", description: e.message, variant: "destructive" }),
  });

  const rows = data?.prospects ?? [];
  const counts = data?.counts ?? {};
  const busy = discover.isPending || write.isPending || sendAll.isPending;

  return (
    <div className="space-y-5">
      <p className="max-w-[70ch] text-sm text-muted-foreground">
        Finax finds businesses that move money across a border, works out what they do and which
        side they are on, and writes the first email. It does that on its own every four hours.
        You only need to read and approve.
      </p>

      {/* Where the automatic search has got to. A background job nobody can see
          the state of is one people assume is broken. */}
      {cfg?.schedule && (
        <p className="text-[12px] text-muted-foreground">
          {!cfg.schedule.configured
            ? "Automatic search is idle: APIFY_TOKEN is not set."
            : cfg.schedule.paused
              ? `Automatic search is paused. ${cfg.schedule.waiting} are waiting for you, and it resumes below ${cfg.schedule.queueCap}.`
              : `Searching on its own, ${cfg.schedule.seedsPerCycle} at a time every 4 hours. ` +
                `Position ${cfg.schedule.position} of ${cfg.schedule.total} business types and cities. ` +
                `${cfg.schedule.waiting} waiting for you.`}
        </p>
      )}

      {/* What the last automatic cycle actually did. A zero on its own cannot
          distinguish a working search that found nothing from a broken one,
          which is exactly the confusion this removes. */}
      {cfg?.schedule?.lastResult && (
        <details className="rounded-lg border border-border bg-muted/20 px-4 py-2.5">
          <summary className="cursor-pointer text-[12px] text-muted-foreground">
            Last automatic search: {cfg.schedule.lastResult.inserted} new,{" "}
            {cfg.schedule.lastResult.drafted} drafted
          </summary>
          <div className="mt-2 space-y-1">
            {cfg.schedule.lastResult.lines.map((l, i) => (
              <p key={i} className="font-mono text-[11.5px] leading-relaxed text-muted-foreground">{l}</p>
            ))}
          </div>
        </details>
      )}

      {/* ── sending health ──
          The rates are shown whether or not anything is wrong. A number nobody
          looks at until it matters is a number nobody knows the shape of, and
          the point of a complaint rate is noticing it move. */}
      {cfg && !cfg.canSend && (
        <div className="flex gap-3 rounded-lg border border-red-500/40 bg-red-500/[0.06] p-4">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-500" />
          <div className="flex-1 text-[13px] leading-relaxed">
            <p className="font-medium">Sending is stopped.</p>
            <p className="mt-1 text-muted-foreground">{cfg.reason}</p>
            {cfg.health?.halted && (
              <Button size="sm" variant="outline" className="mt-2.5"
                      disabled={resume.isPending} onClick={() => resume.mutate()}>
                I have looked into it, resume sending
              </Button>
            )}
          </div>
        </div>
      )}

      {cfg?.canSend && cfg.warning && (
        <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-4">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{cfg.warning}</p>
        </div>
      )}

      {cfg?.health && cfg.health.sent > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/20 px-4 py-3 text-[12.5px]">
          <span><span className="tabular-nums font-medium">{cfg.health.sent}</span> sent</span>
          <span className={cn(cfg.health.bounceRate > 0.04 && "text-red-600 dark:text-red-500")}>
            <span className="tabular-nums font-medium">{(cfg.health.bounceRate * 100).toFixed(1)}%</span> bounced
            <span className="ml-1 text-muted-foreground">({cfg.health.bounced}, stop at 4%)</span>
          </span>
          <span className={cn(cfg.health.complaintRate > 0.0025 && "text-red-600 dark:text-red-500")}>
            <span className="tabular-nums font-medium">{(cfg.health.complaintRate * 100).toFixed(2)}%</span> marked spam
            <span className="ml-1 text-muted-foreground">({cfg.health.complained}, stop at 0.25%)</span>
          </span>
          {!cfg.health.meaningful && (
            <span className="text-muted-foreground">too few sent for these to mean much yet</span>
          )}
        </div>
      )}

      {/* ── find ── */}
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="What kind of business, e.g. freight forwarder"
            className="rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <input
            value={location} onChange={e => setLocation(e.target.value)}
            placeholder="Where, e.g. Tema, Ghana"
            className="rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <select
            value={seedSegment} onChange={e => setSeedSegment(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-[13px]"
          >
            <option value="hedger">Needs cover</option>
            <option value="underwriter">Could underwrite</option>
            <option value="psp">Payments</option>
            <option value="bank">Bank</option>
          </select>
        </div>

        {cfg?.seeds?.queries?.[seedSegment] && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {cfg.seeds.queries[seedSegment].slice(0, 9).map(q => (
              <button
                key={q}
                onClick={() => setQuery(q)}
                className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={!enabled || busy || !cfg?.discovery} onClick={() => discover.mutate()}>
            {discover.isPending
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Searching…</>
              : <><Search className="mr-1.5 h-3.5 w-3.5" /> Find businesses</>}
          </Button>
          <Button size="sm" variant="outline" disabled={!enabled || busy} onClick={() => write.mutate()}>
            {write.isPending
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Writing…</>
              : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Research and draft</>}
          </Button>
          <Button
            size="sm" variant="outline"
            disabled={!enabled || busy || !cfg?.canSend || !counts.approved}
            onClick={() => {
              if (window.confirm(`Send ${counts.approved} approved email${counts.approved === 1 ? "" : "s"} now?`)) {
                sendAll.mutate();
              }
            }}
          >
            {sendAll.isPending
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Sending…</>
              : <><Send className="mr-1.5 h-3.5 w-3.5" /> Send {counts.approved || 0} approved</>}
          </Button>
          {cfg && (
            <span className="self-center text-[11.5px] text-muted-foreground">
              {cfg.sentToday} of {cfg.dailyCap} sent today
              {cfg.from ? ` · from ${cfg.from}` : ""}
              {/* Whether a copy is being kept somewhere readable. Mail sent
                  through Resend never appears in a Sent folder, so without this
                  there is no way to tell from a mailbox that anything went. */}
              {cfg.bcc ? ` · copied to ${cfg.bcc}` : " · no copy kept, set OUTREACH_BCC"}
              {cfg.replyTo ? ` · replies to ${cfg.replyTo}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── filters ── */}
      <div className="flex flex-wrap gap-1.5">
        {[["all", "All"], ["new", "New"], ["drafted", "Drafted"], ["approved", "Approved"], ["sent", "Sent"]].map(([k, l]) => (
          <button
            key={k} onClick={() => setStatus(k)}
            className={cn("rounded-md border px-3 py-1.5 text-[12.5px]",
              status === k ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {l}{counts[k] !== undefined && <span className="ml-1.5 text-[11px] opacity-70">{counts[k]}</span>}
          </button>
        ))}
        <span className="ml-auto self-center text-[11.5px] text-muted-foreground">
          {counts.sendable ?? 0} contactable · {counts.blocked ?? 0} need consent
        </span>
      </div>

      {/* Clearing the queue. Rewrite is first and is nearly always the one
          wanted after the wording changes: the businesses cost money to find
          and are still good, only the words are stale. Discard throws the
          research away too, which is why it is the quieter button. */}
      {(counts.all ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm" variant="outline" disabled={!enabled || bulk.isPending}
            onClick={() => {
              const n = counts[status] ?? counts.all ?? 0;
              if (window.confirm(
                `Write ${n} email${n === 1 ? "" : "s"} again with the current wording?\n\n` +
                `The businesses are kept. Only the drafted text is cleared, and anything ` +
                `already sent is untouched.`,
              )) bulk.mutate({ action: "rewrite" });
            }}
          >
            {bulk.isPending && bulk.variables?.action === "rewrite"
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Clearing…</>
              : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Rewrite all</>}
          </Button>
          <Button
            size="sm" variant="ghost" disabled={!enabled || bulk.isPending}
            onClick={() => {
              const n = counts[status] ?? counts.all ?? 0;
              if (window.confirm(
                `Discard ${n} prospect${n === 1 ? "" : "s"}?\n\n` +
                `This throws away the businesses too, not just the emails. If you only ` +
                `want new wording, use Rewrite all instead.`,
              )) bulk.mutate({ action: "discard" });
            }}
          >
            Discard all
          </Button>
          <span className="text-[11.5px] text-muted-foreground">
            {status === "all" ? "everything not yet sent" : `everything showing as ${status}`}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !rows.length ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Nothing here yet. Pick a business type and a city, then press Find businesses.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(p => (
            <div key={p.id} className={cn("rounded-lg border p-4",
              p.sentAt ? "border-border bg-muted/5"
              : p.approvedAt ? "border-emerald-500/40 bg-emerald-500/[0.04]"
              : !p.sendable ? "border-border bg-muted/5 opacity-80"
              : "border-border bg-muted/10")}>

              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.company}</span>
                    <span className={cn("text-[11.5px]", SEGMENTS[p.segment]?.tone)}>
                      {SEGMENTS[p.segment]?.label ?? p.segment}
                    </span>
                    {p.fitScore !== null && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">fit {p.fitScore}</span>
                    )}
                    {p.country && <span className="text-[11px] text-muted-foreground">{p.country}</span>}
                    {p.sentAt && (
                      <span
                        // The provider id is the only evidence the message left
                        // our side. "Sent" without it would just mean we tried.
                        title={p.providerMessageId
                          ? `Resend id ${p.providerMessageId}\nSent ${new Date(p.sentAt).toLocaleString()}`
                          : `Sent ${new Date(p.sentAt).toLocaleString()}`}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-500"
                      >
                        <Check className="h-3 w-3" /> sent
                        {p.providerMessageId && (
                          <span className="font-mono opacity-70">
                            {p.providerMessageId.slice(0, 8)}
                          </span>
                        )}
                      </span>
                    )}
                    {p.website && (
                      <a href={p.website} target="_blank" rel="noreferrer noopener"
                         className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline">
                        site <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">{p.email}</p>
                  {p.description && <p className="mt-1 text-[12.5px] text-muted-foreground">{p.description}</p>}
                  {p.fit && (
                    <p className="mt-1.5 border-l-2 border-border pl-2.5 text-[12.5px] leading-relaxed">{p.fit}</p>
                  )}
                </div>
              </div>

              {/* Why this one cannot be emailed, kept visible rather than hidden. */}
              {!p.sendable && (
                <p className="mt-2.5 flex gap-2 rounded-md bg-muted/40 p-2.5 text-[12px] text-muted-foreground">
                  <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {p.sendableReason}
                </p>
              )}

              {p.draftBody && p.sendable && (
                <div className="mt-3 space-y-2">
                  <input
                    defaultValue={p.draftSubject ?? ""}
                    onBlur={e => e.target.value.trim() !== p.draftSubject &&
                      update.mutate({ id: p.id, body: { draftSubject: e.target.value } })}
                    disabled={!!p.sentAt}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                  />
                  <textarea
                    defaultValue={p.draftBody}
                    onBlur={e => e.target.value.trim() !== p.draftBody &&
                      update.mutate({ id: p.id, body: { draftBody: e.target.value } })}
                    disabled={!!p.sentAt}
                    rows={Math.min(10, Math.max(4, Math.ceil(p.draftBody.length / 78)))}
                    className="w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                  />
                  {!p.sentAt && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={p.approvedAt ? "outline" : "default"}
                        onClick={() => approve.mutate({ id: p.id, on: !p.approvedAt })}
                      >
                        {p.approvedAt ? "Approved, undo" : "Approve"}
                      </Button>
                      {p.approvedAt && cfg?.canSend && (
                        <Button size="sm" variant="outline" disabled={sendOne.isPending}
                                onClick={() => sendOne.mutate(p.id)}>
                          <Send className="mr-1.5 h-3.5 w-3.5" /> Send this one
                        </Button>
                      )}
                      <Button size="sm" variant="ghost"
                              onClick={() => update.mutate({ id: p.id, body: { status: "rejected" } })}>
                        Discard
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
