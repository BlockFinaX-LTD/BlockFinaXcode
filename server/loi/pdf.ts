/**
 * Final PDF generation.
 *
 * Produced once, at the moment the last required signature lands, and stored
 * on the row. Regenerating it later would let the artefact drift from what
 * the parties actually signed, so nothing else in the codebase calls this.
 *
 * jsPDF runs headless here — we only use core fonts (Times/Helvetica) and
 * addImage for signature bitmaps, none of which touch the DOM.
 *
 * Layout is a light Markdown renderer rather than a full one: the template
 * engine emits a known, closed subset (h1, h2, bold spans, paragraphs,
 * bullets), so a full Markdown parser would be weight without benefit.
 */

import { jsPDF } from "jspdf";
import type { LoiDocument, LoiSignature, LoiEvent } from "@shared/loi-schema";
import { DOC_TYPE_LABELS, RELATIONSHIP_LABELS, type DocType, type RelationshipType } from "@shared/loi-schema";

const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN_X = 20;
const MARGIN_TOP = 22;
const MARGIN_BOTTOM = 22;
const BODY_W = PAGE_W - MARGIN_X * 2;

const NAVY = { r: 26, g: 68, b: 128 };
const INK = { r: 15, g: 26, b: 47 };
const MUTED = { r: 107, g: 114, b: 128 };
const RULE = { r: 230, g: 234, b: 242 };

interface Ctx {
  doc: jsPDF;
  y: number;
  page: number;
  /** Reference shown in the footer of every page. */
  ref: string;
}

function newCtx(ref: string): Ctx {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  return { doc, y: MARGIN_TOP, page: 1, ref };
}

function footer(ctx: Ctx) {
  const { doc } = ctx;
  doc.setDrawColor(RULE.r, RULE.g, RULE.b);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, PAGE_H - 15, PAGE_W - MARGIN_X, PAGE_H - 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  doc.text(ctx.ref, MARGIN_X, PAGE_H - 10);
  doc.text(`Page ${ctx.page}`, PAGE_W - MARGIN_X, PAGE_H - 10, { align: "right" });
}

function pageBreak(ctx: Ctx) {
  footer(ctx);
  ctx.doc.addPage();
  ctx.page += 1;
  ctx.y = MARGIN_TOP;
}

/** Ensures `needed` mm remain; breaks the page if not. */
function ensure(ctx: Ctx, needed: number) {
  if (ctx.y + needed > PAGE_H - MARGIN_BOTTOM) pageBreak(ctx);
}

/**
 * Draws a line of text that may contain **bold** spans, keeping the segments
 * on one baseline. jsPDF has no rich text, so we measure and advance by hand.
 */
function drawRich(ctx: Ctx, text: string, x: number, size: number, baseStyle: "normal" | "italic" = "normal") {
  const { doc } = ctx;
  const segments = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  let cx = x;
  doc.setFontSize(size);
  for (const seg of segments) {
    const bold = seg.startsWith("**") && seg.endsWith("**");
    const content = bold ? seg.slice(2, -2) : seg;
    doc.setFont("times", bold ? "bold" : baseStyle);
    doc.text(content, cx, ctx.y);
    cx += doc.getTextWidth(content);
  }
}

/** Wraps `text` to `width`, honouring **bold** markers, and emits the lines. */
function paragraph(ctx: Ctx, text: string, opts: { size?: number; indent?: number; gap?: number; style?: "normal" | "italic" } = {}) {
  const size = opts.size ?? 10;
  const indent = opts.indent ?? 0;
  const lineH = size * 0.52;
  const { doc } = ctx;

  doc.setFont("times", opts.style ?? "normal");
  doc.setFontSize(size);
  doc.setTextColor(INK.r, INK.g, INK.b);

  // Measure against the de-marked text so bold markers don't inflate widths.
  const plain = text.replace(/\*\*/g, "");
  const lines: string[] = doc.splitTextToSize(plain, BODY_W - indent);

  // Re-apply bold markers to the wrapped lines by walking the original string.
  let cursor = 0;
  for (const line of lines) {
    ensure(ctx, lineH + 1);
    // Find this line's slice in the marked-up source.
    const slice = reMark(text, cursor, line.length);
    cursor += line.length + (plain[cursor + line.length] === " " ? 1 : 0);
    drawRich(ctx, slice, MARGIN_X + indent, size, opts.style ?? "normal");
    ctx.y += lineH;
  }
  ctx.y += opts.gap ?? 1.6;
}

