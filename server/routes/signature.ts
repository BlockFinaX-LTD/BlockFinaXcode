/**
 * Email signature blocks, for mail sent by hand.
 *
 * Everything the platform sends already carries the brand — every sendEmail
 * call goes through shell() in server/email.ts. What doesn't is the mail an
 * actual person writes: replies to counterparties, the letters of intent
 * thread, anything answered from Private Email or Gmail. Those go out as bare
 * text, which is the majority of what a counterparty ever reads from us.
 *
 * ## Why this is a page rather than a file to copy
 *
 * A signature has to be pasted as rendered HTML, not as source. Mail clients
 * accept it only when it arrives on the clipboard as formatted content, so the
 * reliable route is to render it in a browser, select it, and copy. Handing
 * someone an .html file to open produces the same thing with more steps and
 * more ways to get it wrong.
 *
 * ## Why tables and inline styles
 *
 * Outlook renders through Word, which ignores flexbox, grid, and most external
 * CSS. Tables with inline attributes are the only layout that survives every
 * client, and a signature that collapses in Outlook is worse than none —
 * clients that render it become an inconsistency rather than a standard.
 *
 * The logo is an absolute https URL on www. The apex has no certificate, and a
 * relative path has nothing to resolve against once the signature is sitting
 * in somebody else's mailbox.
 */

import type { Express, Request, Response } from "express";

const APP_URL = (process.env.PUBLIC_APP_URL || "https://www.blockfinax.com").replace(/\/$/, "");

const NAVY = "#0a2540";
const BLUE = "#1a4480";
const MUTED = "#6b7280";
const RULE = "#e6eaf2";

export interface Person {
  name: string;
  title: string;
  email: string;
  phone?: string;
}

/**
 * The registered address, on one line.
 *
 * A signature is read in a preview pane, so the address earns its place by
 * being scannable rather than complete — it is the same address that appears
 * in the footer of every marketing email, where CAN-SPAM requires it, and
 * having the two agree matters more than either being elaborate.
 */
const POSTAL = "1007 N Orange St, 4th Floor #5543, Wilmington, DE 19801, USA";

