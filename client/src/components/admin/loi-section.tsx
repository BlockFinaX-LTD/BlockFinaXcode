/**
 * Agreements — admin surface for the Smart Letter of Intent flow.
 *
 * Three screens behind one section:
 *   list    dashboard of every document, filterable and searchable
 *   wizard  multi-step structured form that generates the draft
 *   detail  review/edit, risk checks, send, track, counter-sign, download
 *
 * State lives here rather than in the URL because the admin dashboard is a
 * single-page section switcher with no nested routing.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DocumentView } from "@/components/loi/document-view";
import { SignaturePad, type SigMethod } from "@/components/loi/signature-pad";
import { BrandSignatureMark } from "@/components/loi/brand-signature";
import {
  FileSignature, Plus, Search, ArrowLeft, Send, Download, Eye, Clock, CheckCircle2,
  AlertTriangle, RefreshCw, Trash2, MessageSquare, ChevronRight, Bell, PenLine,
  Copy, ShieldCheck, Loader2, X, Check, Info, FileText, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RELATIONSHIP_LABELS, DOC_TYPE_LABELS, STATUS_LABELS,
  type RelationshipType, type DocType, type LoiStatus,
} from "@shared/loi-schema";

// ── Shared bits ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  awaiting_review: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  sent: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  viewed: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  changes_requested: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  awaiting_signature: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  signed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  declined: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  expired: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

// Rows come back from the API as `any`, so look labels up defensively rather
// than asserting the union at a dozen call sites. An unknown key falls back
// to the raw value instead of rendering "undefined".
const docLabel = (k: string) => DOC_TYPE_LABELS[k as DocType] ?? k;
const relLabel = (k: string) => RELATIONSHIP_LABELS[k as RelationshipType] ?? k;

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLES[status] ?? STATUS_STYLES.draft)}>
      {STATUS_LABELS[status as LoiStatus] ?? status}
    </span>
  );
}

function fmt(d: string | Date | null | undefined, withTime = false): string {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    + (withTime ? ` · ${dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "");
}

function relativeTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmt(d);
}

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

// ── Section root ─────────────────────────────────────────────────────────

export function LoiSection({ token }: { token: string }) {
  const [view, setView] = useState<{ screen: "list" } | { screen: "wizard" } | { screen: "detail"; id: number }>({ screen: "list" });

  if (view.screen === "wizard") {
    return <LoiWizard token={token} onClose={() => setView({ screen: "list" })} onCreated={(id) => setView({ screen: "detail", id })} />;
  }
  if (view.screen === "detail") {
    return <LoiDetail token={token} id={view.id} onBack={() => setView({ screen: "list" })} />;
  }
  return <LoiList token={token} onNew={() => setView({ screen: "wizard" })} onOpen={(id) => setView({ screen: "detail", id })} />;
}

// ── List ─────────────────────────────────────────────────────────────────

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "sent", label: "Sent" },
  { key: "viewed", label: "Viewed" },
  { key: "changes_requested", label: "Changes requested" },
  { key: "awaiting_signature", label: "Awaiting signature" },
  { key: "signed", label: "Signed" },
  { key: "declined", label: "Declined" },
  { key: "expired", label: "Expired" },
];

function LoiList({ token, onNew, onOpen }: { token: string; onNew: () => void; onOpen: (id: number) => void }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["loi-list", token, filter, q],
    queryFn: () => api(`/api/loi?status=${filter}&q=${encodeURIComponent(q)}`, token),
    refetchInterval: 60_000,
  });
  const { data: stats } = useQuery({
    queryKey: ["loi-stats", token],
    queryFn: () => api("/api/loi/stats", token),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Agreements</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Draft, send and track letters of intent and other agreements. Counterparties review and sign in the browser.
          </p>
        </div>
        <Button onClick={onNew} className="gap-2">
          <Plus className="h-4 w-4" /> New Letter of Intent
        </Button>
      </div>

      <SignatureSettings token={token} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat label="Total" value={stats?.total ?? 0} icon={FileSignature} />
        <MiniStat label="Outstanding" value={stats?.outstanding ?? 0} icon={Clock} tone="text-amber-600" />
        <MiniStat label="Fully signed" value={stats?.signed ?? 0} icon={CheckCircle2} tone="text-emerald-600" />
        <MiniStat label="Changes requested" value={stats?.byStatus?.changes_requested ?? 0} icon={MessageSquare} tone="text-blue-600" />
      </div>

      <Card>
        <CardHeader className="gap-4 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search company, contact, email or reference"
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  filter === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                {f.key !== "all" && stats?.byStatus?.[f.key] ? ` (${stats.byStatus[f.key]})` : ""}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading agreements…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="rounded-full bg-muted p-3"><FileSignature className="h-6 w-6 text-muted-foreground" /></div>
              <div>
                <p className="font-medium">{q || filter !== "all" ? "Nothing matches that filter" : "No agreements yet"}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {q || filter !== "all" ? "Try a different search or filter." : "Create your first letter of intent to get started."}
                </p>
              </div>
              {!q && filter === "all" && <Button onClick={onNew} className="mt-1 gap-2"><Plus className="h-4 w-4" /> New Letter of Intent</Button>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Company</th>
                    <th className="px-5 py-3 font-medium">Contact</th>
                    <th className="hidden px-5 py-3 font-medium lg:table-cell">Relationship</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="hidden px-5 py-3 font-medium md:table-cell">Last activity</th>
                    <th className="hidden px-5 py-3 font-medium xl:table-cell">Expires</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr
                      key={r.id}
                      onClick={() => onOpen(r.id)}
                      className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-5 py-3.5">
                        <div className="font-medium">{r.recipientCompany}</div>
                        <div className="text-xs text-muted-foreground">{r.publicId}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div>{r.recipientName}</div>
                        <div className="text-xs text-muted-foreground">{r.recipientEmail}</div>
                      </td>
                      <td className="hidden px-5 py-3.5 text-muted-foreground lg:table-cell">
                        {relLabel(r.relationshipType)}
                      </td>
                      <td className="px-5 py-3.5"><StatusBadge status={r.status} /></td>
                      <td className="hidden px-5 py-3.5 text-muted-foreground md:table-cell">{relativeTime(r.lastActivityAt)}</td>
                      <td className="hidden px-5 py-3.5 text-muted-foreground xl:table-cell">{fmt(r.expiresAt)}</td>
                      <td className="px-5 py-3.5 text-right"><ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Company signature, uploaded once.
 *
 * Appears in the sign-off of every letter we email and is offered as the
 * default when counter-signing, so the CEO doesn't redraw it per document.
 * Collapsed to a single line once set — it is a one-time setup step, not
 * something worth a permanent panel.
 */
