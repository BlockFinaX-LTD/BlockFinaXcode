/**
 * research-tab.tsx, the morning reading.
 *
 * Sorted by what it means rather than by when it arrived. A feed reader already
 * sorts by time and that is exactly why nobody finishes one: the most recent
 * item is rarely the one worth ten minutes.
 *
 * Each row leads with why it matters to BlockFinaX, and the headline is
 * secondary. The headline is the publication's pitch to everybody; the line
 * underneath is the only part written for this business.
 *
 * "Keep" is the point of the section. It pushes the item into Finax's memory,
 * dated to when it was published, where the outreach drafter can cite it. A
 * research feed nobody acts on is a second inbox.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ExternalLink, RefreshCw, BookmarkPlus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Item {
  id: number; title: string; url: string; source: string; kind: string;
  summary: string | null; publishedAt: string | null;
  relevance: string | null; importance: number | null;
  status: string; savedToMemoryAt: string | null;
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

function ago(iso: string | null): string {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function ResearchTab({ token, enabled }: { token: string; enabled: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState("unread");

  const { data, isLoading } = useQuery<{
    items: Item[];
    counts: Record<string, number>;
    schedule: { lastRunDay: string | null; hourUtc: number } | null;
  }>({
    queryKey: ["research", status, token],
    queryFn: () => api(`/api/research?status=${status}`, token),
  });

  const refresh = useMutation({
    mutationFn: () => api("/api/research/refresh", token, { method: "POST" }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["research"] });
      toast({
        title: r.briefed ? `${r.briefed} worth reading` : "Nothing new worth briefing",
        description: `${r.fetched} items across the feeds, ${r.fresh} not seen before` +
          (r.errors?.length ? ` · ${r.errors[0]}` : ""),
      });
    },
    onError: (e: Error) => toast({ title: "Could not refresh", description: e.message, variant: "destructive" }),
  });

  const setStatusOf = useMutation({
    mutationFn: ({ id, s }: { id: number; s: string }) =>
      api(`/api/research/${id}`, token, { method: "PATCH", body: JSON.stringify({ status: s }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["research"] }),
  });

  const keep = useMutation({
    mutationFn: (id: number) => api(`/api/research/${id}/save`, token, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["research"] });
      qc.invalidateQueries({ queryKey: ["outreach-memory"] });
      toast({
        title: "Kept",
        description: "Finax can now cite this when it writes, with the date it was published.",
      });
    },
    onError: (e: Error) => toast({ title: "Could not keep that", description: e.message, variant: "destructive" }),
  });

  const items = data?.items ?? [];
  const counts = data?.counts ?? {};

  return (
    <div className="space-y-4">
      <p className="max-w-[70ch] text-sm text-muted-foreground">
        Eleven feeds, read every morning: business press in Ghana, Nigeria and Kenya, the Central
        Bank of Kenya, pan-African analysis, global markets, and quantitative finance papers. Sorted
        by what it means for the book rather than by when it landed.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!enabled || refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending
            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Reading…</>
            : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Fetch now</>}
        </Button>
        {data?.schedule && (
          <span className="text-[11.5px] text-muted-foreground">
            Runs each morning after {String(data.schedule.hourUtc).padStart(2, "0")}:00 UTC
            {data.schedule.lastRunDay ? ` · last ran ${data.schedule.lastRunDay}` : " · not run yet"}
            {counts.collectedNotBriefed ? ` · ${counts.collectedNotBriefed} collected but not relevant enough to brief` : ""}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[["unread", "To read"], ["saved", "Kept"], ["dismissed", "Dismissed"], ["all", "Everything"]].map(([k, l]) => (
          <button
            key={k} onClick={() => setStatus(k)}
            className={cn("rounded-md border px-3 py-1.5 text-[12.5px]",
              status === k ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {l}{counts[k] !== undefined && <span className="ml-1.5 text-[11px] opacity-70">{counts[k]}</span>}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !items.length ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {status === "unread" ? "Nothing waiting. Press Fetch now, or wait for the morning run." : `Nothing ${status}.`}
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map(it => (
            <div key={it.id} className="rounded-lg border border-border bg-muted/10 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                {/* Importance leads, because it is the only number here that
                    decides whether to spend time on the row at all. */}
                <span className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                  (it.importance ?? 0) >= 70 ? "bg-red-500/10 text-red-600 dark:text-red-500"
                  : (it.importance ?? 0) >= 40 ? "bg-amber-500/10 text-amber-600 dark:text-amber-500"
                  : "bg-muted text-muted-foreground",
                )}>
                  {it.importance}
                </span>
                <span className="text-[11.5px] text-muted-foreground">{it.source}</span>
                {it.publishedAt && (
                  <span className="text-[11.5px] text-muted-foreground">{ago(it.publishedAt)}</span>
                )}
                {it.savedToMemoryAt && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-500">
                    <Check className="h-3 w-3" /> in memory
                  </span>
                )}
              </div>

              {/* Why it matters first. The headline is the publication's pitch
                  to everybody; this line is the only part written for us. */}
              {it.relevance && (
                <p className="mt-1.5 text-[13.5px] leading-relaxed">{it.relevance}</p>
              )}

              <a
                href={it.url} target="_blank" rel="noreferrer noopener"
                className="mt-1.5 inline-flex items-start gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                {it.title}
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
              </a>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {!it.savedToMemoryAt && (
                  <button
                    onClick={() => keep.mutate(it.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11.5px] text-muted-foreground hover:text-foreground"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" /> Keep for Finax
                  </button>
                )}
                {it.status !== "read" && (
                  <button
                    onClick={() => setStatusOf.mutate({ id: it.id, s: "read" })}
                    className="rounded-md border border-border px-2 py-1 text-[11.5px] text-muted-foreground hover:text-foreground"
                  >
                    Mark read
                  </button>
                )}
                {it.status !== "dismissed" && (
                  <button
                    onClick={() => setStatusOf.mutate({ id: it.id, s: "dismissed" })}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11.5px] text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" /> Not useful
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
