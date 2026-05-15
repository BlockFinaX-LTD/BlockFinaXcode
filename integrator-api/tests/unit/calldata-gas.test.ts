/**
 * Unit tests for the gas-estimation branch in lib/calldata.ts.
 *
 * The default `calldata.test.ts` exercises encoding-only paths (no `from`
 * supplied) and asserts `estimatedGas: null`. This file fills the other
 * half: when `from` IS supplied, buildCall asks `providerFor(chainId)` for
 * an estimate. We mock the provider so no RPC is dialed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const estimateGas = vi.fn();
vi.mock("../../src/lib/chains", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/chains")>("../../src/lib/chains");
  return { ...actual, providerFor: vi.fn(() => ({ estimateGas })) };
});

import { buildCall, buildErc20Approve } from "../../src/lib/calldata";
import { HEDGE_FACET_ABI } from "../../src/lib/abi";

beforeEach(() => { estimateGas.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

describe("buildCall with `from` — gas estimation succeeds", () => {
  it("returns estimatedGas as a decimal string when the provider responds", async () => {
    estimateGas.mockResolvedValueOnce(123_456n);
    const tx = await buildCall({
      chainId: 8453,
      to: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      abi: HEDGE_FACET_ABI,
      fnName: "claimPayout",
      args: [1n],
      from: "0x1111111111111111111111111111111111111111",
    });
    expect(tx.estimatedGas).toBe("123456");
    expect(estimateGas).toHaveBeenCalledTimes(1);
    // Verify the estimate request shape: from, to, data, value (BigInt)
    const callArg = estimateGas.mock.calls[0][0];
    expect(callArg.from.toLowerCase()).toBe("0x1111111111111111111111111111111111111111");
    expect(callArg.to.toLowerCase()).toBe("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    expect(typeof callArg.value).toBe("bigint");
  });

  it("passes the value through as a BigInt when set", async () => {
    estimateGas.mockResolvedValueOnce(50_000n);
    await buildCall({
      chainId: 8453,
      to: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      abi: HEDGE_FACET_ABI,
      fnName: "pause",
      args: [],
      from: "0x1111111111111111111111111111111111111111",
      value: "1000",
    });
    const callArg = estimateGas.mock.calls[0][0];
    expect(callArg.value).toBe(1000n);
  });
});

describe("buildCall with `from` — gas estimation fails", () => {
  it("swallows the provider error and returns estimatedGas: null", async () => {
    estimateGas.mockRejectedValueOnce(new Error("execution reverted: ERC20: insufficient allowance"));
    const tx = await buildCall({
      chainId: 8453,
      to: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      abi: HEDGE_FACET_ABI,
      fnName: "buyProtection",
      args: [1n, 100n, 110n, 9999n],
      from: "0x1111111111111111111111111111111111111111",
    });
    expect(tx.estimatedGas).toBeNull();
    expect(tx.data.startsWith("0x")).toBe(true); // calldata still built
  });
});

describe("buildErc20Approve flows the gas-estimate branch", () => {
  it("returns a numeric estimate when the provider responds", async () => {
    estimateGas.mockResolvedValueOnce(46_000n);
    const tx = await buildErc20Approve({
      chainId: 8453,
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      spender: "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
      amount: "1000",
      from: "0x1111111111111111111111111111111111111111",
    });
    expect(tx.estimatedGas).toBe("46000");
  });
});
