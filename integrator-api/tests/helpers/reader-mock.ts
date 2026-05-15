/**
 * vi.mock factory for the reader module. Tests use this to install fake
 * contract objects that return whatever shape the real Diamond would
 * return, without hitting an RPC.
 *
 * Pattern:
 *   import { vi } from "vitest";
 *   import { makeReaderMock } from "../helpers/reader-mock";
 *
 *   vi.mock("../../src/lib/reader", () => makeReaderMock({
 *     hedge: {
 *       getTotalHedgeEvents: () => 7n,
 *       getHedgeEventCore: (id: bigint) => ({ id, name: "USD/GHS", ... }),
 *     },
 *     oracle: { getOracles: () => ["0x...", "0x..."] },
 *   }));
 */

import { vi } from "vitest";
import { getChain } from "../../src/lib/chains";

type AnyFn = (...args: any[]) => any;
type ContractStub = Record<string, AnyFn>;

export interface ReaderMocks {
  hedge?: ContractStub;
  oracle?: ContractStub;
  ownership?: ContractStub;
  loupe?: ContractStub;
  timelock?: ContractStub;
  erc20?: ContractStub;
}

/**
 * Builds the module-mock object returned by vi.mock(). Each accessor
 * (`hedgeFacet`, `oracleFacet`, ...) returns the stub from the matching
 * key in `mocks`. Methods on the stub are turned into vitest mock fns so
 * tests can `expect(mock).toHaveBeenCalledWith(...)`.
 */
export function makeReaderMock(mocks: ReaderMocks) {
  const wrap = (stub?: ContractStub) => {
    const wrapped: Record<string, AnyFn> = {};
    if (stub) for (const [key, fn] of Object.entries(stub)) wrapped[key] = vi.fn(fn);
    // Production code calls providerFor(chainId) → getChain(chainId), which
    // throws on unsupported chains. Mirror that behavior so route-level
    // chainId validation is testable end-to-end.
    return (chainId: number) => {
      getChain(chainId);
      return wrapped;
    };
  };

  // Identity-style serialize: walk the shape, leaving everything as-is so
  // tests can inspect the response.data directly.
  const serialize = <T,>(v: T): unknown => {
    if (typeof v === "bigint") return v.toString();
    if (Array.isArray(v)) return v.map(serialize);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = serialize(val);
      return out;
    }
    return v;
  };

  return {
    hedgeFacet:     wrap(mocks.hedge),
    oracleFacet:    wrap(mocks.oracle),
    ownershipFacet: wrap(mocks.ownership),
    loupeFacet:     wrap(mocks.loupe),
    timelockFacet:  wrap(mocks.timelock),
    erc20:          wrap(mocks.erc20),
    serialize,
  };
}
