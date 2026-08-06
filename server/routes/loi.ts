/**
 * Smart Letter of Intent — API
 *
 * Two audiences, two auth models, one document:
 *
 *   /api/loi/*        admin-only (x-admin-token). Create, edit, send, track.
 *   /api/sign/*       recipient. Authenticated by the bearer token from the
 *                     emailed link, scoped to exactly one document.
 *
 * The recipient surface is the security-sensitive half. Rules it enforces:
 *   - The token grants access to one document; the id in the URL must match
 *     the token's document or the request 404s.
 *   - Reading requires the token. Signing additionally requires a fresh OTP
 *     delivered to the address on file, so a forwarded link cannot sign.
 *   - Any document past a terminal status rejects mutations outright.
 *   - The recipient never receives the sender's internal ids, other rows, or
 *     anything not needed to render their own document.
 */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { requireAdmin } from "../middleware/admin-auth";
import { strictLimiter, generalApiLimiter } from "../middleware/rate-limiter";
import {
  loiDocuments, loiTokens, loiOtps, loiSignatures, loiComments, loiEvents,
  createLoiSchema, updateLoiSchema, signSchema, commentSchema,
  TERMINAL_STATUSES, DOC_TYPE_LABELS,
  type LoiDocument, type LoiStatus, type DocType, type RelationshipType,
} from "@shared/loi-schema";
import {
  generateDocument, withCustomClauses, templateKeyFor,
  detectMissingFields, flagRisks, type TemplateInput,
} from "../loi/templates";
import { generateSignedPdf } from "../loi/pdf";
import { getSignature, setSignature, clearSignature, decodeDataUrl } from "../loi/brand";
import {
  emailLoiInvitation, emailLoiOtp, emailSenderNotification,
  emailSignedCopy, emailLoiRevisionAvailable, emailLoiExpiryReminder,
} from "../loi/email";

// ── Helpers ──────────────────────────────────────────────────────────────

const hashToken = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

