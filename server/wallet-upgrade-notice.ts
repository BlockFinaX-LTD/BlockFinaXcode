/**
 * The wallet security upgrade notice.
 *
 * ## Why this doesn't need marketing consent
 *
 * This is a service message about a change to an account the recipient already
 * holds — the same category as a password-reset or a terms update. It is not
 * covered by the opt-in machinery in shared/lead-schema.ts, which exists for
 * unsolicited commercial mail to people who are not customers. Telling someone
 * their wallet's security model is changing is closer to an obligation than a
 * marketing choice, so there is no unsubscribe link: there is nothing here to
 * unsubscribe from.
 *
 * ## What it deliberately does not say
 *
 * It does not claim the old arrangement was unsafe. It wasn't — it was a
 * password, which is how most of the internet works. Alarming a customer into
 * acting is a tactic that spends trust to buy a click, and the honest version
 * reads better anyway: this is an improvement, nothing is broken, and nothing
 * breaks if you ignore it.
 *
 * It also does not promise the upgrade is available to them yet. The rollout is
 * gated (see client/src/lib/rift-v3.ts), so send() takes an explicit recipient
 * list and the caller is responsible for matching it to who can actually act.
 */

import { sendEmail, shell, escapeHtml, APP_URL } from "./email";
import { db } from "./db";
import { wallets } from "@shared/schema";

export interface Recipient {
  email: string;
  address?: string;
}

/** Everyone with a wallet. The caller decides who of these to actually write to. */
export async function allAccountOwners(): Promise<Recipient[]> {
  const rows = await db.select({ email: wallets.email, address: wallets.address }).from(wallets);
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of rows) {
    const e = (r.email || "").trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push({ email: e, address: r.address ?? undefined });
  }
  return out;
}

function body(): string {
  return `
    <h2 style="font-size:19px;margin:0 0 14px;font-weight:600;letter-spacing:-0.01em;">
      A security upgrade for your wallet
    </h2>

    <p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0 0 14px;">
      Hi — Anthony here, from BlockFinaX.
    </p>

    <p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0 0 14px;">
      We're changing how payments from your wallet get approved, and I wanted to explain it
      properly rather than spring it on you.
    </p>

    <p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0 0 14px;">
      <strong>Today</strong>, a password approves a payment. That's normal, and it has worked fine —
      but a password is a single secret, and anyone who obtains it can approve anything.
    </p>

    <p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0 0 18px;">
      <strong>From now on</strong>, you can approve payments with your fingerprint, your face, or
      your Google account instead. Each approval is tied to that one specific payment, on your own
      device — so even someone who knew your password couldn't move your money.
    </p>

    <div style="margin:0 0 18px;padding:14px 16px;background:#f5f7fb;border-left:3px solid #1a4480;border-radius:8px;">
      <p style="margin:0;font-size:13px;color:#0f1a2f;line-height:1.6;">
        <strong>Nothing breaks if you do nothing.</strong> Your wallet keeps working exactly as it
        does now, your balance is untouched, and your wallet address doesn't change. This is an
        upgrade you can take whenever you're ready.
      </p>
    </div>

    <h3 style="font-size:15px;margin:22px 0 8px;font-weight:600;">What to do</h3>
    <ol style="font-size:14px;color:#0f1a2f;line-height:1.75;margin:0 0 8px;padding-left:20px;">
      <li>Sign in at <a href="${APP_URL}" style="color:#1a4480;">${APP_URL.replace(/^https?:\/\//, "")}</a> on your phone or laptop.</li>
      <li>You'll see <strong>"Secure your wallet"</strong> on your home screen. Tap it.</li>
      <li>Approve with your fingerprint or face when your device asks.</li>
      <li><strong>Then add a second method</strong> under Settings → Signing.</li>
    </ol>

    <div style="margin:18px 0;padding:14px 16px;background:#fffbeb;border-left:3px solid #d97706;border-radius:8px;">
      <p style="margin:0;font-size:13px;color:#0f1a2f;line-height:1.6;">
        <strong>Step 4 matters more than it sounds.</strong> Your fingerprint only works on the
        device that recorded it. If that's the only way into your wallet and you lose the phone,
        getting back in means contacting us — nobody can reset it for you, which is the same
        property that stops us moving your money without you. Linking a Google account as a backup
        takes a few seconds and removes that risk entirely.
      </p>
    </div>

    <div style="margin:26px 0;">
      <a href="${APP_URL}" style="display:inline-block;background:#1a4480;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:12px;">Secure my wallet</a>
    </div>

    <p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0 0 14px;">
      If anything is unclear, or the prompt doesn't appear, just reply to this email — it comes
      straight to me.
    </p>

    <p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0;">
      Anthony Kumako<br/>
      <span style="color:#6b7280;font-size:13px;">Chief Executive Officer, BlockFinaX Inc.</span>
    </p>`;
}

export async function sendUpgradeNotice(to: Recipient): Promise<{ ok: boolean; error?: string }> {
  if (!to.email) return { ok: false, error: "no address" };
  return sendEmail({
    to: to.email,
    subject: "A security upgrade for your BlockFinaX wallet",
    html: shell("Wallet security upgrade", body(), { tag: "" }),
    replyTo: "anthonykumako@blockfinax.com",
  });
}

export interface SendReport {
  sent: string[];
  failed: { email: string; error?: string }[];
}

/**
 * Sends to an explicit list, paced.
 *
 * Deliberately takes recipients rather than reading them itself: who should be
 * written to is a decision about the rollout, not a property of the database,
 * and a function that mails "everyone" by default is one bad afternoon away
 * from mailing everyone by accident.
 */
export async function sendUpgradeNotices(recipients: Recipient[]): Promise<SendReport> {
  const report: SendReport = { sent: [], failed: [] };
  for (const r of recipients) {
    try {
      const res = await sendUpgradeNotice(r);
      if (res.ok) report.sent.push(r.email);
      else report.failed.push({ email: r.email, error: res.error });
    } catch (err: any) {
      report.failed.push({ email: r.email, error: err?.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return report;
}
