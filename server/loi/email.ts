/**
 * LOI transactional email.
 *
 * Reuses the branded shell from ../email so agreement mail looks like the
 * rest of the platform's mail. Every send is fire-and-forget at the call
 * site: a failed notification must never roll back a signature that has
 * already been recorded.
 */

import { sendEmail, shell, escapeHtml, APP_URL, ADMIN_EMAILS } from "../email";
import type { LoiDocument } from "@shared/loi-schema";
import { DOC_TYPE_LABELS, type DocType } from "@shared/loi-schema";
import { getSignature, signatureUrl } from "./brand";

function docLabel(loi: LoiDocument): string {
  return DOC_TYPE_LABELS[loi.docType as DocType] ?? "Document";
}

/**
 * Base URL for links in outbound mail.
 *
 * PUBLIC_APP_URL is authoritative when it points somewhere a recipient can
 * actually reach. In local development it usually points at localhost, which
 * would produce a link that only works on the sender's own machine — so we
 * fall back to the origin the admin is currently using, which the route
 * passes in from the request.
 */
function baseUrl(origin?: string): string {
  const configured = APP_URL.replace(/\/$/, "");
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(configured);
  if (isLocal && origin) return origin.replace(/\/$/, "");
  return configured;
}

function signUrl(loi: LoiDocument, token: string, origin?: string): string {
  return `${baseUrl(origin)}/sign/${loi.publicId}?t=${encodeURIComponent(token)}`;
}

function btn(href: string, label: string, dark = false): string {
  const bg = dark ? "#0f1a2f" : "#1a4480";
  return `<a href="${href}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:12px;">${label}</a>`;
}

function metaTable(rows: [string, string | null | undefined][]): string {
  return `<table style="width:100%;border-collapse:collapse;margin:18px 0;">${rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;width:130px;vertical-align:top;">${k}</td><td style="padding:6px 0;color:#0f1a2f;font-size:13px;">${escapeHtml(String(v))}</td></tr>`,
    )
    .join("")}</table>`;
}

function expiryLine(loi: LoiDocument): string {
  if (!loi.expiresAt) return "";
  const d = new Date(loi.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `<p style="font-size:12px;color:#6b7280;line-height:1.5;margin:16px 0 0;">This link is unique to you and expires on <strong>${d}</strong>.</p>`;
}

// ── To the recipient ─────────────────────────────────────────────────────

/**
 * The invitation reads as a short covering letter rather than a notification:
 * a counterparty is being asked to sign something, so it closes with a real
 * signature block the way a letter would.
 */
export async function emailLoiInvitation(loi: LoiDocument, token: string, origin?: string) {
  const label = docLabel(loi);
  const personal = loi.personalMessage?.trim()
    ? `<div style="margin:20px 0;padding:14px 16px;background:#f5f7fb;border-left:3px solid #1a4480;border-radius:8px;">
         <p style="font-size:13px;color:#0f1a2f;line-height:1.6;margin:0;white-space:pre-wrap;">${escapeHtml(loi.personalMessage.trim())}</p>
       </div>`
    : "";

  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">${escapeHtml(loi.senderCompany)} has sent you a ${escapeHtml(label)} to review and sign</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;margin:0;">Dear ${escapeHtml(loi.recipientName.split(" ")[0])}, ${escapeHtml(loi.senderName)}${loi.senderPosition ? ` (${escapeHtml(loi.senderPosition)})` : ""} at ${escapeHtml(loi.senderCompany)} has prepared a ${escapeHtml(label.toLowerCase())} for your review.</p>
    ${personal}
    ${metaTable([
      ["Document", label],
      ["From", `${loi.senderName}, ${loi.senderCompany}`],
      ["Prepared for", `${loi.recipientName}, ${loi.recipientCompany}`],
    ])}
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">You can read it in your browser, leave comments, propose changes, and sign electronically. Nothing to download or print.</p>
    <div style="margin:24px 0;">${btn(signUrl(loi, token, origin), `Review ${label}`)}</div>
    ${expiryLine(loi)}
    ${await signOff(loi, origin)}
  `;
  return sendEmail({
    to: loi.recipientEmail,
    subject: `${loi.senderCompany} sent you a ${label} to sign`,
    html: shell(`${label} for review`, body, { tag: "" }),
    replyTo: loi.senderEmail,
  });
}

