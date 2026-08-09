/**
 * The signing-methods panel, on the page people can actually reach.
 *
 * It had been living on /settings, which is routed but absent from the app's
 * navigation — so there was no path to it at all, and "there's no place for
 * users to set up passkey signing" was an accurate description of the app.
 * Profile is in the tab bar and is already described as "your account,
 * verification and settings", which is where this belongs.
 *
 * Still gated on the rollout list, deliberately. Device signing is not working
 * end to end yet — Rift's enclave refuses the proof — and a wallet that
 * migrates today can no longer fall back to a one-time code, because a v3
 * wallet is expected to sign on the device. Offering the upgrade to a customer
 * in that state would take away their ability to transact in exchange for
 * nothing. Widen VITE_V3_ROLLOUT once a payment has actually signed.
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { getRiftAccessToken } from "@/lib/rift-token-bridge";
import { getMe } from "@/lib/rift-client";
import { v3RolloutAllows } from "@/lib/rift-v3";
import { SigningMethods } from "./signing-methods";

export function SigningSection() {
  const [ctx, setCtx] = useState<{ token: string; label: string; id: string } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const token = await getRiftAccessToken();
        if (!token || !live) return;
        const me: any = await getMe();
        const email = me?.email ?? "";
        if (!live || !v3RolloutAllows(email)) return;
        setCtx({ token, label: email || "BlockFinaX", id: me?.user ?? me?.id ?? email });
      } catch {
        // Unreachable or unauthenticated — show nothing rather than a shell.
      }
    })();
    return () => { live = false; };
  }, []);

  if (!ctx) return null;

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <SigningMethods accessToken={ctx.token} userLabel={ctx.label} userId={ctx.id} />
      </CardContent>
    </Card>
  );
}
