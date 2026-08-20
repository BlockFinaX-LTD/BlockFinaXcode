/**
 * Agent — the admin surface for the mini-CEO.
 *
 * Four tabs:
 *   Chat      ask it about the business; every figure comes from a tool call
 *   Queue     proposals awaiting a decision, with Approve / Edit / Reject
 *   Training  learned rules, memory, and the autonomy dial
 *   Activity  runs, tokens and real spend
 *
 * The tool calls behind each answer are shown deliberately. An agent that
 * states a revenue figure should be able to show where it read it, and being
 * able to see that at a glance is what makes it trustworthy enough to act on.
 */

import { useState, useRef, useEffect } from "react";
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
  Bot, Send, Sparkles, Check, X, Pencil, Trash2, Loader2, AlertTriangle,
  BrainCircuit, Activity, Inbox, Plus, RefreshCw, Wrench, DollarSign, ShieldCheck, Radar, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OutreachTab } from "@/components/admin/outreach-tab";
import { AgentMarkdown } from "@/components/agent-markdown";
import {
  CAPABILITIES, CAPABILITY_LABELS, AUTONOMY_LEVELS, PROPOSAL_KIND_LABELS,
  type Capability, type AutonomyLevel, type ProposalKind,
} from "@shared/agent-schema";

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

const kindLabel = (k: string) => PROPOSAL_KIND_LABELS[k as ProposalKind] ?? k;

type Tab = "chat" | "queue" | "outreach" | "training" | "activity";

