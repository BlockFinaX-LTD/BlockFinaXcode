/**
 * Unit tests for lib/reader.ts — the typed ethers.Contract factories +
 * the `serialize` helper used by every read route.
 *
 * The factories return ethers.Contract instances; we only verify shape +
 * caching here, not RPC behavior (that's stubbed in the integration tests).
 */

import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import {
  hedgeFacet, oracleFacet, ownershipFacet, loupeFacet, timelockFacet, erc20, serialize,
} from "../../src/lib/reader";
import { getChain } from "../../src/lib/chains";

describe("contract factories", () => {
  it.each([
    ["hedgeFacet",     hedgeFacet],
    ["oracleFacet",    oracleFacet],
    ["ownershipFacet", ownershipFacet],
    ["loupeFacet",     loupeFacet],
    ["timelockFacet",  timelockFacet],
  ] as const)("%s returns an ethers.Contract addressed at the Diamond", (_name, fn) => {
    const c = fn(8453);
    expect(c).toBeInstanceOf(ethers.Contract);
    expect((c.target as string).toLowerCase()).toBe(getChain(8453).diamond.toLowerCase());
  });

  it("erc20() points at the token address, not the Diamond", () => {
    const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const c = erc20(8453, token);
    expect((c.target as string).toLowerCase()).toBe(token.toLowerCase());
  });

  it("caches contracts per (chainId, address, abi-tag)", () => {
    const a = hedgeFacet(8453);
    const b = hedgeFacet(8453);
    expect(a).toBe(b);
  });

  it("returns different instances for hedge vs oracle facet on the same chain", () => {
    const h = hedgeFacet(8453);
    const o = oracleFacet(8453);
    expect(h).not.toBe(o);
  });

  it("returns different instances for the same facet across chains", () => {
    const base = hedgeFacet(8453);
    const lisk = hedgeFacet(1135);
    expect(base).not.toBe(lisk);
  });

  it("erc20 caches per (chainId, token)", () => {
    const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    expect(erc20(8453, usdc)).toBe(erc20(8453, usdc));
  });

  it("propagates chain-validation failure from getChain()", () => {
    expect(() => hedgeFacet(999)).toThrow(/Unsupported chainId/);
  });
});

describe("serialize()", () => {
  it("leaves primitives alone", () => {
    expect(serialize("x")).toBe("x");
    expect(serialize(42)).toBe(42);
    expect(serialize(true)).toBe(true);
    expect(serialize(null)).toBe(null);
    expect(serialize(undefined)).toBe(undefined);
  });

  it("turns a BigInt into a decimal string", () => {
    expect(serialize(123n)).toBe("123");
    expect(serialize(0n)).toBe("0");
  });

  it("walks arrays recursively", () => {
    expect(serialize([1n, 2n, "x"])).toEqual(["1", "2", "x"]);
  });

  it("walks nested objects recursively", () => {
    const input = { a: 1n, b: { c: 2n, d: [3n] } };
    expect(serialize(input)).toEqual({ a: "1", b: { c: "2", d: ["3"] } });
  });

  it("preserves shape on deeply nested mixed structures", () => {
    expect(serialize({ list: [{ id: 1n, name: "x" }, { id: 2n, flags: [true, false] }] }))
      .toEqual({ list: [{ id: "1", name: "x" }, { id: "2", flags: [true, false] }] });
  });
});