/** The block itself. Tables and inline styles only — see the note above. */
export function signatureHtml(p: Person): string {
  const line = (label: string, value: string, href?: string) => `
    <tr>
      <td style="padding:1px 0;font-size:12px;color:${MUTED};font-family:Arial,Helvetica,sans-serif;">
        ${label}${label ? "&nbsp;&nbsp;" : ""}${
          href
            ? `<a href="${href}" style="color:${BLUE};text-decoration:none;">${value}</a>`
            : `<span style="color:${MUTED};">${value}</span>`
        }
      </td>
    </tr>`;

  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
  <tr>
    <td style="padding:0 16px 0 0;vertical-align:top;">
      <img src="${APP_URL}/assets/logo-mark.png" width="52" height="52" alt="BlockFinaX"
           style="display:block;width:52px;height:52px;border:0;outline:none;text-decoration:none;" />
    </td>
    <td style="padding:0;vertical-align:top;border-left:2px solid ${RULE};padding-left:16px;">
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
        ${line("", p.email, `mailto:${p.email}`)}
        ${p.phone ? line("", p.phone, `tel:${p.phone.replace(/[^\d+]/g, "")}`) : ""}
        ${line("", APP_URL.replace(/^https?:\/\//, ""), APP_URL)}
        <tr>
          <td style="padding:7px 0 0;font-size:11px;color:${MUTED};font-family:Arial,Helvetica,sans-serif;">
            Foreign-exchange cover &amp; cross-border settlement
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

const PEOPLE: Record<string, Person> = {
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

export function registerSignatureRoutes(app: Express) {
  /**
   * A page that renders each signature with instructions beside it.
   *
   * Public, and deliberately so: it contains a name, a job title and a
   * published address, all of which are on the website already, and requiring
   * a login to reach your own email signature is friction with nothing behind
   * it.
   */
  app.get("/signature", (_req: Request, res: Response) => {
    const esc = (h: string) =>
      h.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const block = (key: string, p: Person) => {
      const html = signatureHtml(p);
      return `
      <section>
        <h2>${p.name}<span>${p.email}</span></h2>

        <p class="label">How it looks</p>
        <div class="preview">${html}</div>

        <p class="label">The source — paste this into the <code>&lt;&gt;</code> view</p>
        <textarea class="src" id="src-${key}" readonly spellcheck="false">${esc(html)}</textarea>
        <button data-copy="src-${key}">Copy the source</button>
        <p class="hint">Plain text, so it copies reliably. Paste it into your editor's
           <b>&lt;&gt;</b> (source code) button — not into the visual editor, which strips
           the layout and the logo.</p>
      </section>`;
    };

    res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Email signatures · BlockFinaX</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         max-width:720px; margin:0 auto; padding:40px 20px 80px; background:#f7f8fa; color:#0f1a2f; }
  h1 { font-size:22px; letter-spacing:-.02em; margin:0 0 6px; }
  .lede { color:#6b7280; font-size:14px; line-height:1.6; margin:0 0 32px; }
  section { background:#fff; border:1px solid #e6eaf2; border-radius:14px; padding:22px; margin:0 0 18px; }
  h2 { font-size:14px; margin:0 0 14px; display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
  h2 span { font-weight:400; color:#6b7280; font-size:12px; font-family:ui-monospace,Menlo,monospace; }
  .preview { padding:18px; border:1px dashed #e6eaf2; border-radius:10px; background:#fff; overflow-x:auto; }
  button { margin-top:14px; background:#1a4480; color:#fff; border:0; border-radius:10px;
           padding:10px 18px; font-size:13px; font-weight:600; cursor:pointer; }
  button.done { background:#16a34a; }
  button.warn { background:#d97706; }
  .label { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#6b7280; margin:16px 0 6px; }
  .label:first-of-type { margin-top:0; }
  .label code { font-family:ui-monospace,Menlo,monospace; text-transform:none; letter-spacing:0; }
  .src { width:100%; height:150px; font-family:ui-monospace,Menlo,monospace; font-size:11px;
         line-height:1.5; padding:12px; border:1px solid #e6eaf2; border-radius:10px;
         background:#f7f8fa; color:#0f1a2f; resize:vertical; white-space:pre; overflow:auto; }
  .hint { font-size:12px; color:#6b7280; margin:10px 0 0; line-height:1.6; }
  .preview::selection, .preview *::selection { background:#cfe0ff; }
  ol { font-size:13px; line-height:1.9; color:#0f1a2f; padding-left:20px; margin:8px 0 0; }
  .how { background:#fff; border:1px solid #e6eaf2; border-radius:14px; padding:22px; }
  .how h3 { font-size:13px; margin:0 0 4px; text-transform:uppercase; letter-spacing:.06em; color:#6b7280; }
  .how + .how { margin-top:14px; }
  @media (prefers-color-scheme: dark) {
    body { background:#0b1220; color:#e6ebf5; }
    section,.how { background:#111a2e; border-color:#1e2a44; }
    .preview { background:#fff; border-color:#1e2a44; }
    .src { background:#0b1220; color:#e6ebf5; border-color:#1e2a44; }
    h2 span,.lede,.how h3 { color:#93a1bd; }
  }
</style></head><body>
  <h1>Email signatures</h1>
  <p class="lede">Everything the platform sends already carries the logo. This is for mail you write
     yourself — replies to counterparties, letters of intent, anything answered by hand.
     Copy the block, then paste it into your mail client's signature setting.</p>

  ${Object.entries(PEOPLE).map(([k, p]) => block(k, p)).join("")}

  <div class="how">
    <h3>Private Email (blockfinax.com)</h3>
    <ol>
      <li>Copy the source above.</li>
      <li>privateemail.com → the <b>AA</b> avatar → <b>Settings</b> → <b>Mail → Signatures</b>.</li>
      <li>Add a signature, then click the <b>&lt;&gt;</b> button in the editor toolbar —
          it is on the right, past the font size.</li>
      <li>Select everything already in that box and delete it, then paste the source.</li>
      <li>Click <b>&lt;&gt;</b> again to come back to the visual view. The logo should appear.</li>
      <li>Set <b>Signature Position</b> to <i>above quoted text</i>, then <b>Save</b>.</li>
    </ol>
  </div>

  <div class="how">
    <h3>Gmail</h3>
    <ol>
      <li>Gmail has no source view, so the rendered block is the only route there.</li>
      <li>Select the signature under <b>How it looks</b> with your mouse, then press <b>Cmd-C</b>.</li>
      <li>Gmail → gear → <b>See all settings</b> → <b>Signature</b> → <b>Create new</b>.</li>
      <li>Paste. If the logo is missing, click it once in the preview above to load it, then copy again.</li>
      <li>Under "Signature defaults" pick it for new mail and replies. <b>Save changes</b> at the bottom.</li>
    </ol>
  </div>

  <div class="how">
    <h3>Editing it yourself</h3>
    <ol>
      <li>The source is plain HTML — change the text in the textarea before copying if you want.</li>
      <li>Keep the <code>&lt;table&gt;</code> structure. Outlook renders through Word, which ignores
          flexbox, grid and external CSS; tables are the only layout that survives every client.</li>
      <li>Leave the logo's <code>src</code> as a full <code>https://</code> address. A relative path
          has nothing to resolve against once the signature sits in someone else's mailbox.</li>
    </ol>
  </div>

</body></html>`);
  });
}
