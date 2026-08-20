/**
 * send.ts, putting a cold email on the wire without damaging the domain that
 * carries the product.
 *
 * ## The failure nobody notices until it is expensive
 *
 * blockfinax.com sends magic links, wallet notices and support mail through
 * Resend. Those are the messages a customer must receive to use the product at
 * all. Cold outreach is judged by recipients who did not ask for it, and a few
 * spam complaints per thousand is normal even for a good campaign. Send both
 * from the same domain and the complaints attach to the reputation the login
 * emails depend on.
 *
 * The result is not a bounce or an error. Magic links simply start landing in
 * spam, customers report that login is broken, and nothing in the logs connects
 * that to a marketing send from three weeks earlier. Recovering a burned
 * sending domain takes months.
 *
 * So this refuses to send from the transactional domain. It is not advice in a
 * comment; the function returns an error and no mail leaves. A separate
 * subdomain, verified in Resend, keeps the two reputations apart, which is the
 * standard arrangement and costs one DNS record.
 *
 * ## Why a postal address is required
 *
 * A commercial email must carry the sender's physical address under CAN-SPAM,
 * and in substance under Ghana's Data Protection Act and the GDPR's
 * identification duties. This mirrors the rule already enforced for consented
 * follow-ups in server/leads/follow-up.ts: without the address configured,
 * nothing sends. A defective message to a real prospect is worse than none.
 */

import { Resend } from "resend";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { prospects, emailSuppressions } from "@shared/prospect-schema";

const APP_URL = (process.env.PUBLIC_APP_URL || "https://www.blockfinax.com").replace(/\/$/, "");

/** The domain that must never be used for cold mail, because logins depend on it. */
function transactionalDomain(): string {
  const from = process.env.SMTP_FROM || "hello@blockfinax.com";
  const m = from.match(/@([^\s>]+)/);
  return (m?.[1] || "blockfinax.com").toLowerCase();
}

export interface SendGuard {
  ok: boolean;
  reason?: string;
  from?: string;
}

/**
 * Is outbound sending configured safely?
 *
 * Checked before a campaign rather than per message, so the console can say
 * plainly what is missing instead of failing one row at a time.
 */
export function checkSendConfig(): SendGuard {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, reason: "RESEND_API_KEY is not set." };
  }
  const from = (process.env.OUTREACH_FROM || "").trim();
  if (!from) {
    return {
      ok: false,
      reason:
        "OUTREACH_FROM is not set. Cold email needs its own verified sending domain, " +
        "separate from the one that sends magic links, so complaints cannot damage login delivery. " +
        'Verify a subdomain in Resend and set something like "BlockFinaX <anthony@outreach.blockfinax.com>".',
    };
  }
  const domain = (from.match(/@([^\s>]+)/)?.[1] || "").toLowerCase();
  if (!domain) return { ok: false, reason: `OUTREACH_FROM is not a usable address: ${from}` };

  if (domain === transactionalDomain()) {
    return {
      ok: false,
      reason:
        `OUTREACH_FROM uses ${domain}, the same domain that sends your magic links. ` +
        `Cold email complaints would attach to the reputation your customer logins depend on, ` +
        `and the symptom is logins landing in spam weeks later with nothing in the logs to explain it. ` +
        `Use a separate subdomain such as outreach.${domain}.`,
    };
  }
  if (!process.env.COMPANY_POSTAL_ADDRESS?.trim()) {
    return {
      ok: false,
      reason:
        "COMPANY_POSTAL_ADDRESS is not set. A commercial email must carry a physical postal address, " +
        "and sending one without is unlawful in the plainest way available.",
    };
  }
  return { ok: true, from };
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
  const guard = checkSendConfig();
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
    const { data, error } = await resend.emails.send({
      from: guard.from!,
      to: p.email,
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
