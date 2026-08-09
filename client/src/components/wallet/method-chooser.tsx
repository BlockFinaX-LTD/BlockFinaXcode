/**
 * method-chooser.tsx — "Which method do you want to sign with?"
 *
 * Only ever rendered when a wallet has BOTH a passkey and a Google account
 * (or multiple Google accounts) enrolled and the caller didn't force a
 * preference. The picker resolves synchronously to the user's choice and
 * the sign flow continues with that method.
 *
 * Follows the same singleton pattern as V3SignDialog — mounted once at the
 * app root, driven by a module-level `registerMethodChooser` handle that
 * v3-sign.ts's resolveAuthProof calls when a choice is needed.
 */

import { useEffect, useState } from "react";
import { Fingerprint, ShieldCheck, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { subscribeMethodChooser, type PendingChoice } from "@/lib/v3-sign";
import { biometricName } from "@/lib/rift-v3";

export function MethodChooser() {
  const [pending, setPending] = useState<PendingChoice | null>(null);

  useEffect(() => subscribeMethodChooser(setPending), []);

  if (!pending) return null;

  const googleOptions = pending.options.filter((o) => o.kind === "oidc");
  const hasPasskey = pending.options.some((o) => o.kind === "passkey");

  return (
    <Dialog open onOpenChange={(open) => !open && pending.cancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">Choose signing method</DialogTitle>
          <DialogDescription className="text-center">
            Any of these can approve this payment.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-2">
          {hasPasskey && (
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={() => pending.pick({ kind: "passkey" })}
            >
              <Fingerprint className="mr-2 h-4 w-4" />
              {biometricName()}
            </Button>
          )}

          {googleOptions.map((opt, i) => (
            <Button
              key={`google-${i}`}
              className="w-full justify-start"
              variant="outline"
              onClick={() => pending.pick({ kind: "oidc", sub: opt.sub })}
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              <span className="truncate">
                {opt.label ||
                  (googleOptions.length > 1
                    ? `Google (${opt.sub?.slice(0, 6) ?? "…"})`
                    : "Google")}
              </span>
            </Button>
          ))}

          <Button variant="ghost" className="w-full" onClick={pending.cancel}>
            Cancel
          </Button>
        </div>

        {pending.busy && (
          <div className="flex justify-center pt-1 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