/**
 * Letter-style sign-off with the uploaded signature image.
 *
 * The image is fetched by URL, so a client with remote images turned off
 * shows nothing where it sits — the printed name and title below it carry the
 * block on their own, which is why they are always rendered.
 */
async function signOff(loi: LoiDocument, origin?: string): Promise<string> {
  let img = "";
  try {
    const sig = await getSignature();
    if (sig) {
      img = `<img src="${signatureUrl(origin)}" alt="" height="46"
                  style="display:block;height:46px;width:auto;border:0;outline:none;margin-bottom:2px;" />`;
    }
  } catch {
    // A missing signature must never stop the invitation going out.
  }
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:30px;">
      <tr><td>
        <p style="font-size:13px;color:#0f1a2f;margin:0 0 8px;">Kind regards,</p>
        ${img}
        <p style="font-size:13px;font-weight:600;color:#0f1a2f;margin:0;">${escapeHtml(loi.senderName)}</p>
        ${loi.senderPosition ? `<p style="font-size:12px;color:#6b7280;margin:2px 0 0;">${escapeHtml(loi.senderPosition)}, ${escapeHtml(loi.senderCompany)}</p>` : `<p style="font-size:12px;color:#6b7280;margin:2px 0 0;">${escapeHtml(loi.senderCompany)}</p>`}
        <p style="font-size:12px;color:#6b7280;margin:2px 0 0;"><a href="mailto:${escapeHtml(loi.senderEmail)}" style="color:#1a4480;text-decoration:none;">${escapeHtml(loi.senderEmail)}</a></p>
      </td></tr>
    </table>`;
}

export async function emailLoiOtp(loi: LoiDocument, code: string) {
  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">Your signing verification code</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">Enter this code to confirm your identity and complete your signature on the ${escapeHtml(docLabel(loi))} from ${escapeHtml(loi.senderCompany)}.</p>
    <div style="margin:24px 0;padding:20px;background:#f5f7fb;border:1px solid #e6eaf2;border-radius:12px;text-align:center;">
      <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:0.24em;color:#1a4480;">${escapeHtml(code)}</span>
    </div>
    <p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0;">This code expires in 10 minutes and can only be used once. If you didn't request it, you can safely ignore this email — no signature will be recorded without it.</p>
  `;
  return sendEmail({
    to: loi.recipientEmail,
    subject: `${code} is your BlockFinaX signing code`,
    html: shell("Signing verification code", body),
  });
}

export async function emailLoiExpiryReminder(loi: LoiDocument, token: string, daysLeft: number, origin?: string) {
  const label = docLabel(loi);
  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">Reminder: your ${escapeHtml(label)} expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">Hi ${escapeHtml(loi.recipientName.split(" ")[0])}, the ${escapeHtml(label.toLowerCase())} from ${escapeHtml(loi.senderCompany)} is still awaiting your signature.</p>
    <div style="margin:24px 0;">${btn(signUrl(loi, token, origin), `Review and sign`)}</div>
    ${expiryLine(loi)}
    ${await signOff(loi, origin)}
  `;
  return sendEmail({
    to: loi.recipientEmail,
    subject: `Reminder: ${label} from ${loi.senderCompany} expires soon`,
    html: shell("Signature reminder", body, { tag: "" }),
    replyTo: loi.senderEmail,
  });
}

export async function emailLoiRevisionAvailable(loi: LoiDocument, token: string, origin?: string) {
  const label = docLabel(loi);
  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">A new revision is ready for you</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">${escapeHtml(loi.senderName)} has updated the ${escapeHtml(label.toLowerCase())} following your comments. Your previous link still works.</p>
    <div style="margin:24px 0;">${btn(signUrl(loi, token, origin), "Review the changes")}</div>
    ${await signOff(loi, origin)}
  `;
  return sendEmail({
    to: loi.recipientEmail,
    subject: `Updated: ${label} from ${loi.senderCompany}`,
    html: shell("New revision", body, { tag: "" }),
    replyTo: loi.senderEmail,
  });
}

// ── To the sender ────────────────────────────────────────────────────────

type SenderEventKind = "viewed" | "changes_requested" | "approved" | "signed" | "declined" | "expired";

