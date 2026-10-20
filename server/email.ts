/**
 * email.ts — Resend wrapper for transactional sends
 *
 * One source of truth for outbound mail. Reads RESEND_API_KEY from env,
 * supports multiple admin recipients via ADMIN_EMAILS (comma-separated),
 * and falls back to logging when no key is configured (dev mode).
 */
import { Resend } from 'resend';
import { signatureFor, signatureHtml, signOffHtml, type SignOff } from './brand';

const apiKey = (process.env.RESEND_API_KEY || '').trim();
/**
 * The sending identity.
 *
 * It must be a blockfinax.com address. The Resend account is verified for
 * blockfinax.com — DKIM at resend._domainkey, and send.blockfinax.com carrying
 * the SES return path and its own SPF — so a From on that domain aligns and
 * authenticates. Sending as any other domain fails SPF, because no other
 * domain's record authorises Amazon SES on our behalf, and mail that fails SPF
 * lands in spam even when nothing else is wrong with it.
 *
 * This previously read admin@riftfi.xyz, left over from before BlockFinaX had
 * its own Resend account. Besides failing SPF, it meant every message to a
 * customer arrived from a partner's domain — which is what a phishing attempt
 * looks like, on a message asking someone to secure their wallet.
 *
 * The resend.dev fallback is Resend's shared testing domain, used by thousands
 * of projects and filtered accordingly. It exists so local development doesn't
 * crash, and should never be what production resolves to.
 */
const FROM_ADDRESS =
  process.env.SMTP_FROM?.trim() || 'BlockFinaX <hello@blockfinax.com>';

if (process.env.NODE_ENV === 'production' && !/@blockfinax\.com>?\s*$/.test(FROM_ADDRESS)) {
  console.warn(
    `[email] WARNING — sending as "${FROM_ADDRESS}". Only blockfinax.com is authenticated ` +
      `in our Resend account; anything else fails SPF and will be filtered. Set SMTP_FROM.`,
  );
}

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'amschel@blockfinax.com,anthonykumako@blockfinax.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * The canonical host, used for links and for the logo in every email.
 *
 * Defaults to www rather than the apex on purpose. blockfinax.com has no
 * certificate of its own — it serves *.up.railway.app and the handshake fails
 * — so the apex resolves to nothing fetchable. An email whose logo is loaded
 * from there shows a broken image in every client, and the fallback is silent:
 * nothing errors, the mark is simply absent.
 */
const APP_URL = (process.env.PUBLIC_APP_URL || 'https://www.blockfinax.com').replace(/\/$/, '');
const DOCS_URL = (process.env.PUBLIC_DOCS_URL || 'https://docs.blockfinax.com').replace(/\/$/, '');

const resend = apiKey ? new Resend(apiKey) : null;

/**
 * A readable plain-text version of an HTML email.
 *
 * Sending HTML alone is a deliverability cost — filters treat a missing text
 * alternative as a weak signal, and some clients render nothing useful without
 * one. This is not a general HTML-to-text converter; it only has to handle the
 * markup our own templates produce, which is headings, paragraphs, lists,
 * tables and anchors.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    // Keep the destination of a link, which is the whole point of a link.
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) =>
      `${String(label).replace(/<[^>]+>/g, "").trim()} (${href})`)
    .replace(/<li[^>]*>/gi, "\n  - ")
    .replace(/<\/(p|div|tr|h[1-6]|li|ul|ol|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.trim()).join("\n")
    .trim();
}

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  /**
   * Copied recipients.
   *
   * Absent until now, and absent silently: a caller passing cc got an email
   * that reached only the To line, with nothing to say it had dropped half the
   * recipients. That is the wrong way for an unsupported field to behave when
   * the point of the field is a second person seeing the message.
   */
  cc?: string | string[];
  bcc?: string | string[];
  /**
   * Override the sender.
   *
   * A letter written in one person's voice should arrive from that person. The
   * upgrade notice says "Anthony here" and "reply and it comes straight to me";
   * arriving from a Client Services address makes both of those slightly untrue
   * and gives the reader a reason to trust it less. Any blockfinax.com address
   * works — the domain is what is authenticated, not the mailbox.
   */
  from?: string;
  /** Derived from the HTML when not supplied. */
  text?: string;
  replyTo?: string;
  /** Resend attachment shape: base64 content + filename. */
  attachments?: { filename: string; content: string }[];
  /**
   * Extra SMTP headers. Used for List-Unsubscribe, which puts a native
   * unsubscribe control in Gmail and Apple Mail — the one people actually
   * press instead of reporting the message as spam.
   */
  headers?: Record<string, string>;
}

