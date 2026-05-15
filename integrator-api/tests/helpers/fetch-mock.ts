/**
 * Tiny global-fetch interceptor used to mock Rift's /user/me responses
 * without pulling in MSW. Per-test you call installFetchMock() with a
 * URL→response map, then restoreFetch() in afterEach.
 *
 * Example:
 *   installFetchMock({
 *     "https://payment.riftfi.xyz/user/me": (req) => ({
 *       status: 200,
 *       json: { user: { address: "0xabc...", email: "a@b.com", ... } },
 *     }),
 *   });
 */

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit  = Parameters<typeof fetch>[1];

interface MockResponse {
  status?: number;
  json?: unknown;
  text?: string;
}

type Handler = (input: FetchInput, init?: FetchInit) => MockResponse | Promise<MockResponse>;
type HandlerMap = Record<string, Handler | MockResponse>;

const originalFetch = globalThis.fetch;

export function installFetchMock(handlers: HandlerMap): void {
  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url =
      typeof input === "string" ? input :
      input instanceof URL ? input.toString() :
      (input as any).url;

    // Match any handler whose key is a prefix or exact match
    const entry = Object.entries(handlers).find(([key]) =>
      url === key || url.startsWith(key),
    );

    if (!entry) {
      throw new Error(`[fetch-mock] no handler for ${url}`);
    }

    const handler = entry[1];
    const result: MockResponse =
      typeof handler === "function" ? await (handler as Handler)(input, init) : handler;

    const status = result.status ?? 200;
    const body = result.json != null ? JSON.stringify(result.json) : (result.text ?? "");
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}
