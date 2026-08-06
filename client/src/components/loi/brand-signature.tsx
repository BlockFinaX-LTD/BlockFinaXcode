/**
 * Brand signature block — a typeset sign-off, not imitation handwriting.
 *
 * Follows the conventional corporate email-signature layout: the mark on the
 * left, a brand rule, then name, title, organisation and contact details.
 *
 * Exported as a PNG so it flows through exactly the same path as an uploaded
 * signature — stored in platform_settings, served to email clients as an
 * image, embedded in the PDF. Nothing downstream needs to know the difference.
 *
 * Drawn on a canvas in the browser rather than server-side: the server has no
 * image library, and doing it here has the better property that what you
 * approve on screen is literally the bitmap that gets saved.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Backing resolution — displayed small, so this keeps it crisp in print. */
const W = 1040;
const H = 300;

const NAVY = "#0a2540";
const BLUE = "#1a4480";
const INK = "#33415c";

export interface MarkFields {
  name: string;
  title: string;
  company: string;
  phone: string;
  website: string;
}

type Style = "rule" | "plain";

interface Props {
  initial?: Partial<MarkFields>;
  onChange: (dataUrl: string | null, fields: MarkFields) => void;
}

export function BrandSignatureMark({ initial, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fields, setFields] = useState<MarkFields>({
    name: initial?.name ?? "Anthony Kumako",
    title: initial?.title ?? "Founder & CEO",
    company: initial?.company ?? "BlockFinaX",
    phone: initial?.phone ?? "",
    website: initial?.website ?? "blockfinax.com",
  });
  const [style, setStyle] = useState<Style>("rule");
  const logoRef = useRef<HTMLImageElement | null>(null);
  const [logoReady, setLogoReady] = useState(false);

  // Same-origin, so the canvas stays untainted and toDataURL() works.
  useEffect(() => {
    const img = new Image();
    img.onload = () => { logoRef.current = img; setLogoReady(true); };
    img.onerror = () => setLogoReady(true); // draw without it rather than hang
    img.src = "/assets/logo-mark.png";
  }, []);

  const draw = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;

    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";
    const logo = logoRef.current;

    // ── Logo, vertically centred on the left ──
    const logoSize = 190;
    const logoX = 10;
    const logoY = (H - logoSize) / 2;
    if (logo) ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);

    // ── Brand rule between mark and text ──
    const ruleX = (logo ? logoX + logoSize : 10) + 44;
    if (style === "rule") {
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(ruleX, 34);
      ctx.lineTo(ruleX, H - 34);
      ctx.stroke();
    }

    // ── Details ──
    const textX = style === "rule" ? ruleX + 34 : ruleX;
    let y = 84;

    ctx.fillStyle = NAVY;
    ctx.font = '700 50px Helvetica, Arial, sans-serif';
    ctx.fillText(fields.name || " ", textX, y);

    y += 50;
    ctx.fillStyle = INK;
    ctx.font = '400 36px Helvetica, Arial, sans-serif';
    ctx.fillText(fields.title || " ", textX, y);

    if (fields.company.trim()) {
      y += 46;
      ctx.fillStyle = INK;
      ctx.font = '400 36px Helvetica, Arial, sans-serif';
      ctx.fillText(fields.company, textX, y);
    }

    // Contact details sit after a gap, as on a printed card.
    if (fields.phone.trim()) {
      y += 58;
      ctx.fillStyle = INK;
      ctx.font = '400 34px Helvetica, Arial, sans-serif';
      ctx.fillText(fields.phone, textX, y);
    }

    if (fields.website.trim()) {
      y += fields.phone.trim() ? 46 : 58;
      ctx.fillStyle = BLUE;
      ctx.font = '400 34px Helvetica, Arial, sans-serif';
      ctx.fillText(fields.website, textX, y);
      // Underline, the way a link reads.
      const w = ctx.measureText(fields.website).width;
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(textX, y + 7);
      ctx.lineTo(textX + w, y + 7);
      ctx.stroke();
    }

    onChange(c.toDataURL("image/png"), fields);
    // onChange is commonly an inline arrow; including it would redraw forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, style, logoReady]);

  useEffect(() => { draw(); }, [draw]);

  const set = (patch: Partial<MarkFields>) => setFields((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
        {(["rule", "plain"] as Style[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStyle(s)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              style === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s === "rule" ? "With rule" : "No rule"}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-white p-4">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="h-auto w-full max-w-full"
          style={{ aspectRatio: `${W} / ${H}` }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input value={fields.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Title</Label>
          <Input value={fields.title} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Company</Label>
          <Input value={fields.company} onChange={(e) => set({ company: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Phone <span className="text-muted-foreground">(optional)</span></Label>
          <Input value={fields.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+233 …" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Website</Label>
          <Input value={fields.website} onChange={(e) => set({ website: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
