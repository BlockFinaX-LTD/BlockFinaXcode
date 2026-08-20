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
  if (!msg?.type?.startsWith?.("finax:")) return;

  chrome.storage.local.get(["endpoint", "token", "intent"], async s => {
    const endpoint = (s.endpoint || "").replace(/\/+$/, "");
    if (!endpoint || !s.token) {
      respond({ ok: false, error: "Server or token not set" });
      return;
    }
    const call = (path, init) =>
      fetch(`${endpoint}${path}`, {
        ...init,
        headers: { "content-type": "application/json", "x-admin-token": s.token, ...(init?.headers) },
      });

    try {
      const res =
        msg.type === "finax:queued"  ? await call("/api/outreach/queued")
      : msg.type === "finax:placed"  ? await call(`/api/outreach/${msg.id}/placed`, { method: "POST" })
      : msg.type === "finax:profile" ? await call("/api/outreach/profile", {
          method: "POST", body: JSON.stringify(msg.profile),
        })
      : await call("/api/outreach/ingest", {
          method: "POST",
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
