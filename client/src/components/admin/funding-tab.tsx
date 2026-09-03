/**
 * funding-tab.tsx — the fundraising pipeline, inside the agent session.
 *
 * Distinct from the Investors tab, which is outreach: who to write to, and
 * sending it. This is the other half, what there is to apply for and how far
 * each one has got.
 *
 * The review queue is the point of the layout. A discovery sweep proposes
 * candidates and none of them count until a person says so, so unreviewed rows
 * sit above the pipeline rather than mixed into it. Anything already decided is
 * out of sight unless asked for.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Search, ExternalLink, Check, X, Plus, AlertTriangle, CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

async function api(url: string, token: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers, "x-admin-token": token },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || `Request failed (${res.status})`);
  return body;
}

interface Opp {
  id: number; name: string; funder: string | null; kind: string; url: string | null;
  amountMin: number | null; amountMax: number | null; currency: string;
  deadline: string | null; rolling: boolean; stage: string; fit: number | null;
  rationale: string | null; source: string; owner: string | null;
  daysToDeadline: number | null;
}

const STAGES = ["candidate", "researching", "drafting", "submitted", "interview", "won", "lost", "passed"];
const WORKING = ["researching", "drafting", "submitted", "interview"];

const money = (min: number | null, max: number | null, ccy: string) => {
  const f = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
  if (min && max && min !== max) return `${ccy} ${f(min)}–${f(max)}`;
  const one = max ?? min;
  return one ? `${ccy} ${f(one)}` : "amount not stated";
};

/** The countdown, said the way a person would say it. */
function due(o: Opp): { text: string; tone: "urgent" | "soon" | "calm" | "gone" } {
  if (o.daysToDeadline === null) return { text: o.rolling ? "rolling" : "no deadline given", tone: "calm" };
  const d = o.daysToDeadline;
  if (d < 0) return { text: `closed ${Math.abs(d)} days ago`, tone: "gone" };
  if (d === 0) return { text: "closes today", tone: "urgent" };
  if (d <= 14) return { text: `${d} days left`, tone: "urgent" };
  if (d <= 45) return { text: `${d} days left`, tone: "soon" };
  return { text: `${d} days left`, tone: "calm" };
}

const toneClass = {
  urgent: "text-red-600 dark:text-red-400",
  soon: "text-amber-600 dark:text-amber-400",
  calm: "text-muted-foreground",
  gone: "text-muted-foreground line-through",
};

