/**
 * investors-tab.tsx, the pre-seed raise.
 *
 * Shares everything below the surface with the business pipeline: the same
 * sending domain, the same circuit breaker, the same suppression list, the same
 * approve-then-send. One outbound reputation rather than two, and one place a
 * bad week gets caught.
 *
 * What differs is the message and how the names arrive.
 *
 * Investors are typed in rather than crawled. A places search finds firms with
 * an office and a website, which is how you find importers in Tema and is not
 * how you find the fund that leads African fintech pre-seed. Those are known by
 * name, from a list or an introduction, and Anthony's list will always beat a
 * crawl's.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Send, Check, ExternalLink, Plus, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface P {
  id: number; company: string; website: string | null; country: string | null;
  evidence: string | null; email: string; contactName: string | null;
  fit: string | null; fitScore: number | null;
  sendable: boolean; sendableReason: string | null;
  status: string; draftSubject: string | null; draftBody: string | null;
  approvedAt: string | null; sentAt: string | null; providerMessageId: string | null;
}

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

/**
 * One investor per line: firm, email, then anything else you know.
 *
 * Deliberately forgiving about the extra columns. A list pasted from a
 * spreadsheet or an email will not have consistent fields, and refusing a row
 * for missing a focus note would mean retyping the list to satisfy a form.
 */
function parseList(text: string) {
  return text.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
    const parts = line.split(/\s*[,\t|]\s*/);
    const email = parts.find(p => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(p)) ?? "";
    const rest = parts.filter(p => p !== email);
    return {
      firm: rest[0] ?? "",
      email,
      focus: rest.slice(1).join(", ") || undefined,
    };
  }).filter(r => r.firm && r.email);
}

export function InvestorsTab({ token, enabled }: { token: string; enabled: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [paste, setPaste] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data: cfg } = useQuery<any>({
    queryKey: ["prospects-config", token],
    queryFn: () => api("/api/prospects/config", token),
  });

  const { data, isLoading } = useQuery<{ prospects: P[]; counts: Record<string, number> }>({
    queryKey: ["investors", token],
    queryFn: () => api("/api/prospects?segment=investor&status=all", token),
  });

  const add = useMutation({
    mutationFn: () => api("/api/prospects/investors/add", token, {
      method: "POST", body: JSON.stringify({ investors: parseList(paste) }),
    }),
    onSuccess: (r: any) => {
      setPaste(""); setShowAdd(false);
      qc.invalidateQueries({ queryKey: ["investors"] });
      toast({
        title: r.added ? `${r.added} added` : "Nothing added",
        description: r.skipped ? `${r.skipped} skipped, already there or missing a firm or email` : undefined,
        variant: r.added ? undefined : "destructive",
      });
    },
    onError: (e: Error) => toast({ title: "Could not add", description: e.message, variant: "destructive" }),
  });

  const write = useMutation({
    mutationFn: () => api("/api/prospects/investors/write", token, {
      method: "POST", body: JSON.stringify({ limit: 10 }),
    }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["investors"] });
      toast({
        title: r.written ? `${r.written} drafted` : "Nothing left to draft",
        description: r.traction
          ? `Using ${r.traction.poolsSettled} settled pools and ${r.traction.closes?.toLocaleString()} closes. No other figures.`
          : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Could not draft", description: e.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/prospects/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investors"] }),
  });

  const approve = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) =>
      api(`/api/prospects/${id}/approve`, token, { method: "POST", body: JSON.stringify({ approved: on }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investors"] }),
    onError: (e: Error) => toast({ title: "Could not approve", description: e.message, variant: "destructive" }),
  });

  const send = useMutation({
    mutationFn: (id: number) => api(`/api/prospects/${id}/send`, token, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investors"] });
      qc.invalidateQueries({ queryKey: ["prospects-config"] });
      toast({ title: "Sent" });
    },
    onError: (e: Error) => toast({ title: "Could not send", description: e.message, variant: "destructive" }),
  });

  const rows = data?.prospects ?? [];

  return (
    <div className="space-y-4">
      <p className="max-w-[70ch] text-sm text-muted-foreground">
        Add the funds and angels you want to reach, and Finax writes the first email using only
        what the book can actually evidence: pools settled on mainnet and the price history behind
        the pricing.{" "}
        <span className="text-foreground">It is not allowed to round up, project, or invent a
        number</span>, because an overstated figure in a first email gets repeated into a deck and
        found in diligence.
      </p>

      {cfg && !cfg.canSend && (
        <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-4">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{cfg.reason}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowAdd(v => !v)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add investors
        </Button>
        <Button size="sm" variant="outline" disabled={!enabled || write.isPending} onClick={() => write.mutate()}>
          {write.isPending
            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Writing…</>
            : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Draft the new ones</>}
        </Button>
        {cfg && (
          <span className="self-center text-[11.5px] text-muted-foreground">
            {cfg.sentToday} of {cfg.dailyCap} sent today across all outbound
          </span>
        )}
      </div>

      {showAdd && (
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <p className="mb-2 text-[12.5px] text-muted-foreground">
            One per line: firm, email, then anything you know about their focus. Commas or tabs.
          </p>
          <textarea
            value={paste}
            onChange={e => setPaste(e.target.value)}
            rows={7}
            placeholder={"Ventures Platform, hello@venturesplatform.com, pre-seed Africa fintech\nIngressive Capital, team@ingressivecapital.com, pre-seed African tech"}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 font-mono text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" disabled={add.isPending || parseList(paste).length === 0} onClick={() => add.mutate()}>
              {add.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Add {parseList(paste).length || ""}
            </Button>
            <span className="text-[11.5px] text-muted-foreground">
              {paste.trim() && parseList(paste).length === 0
                ? "No usable rows yet. Each line needs a firm and an email."
                : "Lines without both a firm and an email are skipped."}
            </span>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !rows.length ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No investors yet. Press Add investors and paste your list.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(p => (
            <div key={p.id} className={cn("rounded-lg border p-4",
              p.sentAt ? "border-border bg-muted/5"
              : p.approvedAt ? "border-emerald-500/40 bg-emerald-500/[0.04]"
              : "border-border bg-muted/10")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.company}</span>
                {p.fitScore !== null && (
                  <span className="text-[11px] tabular-nums text-muted-foreground">fit {p.fitScore}</span>
                )}
                {p.country && <span className="text-[11px] text-muted-foreground">{p.country}</span>}
                {p.sentAt && (
                  <span
                    title={p.providerMessageId ? `Resend id ${p.providerMessageId}` : undefined}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-500"
                  >
                    <Check className="h-3 w-3" /> sent
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
              {p.fit && <p className="mt-1.5 border-l-2 border-border pl-2.5 text-[12.5px] leading-relaxed">{p.fit}</p>}
              {!p.sendable && (
                <p className="mt-2 rounded-md bg-muted/40 p-2.5 text-[12px] text-muted-foreground">{p.sendableReason}</p>
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
                    rows={Math.min(12, Math.max(5, Math.ceil(p.draftBody.length / 78)))}
                    className="w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                  />
                  {!p.sentAt && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant={p.approvedAt ? "outline" : "default"}
                              onClick={() => approve.mutate({ id: p.id, on: !p.approvedAt })}>
                        {p.approvedAt ? "Approved, undo" : "Approve"}
                      </Button>
                      {p.approvedAt && cfg?.canSend && (
                        <Button size="sm" variant="outline" disabled={send.isPending}
                                onClick={() => send.mutate(p.id)}>
                          <Send className="mr-1.5 h-3.5 w-3.5" /> Send
                        </Button>
                      )}
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
