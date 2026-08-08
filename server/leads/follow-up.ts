/**
 * The follow-up message.
 *
 * ## Why this file refuses to send when an address is missing
 *
 * A commercial email must carry the sender's physical postal address. This is
 * not a stylistic nicety: it is an explicit requirement of the US CAN-SPAM Act
 * and, in substance, of Ghana's Data Protection Act and the GDPR's
 * identification duties. An email without one is unlawful in the plainest and
 * most easily proven way available.
 *
 * So if COMPANY_POSTAL_ADDRESS is not configured, nothing is sent. Sending a
 * defective message to a real prospect is worse than sending nothing, and a
 * silent placeholder like "Address on file" would be a lie printed under the
 * company's name. The sweep logs it loudly and leaves the row due, so it goes
 * out the moment the value is set.
 *
 * ## What the message says, and does not say
 *
 * It reminds the person that they asked for it, on the day they asked. That is
 * both the legal basis and the thing that stops it reading as spam — someone
 * who does not remember agreeing will report it, and one spam complaint costs
 * more deliverability than the lead was worth.
 *
 * It does not pretend to be personal correspondence. It does not chase, and
 * there is exactly one of them: there is no sequence, no drip, no second
 * message if they do not reply. A second unrequested email is a separate
 * decision that nobody has consented to.
 */

import { sendEmail, shell, escapeHtml, APP_URL } from "../email";
import type { Lead } from "@shared/lead-schema";
import { isContactable } from "@shared/lead-schema";

/**
 * BlockFinaX Inc.'s registered postal address, for the footer.
 *
 * Set COMPANY_POSTAL_ADDRESS in the environment, e.g.
 *   COMPANY_POSTAL_ADDRESS="BlockFinaX Inc., 1007 N Orange St, 4th Floor #5543, Wilmington, DE 19801, USA"
 */
const POSTAL_ADDRESS = (process.env.COMPANY_POSTAL_ADDRESS || "").trim();

export function followUpConfigured(): boolean {
  return POSTAL_ADDRESS.length > 0;
}

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : "recently";

export async function emailFollowUp(lead: Lead): Promise<{ ok: boolean; error?: string }> {
  // Belt and braces. The sweep checks this too, but this function is the last
  // thing between a withdrawn consent and a sent message.
  if (!isContactable(lead)) {
    return { ok: false, error: "unsubscribed" };
  }

  if (!followUpConfigured()) {
    console.error(
      "[leads] NOT SENDING follow-up: COMPANY_POSTAL_ADDRESS is not set. " +
        "A commercial email must carry a physical postal address. Set it and these will go out automatically.",
    );
    return { ok: false, error: "no-postal-address" };
  }

  const unsubscribeUrl = `${APP_URL}/api/leads/unsubscribe/${lead.unsubscribeToken}`;
  const firstName = (lead.name || "").trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";

  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">Thanks for looking around</h2>

    <p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0 0 14px;">
      ${greeting} you were on the BlockFinaX site on ${escapeHtml(fmtDate(lead.consentedAt))} and asked us to
      get in touch. Here's the short version of what we do.
    </p>

    <p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0 0 14px;">
      Businesses that earn in one currency and pay suppliers in another carry the risk of the rate moving
      between the invoice and the payment. Banks generally won't sell forward cover at the sizes most
      importers need, and in many African currency pairs the market simply doesn't exist. BlockFinaX
      lets you buy that cover directly, sized to the invoice, without a credit line.
    </p>

    <p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0 0 6px;">There are two ways in:</p>
    <ul style="font-size:14px;color:#0f1a2f;line-height:1.7;margin:0 0 18px;padding-left:20px;">
      <li><strong>Buy cover</strong> if a currency move would cost you money.</li>
      <li><strong>Underwrite</strong> if you have capital to put behind it and want the premium.</li>
    </ul>

    <div style="margin:24px 0;">
      <a href="${APP_URL}" style="display:inline-block;background:#1a4480;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:12px;">Create an account</a>
    </div>

    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0;">
      Questions are welcome — just reply to this message and a person will answer.
    </p>

    <hr style="border:0;border-top:1px solid #e5e7eb;margin:26px 0 14px;"/>

    <p style="font-size:11px;color:#6b7280;line-height:1.6;margin:0;">
      You're receiving this because you gave us your email on the BlockFinaX website on
      ${escapeHtml(fmtDate(lead.consentedAt))} and asked to hear from us. This is the only message we'll send
      unless you get in touch.<br/>
      <a href="${unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a> ·
      <a href="${APP_URL}/privacy" style="color:#6b7280;">Privacy policy</a><br/>
      ${escapeHtml(POSTAL_ADDRESS)}
    </p>`;

  return sendEmail({
    to: lead.email,
    subject: "About BlockFinaX — as requested",
    html: shell("BlockFinaX", body, { tag: "" }),
    replyTo: "hello@blockfinax.com",
    headers: {
      // Puts a native unsubscribe control in Gmail and Apple Mail. People press
      // it instead of the spam button, which protects the sending domain.
      "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:hello@blockfinax.com?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}
