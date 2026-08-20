/**
 * outreach-memory.tsx — what Finax knows about why, and the market it can see.
 *
 * The rate history answers what a currency did. It cannot answer why, and a
 * comment that cites a move without a mechanism reads as a bot with a
 * calculator. This is where the other half lives: a policy decision, an IMF
 * tranche, a paper worth citing.
 *
 * Every entry carries an as-of date, and the date field is required rather than
 * defaulted to today. "The Bank of Ghana holds at 27%" is worth quoting in March
 * and wrong by September, and a drafting tool that cannot tell the difference
 * will state the stale one with exactly the same confidence. The retrieval
 * side decays with age and tells the drafter how old each fact is, so it can
 * write "as of March" instead of implying the present tense.
 *
 * The Market panel underneath shows the computed picture. It exists so that
 * when a draft cites a surprising number, it can be checked before posting.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, BookOpen, EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Memory {
  id: number;
  kind: string;
  title: string;
  body: string;
  sourceName: string | null;
  sourceUrl: string | null;
  asOf: string;
  tags: string | null;
  pair: string | null;
  active: boolean;
}

interface Brief {
  pair: string;
  spot: number;
  asOf: string;
  move30: number | null;
  move90: number | null;
  moveYtd: number | null;
  vol30: number | null;
  vol90: number | null;
  volPercentile: number | null;
  volPercentileFrom: string | null;
  worst30: number | null;
  jumpDays: number | null;
}

const KINDS = ["news", "policy", "research", "data", "insight"] as const;

async function api(url: string, token: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers, "x-admin-token": token },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

const sign = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const mag = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

export function OutreachMemory({ token }: { token: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    kind: "news", title: "", body: "", sourceName: "", sourceUrl: "",
    asOf: new Date().toISOString().slice(0, 10), tags: "", pair: "",
  });

  const { data: mem, isLoading } = useQuery<{ memory: Memory[] }>({
    queryKey: ["outreach-memory", token],
    queryFn: () => api("/api/outreach/memory?all=1", token),
  });

  const { data: briefs } = useQuery<{ briefs: Brief[] }>({
    queryKey: ["outreach-brief", token],
    queryFn: () => api("/api/outreach/brief", token),
  });

  const add = useMutation({
    mutationFn: () => api("/api/outreach/memory", token, { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      setForm(f => ({ ...f, title: "", body: "", sourceName: "", sourceUrl: "", tags: "", pair: "" }));
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["outreach-memory"] });
      toast({ title: "Saved", description: "Finax will use it when it's relevant." });
    },
    onError: (e: Error) => toast({ title: "Couldn't save that", description: e.message, variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      api(`/api/outreach/memory/${id}`, token, { method: "PATCH", body: JSON.stringify({ active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach-memory"] }),
  });

  const rows = mem?.memory ?? [];

  return (
    <div className="space-y-6">
      {/* ── what the market is doing, computed ── */}
      <div>
        <h3 className="mb-1 text-sm font-medium">What Finax can see</h3>
        <p className="mb-3 max-w-[68ch] text-[12.5px] text-muted-foreground">
          Computed from your own daily closes each time a draft is written, so it can't go stale and
          can't be invented. This is what a comment is allowed to quote.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead className="bg-muted/30 text-left text-muted-foreground">
              <tr>
                {["Pair", "Spot", "30d", "90d", "YTD", "Vol 90d", "Percentile", "Worst 30d", "Jumps 1y"].map(h => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {(briefs?.briefs ?? []).map(b => (
                <tr key={b.pair} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{b.pair}</td>
                  <td className="px-3 py-2">{b.spot.toFixed(4)}</td>
                  <td className="px-3 py-2">{sign(b.move30)}</td>
                  <td className="px-3 py-2">{sign(b.move90)}</td>
                  <td className="px-3 py-2">{sign(b.moveYtd)}</td>
                  <td className="px-3 py-2">{mag(b.vol90)}</td>
                  <td className="px-3 py-2">
                    {b.volPercentile === null ? "—" : (
                      <span className={cn(
                        b.volPercentile >= 80 && "text-orange-500",
                        b.volPercentile <= 20 && "text-blue-500",
                      )}>
                        {b.volPercentile}th{b.volPercentileFrom ? ` since ${b.volPercentileFrom}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{sign(b.worst30)}</td>
                  <td className="px-3 py-2">{b.jumpDays ?? "—"}</td>
                </tr>
              ))}
              {!briefs?.briefs?.length && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── the curated facts ── */}
      <div>
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">What Finax knows about why</h3>
          <Button size="sm" variant="outline" onClick={() => setOpen(o => !o)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add a fact
          </Button>
        </div>
        <p className="mb-3 max-w-[68ch] text-[12.5px] text-muted-foreground">
          Policy decisions, research, news. Each one is dated, and Finax quotes it with its age —
          "as of March", never as though it were today.
        </p>

        {open && (
          <div className="mb-4 space-y-2.5 rounded-lg border border-border bg-muted/20 p-4">
            <div className="grid gap-2.5 sm:grid-cols-3">
              <select
                value={form.kind}
                onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}
                className="rounded-md border border-border bg-background px-3 py-2 text-[13px]"
              >
                {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <input
                type="date"
                value={form.asOf}
                onChange={e => setForm(f => ({ ...f, asOf: e.target.value }))}
                className="rounded-md border border-border bg-background px-3 py-2 text-[13px]"
              />
              <input
                value={form.pair}
                onChange={e => setForm(f => ({ ...f, pair: e.target.value }))}
                placeholder="Pair, e.g. USD/GHS"
                className="rounded-md border border-border bg-background px-3 py-2 text-[13px]"
              />
            </div>
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="One line — what a reader takes away"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
            />
            <textarea
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="A few sentences of substance. What makes this quotable?"
              rows={3}
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[13px]"
            />
            <div className="grid gap-2.5 sm:grid-cols-3">
              <input
                value={form.sourceName}
                onChange={e => setForm(f => ({ ...f, sourceName: e.target.value }))}
                placeholder="Source, e.g. Bank of Ghana"
                className="rounded-md border border-border bg-background px-3 py-2 text-[13px]"
              />
              <input
                value={form.sourceUrl}
                onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))}
                placeholder="Link"
                className="rounded-md border border-border bg-background px-3 py-2 text-[13px]"
              />
              <input
                value={form.tags}
                onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                placeholder="Tags, comma separated"
                className="rounded-md border border-border bg-background px-3 py-2 text-[13px]"
              />
            </div>
            <Button
              onClick={() => add.mutate()}
              disabled={add.isPending || form.title.trim().length < 4 || form.body.trim().length < 20}
            >
              {add.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : "Save"}
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !rows.length ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center">
            <BookOpen className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nothing yet. Add the policy decisions and research you'd want quoted.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(m => (
              <div
                key={m.id}
                className={cn(
                  "rounded-lg border border-border p-3.5",
                  m.active ? "bg-muted/10" : "bg-transparent opacity-55",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {m.kind}
                      </span>
                      {m.pair && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px]">{m.pair}</span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        as of {new Date(m.asOf).toISOString().slice(0, 10)}
                      </span>
                    </div>
                    <p className="mt-1 text-[13.5px] font-medium">{m.title}</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{m.body}</p>
                    {m.sourceName && (
                      <p className="mt-1 text-[11.5px] text-muted-foreground">
                        {m.sourceUrl ? (
                          <a href={m.sourceUrl} target="_blank" rel="noreferrer noopener" className="hover:underline">
                            {m.sourceName}
                          </a>
                        ) : m.sourceName}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => toggle.mutate({ id: m.id, active: !m.active })}
                    title={m.active ? "Retire this fact" : "Bring it back"}
                    className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
                  >
                    {m.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
