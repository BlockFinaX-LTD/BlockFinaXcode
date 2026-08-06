/**
 * Finax — the chat widget.
 *
 * One component, two surfaces. On the marketing site it talks to the public
 * agent, which knows the product and nothing else. Inside the app it talks to
 * the customer agent, which can see the signed-in user's own cover, deposits
 * and transactions — and has no tool capable of naming anyone else.
 *
 * Which one it is comes from `scope`, and the server enforces it regardless:
 * the customer endpoint requires a Rift-verified session and derives identity
 * from that, never from anything this component sends.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
// Resolves a *fresh* JWT — the bridge handles silent refresh, so reading
// storage directly would eventually send an expired token.
import { getRiftAccessToken } from "@/lib/rift-token-bridge";

type Scope = "public" | "customer";

interface Msg {
  id: number | string;
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS: Record<Scope, string[]> = {
  public: [
    "What does BlockFinaX do?",
    "How does FX cover work?",
    "What can I buy right now?",
  ],
  customer: [
    "What cover do I have?",
    "How are my deposits doing?",
    "Show my recent transactions",
  ],
};

const GREETING: Record<Scope, string> = {
  public:
    "Hi — I'm Finax. I can explain how BlockFinaX protects businesses from currency swings, " +
    "and what cover is available right now. What would you like to know?",
  customer:
    "Hi — I'm Finax. I can look up your cover, your deposits and your transactions, and explain " +
    "anything that isn't clear. What can I help with?",
};



export function FinaxChat({ scope = "public" }: { scope?: Scope }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // One thread per browser per surface, so a reload keeps the conversation and
  // the two surfaces never share history.
  const [threadId] = useState(() => {
    const key = `finax_thread_${scope}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) return saved;
      const id = Math.random().toString(36).slice(2, 12);
      localStorage.setItem(key, id);
      return id;
    } catch {
      return Math.random().toString(36).slice(2, 12);
    }
  });

  const endpoint = scope === "customer" ? "/api/chat/customer" : "/api/chat/public";

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (scope === "customer") {
      try {
        h.Authorization = `Bearer ${await getRiftAccessToken()}`;
      } catch {
        // Signed out, or the bridge isn't mounted. The request will 401 and
        // the widget shows that, which is more honest than pretending.
      }
    }
    return h;
  }, [scope]);

  // Load history the first time it's opened, not on mount — an unopened widget
  // shouldn't cost a request on every page view.
  useEffect(() => {
    if (!open || messages.length) return;
    authHeaders()
      .then((headers) => fetch(`${endpoint}/${threadId}`, { headers }))
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Msg[]) => setMessages(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, [open, endpoint, threadId, authHeaders, messages.length]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", content: message }]);
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ threadId, message }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Something went wrong.");
      setMessages((m) => [...m, { id: body.id ?? `a${Date.now()}`, role: "assistant", content: body.reply }]);
    } catch (e: any) {
      setError(e.message || "Couldn't reach Finax. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const shown = messages.length
    ? messages
    : [{ id: "greeting", role: "assistant" as const, content: GREETING[scope] }];

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close Finax" : "Chat with Finax"}
        className={cn(
          "fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full",
          "bg-[hsl(var(--navy))] text-white shadow-lg transition-all hover:scale-105 active:scale-95",
          "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[hsl(var(--navy))]",
        )}
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open && (
        <div
          className={cn(
            "fixed z-[60] flex flex-col overflow-hidden bg-card text-card-foreground shadow-2xl",
            // Full-screen on a phone, panel on a desktop.
            "inset-0 rounded-none",
            "sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[32rem] sm:w-[23rem] sm:rounded-2xl sm:border sm:border-border",
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border bg-[hsl(var(--navy))] px-4 py-3 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">Finax</p>
              <p className="text-[11px] text-white/70">
                {scope === "customer" ? "Your account assistant" : "BlockFinaX assistant"}
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {shown.map((m) => (
              <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-[hsl(var(--navy))] text-white"
                      : "border border-border bg-muted/50",
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Finax is thinking…
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            {messages.length === 0 && !busy && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {SUGGESTIONS[scope].map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="flex items-center gap-2 border-t border-border p-3"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Finax…"
              disabled={busy}
              className={cn(
                "flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm",
                "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--navy))]/30 disabled:opacity-60",
              )}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              className={cn(
                "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full",
                "bg-[hsl(var(--navy))] text-white transition-opacity disabled:opacity-40",
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>

          <p className="px-4 pb-2.5 text-center text-[10px] leading-tight text-muted-foreground">
            Finax can be wrong. It never moves money or signs anything.
          </p>
        </div>
      )}
    </>
  );
}