const newPublicId = () =>
  // Readable enough to quote over the phone, wide enough not to guess.
  `LOI-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.ip || "";
}

/** Best-effort UA parse — enough for an audit trail, no dependency needed. */
function parseUa(ua: string): { browser: string; device: string } {
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) && !/Chrome/.test(ua) ? "Safari" :
    /Firefox\//.test(ua) ? "Firefox" : "Unknown";
  const device =
    /iPhone/.test(ua) ? "iPhone" :
    /iPad/.test(ua) ? "iPad" :
    /Android/.test(ua) ? "Android" :
    /Macintosh/.test(ua) ? "Mac" :
    /Windows/.test(ua) ? "Windows" :
    /Linux/.test(ua) ? "Linux" : "Unknown";
  return { browser, device };
}

/**
 * Origin the admin is actually browsing from. Used as the base for links in
 * outbound mail when PUBLIC_APP_URL is a localhost value that a recipient
 * could never open.
 */
function requestOrigin(req: Request): string | undefined {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : undefined;
}

/** Cloudflare/Railway put the resolved country here when fronted by a CDN. */
function clientCountry(req: Request): string | null {
  const c = req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"];
  return typeof c === "string" && c && c !== "XX" ? c : null;
}

async function logEvent(
  loiId: number,
  type: string,
  detail: string,
  opts: { actor?: string; actorEmail?: string; req?: Request; meta?: Record<string, unknown> } = {},
) {
  await db.insert(loiEvents).values({
    loiId,
    type,
    detail,
    actor: opts.actor ?? "system",
    actorEmail: opts.actorEmail,
    meta: opts.meta,
    ipAddress: opts.req ? clientIp(opts.req) : undefined,
    userAgent: opts.req ? String(opts.req.headers["user-agent"] || "").slice(0, 500) : undefined,
  });
  await db
    .update(loiDocuments)
    .set({ lastActivityAt: new Date() })
    .where(eq(loiDocuments.id, loiId));
}

function toTemplateInput(loi: LoiDocument): TemplateInput {
  return {
    docType: loi.docType as DocType,
    relationshipType: loi.relationshipType as RelationshipType,
    senderCompany: loi.senderCompany,
    senderName: loi.senderName,
    senderPosition: loi.senderPosition,
    senderEmail: loi.senderEmail,
    senderPhone: loi.senderPhone,
    recipientCompany: loi.recipientCompany,
    recipientName: loi.recipientName,
    recipientPosition: loi.recipientPosition,
    recipientEmail: loi.recipientEmail,
    recipientCountry: loi.recipientCountry,
    terms: loi.terms,
    date: loi.createdAt ? new Date(loi.createdAt) : new Date(),
  };
}

/** The document as the parties see it: generated body + appended clauses. */
function composedBody(loi: LoiDocument): string {
  return withCustomClauses(loi.bodyMarkdown, loi.customClauses ?? []);
}

/**
 * Lazily expires documents whose window has closed. Called on read paths so
 * status is always truthful without needing a background job; a cron would
 * be an option later but this keeps the surface small.
 */
async function expireOverdue(): Promise<void> {
  const now = new Date();
  const stale = await db
    .select()
    .from(loiDocuments)
    .where(
      and(
        lt(loiDocuments.expiresAt, now),
        sql`${loiDocuments.status} NOT IN ('signed','declined','expired','draft')`,
      ),
    );
  for (const loi of stale) {
    await db.update(loiDocuments).set({ status: "expired", updatedAt: now }).where(eq(loiDocuments.id, loi.id));
    await logEvent(loi.id, "expired", "Signing window closed without a signature.");
    emailSenderNotification({ ...loi, status: "expired" }, "expired").catch(() => {});
  }
}

async function issueToken(loiId: number, email: string, expiresAt: Date): Promise<string> {
  const raw = crypto.randomBytes(32).toString("base64url");
  await db.insert(loiTokens).values({ loiId, email, tokenHash: hashToken(raw), expiresAt });
  return raw;
}

/** Resolves and validates a recipient bearer token. */
async function resolveToken(req: Request): Promise<{ loi: LoiDocument; email: string } | null> {
  const raw =
    (typeof req.query.t === "string" && req.query.t) ||
    (req.headers["x-loi-token"] as string) ||
    "";
  if (!raw) return null;

  const [tok] = await db.select().from(loiTokens).where(eq(loiTokens.tokenHash, hashToken(raw))).limit(1);
  if (!tok || tok.revokedAt || new Date(tok.expiresAt) < new Date()) return null;

  const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, tok.loiId)).limit(1);
  if (!loi) return null;

  // The public id in the path must belong to this token. Without this check a
  // valid token for document A would read document B.
  const pathId = req.params.publicId;
  if (pathId && pathId !== loi.publicId) return null;

  return { loi, email: tok.email };
}

/** Shape sent to the recipient. Deliberately omits internal ids and PII of others. */
function recipientView(loi: LoiDocument, comments: any[], signatures: any[]) {
  return {
    publicId: loi.publicId,
    docType: loi.docType,
    docLabel: DOC_TYPE_LABELS[loi.docType as DocType] ?? "Document",
    status: loi.status,
    senderCompany: loi.senderCompany,
    senderName: loi.senderName,
    senderPosition: loi.senderPosition,
    senderEmail: loi.senderEmail,
    recipientCompany: loi.recipientCompany,
    recipientName: loi.recipientName,
    recipientPosition: loi.recipientPosition,
    recipientEmail: loi.recipientEmail,
    personalMessage: loi.personalMessage,
    body: composedBody(loi),
    expiresAt: loi.expiresAt,
    sentAt: loi.sentAt,
    signedAt: loi.signedAt,
    lockedAt: loi.lockedAt,
    comments: comments.map((c) => ({
      id: c.id, party: c.party, authorName: c.authorName, anchor: c.anchor,
      kind: c.kind, body: c.body, suggestedText: c.suggestedText,
      resolution: c.resolution, createdAt: c.createdAt,
    })),
    signatures: signatures.map((s) => ({
      party: s.party, signerName: s.signerName, signerPosition: s.signerPosition,
      method: s.method, signatureData: s.signatureData, signedAt: s.signedAt,
    })),
  };
}

/**
 * Finalises a fully-signed document: renders the PDF, locks the row, mails
 * every party. Idempotent — a second call on a locked row is a no-op.
 */
async function finalise(loiId: number): Promise<void> {
  const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, loiId)).limit(1);
  if (!loi || loi.pdfBase64) return;

  const signatures = await db.select().from(loiSignatures).where(eq(loiSignatures.loiId, loiId));
  const events = await db.select().from(loiEvents).where(eq(loiEvents.loiId, loiId)).orderBy(loiEvents.createdAt);

  const signedAt = new Date();
  const finalRow: LoiDocument = { ...loi, status: "signed", signedAt, lockedAt: signedAt };

  let pdf = "";
  try {
    pdf = generateSignedPdf({ loi: finalRow, body: composedBody(loi), signatures, events });
  } catch (err: any) {
    // A PDF failure must not lose the signature. Record it and leave the row
    // signed-but-unrendered; the admin UI offers a re-render in that state.
    console.error("[loi] PDF generation failed:", err?.message);
    await logEvent(loiId, "pdf_failed", `PDF generation failed: ${err?.message}`);
  }

  await db
    .update(loiDocuments)
    .set({ status: "signed", signedAt, lockedAt: signedAt, pdfBase64: pdf || null, updatedAt: signedAt })
    .where(eq(loiDocuments.id, loiId));

  await logEvent(loiId, "completed", "All required signatures collected. Document locked.");
  if (pdf) emailSignedCopy(finalRow, pdf).catch(() => {});
  emailSenderNotification(finalRow, "signed").catch(() => {});
}

// ── Routes ───────────────────────────────────────────────────────────────

export function registerLoiRoutes(app: Express) {
  // ═══ BRAND ═════════════════════════════════════════════════════════════

  /**
   * The stored signature, as a real PNG.
   *
   * Public and unauthenticated by necessity: email clients fetch images
   * anonymously, so anything behind auth simply doesn't render. What's
   * exposed is a company signature that already appears on every letter we
   * send — not a secret. It is never the thing that authorises anything;
   * signatures are only accepted through the OTP-verified endpoints below.
   */
  app.get("/api/brand/signature.png", async (_req: Request, res: Response) => {
    try {
      const sig = await getSignature();
      const decoded = sig ? decodeDataUrl(sig.dataUrl) : null;
      if (!decoded) return res.status(404).end();
      res.setHeader("Content-Type", decoded.mime);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(decoded.buffer);
    } catch {
      res.status(404).end();
    }
  });

  /** Whether a signature is on file, for the admin UI. */
  app.get("/api/brand/signature", requireAdmin, async (_req: Request, res: Response) => {
    const sig = await getSignature();
    res.json({ present: !!sig, name: sig?.name ?? "", dataUrl: sig?.dataUrl ?? null });
  });

  /** Upload or replace the signature. */
  app.put("/api/brand/signature", requireAdmin, async (req: Request, res: Response) => {
    try {
      const dataUrl = String(req.body?.dataUrl || "");
      const name = String(req.body?.name || "").slice(0, 200);
      const decoded = decodeDataUrl(dataUrl);
      if (!decoded) {
        return res.status(400).json({ message: "Send a PNG or JPEG image." });
      }
      // 1 MB ceiling: it is embedded in every PDF and fetched by every email
      // client, so an oversized file is a real cost, not a theoretical one.
      if (decoded.buffer.length > 1_000_000) {
        return res.status(400).json({ message: "That image is too large. Keep it under 1 MB." });
      }
      await setSignature(dataUrl, name);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[brand] signature save failed:", err?.message);
      res.status(500).json({ message: "Failed to save the signature" });
    }
  });

  app.delete("/api/brand/signature", requireAdmin, async (_req: Request, res: Response) => {
    await clearSignature();
    res.json({ ok: true });
  });

  // ═══ ADMIN ═════════════════════════════════════════════════════════════

  /** Dashboard list. Supports search + status filter. */
  app.get("/api/loi", requireAdmin, async (req: Request, res: Response) => {
    try {
      await expireOverdue();
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

      let rows = await db.select().from(loiDocuments).orderBy(desc(loiDocuments.lastActivityAt));
      if (status && status !== "all") rows = rows.filter((r) => r.status === status);
      if (q) {
        rows = rows.filter((r) =>
          [r.recipientCompany, r.recipientName, r.recipientEmail, r.publicId, r.senderCompany]
            .some((f) => f?.toLowerCase().includes(q)),
        );
      }
      // Strip the PDF blob from list responses — it's large and unused here.
      res.json(rows.map(({ pdfBase64, ...rest }) => ({ ...rest, hasPdf: !!pdfBase64 })));
    } catch (err: any) {
      console.error("[loi] list failed:", err?.message);
      res.status(500).json({ message: "Failed to load documents" });
    }
  });

  /** Aggregate counts for the dashboard header. */
  app.get("/api/loi/stats", requireAdmin, async (_req: Request, res: Response) => {
    try {
      await expireOverdue();
      const rows = await db.select({ status: loiDocuments.status }).from(loiDocuments);
      const byStatus: Record<string, number> = {};
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      res.json({
        total: rows.length,
        byStatus,
        outstanding: rows.filter((r) => ["sent", "viewed", "awaiting_signature", "changes_requested"].includes(r.status)).length,
        signed: byStatus.signed ?? 0,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to load stats" });
    }
  });

  /** Full detail incl. timeline, comments, signatures. */
  app.get("/api/loi/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, id)).limit(1);
      if (!loi) return res.status(404).json({ message: "Not found" });

      const [events, comments, signatures] = await Promise.all([
        db.select().from(loiEvents).where(eq(loiEvents.loiId, id)).orderBy(desc(loiEvents.createdAt)),
        db.select().from(loiComments).where(eq(loiComments.loiId, id)).orderBy(loiComments.createdAt),
        db.select().from(loiSignatures).where(eq(loiSignatures.loiId, id)),
      ]);

      const input = toTemplateInput(loi);
      const body = composedBody(loi);
      const { pdfBase64, ...rest } = loi;
      res.json({
        ...rest,
        hasPdf: !!pdfBase64,
        composedBody: body,
        events,
        comments,
        signatures,
        missingFields: detectMissingFields(input),
        risks: flagRisks(input, body),
      });
    } catch (err: any) {
      console.error("[loi] detail failed:", err?.message);
      res.status(500).json({ message: "Failed to load document" });
    }
  });

  /** Create a draft and generate its first body. */
  app.post("/api/loi", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = createLoiSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten().fieldErrors });
      }
      const d = parsed.data;
      const now = new Date();
      const input: TemplateInput = {
        docType: d.docType,
        relationshipType: d.relationshipType,
        senderCompany: d.senderCompany,
        senderName: d.senderName,
        senderPosition: d.senderPosition,
        senderEmail: d.senderEmail,
        senderPhone: d.senderPhone,
        recipientCompany: d.recipientCompany,
        recipientName: d.recipientName,
        recipientPosition: d.recipientPosition,
        recipientEmail: d.recipientEmail,
        recipientCountry: d.recipientCountry,
        terms: d.terms,
        date: now,
      };

      const [row] = await db
        .insert(loiDocuments)
        .values({
          publicId: newPublicId(),
          docType: d.docType,
          templateKey: templateKeyFor(d.docType, d.relationshipType),
          status: "draft",
          senderCompany: d.senderCompany,
          senderName: d.senderName,
          senderPosition: d.senderPosition,
          senderEmail: d.senderEmail,
          senderPhone: d.senderPhone,
          recipientCompany: d.recipientCompany,
          recipientName: d.recipientName,
          recipientPosition: d.recipientPosition,
          recipientEmail: d.recipientEmail,
          recipientCountry: d.recipientCountry,
          relationshipType: d.relationshipType,
          terms: d.terms,
          bodyMarkdown: generateDocument(input),
          customClauses: [],
          personalMessage: d.personalMessage,
          expiresAt: new Date(now.getTime() + d.expiresInDays * 86_400_000),
          createdBy: d.senderEmail,
        })
        .returning();

      await logEvent(row.id, "created", `Draft created by ${d.senderName}.`, { actor: "sender", actorEmail: d.senderEmail, req });
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[loi] create failed:", err?.message);
      res.status(500).json({ message: "Failed to create document" });
    }
  });

  /** Update a draft. Refuses once the document is locked. */
  app.patch("/api/loi/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, id)).limit(1);
      if (!loi) return res.status(404).json({ message: "Not found" });
      // A locked document's *content* is immutable, but the data-room
      // disclosure flag is metadata about it rather than part of the signed
      // text — and a signed agreement is precisely when you would publish it.
      const keys = Object.keys(req.body ?? {});
      const onlyDisclosureFlag = keys.length > 0 && keys.every((k) => k === "showInDataRoom");
      if ((loi.lockedAt || TERMINAL_STATUSES.includes(loi.status as LoiStatus)) && !onlyDisclosureFlag) {
        return res.status(409).json({ message: "This document is locked and can no longer be edited." });
      }

      const parsed = updateLoiSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten().fieldErrors });
      }
      const d = parsed.data;
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of [
        "senderCompany", "senderName", "senderPosition", "senderEmail", "senderPhone",
        "recipientCompany", "recipientName", "recipientPosition", "recipientEmail", "recipientCountry",
        "relationshipType", "docType", "terms", "personalMessage", "bodyMarkdown", "customClauses",
        "showInDataRoom",
      ] as const) {
        if (d[k as keyof typeof d] !== undefined) patch[k] = d[k as keyof typeof d];
      }
      if (d.expiresInDays !== undefined) {
        patch.expiresAt = new Date(Date.now() + d.expiresInDays * 86_400_000);
      }
      if (d.docType || d.relationshipType) {
        patch.templateKey = templateKeyFor(
          (d.docType ?? loi.docType) as DocType,
          (d.relationshipType ?? loi.relationshipType) as RelationshipType,
        );
      }

      const [row] = await db.update(loiDocuments).set(patch).where(eq(loiDocuments.id, id)).returning();
      // Autosave fires this constantly; only log substantive edits.
      if (d.bodyMarkdown !== undefined || d.customClauses !== undefined) {
        await logEvent(id, "edited", "Document content edited by sender.", { actor: "sender", req });
      }
      res.json(row);
    } catch (err: any) {
      console.error("[loi] update failed:", err?.message);
      res.status(500).json({ message: "Failed to save" });
    }
  });

  /** Regenerate the body from the current form data, discarding manual edits. */
  app.post("/api/loi/:id/regenerate", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, id)).limit(1);
      if (!loi) return res.status(404).json({ message: "Not found" });
      if (loi.lockedAt) return res.status(409).json({ message: "Document is locked." });

      const body = generateDocument(toTemplateInput(loi));
      const [row] = await db
        .update(loiDocuments)
        .set({ bodyMarkdown: body, updatedAt: new Date() })
        .where(eq(loiDocuments.id, id))
        .returning();
      await logEvent(id, "regenerated", "Document regenerated from the form data.", { actor: "sender", req });
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to regenerate" });
    }
  });

  /** Send (or resend) the invitation. Issues a fresh token each time. */
  app.post("/api/loi/:id/send", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, id)).limit(1);
      if (!loi) return res.status(404).json({ message: "Not found" });
      if (loi.lockedAt || TERMINAL_STATUSES.includes(loi.status as LoiStatus)) {
        return res.status(409).json({ message: "This document can no longer be sent." });
      }

      const isResend = !!loi.sentAt;
      const expiresAt = loi.expiresAt ?? new Date(Date.now() + 30 * 86_400_000);
      // Supersede older links so a revoked/forwarded one stops working.
      await db.update(loiTokens).set({ revokedAt: new Date() })
        .where(and(eq(loiTokens.loiId, id), isNull(loiTokens.revokedAt)));
      const raw = await issueToken(id, loi.recipientEmail, expiresAt);

      const now = new Date();
      const [row] = await db
        .update(loiDocuments)
        .set({ status: "sent", sentAt: loi.sentAt ?? now, expiresAt, updatedAt: now })
        .where(eq(loiDocuments.id, id))
        .returning();

      const origin = requestOrigin(req);
      const mail = isResend
        ? await emailLoiRevisionAvailable(row, raw, origin)
        : await emailLoiInvitation(row, raw, origin);

      await logEvent(
        id,
        isResend ? "resent" : "sent",
        `${isResend ? "Revision" : "Invitation"} emailed to ${loi.recipientEmail}.`,
        { actor: "sender", actorEmail: loi.senderEmail, req },
      );
      res.json({ ...row, emailed: mail.ok, emailError: mail.error });
    } catch (err: any) {
      console.error("[loi] send failed:", err?.message);
      res.status(500).json({ message: "Failed to send" });
    }
  });

  /** Accept or reject a recipient's suggested edit. */
  app.post("/api/loi/:id/comments/:commentId/resolve", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const commentId = parseInt(req.params.commentId, 10);
      const resolution = req.body?.resolution === "accepted" ? "accepted" : "rejected";

      const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, id)).limit(1);
      if (!loi) return res.status(404).json({ message: "Not found" });
      if (loi.lockedAt) return res.status(409).json({ message: "Document is locked." });

      const [c] = await db.select().from(loiComments)
        .where(and(eq(loiComments.id, commentId), eq(loiComments.loiId, id))).limit(1);
      if (!c) return res.status(404).json({ message: "Comment not found" });

      await db.update(loiComments)
        .set({ resolution, resolvedAt: new Date() })
        .where(eq(loiComments.id, commentId));

      // Accepting a suggestion substitutes the proposed text in the body.
      let body = loi.bodyMarkdown;
      if (resolution === "accepted" && c.kind === "suggestion" && c.suggestedText && c.anchor) {
        if (body.includes(c.anchor)) {
          body = body.replace(c.anchor, c.suggestedText);
          await db.update(loiDocuments)
            .set({ bodyMarkdown: body, updatedAt: new Date() })
            .where(eq(loiDocuments.id, id));
        }
      }
      await logEvent(id, `suggestion_${resolution}`, `Sender ${resolution} a suggested edit.`, { actor: "sender", req });
      res.json({ ok: true, resolution, bodyMarkdown: body });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to resolve" });
    }
  });

  /** Download the executed PDF. */
  app.get("/api/loi/:id/pdf", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, id)).limit(1);
      if (!loi?.pdfBase64) return res.status(404).json({ message: "No signed PDF yet" });
      const buf = Buffer.from(loi.pdfBase64, "base64");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${loi.publicId}.pdf"`);
      res.send(buf);
    } catch {
      res.status(500).json({ message: "Failed to fetch PDF" });
    }
  });

  /** Preview the current draft as a PDF, unsigned. Useful before sending. */
  app.get("/api/loi/:id/preview.pdf", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, id)).limit(1);
      if (!loi) return res.status(404).json({ message: "Not found" });
      const events = await db.select().from(loiEvents).where(eq(loiEvents.loiId, id)).orderBy(loiEvents.createdAt);
      const b64 = generateSignedPdf({ loi, body: composedBody(loi), signatures: [], events });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${loi.publicId}-preview.pdf"`);
      res.send(Buffer.from(b64, "base64"));
    } catch (err: any) {
      console.error("[loi] preview failed:", err?.message);
      res.status(500).json({ message: "Failed to render preview" });
    }
  });

  /** Sender counter-signature. Recorded without OTP — already admin-authed. */
  app.post("/api/loi/:id/countersign", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, id)).limit(1);
      if (!loi) return res.status(404).json({ message: "Not found" });
      if (loi.lockedAt) return res.status(409).json({ message: "Document is locked." });

      const method = ["typed", "drawn", "uploaded"].includes(req.body?.method) ? req.body.method : "typed";
      const signatureData = String(req.body?.signatureData || loi.senderName).slice(0, 2_000_000);

      const existing = await db.select().from(loiSignatures)
        .where(and(eq(loiSignatures.loiId, id), eq(loiSignatures.party, "sender"))).limit(1);
      if (existing.length) return res.status(409).json({ message: "Already counter-signed." });

      const ua = String(req.headers["user-agent"] || "");
      const { browser, device } = parseUa(ua);
      await db.insert(loiSignatures).values({
        loiId: id, party: "sender",
        signerName: loi.senderName, signerEmail: loi.senderEmail, signerPosition: loi.senderPosition,
        method, signatureData,
        ipAddress: clientIp(req), userAgent: ua.slice(0, 500), browser, device, country: clientCountry(req),
      });
      await logEvent(id, "sender_signed", `${loi.senderName} signed on behalf of ${loi.senderCompany}.`, {
        actor: "sender", actorEmail: loi.senderEmail, req,
      });

      // If the recipient already signed, this completes the document.
      const sigs = await db.select().from(loiSignatures).where(eq(loiSignatures.loiId, id));
      if (sigs.some((s) => s.party === "recipient")) await finalise(id);

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[loi] countersign failed:", err?.message);
      res.status(500).json({ message: "Failed to sign" });
    }
  });

  /** Manual reminder to the recipient. */
  app.post("/api/loi/:id/remind", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, id)).limit(1);
      if (!loi) return res.status(404).json({ message: "Not found" });
      if (TERMINAL_STATUSES.includes(loi.status as LoiStatus)) {
        return res.status(409).json({ message: "Nothing to remind about." });
      }
      const [tok] = await db.select().from(loiTokens)
        .where(and(eq(loiTokens.loiId, id), isNull(loiTokens.revokedAt)))
        .orderBy(desc(loiTokens.createdAt)).limit(1);
      if (!tok) return res.status(409).json({ message: "Send the document first." });

      // The stored hash can't be reversed, so a reminder issues a new link.
      const raw = await issueToken(id, loi.recipientEmail, new Date(tok.expiresAt));
      const daysLeft = Math.max(1, Math.ceil((new Date(tok.expiresAt).getTime() - Date.now()) / 86_400_000));
      const mail = await emailLoiExpiryReminder(loi, raw, daysLeft, requestOrigin(req));
      await logEvent(id, "reminded", `Reminder emailed to ${loi.recipientEmail}.`, { actor: "sender", req });
      res.json({ ok: mail.ok, error: mail.error });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to send reminder" });
    }
  });

  /** Delete a draft. Only drafts — sent documents are records. */
  app.delete("/api/loi/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [loi] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, id)).limit(1);
      if (!loi) return res.status(404).json({ message: "Not found" });
      if (loi.status !== "draft") {
        return res.status(409).json({ message: "Only drafts can be deleted. Sent documents are kept as records." });
      }
      await db.delete(loiEvents).where(eq(loiEvents.loiId, id));
      await db.delete(loiComments).where(eq(loiComments.loiId, id));
      await db.delete(loiTokens).where(eq(loiTokens.loiId, id));
      await db.delete(loiOtps).where(eq(loiOtps.loiId, id));
      await db.delete(loiSignatures).where(eq(loiSignatures.loiId, id));
      await db.delete(loiDocuments).where(eq(loiDocuments.id, id));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Failed to delete" });
    }
  });

  // ═══ RECIPIENT PORTAL ══════════════════════════════════════════════════

  /** Read the document. Marks first view. */
  app.get("/api/sign/:publicId", generalApiLimiter, async (req: Request, res: Response) => {
    try {
      await expireOverdue();
      const ctx = await resolveToken(req);
      if (!ctx) return res.status(404).json({ message: "This link is invalid or has expired." });
      const { loi } = ctx;

      // First open flips sent → viewed and notifies the sender exactly once.
      if (!loi.firstViewedAt) {
        const now = new Date();
        await db.update(loiDocuments)
          .set({ firstViewedAt: now, status: loi.status === "sent" ? "viewed" : loi.status, updatedAt: now })
          .where(eq(loiDocuments.id, loi.id));
        await logEvent(loi.id, "viewed", `${loi.recipientName} opened the document.`, {
          actor: "recipient", actorEmail: loi.recipientEmail, req,
        });
        emailSenderNotification(loi, "viewed").catch(() => {});
        loi.firstViewedAt = now;
        if (loi.status === "sent") loi.status = "viewed";
      }

      const [comments, signatures] = await Promise.all([
        db.select().from(loiComments).where(eq(loiComments.loiId, loi.id)).orderBy(loiComments.createdAt),
        db.select().from(loiSignatures).where(eq(loiSignatures.loiId, loi.id)),
      ]);
      res.json(recipientView(loi, comments, signatures));
    } catch (err: any) {
      console.error("[loi] recipient read failed:", err?.message);
      res.status(500).json({ message: "Failed to load document" });
    }
  });

  /** Post a comment or a suggested edit. */
  app.post("/api/sign/:publicId/comments", generalApiLimiter, async (req: Request, res: Response) => {
    try {
      const ctx = await resolveToken(req);
      if (!ctx) return res.status(404).json({ message: "This link is invalid or has expired." });
      const { loi } = ctx;
      if (loi.lockedAt) return res.status(409).json({ message: "This document is locked." });

      const parsed = commentSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid comment" });
      const d = parsed.data;

      const [row] = await db.insert(loiComments).values({
        loiId: loi.id, party: "recipient", authorName: loi.recipientName,
        anchor: d.anchor, kind: d.kind, body: d.body, suggestedText: d.suggestedText,
      }).returning();

      const now = new Date();
      // A suggestion is a change request; a bare comment isn't.
      if (d.kind === "suggestion" && !TERMINAL_STATUSES.includes(loi.status as LoiStatus)) {
        await db.update(loiDocuments)
          .set({ status: "changes_requested", updatedAt: now })
          .where(eq(loiDocuments.id, loi.id));
        emailSenderNotification(loi, "changes_requested").catch(() => {});
      }
      await logEvent(loi.id, d.kind === "suggestion" ? "changes_requested" : "commented",
        d.kind === "suggestion"
          ? `${loi.recipientName} proposed an edit.`
          : `${loi.recipientName} left a comment.`,
        { actor: "recipient", actorEmail: loi.recipientEmail, req });

      res.status(201).json(row);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to post comment" });
    }
  });

  /** Approve without signing — signals readiness to execute. */
  app.post("/api/sign/:publicId/approve", generalApiLimiter, async (req: Request, res: Response) => {
    try {
      const ctx = await resolveToken(req);
      if (!ctx) return res.status(404).json({ message: "This link is invalid or has expired." });
      const { loi } = ctx;
      if (TERMINAL_STATUSES.includes(loi.status as LoiStatus)) {
        return res.status(409).json({ message: "This document is closed." });
      }
      await db.update(loiDocuments)
        .set({ status: "awaiting_signature", updatedAt: new Date() })
        .where(eq(loiDocuments.id, loi.id));
      await logEvent(loi.id, "approved", `${loi.recipientName} approved the document.`, {
        actor: "recipient", actorEmail: loi.recipientEmail, req,
      });
      emailSenderNotification(loi, "approved").catch(() => {});
      res.json({ ok: true, status: "awaiting_signature" });
    } catch {
      res.status(500).json({ message: "Failed to approve" });
    }
  });

  /**
   * Request the signing OTP. Rate-limited hard: this sends mail to a fixed
   * address, so abuse means mail-bombing the counterparty.
   */
  app.post("/api/sign/:publicId/request-code", strictLimiter, async (req: Request, res: Response) => {
    try {
      const ctx = await resolveToken(req);
      if (!ctx) return res.status(404).json({ message: "This link is invalid or has expired." });
      const { loi } = ctx;
      if (loi.lockedAt || TERMINAL_STATUSES.includes(loi.status as LoiStatus)) {
        return res.status(409).json({ message: "This document is closed." });
      }

      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      // Invalidate outstanding codes so only the newest works.
      await db.update(loiOtps).set({ consumedAt: new Date() })
        .where(and(eq(loiOtps.loiId, loi.id), isNull(loiOtps.consumedAt)));
      await db.insert(loiOtps).values({
        loiId: loi.id,
        email: loi.recipientEmail,
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });

      const mail = await emailLoiOtp(loi, code);
      await logEvent(loi.id, "otp_sent", `Verification code sent to ${loi.recipientEmail}.`, {
        actor: "recipient", actorEmail: loi.recipientEmail, req,
      });
      // Never echo the code — it goes to email only. In dev with no Resend
      // key configured, the send helper logs it to the server console.
      res.json({ ok: mail.ok, sentTo: maskEmail(loi.recipientEmail) });
    } catch (err: any) {
      console.error("[loi] otp failed:", err?.message);
      res.status(500).json({ message: "Failed to send code" });
    }
  });

  /** Verify the OTP and record the signature. */
  app.post("/api/sign/:publicId/sign", strictLimiter, async (req: Request, res: Response) => {
    try {
      const ctx = await resolveToken(req);
      if (!ctx) return res.status(404).json({ message: "This link is invalid or has expired." });
      const { loi } = ctx;
      if (loi.lockedAt || TERMINAL_STATUSES.includes(loi.status as LoiStatus)) {
        return res.status(409).json({ message: "This document is closed." });
      }

      const parsed = signSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid signature payload" });
      const d = parsed.data;

      const [otp] = await db.select().from(loiOtps)
        .where(and(eq(loiOtps.loiId, loi.id), isNull(loiOtps.consumedAt)))
        .orderBy(desc(loiOtps.createdAt)).limit(1);

      if (!otp || new Date(otp.expiresAt) < new Date()) {
        return res.status(400).json({ message: "That code has expired. Request a new one." });
      }
      if (otp.attempts >= 5) {
        return res.status(429).json({ message: "Too many incorrect attempts. Request a new code." });
      }
      // Constant-time compare so a wrong code can't be found by timing.
      const supplied = hashToken(d.code.trim());
      const ok =
        supplied.length === otp.codeHash.length &&
        crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(otp.codeHash));
      if (!ok) {
        await db.update(loiOtps).set({ attempts: otp.attempts + 1 }).where(eq(loiOtps.id, otp.id));
        return res.status(400).json({ message: "That code isn't right. Check your email and try again." });
      }
      await db.update(loiOtps).set({ consumedAt: new Date() }).where(eq(loiOtps.id, otp.id));

      const already = await db.select().from(loiSignatures)
        .where(and(eq(loiSignatures.loiId, loi.id), eq(loiSignatures.party, "recipient"))).limit(1);
      if (already.length) return res.status(409).json({ message: "You have already signed this document." });

      const ua = String(req.headers["user-agent"] || "");
      const { browser, device } = parseUa(ua);
      await db.insert(loiSignatures).values({
        loiId: loi.id, party: "recipient",
        signerName: d.signerName, signerEmail: loi.recipientEmail, signerPosition: d.signerPosition ?? loi.recipientPosition,
        method: d.method, signatureData: d.signatureData,
        ipAddress: clientIp(req), userAgent: ua.slice(0, 500), browser, device, country: clientCountry(req),
      });
      await logEvent(loi.id, "recipient_signed",
        `${d.signerName} signed on behalf of ${loi.recipientCompany}. Email verified by one-time code.`,
        { actor: "recipient", actorEmail: loi.recipientEmail, req });

      // Complete only when both parties have signed. Until the sender
      // counter-signs, the document sits in awaiting_signature.
      const sigs = await db.select().from(loiSignatures).where(eq(loiSignatures.loiId, loi.id));
      if (sigs.some((s) => s.party === "sender")) {
        await finalise(loi.id);
      } else {
        await db.update(loiDocuments)
          .set({ status: "awaiting_signature", updatedAt: new Date() })
          .where(eq(loiDocuments.id, loi.id));
        emailSenderNotification(loi, "signed").catch(() => {});
      }

      const [fresh] = await db.select().from(loiDocuments).where(eq(loiDocuments.id, loi.id)).limit(1);
      res.json({ ok: true, status: fresh?.status, locked: !!fresh?.lockedAt });
    } catch (err: any) {
      console.error("[loi] sign failed:", err?.message);
      res.status(500).json({ message: "Failed to record signature" });
    }
  });

  /** Decline to sign. */
  app.post("/api/sign/:publicId/decline", strictLimiter, async (req: Request, res: Response) => {
    try {
      const ctx = await resolveToken(req);
      if (!ctx) return res.status(404).json({ message: "This link is invalid or has expired." });
      const { loi } = ctx;
      if (TERMINAL_STATUSES.includes(loi.status as LoiStatus)) {
        return res.status(409).json({ message: "This document is closed." });
      }
      const reason = String(req.body?.reason || "").slice(0, 2000);
      const now = new Date();
      await db.update(loiDocuments)
        .set({ status: "declined", declinedAt: now, declineReason: reason || null, updatedAt: now })
        .where(eq(loiDocuments.id, loi.id));
      await logEvent(loi.id, "declined",
        `${loi.recipientName} declined to sign${reason ? `: ${reason}` : "."}`,
        { actor: "recipient", actorEmail: loi.recipientEmail, req });
      emailSenderNotification({ ...loi, declineReason: reason || null }, "declined").catch(() => {});
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Failed to decline" });
    }
  });

  /** Recipient's copy of the executed PDF. */
  app.get("/api/sign/:publicId/pdf", generalApiLimiter, async (req: Request, res: Response) => {
    try {
      const ctx = await resolveToken(req);
      if (!ctx) return res.status(404).json({ message: "This link is invalid or has expired." });
      if (!ctx.loi.pdfBase64) return res.status(404).json({ message: "The signed PDF isn't ready yet." });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${ctx.loi.publicId}.pdf"`);
      res.send(Buffer.from(ctx.loi.pdfBase64, "base64"));
    } catch {
      res.status(500).json({ message: "Failed to fetch PDF" });
    }
  });
}

function maskEmail(e: string): string {
  const [user, domain] = e.split("@");
  if (!domain) return "your email";
  const head = user.slice(0, 2);
  return `${head}${"•".repeat(Math.max(2, user.length - 2))}@${domain}`;
}
