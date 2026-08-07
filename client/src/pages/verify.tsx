/**
 * Verification — the customer's side of KYC.
 *
 * Shows where they stand, what they can still transact, and what the next tier
 * would unlock. Submitting is a single form whose fields change with the tier
 * requested, because asking an SME for a beneficial-ownership declaration to
 * buy $200 of cover is how you lose them.
 *
 * Deliberately explains *why* each limit exists in the customer's own terms.
 * "You can cover about $10,000 of exposure" is actionable; "Tier 1: $1,000
 * cumulative" is not, and a compliance wall that reads as bureaucracy is one
 * people abandon.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRift } from "@rift-finance/react";
import { getRiftAccessToken } from "@/lib/rift-token-bridge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck, Check, Clock, X, Upload, Loader2, ArrowRight, Info, FileText, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";

async function api(url: string, options?: RequestInit) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    headers.Authorization = `Bearer ${await getRiftAccessToken()}`;
  } catch {
    // Signed out — the request 401s and the page says so.
  }
  const res = await fetch(url, { ...options, headers: { ...headers, ...(options?.headers as any) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

const usd = (n: number) => "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function VerifyPage() {
  const { isAuthenticated } = useRift();
  const { toast } = useToast();
  const [applying, setApplying] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["compliance-me"],
    queryFn: () => api("/api/compliance/me"),
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) {
    return (
      <Shell>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Lock className="h-6 w-6 text-muted-foreground" />
            <p className="font-medium">Sign in to see your verification status</p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (isLoading || !data) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </Shell>
    );
  }

  const current = data.tierDef;
  const submission = data.submission;
  const pending = submission && ["submitted", "in_review"].includes(submission.status);

  if (applying !== null) {
    return (
      <Shell>
        <SubmitForm
          tier={applying}
          tiers={data.tiers}
          onCancel={() => setApplying(null)}
          onDone={() => { setApplying(null); refetch(); }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Where you stand */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5" />
              {current.name} verification
            </CardTitle>
            <StatusPill status={data.kycStatus} pending={!!pending} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.tier === 0 ? (
            <p className="text-sm text-muted-foreground">
              You can browse and read anything. To buy cover or provide liquidity, we need to know who
              you are — it takes a couple of minutes.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Allowance
                label="Left to transact"
                used={data.cashMovedUsd}
                limit={current.cashMovedUsd}
                note={`Resets on a rolling ${data.windowDays} days`}
              />
              <Allowance
                label="Cover you can still hold"
                used={data.payoutExposureUsd}
                limit={current.payoutExposureUsd}
                note="Total payout your open cover could reach"
              />
            </div>
          )}

          {pending && (
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
              <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Your documents are with our compliance team. We usually come back within one working day.
              </p>
            </div>
          )}

          {submission?.status === "rejected" && submission.notes && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs font-medium text-destructive">We couldn't approve that submission</p>
              <p className="mt-1 text-xs leading-relaxed">{submission.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tiers */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Levels</h2>
        {data.tiers
          .filter((t: any) => t.tier > 0)
          .map((t: any) => {
            const reached = data.tier >= t.tier;
            return (
              <Card key={t.tier} className={cn(reached && "border-emerald-300 dark:border-emerald-800")}>
                <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{t.name}</p>
                      {reached && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          <Check className="h-3 w-3" /> Active
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Transact up to <strong className="text-foreground">{usd(t.cashMovedUsd)}</strong> per{" "}
                      {data.windowDays} days, holding up to{" "}
                      <strong className="text-foreground">{usd(t.payoutExposureUsd)}</strong> of cover.
                    </p>
                    <ul className="mt-2.5 space-y-1">
                      {t.requires.map((r: string) => (
                        <li key={r} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-current" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {!reached && !pending && (
                    <Button size="sm" className="gap-1.5" onClick={() => setApplying(t.tier)}>
                      Verify <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
      </div>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        We collect this because Ghana's Anti-Money Laundering Act (Act 1044) and Bank of Ghana directives
        require it. Your documents are stored securely, kept for six years as the law requires, and shared
        only with regulators who ask for them.
      </p>
    </Shell>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      active="profile"
      greeting={{ title: "Verification", subtitle: "How much you can transact depends on how much we know about you" }}
    >
      <div className="mx-auto max-w-3xl space-y-6">{children}</div>
    </AppShell>
  );
}

function StatusPill({ status, pending }: { status: string; pending: boolean }) {
  const s = pending ? "pending" : status;
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    approved: { label: "Verified", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", Icon: Check },
    pending: { label: "In review", cls: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300", Icon: Clock },
    rejected: { label: "Not approved", cls: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300", Icon: X },
    not_started: { label: "Not started", cls: "bg-muted text-muted-foreground", Icon: Clock },
  };
  const m = map[s] ?? map.not_started;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", m.cls)}>
      <m.Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}

function Allowance({ label, used, limit, note }: { label: string; used: number; limit: number; note: string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const left = Math.max(0, limit - used);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold tabular-nums">{usd(left)}</p>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", pct > 85 ? "bg-amber-500" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {usd(used)} of {usd(limit)} used · {note}
      </p>
    </div>
  );
}

// ── Submission form ───────────────────────────────────────────────────────

function SubmitForm({
  tier, tiers, onCancel, onDone,
}: { tier: number; tiers: any[]; onCancel: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const def = tiers.find((t) => t.tier === tier);
  const [entityType, setEntityType] = useState<"individual" | "business">("individual");
  const [form, setForm] = useState<Record<string, any>>({ isPep: false });
  const [docs, setDocs] = useState<{ label: string; filename: string; mime: string; dataUrl: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const addDoc = async (label: string, file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "That file is too large", description: "Keep documents under 5 MB.", variant: "destructive" });
      return;
    }
    const dataUrl: string = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(new Error("Could not read that file"));
      r.readAsDataURL(file);
    });
    setDocs((d) => [...d.filter((x) => x.label !== label), { label, filename: file.name, mime: file.type, dataUrl }]);
  };

  const submit = useMutation({
    mutationFn: () =>
      api("/api/compliance/submit", {
        method: "POST",
        body: JSON.stringify({ ...form, entityType, requestedTier: tier, documents: docs }),
      }),
    onSuccess: () => {
      toast({ title: "Submitted", description: "We'll come back to you within a working day." });
      onDone();
    },
    onError: (e: any) => toast({ title: "Couldn't submit", description: e.message, variant: "destructive" }),
  });

  const needsId = tier >= 2;
  const needsBusiness = tier >= 3 || entityType === "business";
  const ready =
    (form.fullName?.trim()?.length ?? 0) > 1 &&
    (tier < 2 || docs.length > 0) &&
    (tier < 2 || !!form.sourceOfFunds?.trim());

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{def?.name} verification</CardTitle>
        <p className="text-sm text-muted-foreground">{def?.description}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label className="text-xs">I am verifying as</Label>
          <Select value={entityType} onValueChange={(v) => setEntityType(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">An individual</SelectItem>
              <SelectItem value="business">A business</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full legal name" required value={form.fullName} onChange={(v) => set("fullName", v)} />
          <Field label="Phone number" value={form.phone} onChange={(v) => set("phone", v)} placeholder="+233…" />
          <Field label="Country of residence" value={form.country} onChange={(v) => set("country", v)} placeholder="Ghana" />
          <Field label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} />
          <Field label="ID type" value={form.idType} onChange={(v) => set("idType", v)} placeholder="Ghana Card / Passport" />
          <Field label="ID number" value={form.idNumber} onChange={(v) => set("idNumber", v)} />
          {needsId && (
            <>
              <Field label="Date of birth" value={form.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} placeholder="1990-04-12" />
              <Field label="Nationality" value={form.nationality} onChange={(v) => set("nationality", v)} />
            </>
          )}
        </div>

        {needsId && (
          <Field label="Residential address" value={form.address} onChange={(v) => set("address", v)} />
        )}

        {needsBusiness && (
          <div className="space-y-4 rounded-lg border border-border p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Business details</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name" value={form.companyName} onChange={(v) => set("companyName", v)} />
              <Field label="Registration number" value={form.registrationNumber} onChange={(v) => set("registrationNumber", v)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Beneficial owners — anyone holding 10% or more</Label>
              <Textarea
                rows={3}
                value={form.beneficialOwners ?? ""}
                onChange={(e) => set("beneficialOwners", e.target.value)}
                placeholder="Name, percentage held, nationality — one per line"
              />
            </div>
          </div>
        )}

        {tier >= 2 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Where do the funds come from?<span className="ml-0.5 text-destructive">*</span></Label>
            <Textarea
              rows={2}
              value={form.sourceOfFunds ?? ""}
              onChange={(e) => set("sourceOfFunds", e.target.value)}
              placeholder="e.g. revenue from import/export trading"
            />
          </div>
        )}

        {tier >= 3 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Source of wealth</Label>
            <Textarea rows={2} value={form.sourceOfWealth ?? ""} onChange={(e) => set("sourceOfWealth", e.target.value)} />
          </div>
        )}

        {tier >= 2 && (
          <div className="space-y-2">
            <Label className="text-xs">Documents<span className="ml-0.5 text-destructive">*</span></Label>
            {[
              { key: "Photo ID", hint: "Ghana Card, passport or driver's licence" },
              { key: "Proof of address", hint: "Utility bill or bank statement, last 3 months" },
              ...(needsBusiness ? [{ key: "Certificate of incorporation", hint: "" }] : []),
            ].map(({ key, hint }) => {
              const got = docs.find((d) => d.label === key);
              return (
                <label
                  key={key}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-3 transition-colors hover:border-primary",
                    got && "border-solid border-emerald-300 dark:border-emerald-800",
                  )}
                >
                  {got ? <Check className="h-4 w-4 text-emerald-600" /> : <Upload className="h-4 w-4 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{key}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {got ? got.filename : hint || "PDF or photo"}
                    </span>
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) addDoc(key, f); }}
                  />
                </label>
              );
            })}
          </div>
        )}

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3.5">
          <div>
            <p className="text-sm font-medium">Are you a politically exposed person?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A senior public official, or a close family member or associate of one. Saying yes doesn't
              stop you — it means we look more closely, as the law requires.
            </p>
          </div>
          <Switch checked={!!form.isPep} onCheckedChange={(v) => set("isPep", v)} />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={!ready || submit.isPending} onClick={() => submit.mutate()} className="gap-2">
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Submit for review
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text", required,
}: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <Input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
