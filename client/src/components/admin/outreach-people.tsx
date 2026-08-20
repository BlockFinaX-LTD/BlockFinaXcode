/**
 * outreach-people.tsx — the list of individuals, and what qualified them.
 *
 * Every row got here by writing something about currency risk in public. That
 * is the column worth reading: `topics` is derived from which relevance signals
 * their posts actually matched, not from their job title. A title is a claim
 * about what someone cares about; a post is evidence.
 *
 * Sorted by best score rather than most recent, so the sharpest people stay at
 * the top instead of being pushed down by whoever happened to post today.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ExternalLink, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Person {
  id: number;
  profileUrl: string;
  name: string | null;
  headline: string | null;
  company: string | null;
  topics: string | null;
  postsSeen: number;
  topScore: number;
  lastPostText: string | null;
  lastPostUrl: string | null;
  status: string;
  notes: string | null;
  lastSeen: string | null;
}

const STATUSES = [
  { key: "all", label: "Everyone" },
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "ignored", label: "Ignored" },
] as const;

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

export function OutreachPeople({ token }: { token: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<{ people: Person[]; counts: Record<string, number> }>({
    queryKey: ["outreach-people", filter, token],
    queryFn: () => api(`/api/outreach/people?status=${filter}`, token),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/outreach/people/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach-people"] }),
    onError: () => toast({ title: "Couldn't save that", variant: "destructive" }),
  });

  const people = data?.people ?? [];
  const counts = data?.counts ?? {};

  return (
    <div className="space-y-4">
      <p className="max-w-[68ch] text-sm text-muted-foreground">
        Everyone whose post was worth answering, collected as you draft. The topics beside each name
        are what they were seen writing about —{" "}
        <span className="text-foreground">evidence, not job titles</span>. The list grows on its own
        every time you use the drafter.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map(s => (
          <button
            key={s.key}
            onClick={() => setFilter(s.key)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-[12.5px] transition-colors",
              filter === s.key
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
            {counts[s.key] !== undefined && (
              <span className="ml-1.5 text-[11px] opacity-70">{counts[s.key]}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the list…
        </div>
      ) : !people.length ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <Users className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {filter === "all"
              ? "Nobody yet. Draft a few replies and the list fills itself."
              : `Nobody marked ${filter}.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {people.map(p => (
            <div key={p.id} className="rounded-lg border border-border bg-muted/10 p-3.5">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={p.profileUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                    >
                      {p.name || "Unnamed"}
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </a>
                    {/* Interest, measured: someone who keeps posting about this is
                        a better prospect than someone who did it once. */}
                    {p.postsSeen > 1 && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-foreground">
                        {p.postsSeen} posts
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">score {p.topScore}</span>
                  </div>
                  {p.headline && (
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">{p.headline}</p>
                  )}
                  {p.topics && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.topics.split(",").filter(Boolean).map(t => (
                        <span
                          key={t}
                          className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {t.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <select
                  value={p.status}
                  onChange={e => update.mutate({ id: p.id, body: { status: e.target.value } })}
                  className="rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {["new", "drafted", "contacted", "replied", "ignored"].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {p.lastPostText && (
                <p className="mt-2 line-clamp-2 border-l-2 border-border pl-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  {p.lastPostText}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
