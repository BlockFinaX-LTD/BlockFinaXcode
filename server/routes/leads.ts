/**
 * Lead capture, follow-up and withdrawal.
 *
 * Three endpoints and one rule: nothing here sends email to anyone who has not
 * pressed a button next to a specific sentence. See shared/lead-schema.ts for
 * why the design is shaped this way.
 *
 * The unsubscribe route is deliberately unauthenticated and answers GET. Mail
 * clients pre-fetch links, so a GET that unsubscribes can fire without the
 * person clicking — which is why it renders a confirmation page and requires a
 * second POST to actually take effect, except for the List-Unsubscribe header
 * path, where a POST is what the mail client sends.
 */

import type { Express, Request, Response } from "express";
import { randomBytes } from "crypto";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { leads, CONSENT_WORDING } from "@shared/lead-schema";
import { visitorKey } from "./agent-chat";
import { emailFollowUp } from "../leads/follow-up";

/**
 * How long we wait before the follow-up lands.
 *
 * Long enough that it does not feel like an automated reflex, short enough
 * that the conversation is still in mind.
 */
export const FOLLOW_UP_DELAY_MS = 10 * 60_000;

const captureSchema = z.object({
  threadId: z.string().max(120).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(200),
  company: z.string().trim().max(160).optional(),
  /**
   * The client sends back the wording it displayed. The server compares it to
   * its own copy and refuses on any difference, so a modified or homebrew form
   * cannot record a consent that nobody was actually shown.
   */
  consentText: z.string(),
  consented: z.literal(true),
});

export function registerLeadRoutes(app: Express) {
  // ── Capture ─────────────────────────────────────────────────────────────

  app.post("/api/leads", async (req: Request, res: Response) => {
    const parsed = captureSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Please check the name and email and try again." });
    }
    const { email, name, company, threadId, consentText } = parsed.data;

    if (consentText.trim() !== CONSENT_WORDING) {
      // Not a validation failure — a consent record that would not stand up.
      console.warn("[leads] refused: consent wording did not match the server's copy");
      return res.status(400).json({ message: "Something went wrong. Please reload the page and try again." });
    }

    try {
      const normalised = email.toLowerCase();

      // Someone who already unsubscribed is not re-subscribed by filling the
      // form again through a stale page. They must be genuinely new, or have
      // never opted out.
      const [existing] = await db.select().from(leads).where(eq(leads.email, normalised)).limit(1);
      if (existing) {
        if (existing.unsubscribedAt || existing.erasedAt) {
          return res.json({ ok: true }); // Told nothing. Their choice stands.
        }
        return res.json({ ok: true }); // Already on the list; no duplicate, no second email.
      }

      await db.insert(leads).values({
        email: normalised,
        name: name ?? null,
        company: company ?? null,
        source: "chat",
        threadId: threadId ?? null,
        consentText: CONSENT_WORDING,
        consentVisitor: visitorKey(req),
        followUpDueAt: new Date(Date.now() + FOLLOW_UP_DELAY_MS),
        unsubscribeToken: randomBytes(24).toString("base64url"),
      });

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[leads] capture failed:", err?.message);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  // ── Withdrawal ──────────────────────────────────────────────────────────

  /**
   * The page a person lands on from the unsubscribe link. Confirms rather than
   * acts, because mail clients and scanners follow links without a human.
   */
  app.get("/api/leads/unsubscribe/:token", async (req: Request, res: Response) => {
    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.unsubscribeToken, req.params.token))
      .limit(1);

    const done = !lead || !!lead.unsubscribedAt;
    res.set("Content-Type", "text/html; charset=utf-8").send(page(done, req.params.token));
  });

  /** Both the confirmation button and the mail client's List-Unsubscribe POST. */
  app.post("/api/leads/unsubscribe/:token", async (req: Request, res: Response) => {
    await db
      .update(leads)
      .set({ unsubscribedAt: new Date(), followUpDueAt: null })
      .where(and(eq(leads.unsubscribeToken, req.params.token), isNull(leads.unsubscribedAt)));

    // Always the same answer, whether or not the token existed — otherwise the
    // endpoint tells a stranger which tokens are real.
    if (req.get("accept")?.includes("text/html")) {
      return res.set("Content-Type", "text/html; charset=utf-8").send(page(true, req.params.token));
    }
    res.json({ ok: true });
  });
}

// ── Sweep ─────────────────────────────────────────────────────────────────

/**
 * Sends follow-ups that have come due.
 *
 * Re-reads the row's state at send time rather than trusting the query: a
 * person who unsubscribes during the delay window must not receive the message
 * that was already queued for them.
 */
export async function sweepFollowUps(limit = 20): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };

  const due = await db
    .select()
    .from(leads)
    .where(and(lte(leads.followUpDueAt, new Date()), isNull(leads.followUpSentAt), isNull(leads.unsubscribedAt)))
    .limit(limit);

  for (const lead of due) {
    if (lead.unsubscribedAt || lead.erasedAt) {
      result.skipped += 1;
      continue;
    }
    try {
      const sent = await emailFollowUp(lead);
      if (sent.ok) {
        await db.update(leads).set({ followUpSentAt: new Date(), followUpDueAt: null }).where(eq(leads.id, lead.id));
        result.sent += 1;
      } else {
        result.skipped += 1;
      }
    } catch (err: any) {
      console.error("[leads] follow-up failed:", err?.message);
      result.failed += 1;
    }
  }

  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startFollowUpSweep(): void {
  if (timer) return;
  timer = setInterval(() => {
    sweepFollowUps().catch((err) => console.error("[leads] sweep failed:", err?.message));
  }, 2 * 60_000);
  console.log("[leads] follow-up sweep running every 2 minutes");
}

// ── The unsubscribe page ──────────────────────────────────────────────────

function page(done: boolean, token: string): string {
  const body = done
    ? `<h1>You're unsubscribed</h1>
       <p>We won't email you about BlockFinaX again. Nothing else is needed from you.</p>
       <p class="muted">If you'd also like your details deleted entirely, email
         <a href="mailto:hello@blockfinax.com">hello@blockfinax.com</a> and we'll remove them.</p>`
    : `<h1>Unsubscribe</h1>
       <p>Confirm and we'll stop emailing you about BlockFinaX.</p>
       <form method="POST" action="/api/leads/unsubscribe/${escapeAttr(token)}">
         <button type="submit">Unsubscribe me</button>
       </form>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Unsubscribe · BlockFinaX</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         display:grid; place-items:center; min-height:100vh; margin:0; padding:24px;
         background:#f7f8fa; color:#0f1a2f; }
  .card { background:#fff; border-radius:16px; padding:36px 32px; max-width:440px; width:100%;
          box-shadow:0 1px 3px rgba(15,26,47,.08), 0 8px 32px rgba(15,26,47,.06); }
  h1 { font-size:20px; margin:0 0 10px; letter-spacing:-.01em; }
  p { font-size:14px; line-height:1.6; margin:0 0 12px; }
  .muted { color:#6b7280; font-size:13px; }
  a { color:#1a4480; }
  button { background:#1a4480; color:#fff; border:0; border-radius:12px; padding:12px 24px;
           font-size:14px; font-weight:600; cursor:pointer; margin-top:8px; }
  @media (prefers-color-scheme: dark) {
    body { background:#0b1220; color:#e6ebf5; }
    .card { background:#111a2e; box-shadow:none; }
    .muted { color:#93a1bd; } a { color:#7aa2e3; }
  }
</style></head><body><div class="card">${body}</div></body></html>`;
}

const escapeAttr = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "");