export function AgentSection({ token }: { token: string }) {
  const [tab, setTab] = useState<Tab>("chat");

  const { data: status } = useQuery({
    queryKey: ["agent-status", token],
    queryFn: () => api("/api/agent/status", token),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Bot className="h-5 w-5" /> Agent
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask about the business, review what it proposes, and teach it how you like things done.
          </p>
        </div>
        {status && (
          <div className="flex items-center gap-4 text-right text-xs">
            <div>
              <p className="text-muted-foreground">Spent so far</p>
              <p className="font-semibold tabular-nums">${status.spend?.totalUsd ?? "0.0000"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Model</p>
              <p className="font-semibold">{status.model}</p>
            </div>
          </div>
        )}
      </div>

      {status && !status.configured && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/50">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">The agent isn't switched on yet</p>
            <p className="mt-1 text-amber-800 dark:text-amber-300">
              Set <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">ANTHROPIC_API_KEY</code> in your
              environment and restart the server. Everything else here is ready.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-border">
        {([
          ["chat", "Chat", Sparkles],
          ["queue", "Queue", Inbox],
          ["outreach", "Outreach", Send],
          ["training", "Training", BrainCircuit],
          ["activity", "Activity", Activity],
        ] as const).map(([k, label, Icon]) => (
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
            {k === "queue" && status?.pendingProposals ? (
              <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                {status.pendingProposals}
              </span>
            ) : null}
            {tab === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {tab === "chat" && <ChatTab token={token} enabled={!!status?.configured} />}
      {tab === "queue" && <QueueTab token={token} canApprove={status?.canApprove !== false} />}
      {tab === "outreach" && <OutreachTab token={token} enabled={!!status?.configured} />}
      {tab === "training" && <TrainingTab token={token} autonomy={status?.autonomy} canApprove={status?.canApprove !== false} />}
      {tab === "activity" && <ActivityTab token={token} />}
    </div>
  );
}

// ── Chat ─────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "How are we doing overall?",
  "Which letters of intent have gone quiet?",
  "What revenue have we collected so far?",
  "Which pools are open right now?",
];

function ChatTab({ token, enabled }: { token: string; enabled: boolean }) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  // One thread per browser, so a reload keeps the conversation.
  const [threadId] = useState(() => {
    try {
      const saved = localStorage.getItem("bfx_agent_thread");
      if (saved) return saved;
      const id = `t_${Date.now().toString(36)}`;
      localStorage.setItem("bfx_agent_thread", id);
      return id;
    } catch {
      return `t_${Date.now().toString(36)}`;
    }
  });
  const endRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], refetch } = useQuery({
    queryKey: ["agent-thread", token, threadId],
    queryFn: () => api(`/api/agent/thread/${threadId}`, token),
  });

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = useMutation({
    mutationFn: (message: string) =>
      api("/api/agent/chat", token, { method: "POST", body: JSON.stringify({ threadId, message }) }),
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["agent-status"] });
    },
    onError: (e: any) => toast({ title: "The agent couldn't answer", description: e.message, variant: "destructive" }),
  });

  const submit = (text: string) => {
    const msg = text.trim();
    if (!msg || send.isPending) return;
    setInput("");
    send.mutate(msg);
  };

  return (
    <Card>
      <CardContent className="flex h-[34rem] flex-col p-0">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="rounded-full bg-muted p-3"><Bot className="h-6 w-6 text-muted-foreground" /></div>
              <div>
                <p className="font-medium">Ask about the business</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Answers come from your live database and the chain — never guessed. If it can't see something,
                  it says so.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    disabled={!enabled}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m: any) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] space-y-2", m.role === "user" && "items-end")}>
                <div
                  className={cn(
                    "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "min-w-0 border border-border bg-muted/40",
                  )}
                >
                  {m.role === "assistant"
                    ? <AgentMarkdown>{m.content}</AgentMarkdown>
                    : <p className="whitespace-pre-wrap">{m.content}</p>}
                </div>
                {/* Showing what it read is what makes the number believable. */}
                {m.toolCalls?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {m.toolCalls.map((t: any, i: number) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        <Wrench className="h-2.5 w-2.5" /> {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {send.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading your data…
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-border p-3">
          <form
            onSubmit={(e) => { e.preventDefault(); submit(input); }}
            className="flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={enabled ? "Ask about revenue, pools, agreements…" : "Set ANTHROPIC_API_KEY to enable"}
              disabled={!enabled || send.isPending}
            />
            <Button type="submit" disabled={!enabled || send.isPending || !input.trim()} className="gap-2">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Queue ────────────────────────────────────────────────────────────────

function QueueTab({ token, canApprove }: { token: string; canApprove: boolean }) {
  const { toast } = useToast();
  const [filter, setFilter] = useState("proposed");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const { data: proposals = [], refetch } = useQuery({
    queryKey: ["agent-proposals", token, filter],
    queryFn: () => api(`/api/agent/proposals?status=${filter}`, token),
    refetchInterval: 60_000,
  });

  const decide = useMutation({
    mutationFn: ({ id, decision, body }: { id: number; decision: string; body?: string }) =>
      api(`/api/agent/proposals/${id}/decide`, token, {
        method: "POST",
        body: JSON.stringify({ decision, ...(body ? { editedPayload: { body } } : {}) }),
      }),
    onSuccess: (r: any) => {
      toast({
        title: r.recordedAs === "edited" ? "Approved with your edit" : `Marked ${r.status}`,
        description:
          r.recordedAs === "edited"
            ? "Your changes were recorded — that's the strongest signal it learns from."
            : undefined,
      });
      setEditing(null);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["agent-status"] });
    },
    onError: (e: any) => toast({ title: "Couldn't record that", description: e.message, variant: "destructive" }),
  });

  const { data: preview, refetch: refetchPreview } = useQuery({
    queryKey: ["agent-scan-preview", token],
    queryFn: () => api("/api/agent/scan/preview", token),
  });

  const scan = useMutation({
    mutationFn: () => api("/api/agent/scan", token, { method: "POST" }),
    onSuccess: (r: any) => {
      toast({
        title: r.created ? `Drafted ${r.created} proposal${r.created > 1 ? "s" : ""}` : "Nothing new to raise",
        description: r.created
          ? "Emailed to you as well."
          : r.suppressed
            ? `${r.suppressed} already in the queue or recently rejected.`
            : "Everything looks up to date.",
      });
      refetch();
      refetchPreview();
      queryClient.invalidateQueries({ queryKey: ["agent-status"] });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* Free preview: what the deterministic detectors see, with no model
          call. Lets you sanity-check the thresholds before spending anything. */}
      {canApprove && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <Radar className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs text-muted-foreground">
            {preview
              ? preview.candidates?.length
                ? `${preview.candidates.length} thing${preview.candidates.length > 1 ? "s" : ""} worth raising: ${preview.candidates.map((c: any) => c.title).slice(0, 2).join(" · ")}${preview.candidates.length > 2 ? " …" : ""}`
                : `Nothing to raise right now${preview.suppressed ? ` (${preview.suppressed} suppressed)` : ""}.`
              : "Checking…"}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => scan.mutate()}
            disabled={scan.isPending || !preview?.candidates?.length}
          >
            {scan.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Draft them
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {["proposed", "approved", "rejected", "all"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
              filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {proposals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3"><Inbox className="h-6 w-6 text-muted-foreground" /></div>
            <div>
              <p className="font-medium">Nothing waiting</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Once the detectors are switched on, things the agent thinks you should act on land here —
                a letter unopened for two weeks, a pool running thin — with the draft already written.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        proposals.map((p: any) => {
          const body = String(p.payload?.body ?? p.payload?.text ?? "");
          const isEditing = editing === p.id;
          return (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm">{p.title}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {kindLabel(p.kind)}
                      {p.sourceType ? ` · ${p.sourceType} #${p.sourceId}` : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      p.status === "proposed" && "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                      p.status === "approved" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                      p.status === "rejected" && "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                    )}
                  >
                    {p.status}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {p.rationale && (
                  <p className="rounded-md border-l-2 border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    {p.rationale}
                  </p>
                )}

                {isEditing ? (
                  <Textarea rows={7} value={draft} onChange={(e) => setDraft(e.target.value)} className="text-sm" />
                ) : (
                  body && <p className="whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-sm">{body}</p>
                )}

                {p.status === "proposed" && !canApprove && (
                  <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Waiting on Anthony. Only he can approve or reject what the agent proposes.
                  </p>
                )}

                {p.status === "proposed" && canApprove && (
                  <div className="flex flex-wrap gap-2">
                    {isEditing ? (
                      <>
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => decide.mutate({ id: p.id, decision: "approved", body: draft })}
                        >
                          <Check className="h-3 w-3" /> Approve with edit
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => decide.mutate({ id: p.id, decision: "approved" })}
                        >
                          <Check className="h-3 w-3" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => { setEditing(p.id); setDraft(body); }}
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1.5 text-xs text-destructive"
                          onClick={() => decide.mutate({ id: p.id, decision: "rejected" })}
                        >
                          <X className="h-3 w-3" /> Reject
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ── Training ─────────────────────────────────────────────────────────────

function TrainingTab({ token, autonomy, canApprove }: { token: string; autonomy?: Record<Capability, AutonomyLevel>; canApprove: boolean }) {
  const { toast } = useToast();
  const [newRule, setNewRule] = useState("");
  const [newFact, setNewFact] = useState("");

  const { data, refetch } = useQuery({
    queryKey: ["agent-rules", token],
    queryFn: () => api("/api/agent/rules", token),
  });
  const { data: facts = [], refetch: refetchFacts } = useQuery({
    queryKey: ["agent-facts", token],
    queryFn: () => api("/api/agent/facts", token),
  });

  const addRule = useMutation({
    mutationFn: (rule: string) => api("/api/agent/rules", token, { method: "POST", body: JSON.stringify({ rule }) }),
    onSuccess: () => { setNewRule(""); refetch(); },
  });
  const delRule = useMutation({
    mutationFn: (id: number) => api(`/api/agent/rules/${id}`, token, { method: "DELETE" }),
    onSuccess: () => refetch(),
  });
  const extract = useMutation({
    mutationFn: () => api("/api/agent/rules/extract", token, { method: "POST" }),
    onSuccess: (r: any) => {
      toast({
        title: r.added?.length ? `Learned ${r.added.length} new preference${r.added.length > 1 ? "s" : ""}` : "Nothing new learned",
        description: r.added?.length ? r.added.join(" · ") : r.skipped,
      });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["agent-status"] });
    },
    onError: (e: any) => toast({ title: "Extraction failed", description: e.message, variant: "destructive" }),
  });
  const addFact = useMutation({
    mutationFn: (fact: string) => api("/api/agent/facts", token, { method: "POST", body: JSON.stringify({ fact }) }),
    onSuccess: () => { setNewFact(""); refetchFacts(); },
  });
  const delFact = useMutation({
    mutationFn: (id: number) => api(`/api/agent/facts/${id}`, token, { method: "DELETE" }),
    onSuccess: () => refetchFacts(),
  });
  const setAutonomy = useMutation({
    mutationFn: (patch: Record<string, string>) =>
      api("/api/agent/autonomy", token, { method: "PUT", body: JSON.stringify(patch) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-status"] });
      toast({ title: "Autonomy updated" });
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Rules */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">How you like things done</CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => extract.mutate()}
              disabled={extract.isPending}
            >
              {extract.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Learn from my decisions
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Rules it has picked up from what you approve, reject and edit. Delete anything it got wrong.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex gap-2">
            <Input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder="e.g. keep follow-ups to two sentences"
              onKeyDown={(e) => { if (e.key === "Enter" && newRule.trim()) addRule.mutate(newRule.trim()); }}
            />
            <Button size="icon" variant="outline" disabled={!newRule.trim()} onClick={() => addRule.mutate(newRule.trim())}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {(data?.rules ?? []).length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Nothing learned yet. Approve or edit a few drafts, then press "Learn from my decisions".
            </p>
          ) : (
            <ul className="space-y-2">
              {data.rules.map((r: any) => (
                <li key={r.id} className="flex items-start gap-2 rounded-md border border-border p-2.5">
                  <span
                    className={cn(
                      "mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium",
                      r.origin === "extracted"
                        ? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {r.origin === "extracted" ? "learned" : "manual"}
                  </span>
                  <span className="flex-1 text-xs leading-relaxed">{r.rule}</span>
                  <button onClick={() => delRule.mutate(r.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(data?.stats ?? []).length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                How often you accept each kind
              </p>
              {data.stats.map((s: any) => (
                <div key={s.kind} className="flex items-center justify-between py-1 text-xs">
                  <span className="text-muted-foreground">{kindLabel(s.kind)}</span>
                  <span className="tabular-nums">
                    {s.approvalRate}% <span className="text-muted-foreground">of {s.total}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Knowledge, autonomy, memory */}
      <div className="space-y-6">
        <KnowledgeCard token={token} canApprove={canApprove} />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4" /> How much it does on its own
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Move things to Auto once you've watched them get it right.
            </p>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-0">
            {CAPABILITIES.map((cap) => (
              <div key={cap} className="flex items-center justify-between gap-3">
                <span className="text-xs">{CAPABILITY_LABELS[cap]}</span>
                <Select
                  value={autonomy?.[cap] ?? "ask"}
                  disabled={!canApprove}
                  onValueChange={(v) => setAutonomy.mutate({ [cap]: v })}
                >
                  <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AUTONOMY_LEVELS.map((l) => (
                      <SelectItem key={l} value={l} className="text-xs capitalize">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
              Signing, moving money, changing contract parameters and deleting records aren't listed because the
              agent has no tool for them — there is nothing to switch on.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Things worth remembering</CardTitle>
            <p className="text-xs text-muted-foreground">
              Context it should carry between conversations.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex gap-2">
              <Input
                value={newFact}
                onChange={(e) => setNewFact(e.target.value)}
                placeholder="e.g. Meridian wants to revisit exclusivity in September"
                onKeyDown={(e) => { if (e.key === "Enter" && newFact.trim()) addFact.mutate(newFact.trim()); }}
              />
              <Button size="icon" variant="outline" disabled={!newFact.trim()} onClick={() => addFact.mutate(newFact.trim())}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {facts.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">Nothing saved yet.</p>
            ) : (
              <ul className="space-y-2">
                {facts.map((f: any) => (
                  <li key={f.id} className="flex items-start gap-2 rounded-md border border-border p-2.5">
                    <span className="flex-1 text-xs leading-relaxed">{f.fact}</span>
                    <button onClick={() => delFact.mutate(f.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Documents and images Finax learns from.
 *
 * Marked public or internal at upload: the website agent is only ever given
 * public sources, so the pitch can go in without the P&L reaching a stranger.
 */
function KnowledgeCard({ token, canApprove }: { token: string; canApprove: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState("internal");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: sources = [], refetch } = useQuery({
    queryKey: ["agent-sources", token],
    queryFn: () => api("/api/agent/sources", token),
  });

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read that file"));
        r.readAsDataURL(file);
      });
      const note = file.type.startsWith("image/")
        ? window.prompt("What does this image show? Images have no text to search on, so this is how Finax finds it.") || ""
        : "";
      const res = await api("/api/agent/sources", token, {
        method: "POST",
        body: JSON.stringify({ title: file.name.replace(/\.[^.]+$/, ""), filename: file.name, dataUrl, visibility, note }),
      });
      toast({
        title: res.kind === "image" ? "Image saved" : `Saved — split into ${res.chunks} passage${res.chunks === 1 ? "" : "s"}`,
        description: res.hint,
      });
      refetch();
    } catch (e: any) {
      toast({ title: "Couldn't save that", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/agent/sources/${id}`, token, { method: "DELETE" }),
    onSuccess: () => refetch(),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4" /> What Finax has read
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Upload PDFs, text files, screenshots or diagrams. Finax reads images directly.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {canApprove && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={visibility} onValueChange={setVisibility}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="internal" className="text-xs">Internal only</SelectItem>
                <SelectItem value="public" className="text-xs">Website too</SelectItem>
                <SelectItem value="both" className="text-xs">Everywhere</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,.csv,.json,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
            />
          </div>
        )}

        {sources.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nothing uploaded yet. Anything you add here, Finax can quote from.
          </p>
        ) : (
          <ul className="space-y-2">
            {sources.map((s: any) => (
              <li key={s.id} className="flex items-start gap-2 rounded-md border border-border p-2.5">
                <span className={cn(
                  "mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium",
                  s.kind === "image"
                    ? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                    : "bg-muted text-muted-foreground",
                )}>
                  {s.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{s.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.visibility === "internal" ? "internal only" : s.visibility === "public" ? "website too" : "everywhere"}
                    {s.chunks ? ` · ${s.chunks} passage${s.chunks === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                {canApprove && (
                  <button onClick={() => remove.mutate(s.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────

function ActivityTab({ token }: { token: string }) {
  const { data: runs = [] } = useQuery({
    queryKey: ["agent-runs", token],
    queryFn: () => api("/api/agent/runs", token),
    refetchInterval: 30_000,
  });

  const total = runs.reduce((a: number, r: any) => a + Number(r.costUsd || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Recent runs</CardTitle>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <DollarSign className="h-3 w-3" /> ${total.toFixed(4)} across {runs.length} runs
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {runs.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">When</th>
                  <th className="px-5 py-2.5 font-medium">Trigger</th>
                  <th className="px-5 py-2.5 font-medium">Tools</th>
                  <th className="px-5 py-2.5 font-medium">Tokens</th>
                  <th className="px-5 py-2.5 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className="px-5 py-2.5 text-muted-foreground">
                      {r.startedAt ? new Date(r.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-5 py-2.5">{r.trigger}</td>
                    <td className="px-5 py-2.5 tabular-nums">{r.toolCalls}</td>
                    <td className="px-5 py-2.5 tabular-nums text-muted-foreground">
                      {r.tokensIn.toLocaleString()} in / {r.tokensOut.toLocaleString()} out
                    </td>
                    <td className="px-5 py-2.5 tabular-nums">${Number(r.costUsd || 0).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
