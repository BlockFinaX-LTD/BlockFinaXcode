/**
 * content-tab.tsx — drafting posts, in the agent session.
 *
 * Two buttons that mean different things. Draft shows you something without
 * committing it, which is what you want while finding the angle. Queue files it
 * for approval, which is the commitment, and it lands in the same queue as
 * everything else the agent proposes.
 *
 * The computed brief is shown beside the draft rather than hidden. Every
 * currency figure in a post comes from it, and a draft whose numbers cannot be
 * checked is a draft that gets approved on vibes.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Inbox, Copy, Check } from "lucide-react";
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

interface Drafted { angle: string; pair: string | null; body: string; brief: string | null }

export function ContentTab({ token }: { token: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [angle, setAngle] = useState("volatility_reality");
  const [pair, setPair] = useState("USD/GHS");
  const [extra, setExtra] = useState("");
  const [draft, setDraft] = useState<Drafted | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: meta } = useQuery({
    queryKey: ["content-angles"],
    queryFn: () => api("/api/content/angles", token),
  });

  const draftM = useMutation({
    mutationFn: () => api("/api/content/draft", token, {
      method: "POST", body: JSON.stringify({ angle, pair: pair || undefined, extra: extra || undefined }),
    }),
    onSuccess: (d: Drafted) => setDraft(d),
    onError: (e: any) => toast({ title: "Not drafted", description: e.message, variant: "destructive" }),
  });

  const queueM = useMutation({
    mutationFn: () => api("/api/content/propose", token, {
      method: "POST", body: JSON.stringify({ angle, pair: pair || undefined, extra: extra || undefined }),
    }),
    onSuccess: () => {
      toast({ title: "In the queue", description: "Approve it there and it can be posted." });
      qc.invalidateQueries({ queryKey: ["agent-status"] });
    },
    onError: (e: any) => toast({ title: "Not queued", description: e.message, variant: "destructive" }),
  });

  const angles: Array<{ key: string; label: string; brief: string }> = meta?.angles ?? [];
  const pairs: string[] = meta?.pairs ?? [];
  const chosen = angles.find((a) => a.key === angle);
  const busy = draftM.isPending || queueM.isPending;

  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { toast({ title: "Could not copy", variant: "destructive" }); }
  };

  return (
    <div className="space-y-4 py-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Posts are built on figures computed from the price history at drafting time, so they cannot be
        stale and cannot be invented. Nothing here posts anything: an approved draft still has to be
        published by a person.
      </p>

      {/* The angle, chosen rather than left to the model. "Write something
          insightful" returns the average of everything ever posted. */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {angles.map((a) => (
          <button
            key={a.key}
            onClick={() => setAngle(a.key)}
            className={cn(
              "rounded-lg border p-2.5 text-left transition-colors",
              angle === a.key
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-muted-foreground/40",
            )}
          >
            <span className="text-xs font-medium">{a.label}</span>
          </button>
        ))}
      </div>
      {chosen && <p className="text-[11px] leading-relaxed text-muted-foreground">{chosen.brief}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={pair} onChange={(e) => setPair(e.target.value)}
          className="h-8 rounded border border-border bg-background px-2 text-xs"
        >
          <option value="">No pair</option>
          {pairs.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input
          value={extra} onChange={(e) => setExtra(e.target.value)}
          placeholder="Anything you want it to include, optional"
          className="h-8 min-w-[200px] flex-1 rounded border border-border bg-background px-2 text-xs"
        />
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={() => draftM.mutate()} disabled={busy}>
          {draftM.isPending
            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Drafting…</>
            : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Draft one</>}
        </Button>
        <Button size="sm" variant="outline" onClick={() => queueM.mutate()} disabled={busy}>
          {queueM.isPending
            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Queueing…</>
            : <><Inbox className="mr-1.5 h-3.5 w-3.5" /> Draft and queue for approval</>}
        </Button>
      </div>

      {draft && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Draft{draft.pair ? ` · ${draft.pair}` : ""}
              </span>
              <button onClick={copy} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
              </button>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{draft.body}</p>
            <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
              {draft.body.trim().split(/\s+/).length} words
            </p>
          </div>

          {draft.brief && (
            <details className="rounded-lg border border-border bg-muted/30 p-3">
              <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                The figures it was built on
              </summary>
              {/* Shown so a number in the post can be checked against the thing
                  it came from without leaving the page. */}
              <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                {draft.brief}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
