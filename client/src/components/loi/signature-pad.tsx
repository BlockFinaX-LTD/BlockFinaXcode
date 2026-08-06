/**
 * Signature capture — typed, drawn, or uploaded.
 *
 * Emits a uniform value: typed signatures produce the literal text (the PDF
 * sets it in an italic serif face), drawn and uploaded produce a PNG data URL.
 * The consumer stores whichever came back and never has to branch again.
 *
 * The drawn canvas is backed at device pixel ratio so the captured bitmap is
 * crisp when the PDF scales it up.
 */

import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Type, PenLine, Upload, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export type SigMethod = "typed" | "drawn" | "uploaded";

interface Props {
  /** Pre-fills the typed field, usually the recipient's name on file. */
  defaultName?: string;
  onChange: (v: { method: SigMethod; data: string } | null) => void;
}

const TABS: { key: SigMethod; label: string; icon: any }[] = [
  { key: "typed", label: "Type", icon: Type },
  { key: "drawn", label: "Draw", icon: PenLine },
  { key: "uploaded", label: "Upload", icon: Upload },
];

export function SignaturePad({ defaultName = "", onChange }: Props) {
  const [method, setMethod] = useState<SigMethod>("typed");
  const [typed, setTyped] = useState(defaultName);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  // Report the active method's value upward whenever anything changes.
  useEffect(() => {
    if (method === "typed") {
      onChange(typed.trim() ? { method: "typed", data: typed.trim() } : null);
    } else if (method === "uploaded") {
      onChange(uploaded ? { method: "uploaded", data: uploaded } : null);
    } else {
      const c = canvasRef.current;
      onChange(hasDrawing && c ? { method: "drawn", data: c.toDataURL("image/png") } : null);
    }
    // `onChange` is intentionally excluded: parents commonly pass an inline
    // arrow, and including it would re-fire this effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, typed, uploaded, hasDrawing]);

  // Size the canvas to its box at device resolution.
  const sizeCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    if (!rect.width) return;
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Ink must be dark on the white PDF page regardless of the UI theme.
    ctx.strokeStyle = "#0f1a2f";
  }, []);

  useEffect(() => {
    if (method !== "drawn") return;
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);
    return () => window.removeEventListener("resize", sizeCanvas);
  }, [method, sizeCanvas]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    lastPt.current = pointFrom(e);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const p = pointFrom(e);
    if (!ctx || !lastPt.current) return;
    ctx.beginPath();
    ctx.moveTo(lastPt.current.x, lastPt.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPt.current = p;
    if (!hasDrawing) setHasDrawing(true);
  };

  const end = () => {
    drawing.current = false;
    lastPt.current = null;
    // Nudge the effect so the freshly drawn canvas is re-read.
    setHasDrawing((h) => h);
    const c = canvasRef.current;
    if (c) onChange({ method: "drawn", data: c.toDataURL("image/png") });
  };

  const clearCanvas = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setHasDrawing(false);
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return;
    // 2 MB ceiling: the data URL is stored in a text column and embedded in
    // the PDF, so an unbounded upload would bloat both.
    if (f.size > 2 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => setUploaded(String(reader.result));
    reader.readAsDataURL(f);
  };

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setMethod(t.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              method === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {method === "typed" && (
        <div className="space-y-2">
          <Label htmlFor="sig-typed" className="text-xs text-muted-foreground">
            Type your full legal name
          </Label>
          <Input
            id="sig-typed"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Your full name"
            className="h-14 text-2xl"
            style={{ fontFamily: '"Snell Roundhand", "Apple Chancery", "Segoe Script", cursive' }}
          />
          <p className="text-[11px] text-muted-foreground">
            This typed name is your electronic signature and is legally binding.
          </p>
        </div>
      )}

      {method === "drawn" && (
        <div className="space-y-2">
          <div className="relative rounded-lg border border-border bg-white">
            <canvas
              ref={canvasRef}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerLeave={end}
              className="h-36 w-full touch-none rounded-lg"
            />
            {!hasDrawing && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                Draw your signature here
              </span>
            )}
            <div className="pointer-events-none absolute bottom-4 left-6 right-6 border-b border-dashed border-slate-300" />
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={clearCanvas} className="h-7 gap-1.5 text-xs">
            <RotateCcw className="h-3 w-3" /> Clear
          </Button>
        </div>
      )}

      {method === "uploaded" && (
        <div className="space-y-2">
          <label
            className={cn(
              "flex h-36 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border",
              "bg-white transition-colors hover:border-primary",
            )}
          >
            {uploaded ? (
              <img src={uploaded} alt="Your signature" className="max-h-32 max-w-full object-contain" />
            ) : (
              <span className="flex flex-col items-center gap-1.5 text-sm text-slate-400">
                <Upload className="h-5 w-5" />
                Upload a signature image
              </span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <p className="text-[11px] text-muted-foreground">PNG or JPEG, up to 2 MB. A transparent PNG looks best.</p>
        </div>
      )}
    </div>
  );
}