/**
 * Given marked-up source and a plain-text offset/length, returns the
 * corresponding marked-up slice with balanced ** markers.
 */
function reMark(marked: string, plainStart: number, plainLen: number): string {
  let out = "";
  let plainIdx = 0;
  let i = 0;
  let bold = false;
  let started = false;
  while (i < marked.length && plainIdx < plainStart + plainLen) {
    if (marked.startsWith("**", i)) {
      bold = !bold;
      if (started && plainIdx <= plainStart + plainLen) out += "**";
      i += 2;
      continue;
    }
    if (plainIdx >= plainStart) {
      if (!started) {
        started = true;
        if (bold) out += "**";
      }
      out += marked[i];
    }
    plainIdx += 1;
    i += 1;
  }
  if (bold && started) out += "**";
  return out;
}

function h1(ctx: Ctx, text: string) {
  ensure(ctx, 18);
  ctx.doc.setFont("times", "bold");
  ctx.doc.setFontSize(19);
  ctx.doc.setTextColor(NAVY.r, NAVY.g, NAVY.b);
  ctx.doc.text(text, PAGE_W / 2, ctx.y + 6, { align: "center" });
  ctx.y += 12;
  ctx.doc.setDrawColor(NAVY.r, NAVY.g, NAVY.b);
  ctx.doc.setLineWidth(0.5);
  ctx.doc.line(PAGE_W / 2 - 18, ctx.y, PAGE_W / 2 + 18, ctx.y);
  ctx.y += 8;
}

function h2(ctx: Ctx, text: string) {
  ensure(ctx, 14);
  ctx.y += 2.5;
  ctx.doc.setFont("times", "bold");
  ctx.doc.setFontSize(11.5);
  ctx.doc.setTextColor(NAVY.r, NAVY.g, NAVY.b);
  ctx.doc.text(text, MARGIN_X, ctx.y);
  ctx.y += 5.5;
}

/** Renders the template engine's Markdown subset. */
function renderBody(ctx: Ctx, markdown: string) {
  const lines = markdown.split("\n");
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      ctx.y += 1.5;
      continue;
    }
    if (line.startsWith("# ")) {
      h1(ctx, line.slice(2).trim());
    } else if (line.startsWith("## ")) {
      h2(ctx, line.slice(3).trim());
    } else if (line.startsWith("### ")) {
      ensure(ctx, 10);
      ctx.doc.setFont("times", "bold");
      ctx.doc.setFontSize(10.5);
      ctx.doc.setTextColor(INK.r, INK.g, INK.b);
      ctx.doc.text(line.slice(4).trim(), MARGIN_X, ctx.y);
      ctx.y += 5;
    } else if (/^[-*]\s+/.test(line)) {
      const text = line.replace(/^[-*]\s+/, "");
      ensure(ctx, 6);
      ctx.doc.setFont("times", "normal");
      ctx.doc.setFontSize(10);
      ctx.doc.setTextColor(INK.r, INK.g, INK.b);
      ctx.doc.text("•", MARGIN_X + 2, ctx.y);
      paragraph(ctx, text, { indent: 7 });
    } else {
      paragraph(ctx, line);
    }
  }
}

// ── Signature blocks ─────────────────────────────────────────────────────

