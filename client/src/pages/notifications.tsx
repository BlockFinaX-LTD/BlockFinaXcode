/**
 * Notification settings.
 *
 * Account notices appear here with no switch, and the row says why. A toggle
 * that silently refuses to turn off is worse than no toggle: the customer
 * believes they have opted out, and the next email reads as us ignoring them.
 * Showing it as fixed, with the reason, is the honest version — and it is also
 * the accurate one, because those messages are obligations rather than choices.
 *
 * Saving is optimistic. These are four booleans about email frequency; making
 * someone wait on a round trip to see a switch move is a worse trade than very
 * occasionally showing a state that failed to persist, which the toast reports.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getRiftAccessToken } from "@/lib/rift-token-bridge";

interface Category {
  key: string;
  label: string;
  detail: string;
  optional: boolean;
}

type Prefs = Record<string, boolean>;

async function authHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  try {
    h.Authorization = `Bearer ${await getRiftAccessToken()}`;
  } catch {
    /* signed out — the endpoint will refuse, which is correct */
  }
  return h;
}

export default function NotificationsPage() {
  const [, navigate] = useLocation();
  const [cats, setCats] = useState<Category[]>([]);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/notifications/prefs", { headers: await authHeaders() });
        if (!r.ok) throw new Error();
        const body = await r.json();
        if (!live) return;
        setCats(body.categories ?? []);
        setPrefs(body.prefs ?? {});
      } catch {
        if (live) toast({ title: "Couldn't load your settings", variant: "destructive" });
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [toast]);

  const set = async (k: string, value: boolean) => {
    const previous = prefs;
    setPrefs((p) => ({ ...p, [k]: value }));
    try {
      const r = await fetch("/api/notifications/prefs", {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({ ...previous, [k]: value }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setPrefs(previous); // put the switch back where it was
      toast({ title: "Couldn't save that", description: "Please try again.", variant: "destructive" });
    }
  };

  return (
    <AppShell
      active="profile"
      greeting={{ title: "Notifications", subtitle: "What we email you about" }}
    >
      <main className="mx-auto max-w-2xl pb-12">
        <button
          onClick={() => navigate("/profile")}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Profile
        </button>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="st-group">
            {cats.map((c) => (
              <div key={c.key} className="st-tile" style={{ cursor: "default" }}>
                <span className="st-body" style={{ display: "block" }}>
                  <span className="st-t" style={{ display: "block" }}>
                    {c.label}
                  </span>
                  <span className="st-s" style={{ display: "block" }}>
                    {c.detail}
                  </span>
                </span>
                {c.optional ? (
                  <Switch
                    checked={prefs[c.key] !== false}
                    onCheckedChange={(v) => set(c.key, v)}
                  />
                ) : (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
                    title="These affect access to your money, so we always send them."
                  >
                    <Lock className="h-3 w-3" /> Always
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="mt-6 px-1 text-[12px] leading-relaxed text-muted-foreground">
          Turning something off here stops the email. It does not stop the thing happening — your
          cover, payouts and verification carry on either way, and you can still see all of it in the
          app.
        </p>
      </main>
    </AppShell>
  );
}
