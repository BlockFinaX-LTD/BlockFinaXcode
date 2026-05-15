/**
 * Unit tests for lib/validate.ts — the zod request-parser middleware.
 *
 * The validator should replace req.params/query/body with the parsed
 * (typed, coerced) values and forward any ZodError into next() so the
 * error handler can format it as a 400 validation_error.
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validate } from "../../src/lib/validate";

describe("validate({ params, query, body })", () => {
  it("replaces req.params with the parsed shape", () => {
    const next = vi.fn();
    const mw = validate({ params: z.object({ id: z.coerce.number().int() }) });
    const req: any = { params: { id: "42" } };
    mw(req, {} as any, next);
    expect(req.params).toEqual({ id: 42 });
    expect(next).toHaveBeenCalledWith();
  });

  it("replaces req.query with the parsed shape (coercion works)", () => {
    const next = vi.fn();
    const mw = validate({ query: z.object({ limit: z.coerce.number().default(50) }) });
    const req: any = { query: { limit: "10" } };
    mw(req, {} as any, next);
    expect(req.query).toEqual({ limit: 10 });
  });

  it("forwards ZodError to next() on validation failure", () => {
    const next = vi.fn();
    const mw = validate({ body: z.object({ name: z.string().min(3) }) });
    const req: any = { body: { name: "ab" } };
    mw(req, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(z.ZodError);
  });

  it("ignores keys you didn't declare a schema for", () => {
    const next = vi.fn();
    const mw = validate({ params: z.object({ id: z.string() }) });
    const req: any = { params: { id: "x" }, query: { foo: "bar" }, body: undefined };
    mw(req, {} as any, next);
    expect(req.query).toEqual({ foo: "bar" }); // untouched
    expect(next).toHaveBeenCalledWith();
  });

  it("applies all three slots together", () => {
    const next = vi.fn();
    const mw = validate({
      params: z.object({ chainId: z.coerce.number() }),
      query:  z.object({ limit: z.coerce.number().default(20) }),
      body:   z.object({ token: z.string() }),
    });
    const req: any = { params: { chainId: "8453" }, query: {}, body: { token: "USDC" } };
    mw(req, {} as any, next);
    expect(req.params).toEqual({ chainId: 8453 });
    expect(req.query).toEqual({ limit: 20 });
    expect(req.body).toEqual({ token: "USDC" });
  });
});