async function sendEmail(args: SendArgs): Promise<{ ok: boolean; error?: string }> {
  const recipients = Array.isArray(args.to) ? args.to : [args.to];
  if (!resend) {
    console.log(`[email:dev] would send to ${recipients.join(', ')} | subject="${args.subject}"`);
    return { ok: true };
  }
  try {
    const { error } = await resend.emails.send({
      from: args.from || FROM_ADDRESS,
      to: recipients,
      ...(args.cc ? { cc: Array.isArray(args.cc) ? args.cc : [args.cc] } : {}),
      ...(args.bcc ? { bcc: Array.isArray(args.bcc) ? args.bcc : [args.bcc] } : {}),
      subject: args.subject,
      html: args.html,
      text: args.text ?? htmlToText(args.html),
      replyTo: args.replyTo,
      attachments: args.attachments,
      headers: args.headers,
    });
    if (error) {
      console.error('[email] Resend error:', error);
      return { ok: false, error: String(error?.message || error) };
    }
    return { ok: true };
  } catch (err: any) {
    console.error('[email] send failed:', err?.message);
    return { ok: false, error: err?.message };
  }
}

// ── Brand-consistent email shell ────────────────────────────────────────
/**
 * The logo is referenced as a hosted PNG rather than embedded. Gmail and
 * Outlook both strip SVG and block data: URIs, so a real URL is the only
 * thing that renders reliably. Clients that block remote images entirely
 * still show the wordmark beside it, so the header never collapses to blank.
 */
function shell(title: string, body: string, opts: { tag?: string; from?: string; signOff?: SignOff } = {}): string {
  const tag = opts.tag ?? 'Private beta';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,Inter,Segoe UI,Helvetica,Arial,sans-serif;background:#f5f7fb;margin:0;padding:32px 16px;color:#0f1a2f;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6eaf2;border-radius:16px;padding:32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:26px;">
      <tr>
        <td style="vertical-align:middle;padding-right:10px;">
          <img src="${APP_URL}/assets/logo-mark.png" width="32" height="32" alt="BlockFinaX"
               style="display:block;width:32px;height:32px;border:0;outline:none;text-decoration:none;" />
        </td>
        <td style="vertical-align:middle;">
          <span style="display:block;font-weight:700;font-size:16px;letter-spacing:-0.02em;color:#0a2540;line-height:1.1;">BlockFinaX</span>
          ${tag ? `<span style="display:block;margin-top:2px;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">${tag}</span>` : ''}
        </td>
      </tr>
    </table>
    ${body}
    ${signOffHtml(opts.signOff)}
    <hr style="border:none;border-top:1px solid #e6eaf2;margin:${opts.signOff && opts.signOff !== 'none' ? '10px' : '28px'} 0 20px;" />
    ${signatureHtml(signatureFor(opts.from ?? FROM_ADDRESS))}
  </div>
</body></html>`;
}

// ── Public templates ────────────────────────────────────────────────────

export async function emailAdminNewAccessRequest(req: {
  name: string;
  email: string;
  country?: string | null;
  role?: string | null;
  company?: string | null;
  useCase?: string | null;
  heardFrom?: string | null;
  socialHandle?: string | null;
  id: number;
}) {
  const rows = [
    ['Name', req.name],
    ['Email', req.email],
    ['Country', req.country],
    ['Role', req.role],
    ['Company / Project', req.company],
    ['Use case', req.useCase],
    ['Heard from', req.heardFrom],
    ['Social', req.socialHandle],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;width:140px;vertical-align:top;">${k}</td><td style="padding:6px 0;color:#0f1a2f;font-size:13px;">${escapeHtml(String(v))}</td></tr>`,
    )
    .join('');

  const body = `
    <h2 style="font-size:18px;margin:0 0 12px;font-weight:600;letter-spacing:-0.01em;">New access request #${req.id}</h2>
    <p style="font-size:13px;color:#5b6577;margin:0 0 16px;">Someone has applied for BlockFinaX private-beta access.</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    <div style="margin-top:24px;">
      <a href="${APP_URL}/admin#access" style="display:inline-block;background:#1a4480;color:#fff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 18px;border-radius:10px;">Review in admin</a>
    </div>
  `;
  return sendEmail({
    to: ADMIN_EMAILS,
    subject: `[BlockFinaX] Access request from ${req.name}`,
    html: shell('New access request', body),
    replyTo: req.email,
  });
}

