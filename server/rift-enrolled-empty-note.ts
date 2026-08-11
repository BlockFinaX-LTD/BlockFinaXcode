/**
 * The second note to Rift: one wallet cannot sign by any method.
 *
 * Separate from rift-support-note.ts on purpose. That one asked about base64
 * and endpoint paths on a wallet that was on v3 with two methods enrolled.
 * This is a different failure — the same account is now reporting legacy-aes
 * with nothing enrolled — and folding it into the earlier thread would read as
 * a follow-up rather than a regression.
 *
 * Written around what only they can see. We can observe the projection and the
 * error string; the sealed envelope and the enclave logs are theirs. So the
 * note states the evidence, names the one credential id we were told to
 * constrain against, and asks for a reset rather than an explanation.
 *
 * Credentials are deliberately absent. The session token and the sk_ key that
 * surfaced while debugging are not repeated here — they are being rotated, and
 * a support thread is not the place for either.
 */

import { sendEmail, shell } from "./email";

export const RIFT_CONTACTS = ["amschel@riftfi.com", "iriis@riftfi.com"];

export const SUBJECT =
  "anthonykumako8@gmail.com — wallet reports legacy-aes with enrolled: [], cannot sign by any method";

const p = (t: string) =>
  `<p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0 0 14px;">${t}</p>`;

const code = (t: string) =>
  `<pre style="font-size:12px;background:#f5f7fb;border-radius:8px;padding:12px 14px;overflow-x:auto;margin:0 0 14px;color:#0f1a2f;">${t}</pre>`;

export function body(): string {
  return `
    ${p("Amschel, Iriis — a single account has ended up in a state where nothing can authorise a signature, and I think the wallet record needs resetting on your side. There is money in it.")}

    <h3 style="font-size:15px;margin:22px 0 8px;font-weight:600;">What the wallet reports now</h3>
    ${code(`{
  "version": "legacy-aes",
  "ownerAddress": "0x67a6ad617289b03f9a1e1860378e9cd5afab28c3",
  "lastUpdatedAt": "2026-08-11T09:41:13.017Z",
  "enrolled": [],
  "passkeyCredIds": ["1+U/SC9aegiwrX9EWwU8Rw=="],
  "note": "Projection based on User row; definitive method list is inside the sealed envelope (enclave-only)."
}`)}

    ${p("Two things stand out. The wallet was <strong>v3 with two methods enrolled</strong> — a passkey and a Google account — when we last read it; it is now <code>legacy-aes</code> with <code>enrolled: []</code>. And a <code>passkeyCredId</code> is still listed while <code>enrolled</code> is empty, which we cannot reconcile.")}

    <h3 style="font-size:15px;margin:22px 0 8px;font-weight:600;">Every route fails the same way</h3>
    ${p("Passkey, one-time code and Google all end at the same error, which is consistent with the empty <code>enrolled</code> array rather than with anything method-specific:")}
    ${code(`{"error":"enclave sign returned null — parent-proxy unreachable,
KMS attestation rejected, or v2/v3 consent factor missing/wrong"}`)}
    ${p("The last clause looks like the operative one. The call being signed is an ordinary ERC-20 pool deposit on Base — <code>deposit(9, 10000000)</code>, $10 USDC to our Diamond at <code>0xbCC51E62C4948FD35ab505bd71804C849601e4Ef</code>. Nothing unusual about the transaction.")}

    <h3 style="font-size:15px;margin:22px 0 8px;font-weight:600;">The credential id looks wrong</h3>
    ${p("<code>1+U/SC9aegiwrX9EWwU8Rw==</code> decodes to <strong>16 bytes</strong> (<code>d7e53f482f5a7a08b0ad7f445b053c47</code>). Apple platform credentials are typically 20 bytes and Chrome or security-key credentials 32–64, so 16 is short for anything a real authenticator would have produced.")}
    ${p("That would explain a symptom that had us stuck for a while. We constrain <code>allowCredentials</code> to the ids you return, as your guide says to. The user holds passkeys for <code>blockfinax.com</code> on their phone and on their Mac, and <em>both</em> devices answer “no passkey for blockfinax.com is on this device” — which is what you would expect if that id has never existed on any authenticator.")}

    <h3 style="font-size:15px;margin:22px 0 8px;font-weight:600;">What would help</h3>
    ${p("Could you <strong>clear the signing methods on this wallet and let it re-enrol from scratch</strong>, or tell us the call that does it? We are happy to run the enrolment again — we just cannot get past a consent factor the enclave will not accept and we cannot inspect.")}
    ${p("If a one-time code can be re-enabled for this account in the meantime, that would unblock the customer while the rest is sorted.")}

    <h3 style="font-size:15px;margin:22px 0 8px;font-weight:600;">Two smaller things</h3>
    <ul style="font-size:14px;color:#0f1a2f;line-height:1.7;margin:0 0 14px;padding-left:20px;">
      <li>Is a wallet expected to move from <code>v3</code> back to <code>legacy-aes</code>? If that happened as part of the passkey fix, it may have affected other accounts too, and we would rather check than find out from a customer.</li>
      <li>The <code>sk_</code> project key still has to be inlined into our public bundle for the widget to load, so it is readable by anyone. We are rotating ours. If a publishable <code>pk_</code> exists, we would take one.</li>
    </ul>

    ${p("Happy to get on a call. This is the last thing standing between us and a working wallet for this customer.")}`;
}

/** Sends it. From Anthony, copying hello@ so the team sees the thread. */
export async function sendRiftEnrolledEmptyNote(to: string[] = RIFT_CONTACTS) {
  return sendEmail({
    to,
    cc: ["hello@blockfinax.com"],
    subject: SUBJECT,
    from: "Anthony Kumako <anthonykumako@blockfinax.com>",
    html: shell("Wallet cannot sign", body(), {
      tag: "",
      signOff: "kind",
      from: "Anthony Kumako <anthonykumako@blockfinax.com>",
    }),
    replyTo: "anthonykumako@blockfinax.com",
  });
}
