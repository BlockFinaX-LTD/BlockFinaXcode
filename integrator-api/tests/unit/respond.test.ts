/**
 * Unit tests for lib/respond.ts — the response envelope helpers used by
 * every successful route handler.
 */

import { describe, it, expect, vi } from "vitest";
import { ok, created, noContent } from "../../src/lib/respond";

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

describe("ok(res, data, meta?)", () => {
  it("returns a 200 with { data }", () => {
    const res = makeRes();
    ok(res, { id: 1 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: { id: 1 } });
  });

  it("includes meta when provided", () => {
    const res = makeRes();
    ok(res, [1, 2], { pagination: { limit: 2, hasMore: false } });
    expect(res.json).toHaveBeenCalledWith({
      data: [1, 2],
      meta: { pagination: { limit: 2, hasMore: false } },
    });
  });

  it("does not add a `meta` key when not given", () => {
    const res = makeRes();
    ok(res, "hello");
    const arg = (res.json.mock.calls[0] as any[])[0];
    expect(arg).toEqual({ data: "hello" });
    expect("meta" in arg).toBe(false);
  });
});

describe("created(res, data, meta?)", () => {
  it("returns a 201 envelope", () => {
    const res = makeRes();
    created(res, { id: 42 });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: { id: 42 } });
  });
});

describe("noContent(res)", () => {
  it("returns 204 with no body", () => {
    const res = makeRes();
    noContent(res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalledWith();
    expect(res.json).not.toHaveBeenCalled();
  });
});