/** A demo visitor asked to talk to sales about live protection. */
export async function emailAdminSalesRequest(req: {
  id: number;
  name: string;
  email: string;
  company?: string | null;
  country?: string | null;
  role?: string | null;
  exposure?: string | null;
  monthlyVolume?: string | null;
  message?: string | null;
  source?: string | null;
}) {
  const rows = [
    ['Name', req.name],
    ['Email', req.email],
    ['Company', req.company],
    ['Country', req.country],
    ['Interested as', req.role],
    ['Exposure', req.exposure],
    ['Monthly volume', req.monthlyVolume],
    ['Message', req.message],
    ['Asked from', req.source],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;width:140px;vertical-align:top;">${k}</td><td style="padding:6px 0;color:#0f1a2f;font-size:13px;">${escapeHtml(String(v))}</td></tr>`,
    )
    .join('');
  const body = `
    <h2 style="font-size:18px;margin:0 0 12px;font-weight:600;letter-spacing:-0.01em;">Sales request #${req.id}</h2>
    <p style="font-size:13px;color:#5b6577;margin:0 0 16px;">Someone using the demo wants to talk about live protection.</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
  `;
  const to = (process.env.SALES_NOTIFY_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
  return sendEmail({
    to: to.length ? to : ADMIN_EMAILS,
    subject: `[BlockFinaX] Sales request from ${req.name}${req.company ? ` (${req.company})` : ''}`,
    html: shell('Sales request', body),
    replyTo: req.email,
  });
}

export async function emailUserAccessReceived(to: string, name: string) {
  const body = `
    <h2 style="font-size:18px;margin:0 0 12px;font-weight:600;letter-spacing:-0.01em;">We got your request, ${escapeHtml(name.split(' ')[0])}</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">Thanks for applying to the BlockFinaX private beta. The team will review your application within 48 hours and email you the moment you're approved.</p>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;margin-top:16px;">In the meantime, you can read more about how we think about FX cover and emerging-market risk at <a href="${APP_URL}" style="color:#1a4480;">${APP_URL.replace(/^https?:\/\//, '')}</a>.</p>
  `;
  return sendEmail({
    to,
    subject: 'We received your BlockFinaX access request',
    html: shell('Application received', body),
  });
}

export async function emailUserAccessApproved(to: string, name: string, signinToken: string) {
  // Magic link carries the signin token so the recipient can land on /auth
  // and actually see the sign-in surface — the AuthGate hides the Rift
  // widget from any visitor without a valid token. Token is good for 30 days,
  // long enough to sign in across devices before it expires.
  const signinLink = `${APP_URL}/auth?t=${encodeURIComponent(signinToken)}`;
  const body = `
    <h2 style="font-size:18px;margin:0 0 12px;font-weight:600;letter-spacing:-0.01em;">You're approved &mdash; welcome to BlockFinaX</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">Hi ${escapeHtml(name.split(' ')[0])}, your access has been approved. Use the link below to sign in &mdash; it&rsquo;s good for 30 days.</p>
    <div style="margin:22px 0;">
      <a href="${signinLink}" style="display:inline-block;background:#1a4480;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:12px;">Sign in to BlockFinaX</a>
    </div>
    <p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0;">The link is unique to you. Once you&rsquo;ve signed in, your browser will remember the session and you won&rsquo;t need to click it again on that device.</p>
    <p style="font-size:12px;color:#6b7280;line-height:1.5;margin-top:14px;">Reply to this email if you need help getting started, or to share feedback as you explore the product.</p>
  `;
  return sendEmail({
    to,
    subject: "You're approved for BlockFinaX",
    html: shell('Access approved', body),
  });
}

export async function emailUserAccessRejected(to: string, name: string, note?: string) {
  const noteHtml = note
    ? `<p style="font-size:13px;color:#5b6577;line-height:1.5;background:#f5f7fb;border-left:3px solid #d1d5db;padding:10px 14px;border-radius:6px;margin:14px 0;">${escapeHtml(note)}</p>`
    : '';
  const body = `
    <h2 style="font-size:18px;margin:0 0 12px;font-weight:600;letter-spacing:-0.01em;">A note on your application</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">Hi ${escapeHtml(name.split(' ')[0])}, thanks for your interest in BlockFinaX.</p>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;margin-top:14px;">We're not opening access in your segment quite yet, but we're keeping your details on file and will reach out as soon as we expand.</p>
    ${noteHtml}
  `;
  return sendEmail({
    to,
    subject: 'BlockFinaX access — update',
    html: shell('Application update', body),
  });
}

export async function emailDocsToken(to: string, name: string | null, rawToken: string, expiresAt: Date) {
  if (!resend) return { ok: false, error: 'Email delivery is not configured' };
  const exp = expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const tokenQuery = `?t=${encodeURIComponent(rawToken)}`;
  const marketingLink = `${APP_URL}/docs${tokenQuery}`;
  const technicalLink = `${DOCS_URL}/${tokenQuery}`;
  const body = `
    <h2 style="font-size:18px;margin:0 0 12px;font-weight:600;letter-spacing:-0.01em;">Your BlockFinaX docs access</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">${name ? `Hi ${escapeHtml(name.split(' ')[0])}, ` : ''}you have access to both sets of BlockFinaX docs. Pick whichever you want first — the same magic link unlocks them.</p>

    <div style="margin:22px 0 14px;padding:16px;border:1px solid #e6eaf2;border-radius:12px;background:#f9fafb;">
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#1a4480;font-weight:600;margin:0 0 6px;">Strategy &amp; investor docs</p>
      <p style="font-size:13px;color:#0f1a2f;margin:0 0 12px;line-height:1.5;">Whitepaper, pitch deck, data room.</p>
      <a href="${marketingLink}" style="display:inline-block;background:#1a4480;color:#fff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 18px;border-radius:10px;">Open strategy docs</a>
    </div>

    <div style="margin:0 0 22px;padding:16px;border:1px solid #e6eaf2;border-radius:12px;background:#f9fafb;">
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#1a4480;font-weight:600;margin:0 0 6px;">Technical &amp; integrator docs</p>
      <p style="font-size:13px;color:#0f1a2f;margin:0 0 12px;line-height:1.5;">API reference, SDK guides, on-chain ABIs.</p>
      <a href="${technicalLink}" style="display:inline-block;background:#0f1a2f;color:#fff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 18px;border-radius:10px;">Open technical docs</a>
    </div>

    <p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0;">Your link is unique to you and expires on <strong>${exp}</strong>. Each site stores the token in its own browser storage, so click the link from this email on every device you want to read on. If it stops working, reply to this email and we'll issue a new one.</p>
    <p style="font-size:12px;color:#6b7280;line-height:1.5;margin-top:14px;">Please don't share the link — each request is tracked and we revoke tokens that get circulated publicly.</p>
  `;
  return sendEmail({
    to,
    subject: 'Your BlockFinaX docs access',
    html: shell('Docs access', body),
  });
}

export async function emailAdminNewDocsRequest(req: {
  email: string;
  name?: string | null;
  reason?: string | null;
}) {
  const rows = [
    ['Email', req.email],
    ['Name', req.name],
    ['Reason / context', req.reason],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;width:140px;vertical-align:top;">${k}</td><td style="padding:6px 0;color:#0f1a2f;font-size:13px;">${escapeHtml(String(v))}</td></tr>`,
    )
    .join('');
  const body = `
    <h2 style="font-size:18px;margin:0 0 12px;font-weight:600;letter-spacing:-0.01em;">Docs access requested</h2>
    <p style="font-size:13px;color:#5b6577;margin:0 0 16px;">This visitor is waiting for approval. No access link has been sent.</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
  `;
  return sendEmail({
    to: ADMIN_EMAILS,
    subject: `[BlockFinaX] Docs request: ${req.email}`,
    html: shell('Docs request', body + `<p><a href="${APP_URL}/admin#docs">Review document requests</a></p>`),
    replyTo: req.email,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export { ADMIN_EMAILS, APP_URL, DOCS_URL, sendEmail, shell, escapeHtml };
