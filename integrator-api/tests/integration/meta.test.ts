/**
 * Integration tests for /v1/me + /v1/chains + /v1/governance/* + /v1/hedge/fees.
 *
 * Strategy:
 *   - Stub lib/reader so the ethers Contract calls return deterministic
 *     fixtures instead of dialing an RPC.
 *   - Stub global.fetch so Rift /user/me returns whatever the test wants.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeReaderMock } from "../helpers/reader-mock";
import { installFetchMock, restoreFetch } from "../helpers/fetch-mock";

vi.mock("../../src/lib/reader", () => makeReaderMock({
  hedge: {
    getHedgeFeeConfig: () => [2_000_000n, 5_000n, 10_000n, 10_000n, 50_000n],
  },
  ownership: {
    owner:         () => "0x1111111111111111111111111111111111111111",
    pendingOwner:  () => "0x2222222222222222222222222222222222222222",
  },
  loupe: {
    facets: () => [
      { facetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", functionSelectors: ["0xdeadbeef", "0xcafebabe"] },
    ],
  },
}));

// supertest + createApp imported lazily after the vi.mock above is in effect
import request from "supertest";
import { createApp } from "../../src/app";
const app = createApp();

afterEach(() => restoreFetch());

describe("GET /v1/chains", () => {
  it("returns every supported chain with stable shape", async () => {
    const res = await request(app).get("/v1/chains");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);

    const chains = res.body.data;
    const ids = chains.map((c: any) => c.chainId).sort();
    expect(ids).toEqual([56, 1135, 8453].sort());

    for (const c of chains) {
      expect(c).toMatchObject({
        chainId: expect.any(Number),
        name: expect.any(String),
        symbol: expect.any(String),
      });
      expect(c.diamond).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(c.usdc).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(c.paymentDecimals.USDC).toBeGreaterThan(0);
    }
  });
});

describe("GET /v1/me", () => {
  it("rejects with 401 + envelope when no Authorization header", async () => {
    const res = await request(app).get("/v1/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("rejects with 401 when the bearer fails the Rift /user/me check", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": { status: 401, json: { error: "bad token" } },
    });
    const res = await request(app).get("/v1/me").set("Authorization", "Bearer bogus");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("returns the parsed user identity when the bearer is valid", async () => {
    installFetchMock({
      "https://payment.riftfi.xyz/user/me": {
        status: 200,
        json: {
          user: {
            address: "0xCAB3147911130FCD3B08FCE2EF4BF1E28F76E894",
            email: "anthony@blockfinax.com",
            phoneNumber: null,
            externalId: null,
            user: "user-uuid-1",
          },
        },
      },
    });
    const res = await request(app).get("/v1/me").set("Authorization", "Bearer good-token-xyz");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      address: "0xcab3147911130fcd3b08fce2ef4bf1e28f76e894",
      email: "anthony@blockfinax.com",
      phoneNumber: null,
      externalId: null,
      user: "user-uuid-1",
    });
  });
});

describe("GET /v1/governance/owner", () => {
  it("returns owner + pendingOwner from the Ownership facet", async () => {
    const res = await request(app).get("/v1/governance/owner?chainId=8453");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      chainId: 8453,
      owner: "0x1111111111111111111111111111111111111111",
      pendingOwner: "0x2222222222222222222222222222222222222222",
    });
  });

  it("rejects with 400 when chainId is missing", async () => {
    const res = await request(app).get("/v1/governance/owner");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("rejects with 400 for an unsupported chainId", async () => {
    const res = await request(app).get("/v1/governance/owner?chainId=999");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Unsupported chainId/);
  });
});

describe("GET /v1/governance/facets", () => {
  it("returns the Diamond facet list", async () => {
    const res = await request(app).get("/v1/governance/facets?chainId=8453");
    expect(res.status).toBe(200);
    expect(res.body.data.facets).toHaveLength(1);
    expect(res.body.data.facets[0].facetAddress.toLowerCase())
      .toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(res.body.data.facets[0].functionSelectors).toEqual(["0xdeadbeef", "0xcafebabe"]);
  });
});

describe("GET /v1/hedge/fees", () => {
  it("returns the active fee config", async () => {
    const res = await request(app).get("/v1/hedge/fees?chainId=8453");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      chainId: 8453,
      creationFee: "2000000",
      hedgerFeeRate: "5000",
      payoutFeeRate: "10000",
      lpProfitFeeRate: "10000",
      creatorLoyaltyRate: "50000",
    });
  });
});
