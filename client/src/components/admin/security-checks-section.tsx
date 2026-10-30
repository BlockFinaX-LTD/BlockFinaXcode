/**
 * Admin: Security checks. Everything to close before mainnet (server/security-checks),
 * stored in the database rather than the public repository. Import the list from a JSON
 * file, then tick each check off with notes.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, Loader2, ShieldCheck, Upload } from "lucide-react";

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

type Status = "todo" | "in_progress" | "done" | "not_needed";
type Priority = "blocker" | "high" | "medium" | "low";
interface Check {
  id: string; area: string; title: string; why: string; how: string; priority: Priority; status: Status;
  owner: string | null; notes: string | null; sort: number; updatedBy: string | null; updatedAt: string;
}

const STATUS_LABEL: Record<Status, string> = { todo: "To do", in_progress: "In progress", done: "Done", not_needed: "Not needed" };
const STATUS_STYLE: Record<Status, string> = {
  todo: "bg-gray-100 text-gray-700", in_progress: "bg-amber-100 text-amber-800", done: "bg-green-100 text-green-800", not_needed: "bg-slate-100 text-slate-500",
};
const PRIORITY_STYLE: Record<Priority, string> = {
  blocker: "bg-red-100 text-red-800", high: "bg-orange-100 text-orange-800", medium: "bg-blue-100 text-blue-800", low: "bg-gray-100 text-gray-600",
};
const PRIORITY_LABEL: Record<Priority, string> = { blocker: "Blocker", high: "High", medium: "Medium", low: "Low" };
const closed = (s: Status) => s === "done" || s === "not_needed";
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function SecurityChecksSection({ token }: { token: string }) {
  const { toast } = useToast();
  const q = useQuery<{ checks: Check[] }>({ queryKey: ["admin-security-checks"], queryFn: () => api("/api/admin/security-checks", token) });
  const [filter, setFilter] = useState<"open" | "blockers" | "all">("open");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const checks = q.data?.checks ?? [];
  const stats = useMemo(() => {
    const done = checks.filter((c) => closed(c.status)).length;
    const blockers = checks.filter((c) => c.priority === "blocker");
    return { done, total: checks.length, blockersOpen: blockers.filter((c) => !closed(c.status)).length, blockers: blockers.length };
  }, [checks]);

  const shown = checks.filter((c) => {
    if (filter === "open" && closed(c.status)) return false;
    if (filter === "blockers" && (c.priority !== "blocker" || closed(c.status))) return false;
    const s = search.trim().toLowerCase();
    return !s || `${c.title} ${c.area} ${c.why} ${c.how} ${c.notes ?? ""}`.toLowerCase().includes(s);
  });
  const areas = Array.from(new Set(shown.map((c) => c.area)));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-security-checks"] });
  const save = async (id: string, change: Partial<Pick<Check, "status" | "notes" | "owner">>) => {
    try { await api(`/api/admin/security-checks/${id}`, token, change); await refresh(); }
    catch (e) { toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" }); }
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const body = JSON.parse(await file.text());
      const { imported } = await api("/api/admin/security-checks/import", token, body);
      toast({ title: "Imported", description: `${imported} checks. Progress already recorded was kept.` });
      await refresh();
    } catch (e) { toast({ title: "Not imported", description: (e as Error).message, variant: "destructive" }); }
    finally { setImporting(false); }
  };
  const remove = async (c: Check) => {
    if (!window.confirm(`Remove "${c.title}"?`)) return;
    try { await api(`/api/admin/security-checks/${c.id}/delete`, token, {}); await refresh(); }
    catch (e) { toast({ title: "Not removed", description: (e as Error).message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Security checks</h1>
          <p className="text-sm text-gray-500 max-w-2xl">Everything to close before real money goes on mainnet. Stored in the database, never in the public code repository. Admins only.</p>
        </div>
        <label className="cursor-pointer">
          <span className="inline-flex items-center rounded-md border bg-white px-3 py-1.5 text-sm">
            {importing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}Import checks (JSON)
          </span>
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </div>

      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : !checks.length ? (
        <Card><CardContent className="p-6 text-sm text-gray-500">No checks yet. Click <b>Import checks (JSON)</b> and choose the checklist file.</CardContent></Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-3">
            <Card><CardContent className="p-4">
              <div className="text-sm text-gray-500">Closed</div>
              <div className="text-2xl font-semibold">{stats.done} of {stats.total}</div>
              <Progress value={stats.total ? (stats.done / stats.total) * 100 : 0} className="mt-2 h-2" />
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-sm text-gray-500">Blockers open</div>
              <div className={`text-2xl font-semibold ${stats.blockersOpen ? "text-red-700" : "text-green-700"}`}>{stats.blockersOpen} of {stats.blockers}</div>
              <div className="text-xs text-gray-500 mt-1">{stats.blockersOpen ? "Mainnet waits for these." : "No blockers left."}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-sm text-gray-500">Ready for mainnet</div>
              <div className="flex items-center gap-2 text-2xl font-semibold">
                <ShieldCheck className={`h-6 w-6 ${stats.blockersOpen ? "text-gray-300" : "text-green-600"}`} />{stats.blockersOpen ? "Not yet" : "Yes"}
              </div>
            </CardContent></Card>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["open", "blockers", "all"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
                {f === "open" ? "Open" : f === "blockers" ? "Open blockers" : "All"}
              </Button>
            ))}
            <Input className="max-w-xs ml-auto" placeholder="Search checks" aria-label="Search checks" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {!shown.length && <p className="text-sm text-gray-500">Nothing here. {filter !== "all" && "Try All."}</p>}
          {areas.map((area) => (
            <div key={area} className="space-y-2">
              <h2 className="font-semibold text-gray-700 pt-2">{area}</h2>
              {shown.filter((c) => c.area === area).map((c) => (
                <CheckRow key={`${c.id}:${c.updatedAt}`} check={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} onSave={(ch) => save(c.id, ch)} onRemove={() => remove(c)} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function CheckRow({ check: c, open, onToggle, onSave, onRemove }: {
  check: Check; open: boolean; onToggle: () => void;
  onSave: (change: Partial<Pick<Check, "status" | "notes" | "owner">>) => Promise<void>; onRemove: () => void;
}) {
  const [notes, setNotes] = useState(c.notes ?? "");
  const [owner, setOwner] = useState(c.owner ?? "");
  const dirty = notes !== (c.notes ?? "") || owner !== (c.owner ?? "");
  return (
    <Card className={closed(c.status) ? "opacity-70" : ""}>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <button className="flex items-start gap-2 text-left flex-1 min-w-[240px]" onClick={onToggle} aria-expanded={open}>
            {open ? <ChevronDown className="h-4 w-4 mt-1 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-1 shrink-0" />}
            <span className={`font-medium ${c.status === "done" ? "line-through decoration-gray-400" : ""}`}>{c.title}</span>
          </button>
          <span className={`text-xs rounded px-2 py-0.5 ${PRIORITY_STYLE[c.priority]}`}>{PRIORITY_LABEL[c.priority]}</span>
          <select
            aria-label="Status" value={c.status} onChange={(e) => void onSave({ status: e.target.value as Status })}
            className={`text-xs rounded px-2 py-1 border-0 ${STATUS_STYLE[c.status]}`}
          >
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        {open && (
          <div className="border-t p-4 space-y-3 text-sm">
            {c.why && <div><div className="font-semibold text-gray-700">Why it matters</div><p className="whitespace-pre-line text-gray-600">{c.why}</p></div>}
            {c.how && <div><div className="font-semibold text-gray-700">How to check or fix</div><p className="whitespace-pre-line text-gray-600">{c.how}</p></div>}
            <div className="grid md:grid-cols-3 gap-2">
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Who is on it" aria-label="Owner" />
              <Textarea className="md:col-span-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes, evidence, links" aria-label="Notes" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!dirty} onClick={() => void onSave({ notes, owner })}>Save notes</Button>
              <Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button>
              <span className="text-xs text-gray-400 ml-auto">Updated {day(c.updatedAt)}{c.updatedBy ? ` by ${c.updatedBy}` : ""}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
