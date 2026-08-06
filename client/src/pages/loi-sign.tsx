/**
 * Recipient signing portal — the counterparty's entire experience.
 *
 * Reached from the emailed link at /sign/:publicId?t=<token>. No account, no
 * download, no install. The token is moved out of the URL into memory on
 * first load so it doesn't linger in browser history or get pasted into a
 * chat along with the address.
 *
 * This page is often the first thing a counterparty ever sees of BlockFinaX,
 * so it carries its own header, theme toggle and footer rather than the app
 * chrome — it must look like a product, not an internal tool.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { DocumentView } from "@/components/loi/document-view";
import { SignaturePad, type SigMethod } from "@/components/loi/signature-pad";
import {
  ShieldCheck, MessageSquare, PenLine, Download, Check, X, Clock, Loader2,
  AlertTriangle, Sun, Moon, FileText, Send, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Theme ────────────────────────────────────────────────────────────────

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("bfx_sign_theme");
      if (saved) return saved === "dark";
    } catch { /* private mode */ }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("bfx_sign_theme", dark ? "dark" : "light"); } catch { /* ignore */ }
    // Leave the class as the user set it; the portal is a standalone page.
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

// ── Page ─────────────────────────────────────────────────────────────────

type Doc = {
  publicId: string; docLabel: string; status: string;
  senderCompany: string; senderName: string; senderPosition?: string; senderEmail: string;
  recipientCompany: string; recipientName: string; recipientPosition?: string; recipientEmail: string;
  personalMessage?: string; body: string;
  expiresAt?: string; sentAt?: string; signedAt?: string; lockedAt?: string;
  comments: any[]; signatures: any[];
};

