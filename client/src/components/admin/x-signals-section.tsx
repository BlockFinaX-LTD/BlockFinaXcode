/**
 * Admin: X signals. Public posts on X about currency problems, found twice a day by
 * server/x-signals, best first. Review each one: reply on X yourself, then mark it.
 * Nothing here posts or messages anyone.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

async function api(url: string, token: string, body?: unknown) {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Request failed (${res.status})`);
  return json;
}

interface Signal {
  id: string; url: string; text: string; topic: string; score: number; status: string; note: string | null;
  kind: string | null; reason: string | null;
  postedAt: string; likes: number; replies: number; reposts: number; views: number;
  author: { handle: string; name: string; followers: number; location: string | null; bio: string | null };
}
interface Data {
  configured: boolean;
  lastRun: null | { started_at: string; finished_at: string | null; found: number; kept: number; pages: number; error: string | null };
  topics: { key: string; label: string }[];
  counts: Record<string, number>;
  signals: Signal[];
}

const STATUSES: [string, string][] = [["new", "To review"], ["useful", "Useful"], ["contacted", "Contacted"], ["dismissed", "Dismissed"]];
const n = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v));
const ago = (iso: string) => {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export function XSignalsSection({ token }: { token: string }) {
  const { toast } = useToast();
  const [status, setStatus] = useState("new");
  const [topic, setTopic] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const key = ["admin-x-signals", status, topic];
  const q = useQuery<Data>({
    queryKey: key,
    queryFn: () => api(`/api/admin/x-signals?status=${status}${topic ? `&topic=${topic}` : ""}`, token),
  });

  const mark = async (id: string, next: string) => {
    try {
      await api(`/api/admin/x-signals/${id}/status`, token, { status: next });
      await queryClient.invalidateQueries({ queryKey: ["admin-x-signals"] });
    } catch (e) { toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" }); }
  };
  const runNow = async () => {
    setRunning(true);
    try {
      const r = await api("/api/admin/x-signals/run", token, {});
      toast({ title: `${r.kept} new posts`, description: `${r.found} found across ${r.pages} pages${r.errors.length ? `. ${r.errors.length} topics failed.` : "."}` });
      await queryClient.invalidateQueries({ queryKey: ["admin-x-signals"] });
    } catch (e) { toast({ title: "Search failed", description: (e as Error).message, variant: "destructive" }); }
    finally { setRunning(false); }
  };

  const d = q.data;
  const label = (k: string) => d?.topics.find((t) => t.key === k)?.label ?? k;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">X signals</h2>
          <p className="text-sm text-gray-500 max-w-2xl">
            Public posts on X about currency problems, searched every 12 hours. Reply on X yourself when you can help, then mark the post.
          </p>
          {d?.lastRun && (
            <p className="text-xs text-gray-400 mt-1">
              Last search {ago(d.lastRun.started_at)}: {d.lastRun.kept} new of {d.lastRun.found} posts{d.lastRun.error ? ` · ${d.lastRun.error}` : ""}
            </p>
          )}
        </div>
        <Button size="sm" disabled={running || !d?.configured} onClick={runNow}>
          {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}Search now
        </Button>
      </div>

      {d && !d.configured && (
        <Card><CardContent className="p-4 text-sm text-amber-800 bg-amber-50">
          Not switched on yet. Add <code>TWITTERAPI_IO_KEY</code> to this server's variables in Railway, and searches start within the hour.
        </CardContent></Card>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUSES.map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k)}
            className={cn("rounded-full border px-3 py-1 text-sm", status === k ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700")}>
            {l}{d?.counts[k] ? ` (${d.counts[k]})` : ""}
          </button>
        ))}
        <span className="mx-1 border-l" />
        <button onClick={() => setTopic(null)} className={cn("rounded-full border px-3 py-1 text-sm", !topic ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700")}>All topics</button>
        {d?.topics.map((t) => (
          <button key={t.key} onClick={() => setTopic(t.key)}
            className={cn("rounded-full border px-3 py-1 text-sm", topic === t.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700")}>{t.label}</button>
        ))}
      </div>

      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : !d?.signals.length ? (
        <p className="text-sm text-gray-500">Nothing here yet.</p>
      ) : (
        <div className="space-y-3">
          {d.signals.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold">{s.author.name}</span>{" "}
                    <a className="text-blue-600" href={`https://x.com/${s.author.handle}`} target="_blank" rel="noopener noreferrer">@{s.author.handle}</a>
                    <span className="text-gray-500"> · {n(s.author.followers)} followers{s.author.location ? ` · ${s.author.location}` : ""} · {ago(s.postedAt)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{label(s.topic)}</span>
                    {s.kind && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700 capitalize">{s.kind}</span>}
                    <span className={cn("rounded-full px-2 py-0.5 font-semibold", s.score >= 70 ? "bg-green-100 text-green-800" : s.score >= 45 ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600")}>Score {s.score}</span>
                  </div>
                </div>
                {s.author.bio && <p className="text-xs text-gray-500 line-clamp-2">{s.author.bio}</p>}
                <p className="text-[15px] whitespace-pre-wrap leading-relaxed">{s.text}</p>
                {s.reason && <p className="text-sm text-blue-800 bg-blue-50 rounded-md px-3 py-1.5">{s.reason}</p>}
                <div className="text-xs text-gray-500">{n(s.replies)} replies · {n(s.reposts)} reposts · {n(s.likes)} likes · {n(s.views)} views</div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <a href={`https://x.com/intent/post?in_reply_to=${s.id}`} target="_blank" rel="noopener noreferrer">
                    <Button size="sm"><MessageCircle className="h-4 w-4 mr-1.5" />Reply on X</Button>
                  </a>
                  <a href={s.url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><ExternalLink className="h-4 w-4 mr-1.5" />Open</Button></a>
                  {s.status !== "useful" && <Button size="sm" variant="outline" onClick={() => mark(s.id, "useful")}>Useful</Button>}
                  {s.status !== "contacted" && <Button size="sm" variant="outline" onClick={() => mark(s.id, "contacted")}>Contacted</Button>}
                  {s.status !== "dismissed" && <Button size="sm" variant="ghost" onClick={() => mark(s.id, "dismissed")}>Dismiss</Button>}
                  {s.status !== "new" && <Button size="sm" variant="ghost" onClick={() => mark(s.id, "new")}>Back to review</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
