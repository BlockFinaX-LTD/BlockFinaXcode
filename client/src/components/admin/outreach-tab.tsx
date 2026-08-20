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
  Loader2, Copy, Check, ExternalLink, Trash2, Send, Sparkles, Linkedin, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OutreachPeople } from "./outreach-people";
import { OutreachMemory } from "./outreach-memory";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Intent = "reply" | "comment" | "connect" | "dm";
type Status = "waiting" | "sent" | "discarded";

interface PlannedSearch { query: string; angle: string; why: string }
interface SearchOutcome { query: string; fetched: number; error: string | null }

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
  /** When the original post went up, as opposed to when we drafted. */
  postedAt: string | null;
  /** Set once LinkedIn actually created the comment. Proof, not intent. */
  commentUrn: string | null;
}

interface LinkedInStatus {
  connected: boolean;
  configured: boolean;
  name: string | null;
  expired: boolean;
  redirectUri?: string;
  /** Apex and www. LinkedIn matches exactly, so both are worth registering. */
  redirectUris?: string[];
}

/**
 * Can this draft be published through the API?
 *
 * Only comments and replies, and only when we know which post to attach to.
 * A connection note or a direct message has no API path, and a draft whose
 * link is a profile rather than a post has nothing to comment on.
 */
function canPost(d: Draft): boolean {
  if (d.intent !== "comment" && d.intent !== "reply") return false;
  if (!d.sourceUrl) return false;
  // Both shapes LinkedIn uses: the feed permalink, and the public post link
  // that carries the id as "-activity-{id}-{hash}". The provider returns the
  // second for essentially everything.
  return /urn(:|%3A)li(:|%3A)(activity|ugcPost|share)/i.test(d.sourceUrl)
      || /-activity-\d{10,}/.test(d.sourceUrl);
}

/**
 * How long ago, in words.
 *
 * The same wording the drafter is given, so a card cannot say "2 days ago"
 * while the draft it holds was written as though the thread were live.
 */
function howLongAgo(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return w === 1 ? "1 week ago" : `${w} weeks ago`;
  }
  if (days < 365) {
    const m = Math.floor(days / 30);
    return m === 1 ? "1 month ago" : `${m} months ago`;
  }
  const y = Math.floor(days / 365);
  return y === 1 ? "1 year ago" : `${y} years ago`;
}

/** "about 3 hours", for the next scheduled run. */
function minutesUntil(iso: string | null): string {
  if (!iso) return "a while";
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (mins <= 0) return "a few minutes";
  if (mins < 60) return `${mins} minutes`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem >= 15 ? `${h}h ${rem}m` : `${h} hour${h === 1 ? "" : "s"}`;
}

