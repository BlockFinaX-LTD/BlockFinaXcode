/*
 * The content script cannot POST to blockfinax.com itself — it runs inside
 * linkedin.com's origin, and LinkedIn's Content-Security-Policy blocks the
 * request before it leaves. The service worker has no page origin, so the call
 * goes from here.
 *
 * The admin token lives in chrome.storage.local and is read here, per request.
 * It is never handed to the content script, so nothing on a LinkedIn page —
 * including LinkedIn's own scripts — can reach it.
 */

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type !== "finax:ingest") return;

  chrome.storage.local.get(["endpoint", "token", "intent"], async s => {
    const endpoint = (s.endpoint || "").replace(/\/+$/, "");
    if (!endpoint || !s.token) {
      respond({ ok: false, error: "Server or token not set" });
      return;
    }
    try {
      const res = await fetch(`${endpoint}/api/outreach/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": s.token },
        body: JSON.stringify({ items: msg.items, intent: s.intent || "reply" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        respond({ ok: false, error: data.error || `Server said ${res.status}` });
        return;
      }
      respond({ ok: true, data });
    } catch (e) {
      respond({ ok: false, error: e?.message || "Network error" });
    }
  });

  return true; // keeps the channel open for the async respond above
});
