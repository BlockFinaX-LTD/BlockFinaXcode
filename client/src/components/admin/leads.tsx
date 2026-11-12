/**
 * leads.tsx, every way of finding someone to reach, in one place.
 *
 * LinkedIn posts, pasted pages, Google Maps, job posts, news, list pages and
 * investor profiles all exist to produce the same thing: people and businesses
 * to reach. They used to live on three tabs with three search boxes. Here they
 * are one search with a "where to look" choice, and the results sit underneath:
 *
 *   People      LinkedIn people, from posts, pastes and investor searches
 *   Businesses  companies with an email address, from Maps, jobs, news, lists
 *   Investors   funds and angels with an email address
 *
 * LinkedIn post searches also write drafts, which wait in Drafts.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FinderPanel, finderInput, INTENTS, adminApi as api, minutesUntil, howLongAgo, type Intent } from "./finder";
import { OutreachPeople } from "./outreach-people";
import { ProspectsTab } from "./prospects-tab";
import { InvestorsTab } from "./investors-tab";

type Source = "linkedin" | "paste" | "places" | "jobs" | "news" | "list" | "investors";
type View = "people" | "businesses" | "investors";

interface PlannedSearch { query: string; angle: string; why: string }
interface SearchOutcome { query: string; fetched: number; error: string | null }

const SOURCES: { key: Source; label: string; about: string }[] = [
  { key: "linkedin", label: "LinkedIn posts", about: "People posting about currency risk. Finax drafts a reply for the strongest. Leave the box empty and Finax chooses the searches from what your currencies did this week." },
  { key: "jobs", label: "Job posts", about: "Companies hiring for roles that mean paying in dollars, from LinkedIn job posts in the last month." },
  { key: "places", label: "Google Maps", about: "Businesses of a type in a city, with the email on their website." },
  { key: "news", label: "News", about: "Companies named in recent news about exchange rate losses." },
  { key: "list", label: "A list page", about: "A trade fair exhibitor list, a chamber of commerce member list or a directory page. Every business on it is read." },
  { key: "investors", label: "Investors", about: "Partners, principals and angels on LinkedIn who write cheques." },
  { key: "paste", label: "Paste", about: "Paste one post, or select a whole LinkedIn notifications page and paste it. Finax separates the items and drafts for each." },
];

/** What each source starts with, so switching never leaves the wrong kind of words in the box. */
const STARTERS: Partial<Record<Source, { query: string; location: string }>> = {
  linkedin: { query: "", location: "" },
  places: { query: "food importer", location: "Accra, Ghana" },
  jobs: { query: "import manager", location: "Lagos, Nigeria" },
  news: { query: "foreign exchange loss company results", location: "Nigeria" },
  investors: { query: "pre-seed African fintech", location: "Lagos, Nigeria" },
};

