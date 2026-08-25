/**
 * outreach-people.tsx, the leads and how BlockFinaX relates to each of them.
 *
 * Rows arrive two ways: someone wrote a post worth answering, or Anthony opened
 * their profile with the extension running. Either way the qualification comes
 * from evidence rather than from a title. A title claims what someone cares
 * about; a post proves it.
 *
 * ## Why they are grouped rather than ranked
 *
 * A single ordered list implies one axis, closeness to buying, and on that axis
 * every publication scores badly. That is the wrong reading. MarketForces
 * Africa will never buy cover and is one of the most valuable accounts here,
 * because a good comment on their post is read by hundreds of people who might.
 * Grouping by what someone is keeps that visible; ranking would bury it.
 *
 * ## Why nothing is a lead until a person says so
 *
 * The sorting is a model guessing about a stranger's business from a headline
 * and a couple of posts, and it guesses confidently either way. Verified is set
 * by Anthony and by nothing else, and it records who looked, because a
 * verification with nobody's name against it is just another guess.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ExternalLink, Users, Sparkles, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  segment: string | null;
  fit: string | null;
  fitScore: number | null;
  about: string | null;
  verified: boolean;
  verifiedBy: string | null;
}

/**
 * What each kind of lead is for.
 *
 * The kind matters more than the score, because it decides what a good outcome
 * looks like. An amplifier will never buy cover and is often the most valuable
 * account on the list, since one comment on their post reaches hundreds of
 * people who would. Ranking everyone on a single "how close to buying" axis
 * hides that entirely.
 */
const SEGMENTS: Record<string, { label: string; hint: string; tone: string }> = {
  buyer:     { label: "Buyers",     hint: "carry the exposure themselves",            tone: "text-emerald-600 dark:text-emerald-500" },
  amplifier: { label: "Amplifiers", hint: "reach the people who do",                  tone: "text-blue-600 dark:text-blue-400" },
  partner:   { label: "Partners",   hint: "banks, brokers, could distribute",         tone: "text-violet-600 dark:text-violet-400" },
  investor:  { label: "Investors",  hint: "back the company, not a pool",             tone: "text-pink-600 dark:text-pink-400" },
  peer:      { label: "Peers",      hint: "building something adjacent",              tone: "text-amber-600 dark:text-amber-500" },
  observer:  { label: "Observers",  hint: "interested, not exposed",                  tone: "text-muted-foreground" },
};

const STATUSES = [
  { key: "all", label: "Everyone" },
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "ignored", label: "Ignored" },
] as const;