export default function LoiSignPage() {
  const [, params] = useRoute("/sign/:publicId");
  const publicId = params?.publicId ?? "";
  const { dark, toggle } = useTheme();
  const { toast } = useToast();

  // Capture the token once, then scrub it from the address bar.
  const [token] = useState(() => new URLSearchParams(window.location.search).get("t") ?? "");
  useEffect(() => {
    if (token && window.location.search) {
      window.history.replaceState({}, "", `/sign/${publicId}`);
    }
  }, [token, publicId]);

  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [commentOpen, setCommentOpen] = useState(false);
  const [commentAnchor, setCommentAnchor] = useState<{ section: string; text: string } | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [suggestText, setSuggestText] = useState("");
  const [signOpen, setSignOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Signing flow
  const [sig, setSig] = useState<{ method: SigMethod; data: string } | null>(null);
  const [signerName, setSignerName] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [maskedTo, setMaskedTo] = useState("");

  const call = useCallback(
    async (path: string, options?: RequestInit) => {
      const res = await fetch(`/api/sign/${publicId}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", "x-loi-token": token, ...options?.headers },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Something went wrong.");
      return body;
    },
    [publicId, token],
  );

  const load = useCallback(() => {
    if (!token) { setError("This link is missing its access token. Open the link from your email again."); setLoading(false); return; }
    call("")
      .then((d) => { setDoc(d); setSignerName(d.recipientName); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [call, token]);

  useEffect(() => { load(); }, [load]);

  const commentedSections = useMemo(
    () => new Set<string>((doc?.comments ?? []).filter((c) => !c.resolution).map((c) => c.anchor).filter(Boolean)),
    [doc],
  );

  const alreadySigned = !!doc?.signatures?.some((s: any) => s.party === "recipient");
  const closed = ["signed", "declined", "expired"].includes(doc?.status ?? "");

  // ── States before the document ─────────────────────────────────────────

  if (loading) {
    return (
      <Shell dark={dark} toggle={toggle}>
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="mt-3 text-sm">Loading your document…</p>
        </div>
      </Shell>
    );
  }

  if (error || !doc) {
    return (
      <Shell dark={dark} toggle={toggle}>
        <div className="mx-auto max-w-md py-24 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-semibold">This link isn't valid</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <p className="mt-4 text-sm text-muted-foreground">
            Links expire, and sending a revision replaces the previous one. Check your inbox for a newer email, or reply
            to the sender to ask for a fresh link.
          </p>
        </div>
      </Shell>
    );
  }

  // ── Actions ────────────────────────────────────────────────────────────

  const postComment = async (kind: "comment" | "suggestion") => {
    if (!commentBody.trim()) return;
    setBusy(true);
    try {
      await call("/comments", {
        method: "POST",
        body: JSON.stringify({
          kind, body: commentBody.trim(),
          anchor: commentAnchor?.text ?? commentAnchor?.section,
          suggestedText: kind === "suggestion" ? suggestText.trim() || undefined : undefined,
        }),
      });
      toast({
        title: kind === "suggestion" ? "Change requested" : "Comment sent",
        description: `${doc.senderName} has been notified.`,
      });
      setCommentOpen(false); setCommentBody(""); setSuggestText(""); setCommentAnchor(null);
      load();
    } catch (e: any) {
      toast({ title: "Couldn't send that", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await call("/approve", { method: "POST" });
      toast({ title: "Approved", description: "You can sign whenever you're ready." });
      load();
    } catch (e: any) {
      toast({ title: "Couldn't approve", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const requestCode = async () => {
    setBusy(true);
    try {
      const r = await call("/request-code", { method: "POST" });
      setCodeSent(true);
      setMaskedTo(r.sentTo ?? "your email");
      toast({ title: "Code sent", description: `Check ${r.sentTo ?? "your email"} for a 6-digit code.` });
    } catch (e: any) {
      toast({ title: "Couldn't send the code", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const submitSignature = async () => {
    if (!sig || !code.trim()) return;
    setBusy(true);
    try {
      await call("/sign", {
        method: "POST",
        body: JSON.stringify({ method: sig.method, signatureData: sig.data, signerName: signerName.trim(), code: code.trim() }),
      });
      setSignOpen(false); setCode(""); setCodeSent(false);
      toast({ title: "Signed", description: "Your signature has been recorded." });
      load();
    } catch (e: any) {
      toast({ title: "Couldn't complete signing", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await call("/decline", { method: "POST", body: JSON.stringify({ reason: declineReason.trim() }) });
      setDeclineOpen(false);
      toast({ title: "Declined", description: `${doc.senderName} has been notified.` });
      load();
    } catch (e: any) {
      toast({ title: "Couldn't decline", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const downloadPdf = () => {
    fetch(`/api/sign/${publicId}/pdf`, { headers: { "x-loi-token": token } })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = url; a.download = `${doc.publicId}.pdf`; a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => toast({ title: "The signed PDF isn't ready yet", variant: "destructive" }));
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <Shell dark={dark} toggle={toggle}>
      {/* Status banner */}
      {alreadySigned && (
        <Banner tone="success" icon={ShieldCheck}
          title={doc.status === "signed" ? "This document is fully signed" : "You've signed — waiting on the other party"}
          body={doc.status === "signed"
            ? "All parties have signed and the document is locked. Your copy has been emailed to you."
            : `Your signature is recorded. ${doc.senderCompany} will counter-sign, and you'll be emailed the executed copy.`}
          action={doc.status === "signed" ? { label: "Download signed PDF", onClick: downloadPdf, icon: Download } : undefined}
        />
      )}
      {doc.status === "declined" && (
        <Banner tone="danger" icon={X} title="You declined this document"
          body={`${doc.senderName} has been notified. Reply to their email if you'd like to reopen the conversation.`} />
      )}
      {doc.status === "expired" && (
        <Banner tone="muted" icon={Clock} title="This document has expired"
          body="The signing window closed. Ask the sender to issue a new link if you still want to proceed." />
      )}
      {doc.status === "changes_requested" && !alreadySigned && (
        <Banner tone="warning" icon={MessageSquare} title="Your changes have been sent"
          body={`${doc.senderName} is reviewing your requested edits. You'll get an email when a revision is ready.`} />
      )}

      {/* Header */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-primary">{doc.docLabel}</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
              {doc.senderCompany} &amp; {doc.recipientCompany}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sent by {doc.senderName}{doc.senderPosition ? `, ${doc.senderPosition}` : ""} · Reference {doc.publicId}
            </p>
          </div>
          {doc.expiresAt && !closed && (
            <div className="rounded-lg border border-border px-3 py-2 text-right">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Expires</p>
              <p className="text-sm font-medium">
                {new Date(doc.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          )}
        </div>

        {doc.personalMessage && (
          <div className="mt-5 rounded-xl border-l-2 border-primary bg-muted/50 p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{doc.personalMessage}</p>
            <p className="mt-2 text-xs text-muted-foreground">— {doc.senderName}</p>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem] lg:items-start">
        {/* Document */}
        <div className="overflow-hidden rounded-2xl border border-border bg-muted/30">
          <DocumentView
            markdown={doc.body}
            commentedSections={commentedSections}
            onSelectClause={
              closed || alreadySigned
                ? undefined
                : (section, text) => { setCommentAnchor({ section, text }); setCommentOpen(true); }
            }
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-4 lg:sticky lg:top-6">
          {!closed && !alreadySigned && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">Ready to proceed?</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Read the document, then sign electronically. We'll email you a code to confirm it's you.
              </p>
              <div className="mt-4 space-y-2">
                <Button className="w-full gap-2" onClick={() => setSignOpen(true)}>
                  <PenLine className="h-4 w-4" /> Review &amp; sign
                </Button>
                <Button variant="outline" className="w-full gap-2" onClick={approve} disabled={busy}>
                  <Check className="h-4 w-4" /> Approve without signing
                </Button>
                <Button variant="ghost" className="w-full gap-2 text-muted-foreground"
                  onClick={() => { setCommentAnchor(null); setCommentOpen(true); }}>
                  <MessageSquare className="h-4 w-4" /> Request a change
                </Button>
                <Button variant="ghost" className="w-full text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setDeclineOpen(true)}>
                  Decline to sign
                </Button>
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <Lock className="mt-0.5 h-3 w-3 flex-shrink-0" />
                Hover any paragraph to comment on it directly.
              </p>
            </div>
          )}

          {/* Signature status */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Signatures</h2>
            <div className="space-y-3">
              <SigStatus company={doc.senderCompany} name={doc.senderName}
                sig={doc.signatures?.find((s: any) => s.party === "sender")} />
              <SigStatus company={doc.recipientCompany} name={doc.recipientName}
                sig={doc.signatures?.find((s: any) => s.party === "recipient")} you />
            </div>
          </div>

          {/* Comments */}
          {doc.comments?.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-3 text-sm font-semibold">Your comments</h2>
              <div className="space-y-3">
                {doc.comments.map((c: any) => (
                  <div key={c.id} className="border-l-2 border-border pl-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{c.authorName}</span>
                      {c.resolution && (
                        <span className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                          c.resolution === "accepted"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground",
                        )}>{c.resolution}</span>
                      )}
                    </div>
                    {c.anchor && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">On: {c.anchor}</p>}
                    <p className="mt-1 text-xs leading-relaxed">{c.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {doc.status === "signed" && (
            <Button variant="outline" className="w-full gap-2" onClick={downloadPdf}>
              <Download className="h-4 w-4" /> Download signed PDF
            </Button>
          )}
        </div>
      </div>

      {/* Comment / suggestion dialog */}
      <Dialog open={commentOpen} onOpenChange={setCommentOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Comment or request a change</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {commentAnchor && (
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {commentAnchor.section}
                </p>
                <p className="line-clamp-3 text-xs leading-relaxed">{commentAnchor.text}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Your comment</Label>
              <Textarea rows={3} value={commentBody} onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Explain what you'd like changed and why." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Proposed wording (optional)</Label>
              <Textarea rows={3} value={suggestText} onChange={(e) => setSuggestText(e.target.value)}
                placeholder="Paste replacement text here and the sender can accept it in one click." />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setCommentOpen(false)}>Cancel</Button>
            <Button variant="outline" disabled={busy || !commentBody.trim()} onClick={() => postComment("comment")}>
              Send as comment
            </Button>
            <Button className="gap-2" disabled={busy || !commentBody.trim()} onClick={() => postComment("suggestion")}>
              <Send className="h-4 w-4" /> Request change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signing dialog */}
      <Dialog open={signOpen} onOpenChange={(o) => { setSignOpen(o); if (!o) { setCode(""); setCodeSent(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Sign this {doc.docLabel.toLowerCase()}</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label className="text-xs">Your full legal name</Label>
              <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} />
            </div>

            <SignaturePad defaultName={doc.recipientName} onChange={setSig} />

            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">Verify it's you</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {codeSent
                      ? `We sent a 6-digit code to ${maskedTo}. Enter it below to complete your signature.`
                      : `We'll email a 6-digit code to ${doc.recipientEmail} before recording your signature.`}
                  </p>
                  {codeSent ? (
                    <div className="mt-3 flex gap-2">
                      <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="000000" inputMode="numeric"
                        className="h-9 w-32 text-center font-mono text-base tracking-[0.3em]" />
                      <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={requestCode} disabled={busy}>
                        Resend
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="mt-3 h-8 text-xs" onClick={requestCode} disabled={busy || !sig}>
                      {busy ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null} Email me a code
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              By signing you agree that your electronic signature is the legal equivalent of your handwritten signature.
              Your name, email, timestamp, IP address and browser are recorded in the document's audit trail.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSignOpen(false)}>Cancel</Button>
            <Button className="gap-2" disabled={busy || !sig || code.length < 4 || !signerName.trim()} onClick={submitSignature}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Sign document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline dialog */}
      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Decline to sign</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This closes the document and notifies {doc.senderName}. It can't be undone from here — they'd need to send
              a new one.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea rows={3} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="Let them know why, if you'd like." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeclineOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={decline}>Decline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}

// ── Chrome ───────────────────────────────────────────────────────────────

function Shell({ children, dark, toggle }: { children: React.ReactNode; dark: boolean; toggle: () => void }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[hsl(var(--navy))]">
              <FileText className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold tracking-tight">BlockFinaX</span>
            <span className="hidden rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
              Secure document
            </span>
          </div>
          <button onClick={toggle} aria-label="Toggle theme"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>

      <footer className="border-t border-border py-6">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs text-muted-foreground sm:px-6">
          <p className="flex items-center justify-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            Secured by BlockFinaX · Every action is timestamped and recorded in the document's audit trail.
          </p>
        </div>
      </footer>
    </div>
  );
}

function Banner({ tone, icon: Icon, title, body, action }: {
  tone: "success" | "warning" | "danger" | "muted";
  icon: any; title: string; body: string;
  action?: { label: string; onClick: () => void; icon: any };
}) {
  const tones = {
    success: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
    warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
    danger: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200",
    muted: "border-border bg-muted text-foreground",
  };
  return (
    <div className={cn("mb-6 flex flex-wrap items-start gap-3 rounded-2xl border p-4 sm:p-5", tones[tone])}>
      <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm opacity-90">{body}</p>
      </div>
      {action && (
        <Button variant="outline" size="sm" className="gap-2 bg-background/50" onClick={action.onClick}>
          <action.icon className="h-3.5 w-3.5" /> {action.label}
        </Button>
      )}
    </div>
  );
}

function SigStatus({ company, name, sig, you }: { company: string; name: string; sig?: any; you?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn(
        "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full",
        sig ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" : "bg-muted text-muted-foreground",
      )}>
        {sig ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">
          {company}{you && <span className="ml-1 text-muted-foreground">(you)</span>}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {name} · {sig
            ? `Signed ${new Date(sig.signedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
            : "Not yet signed"}
        </p>
      </div>
    </div>
  );
}
