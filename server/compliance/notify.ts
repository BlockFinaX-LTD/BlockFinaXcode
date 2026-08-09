/**
 * Verification email.
 *
 * Two audiences, and they need opposite things.
 *
 * **Anthony** needs to know a decision is waiting, but not five times an hour.
 * A routine submission is left to the 30-minute digest that already carries
 * agent proposals. A sanctions hit or a self-declared PEP is emailed
 * immediately, because that one cannot wait for a batch — the customer is
 * blocked until somebody looks, and the policy commits to a 24-hour window
 * that starts now.
 *
 * **The customer** needs to know what happens next. Silence after uploading a
 * passport is what makes people email support, or give up. So: a confirmation
 * on submission, and a decision either way with the reason if it is no.
 *
 * ## Why none of these check notification preferences
 *
 * They are account notices. A customer cannot opt out of being told their
 * identity check was refused, or that their limit changed — those decide
 * whether they can move their own money, and a preference that silenced them
 * would be a preference for losing access quietly. shared/notification-schema
 * marks the "account" category as not optional for exactly this reason, and
 * these three are it.
 *
 * A rejection email deliberately does not say a sanctions screen matched. That
 * is not a fact to hand to its subject — it is an internal finding a human has
 * yet to confirm, and it is frequently a coincidence of spelling. The customer
 * is told what they can do about it and nothing more.
 */

import { sendEmail, shell, escapeHtml, APP_URL } from "../email";
import { getApproverEmails } from "../middleware/admin-auth";
import { tierFor, type KycSubmission } from "@shared/compliance-schema";
import type { ScreeningResult } from "./sanctions";

const usd = (n: number) => "$" + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

function btn(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#1a4480;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:12px;">${label}</a>`;
}

function rows(pairs: [string, string | null | undefined][]): string {
  return `<table style="width:100%;border-collapse:collapse;margin:18px 0;">${pairs
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;width:150px;vertical-align:top;">${k}</td><td style="padding:6px 0;color:#0f1a2f;font-size:13px;">${escapeHtml(String(v))}</td></tr>`,
    )
    .join("")}</table>`;
}

const nameOf = (s: KycSubmission) => s.fullName || s.companyName || "A customer";

// ── To Anthony ────────────────────────────────────────────────────────────

/**
 * Sent immediately, and only when something needs a person now: a screening
 * match, or a self-declared politically exposed person. Everything else waits
 * for the digest, because an inbox that fills with routine notifications is one
 * where the urgent message gets missed.
 */
export async function emailUrgentReview(args: {
  submission: KycSubmission;
  reason: "sanctions" | "pep" | "inconclusive";
  screening?: ScreeningResult;
}) {
  const { submission: s, reason, screening } = args;
  const top = screening?.matches?.[0];

  const headline =
    reason === "sanctions"
      ? "A verification matched a sanctions list"
      : reason === "pep"
        ? "A politically exposed person has applied"
        : "A verification could not be screened";

  const explain =
    reason === "sanctions"
      ? `The name on this application matched an entry on a sanctions list. It is held and cannot transact until you decide. Name screening produces false positives, so this is a match to check rather than a conclusion — confirm it against the documents before refusing anyone.`
      : reason === "pep"
        ? `They have declared themselves a politically exposed person. Policy §3.3 requires enhanced due diligence, which is a closer look rather than a refusal.`
        : `Sanctions screening could not complete, so the result is inconclusive rather than clear. The application is held until it can be checked — an outage must not become an approval.`;

  const matchBlock = top
    ? `<div style="margin:18px 0;padding:14px 16px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:8px;">
         <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#991b1b;">Closest match</p>
         <p style="margin:0;font-size:14px;font-weight:600;color:#0f1a2f;">${escapeHtml(top.name)}</p>
         <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">${Math.round((top.score ?? 0) * 100)}% · ${escapeHtml((top.datasets ?? []).join(" · "))}</p>
       </div>`
    : "";

  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">${headline}</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;margin:0;">${explain}</p>
    ${matchBlock}
    ${rows([
      ["Applicant", nameOf(s)],
      ["Applying for", `Tier ${s.requestedTier} — ${tierFor(s.requestedTier).name}`],
      ["Type", s.entityType],
      ["Country", s.country],
      ["Wallet", s.walletAddress],
    ])}
    <div style="margin:24px 0;">${btn(`${APP_URL}/admin#compliance`, "Review it now")}</div>
    <p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0;">
      Policy §4 commits to reviewing flagged activity within 24 hours. That clock started when this arrived.
    </p>`;

  return sendEmail({
    to: getApproverEmails(),
    subject: `[BlockFinaX] ${headline} — ${nameOf(s)}`,
    html: shell(headline, body, { tag: "" }),
  });
}

// ── To the customer ───────────────────────────────────────────────────────

export async function emailKycReceived(s: KycSubmission) {
  if (!s.email) return { ok: true };
  const tier = tierFor(s.requestedTier);
  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">We've got your details</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;margin:0;">
      Hi ${escapeHtml(nameOf(s).split(" ")[0])}, thanks — your verification is with our compliance team.
      We usually come back within one working day.
    </p>
    ${rows([
      ["Applying for", `${tier.name} verification`],
      ["This would let you", `transact up to ${usd(tier.cashMovedUsd)} in any 30 days`],
    ])}
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">
      You don't need to do anything else. We'll email you the moment it's reviewed, and if we need anything
      further we'll ask.
    </p>
    <div style="margin:24px 0;">${btn(`${APP_URL}/verify`, "Check your status")}</div>
    <p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0;">
      We collect this because Ghana's Anti-Money Laundering Act (Act 1044) requires it. Your documents are
      stored securely and shared only with regulators who ask for them.
    </p>`;

  return sendEmail({
    to: s.email,
    subject: "We've received your verification",
    html: shell("Verification received", body, { tag: "" }),
  });
}

