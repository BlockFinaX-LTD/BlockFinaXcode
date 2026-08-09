/**
 * Signing methods, on its own page.
 *
 * It had been a row that expanded a panel underneath itself. A row
 * carrying a chevron promises a destination, and unfolding in place
 * instead pushes everything below it down the screen — the reader
 * loses their position and the thing they tapped is no longer where
 * they tapped it. Two behaviours behind one affordance is the part
 * that makes it feel broken. So this navigates, like every other row.
 *
 * Visual language matches SigningMethods + V3SignDialog: no legacy
 * .st-tile wrapper, rounded-2xl cards on a plain background, motion
 * on mount.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, ShieldOff } from "lucide-react";
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
    <AppShell
      active="profile"
      greeting={{
        title: "Signing methods",
        subtitle: "What can approve a payment from your wallet",
      }}
    >
      <main className="mx-auto max-w-2xl px-4 pb-16 sm:px-0">
        <button
          onClick={() => navigate("/profile")}
          className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Profile
        </button>

        {state === "loading" && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
          </div>
        )}

        {state === "unavailable" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-800">
              <ShieldOff className="h-6 w-6 text-neutral-400" />
            </div>
            <h3 className="mt-4 text-[16px] font-semibold text-neutral-900 dark:text-neutral-100">
              Not available yet
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              Device signing is still being rolled out. Your wallet keeps working exactly as it
              does now.
            </p>
          </motion.div>
        )}

        {state === "ready" && ctx && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <SigningMethods accessToken={ctx.token} userLabel={ctx.label} userId={ctx.id} />
          </motion.div>
        )}
      </main>
    </AppShell>
  );
}