function SignatureSettings({ token }: { token: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<{ method: SigMethod; data: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The brand mark is the default: a typeset block is what most companies
  // actually put on a letter, and it needs nothing uploaded.
  const [mode, setMode] = useState<"mark" | "hand">("mark");

  const { data, refetch } = useQuery({
    queryKey: ["brand-signature", token],
    queryFn: () => api("/api/brand/signature", token),
  });

  const save = async () => {
    if (!pending) return;
    // A typed signature is plain text, which can't be embedded as an image.
    // Only drawn or uploaded signatures make sense as a stored graphic.
    if (!pending.data.startsWith("data:image/")) {
      toast({
        title: "Draw or upload your signature",
        description: "A typed name can't be saved as an image. Use the Draw or Upload tab.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      await api("/api/brand/signature", token, {
        method: "PUT",
        body: JSON.stringify({ dataUrl: pending.data, name: name.trim() }),
      });
      toast({ title: "Signature saved", description: "It will appear on letters you send from now on." });
      setOpen(false);
      setPending(null);
      refetch();
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api("/api/brand/signature", token, { method: "DELETE" });
      toast({ title: "Signature removed" });
      refetch();
    } catch (e: any) {
      toast({ title: "Couldn't remove", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <PenLine className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        {data?.present ? (
          <>
            <img src={data.dataUrl} alt="Company signature" className="h-8 w-auto max-w-[140px] object-contain" />
            <span className="text-xs text-muted-foreground">
              Signature block on file{data.name ? ` — ${data.name}` : ""}. It appears on every letter you send.
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)}>Replace</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={remove} disabled={busy}>Remove</Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">
              No signature block yet. Add one and it appears in the sign-off of every letter you send.
            </span>
            <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setOpen(true)}>
              Add signature block
            </Button>
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Signature block</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
              {([
                ["mark", "Brand mark"],
                ["hand", "Draw or upload"],
              ] as const).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setMode(k); setPending(null); }}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    mode === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {mode === "mark" ? (
              <>
                <p className="text-sm text-muted-foreground">
                  A typeset sign-off built from your logo and details — no handwriting. Edit the fields and it
                  updates live; what you see is exactly what gets saved.
                </p>
                <BrandSignatureMark
                  initial={{ name: "Anthony Kumako", title: "Founder & CEO", company: "BlockFinaX", website: "blockfinax.com" }}
                  onChange={(dataUrl, f) => {
                    setPending(dataUrl ? { method: "uploaded", data: dataUrl } : null);
                    setName(f.name);
                  }}
                />
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Draw it with a trackpad or phone, or upload a photo of your signature on white paper.
                  A transparent PNG looks best.
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Name printed beneath it</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Anthony Kumako" />
                </div>
                <SignaturePad onChange={setPending} />
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !pending} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save signature
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MiniStat({ label, value, icon: Icon, tone = "text-muted-foreground" }: { label: string; value: number; icon: any; tone?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        </div>
        <Icon className={cn("h-5 w-5", tone)} />
      </CardContent>
    </Card>
  );
}

// ── Wizard ───────────────────────────────────────────────────────────────

const STEPS = ["Recipient", "Relationship", "Details", "Review"] as const;

/**
 * The sending party. Every letter goes out from the same person, so this is
 * prefilled rather than asked for — the wizard starts on the recipient. It
 * stays editable behind "Change sender" on the review step for the day
 * someone else signs.
 */
const SENDER_DEFAULTS = {
  senderCompany: "BlockFinaX Inc.",
  senderName: "Anthony Kumako",
  senderPosition: "Founder & CEO",
  senderEmail: "anthonykumako@blockfinax.com",
  senderPhone: "",
};

const EMPTY_FORM = {
  docType: "loi" as DocType,
  ...SENDER_DEFAULTS,
  recipientCompany: "",
  recipientName: "",
  recipientPosition: "",
  recipientEmail: "",
  recipientCountry: "",
  relationshipType: "institutional_underwriter" as RelationshipType,
  terms: {
    purpose: "", description: "", estimatedVolume: "", currency: "USD",
    startDate: "", duration: "", exclusivity: "none" as const,
    confidentiality: true, confidentialityMonths: 24,
    governingLaw: "",
    specialConditions: "", additionalNotes: "",
  },
  personalMessage: "",
  expiresInDays: 30,
};

// Bumped when the form's shape or defaults change, so a draft cached from an
// older build can't mask the new sender defaults with empty strings.
const DRAFT_KEY = "bfx_loi_wizard_draft_v2";

type WizardForm = typeof EMPTY_FORM;

function LoiWizard({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  // Autosave: an unsent wizard survives a reload or an accidental navigation.
  // Spreading over EMPTY_FORM means a stored draft from an older shape still
  // loads, with any new fields taking their defaults.
  const [form, setForm] = useState<WizardForm>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      return saved ? { ...EMPTY_FORM, ...JSON.parse(saved) } : EMPTY_FORM;
    } catch { return EMPTY_FORM; }
  });

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch { /* quota — not fatal */ }
    }, 600);
    return () => clearTimeout(t);
  }, [form]);

  const set = (patch: Partial<WizardForm>) => setForm((f) => ({ ...f, ...patch }));
  const setTerm = (patch: Partial<WizardForm["terms"]>) =>
    setForm((f) => ({ ...f, terms: { ...f.terms, ...patch } }));

  const create = useMutation({
    mutationFn: () => api("/api/loi", token, { method: "POST", body: JSON.stringify(form) }),
    onSuccess: (row) => {
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      queryClient.invalidateQueries({ queryKey: ["loi-list"] });
      queryClient.invalidateQueries({ queryKey: ["loi-stats"] });
      toast({ title: "Draft created", description: "Review the generated document, then send it." });
      onCreated(row.id);
    },
    onError: (e: any) => toast({ title: "Couldn't create the draft", description: e.message, variant: "destructive" }),
  });

  // Reveals the prefilled sender fields on the review step.
  const [editSender, setEditSender] = useState(false);

  // Gate progression on the fields the server will reject anyway, so the
  // user hits validation here rather than after four steps of typing. The
  // sender is prefilled but still checked — a cleared field must not sail
  // through to a 400 from the API.
  const stepValid = useMemo(() => {
    if (step === 0) return !!(form.recipientCompany.trim() && form.recipientName.trim() && /\S+@\S+\.\S+/.test(form.recipientEmail));
    if (step === 3) return !!(form.senderCompany.trim() && form.senderName.trim() && /\S+@\S+\.\S+/.test(form.senderEmail));
    return true;
  }, [step, form]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Agreements
        </Button>
      </div>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">New {DOC_TYPE_LABELS[form.docType]}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Fill in the details and we'll draft the document for you. You can edit every word before it goes out.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-shrink-0 items-center gap-1">
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                i === step ? "bg-primary text-primary-foreground"
                  : i < step ? "bg-muted text-foreground hover:bg-muted/70"
                  : "text-muted-foreground",
              )}
            >
              <span className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
                i < step ? "bg-emerald-500 text-white" : i === step ? "bg-primary-foreground/20" : "bg-muted",
              )}>
                {i < step ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </span>
              {s}
            </button>
            {i < STEPS.length - 1 && <div className="h-px w-4 bg-border" />}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-5 p-6">
          {step === 0 && (
            <>
              <SectionHead title="Who are you sending this to?" hint="The signing link goes to this address, and only this address can sign." />
              <Grid>
                <Field label="Company name" required value={form.recipientCompany} onChange={(v) => set({ recipientCompany: v })} placeholder="ABC Manufacturing Ltd." />
                <Field label="Representative name" required value={form.recipientName} onChange={(v) => set({ recipientName: v })} placeholder="Full name" />
                <Field label="Position" value={form.recipientPosition} onChange={(v) => set({ recipientPosition: v })} placeholder="Finance Director" />
                <Field label="Email" required type="email" value={form.recipientEmail} onChange={(v) => set({ recipientEmail: v })} />
                <Field label="Country" value={form.recipientCountry} onChange={(v) => set({ recipientCountry: v })} />
              </Grid>
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 p-3.5">
                <Send className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Sending as <strong className="text-foreground">{form.senderName}</strong>
                  {form.senderPosition ? `, ${form.senderPosition}` : ""}, {form.senderCompany} ({form.senderEmail}).
                  You can change this on the last step.
                </p>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <SectionHead title="Relationship" hint="This picks the template and the language used to describe the collaboration." />
              <Grid>
                <div className="space-y-1.5">
                  <Label className="text-xs">Document type</Label>
                  <Select value={form.docType} onValueChange={(v) => set({ docType: v as DocType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DOC_TYPE_LABELS) as DocType[]).map((k) => (
                        <SelectItem key={k} value={k}>{DOC_TYPE_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Relationship type</Label>
                  <Select value={form.relationshipType} onValueChange={(v) => set({ relationshipType: v as RelationshipType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(RELATIONSHIP_LABELS) as RelationshipType[]).map((k) => (
                        <SelectItem key={k} value={k}>{RELATIONSHIP_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Grid>
              <div className="flex gap-2.5 rounded-lg border border-border bg-muted/40 p-3.5">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The relationship type determines how clause 3 (Proposed Collaboration) is written — an underwriter
                  gets language about risk capital and pool participation, an SME gets language about hedging its own
                  exposure. Pick the closest match.
                </p>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <SectionHead title="Collaboration details" hint="Everything here flows into the drafted clauses. Blanks are simply left out." />
              <div className="space-y-4">
                <Field label="Purpose of collaboration" value={form.terms.purpose} onChange={(v) => setTerm({ purpose: v })}
                  placeholder="Establish an underwriting facility for NGN/USD cover" />
                <div className="space-y-1.5">
                  <Label className="text-xs">Short description</Label>
                  <Textarea rows={3} value={form.terms.description} onChange={(e) => setTerm({ description: e.target.value })}
                    placeholder="A sentence or two on what each side actually does." />
                </div>
                <Grid>
                  <Field label="Estimated business volume" value={form.terms.estimatedVolume} onChange={(v) => setTerm({ estimatedVolume: v })} placeholder="5,000,000" />
                  <Field label="Currency" value={form.terms.currency} onChange={(v) => setTerm({ currency: v })} placeholder="USD" />
                  <Field label="Proposed start date" value={form.terms.startDate} onChange={(v) => setTerm({ startDate: v })} placeholder="1 October 2026" />
                  <Field label="Expected duration" value={form.terms.duration} onChange={(v) => setTerm({ duration: v })} placeholder="an initial term of 12 months" />
                </Grid>

                <Grid>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Exclusivity</Label>
                    <Select value={form.terms.exclusivity} onValueChange={(v) => setTerm({ exclusivity: v as any })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None — both sides stay free</SelectItem>
                        <SelectItem value="mutual">Mutual</SelectItem>
                        <SelectItem value="recipient">Recipient is restricted</SelectItem>
                        <SelectItem value="sender">We are restricted</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Field label="Governing law" value={form.terms.governingLaw} onChange={(v) => setTerm({ governingLaw: v })} />
                </Grid>

                <div className="flex items-center justify-between rounded-lg border border-border p-3.5">
                  <div>
                    <p className="text-sm font-medium">Confidentiality clause</p>
                    <p className="text-xs text-muted-foreground">Binding even though the rest of the letter isn't.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {form.terms.confidentiality && (
                      <Input type="number" min={1} max={240} value={form.terms.confidentialityMonths}
                        onChange={(e) => setTerm({ confidentialityMonths: parseInt(e.target.value) || 24 })}
                        className="h-8 w-20 text-sm" />
                    )}
                    {form.terms.confidentiality && <span className="text-xs text-muted-foreground">months</span>}
                    <Switch checked={form.terms.confidentiality} onCheckedChange={(v) => setTerm({ confidentiality: v })} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Special conditions</Label>
                  <Textarea rows={2} value={form.terms.specialConditions} onChange={(e) => setTerm({ specialConditions: e.target.value })}
                    placeholder="Anything conditional — board approval, regulatory sign-off, and so on." />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Additional notes</Label>
                  <Textarea rows={2} value={form.terms.additionalNotes} onChange={(e) => setTerm({ additionalNotes: e.target.value })} />
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <SectionHead title="Message and expiry" hint="Last step — then we generate the document." />
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Personal message in the invitation email</Label>
                  <Textarea rows={4} value={form.personalMessage} onChange={(e) => set({ personalMessage: e.target.value })}
                    placeholder={`Hi ${form.recipientName || "there"}, following our conversation last week, here's the letter of intent we discussed.`} />
                </div>
                <Grid>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Link expires after</Label>
                    <Select value={String(form.expiresInDays)} onValueChange={(v) => set({ expiresInDays: parseInt(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[7, 14, 30, 60, 90].map((d) => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </Grid>

                <div className="rounded-lg border border-border bg-muted/40 p-4">
                  <div className="mb-2.5 flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</p>
                    <button type="button" onClick={() => setEditSender((v) => !v)}
                      className="text-xs font-medium text-primary hover:underline">
                      {editSender ? "Done" : "Change sender"}
                    </button>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <Summary k="Document" v={DOC_TYPE_LABELS[form.docType]} />
                    <Summary k="Relationship" v={RELATIONSHIP_LABELS[form.relationshipType]} />
                    <Summary k="From" v={`${form.senderName || "—"}, ${form.senderCompany}`} />
                    <Summary k="To" v={`${form.recipientName || "—"}, ${form.recipientCompany || "—"}`} />
                    <Summary k="Signing email" v={form.recipientEmail || "—"} />
                    <Summary k="Exclusivity" v={form.terms.exclusivity === "none" ? "None" : form.terms.exclusivity} />
                  </dl>

                  {editSender && (
                    <div className="mt-4 space-y-4 border-t border-border pt-4">
                      <p className="text-xs text-muted-foreground">
                        These appear as the sending party and in the sign-off. They're prefilled because letters
                        normally go out from you.
                      </p>
                      <Grid>
                        <Field label="Company name" required value={form.senderCompany} onChange={(v) => set({ senderCompany: v })} />
                        <Field label="Representative name" required value={form.senderName} onChange={(v) => set({ senderName: v })} />
                        <Field label="Position" value={form.senderPosition} onChange={(v) => set({ senderPosition: v })} />
                        <Field label="Email" required type="email" value={form.senderEmail} onChange={(v) => set({ senderEmail: v })} />
                        <Field label="Phone" value={form.senderPhone} onChange={(v) => set({ senderPhone: v })} />
                      </Grid>
                      {!stepValid && (
                        <p className="text-xs text-destructive">
                          Company, representative name and a valid email are required.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep(step + 1)} disabled={!stepValid} className="gap-2">
            Continue <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={() => create.mutate()} disabled={create.isPending || !stepValid} className="gap-2">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Generate document
          </Button>
        )}
      </div>
    </div>
  );
}

function SectionHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="border-b border-border pb-3">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
const Summary = ({ k, v }: { k: string; v: string }) => (
  <div><dt className="text-xs text-muted-foreground">{k}</dt><dd className="truncate">{v}</dd></div>
);

function Field({ label, value, onChange, placeholder, type = "text", required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}{required && <span className="ml-0.5 text-destructive">*</span>}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────

function LoiDetail({ token, id, onBack }: { token: string; id: number; onBack: () => void }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"document" | "activity" | "comments">("document");
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [sig, setSig] = useState<{ method: SigMethod; data: string } | null>(null);
  const savedRef = useRef<string>("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["loi-detail", token, id],
    queryFn: () => api(`/api/loi/${id}`, token),
    refetchInterval: 30_000,
  });

  // Company signature on file, offered as the default when counter-signing.
  const { data: storedSig } = useQuery({
    queryKey: ["brand-signature", token],
    queryFn: () => api("/api/brand/signature", token),
  });

  // Seed the editor once per document, and refresh it when the server's copy
  // changes underneath us (accepted suggestion, regenerate) while not editing.
  useEffect(() => {
    if (!data) return;
    if (!editing && data.bodyMarkdown !== savedRef.current) {
      setBody(data.bodyMarkdown);
      savedRef.current = data.bodyMarkdown;
    }
  }, [data, editing]);

  const save = useMutation({
    mutationFn: (b: string) => api(`/api/loi/${id}`, token, { method: "PATCH", body: JSON.stringify({ bodyMarkdown: b }) }),
    onSuccess: (row) => { savedRef.current = row.bodyMarkdown; refetch(); },
  });

  // Autosave while editing — 1.2s after typing stops.
  useEffect(() => {
    if (!editing || !body || body === savedRef.current) return;
    const t = setTimeout(() => save.mutate(body), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, editing]);

  const act = (path: string, ok: string, payload?: any) =>
    api(`/api/loi/${id}/${path}`, token, { method: "POST", body: JSON.stringify(payload ?? {}) })
      .then((res: any) => {
        // Send/remind return the mail provider's verdict. A 200 here only
        // means the row was updated — if the email itself bounced, say so
        // rather than letting the user believe it went out.
        if (res && res.emailed === false) {
          toast({
            title: "Saved, but the email didn't send",
            description: res.emailError || "Check RESEND_API_KEY and that the sending domain is verified.",
            variant: "destructive",
          });
        } else if (res && res.ok === false) {
          toast({ title: "The email didn't send", description: res.error || "Unknown mail error.", variant: "destructive" });
        } else {
          toast({ title: ok });
        }
        refetch();
        queryClient.invalidateQueries({ queryKey: ["loi-list"] });
      })
      .catch((e: any) => toast({ title: "That didn't work", description: e.message, variant: "destructive" }));

  const del = useMutation({
    mutationFn: () => api(`/api/loi/${id}`, token, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Draft deleted" }); queryClient.invalidateQueries({ queryKey: ["loi-list"] }); onBack(); },
    onError: (e: any) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
    </div>;
  }

  const locked = !!data.lockedAt;
  const signedBySender = data.signatures?.some((s: any) => s.party === "sender");
  const signedByRecipient = data.signatures?.some((s: any) => s.party === "recipient");
  const commentedSections = new Set<string>(
    (data.comments ?? []).filter((c: any) => !c.resolution).map((c: any) => c.anchor).filter(Boolean),
  );
  const openSuggestions = (data.comments ?? []).filter((c: any) => c.kind === "suggestion" && !c.resolution);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="mt-0.5 gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Agreements
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{data.recipientCompany}</h2>
              <StatusBadge status={data.status} />
              {locked && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" /> Locked
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {docLabel(data.docType)} · {data.recipientName} · {data.publicId}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!locked && (
            <Button onClick={() => setSendOpen(true)} className="gap-2">
              <Send className="h-4 w-4" /> {data.sentAt ? "Send revision" : "Send for signature"}
            </Button>
          )}
          {data.sentAt && !locked && (
            <Button variant="outline" onClick={() => act("remind", "Reminder sent")} className="gap-2">
              <Bell className="h-4 w-4" /> Remind
            </Button>
          )}
          {!signedBySender && !locked && (
            <Button variant="outline" onClick={() => setSignOpen(true)} className="gap-2">
              <PenLine className="h-4 w-4" /> Counter-sign
            </Button>
          )}
          {data.hasPdf && (
            // A plain anchor can't carry the x-admin-token header, so fetch
            // the PDF with auth and hand the browser a blob URL instead.
            <Button
              variant="outline"
              className="gap-2"
              onClick={() =>
                fetch(`/api/loi/${id}/pdf`, { headers: { "x-admin-token": token } })
                  .then((r) => r.blob())
                  .then((b) => {
                    const url = URL.createObjectURL(b);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${data.publicId}.pdf`;
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(() => toast({ title: "Couldn't download the PDF", variant: "destructive" }))
              }
            >
              <Download className="h-4 w-4" /> Signed PDF
            </Button>
          )}
          {data.status === "draft" && (
            <Button variant="ghost" size="icon" onClick={() => del.mutate()} title="Delete draft">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      {/* Progress + counterparty facts */}
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3">
          <CardContent className="p-0">
            <div className="flex gap-1 border-b border-border px-4 pt-3">
              {(["document", "comments", "activity"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "relative px-3 py-2 text-sm font-medium capitalize transition-colors",
                    tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t}
                  {t === "comments" && data.comments?.length ? ` (${data.comments.length})` : ""}
                  {tab === t && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" />}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5 pb-2">
                {!locked && tab === "document" && (
                  <>
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                      onClick={() => {
                        if (editing && body !== savedRef.current) save.mutate(body);
                        setEditing(!editing);
                      }}>
                      {editing ? <><Check className="h-3 w-3" /> Done</> : <><PenLine className="h-3 w-3" /> Edit</>}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                      onClick={() => {
                        if (confirm("Regenerate from the form data? Any manual edits to the document will be replaced.")) {
                          act("regenerate", "Document regenerated");
                        }
                      }}>
                      <RefreshCw className="h-3 w-3" /> Regenerate
                    </Button>
                  </>
                )}
                {tab === "document" && (
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                    onClick={() => {
                      fetch(`/api/loi/${id}/preview.pdf`, { headers: { "x-admin-token": token } })
                        .then((r) => r.blob())
                        .then((b) => window.open(URL.createObjectURL(b), "_blank"))
                        .catch(() => toast({ title: "Couldn't render the preview", variant: "destructive" }));
                    }}>
                    <Eye className="h-3 w-3" /> Preview PDF
                  </Button>
                )}
              </div>
            </div>

            {tab === "document" && (
              editing ? (
                <div className="p-4">
                  <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="min-h-[32rem] font-mono text-[13px] leading-relaxed"
                    spellCheck
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {save.isPending ? "Saving…" : body === savedRef.current ? "All changes saved" : "Unsaved changes"}
                    {" · "}Use <code className="rounded bg-muted px-1">## 5. Heading</code> for clauses and{" "}
                    <code className="rounded bg-muted px-1">**bold**</code> for emphasis.
                  </p>
                </div>
              ) : (
                <div className="max-h-[46rem] overflow-y-auto bg-muted/30">
                  <DocumentView markdown={data.composedBody} commentedSections={commentedSections} />
                </div>
              )
            )}

            {tab === "comments" && (
              <div className="divide-y divide-border">
                {(data.comments ?? []).length === 0 && (
                  <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                    No comments yet. They'll appear here when the counterparty responds.
                  </p>
                )}
                {(data.comments ?? []).map((c: any) => (
                  <div key={c.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{c.authorName}</span>
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        c.kind === "suggestion" ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-muted text-muted-foreground",
                      )}>
                        {c.kind === "suggestion" ? "Suggested edit" : "Comment"}
                      </span>
                      {c.resolution && (
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          c.resolution === "accepted" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                        )}>{c.resolution}</span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">{relativeTime(c.createdAt)}</span>
                    </div>
                    {c.anchor && <p className="mt-1 text-xs text-muted-foreground">On: {c.anchor}</p>}
                    <p className="mt-2 text-sm">{c.body}</p>
                    {c.suggestedText && (
                      <div className="mt-2 rounded-md border border-border bg-muted/40 p-3">
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Proposed replacement</p>
                        <p className="text-sm">{c.suggestedText}</p>
                      </div>
                    )}
                    {c.kind === "suggestion" && !c.resolution && !locked && (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" className="h-7 gap-1.5 text-xs"
                          onClick={() => act(`comments/${c.id}/resolve`, "Suggestion accepted", { resolution: "accepted" })}>
                          <Check className="h-3 w-3" /> Accept
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                          onClick={() => act(`comments/${c.id}/resolve`, "Suggestion rejected", { resolution: "rejected" })}>
                          <X className="h-3 w-3" /> Reject
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {tab === "activity" && (
              <ol className="relative px-5 py-4">
                {(data.events ?? []).map((e: any, i: number) => (
                  <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {i < (data.events?.length ?? 0) - 1 && <span className="absolute left-[5px] top-3.5 h-full w-px bg-border" />}
                    <span className="relative mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-primary/60 ring-4 ring-background" />
                    <div className="min-w-0">
                      <p className="text-sm">{e.detail || e.type}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {fmt(e.createdAt, true)}
                        {e.actor && e.actor !== "system" ? ` · ${e.actor}` : ""}
                        {e.ipAddress ? ` · ${e.ipAddress}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {openSuggestions.length > 0 && (
            <Card className="border-amber-300 dark:border-amber-800">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-4 w-4 text-amber-600" /> {openSuggestions.length} open suggestion{openSuggestions.length > 1 ? "s" : ""}
              </CardTitle></CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">The counterparty proposed changes. Resolve them, then send a revision.</p>
                <Button size="sm" variant="outline" className="mt-3 h-7 w-full text-xs" onClick={() => setTab("comments")}>Review</Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Signatures</CardTitle></CardHeader>
            <CardContent className="space-y-3 pt-0">
              <SigRow label={data.senderCompany} name={data.senderName} signed={signedBySender}
                at={data.signatures?.find((s: any) => s.party === "sender")?.signedAt} />
              <SigRow label={data.recipientCompany} name={data.recipientName} signed={signedByRecipient}
                at={data.signatures?.find((s: any) => s.party === "recipient")?.signedAt} />
            </CardContent>
          </Card>

          {data.risks?.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4" /> Risk review
              </CardTitle></CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {data.risks.map((r: any, i: number) => (
                  <div key={i} className="flex gap-2">
                    <span className={cn(
                      "mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full",
                      r.level === "high" ? "bg-red-500" : r.level === "medium" ? "bg-amber-500" : "bg-emerald-500",
                    )} />
                    <p className="text-xs leading-relaxed text-muted-foreground">{r.message}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {data.missingFields?.length > 0 && !locked && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Missing information
              </CardTitle></CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1">
                  {data.missingFields.map((f: string) => (
                    <li key={f} className="text-xs text-muted-foreground">· {f}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Investor-facing disclosure. Signed agreements always count toward
              the data room's totals; naming the counterparty is a separate,
              explicit decision because the letter binds both sides to
              confidentiality. */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4" /> Investor data room
            </CardTitle></CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">Name this counterparty</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {data.showInDataRoom
                      ? `${data.recipientCompany} is named in the traction section.`
                      : "Counted anonymously in the totals. Turn on only with their agreement."}
                  </p>
                </div>
                <Switch
                  checked={!!data.showInDataRoom}
                  onCheckedChange={(v) =>
                    api(`/api/loi/${id}`, token, { method: "PATCH", body: JSON.stringify({ showInDataRoom: v }) })
                      .then(() => {
                        toast({ title: v ? "Named in the data room" : "Hidden from the data room" });
                        refetch();
                      })
                      .catch((e: any) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }))
                  }
                />
              </div>
              {data.status !== "signed" && (
                <p className="rounded-md border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  Only fully-signed agreements appear in the data room. This one counts once both parties have signed.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0 text-xs">
              <Detail k="Reference" v={data.publicId} copyable />
              <Detail k="Relationship" v={relLabel(data.relationshipType)} />
              <Detail k="Recipient email" v={data.recipientEmail} />
              <Detail k="Created" v={fmt(data.createdAt)} />
              <Detail k="Sent" v={fmt(data.sentAt)} />
              <Detail k="First viewed" v={fmt(data.firstViewedAt, true)} />
              <Detail k="Expires" v={fmt(data.expiresAt)} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Send confirmation */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{data.sentAt ? "Send a revision" : "Send for signature"}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              We'll email a secure signing link to <strong>{data.recipientEmail}</strong>. They can read the document,
              comment, and sign in their browser.
            </p>
            {data.sentAt && (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                This replaces the previous link — the old one stops working immediately.
              </p>
            )}
            {data.missingFields?.length > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {data.missingFields.length} field{data.missingFields.length > 1 ? "s are" : " is"} still blank. The document
                will read fine without them, but check the draft first.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSendOpen(false)}>Cancel</Button>
            <Button className="gap-2" onClick={() => { setSendOpen(false); act("send", "Sent to the recipient"); }}>
              <Send className="h-4 w-4" /> Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Counter-sign */}
      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Sign on behalf of {data.senderCompany}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You're signing as <strong className="text-foreground">{data.senderName}</strong>
              {data.senderPosition ? `, ${data.senderPosition}` : ""}. This is recorded with a timestamp and your IP address.
            </p>
            {/* Offer the signature on file so it doesn't have to be redrawn
                per document — the common case by far. */}
            {storedSig?.present && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <img src={storedSig.dataUrl} alt="Your signature" className="h-9 w-auto max-w-[150px] object-contain" />
                <span className="text-xs text-muted-foreground">Your saved signature</span>
                <Button
                  size="sm"
                  variant={sig?.data === storedSig.dataUrl ? "default" : "outline"}
                  className="ml-auto h-7 gap-1.5 text-xs"
                  onClick={() => setSig({ method: "uploaded", data: storedSig.dataUrl })}
                >
                  {sig?.data === storedSig.dataUrl ? <><Check className="h-3 w-3" /> Selected</> : "Use this"}
                </Button>
              </div>
            )}
            <SignaturePad defaultName={data.senderName} onChange={setSig} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSignOpen(false)}>Cancel</Button>
            <Button disabled={!sig} className="gap-2"
              onClick={() => { setSignOpen(false); act("countersign", "Signature recorded", sig); }}>
              <PenLine className="h-4 w-4" /> Sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SigRow({ label, name, signed, at }: { label: string; name: string; signed: boolean; at?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn(
        "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full",
        signed ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" : "bg-muted text-muted-foreground",
      )}>
        {signed ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{name} · {signed ? `Signed ${fmt(at)}` : "Not yet signed"}</p>
      </div>
    </div>
  );
}

function Detail({ k, v, copyable }: { k: string; v: string; copyable?: boolean }) {
  const { toast } = useToast();
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="flex min-w-0 items-center gap-1 text-right">
        <span className="truncate">{v}</span>
        {copyable && (
          <button onClick={() => { navigator.clipboard.writeText(v); toast({ title: "Copied" }); }}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground">
            <Copy className="h-3 w-3" />
          </button>
        )}
      </span>
    </div>
  );
}