function signatureBlock(ctx: Ctx, sig: LoiSignature, label: string) {
  const { doc } = ctx;
  ensure(ctx, 48);

  const boxTop = ctx.y;
  const boxH = 20;

  // The signature itself: typed renders as script-ish italic, drawn/uploaded
  // as the captured bitmap.
  if (sig.method === "typed") {
    doc.setFont("times", "italic");
    doc.setFontSize(20);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(sig.signatureData.slice(0, 60), MARGIN_X + 2, boxTop + 12);
  } else if (sig.signatureData.startsWith("data:image/")) {
    try {
      const fmt = sig.signatureData.includes("image/jpeg") ? "JPEG" : "PNG";
      doc.addImage(sig.signatureData, fmt, MARGIN_X + 2, boxTop, 55, boxH);
    } catch {
      // A corrupt bitmap must not sink the whole PDF — the audit trail below
      // still records that a signature of this method was captured.
      doc.setFont("times", "italic");
      doc.setFontSize(10);
      doc.text("[signature image on file]", MARGIN_X + 2, boxTop + 12);
    }
  }
  ctx.y = boxTop + boxH + 2;

  doc.setDrawColor(INK.r, INK.g, INK.b);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, ctx.y, MARGIN_X + 80, ctx.y);
  ctx.y += 4.5;

  // Labelled rows mirroring the "Accepted and Agreed" block on the paper
  // version of this letter, with the values filled in rather than ruled off.
  doc.setFont("times", "normal");
  doc.setFontSize(9);
  const rows: [string, string][] = [
    ["Company", label],
    ["Authorized Representative", sig.signerName],
    ["Title", sig.signerPosition || "—"],
    ["Email", sig.signerEmail],
    ["Date", fmtStamp(sig.signedAt)],
  ];
  for (const [k, v] of rows) {
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(k, MARGIN_X, ctx.y);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(v, MARGIN_X + 42, ctx.y);
    ctx.y += 4.4;
  }
  ctx.y += 5;
}

function fmtStamp(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return (
    dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) +
    " " +
    dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) +
    " UTC"
  );
}

// ── Audit page ───────────────────────────────────────────────────────────

function auditPage(ctx: Ctx, loi: LoiDocument, sigs: LoiSignature[], events: LoiEvent[]) {
  pageBreak(ctx);
  const { doc } = ctx;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(NAVY.r, NAVY.g, NAVY.b);
  doc.text("Certificate of Completion", MARGIN_X, ctx.y);
  ctx.y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  doc.text("Audit trail generated by BlockFinaX at the moment of final signature.", MARGIN_X, ctx.y);
  ctx.y += 8;

  // Document summary
  kvTable(ctx, [
    ["Document", DOC_TYPE_LABELS[loi.docType as DocType] ?? loi.docType],
    ["Reference", loi.publicId],
    ["Relationship", RELATIONSHIP_LABELS[loi.relationshipType as RelationshipType] ?? loi.relationshipType],
    ["Sender", `${loi.senderName}, ${loi.senderCompany} (${loi.senderEmail})`],
    ["Recipient", `${loi.recipientName}, ${loi.recipientCompany} (${loi.recipientEmail})`],
    ["Created", fmtStamp(loi.createdAt)],
    ["Sent", fmtStamp(loi.sentAt)],
    ["Completed", fmtStamp(loi.signedAt)],
  ]);

  // Signer verification
  ctx.y += 4;
  sectionTitle(ctx, "Signer verification");
  for (const s of sigs) {
    ensure(ctx, 26);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(`${s.signerName} — ${s.party}`, MARGIN_X, ctx.y);
    ctx.y += 4.5;
    // How each party proved who they were differs, and the certificate must
    // say so accurately: the recipient clears an emailed one-time code, the
    // sender is already inside an authenticated admin session.
    const verification =
      s.party === "recipient"
        ? "verified by one-time code sent to this address"
        : "authenticated BlockFinaX administrator session";
    kvTable(
      ctx,
      [
        ["Email", `${s.signerEmail} (${verification})`],
        ["Signed at", fmtStamp(s.signedAt)],
        ["Method", s.method],
        ["IP address", s.ipAddress || "—"],
        ["Browser", s.browser || "—"],
        ["Device", s.device || "—"],
        ["Country", s.country || "—"],
      ],
      8,
      3,
    );
    ctx.y += 3;
  }

  // Event history
  ctx.y += 2;
  sectionTitle(ctx, "Activity history");
  for (const e of events) {
    ensure(ctx, 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(fmtStamp(e.createdAt), MARGIN_X, ctx.y);
    doc.setTextColor(INK.r, INK.g, INK.b);
    const desc = e.detail || e.type;
    const wrapped: string[] = doc.splitTextToSize(desc, BODY_W - 46);
    doc.text(wrapped[0] ?? "", MARGIN_X + 44, ctx.y);
    ctx.y += 3.8;
    for (const extra of wrapped.slice(1)) {
      ensure(ctx, 5);
      doc.text(extra, MARGIN_X + 44, ctx.y);
      ctx.y += 3.8;
    }
  }

  ctx.y += 6;
  ensure(ctx, 20);
  doc.setDrawColor(RULE.r, RULE.g, RULE.b);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, ctx.y, PAGE_W - MARGIN_X, ctx.y);
  ctx.y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  const note: string[] = doc.splitTextToSize(
    "This certificate records the electronic signature process for the document above. The counterparty's " +
      "email address was verified by a one-time code sent to that address, which was entered correctly before " +
      "their signature was accepted; the sending party signed from an authenticated administrator session. The " +
      "document was locked against further modification at the time of final signature. Reference " +
      `${loi.publicId} can be quoted to BlockFinaX to retrieve the stored original.`,
    BODY_W,
  );
  for (const l of note) {
    doc.text(l, MARGIN_X, ctx.y);
    ctx.y += 3.4;
  }
}

