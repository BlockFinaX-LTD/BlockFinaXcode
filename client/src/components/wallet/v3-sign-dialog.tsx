/**
 * The approve-with-your-device prompt.
 *
 * Singleton, mounted once beside the existing transaction-auth dialog. It
 * exists for two reasons: it is the last screen before money moves, and its
 * button supplies the fresh user gesture a passkey prompt requires — the
 * preview round-trip that precedes it will usually have consumed the click
 * that began the flow.
 */

import { useEffect, useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { subscribeV3Sign, type PendingSign } from "@/lib/v3-sign";
import { biometricName } from "@/lib/rift-v3";

export function V3SignDialog() {
  const [pending, setPending] = useState<PendingSign | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeV3Sign((p) => {
    setPending(p);
    setBusy(false);
  }), []);

  if (!pending) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && pending.cancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="mx-auto mb-2 rounded-2xl bg-[hsl(var(--navy))]/10 p-3">
            <Fingerprint className="h-6 w-6 text-[hsl(var(--navy))]" />
          </div>
          <DialogTitle className="text-center">{pending.title}</DialogTitle>
          <DialogDescription className="text-center">
            {pending.detail ?? `Your device will ask for ${biometricName()}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-2">
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => {
              // Must run inside this handler: the passkey prompt is only
              // allowed while the click that triggered it is still recent.
              setBusy(true);
              pending.approve();
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
          </Button>
          <Button variant="ghost" className="w-full" disabled={busy} onClick={pending.cancel}>
            Cancel
          </Button>
        </div>

        <p className="text-center text-[11px] leading-snug text-muted-foreground">
          BlockFinaX can't approve this for you — only your device can.
        </p>
      </DialogContent>
    </Dialog>
  );
}