export async function emailKycApproved(s: KycSubmission, grantedTier: number) {
  if (!s.email) return { ok: true };
  const tier = tierFor(grantedTier);
  const lower = grantedTier < s.requestedTier;

  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">You're verified</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;margin:0;">
      Hi ${escapeHtml(nameOf(s).split(" ")[0])}, your ${escapeHtml(tier.name.toLowerCase())} verification is
      approved. You can buy cover and provide liquidity straight away.
    </p>
    ${rows([
      ["Level", tier.name],
      ["You can transact", `up to ${usd(tier.cashMovedUsd)} in any 30 days`],
      ["Cover you can hold", `up to ${usd(tier.payoutExposureUsd)} of total payout`],
    ])}
    ${
      lower
        ? `<p style="font-size:13px;color:#0f1a2f;line-height:1.55;padding:12px 14px;background:#f5f7fb;border-radius:8px;">
             We've approved you at ${escapeHtml(tier.name)} rather than the level you asked for. You can apply
             for the next one whenever you're ready — it usually just needs another document.
           </p>`
        : ""
    }
    <div style="margin:24px 0;">${btn(`${APP_URL}/hedge`, "Buy cover")}</div>
    <p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0;">
      Need a higher limit? Apply for the next level at any time from your profile.
    </p>`;

  return sendEmail({
    to: s.email,
    subject: "Your BlockFinaX verification is approved",
    html: shell("Verified", body, { tag: "" }),
  });
}

export async function emailKycRejected(s: KycSubmission, notes?: string | null) {
  if (!s.email) return { ok: true };
  // Deliberately no mention of screening. A match is an internal finding a
  // human has yet to confirm, and it is frequently a coincidence of spelling.
  const reason = notes?.trim()
    ? `<div style="margin:18px 0;padding:14px 16px;background:#f5f7fb;border-left:3px solid #1a4480;border-radius:8px;">
         <p style="margin:0;font-size:13px;color:#0f1a2f;line-height:1.6;white-space:pre-wrap;">${escapeHtml(notes.trim())}</p>
       </div>`
    : "";

  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">We couldn't complete your verification</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;margin:0;">
      Hi ${escapeHtml(nameOf(s).split(" ")[0])}, we weren't able to approve your verification this time.
    </p>
    ${reason}
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">
      You're welcome to submit again — most of the time it's a document that was hard to read, or a detail that
      didn't match. Your previous answers are saved, so it should be quick.
    </p>
    <div style="margin:24px 0;">${btn(`${APP_URL}/verify`, "Try again")}</div>
    <p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0;">
      If you think this is a mistake, reply to this email and a person will look at it.
    </p>`;

  return sendEmail({
    to: s.email,
    subject: "About your BlockFinaX verification",
    html: shell("Verification update", body, { tag: "" }),
  });
}
