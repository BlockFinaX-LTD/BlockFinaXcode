/**
 * The signature block, in one place.
 *
 * Used twice and it has to be identical in both: at the foot of every email the
 * platform sends, and on /signature for the mail a person writes by hand. Two
 * copies would drift, and a counterparty who sees one version in a system
 * notice and another in a reply has been given a small reason to wonder.
 *
 * Tables and inline styles only. Outlook renders through Word, which ignores
 * flexbox, grid and external stylesheets, so a table is the only layout that
 * survives everywhere. The logo is an absolute https URL on www — the apex has
 * no certificate, and a relative path resolves against nothing once the message
 * is sitting in someone else's mailbox.
 */

const APP_URL = (process.env.PUBLIC_APP_URL || "https://www.blockfinax.com").replace(/\/$/, "");

const NAVY = "#0a2540";
const BLUE = "#1a4480";
const MUTED = "#6b7280";
const RULE = "#e6eaf2";

/** One line, and the reason anyone should care what the rest of the block says. */
export const TAGLINE = "FX risk infrastructure for the stablecoin economy.";

/**
 * The registered address.
 *
 * The same address that appears in the footer of marketing mail, where
 * CAN-SPAM requires one. Having the two agree matters more than either being
 * elaborate: a counterparty who checks should find one company, not two.
 */
export const POSTAL = "1007 N Orange St, 4th Floor #5543, Wilmington, DE 19801, USA";

export interface Person {
  name: string;
  title: string;
  email: string;
  phone?: string;
}

export const PEOPLE: Record<string, Person> = {
  anthony: {
    name: "Anthony Kumako",
    title: "Chief Executive Officer",
    email: "anthonykumako@blockfinax.com",
  },
  hello: {
    name: "BlockFinaX",
    title: "Client Services",
    email: "hello@blockfinax.com",
  },
};

export function signatureHtml(p: Person): string {
  const link = (value: string, href: string) => `
    <tr>
      <td style="padding:1px 0;font-size:12px;color:${MUTED};font-family:Arial,Helvetica,sans-serif;">
        <a href="${href}" style="color:${BLUE};text-decoration:none;">${value}</a>
      </td>
    </tr>`;

  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
  <tr>
    <td style="padding:0 16px 0 0;vertical-align:top;">
      <img src="${APP_URL}/assets/logo-mark.png" width="52" height="52" alt="BlockFinaX"
           style="display:block;width:52px;height:52px;border:0;outline:none;text-decoration:none;" />
    </td>
    <td style="padding:0 0 0 16px;vertical-align:top;border-left:2px solid ${RULE};">
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="padding:0 0 1px;font-size:15px;font-weight:bold;color:${NAVY};font-family:Arial,Helvetica,sans-serif;letter-spacing:-0.2px;">
            ${p.name}
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 6px;font-size:12px;color:${MUTED};font-family:Arial,Helvetica,sans-serif;">
            ${p.title} &nbsp;·&nbsp; <span style="color:${NAVY};font-weight:bold;">BlockFinaX Inc.</span>
          </td>
        </tr>
        ${link(p.email, `mailto:${p.email}`)}
        ${p.phone ? link(p.phone, `tel:${p.phone.replace(/[^\d+]/g, "")}`) : ""}
        ${link(APP_URL.replace(/^https?:\/\//, ""), APP_URL)}
        <tr>
          <td style="padding:7px 0 0;font-size:11px;color:${MUTED};font-family:Arial,Helvetica,sans-serif;">
            ${TAGLINE}
          </td>
        </tr>
        <tr>
          <td style="padding:2px 0 0;font-size:11px;color:${MUTED};font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
            ${POSTAL}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/**
 * Which signature belongs on a message, decided by who it claims to be from.
 *
 * A notice from hello@ signing off as the CEO is a small dishonesty, and a
 * letter from Anthony signed "Client Services" is worse. The From address is
 * the only thing that actually knows.
 */
export function signatureFor(fromAddress: string | undefined): Person {
  const addr = (fromAddress || "").toLowerCase();
  if (addr.includes("anthonykumako")) return PEOPLE.anthony;
  return PEOPLE.hello;
}


/**
 * The line before the signature.
 *
 * Not every message wants one. A verification-approved notice reading "Kind
 * regards, Anthony" is odd — nobody wrote it, and pretending otherwise is a
 * small untruth on a message about identity. So the default is none, and
 * anything that reads as a letter opts in.
 *
 * "Kind regards" is the default where one is wanted. It is the ordinary
 * register of business English in Ghana, Nigeria and Kenya — warmer than
 * "Regards", which reads curt, and without the deference of "At your service",
 * which belongs to hospitality rather than to two companies dealing as equals.
 * A hedging counterparty is a peer.
 */
export type SignOff = "none" | "kind" | "best" | "warm" | "thanks" | "sincerely";

const SIGN_OFFS: Record<Exclude<SignOff, "none">, string> = {
  kind: "Kind regards,",
  best: "Best regards,",
  warm: "With warm regards,",
  thanks: "Thank you,",
  sincerely: "Yours sincerely,",
};

export function signOffHtml(kind: SignOff = "none"): string {
  if (kind === "none") return "";
  return `<p style="font-size:14px;color:#0f1a2f;line-height:1.6;margin:0 0 4px;">${SIGN_OFFS[kind]}</p>`;
}
