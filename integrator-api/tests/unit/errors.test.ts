/**
 * Unit tests for lib/errors.ts — the typed ApiError class, the convenience
 * factories, the Express error handler envelope, and the asyncHandler
 * wrapper that bridges promise rejections back into Express.
 */

import { describe, it, expect, vi } from "vitest";
import { ZodError, z } from "zod";
import { ApiError, errors, errorHandler, asyncHandler } from "../../src/lib/errors";

describe("ApiError class", () => {
  it("maps each code to the documented HTTP status", () => {
    expect(new ApiError("unauthorized",       "x").status).toBe(401);
    expect(new ApiError("forbidden",          "x").status).toBe(403);
    expect(new ApiError("not_found",          "x").status).toBe(404);
    expect(new ApiError("validation_error",   "x").status).toBe(400);
    expect(new ApiError("conflict",           "x").status).toBe(409);
    expect(new ApiError("rate_limited",       "x").status).toBe(429);
    expect(new ApiError("internal_error",     "x").status).toBe(500);
    expect(new ApiError("upstream_error",     "x").status).toBe(502);
    expect(new ApiError("service_unavailable","x").status).toBe(503);
  });

  it("preserves the message and optional details", () => {
    const err = new ApiError("not_found", "nope", { id: 42 });
    expect(err.message).toBe("nope");
    expect(err.code).toBe("not_found");
    expect(err.details).toEqual({ id: 42 });
  });

  it("is a real Error so it works with `throw` and `instanceof`", () => {
    const err = errors.forbidden("nope");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("nope");
  });
});

describe("errors factory", () => {
  it.each([
    ["unauthorized",   401],
    ["forbidden",      403],
    ["notFound",       404],
    ["conflict",       409],
    ["rateLimited",    429],
    ["internal",       500],
    ["upstream",       502],
    ["unavailable",    503],
  ] as const)("errors.%s() returns an ApiError with the right status", (name, status) => {
    // @ts-expect-error indexed access
    const err = errors[name]("msg") as ApiError;
    expect(err.status).toBe(status);
    expect(err.message).toBe("msg");
  });

  it("errors.validation accepts details", () => {
    const err = errors.validation("bad", { field: "x" });
    expect(err.status).toBe(400);
    expect(err.details).toEqual({ field: "x" });
  });

  it("default messages are not empty", () => {
    expect(errors.unauthorized().message.length).toBeGreaterThan(0);
    expect(errors.forbidden().message.length).toBeGreaterThan(0);
  });
});

describe("errorHandler", () => {
  function makeRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }
  const req: any = { method: "GET", path: "/test" };
  const next = vi.fn();

  it("formats an ApiError as the JSON envelope with the right status", () => {
    const res = makeRes();
    const err = new ApiError("not_found", "missing");
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: "not_found", message: "missing" },
    });
  });

  it("includes details when the error carries them", () => {
    const res = makeRes();
    errorHandler(new ApiError("conflict", "dup", { id: 1 }), req, res, next);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: "conflict", message: "dup", details: { id: 1 } },
    });
  });

  it("turns a ZodError into a 400 validation_error with field paths", () => {
    const res = makeRes();
    const schema = z.object({ chainId: z.number().int() });
    const result = schema.safeParse({ chainId: "not-a-number" });
    if (result.success) throw new Error("expected zod parse to fail");
    errorHandler(result.error, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json.mock.calls[0] as any[])[0];
    expect(body.error.code).toBe("validation_error");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details[0]).toMatchObject({ path: "chainId" });
  });

  it("treats unknown errors as 500 internal_error and does not leak stacks", () => {
    const res = makeRes();
    // suppress the console.error the handler emits for unknown errors
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    errorHandler(new Error("boom"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: "internal_error", message: "Something went wrong" },
    });
    spy.mockRestore();
  });
});

describe("asyncHandler", () => {
  it("forwards thrown errors to next()", async () => {
    const next = vi.fn();
    const handler = asyncHandler(async () => { throw new ApiError("conflict", "x"); });
    await handler({} as any, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ApiError);
  });

  it("lets a successful handler call res.json without invoking next() with an error", async () => {
    const next = vi.fn();
    const res: any = { json: vi.fn() };
    const handler = asyncHandler(async (_req, r) => { r.json({ ok: true }); });
    await handler({} as any, res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it("handles synchronous throws too", async () => {
    const next = vi.fn();
    const handler = asyncHandler(async () => { throw new Error("sync"); });
    await handler({} as any, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