export function Leads({ token, enabled, onDrafts }: { token: string; enabled: boolean; onDrafts: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [source, setSource] = useState<Source>("linkedin");
  const [view, setView] = useState<View>("people");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [blob, setBlob] = useState("");
  const [segment, setSegment] = useState("hedger");
  const [intent, setIntent] = useState<Intent>("comment");
  const [postedLimit, setPostedLimit] = useState("month");
  const [plan, setPlan] = useState<PlannedSearch[] | null>(null);
  const [searched, setSearched] = useState<SearchOutcome[] | null>(null);

  const pick = (k: Source) => {
    setSource(k);
    const s = STARTERS[k];
    if (s) { setQuery(s.query); setLocation(s.location); }
  };

  const { data: cfg } = useQuery<any>({
    queryKey: ["prospects-config", token],
    queryFn: () => api("/api/prospects/config", token),
    refetchInterval: 60_000,
  });
  const { data: investorSeeds } = useQuery<{ queries: string[]; locations: string[]; configured: boolean }>({
    queryKey: ["investor-seeds", token],
    queryFn: () => api("/api/prospects/investors/seeds", token),
  });
  const { data: schedule } = useQuery<{ lastScanAt: string | null; nextScanAt: string | null; configured: boolean }>({
    queryKey: ["outreach-schedule", token],
    queryFn: () => api("/api/outreach/schedule", token),
    refetchInterval: 120_000,
  });

  const draftsReady = (n: number, detail?: string) => {
    qc.invalidateQueries({ queryKey: ["outreach"] });
    qc.invalidateQueries({ queryKey: ["outreach-people"] });
    toast({
      title: n ? `${n} draft${n === 1 ? "" : "s"} ready, in Drafts` : "Nothing to draft",
      description: detail,
      variant: n ? undefined : "destructive",
    });
  };

  // ── LinkedIn posts and pastes, which end in drafts ──
  const auto = useMutation({
    mutationFn: () => api("/api/outreach/auto", token, { method: "POST", body: JSON.stringify({ intent, postedLimit: "week" }) }),
    onSuccess: (r: any) => {
      setPlan(r.plan ?? null); setSearched(r.searched ?? null);
      draftsReady(r.drafted, r.note ?? `${r.searched?.length ?? 0} searches · ${r.fetched} posts · ${r.relevant} about currency risk`);
    },
    onError: (e: Error) => toast({ title: "Search failed", description: e.message, variant: "destructive" }),
  });
  const search = useMutation({
    mutationFn: () => api("/api/outreach/search", token, {
      method: "POST", body: JSON.stringify({ query, intent, postedLimit, maxPosts: 50 }),
    }),
    onSuccess: (r: any) => {
      setPlan(null);
      draftsReady(r.drafted, r.fetched
        ? `${r.fetched} posts found · ${r.relevant} about currency risk`
        : "LinkedIn returned nothing. Try broader words or a longer window.");
    },
    onError: (e: Error) => toast({ title: "Search failed", description: e.message, variant: "destructive" }),
  });
  const draftOne = useMutation({
    mutationFn: () => api("/api/outreach/draft", token, {
      method: "POST", body: JSON.stringify({ sourceText: blob, sourceUrl: url, intent }),
    }),
    onSuccess: () => { setBlob(""); setUrl(""); draftsReady(1); },
    onError: (e: Error) => toast({ title: "Couldn't draft that", description: e.message, variant: "destructive" }),
  });
  const scanPage = useMutation({
    mutationFn: () => api("/api/outreach/scan", token, { method: "POST", body: JSON.stringify({ blob, intent }) }),
    onSuccess: (r: any) => {
      setBlob("");
      draftsReady(r.drafted, r.note ?? (r.skipped ? `${r.skipped} items had nothing worth replying to` : undefined));
    },
    onError: (e: Error) => toast({ title: "Couldn't read that", description: e.message, variant: "destructive" }),
  });

  // ── Businesses, which end in the email list ──
  const discover = useMutation({
    mutationFn: () => api("/api/prospects/discover", token, {
      method: "POST",
      body: JSON.stringify({
        kind: source, query, location, url, segment,
        limit: source === "places" ? 60 : 40,
      }),
    }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["prospects"] });
      setView("businesses");
      toast({
        title: r.inserted ? `${r.inserted} new businesses, under Businesses` : "Nothing new found",
        description:
          `${r.found} found, ${r.withSite} had a website, ${r.withEmail} had an address, ${r.duplicates} already known` +
          (r.errors?.length ? ` · ${r.errors[0]}` : ""),
        variant: r.inserted ? undefined : "destructive",
      });
    },
    onError: (e: Error) => toast({ title: "Search failed", description: e.message, variant: "destructive" }),
  });

  // ── Investors, which end in People ──
  const investors = useMutation({
    mutationFn: () => api("/api/prospects/investors/scan", token, {
      method: "POST", body: JSON.stringify({ query, location, maxItems: 25 }),
    }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["outreach-people"] });
      setView("people");
      toast({
        title: r.recorded ? `${r.recorded} investors found, under People` : "Nobody new found",
        description: r.recorded ? "Sort them, then reach them on LinkedIn." : (r.errors?.[0] ?? `${r.found} profiles, all already known`),
        variant: r.recorded ? undefined : "destructive",
      });
    },
    onError: (e: Error) => toast({ title: "Search failed", description: e.message, variant: "destructive" }),
  });

  const busy = auto.isPending || search.isPending || draftOne.isPending || scanPage.isPending
    || discover.isPending || investors.isPending;
  const toDrafts = source === "linkedin" || source === "paste";
  const business = source === "places" || source === "jobs" || source === "news" || source === "list";

  const run = () => {
    if (source === "linkedin") return query.trim().length >= 3 ? search.mutate() : auto.mutate();
    if (source === "paste") return url.trim() || blob.trim().length < 400 ? draftOne.mutate() : scanPage.mutate();
    if (source === "investors") return investors.mutate();
    return discover.mutate();
  };

  const suggestions: string[] | undefined =
    source === "investors" ? investorSeeds?.queries
    : source === "jobs" ? cfg?.seeds?.jobs?.[segment]
    : source === "news" ? cfg?.seeds?.news?.[segment]
    : source === "places" ? cfg?.seeds?.queries?.[segment]?.slice(0, 9)
    : undefined;

  const needsApify = source !== "paste" && cfg && !cfg.discovery;

  return (
    <div className="space-y-5">
      <FinderPanel
        sources={SOURCES}
        source={source}
        onSource={pick}
        suggestions={suggestions}
        onSuggest={setQuery}
        action={{
          label: source === "paste" ? "Draft"
            : source === "linkedin" ? (query.trim() ? "Search and draft" : "Scan for me")
            : source === "list" ? "Read the list"
            : source === "investors" ? "Find investors" : "Find businesses",
          busy,
          busyLabel: auto.isPending ? "Reading the market, then searching…"
            : draftOne.isPending || scanPage.isPending ? "Finax is writing…" : "Searching…",
          disabled: !enabled || !!needsApify
            || (source === "paste" && blob.trim().length < 20)
            || (source === "list" && !/^https?:\/\//i.test(url.trim()))
            || ((business && source !== "list" || source === "investors") && (!query.trim() || !location.trim())),
          onClick: run,
        }}
        extra={toDrafts ? (
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            Write as
            <select
              value={intent} onChange={e => setIntent(e.target.value as Intent)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[12.5px] text-foreground"
            >
              {INTENTS.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
            </select>
          </label>
        ) : business ? (
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            Looking for
            <select
              value={segment} onChange={e => setSegment(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[12.5px] text-foreground"
            >
              <option value="hedger">Businesses that need cover</option>
              <option value="underwriter">Could underwrite</option>
              <option value="psp">Payments companies</option>
              <option value="bank">Banks</option>
            </select>
          </label>
        ) : null}
        note={
          needsApify ? "Searching needs APIFY_TOKEN in Railway."
          : source === "linkedin" && schedule?.configured
            ? `Also runs by itself every 5 hours${schedule.lastScanAt ? `, last ${howLongAgo(schedule.lastScanAt)}, next in about ${minutesUntil(schedule.nextScanAt)}` : ""}. Your LinkedIn account is never used.`
          : business && cfg?.schedule?.configured
            ? "Maps, job posts and news also run by themselves every 4 hours."
          : undefined
        }
      >
        {source === "paste" ? (
          <>
            <textarea
              value={blob} onChange={e => setBlob(e.target.value)}
              placeholder="Paste a post, a thread of comments, or a whole page of LinkedIn notifications…"
              rows={6} disabled={!enabled}
              className={cn(finderInput, "resize-y leading-relaxed")}
            />
            <input
              value={url} onChange={e => setUrl(e.target.value)}
              placeholder="Link to the post, if it is just one (optional)"
              disabled={!enabled}
              className={cn(finderInput, "mt-2.5")}
            />
          </>
        ) : source === "list" ? (
          <input
            value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://… the page that lists the businesses"
            className={finderInput}
          />
        ) : source === "linkedin" ? (
          <>
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !busy) run(); }}
              placeholder="Leave empty for Finax to choose, or type e.g. cedi depreciation importers"
              disabled={!enabled}
              className={finderInput}
            />
            {query.trim() && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-muted-foreground">Posted within</span>
                {([["24h", "a day"], ["week", "a week"], ["month", "a month"]] as const).map(([k, label]) => (
                  <button
                    key={k} onClick={() => setPostedLimit(k)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                      postedLimit === k ? "border-primary bg-primary/10 font-medium text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder={
                source === "jobs" ? "Job title, e.g. procurement manager"
                : source === "news" ? "Topic, e.g. naira depreciation importers"
                : source === "investors" ? "What they invest in"
                : "What kind of business, e.g. freight forwarder"
              }
              className={finderInput}
            />
            {source === "investors" ? (
              <select
                value={location} onChange={e => setLocation(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-[13px]"
              >
                {(investorSeeds?.locations ?? ["Lagos, Nigeria"]).map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            ) : (
              <input
                value={location} onChange={e => setLocation(e.target.value)}
                placeholder={source === "news" ? "Country, e.g. Ghana" : "Where, e.g. Tema, Ghana"}
                className={finderInput}
              />
            )}
          </div>
        )}

        {source === "linkedin" && plan && (
          <div className="mt-3 space-y-2 rounded-md border border-border bg-background p-3">
            <p className="text-[12px] font-medium text-foreground">What Finax went looking for</p>
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
            <button onClick={onDrafts} className="text-[12px] text-primary hover:underline">See the drafts</button>
          </div>
        )}
      </FinderPanel>

      {/* ── what has been found ── */}
      <div className="flex gap-1 border-b border-border">
        {([
          ["people", "People"],
          ["businesses", "Businesses"],
          ["investors", "Investors"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={cn(
              "relative px-3 py-2 text-sm font-medium transition-colors",
              view === k ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {view === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {view === "people" ? <OutreachPeople token={token} />
       : view === "businesses" ? <ProspectsTab token={token} enabled={enabled} />
       : <InvestorsTab token={token} enabled={enabled} />}
    </div>
  );
}
