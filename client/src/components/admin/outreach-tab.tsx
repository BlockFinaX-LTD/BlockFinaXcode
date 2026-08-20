/**
 * outreach-tab.tsx — the waiting room, inside the agent console.
 *
 * Four things live here behind one set of tabs:
 *
 *   Drafts   what Finax wrote, waiting to be copied and sent by hand.
 *   People   everyone whose post was worth answering, accumulated from drafting.
 *   Memory   the dated facts Finax may cite — policy, research, news.
 *   Market   the computed picture, so a surprising number can be checked.
 *
 * Nothing here sends anything, and that is the design rather than a stage of
 * it. LinkedIn's User Agreement forbids automated posting, so an integration
 * that posted on Anthony's behalf would put the account his outbound runs
 * through at risk. Copying takes a second; losing the account does not.
 *
 * The People list is built as a by-product rather than scraped separately: a
 * person who has publicly written about currency risk is better qualified than
 * one who merely holds the title, and the list improves every time the tool is
 * used for its main job.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Copy, Check, ExternalLink, Trash2, Send, Sparkles, Linkedin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OutreachPeople } from "./outreach-people";
import { OutreachMemory } from "./outreach-memory";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Intent = "reply" | "comment" | "connect" | "dm";
type Status = "waiting" | "sent" | "discarded";

interface Draft {
  id: number;
  sourceUrl: string | null;
  sourceText: string;
  personName: string | null;
  personHeadline: string | null;
  intent: Intent;
  draft: string;
  status: Status;
  createdAt: string | null;
}

const INTENTS: { key: Intent; label: string; hint: string }[] = [
  { key: "comment", label: "Insight comment", hint: "70–110 words — mechanism, a number, then the second-order effect" },
  { key: "reply", label: "Public reply", hint: "under 60 words — has to add something to the thread" },
  { key: "connect", label: "Connection note", hint: "under 300 characters, LinkedIn's limit" },
  { key: "dm", label: "Direct message", hint: "under 120 words, one question worth answering" },
];

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

export function OutreachTab({ token, enabled }: { token: string; enabled: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [personName, setPersonName] = useState("");
  const [personHeadline, setPersonHeadline] = useState("");
  const [intent, setIntent] = useState<Intent>("reply");
  /**
   * "one"    = a single post, pasted.
   * "scan"   = a whole page pasted at once.
   * "search" = Finax searches LinkedIn itself, through a provider that uses its
   *            own infrastructure rather than your session.
   */
  const [mode, setMode] = useState<"one" | "scan" | "search">("one");
  const [blob, setBlob] = useState("");
  const [query, setQuery] = useState("");
  const [postedLimit, setPostedLimit] = useState("month");
  const [tab, setTab] = useState<Status>("waiting");
  /** Drafts, the people behind them, or what Finax knows. */
  const [section, setSection] = useState<"drafts" | "people" | "memory">("drafts");
  const [copied, setCopied] = useState<number | null>(null);

  const { data: drafts = [], isLoading } = useQuery<Draft[]>({
    queryKey: ["outreach", tab, token],
    queryFn: () => api(`/api/outreach?status=${tab}`, token),
  });

  const draftIt = useMutation({
    mutationFn: () =>
      api("/api/outreach/draft", token, {
        method: "POST",
        body: JSON.stringify({ sourceText, sourceUrl, personName, personHeadline, intent }),
      }),
    onSuccess: () => {
      setSourceText(""); setSourceUrl(""); setPersonName(""); setPersonHeadline("");
      setTab("waiting");
      qc.invalidateQueries({ queryKey: ["outreach"] });
      toast({ title: "Draft ready", description: "It's waiting below." });
    },
    onError: (e: Error) => toast({ title: "Couldn't draft that", description: e.message, variant: "destructive" }),
  });

  const scan = useMutation({
    mutationFn: () =>
      api("/api/outreach/scan", token, { method: "POST", body: JSON.stringify({ blob, intent }) }),
    onSuccess: (r: { drafted: number; skipped: number; failed: number; note?: string }) => {
      setBlob("");
      setTab("waiting");
      qc.invalidateQueries({ queryKey: ["outreach"] });
      toast({
        title: r.drafted ? `${r.drafted} draft${r.drafted === 1 ? "" : "s"} ready` : "Nothing to draft",
        description:
          r.note ??
          ([r.skipped ? `${r.skipped} item${r.skipped === 1 ? "" : "s"} had no text worth replying to` : null,
            r.failed ? `${r.failed} failed` : null].filter(Boolean).join(" · ") || undefined),
        variant: r.drafted ? undefined : "destructive",
      });
    },
    onError: (e: Error) => toast({ title: "Scan failed", description: e.message, variant: "destructive" }),
  });

  const search = useMutation({
    mutationFn: () =>
      api("/api/outreach/search", token, {
        method: "POST",
        body: JSON.stringify({ query, intent, postedLimit, maxPosts: 50 }),
      }),
    onSuccess: (r: { drafted: number; relevant: number; considered: number; fetched?: number }) => {
      setTab("waiting");
      qc.invalidateQueries({ queryKey: ["outreach"] });
      toast({
        // Say what the search actually did at each stage. "Nothing to draft" on
        // its own is indistinguishable from a broken search — the counts tell
        // you whether LinkedIn had nothing or the filter rejected it all.
        title: r.drafted
          ? `${r.drafted} draft${r.drafted === 1 ? "" : "s"} ready`
          : r.fetched
            ? "Nothing relevant found"
            : "LinkedIn returned nothing",
        description: r.fetched
          ? `${r.fetched} post${r.fetched === 1 ? "" : "s"} found · ${r.relevant} about currency risk`
          : "Try a broader search, or a longer time window.",
        variant: r.drafted ? undefined : "destructive",
      });
    },
    onError: (e: Error) => toast({ title: "Search failed", description: e.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/outreach/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach"] }),
    onError: () => toast({ title: "Couldn't save that", variant: "destructive" }),
  });

  const copy = async (d: Draft) => {
    try {
      await navigator.clipboard.writeText(d.draft);
      setCopied(d.id);
      setTimeout(() => setCopied(c => (c === d.id ? null : c)), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Select the text and copy it manually.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* ── which of the three things you came here for ── */}
      <div className="flex gap-1.5 border-b border-border pb-3">
        {([
          ["drafts", "Drafts"],
          ["people", "People"],
          ["memory", "What Finax knows"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSection(k)}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] transition-colors",
              section === k
                ? "bg-primary/10 font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "people" ? <OutreachPeople token={token} />
       : section === "memory" ? <OutreachMemory token={token} />
       : (
      <>
      <p className="max-w-[68ch] text-sm text-muted-foreground">
        Finax drafts LinkedIn replies against the live book — open pools, real premiums, what has
        settled. Give it one post, paste a whole page, or let it search LinkedIn itself. Drafts wait
        here for you to copy.{" "}
        <span className="text-foreground">Nothing is ever posted from here</span>: LinkedIn prohibits
        automated posting, and the account is worth more than the keystrokes.
      </p>

      {/* ── compose ── */}
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="mb-3 flex gap-1.5">
          {([["one", "One post"], ["scan", "Scan a page"], ["search", "Search LinkedIn"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              disabled={!enabled}
              className={cn(
                "rounded-md border px-3 py-1.5 text-[12.5px] transition-colors disabled:opacity-50",
                mode === k
                  ? "border-primary bg-primary/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto self-center text-[11.5px] text-muted-foreground">
            {mode === "one"
              ? "one reply, with who they are"
              : mode === "scan"
                ? "select a whole notifications page and paste — Finax separates it"
                : "Finax searches LinkedIn itself — your account is not used"}
          </span>
        </div>

        {mode === "search" ? (
          <>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && query.trim().length >= 3) search.mutate(); }}
              placeholder="What to search for, e.g. cedi depreciation importers"
              disabled={!enabled}
              className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-muted-foreground">Posted within</span>
              {([["24h", "a day"], ["week", "a week"], ["month", "a month"]] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setPostedLimit(k)}
                  disabled={!enabled}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-50",
                    postedLimit === k
                      ? "border-primary bg-primary/10 font-medium text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Searches up to 50 posts through an outside provider, keeps the ones about currency
              risk, and drafts the ten strongest.{" "}
              <span className="text-foreground">Your LinkedIn account is never used</span> — the
              provider runs its own infrastructure, so there is nothing of yours to restrict.
              Each search costs a few cents.
            </p>
          </>
        ) : mode === "scan" ? (
          <>
            <textarea
              value={blob}
              onChange={e => setBlob(e.target.value)}
              placeholder={"Paste a page of LinkedIn notifications, a thread of comments, or a forwarded digest email…"}
              rows={9}
              disabled={!enabled}
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 font-mono text-[12.5px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            />
            <p className="mt-2 text-[12px] text-muted-foreground">
              Finax separates the items, drops LinkedIn's own chrome and anything you wrote yourself,
              and drafts up to 15 at a time. Nothing leaves this server — the text is here because you
              copied it from your screen.
            </p>
          </>
        ) : (
          <>
        <textarea
          value={sourceText}
          onChange={e => setSourceText(e.target.value)}
          placeholder="Paste the post or comment here…"
          rows={5}
          disabled={!enabled}
          className="w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        />
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
          {[
            { v: sourceUrl, set: setSourceUrl, ph: "Link to the post" },
            { v: personName, set: setPersonName, ph: "Their name" },
            { v: personHeadline, set: setPersonHeadline, ph: "Their role, e.g. CFO, importer" },
          ].map((f, i) => (
            <input
              key={i}
              value={f.v}
              onChange={e => f.set(e.target.value)}
              placeholder={f.ph}
              disabled={!enabled}
              className="rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            />
          ))}
        </div>
        </>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {INTENTS.map(i => (
            <button
              key={i.key}
              onClick={() => setIntent(i.key)}
              disabled={!enabled}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors disabled:opacity-50",
                intent === i.key
                  ? "border-primary bg-primary/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {i.label}
            </button>
          ))}
          <span className="ml-auto text-[11.5px] text-muted-foreground">
            {INTENTS.find(i => i.key === intent)?.hint}
          </span>
        </div>

        <Button
          onClick={() =>
            mode === "search" ? search.mutate()
            : mode === "scan" ? scan.mutate()
            : draftIt.mutate()
          }
          disabled={
            !enabled || draftIt.isPending || scan.isPending || search.isPending ||
            (mode === "search" ? query.trim().length < 3
             : mode === "scan" ? blob.trim().length < 60
             : sourceText.trim().length < 20)
          }
          className="mt-3.5"
        >
          {draftIt.isPending || scan.isPending || search.isPending
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {search.isPending ? "Finax is searching LinkedIn…"
                 : scan.isPending ? "Finax is reading the page…"
                 : "Finax is writing…"}</>
            : <><Sparkles className="mr-2 h-4 w-4" />
                {mode === "search" ? "Search and draft" : mode === "scan" ? "Scan and draft" : "Draft it"}</>}
        </Button>
        {mode === "one" && sourceText.trim().length > 0 && sourceText.trim().length < 20 && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            A bit more of the post — Finax needs the words to reply to.
          </p>
        )}
      </div>

      {/* ── the waiting room ── */}
      <div className="flex gap-1 border-b border-border">
        {(["waiting", "sent", "discarded"] as Status[]).map(s => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={cn(
              "relative px-3 py-2 text-sm font-medium capitalize transition-colors",
              tab === s ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
            {tab === s && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : drafts.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {tab === "waiting" ? "Nothing waiting. Paste a post above." : `Nothing ${tab}.`}
        </p>
      ) : (
        <div className="space-y-4">
          {drafts.map(d => (
            <article key={d.id} className="rounded-lg border border-border bg-muted/10 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  {INTENTS.find(i => i.key === d.intent)?.label ?? d.intent}
                </span>
                {d.personName && <span className="text-[13px] font-medium">{d.personName}</span>}
                {d.personHeadline && <span className="text-[12.5px] text-muted-foreground">{d.personHeadline}</span>}
                {d.sourceUrl && (
                  <a
                    href={d.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-primary no-underline hover:underline"
                  >
                    <Linkedin className="h-3 w-3" /> Open the post <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              <details className="mb-3">
                <summary className="cursor-pointer text-[12.5px] text-muted-foreground">What they wrote</summary>
                <p className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-[13px] leading-relaxed text-muted-foreground">
                  {d.sourceText}
                </p>
              </details>

              <textarea
                defaultValue={d.draft}
                onBlur={e => {
                  if (e.target.value.trim() && e.target.value.trim() !== d.draft) {
                    update.mutate({ id: d.id, body: { draft: e.target.value } });
                  }
                }}
                rows={Math.min(10, Math.max(3, Math.ceil(d.draft.length / 72)))}
                className="w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 text-[14px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => copy(d)}>
                  {copied === d.id
                    ? <><Check className="mr-1.5 h-3.5 w-3.5" /> Copied</>
                    : <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy</>}
                </Button>
                {d.status === "waiting" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => update.mutate({ id: d.id, body: { status: "sent" } })}>
                      <Send className="mr-1.5 h-3.5 w-3.5" /> Mark sent
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: d.id, body: { status: "discarded" } })}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Discard
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: d.id, body: { status: "waiting" } })}>
                    Back to waiting
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}