/** Past a week the thread is cold, and that changes whether it is worth sending. */
function isStale(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && Date.now() - t > 7 * 86400_000;
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
  const [intent, setIntent] = useState<Intent>("comment");
  /**
   * "one"    = a single post, pasted.
   * "scan"   = a whole page pasted at once.
   * "search" = Finax searches LinkedIn itself, through a provider that uses its
   *            own infrastructure rather than your session.
   */
  const [mode, setMode] = useState<"auto" | "one" | "scan" | "search">("auto");
  const [blob, setBlob] = useState("");
  const [query, setQuery] = useState("");
  const [postedLimit, setPostedLimit] = useState("month");
  /** The plan from the last automatic scan, kept so the reasoning stays visible. */
  const [plan, setPlan] = useState<PlannedSearch[] | null>(null);
  const [searched, setSearched] = useState<SearchOutcome[] | null>(null);
  const [tab, setTab] = useState<Status>("waiting");
  /** Drafts, the people behind them, or what Finax knows. */
  const [section, setSection] = useState<"drafts" | "people" | "memory">("drafts");
  const [copied, setCopied] = useState<number | null>(null);
  const [showRedirect, setShowRedirect] = useState(false);

  const { data: li } = useQuery<LinkedInStatus>({
    queryKey: ["linkedin-status", token],
    queryFn: () => api("/api/outreach/linkedin/status", token),
  });

  const connectLi = useMutation({
    mutationFn: () => api("/api/outreach/linkedin/connect", token, { method: "POST" }),
    onSuccess: (r: { url: string }) => { window.location.href = r.url; },
    onError: (e: Error) => toast({ title: "Couldn't start", description: e.message, variant: "destructive" }),
  });

  const disconnectLi = useMutation({
    mutationFn: () => api("/api/outreach/linkedin/disconnect", token, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["linkedin-status"] });
      toast({ title: "Disconnected", description: "Finax can no longer post as you." });
    },
  });

  const publish = useMutation({
    mutationFn: (id: number) => api(`/api/outreach/${id}/post`, token, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outreach"] });
      toast({ title: "Posted to LinkedIn", description: "It is live on the thread now." });
    },
    onError: (e: Error) => toast({ title: "Could not post", description: e.message, variant: "destructive" }),
  });

  const { data: schedule } = useQuery<{
    lastScanAt: string | null; nextScanAt: string | null; intervalHours: number; configured: boolean;
  }>({
    queryKey: ["outreach-schedule", token],
    queryFn: () => api("/api/outreach/schedule", token),
    // The scan runs on the server, so the console has to ask rather than be told.
    refetchInterval: 120_000,
  });

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

  const auto = useMutation({
    mutationFn: () =>
      api("/api/outreach/auto", token, {
        method: "POST",
        body: JSON.stringify({ intent, postedLimit: "week" }),
      }),
    onSuccess: (r: {
      drafted: number; relevant: number; fetched: number;
      plan: PlannedSearch[]; plannerFallback: boolean; searched: SearchOutcome[]; note?: string;
    }) => {
      setPlan(r.plan ?? null);
      setSearched(r.searched ?? null);
      setTab("waiting");
      qc.invalidateQueries({ queryKey: ["outreach"] });
      qc.invalidateQueries({ queryKey: ["outreach-people"] });
      toast({
        title: r.drafted
          ? `${r.drafted} draft${r.drafted === 1 ? "" : "s"} ready`
          : r.fetched ? "Nothing relevant found" : "LinkedIn returned nothing",
        description: r.note
          ?? `${r.searched?.length ?? 0} searches · ${r.fetched} posts · ${r.relevant} about currency risk`,
        variant: r.drafted ? undefined : "destructive",
      });
    },
    onError: (e: Error) => toast({ title: "Scan failed", description: e.message, variant: "destructive" }),
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
        Finax finds posts worth answering and drafts against real market data — open pools, real premiums, what has
        settled. Give it one post, paste a whole page, or let it search LinkedIn itself. Drafts wait
        here for you to copy.{" "}
        <span className="text-foreground">Nothing is ever posted from here</span>: LinkedIn prohibits
        automated posting, and the account is worth more than the keystrokes.
      </p>

      {/* ── the account Finax posts as ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/20 px-4 py-3">
        <Linkedin className="h-4 w-4 text-muted-foreground" />
        <span className="text-[13px]">
          {!li ? "Checking your LinkedIn connection…"
            : !li.configured ? "Sending is not set up yet. Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in Railway."
            : li.connected ? <>Finax can post as <span className="font-medium">{li.name || "you"}</span>.</>
            : li.expired ? "Your LinkedIn connection expired."
            : "Finax cannot post yet. Connect your LinkedIn account to give it send power."}
        </span>
        {li?.configured && !li.connected && (
          <button
            onClick={() => setShowRedirect(v => !v)}
            className="text-[12px] text-muted-foreground underline-offset-2 hover:underline"
          >
            {showRedirect ? "Hide setup" : "Connection failing?"}
          </button>
        )}
        {li?.configured && (
          <div className="ml-auto flex gap-2">
            {li.connected ? (
              <Button size="sm" variant="ghost" onClick={() => disconnectLi.mutate()}>Disconnect</Button>
            ) : (
              <Button size="sm" variant="outline" disabled={connectLi.isPending} onClick={() => connectLi.mutate()}>
                {connectLi.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Connect LinkedIn
              </Button>
            )}
          </div>
        )}
      </div>

      {/* The redirect URL, shown rather than described.
          "The redirect_uri does not match the registered value" is by far the
          most common way this fails, and LinkedIn's error names neither what it
          expected nor what it received. Showing the exact string, copyable,
          turns a guessing game into a paste. */}
      {showRedirect && li?.redirectUris?.length && (
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <p className="text-[13px]">
            In your LinkedIn app, open the <span className="font-medium">Auth</span> tab and add
            these under <span className="font-medium">Authorized redirect URLs</span>. Add both.
            LinkedIn matches them character for character, so a missing <code>www</code> or an
            extra slash is enough to fail.
          </p>
          <div className="mt-2.5 space-y-1.5">
            {li.redirectUris.map(u => (
              <div key={u} className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded border border-border bg-background px-2.5 py-1.5 text-[12px]">
                  {u}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(u).then(
                      () => toast({ title: "Copied" }),
                      () => toast({ title: "Select it and copy manually", variant: "destructive" }),
                    );
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[12px] text-muted-foreground">
            Click <span className="text-foreground">Update</span> in LinkedIn afterwards, wait a
            few seconds, then press Connect again.
          </p>
        </div>
      )}

      {/* ── compose ── */}
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="mb-3 flex gap-1.5">
          {([["auto", "Scan for me"], ["one", "One post"], ["scan", "Scan a page"], ["search", "Search LinkedIn"]] as const).map(([k, label]) => (
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
            {mode === "auto"
              ? "Finax decides what to look for, from what the market is doing"
              : mode === "one"
                ? "one reply, with who they are"
                : mode === "scan"
                  ? "select a whole notifications page and paste, Finax separates it"
                  : "you choose the words, Finax searches"}
          </span>
        </div>

        {mode === "auto" ? (
          <>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              No search words needed. Finax reads what your currencies have actually done this
              week, works out which angles are worth hunting, runs those searches, and drafts for
              the strongest posts it finds. It shows you the plan so you can see the reasoning.
            </p>
            <p className="mt-2 text-[12px] text-muted-foreground">
              {!schedule
                ? "Checking the schedule…"
                : !schedule.configured
                  ? "This also runs by itself every 5 hours, once APIFY_TOKEN is set in Railway."
                  : schedule.lastScanAt
                    ? `Runs by itself every 5 hours. Last run ${howLongAgo(schedule.lastScanAt)}, next in about ${minutesUntil(schedule.nextScanAt)}.`
                    : "Runs by itself every 5 hours. No run recorded yet, the first is due within ten minutes."}
            </p>
            {plan && (
              <div className="mt-3 space-y-2 rounded-md border border-border bg-background p-3">
                <p className="text-[12px] font-medium text-foreground">What it went looking for</p>
                {plan.map((p, i) => {
                  const outcome = searched?.find(s2 => s2.query === p.query);
                  return (
                    <div key={i} className="border-l-2 border-border pl-2.5">
                      <p className="text-[12.5px] font-medium">
                        “{p.query}”
                        {outcome && (
                          <span className="ml-2 font-normal text-[11.5px] text-muted-foreground">
                            {outcome.error ? `failed: ${outcome.error}` : `${outcome.fetched} posts`}
                          </span>
                        )}
                      </p>
                      <p className="text-[11.5px] text-muted-foreground">{p.why}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : mode === "search" ? (
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
            mode === "auto" ? auto.mutate()
            : mode === "search" ? search.mutate()
            : mode === "scan" ? scan.mutate()
            : draftIt.mutate()
          }
          disabled={
            !enabled || draftIt.isPending || scan.isPending || search.isPending || auto.isPending ||
            (mode === "auto" ? false
             : mode === "search" ? query.trim().length < 3
             : mode === "scan" ? blob.trim().length < 60
             : sourceText.trim().length < 20)
          }
          className="mt-3.5"
        >
          {draftIt.isPending || scan.isPending || search.isPending || auto.isPending
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {auto.isPending ? "Reading the market, then searching…"
                 : search.isPending ? "Finax is searching LinkedIn…"
                 : scan.isPending ? "Finax is reading the page…"
                 : "Finax is writing…"}</>
            : <><Sparkles className="mr-2 h-4 w-4" />
                {mode === "auto" ? "Scan for me"
                 : mode === "search" ? "Search and draft"
                 : mode === "scan" ? "Scan and draft" : "Draft it"}</>}
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
                {/* Age of the post, not of the draft. A comment on a three-week-old
                    thread reaches nobody, so the cold ones are marked. */}
                {howLongAgo(d.postedAt) && (
                  <span
                    title={new Date(d.postedAt!).toLocaleString()}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px]",
                      isStale(d.postedAt)
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-500"
                        : "text-muted-foreground",
                    )}
                  >
                    <Clock className="h-3 w-3" />
                    posted {howLongAgo(d.postedAt)}
                    {isStale(d.postedAt) && <span className="font-medium">· thread is cold</span>}
                  </span>
                )}
                {d.commentUrn && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11.5px] text-emerald-600 dark:text-emerald-500">
                    <Check className="h-3 w-3" /> posted by Finax
                  </span>
                )}
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
                    {/* Posting is one draft at a time and always a deliberate
                        click. Something published in Anthony's name should be
                        something he decided to publish, having read it. */}
                    {li?.connected && canPost(d) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={publish.isPending}
                        onClick={() => {
                          if (window.confirm("Post this comment to LinkedIn now, as you?\n\nIt goes out under your own name and cannot be unpublished from here.")) {
                            publish.mutate(d.id);
                          }
                        }}
                      >
                        {publish.isPending && publish.variables === d.id
                          ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Posting…</>
                          : <><Linkedin className="mr-1.5 h-3.5 w-3.5" /> Post to LinkedIn</>}
                      </Button>
                    )}
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
