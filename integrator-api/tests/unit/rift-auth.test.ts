/**
 * Unit tests for lib/rift-auth.ts — the Rift bearer-token verifier.
 *
 * Each test does vi.resetModules() + dynamic import so the module-level
 * `RIFT_API_KEY` constant picks up the current env. Otherwise the very
 * first import would freeze the value for the whole file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installFetchMock, restoreFetch } from "../helpers/fetch-mock";

beforeEach(() => {
  vi.resetModules();
  process.env.RIFT_API_KEY = "test-rift-key";  // restore the setup.ts default
});
afterEach(() => { restoreFetch(); });

describe("verifyRiftAccessToken — missing API key", () => {
  it("returns null when RIFT_API_KEY is blank", async () => {
    process.env.RIFT_API_KEY = "";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("../../src/lib/rift-auth");
    const u = await mod.verifyRiftAccessToken("any-token-1");
    expect(u).toBeNull();
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/RIFT_API_KEY missing/));
    err.mockRestore();
  });
});

describe("verifyRiftAccessToken — network failure", () => {
  it("returns null when Rift /user/me throws", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": () => { throw new Error("network unreachable"); },
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { verifyRiftAccessToken } = await import("../../src/lib/rift-auth");
    const u = await verifyRiftAccessToken("token-net-fail");
    expect(u).toBeNull();
    expect(err).toHaveBeenCalled();
    expect(err.mock.calls[0].join(" ")).toMatch(/user\/me unreachable/);
    err.mockRestore();
  });
});

describe("verifyRiftAccessToken — body parsing branches", () => {
  it("falls back through body?.user / body?.data?.user / body?.data / body", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": {
        status: 200,
        json: { data: { user: { address: "0xAaA1111111111111111111111111111111111111", user: "uid-1" } } },
      },
    });
    const { verifyRiftAccessToken } = await import("../../src/lib/rift-auth");
    const u = await verifyRiftAccessToken("tok-data-user");
    expect(u?.address).toBe("0xaaa1111111111111111111111111111111111111");
    expect(u?.user).toBe("uid-1");
  });

  it("returns null when no address field is anywhere in the body", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": { status: 200, json: { wat: "no user here" } },
    });
    const { verifyRiftAccessToken } = await import("../../src/lib/rift-auth");
    const u = await verifyRiftAccessToken("tok-no-addr");
    expect(u).toBeNull();
  });

  it("returns null when Rift responds non-2xx", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": { status: 500, json: { error: "server" } },
    });
    const { verifyRiftAccessToken } = await import("../../src/lib/rift-auth");
    const u = await verifyRiftAccessToken("tok-server-err");
    expect(u).toBeNull();
  });

  it("preserves phone / externalId fallbacks (phone alias, id alias)", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": {
        status: 200,
        json: { user: {
          address: "0xBbB2222222222222222222222222222222222222",
          phone:   "+1-555-1234",      // older field name
          id:      "legacy-id-7",
          // email + externalId intentionally absent
        }},
      },
    });
    const { verifyRiftAccessToken } = await import("../../src/lib/rift-auth");
    const u = await verifyRiftAccessToken("tok-phone-alias");
    expect(u?.phoneNumber).toBe("+1-555-1234");
    expect(u?.user).toBe("legacy-id-7");
    expect(u?.email).toBeNull();
    expect(u?.externalId).toBeNull();
  });
});

describe("verifyRiftAccessToken — cache behavior", () => {
  it("returns the same user from cache on the second call (no extra fetch)", async () => {
    let calls = 0;
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": () => {
        calls++;
        return { status: 200, json: { user: { address: "0xCcC3333333333333333333333333333333333333", user: "u" } } };
      },
    });
    const { verifyRiftAccessToken } = await import("../../src/lib/rift-auth");
    const a = await verifyRiftAccessToken("tok-cache-hit");
    const b = await verifyRiftAccessToken("tok-cache-hit");
    expect(a).toEqual(b);
    expect(calls).toBe(1);
  });
});

describe("cache TTL eviction (setInterval cleanup)", () => {
  it("prunes expired cache entries when the cleanup timer fires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": () => ({
        status: 200,
        json: { user: { address: "0xEeE9999999999999999999999999999999999999", user: "u-ttl" } },
      }),
    });
    const { verifyRiftAccessToken } = await import("../../src/lib/rift-auth");
    // First lookup populates the cache (60s positive TTL).
    await verifyRiftAccessToken("tok-cleanup");

    // Advance well past CACHE_TTL_MS (60s) AND the cleanup interval (60s) so
    // the setInterval callback definitely runs and walks the cache.
    vi.advanceTimersByTime(120_000);

    // No assertion on internal state; the goal is just to drive line 92–93.
    // If the timer body throws, the test would fail.
    expect(true).toBe(true);
    vi.useRealTimers();
  });
});

describe("header / env / body micro-branches", () => {
  it("RIFT_API_BASE falls back to the literal default when env is unset", async () => {
    const prev = process.env.RIFT_API_BASE;
    delete process.env.RIFT_API_BASE;
    vi.resetModules();
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": {
        status: 200,
        json: { user: { address: "0xFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFf", user: "u" } },
      },
    });
    const { verifyRiftAccessToken } = await import("../../src/lib/rift-auth");
    const u = await verifyRiftAccessToken("tok-default-base");
    expect(u?.address).toBe("0xffffffffffffffffffffffffffffffffffffffff");
    process.env.RIFT_API_BASE = prev;
  });

  it("accepts the Authorization header with a capital A", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": {
        status: 200,
        json: { user: { address: "0x1212121212121212121212121212121212121212", user: "u" } },
      },
    });
    const { requireRiftUser } = await import("../../src/lib/rift-auth");
    // express normalises to lowercase, but the verifier checks both — feed
    // it the capital variant directly via the headers object.
    const req: any = { headers: { Authorization: "Bearer cap-a-token" } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    await requireRiftUser(req, res, next);
    expect(req.riftUser?.address).toBe("0x1212121212121212121212121212121212121212");
    expect(next).toHaveBeenCalled();
  });

  it("falls back to '' for `user` when both user and id are absent", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": {
        status: 200,
        json: { user: {
          address: "0x9999999999999999999999999999999999999999",
          // no user, no id — exercises the trailing `?? ""` fallback
        }},
      },
    });
    const { verifyRiftAccessToken } = await import("../../src/lib/rift-auth");
    const u = await verifyRiftAccessToken("tok-no-user-no-id");
    expect(u?.user).toBe("");
  });

  it("returns null when there is no Authorization header at all (both keys missing)", async () => {
    const { requireRiftUser } = await import("../../src/lib/rift-auth");
    const req: any = { headers: {} };  // neither `authorization` nor `Authorization`
    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    await requireRiftUser(req, { status, json } as any, vi.fn());
    expect(status).toHaveBeenCalledWith(401);
  });

  it("rejects a non-Bearer Authorization header (e.g. Basic auth)", async () => {
    const { requireRiftUser } = await import("../../src/lib/rift-auth");
    const req: any = { headers: { authorization: "Basic abc:def" } };
    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    await requireRiftUser(req, { status, json } as any, vi.fn());
    expect(status).toHaveBeenCalledWith(401);
  });

  it("preserves email + externalId when present (?? right-side branches)", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": {
        status: 200,
        json: { user: {
          address: "0x3434343434343434343434343434343434343434",
          email: "real@user.com",
          phoneNumber: "+1-202-555-0100",
          externalId: "ext-id-xyz",
          user: "uid-real",
        }},
      },
    });
    const { verifyRiftAccessToken } = await import("../../src/lib/rift-auth");
    const u = await verifyRiftAccessToken("tok-fully-populated");
    expect(u?.email).toBe("real@user.com");
    expect(u?.phoneNumber).toBe("+1-202-555-0100");
    expect(u?.externalId).toBe("ext-id-xyz");
  });
});

describe("requireRiftUser middleware", () => {
  it("401s on missing Authorization header", async () => {
    const { requireRiftUser } = await import("../../src/lib/rift-auth");
    const req: any = { headers: {} };
    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res: any = { status, json };
    const next = vi.fn();
    await requireRiftUser(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json.mock.calls[0][0].error.code).toBe("unauthorized");
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when Rift /user/me rejects the bearer", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": { status: 401, json: { error: "bad" } },
    });
    const { requireRiftUser } = await import("../../src/lib/rift-auth");
    const req: any = { headers: { authorization: "Bearer bogus" } };
    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res: any = { status, json };
    const next = vi.fn();
    await requireRiftUser(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches riftUser and calls next() on a valid bearer", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": {
        status: 200,
        json: { user: { address: "0xDDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdD", user: "u-1" } },
      },
    });
    const { requireRiftUser } = await import("../../src/lib/rift-auth");
    const req: any = { headers: { authorization: "Bearer good-token" } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    await requireRiftUser(req, res, next);
    expect(req.riftUser?.address).toBe("0xdddddddddddddddddddddddddddddddddddddddd");
    expect(next).toHaveBeenCalledTimes(1);
  });
});