const SEGMENT_ORDER = ["buyer", "investor", "partner", "amplifier", "peer", "observer"];

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

  const qualifyAll = useMutation({
    mutationFn: () => api("/api/outreach/people/qualify-all", token, {
      method: "POST", body: JSON.stringify({ limit: 25 }),
    }),
    onSuccess: (r: { qualified: number; remaining: number }) => {
      qc.invalidateQueries({ queryKey: ["outreach-people"] });
      toast({
        title: r.qualified ? `${r.qualified} sorted` : "Nothing new to sort",
        description: r.remaining ? `${r.remaining} still waiting. Run it again.` : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Could not sort", description: e.message, variant: "destructive" }),
  });

  const draftMessages = useMutation({
    mutationFn: () => api("/api/outreach/people/draft-messages", token, {
      method: "POST", body: JSON.stringify({ limit: 10 }),
    }),
    onSuccess: (r: { drafted: number; considered: number; note?: string }) => {
      qc.invalidateQueries({ queryKey: ["outreach-people"] });
      qc.invalidateQueries({ queryKey: ["outreach"] });
      toast({
        title: r.drafted ? `${r.drafted} messages written` : "Nothing to write",
        description: r.drafted
          ? "They're waiting in Drafts. Read each one, then send it on LinkedIn yourself."
          : (r.note ?? "Sort some leads first, or they have all been written to."),
        variant: r.drafted ? undefined : "destructive",
      });
    },
    onError: (e: Error) => toast({ title: "Could not write those", description: e.message, variant: "destructive" }),
  });

  const qualifyOne = useMutation({
    mutationFn: (id: number) => api(`/api/outreach/people/${id}/qualify`, token, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach-people"] }),
    onError: (e: Error) => toast({ title: "Could not sort that one", description: e.message, variant: "destructive" }),
  });

  const verify = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) =>
      api(`/api/outreach/people/${id}/verify`, token, {
        method: "POST", body: JSON.stringify({ verified: on }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach-people"] }),
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
        Everyone whose post was worth answering, plus any profile you open with the extension
        running. Finax sorts them by what they are and says how you relate to each one. Nothing is a
        confirmed lead until{" "}
        <span className="text-foreground">you mark it verified</span>, because the sorting is a
        guess from a headline and a few posts.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={qualifyAll.isPending} onClick={() => qualifyAll.mutate()}>
          {qualifyAll.isPending
            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Sorting…</>
            : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Sort the new ones</>}
        </Button>
        <span className="text-[12px] text-muted-foreground">
          Works out what each person is and how BlockFinaX relates to them. 25 at a time.
        </span>
      </div>

      {/* Asking for their read, not their business.
          Only sorted leads, because what you ask a Lagos treasurer and what you
          ask a fund partner are different questions, and the wrong one is worse
          than nothing. Publications and observers are skipped: a title has no
          personal view on running currency exposure. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={draftMessages.isPending} onClick={() => draftMessages.mutate()}>
          {draftMessages.isPending
            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Writing…</>
            : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Write to the new ones</>}
        </Button>
        <span className="text-[12px] text-muted-foreground">
          A short message asking for a call to hear their view. Buyers, investors, partners and
          peers only. 10 at a time, waiting in Drafts for you to send.
        </span>
      </div>

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
        <div className="space-y-6">
          {SEGMENT_ORDER.concat(["unsorted"]).map(seg => {
            const group = people.filter(p =>
              seg === "unsorted" ? !p.segment : p.segment === seg,
            );
            if (!group.length) return null;
            const meta = SEGMENTS[seg];
            return (
              <div key={seg}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h4 className={cn("text-[13px] font-medium", meta?.tone)}>
                    {meta?.label ?? "Not sorted yet"}
                  </h4>
                  <span className="text-[11.5px] text-muted-foreground">
                    {meta?.hint ?? "press Sort the new ones"} · {group.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {group.map(p => (
                    <div
                      key={p.id}
                      className={cn(
                        "rounded-lg border p-3.5",
                        p.verified ? "border-emerald-500/40 bg-emerald-500/[0.04]" : "border-border bg-muted/10",
                      )}
                    >
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
                            {p.verified && (
                              <span
                                title={p.verifiedBy ? `Verified by ${p.verifiedBy}` : "Verified"}
                                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-500"
                              >
                                <BadgeCheck className="h-3 w-3" /> verified lead
                              </span>
                            )}
                            {p.fitScore !== null && (
                              <span className="text-[11px] tabular-nums text-muted-foreground">
                                fit {p.fitScore}
                              </span>
                            )}
                            {p.postsSeen > 1 && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-foreground">
                                {p.postsSeen} posts
                              </span>
                            )}
                          </div>
                          {p.headline && (
                            <p className="mt-0.5 text-[12.5px] text-muted-foreground">{p.headline}</p>
                          )}
                          {/* How we relate. The reason this person is on the list at all. */}
                          {p.fit && (
                            <p className="mt-1.5 border-l-2 border-border pl-2.5 text-[12.5px] leading-relaxed">
                              {p.fit}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col items-end gap-1.5">
                          <select
                            value={p.status}
                            onChange={e => update.mutate({ id: p.id, body: { status: e.target.value } })}
                            className="rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {["new", "drafted", "contacted", "replied", "ignored"].map(st => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                          <div className="flex gap-1.5">
                            {!p.segment && (
                              <button
                                onClick={() => qualifyOne.mutate(p.id)}
                                className="rounded-md border border-border px-2 py-1 text-[11.5px] text-muted-foreground hover:text-foreground"
                              >
                                Sort
                              </button>
                            )}
                            <button
                              onClick={() => verify.mutate({ id: p.id, on: !p.verified })}
                              className={cn(
                                "rounded-md border px-2 py-1 text-[11.5px]",
                                p.verified
                                  ? "border-border text-muted-foreground hover:text-foreground"
                                  : "border-emerald-500/40 text-emerald-600 dark:text-emerald-500",
                              )}
                            >
                              {p.verified ? "Unverify" : "Verify"}
                            </button>
                          </div>
                        </div>
                      </div>

                      {p.lastPostText && (
                        <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                          {p.lastPostText}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
