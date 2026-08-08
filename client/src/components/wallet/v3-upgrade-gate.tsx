/**
 * Decides whether to offer the V3 upgrade, and to whom.
 *
 * Sits on the authenticated landing page and renders nothing in every case but
 * one: a signed-in account that is on the rollout list, is still on v1 or v2,
 * and hasn't dismissed the prompt this session.
 *
 * The rollout list is the point. Migration cannot be undone — there is no
 * remove-method endpoint and no way back to v1 — so the first real migrations
 * happen on accounts belonging to the person who can pick up the phone to Rift
 * if something is wrong. Widen it with VITE_V3_ROLLOUT once a wallet has been
 * migrated and a payment signed with the result.
 *
 * Every failure path here is silent. A wallet API that is unreachable, an
 * expired token, an account not on the list — all render nothing, because a
 * broken security banner is worse than no banner.
 */

import { useEffect, useState } from "react";
import { getRiftAccessToken } from "@/lib/rift-token-bridge";
import { getMe } from "@/lib/rift-client";
import { getV3Status, v3RolloutAllows, type WalletVersion } from "@/lib/rift-v3";
import { SigningUpgradePrompt } from "./signing-methods";

export function V3UpgradeGate() {
  const [state, setState] = useState<{
    token: string;
    version: WalletVersion;
    email: string;
    userId: string;
  } | null>(null);

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const token = await getRiftAccessToken();
        if (!token || !live) return;

        // The rollout is keyed on the verified account, not on anything the
        // browser could be talked into claiming about itself.
        const me = await getMe();
        const email = (me as any)?.email ?? "";
        if (!live || !v3RolloutAllows(email)) return;

        const { version } = await getV3Status(token);
        if (!live || version === "v3") return;

        setState({ token, version, email, userId: (me as any)?.user ?? (me as any)?.id ?? email });
      } catch {
        // Unreachable, unauthenticated, or not yet deployed on Rift's side.
        // Nothing to show and nothing to say about it.
      }
    })();

    return () => {
      live = false;
    };
  }, []);

  if (!state) return null;

  return (
    <div className="mb-4">
      <SigningUpgradePrompt
        accessToken={state.token}
        version={state.version}
        userLabel={state.email || "BlockFinaX"}
        userId={state.userId}
        onDone={() => setState(null)}
      />
    </div>
  );
}