function Row({
  o, token, onDone, compact,
}: { o: Opp; token: string; onDone: () => void; compact?: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const d = due(o);

  const move = async (stage: string) => {
    setBusy(true);
    try {
      await api(`/api/funding/opportunities/${o.id}/stage`, token, {
        method: "POST", body: JSON.stringify({ stage }),
      });
      toast({ title: "Moved", description: `${o.name} is now ${stage}.` });
      onDone();
    } catch (e: any) {
      toast({ title: "Not moved", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{o.name}</span>
            {o.fit != null && (
              <span className="flex-none rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                fit {o.fit}
              </span>
            )}
            {o.source === "search" && (
              <span className="flex-none rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                found by sweep
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {o.funder && <span>{o.funder}</span>}
            <span className="capitalize">{o.kind}</span>
            <span className="tabular-nums">{money(o.amountMin, o.amountMax, o.currency)}</span>
            <span className={cn("tabular-nums", toneClass[d.tone])}>{d.text}</span>
          </div>
          {o.rationale && !compact && (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{o.rationale}</p>
          )}
        </div>
        {o.url && (
          <a
            href={o.url} target="_blank" rel="noopener noreferrer"
            className="flex-none text-muted-foreground hover:text-foreground"
            title="Open the programme page"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : o.stage === "candidate" ? (
          <>
            {/* A candidate has two answers, and both are decisions. Passing is
                recorded rather than deleted so the sweep does not propose it
                again next week. */}
            <Button size="sm" className="h-7 text-xs" onClick={() => move("researching")}>
              <Check className="mr-1 h-3 w-3" /> Worth pursuing
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => move("passed")}>
              <X className="mr-1 h-3 w-3" /> Not for us
            </Button>
          </>
        ) : (
          <select
            value={o.stage}
            onChange={(e) => move(e.target.value)}
            className="h-7 rounded border border-border bg-background px-2 text-xs capitalize"
          >
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

export function FundingTab({ token }: { token: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", funder: "", url: "", deadline: "", amountMax: "" });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["funding-opps"] });
    qc.invalidateQueries({ queryKey: ["funding-summary"] });
  };

  const { data: summary } = useQuery({
    queryKey: ["funding-summary"],
    queryFn: () => api("/api/funding/summary", token),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["funding-opps", showClosed],
    queryFn: () => api(`/api/funding/opportunities?includeClosed=${showClosed}`, token),
  });

  const sweepM = useMutation({
    mutationFn: () => api("/api/funding/sweep", token, { method: "POST" }),
    onSuccess: (r: any) => {
      toast({
        title: r.added?.length ? `${r.added.length} new to review` : "Nothing new",
        description: r.added?.length
          ? `${r.proposed} proposed, ${r.droppedDuplicate} already tracked, ${r.droppedUnreachable} dropped for a dead link.`
          : `${r.proposed} proposed but none survived: ${r.droppedDuplicate} already tracked, ${r.droppedUnreachable} had links that did not resolve.`,
      });
      refresh();
    },
    onError: (e: any) => toast({ title: "Sweep failed", description: e.message, variant: "destructive" }),
  });

  const addM = useMutation({
    mutationFn: () => api("/api/funding/opportunities", token, {
      method: "POST",
      body: JSON.stringify({
        name: form.name, funder: form.funder || undefined, url: form.url || undefined,
        deadline: form.deadline || undefined,
        amountMax: form.amountMax ? Number(form.amountMax) : undefined,
      }),
    }),
    onSuccess: () => {
      toast({ title: "Added", description: `${form.name} is in the pipeline.` });
      setForm({ name: "", funder: "", url: "", deadline: "", amountMax: "" });
      setAdding(false); refresh();
    },
    onError: (e: any) => toast({ title: "Not added", description: e.message, variant: "destructive" }),
  });

  const opps: Opp[] = data?.opportunities ?? [];
  const candidates = opps.filter((o) => o.stage === "candidate");
  const working = opps.filter((o) => WORKING.includes(o.stage));
  const closed = opps.filter((o) => ["won", "lost", "passed"].includes(o.stage));
  const missed: Opp[] = summary?.missed ?? [];

  return (
    <div className="space-y-4 py-4">
      {/* Numbers first, because the question is usually "how much is in play". */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["To review", summary?.awaitingReview ?? 0, ""],
          ["In progress", working.length, ""],
          ["In play", summary ? `$${Math.round((summary.liveRangeMax ?? 0) / 1000)}k` : "—", "if everything open landed"],
          ["Won", summary ? `$${Math.round((summary.wonMax ?? 0) / 1000)}k` : "—", ""],
        ].map(([label, value, hint]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-card p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
            {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => sweepM.mutate()} disabled={sweepM.isPending}>
          {sweepM.isPending
            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Searching…</>
            : <><Search className="mr-1.5 h-3.5 w-3.5" /> Search for opportunities</>}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add one I know of
        </Button>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show decided
        </label>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A search runs Claude against the live web and files what it finds for review. Nothing it
        proposes counts until you say so, and anything whose link does not resolve is dropped before
        you see it.
      </p>

      {adding && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          {([
            ["name", "Name, e.g. Base Builder Grants"],
            ["funder", "Funder, e.g. Coinbase"],
            ["url", "Link to the programme"],
            ["deadline", "Deadline, YYYY-MM-DD, or leave blank if rolling"],
            ["amountMax", "Most it could award, in dollars"],
          ] as const).map(([k, ph]) => (
            <input
              key={k} placeholder={ph} value={(form as any)[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            />
          ))}
          <Button size="sm" onClick={() => addM.mutate()} disabled={!form.name.trim() || addM.isPending}>
            {addM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
          </Button>
        </div>
      )}

      {/* A deadline gone by on something still being worked is the one thing
          worth interrupting for, so it sits above everything else. */}
      {missed.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            {missed.length} deadline{missed.length === 1 ? "" : "s"} passed while still open
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {missed.map((m) => (
              <li key={m.id} className="text-xs text-red-700/90 dark:text-red-400/90">
                {m.name}, {Math.abs(m.daysToDeadline!)} days ago, still marked {m.stage}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {candidates.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" /> Waiting for you ({candidates.length})
              </h3>
              {candidates.map((o) => <Row key={o.id} o={o} token={token} onDone={refresh} />)}
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              In progress ({working.length})
            </h3>
            {working.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                Nothing being worked on. Run a search, or add one you already know about.
              </p>
            ) : working.map((o) => <Row key={o.id} o={o} token={token} onDone={refresh} compact />)}
          </section>

          {showClosed && closed.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Decided ({closed.length})
              </h3>
              {closed.map((o) => <Row key={o.id} o={o} token={token} onDone={refresh} compact />)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
