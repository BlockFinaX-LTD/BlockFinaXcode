/**
 * The technical note to Rift about V3 signing.
 *
 * Written to be answerable. Everything already ruled out is stated, so nobody
 * spends a day re-checking it, and the two open questions are the only things
 * asked for. The findings that are not blockers go at the end, because burying
 * a blocker under a list of smaller complaints is how it gets deprioritised.
 *
 * Sends from hello@blockfinax.com. That was briefly in doubt: an older Resend
 * key lingering in the local environment belonged to an account where only
 * riftfi.xyz existed, so sending as our own domain was refused and a fallback
 * to admin@riftfi.xyz went out instead — a message to Rift's founders from an
 * address inside their own company, which is both confusing and, failing SPF,
 * likely to be quarantined. Production had been correct the whole time; only
 * the local key was stale. Sent 8 August 2026.
 */

import { sendEmail, shell } from "./email";

export const RIFT_CONTACTS = ["amschel@riftfi.com", "iriis@riftfi.com"];

export const SUBJECT = "V3 signing — enclave returns null on submit-prepared";

const p = (t: string) =>
  `<p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0 0 14px;">${t}</p>`;

const code = (t: string) =>
  `<pre style="font-size:12px;background:#f5f7fb;border-radius:8px;padding:12px 14px;overflow-x:auto;margin:0 0 14px;color:#0f1a2f;">${t}</pre>`;

export function body(): string {
  return `
    ${p("Amschel, Iriis — thanks for both guides. We took the custom-integration path and have passkey enrolment and migration working. One thing is blocking us and I think part of it is on your side.")}

    <h3 style="font-size:15px;margin:22px 0 8px;font-weight:600;">The blocker</h3>
    ${p("Every device-signed transaction fails at submit-prepared:")}
    ${code(`POST /v1/wallet/user-operations/submit-prepared → 400

{"error":"enclave sign returned null — parent-proxy unreachable,
 KMS attestation rejected, or v2/v3 consent factor missing/wrong"}`)}

    <h3 style="font-size:15px;margin:22px 0 8px;font-weight:600;">What we've already ruled out</h3>
    <ul style="font-size:14px;color:#0f1a2f;line-height:1.7;margin:0 0 14px;padding-left:20px;">
      <li>The wallet reports <strong>v3 with a passkey enrolled</strong> via <code>GET /wallet/methods</code>.</li>
      <li>Migration succeeded — <code>migrate-to-v3</code> returned <code>alreadyMigrated: false</code>.</li>
      <li>The assertion is constrained to the <code>passkeyCredIds</code> that endpoint returns, so we can't be signing with a stale credential.</li>
      <li>The WebAuthn challenge is the raw bytes of <code>userOpHashHex</code>, matching your example exactly.</li>
      <li>The COSE public key is taken from the authenticator data, not <code>getPublicKey()</code> — that returns SPKI and your enclave rejected it, which cost us a day and may be worth a line in the guide.</li>
      <li>We've tried the proof fields in <strong>both base64 alphabets</strong>, standard and URL-safe.</li>
    </ul>

    <h3 style="font-size:15px;margin:22px 0 8px;font-weight:600;">Two questions</h3>
    <ol style="font-size:14px;color:#0f1a2f;line-height:1.7;margin:0 0 14px;padding-left:20px;">
      <li><strong>Which base64 do the <code>_b64</code> fields expect?</strong> Your schema doesn't say. It matters because your front door is Node, which accepts either, while the enclave is Rust, where a URL_SAFE decoder rejects <code>+</code>, <code>/</code> and <code>=</code> outright. That would explain enrolment succeeding while signing fails.</li>
      <li><strong>Can you check the parent-proxy and KMS attestation path for our project?</strong> Your error lumps three causes together and two of them are inside your infrastructure — we can't tell them apart from out here.</li>
    </ol>

    <h3 style="font-size:15px;margin:22px 0 8px;font-weight:600;">Four smaller things, found while building</h3>
    <ul style="font-size:14px;color:#0f1a2f;line-height:1.7;margin:0 0 14px;padding-left:20px;">
      <li><strong>Your widget can't enrol passkeys.</strong> <code>embed.js</code> sets <code>allow="publickey-credentials-get; identity-credentials-get"</code> on the iframe. <code>credentials.create()</code> needs <code>publickey-credentials-create</code> in a cross-origin frame, so step 3 of the integration guide can't work through the widget as shipped. Our enrolment only works because it runs in the top-level page.</li>
      <li><strong><code>@rift-finance/widget</code> isn't published on npm</strong> — the install command in Iriis's step 1 fails.</li>
      <li><strong>The two guides disagree on paths.</strong> We probed: <code>/wallet/v3-status</code>, <code>/wallet/methods</code> and <code>/wallet/migrate-to-v3</code> are unprefixed; the <code>/v1/</code> variants return 404. Transaction endpoints do take <code>/v1</code>. Worth aligning the docs.</li>
      <li><strong>Which key belongs in the browser?</strong> Your loader example shows <code>data-project-key="sk_..."</code>, but the <code>sk_</code> prefix reads as a server secret — and Vite inlines it into our public bundle. If there's meant to be a separate publishable <code>pk_</code>, could you issue one and rotate ours?</li>
    </ul>

    <h3 style="font-size:15px;margin:22px 0 8px;font-weight:600;">Unrelated, but affecting our users</h3>
    ${p("Transaction OTP emails sent from your side are landing in spam. <code>riftfi.com</code> publishes no SPF and no DMARC record at all — worth a look, since it affects every one of your integrators' users, not just ours.")}

    ${p("Happy to jump on a call. The enclave error is the one thing holding up our rollout.")}

    <p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0;">
      Anthony Kumako<br/>
      <span style="color:#6b7280;font-size:13px;">Chief Executive Officer, BlockFinaX Inc.</span>
    </p>`;
}

/** Sends it. Only call once blockfinax.com is a verified sender. */
export async function sendRiftSupportNote(to: string[] = RIFT_CONTACTS) {
  return sendEmail({
    to,
    subject: SUBJECT,
    html: shell("V3 signing", body(), { tag: "" }),
    replyTo: "anthonykumako@blockfinax.com",
  });
}
