/**
 * send.ts, putting a cold email on the wire.
 *
 * ## Sending from the main domain, and what that means
 *
 * Cold outreach goes out as anthonykumako@blockfinax.com on the Resend account
 * that already sends magic links. Anthony chose that over a separate subdomain,
 * and with the domain already verified it works immediately.
 *
 * The exposure is real and worth stating once: complaints attach to a domain,
 * not to a campaign, and blockfinax.com is the domain customer logins arrive
 * on. If cold mail draws complaints, magic links are what starts landing in
 * spam, and the symptom appears weeks later with nothing in the logs to connect
 * it.
 *
 * So the protection moved rather than disappeared. A subdomain would have
 * contained the damage after it happened; what actually prevents it is noticing
 * fast and stopping. This module tracks bounces and complaints from Resend's
 * webhook and halts sending automatically when either crosses the threshold
 * mailbox providers judge on. Continuing to send after complaints start is what
 * turns a bad week into a burned domain, and that is now impossible rather than
 * merely discouraged.
 *
 * ## Why a postal address is still required
 *
 * A commercial email must carry the sender's physical address under CAN-SPAM,
 * and in substance under Ghana's Data Protection Act and the GDPR's
 * identification duties. The same rule is already enforced for consented
 * follow-ups in server/leads/follow-up.ts: without it configured, nothing
 * sends, because a defective message to a real prospect is worse than none.
 */

import { Resend } from "resend";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { prospects, emailSuppressions } from "@shared/prospect-schema";
import { sendingHealth } from "./health";

const APP_URL = (process.env.PUBLIC_APP_URL || "https://www.blockfinax.com").replace(/\/$/, "");

/** The domain the transactional mail goes out on. */
function transactionalDomain(): string {
  const from = process.env.SMTP_FROM || "hello@blockfinax.com";
  const m = from.match(/@([^\s>]+)/);
  return (m?.[1] || "blockfinax.com").toLowerCase();
}

export interface SendGuard {
  ok: boolean;
  reason?: string;
  /** Non-blocking. Something worth knowing that does not stop the send. */
  warning?: string;
  from?: string;
  /** Where a blind copy goes, so the console can say whether one is being kept. */
  bcc?: string;
  /** Where replies land. */
  replyTo?: string;
}

/**
 * The sending identity.
 *
 * Defaults to Anthony's own address on the verified domain, so the pipeline
 * works with the infrastructure already in place and no new DNS. A real name
 * also outperforms a role address on cold mail, which is the one thing that
 * genuinely improves both response and complaint rates.
 */
/**
 * A blind copy of everything sent, so there is a record in a human inbox.
 *
 * Mail sent through Resend never touches Gmail, so it does not appear in a Sent
 * folder and there is nothing to search for. The provider dashboard has it, but
 * that is a place you have to remember to go and it is not where replies will
 * arrive.
 *
 * Blind rather than copied: a visible CC to a personal address tells the
 * recipient the founder is watching a mailbox he is not writing from, which
 * reads oddly on a first contact and is nobody's business but ours.
 *
 * Worth knowing at volume. A blind copy of two hundred a day is two hundred
 * messages a day, so this is a verification tool for the early period rather
 * than something to leave on forever. Unset it once the console is trusted.
 */
function outreachBcc(): string | undefined {
  const v = (process.env.OUTREACH_BCC || "").trim();
  return v || undefined;
}

/**
 * Where a reply should land.
 *
 * Without this, a reply goes to whatever address the mail was sent from, which
 * is only correct if somebody reads that mailbox. Set it to the inbox actually
 * being watched, and the recipient sees nothing unusual: Reply-To is ordinary
 * and every mail client honours it silently.
 */
function outreachReplyTo(): string | undefined {
  const v = (process.env.OUTREACH_REPLY_TO || "").trim();
  return v || undefined;
}

function outreachFrom(): string {
  const configured = (process.env.OUTREACH_FROM || "").trim();
  if (configured) return configured;
  return `Anthony Kumako <anthonykumako@${transactionalDomain()}>`;
}

/**
 * Is outbound sending configured, and is it safe to continue right now?
 *
 * Two different questions. Configuration is static. Health is not: a campaign
 * that was fine yesterday can be doing damage today, and the check that matters
 * is the second one.
 */
export async function checkSendConfig(): Promise<SendGuard> {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, reason: "RESEND_API_KEY is not set." };
  }
  if (!process.env.COMPANY_POSTAL_ADDRESS?.trim()) {
    return {
      ok: false,
      reason:
        "COMPANY_POSTAL_ADDRESS is not set. A commercial email must carry a physical postal " +
        "address, and sending one without is unlawful in the plainest way available.",
    };
  }

  const from = outreachFrom();
  const domain = (from.match(/@([^\s>]+)/)?.[1] || "").toLowerCase();
  if (!domain) return { ok: false, reason: `OUTREACH_FROM is not a usable address: ${from}` };

  // The circuit breaker. This is the check that stops a bad campaign becoming a
  // burned domain, and it is deliberately a refusal rather than a warning.
  const health = await sendingHealth();
  if (health.halted) {
    return { ok: false, reason: health.reason || "Sending is halted." };
  }

  const warning =
    domain === transactionalDomain()
      ? `Sending as ${from}, the same domain as your magic links. Complaints attach to the domain, ` +
        `so watch the bounce and complaint rates below. Sending halts automatically if either crosses ` +
        `the level mailbox providers act on.`
      : undefined;

  return { ok: true, from, warning, bcc: outreachBcc(), replyTo: outreachReplyTo() };
}

