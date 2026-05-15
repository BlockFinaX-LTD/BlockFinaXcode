/**
 * Unit tests for lib/chains.ts — chain catalog lookup + provider cache.
 */

import { describe, it, expect } from "vitest";
import { getChain, listChains, providerFor } from "../../src/lib/chains";
import { ApiError } from "../../src/lib/errors";

describe("getChain", () => {
  it("returns the Base config by chainId", () => {
    const c = getChain(8453);
    expect(c.chainId).toBe(8453);
    expect(c.name).toBe("Base");
    expect(c.symbol).toBe("BASE");
    expect(c.diamond).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(c.usdc).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("returns the Lisk config", () => {
    expect(getChain(1135).name).toBe("Lisk");
  });

  it("returns the BSC config including USDT", () => {
    const c = getChain(56);
    expect(c.symbol).toBe("BSC");
    expect(c.usdt).toBeDefined();
    expect(c.paymentDecimals.USDC).toBe(18);
    expect(c.paymentDecimals.USDT).toBe(18);
  });

  it("throws a validation_error ApiError for an unsupported chain", () => {
    expect(() => getChain(999)).toThrowError(ApiError);
    try {
      getChain(999);
    } catch (e) {
      expect((e as ApiError).code).toBe("validation_error");
      expect((e as ApiError).status).toBe(400);
      expect((e as ApiError).message).toMatch(/Unsupported chainId 999/);
    }
  });

  it("error message lists every supported chain so callers can recover", () => {
    try { getChain(0); } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("1135");
      expect(msg).toContain("8453");
      expect(msg).toContain("56");
    }
  });
});

describe("listChains", () => {
  it("returns at least Lisk, Base and BSC", () => {
    const ids = listChains().map(c => c.chainId).sort();
    expect(ids).toEqual([56, 1135, 8453].sort());
  });

  it("each chain's explorerTxUrl callback produces a valid URL", () => {
    const fakeHash = "0xabc123";
    for (const c of listChains()) {
      const url = c.explorerTxUrl(fakeHash);
      expect(url).toMatch(/^https?:\/\//);
      expect(url).toContain(fakeHash);
    }
  });
});

describe("providerFor", () => {
  it("returns a usable ethers.JsonRpcProvider", () => {
    const p = providerFor(8453);
    expect(p).toBeTruthy();
    // Provider exposes a getNetwork() function — we don't await it so we
    // don't hit the network in the unit test, just confirm the shape.
    expect(typeof (p as any).getNetwork).toBe("function");
  });

  it("returns the SAME instance across calls for the same chain (caching)", () => {
    const a = providerFor(8453);
    const b = providerFor(8453);
    expect(a).toBe(b);
  });

  it("returns DIFFERENT instances for different chains", () => {
    const a = providerFor(8453);
    const b = providerFor(1135);
    expect(a).not.toBe(b);
  });

  it("propagates the unsupported-chain error from getChain()", () => {
    expect(() => providerFor(999)).toThrowError(ApiError);
  });
});