function sectionTitle(ctx: Ctx, text: string) {
  ensure(ctx, 10);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(9.5);
  ctx.doc.setTextColor(NAVY.r, NAVY.g, NAVY.b);
  ctx.doc.text(text, MARGIN_X, ctx.y);
  ctx.y += 5;
}

function kvTable(ctx: Ctx, rows: [string, string][], size = 8.5, indent = 0) {
  const { doc } = ctx;
  const keyW = 34;
  for (const [k, v] of rows) {
    ensure(ctx, 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(k, MARGIN_X + indent, ctx.y);
    doc.setTextColor(INK.r, INK.g, INK.b);
    const wrapped: string[] = doc.splitTextToSize(v, BODY_W - keyW - indent);
    doc.text(wrapped[0] ?? "", MARGIN_X + indent + keyW, ctx.y);
    ctx.y += 4.2;
    for (const extra of wrapped.slice(1)) {
      ensure(ctx, 5);
      doc.text(extra, MARGIN_X + indent + keyW, ctx.y);
      ctx.y += 4.2;
    }
  }
}

// ── Entry point ──────────────────────────────────────────────────────────

/**
 * Renders the signed document. Returns base64 (no data-URL prefix).
 *
 * `body` is passed in rather than read off the row so the caller composes
 * custom clauses exactly once, in one place.
 */
export function generateSignedPdf(args: {
  loi: LoiDocument;
  body: string;
  signatures: LoiSignature[];
  events: LoiEvent[];
}): string {
  const { loi, body, signatures, events } = args;
  const ctx = newCtx(`${DOC_TYPE_LABELS[loi.docType as DocType] ?? "Document"} · Ref ${loi.publicId}`);

  renderBody(ctx, body);

  // Signature section
  ctx.y += 6;
  ensure(ctx, 24);
  ctx.doc.setDrawColor(RULE.r, RULE.g, RULE.b);
  ctx.doc.setLineWidth(0.3);
  ctx.doc.line(MARGIN_X, ctx.y, PAGE_W - MARGIN_X, ctx.y);
  ctx.y += 7;
  h2(ctx, "Accepted and Agreed");

  const sender = signatures.find((s) => s.party === "sender");
  const recipient = signatures.find((s) => s.party === "recipient");
  if (sender) signatureBlock(ctx, sender, loi.senderCompany);
  if (recipient) signatureBlock(ctx, recipient, loi.recipientCompany);

  auditPage(ctx, loi, signatures, events);
  footer(ctx);

  return ctx.doc.output("datauristring").split(",")[1] ?? "";
}
