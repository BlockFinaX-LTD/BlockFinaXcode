/*
 * compose.js, putting a drafted comment into LinkedIn's own comment box.
 *
 * ## Why this exists rather than an API call
 *
 * LinkedIn's comment endpoint is enforced at partnerApiSocialAction. A server
 * cannot comment on someone else's post whatever scopes the token carries, and
 * partner access takes an application that a company this size rarely gets.
 *
 * So the text is carried to the box and the human presses Post. That line
 * matters. This script types; it never submits. The submission stays a real
 * click on LinkedIn's own button, which is not automated posting by any
 * reading, and it keeps a person between a draft and something published in
 * their name. Even with the API working, that pause is worth keeping.
 *
 * ## Why it fills only what Anthony queued
 *
 * It does nothing until a draft has been queued for the exact post on screen.
 * Landing on a random post fills nothing. That makes the behaviour predictable
 * and means a stray page can never be commented on by accident.
 */

(() => {
  "use strict";

  const filled = new Set();   // drafts already placed this page-load
  let queue = [];
  let lastFetch = 0;

  /** The activity id of the post being viewed, from the URL or the markup. */
  function currentUrn() {
    const href = location.href;
    const direct = href.match(/urn:li:(activity|ugcPost|share):(\d+)/);
    if (direct) return `urn:li:${direct[1]}:${direct[2]}`;
    const encoded = href.match(/urn%3Ali%3A(activity|ugcPost|share)%3A(\d+)/i);
    if (encoded) return `urn:li:${encoded[1]}:${encoded[2]}`;
    // The public form: /posts/slug_words-activity-7496146729793261569-h3xB
    const share = href.match(/-activity-(\d{10,})(?:-|\/|$|\?)/);
    if (share) return `urn:li:activity:${share[1]}`;
    return null;
  }

  /**
   * LinkedIn's comment box is a contenteditable, not a textarea.
   *
   * Setting textContent alone leaves React's state empty, so the Post button
   * stays disabled and the text vanishes on the next render. The input event is
   * what makes React accept it as typing.
   */
  function fillBox(box, text) {
    box.focus();
    const p = document.createElement("p");
    p.textContent = text;
    box.innerHTML = "";
    box.appendChild(p);
    box.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findBox() {
    const selectors = [
      "div.ql-editor[contenteditable='true']",
      "div[data-placeholder][contenteditable='true']",
      "div[role='textbox'][contenteditable='true']",
      ".comments-comment-box__form div[contenteditable='true']",
    ];
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        // Skip anything offscreen or collapsed; LinkedIn keeps hidden editors
        // around, and filling one of those looks like nothing happened.
        const r = el.getBoundingClientRect();
        if (r.width > 80 && r.height > 8) return el;
      }
    }
    return null;
  }

  function banner(text, tone) {
    let el = document.querySelector(".finax-compose");
    if (!el) {
      el = document.createElement("div");
      el.className = "finax-bar finax-compose";
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.style.borderColor = tone === "ok" ? "rgba(52,211,153,.5)" : "rgba(255,255,255,.14)";
    el.style.display = "flex";
    setTimeout(() => { el.style.display = "none"; }, 9000);
  }

  async function refreshQueue() {
    if (Date.now() - lastFetch < 20000) return;
    lastFetch = Date.now();
    try {
      const r = await chrome.runtime.sendMessage({ type: "finax:queued" });
      if (r?.ok && Array.isArray(r.data?.queued)) queue = r.data.queued;
    } catch {
      /* the popup reports configuration problems; a page is the wrong place */
    }
  }

  async function tryFill() {
    const urn = currentUrn();
    if (!urn) return;
    await refreshQueue();

    const item = queue.find(q => q.urn === urn && !filled.has(q.id));
    if (!item) return;

    const box = findBox();
    if (!box) return;              // the comment box opens on click; wait for it
    if (box.textContent.trim()) return;  // never overwrite something already typed

    fillBox(box, item.draft);
    filled.add(item.id);
    banner("Finax filled this in. Read it, then press Post.", "ok");

    // Report that it was placed, not that it was sent. Whether Anthony pressed
    // Post is not ours to know, and recording a send we did not witness would
    // put a false entry in the one place he looks to find out.
    chrome.runtime.sendMessage({ type: "finax:placed", id: item.id }).catch(() => {});
  }

  let pending = null;
  const schedule = () => {
    if (pending || document.hidden) return;
    pending = setTimeout(() => { pending = null; void tryFill(); }, 900);
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("click", schedule, true);  // the box appears on click
  schedule();
})();
