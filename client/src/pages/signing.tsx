/**
 * Signing methods, on its own page.
 *
 * It had been a row that expanded a panel underneath itself. A row carrying a
 * chevron promises a destination, and unfolding in place instead pushes
 * everything below it down the screen — the reader loses their position and
 * the thing they tapped is no longer where they tapped it. Two behaviours
 * behind one affordance is the part that makes it feel broken.
 *
 * So it navigates, like every other row on that screen.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getRiftAccessToken } from "@/lib/rift-token-bridge";
import { getMe } from "@/lib/rift-client";
import { v3RolloutAllows } from "@/lib/rift-v3";
import { SigningMethods } from "@/components/wallet/signing-methods";

export default function SigningPage() {
  const [, navigate] = useLocation();
  const [ctx, setCtx] = useState<{ token: string; label: string; id: string } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const token = await getRiftAccessToken();
        if (!token) return live && setState("unavailable");
        const me: any = await getMe();
        const email = me?.email ?? "";
        if (!live) return;
        if (!v3RolloutAllows(email)) return setState("unavailable");
        setCtx({ token, label: email || "BlockFinaX", id: me?.user ?? me?.id ?? email });
        setState("ready");
      } catch {
        if (live) setState("unavailable");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <AppShell active="profile" greeting={{ title: "Signing methods", subtitle: "What can approve a payment from your wallet" }}>
      <main className="mx-auto max-w-2xl pb-12">
        <button
          onClick={() => navigate("/profile")}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Profile
        </button>

        {state === "loading" && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {state === "unavailable" && (
          <div className="st-tile" style={{ cursor: "default" }}>
            <span className="st-body">
              <span className="st-t">Not available yet</span>
              <span className="st-s">
                Device signing is still being rolled out. Your wallet keeps working exactly as it
                does now.
              </span>
            </span>
          </div>
        )}

        {state === "ready" && ctx && (
          <div className="st-tile" style={{ display: "block", cursor: "default" }}>
            <SigningMethods accessToken={ctx.token} userLabel={ctx.label} userId={ctx.id} />
          </div>
        )}
      </main>
    </AppShell>
  );
}
