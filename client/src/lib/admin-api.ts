/**
 * Requests from the admin area: the admin token on every call, and a server error turned
 * into a readable message. Every admin tab uses these instead of its own copy.
 */
async function send(url: string, token: string, init: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers, "x-admin-token": token },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = json?.error;
    throw new Error((typeof error === "string" ? error : error?.message) || json?.message || `Request failed (${res.status})`);
  }
  return json;
}

/** Any method: pass fetch options as usual. */
export const adminFetch = (url: string, token: string, options: RequestInit = {}) => send(url, token, options);

/** GET without a body, POST with one. */
export const adminCall = (url: string, token: string, body?: unknown) =>
  send(url, token, body === undefined ? { method: "GET" } : { method: "POST", body: JSON.stringify(body) });
