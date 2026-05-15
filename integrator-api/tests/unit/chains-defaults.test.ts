/**
 * Branch-coverage test for lib/chains.ts:
 *
 *   const rpcUrl = process.env.LISK_RPC_URL || "https://rpc.api.lisk.com";
 *
 * The setup.ts file pre-sets every RPC env so the `||` fallback never fires
 * during the rest of the suite. This file clears those env vars + re-imports
 * so the literal-default branches get exercised.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const RPC_KEYS = [
  "LISK_RPC_URL", "BASE_RPC_URL", "BSC_RPC_URL",
  "LISK_DIAMOND_ADDRESS", "BASE_DIAMOND_ADDRESS", "BSC_DIAMOND_ADDRESS",
  "LISK_USDC_ADDRESS", "BASE_USDC_ADDRESS", "BSC_USDC_ADDRESS",
  "BSC_USDT_ADDRESS",
] as const;

beforeEach(() => {
  vi.resetModules();
  for (const k of RPC_KEYS) delete process.env[k];
});

describe("chains.ts — env-var defaults", () => {
  it("falls back to the literal RPC URL when env is unset", async () => {
    const { getChain } = await import("../../src/lib/chains");
    expect(getChain(1135).rpcUrl).toBe("https://rpc.api.lisk.com");
    expect(getChain(8453).rpcUrl).toBe("https://mainnet.base.org");
    expect(getChain(56).rpcUrl).toBe("https://bsc-dataseed.binance.org");
  });

  it("falls back to literal Diamond + token addresses when env is unset", async () => {
    const { getChain } = await import("../../src/lib/chains");
    const lisk = getChain(1135);
    expect(lisk.diamond).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(lisk.usdc).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const bsc = getChain(56);
    expect(bsc.usdt).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