const SENDER_COPY: Record<SenderEventKind, { subject: (l: LoiDocument, d: string) => string; heading: string; line: (l: LoiDocument) => string }> = {
  viewed: {
    subject: (l, d) => `${l.recipientName} opened your ${d}`,
    heading: "Your document was opened",
    line: (l) => `${l.recipientName} at ${l.recipientCompany} has opened the document for the first time.`,
  },
  changes_requested: {
    subject: (l, d) => `${l.recipientName} requested changes to your ${d}`,
    heading: "Changes requested",
    line: (l) => `${l.recipientName} at ${l.recipientCompany} has left comments or proposed edits. Review them and send a revision.`,
  },
  approved: {
    subject: (l, d) => `${l.recipientName} approved your ${d}`,
    heading: "Document approved",
    line: (l) => `${l.recipientName} at ${l.recipientCompany} has approved the document and is ready to sign.`,
  },
  signed: {
    subject: (l, d) => `${l.recipientName} signed your ${d}`,
    heading: "Fully signed",
    line: (l) => `${l.recipientName} at ${l.recipientCompany} has signed. The executed PDF is attached and stored on the platform.`,
  },
  declined: {
    subject: (l, d) => `${l.recipientName} declined your ${d}`,
    heading: "Document declined",
    line: (l) => `${l.recipientName} at ${l.recipientCompany} has declined to sign${l.declineReason ? `: "${l.declineReason}"` : "."}`,
  },
  expired: {
    subject: (l, d) => `Your ${d} to ${l.recipientCompany} expired`,
    heading: "Document expired",
    line: (l) => `The signing link for ${l.recipientName} at ${l.recipientCompany} has expired without a signature. You can duplicate the document and resend it.`,
  },
};

export async function emailSenderNotification(loi: LoiDocument, kind: SenderEventKind) {
  const label = docLabel(loi);
  const copy = SENDER_COPY[kind];
  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">${copy.heading}</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">${escapeHtml(copy.line(loi))}</p>
    ${metaTable([
      ["Document", label],
      ["Counterparty", `${loi.recipientName}, ${loi.recipientCompany}`],
      ["Reference", loi.publicId],
    ])}
    <div style="margin:24px 0;">${btn(`${APP_URL}/admin#agreements`, "Open in admin", true)}</div>
  `;
  // The sender's own address plus the admin group, so nothing is missed when
  // the named sender is out of office.
  const to = Array.from(new Set([loi.senderEmail, ...ADMIN_EMAILS]));
  return sendEmail({
    to,
    subject: `[BlockFinaX] ${copy.subject(loi, label)}`,
    html: shell(copy.heading, body),
  });
}

// ── Final executed copy, to everyone ─────────────────────────────────────

export async function emailSignedCopy(loi: LoiDocument, pdfBase64: string) {
  const label = docLabel(loi);
  const filename = `${label.replace(/\s+/g, "-")}-${loi.publicId}.pdf`;
  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">Your ${escapeHtml(label)} is fully signed</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">The ${escapeHtml(label.toLowerCase())} between <strong>${escapeHtml(loi.senderCompany)}</strong> and <strong>${escapeHtml(loi.recipientCompany)}</strong> has been signed by all parties. The executed copy is attached to this email.</p>
    ${metaTable([
      ["Reference", loi.publicId],
      ["Completed", loi.signedAt ? new Date(loi.signedAt).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC" : null],
    ])}
    <p style="font-size:13px;color:#0f1a2f;line-height:1.55;">The attached PDF includes the final document, both signature blocks, and a certificate of completion recording the full audit trail — timestamps, IP addresses, and email verification for each signer.</p>
    <p style="font-size:12px;color:#6b7280;line-height:1.5;margin-top:16px;">Keep this email for your records. BlockFinaX also stores the original against reference <strong>${escapeHtml(loi.publicId)}</strong>.</p>
  `;
  const to = Array.from(new Set([loi.recipientEmail, loi.senderEmail, ...ADMIN_EMAILS]));
  return sendEmail({
    to,
    subject: `Signed: ${label} — ${loi.senderCompany} & ${loi.recipientCompany}`,
    html: shell("Fully signed", body),
    attachments: [{ filename, content: pdfBase64 }],
  });
}
