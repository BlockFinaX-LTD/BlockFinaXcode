/*
 * profile.js, remembering a profile Anthony opened.
 *
 * Same restraint as the rest of the extension: it reads what is already on
 * screen because he navigated there himself. It does not open profiles, does
 * not follow links, and does not run on anything but a profile page.
 *
 * A person worth opening is a person worth remembering. The lead list is
 * otherwise built only from people who happened to post something the scanner
 * caught, which misses everyone found by looking rather than by searching.
 */

(() => {
  "use strict";

  const sent = new Set();

  const pick = (sels) => {
    for (const s of sels) {
      const el = document.querySelector(s);
      const t = el && el.innerText ? el.innerText.trim() : "";
      if (t) return t;
    }
    return "";
  };

  const firstLine = (s) => (s.split("\n")[0] || "").trim();

  function profileUrl() {
    const m = location.pathname.match(/^\/in\/([^/]+)/);
    return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}` : null;
  }

  function read() {
    const url = profileUrl();
    if (!url || sent.has(url)) return;

    // The top card is the only reliable place. LinkedIn renames these classes
    // often, so every field falls back through several selectors and an empty
    // result is fine: a profile with just a name is still worth recording.
    const name = firstLine(pick([
      "h1.text-heading-xlarge", "main h1", ".pv-text-details__left-panel h1",
    ]));
    if (!name) return;

    const headline = firstLine(pick([
      "div.text-body-medium.break-words",
      ".pv-text-details__left-panel div.text-body-medium",
    ]));
    const location = firstLine(pick([
      "span.text-body-small.inline.t-black--light.break-words",
      ".pv-text-details__left-panel span.text-body-small",
    ]));
    // "About" is behind a see-more, so this catches whatever is rendered.
    const about = pick([
      "#about ~ div .inline-show-more-text",
      "section:has(#about) .inline-show-more-text",
      "section:has(#about) .display-flex.ph5 span[aria-hidden='true']",
    ]);
    const company = firstLine(pick([
      "button[aria-label^='Current company'] span",
      ".pv-text-details__right-panel-item-text",
    ]));

    sent.add(url);
    chrome.runtime.sendMessage({
      type: "finax:profile",
      profile: { profileUrl: url, name, headline, about, location, company },
    }).catch(() => {});
  }

  let pending = null;
  const schedule = () => {
    if (pending || document.hidden) return;
    pending = setTimeout(() => { pending = null; read(); }, 1500);
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
