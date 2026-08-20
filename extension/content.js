/*
 * Finax for LinkedIn — page reader.
 *
 * Reads what is already rendered on the LinkedIn page Anthony is looking at.
 * It does not navigate, does not scroll, does not open profiles, and does not
 * run when the tab is in the background. Every post it collects is one Anthony
 * has already loaded by scrolling there himself.
 *
 * That restraint is not decoration. A script that drives the session is what
 * LinkedIn detects and bans for; a script that reads a rendered page produces
 * no requests at all, because the data is already in the DOM.
 */

(() => {
  "use strict";

  const SEEN = new Set();     // urns already collected this page-load
  const BUFFER = new Map();   // urn -> item, waiting to be sent
  let settings = { endpoint: "", token: "", intent: "reply", auto: false };

  /* ── extraction ──────────────────────────────────────────────────────────
   *
   * LinkedIn renames its classes often, so every field is tried against a list
   * of selectors and falls back to structure. The urn is the one stable handle
   * — it is in the markup because the page needs it, not because it is a
   * convenient hook, so it survives redesigns that break class names.
   */

  const pick = (root, selectors) => {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      const text = el && el.innerText ? el.innerText.trim() : "";
      if (text) return text;
    }
    return "";
  };

  // Author blocks repeat the name for screen readers: "Ada Boateng\nAda Boateng
  // \n2nd". Keep the first line only.
  const firstLine = s => (s.split("\n")[0] || "").trim();

  function readPost(node) {
    const urn =
      node.getAttribute("data-urn") ||
      node.getAttribute("data-id") ||
      (node.querySelector("[data-urn]") || {}).getAttribute?.("data-urn") ||
      "";
    const activity = (urn.match(/urn:li:activity:\d+/) || [])[0] || "";

    const text = pick(node, [
      ".update-components-text",
      ".feed-shared-update-v2__description",
      ".feed-shared-inline-show-more-text",
      ".update-components-update-v2__commentary",
    ]);
    if (!text) return null;

    const name = firstLine(pick(node, [
      ".update-components-actor__title",
      ".update-components-actor__name",
      ".feed-shared-actor__name",
    ]));

    const headline = firstLine(pick(node, [
      ".update-components-actor__description",
      ".feed-shared-actor__description",
    ]));

    // Prefer the post permalink. Without an activity urn there is nothing
    // stable to link to, so fall back to the author's profile — a draft with
    // no way to reach the person is not worth putting in the waiting room.
    const profile = node.querySelector('a[href*="/in/"]');
    const url = activity
      ? `https://www.linkedin.com/feed/update/${activity}/`
      : profile
        ? profile.href.split("?")[0]
        : "";
    if (!url) return null;

    return { key: activity || url, text, name: name || null, headline: headline || null, url };
  }

  function readPerson(node) {
    const link = node.querySelector('a[href*="/in/"]');
    if (!link) return null;
    const url = link.href.split("?")[0];
    const name = firstLine(pick(node, [
      ".entity-result__title-text",
      ".entity-result__title-line",
      'span[dir="ltr"]',
    ]));
    const headline = pick(node, [
      ".entity-result__primary-subtitle",
      ".entity-result__summary",
    ]);
    // A person is only worth drafting for if their headline says what they do —
    // a bare name gives the drafter nothing to be specific about, and a generic
    // opener is exactly the message that gets ignored.
    if (!headline) return null;
    return { key: url, text: headline, name: name || null, headline, url };
  }

  function harvest() {
    const found = [];
    const posts = document.querySelectorAll(
      '.feed-shared-update-v2, [data-urn*="urn:li:activity"], .occludable-update',
    );
    posts.forEach(n => { const it = readPost(n); if (it) found.push(it); });

    const people = document.querySelectorAll(
      '.reusable-search__result-container, .entity-result, li.artdeco-list__item',
    );
    people.forEach(n => { const it = readPerson(n); if (it) found.push(it); });

    let added = 0;
    for (const it of found) {
      if (SEEN.has(it.key)) continue;
      SEEN.add(it.key);
      BUFFER.set(it.key, it);
      added++;
    }
    if (added) render();
    return added;
  }

  /* ── the button ──────────────────────────────────────────────────────── */

  const bar = document.createElement("div");
  bar.className = "finax-bar";
  bar.style.display = "none";
  bar.innerHTML =
    '<span class="finax-count"></span>' +
    '<button class="finax-send" type="button">Send to Finax</button>';
  document.documentElement.appendChild(bar);
  const countEl = bar.querySelector(".finax-count");
  const sendEl = bar.querySelector(".finax-send");

  function render(msg) {
    if (msg) { countEl.textContent = msg; bar.style.display = "flex"; return; }
    const n = BUFFER.size;
    if (!n) { bar.style.display = "none"; return; }
    countEl.textContent = `${n} post${n === 1 ? "" : "s"} read`;
    bar.style.display = "flex";
  }

  async function send() {
    if (!BUFFER.size || sendEl.disabled) return;
    if (!settings.endpoint || !settings.token) {
      render("Open the Finax icon and add your server + admin token");
      return;
    }
    const items = [...BUFFER.values()];
    sendEl.disabled = true;
    countEl.textContent = `Sending ${items.length}…`;
    try {
      const r = await chrome.runtime.sendMessage({ type: "finax:ingest", items });
      if (r && r.ok) {
        BUFFER.clear();
        const d = r.data || {};
        render(
          d.drafted
            ? `${d.drafted} draft${d.drafted === 1 ? "" : "s"} waiting — ${d.relevant} of ${d.considered} were relevant`
            : `Nothing relevant in ${d.considered || items.length} posts`,
        );
        setTimeout(() => render(), 6000);
      } else {
        render((r && r.error) || "Could not reach the server");
      }
    } finally {
      sendEl.disabled = false;
    }
  }

  sendEl.addEventListener("click", send);

  /* ── when to look ────────────────────────────────────────────────────────
   *
   * On scroll, throttled, and only while the tab is visible. LinkedIn is a
   * single-page app that swaps content without a navigation, so a MutationObserver
   * is the only thing that notices a new feed — but it fires hundreds of times a
   * second while scrolling, hence the timer.
   */
  let pending = null;
  const schedule = () => {
    if (pending || document.hidden) return;
    pending = setTimeout(() => { pending = null; harvest(); }, 1200);
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });

  chrome.storage.local.get(["endpoint", "token", "intent", "auto"], s => {
    settings = { ...settings, ...s };
    schedule();
  });
  chrome.storage.onChanged.addListener(changes => {
    for (const k in changes) settings[k] = changes[k].newValue;
  });

  // Auto mode sends without a click once enough has accumulated. Off by default:
  // sending should be something Anthony does, not something that happens while
  // he reads.
  setInterval(() => {
    if (settings.auto && BUFFER.size >= 8) send();
  }, 15000);
})();
