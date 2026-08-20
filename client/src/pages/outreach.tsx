/**
 * outreach.tsx — the waiting room.
 *
 * Paste a LinkedIn post, Finax drafts a reply against the live book, the draft
 * waits here with its source link until it is copied and sent by hand.
 *
 * Nothing here sends anything, and that is deliberate rather than a limitation
 * to be lifted later. LinkedIn's robots.txt prohibits automated access and
 * their User Agreement forbids driving a logged-in session, so an integration
 * that posted on Anthony's behalf would put the account his outbound runs
 * through at risk. Copying takes a second; losing the account does not.
 *
 * The screen is built around the one action that matters — copy — so the row
 * shows the draft at full size and everything else stays out of its way.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, Loader2, Copy, Check, ExternalLink, Trash2, Send, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type Intent = "reply" | "connect" | "dm";
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
  { key: "reply", label: "Public reply", hint: "under 60 words, has to add something" },
  { key: "connect", label: "Connection note", hint: "under 300 characters" },
  { key: "dm", label: "Direct message", hint: "under 120 words, one question" },
];

export default function OutreachPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [personName, setPersonName] = useState("");
  const [personHeadline, setPersonHeadline] = useState("");
  const [intent, setIntent] = useState<Intent>("reply");
  const [drafting, setDrafting] = useState(false);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [tab, setTab] = useState<Status>("waiting");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<number | null>(null);

  const load = async (status: Status) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/outreach?status=${status}`);
      setDrafts(r.ok ? await r.json() : []);
    } catch {
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(tab); }, [tab]);

  const create = async () => {
    if (sourceText.trim().length < 20) {
      toast({ title: "Paste the post first", description: "Finax needs the words to reply to.", variant: "destructive" });
      return;
    }
    setDrafting(true);
    try {
      const r = await fetch("/api/outreach/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, sourceUrl, personName, personHeadline, intent }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error || "Drafting failed");
      setSourceText(""); setSourceUrl(""); setPersonName(""); setPersonHeadline("");
      setTab("waiting");
      await load("waiting");
      toast({ title: "Draft ready", description: "It's waiting below." });
    } catch (e: any) {
      toast({ title: "Couldn't draft that", description: e?.message, variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  };

  const patch = async (id: number, body: Record<string, unknown>, quiet = false) => {
    try {
      const r = await fetch(`/api/outreach/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error();
      if (!quiet) await load(tab);
    } catch {
      toast({ title: "Couldn't save that", variant: "destructive" });
    }
  };

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
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <button
          onClick={() => navigate("/admin")}
          className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Admin
        </button>

        <h1 className="text-2xl font-bold tracking-tight">Outreach</h1>
        <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">
          Paste a LinkedIn post and Finax drafts a reply against the live book — open pools, real
          premiums, what has settled. Drafts wait here for you to copy. Nothing is sent from this
          page: LinkedIn's terms prohibit automated posting, and the account is worth more than the
          keystrokes.
        </p>

        {/* ── compose ── */}
        <div className="mt-7 rounded-lg border border-border bg-muted/20 p-4">
          <textarea
            value={sourceText}
            onChange={e => setSourceText(e.target.value)}
            placeholder="Paste the post or comment here…"
            rows={5}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
            <input
              value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
              placeholder="Link to the post"
              className="rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <input
              value={personName} onChange={e => setPersonName(e.target.value)}
              placeholder="Their name"
              className="rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <input
              value={personHeadline} onChange={e => setPersonHeadline(e.target.value)}
              placeholder="Their role, e.g. CFO, importer"
              className="rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {INTENTS.map(i => (
              <button
                key={i.key}
                onClick={() => setIntent(i.key)}
                title={i.hint}
                className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                  intent === i.key
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {i.label}
              </button>
            ))}
            <span className="ml-auto text-[11.5px] text-muted-foreground">
              {INTENTS.find(i => i.key === intent)?.hint}
            </span>
          </div>

          <Button onClick={create} disabled={drafting} className="mt-3.5 w-full sm:w-auto">
            {drafting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Finax is writing…</>
                      : <><Sparkles className="mr-2 h-4 w-4" /> Draft it</>}
          </Button>
        </div>

        {/* ── the waiting room ── */}
        <div className="mt-9 flex items-center gap-1.5 border-b border-border">
          {(["waiting", "sent", "discarded"] as Status[]).map(s => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] capitalize transition-colors ${
                tab === s ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-14"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : drafts.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted-foreground">
            {tab === "waiting" ? "Nothing waiting. Paste a post above." : `Nothing ${tab}.`}
          </p>
        ) : (
          <div className="mt-5 space-y-4">
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
                      href={d.sourceUrl} target="_blank" rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-primary no-underline hover:underline"
                    >
                      Open the post <ExternalLink className="h-3 w-3" />
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
                  onBlur={e => { if (e.target.value.trim() !== d.draft) patch(d.id, { draft: e.target.value }, true); }}
                  rows={Math.min(10, Math.max(3, Math.ceil(d.draft.length / 72)))}
                  className="w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 text-[14px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />

                {d.status === "waiting" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => copy(d)}>
                      {copied === d.id ? <><Check className="mr-1.5 h-3.5 w-3.5" /> Copied</>
                                       : <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy</>}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => patch(d.id, { status: "sent" })}>
                      <Send className="mr-1.5 h-3.5 w-3.5" /> Mark sent
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => patch(d.id, { status: "discarded" })}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Discard
                    </Button>
                  </div>
                )}
                {d.status !== "waiting" && (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => copy(d)}>
                      {copied === d.id ? "Copied" : "Copy"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => patch(d.id, { status: "waiting" })}>
                      Back to waiting
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
