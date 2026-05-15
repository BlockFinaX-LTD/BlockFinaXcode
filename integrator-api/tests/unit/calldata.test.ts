/**
 * Unit tests for lib/calldata.ts — the calldata builder helpers. These
 * are pure functions over ethers' Interface.encodeFunctionData, so the
 * assertions can decode the resulting calldata and verify every field
 * round-trips exactly. This is the contract-correctness backbone of the
 * entire integrator API.
 */

import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { buildCall, buildDiamondCall, buildErc20Approve } from "../../src/lib/calldata";
import { HEDGE_FACET_ABI, ERC20_ABI, ORACLE_FACET_ABI } from "../../src/lib/abi";
import { getChain } from "../../src/lib/chains";

describe("buildCall", () => {
  it("encodes a simple no-arg call (oracle.pause-style)", async () => {
    const tx = await buildCall({
      chainId: 8453,
      to: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      abi: HEDGE_FACET_ABI,
      fnName: "pause",
      args: [],
    });
    expect(tx.to.toLowerCase()).toBe("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    expect(tx.value).toBe("0");
    expect(tx.function).toBe("pause");
    expect(tx.chainId).toBe(8453);
    // 4-byte selector only — no args
    expect(tx.data).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it("returns prettyArgs verbatim when provided", async () => {
    const tx = await buildCall({
      chainId: 8453,
      to: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      abi: HEDGE_FACET_ABI,
      fnName: "claimPayout",
      args: [42n],
      prettyArgs: { positionId: "42" },
    });
    expect(tx.args).toEqual({ positionId: "42" });
  });

  it("returns estimatedGas: null when from is omitted (no estimation attempted)", async () => {
    const tx = await buildCall({
      chainId: 8453,
      to: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      abi: HEDGE_FACET_ABI,
      fnName: "claimPayout",
      args: [1n],
    });
    expect(tx.estimatedGas).toBeNull();
  });

  it("produces a value parameter as a string (never a BigInt)", async () => {
    const tx = await buildCall({
      chainId: 8453,
      to: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      abi: HEDGE_FACET_ABI,
      fnName: "pause",
      args: [],
      value: "1000000",
    });
    expect(tx.value).toBe("1000000");
    expect(typeof tx.value).toBe("string");
  });
});

describe("buildDiamondCall — uses the Diamond address per chain", () => {
  it("addresses the Base Diamond on chainId 8453", async () => {
    const tx = await buildDiamondCall({
      chainId: 8453,
      abi: HEDGE_FACET_ABI,
      fnName: "claimPayout",
      args: [7n],
    });
    expect(tx.to.toLowerCase()).toBe(getChain(8453).diamond.toLowerCase());
  });

  it("addresses the Lisk Diamond on chainId 1135", async () => {
    const tx = await buildDiamondCall({
      chainId: 1135,
      abi: HEDGE_FACET_ABI,
      fnName: "claimPayout",
      args: [7n],
    });
    expect(tx.to.toLowerCase()).toBe(getChain(1135).diamond.toLowerCase());
  });

  it("the calldata round-trips through Interface.decodeFunctionData", async () => {
    const tx = await buildDiamondCall({
      chainId: 8453,
      abi: HEDGE_FACET_ABI,
      fnName: "buyProtection",
      args: [12n, "100000000", "110000000", "9999999999"],
    });
    const iface = new ethers.Interface(HEDGE_FACET_ABI);
    const decoded = iface.decodeFunctionData("buyProtection", tx.data);
    expect(decoded[0]).toBe(12n);
    expect(decoded[1]).toBe(100000000n);
    expect(decoded[2]).toBe(110000000n);
    expect(decoded[3]).toBe(9999999999n);
  });

  it("encodes setPoolSettings booleans correctly", async () => {
    const tx = await buildDiamondCall({
      chainId: 8453,
      abi: HEDGE_FACET_ABI,
      fnName: "setPoolSettings",
      args: [3n, true, false],
    });
    const iface = new ethers.Interface(HEDGE_FACET_ABI);
    const decoded = iface.decodeFunctionData("setPoolSettings", tx.data);
    expect(decoded[0]).toBe(3n);
    expect(decoded[1]).toBe(true);
    expect(decoded[2]).toBe(false);
  });

  it("encodes the createEvent tuple in the right field order", async () => {
    const args = [
      "USD/GHS-Q2",                                              // name
      "USD/GHS",                                                 // underlying
      "11500000",                                                // strike (1e6)
      "0",                                                       // payoutCap
      "25000",                                                   // premiumRate
      "1800000000",                                              // expiry
      true,                                                      // allowExternalLp
      "1000000000",                                              // initialLiquidity
      "11000000",                                                // initialRate
      true,                                                      // strikeAbove
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",               // paymentToken (Base USDC)
      "0x",                                                      // signature
      "0",                                                       // quoteTimestamp
      ethers.ZeroHash,                                           // quoteNonce
    ];
    const tx = await buildDiamondCall({
      chainId: 8453,
      abi: HEDGE_FACET_ABI,
      fnName: "createEvent",
      args: [args],
    });
    const iface = new ethers.Interface(HEDGE_FACET_ABI);
    const decoded: any = iface.decodeFunctionData("createEvent", tx.data);
    const tuple = decoded[0];
    expect(tuple.name).toBe("USD/GHS-Q2");
    expect(tuple.underlying).toBe("USD/GHS");
    expect(tuple.strike).toBe(11500000n);
    expect(tuple.allowExternalLp).toBe(true);
    expect(tuple.strikeAbove).toBe(true);
    expect(tuple.paymentToken.toLowerCase()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  });
});

describe("buildErc20Approve", () => {
  it("targets the token address (not the spender)", async () => {
    const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const diamond = "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef";
    const tx = await buildErc20Approve({
      chainId: 8453, token: usdc, spender: diamond, amount: "120000000",
    });
    expect(tx.to.toLowerCase()).toBe(usdc.toLowerCase());
  });

  it("data decodes to approve(spender, amount)", async () => {
    const diamond = "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef";
    const tx = await buildErc20Approve({
      chainId: 8453,
      token:   "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      spender: diamond,
      amount:  "120000000",
    });
    const iface = new ethers.Interface(ERC20_ABI);
    const decoded = iface.decodeFunctionData("approve", tx.data);
    expect(String(decoded[0]).toLowerCase()).toBe(diamond.toLowerCase());
    expect(decoded[1]).toBe(120000000n);
  });

  it("uses the well-known approve selector 0x095ea7b3", async () => {
    const tx = await buildErc20Approve({
      chainId: 8453,
      token:   "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      spender: "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
      amount:  "1",
    });
    expect(tx.data.slice(0, 10)).toBe("0x095ea7b3");
  });
});

describe("Oracle facet encoding sanity", () => {
  it("submitRate encodes (eventId, price) in order", async () => {
    const tx = await buildDiamondCall({
      chainId: 8453,
      abi: ORACLE_FACET_ABI,
      fnName: "submitRate",
      args: [5n, "11250000"],
    });
    const decoded = new ethers.Interface(ORACLE_FACET_ABI).decodeFunctionData("submitRate", tx.data);
    expect(decoded[0]).toBe(5n);
    expect(decoded[1]).toBe(11250000n);
  });
});
