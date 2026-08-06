/**
 * Development-only CORS shim for the Rift API.
 *
 * Rift's endpoints (payment.riftfi.xyz and friends) send no
 * Access-Control-Allow-Origin header for http://localhost, so the browser
 * discards otherwise-successful 200 responses and the app renders empty
 * balances. On blockfinax.com the origin is allowlisted, so this only ever
 * bites local development.
 *
 * CORS is enforced by browsers, not servers — so the dev server forwards the
 * request itself and hands the JSON back same-origin. The client only routes
 * through here when import.meta.env.DEV is true (see rift-client.ts), so
 * production traffic still goes directly to Rift.
 *
 * Deliberately refuses to mount in production: it forwards Authorization
 * headers to a third party, which is fine on a developer's laptop and not
 * something that should exist on a public deployment.
 */

import type { Express } from "express";

/** Only these hosts may be proxied — never turn this into an open relay. */
const ALLOWED_HOSTS = [
  "payment.riftfi.xyz",
  "api.riftfi.xyz",
  "auth.riftfi.xyz",
];

/**
 * Headers that must NOT be forwarded: hop-by-hop values, and anything that
 * identifies the local origin (which is the very thing upstream rejects).
 * Everything else is passed through, so whichever header the SDK uses to
 * carry its API key survives without us having to guess its name.
 */
const STRIP_REQUEST_HEADERS = new Set([
  "host", "origin", "referer", "connection", "content-length",
  "accept-encoding", "cookie", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest",
]);

export function registerRiftProxy(app: Express): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  app.all("/rift-proxy/:host/*", async (req, res) => {
    const host = req.params.host;
    if (!ALLOWED_HOSTS.includes(host)) {
      return res.status(400).json({ error: `Host not allowed: ${host}` });
    }

    const rest = (req.params as Record<string, string>)[0] || "";
    const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const target = `https://${host}/${rest}${qs}`;

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (STRIP_REQUEST_HEADERS.has(k.toLowerCase())) continue;
      if (typeof v === "string") headers[k] = v;
    }

    // express.json() has already consumed the stream, so re-serialize rather
    // than trying to pipe. Every Rift endpoint we touch speaks JSON.
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const body = hasBody && req.body && Object.keys(req.body).length > 0
      ? JSON.stringify(req.body)
      : undefined;
    if (body && !headers["content-type"]) headers["content-type"] = "application/json";

    try {
      const upstream = await fetch(target, { method: req.method, headers, body });
      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get("content-type");
      if (ct) res.type(ct);
      res.send(text);
    } catch (error) {
      console.warn(`[RiftProxy] ${req.method} ${target} failed:`, error instanceof Error ? error.message : error);
      res.status(502).json({ error: "Rift proxy request failed" });
    }
  });

  console.log("[RiftProxy] dev-only Rift API proxy mounted at /rift-proxy/:host/*");
}