/** Has this address asked never to be contacted? */
export async function isSuppressed(email: string): Promise<boolean> {
  try {
    const [row] = await db.select().from(emailSuppressions)
      .where(eq(emailSuppressions.email, email.trim().toLowerCase())).limit(1);
    return !!row;
  } catch {
    // Fail closed. An unreachable suppression list is not permission to email
    // someone who may have opted out.
    return true;
  }
}

export async function suppress(email: string, reason: string, note?: string): Promise<void> {
  await db.insert(emailSuppressions)
    .values({ email: email.trim().toLowerCase(), reason, note: note ?? null })
    .onConflictDoNothing({ target: emailSuppressions.email });
}

function wrap(bodyText: string, unsubscribeUrl: string): string {
  const postal = (process.env.COMPANY_POSTAL_ADDRESS || "").trim();
  const paras = bodyText.trim().split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#0f172a;max-width:560px">
${paras}
<hr style="border:0;border-top:1px solid #e2e8f0;margin:22px 0 12px">
<p style="margin:0;font-size:12px;color:#64748b;line-height:1.5">
You received this because BlockFinaX believes your business handles cross-border payments.
<a href="${unsubscribeUrl}" style="color:#64748b">Unsubscribe</a> and we will not write again.<br>
${postal}
</p>
</div>`;
}

export interface SendOutcome {
  ok: boolean;
  messageId?: string;
  error?: string;
  suppressed?: boolean;
}

/**
 * Send one approved prospect email.
 *
 * One at a time and only when approved. Nothing here can send a message a
 * person has not read, which is the only real protection against a model
 * writing something embarrassing to ten thousand strangers at once.
 */
export async function sendProspectEmail(id: number): Promise<SendOutcome> {
  const guard = await checkSendConfig();
  if (!guard.ok) return { ok: false, error: guard.reason };

  const [p] = await db.select().from(prospects).where(eq(prospects.id, id)).limit(1);
  if (!p) return { ok: false, error: "not found" };
  if (!p.approvedAt) return { ok: false, error: "Not approved. A person has to read it first." };
  if (p.sentAt) return { ok: false, error: "Already sent." };
  if (!p.sendable) return { ok: false, error: p.sendableReason || "This address is not sendable." };
  if (p.unsubscribedAt) return { ok: false, error: "They unsubscribed." };
  if (!p.draftSubject || !p.draftBody) return { ok: false, error: "Nothing drafted yet." };

  if (await isSuppressed(p.email)) {
    await db.update(prospects).set({ status: "rejected", notes: "On the suppression list." })
      .where(eq(prospects.id, id));
    return { ok: false, suppressed: true, error: "That address is on the suppression list." };
  }

  const unsubscribeUrl = `${APP_URL}/api/prospects/unsubscribe/${p.unsubscribeToken}`;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY!);
    const bcc = outreachBcc();
    const replyTo = outreachReplyTo();

    const { data, error } = await resend.emails.send({
      from: guard.from!,
      to: p.email,
      ...(bcc ? { bcc } : {}),
      ...(replyTo ? { replyTo } : {}),
      subject: p.draftSubject,
      html: wrap(p.draftBody, unsubscribeUrl),
      text: `${p.draftBody.trim()}\n\n---\nUnsubscribe: ${unsubscribeUrl}\n${process.env.COMPANY_POSTAL_ADDRESS || ""}`,
      // One-click unsubscribe. Gmail and Yahoo require this for bulk senders,
      // and it is the difference between someone opting out and reporting spam.
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (error) return { ok: false, error: error.message || "Resend refused it." };

    await db.update(prospects).set({
      status: "sent",
      sentAt: new Date(),
      providerMessageId: data?.id ?? null,
      updatedAt: new Date(),
    }).where(eq(prospects.id, id));

    return { ok: true, messageId: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

/** How many have gone out today, for the daily cap. */
export async function sentToday(): Promise<number> {
  try {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(prospects)
      .where(sql`${prospects.sentAt} >= date_trunc('day', now())`);
    return Number(row?.n) || 0;
  } catch {
    return 0;
  }
}

/**
 * A daily ceiling.
 *
 * New sending domains are judged on volume ramp as much as on content. Ten
 * thousand messages on day one from a domain with no history is the single
 * clearest spam signal there is, and it burns the subdomain before the campaign
 * has told anyone anything. Warming up over weeks is slower and is the
 * difference between arriving and being filtered.
 */
export const DAILY_SEND_CAP = Number(process.env.OUTREACH_DAILY_CAP || 200);
