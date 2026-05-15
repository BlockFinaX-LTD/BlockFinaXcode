/**
 * Integration tests for /v1/hedge/events/* + /v1/hedge/positions/* + /v1/hedge/deposits/*.
 *
 * Every endpoint is stubbed at the reader.ts boundary so we can verify the
 * full HTTP serialization (BigInt → string, Date → ISO, nested fields)
 * without dialing an RPC.
 */

import { describe, it, expect, vi } from "vitest";
import { makeReaderMock } from "../helpers/reader-mock";

// Fixtures returned by the stubbed hedge facet
const EVENT_1 = {
  id: 1n,
  creator: "0xCAB3147911130FCD3B08FCE2EF4BF1E28F76E894",
  name: "USD/GHS",
  underlying: "USD/GHS",
  strike: 11_400_000n,
  premiumRate: 10_000n,
  expiryDate: 1_775_674_775n,
  status: 1,
  poolOpen: true,
  allowExternalLp: true,
  initialRate: 11_068_576n,
  strikeAbove: true,
};
const STATS_1 = {
  settlementPrice: 11_101_823n,
  triggered: false,
  settledAt: 1_775_676_533n,
  creatorEarnings: 25_000n,
  totalLiquidity: 10_000_000n,
  totalExposure: 100_000_000n,
  totalPremiums: 1_000_000n,
  lpCount: 1n,
  hedgerCount: 1n,
  totalMaxPayout: 2_994_278n,
};
const RANGE_1 = {
  strike: 11_400_000n,
  payoutCap: 0n,
  initialRate: 11_068_576n,
  strikeAbove: true,
};
const POSITION_7 = {
  id: 7n,
  eventId: 1n,
  hedger: "0xdead000000000000000000000000000000000001",
  notional: 100_000_000n,
  premiumPaid: 1_000_000n,
  platformFeePaid: 500_000n,
  payoutAmount: 0n,
  status: 1,
  claimed: false,
};
const DEPOSIT_3 = {
  id: 3n,
  eventId: 1n,
  lp: "0xdead000000000000000000000000000000000002",
  amount: 10_000_000n,
  shares: 10_000_000n,
  premiumsEarned: 950_000n,
  premiumsClaimed: 0n,
  withdrawn: false,
};
const UTIL_1 = {
  totalLiquidity: 10_000_000n,
  totalExposure: 100_000_000n,
  availableCapacity: 7_005_722n,
  utilizationRate: 29_942_780n,
};

vi.mock("../../src/lib/reader", () => makeReaderMock({
  hedge: {
    // The route coerces :id to a JS number (z.coerce.number), so the stub
    // is called with `1`, not `1n`. Compare numerically so 404 only fires
    // on truly missing IDs.
    getHedgeEventCore:    (id: number | bigint) => {
      if (Number(id) === 1) return EVENT_1;
      const e = new Error("missing event"); (e as any).code = "CALL_EXCEPTION"; throw e;
    },
    getHedgeEventStats:   () => STATS_1,
    getHedgeEventRange:   () => RANGE_1,
    getPoolUtilization:   () => UTIL_1,
    getHedgePosition:     () => POSITION_7,
    getHedgeLpDeposit:    () => DEPOSIT_3,
    getEventPositionIds:  () => [7n],
    getEventDepositIds:   () => [3n],
    getHedgerPositionIds: () => [7n, 8n],
    getLpDepositIds:      () => [3n],
    getCreatorEventIds:   () => [1n],
    getTotalHedgeEvents:  () => 4n,
    pendingPremiums:      () => 12_345n,
    // hypoSettlement + notional arrive as decimal-strings via query params;
    // BigInt them before the math so we don't trip "mix BigInt and other types".
    quoteRangePayout:     (_eId: any, hypo: any, notional: any) =>
      (BigInt(hypo) - 11_400_000n) * BigInt(notional) / 11_068_576n,
    // ── Protocol-level views ───────────────────────────────────────────
    isPaused:                () => false,
    isFeesInitialized:       () => true,
    getHedgePlatformFees:    () => 1_234_567n,
    getPlatformFeesByToken:  () => 999_888n,
    isAllowedPaymentToken:   () => true,
    getEventPaymentToken:    () => "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    getEventQuoteSigner:     () => "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa",
    getPricingEngineSigner:  () => "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb",
    isQuoteNonceUsed:        () => false,
  },
}));

import request from "supertest";
import { createApp } from "../../src/app";
const app = createApp();

describe("GET /v1/hedge/events/:chainId/:id", () => {
  it("returns the event with BigInt fields serialized as strings", async () => {
    const res = await request(app).get("/v1/hedge/events/8453/1");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      chainId: 8453,
      id: 1,
      creator: EVENT_1.creator, // address case preserved
      name: "USD/GHS",
      underlying: "USD/GHS",
      strike: "11400000",
      premiumRate: "10000",
      expiryDate: 1775674775,
      status: 1,
      poolOpen: true,
      allowExternalLp: true,
      initialRate: "11068576",
      strikeAbove: true,
    });
  });

  it("returns 404 when the contract reverts on lookup", async () => {
    const res = await request(app).get("/v1/hedge/events/8453/999");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("rejects an unsupported chainId via validation", async () => {
    const res = await request(app).get("/v1/hedge/events/foo/1");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });
});

describe("GET /v1/hedge/events/:chainId/:id/stats", () => {
  it("returns settlement + aggregate fields", async () => {
    const res = await request(app).get("/v1/hedge/events/8453/1/stats");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      chainId: 8453,
      id: 1,
      settlementPrice: "11101823",
      triggered: false,
      settledAt: 1775676533,
      lpCount: 1,
      hedgerCount: 1,
      totalLiquidity: "10000000",
      totalExposure: "100000000",
    });
  });
});

describe("GET /v1/hedge/events/:chainId/:id/range", () => {
  it("returns the range parameters", async () => {
    const res = await request(app).get("/v1/hedge/events/8453/1/range");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      strike: "11400000",
      payoutCap: "0",
      initialRate: "11068576",
      strikeAbove: true,
    });
  });
});

describe("GET /v1/hedge/events/:chainId/:id/utilization", () => {
  it("returns capacity + utilization in the contract shape", async () => {
    const res = await request(app).get("/v1/hedge/events/8453/1/utilization");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      totalLiquidity: "10000000",
      totalExposure: "100000000",
      availableCapacity: "7005722",
      utilizationRate: "29942780",
    });
  });
});

describe("GET /v1/hedge/events/:chainId/:id/positions", () => {
  it("returns position IDs as strings", async () => {
    const res = await request(app).get("/v1/hedge/events/8453/1/positions");
    expect(res.status).toBe(200);
    expect(res.body.data.positionIds).toEqual(["7"]);
    expect(res.body.data.eventId).toBe(1);
  });
});

describe("GET /v1/hedge/events/:chainId/:id/deposits", () => {
  it("returns deposit IDs as strings", async () => {
    const res = await request(app).get("/v1/hedge/events/8453/1/deposits");
    expect(res.status).toBe(200);
    expect(res.body.data.depositIds).toEqual(["3"]);
  });
});

describe("GET /v1/hedge/events/:chainId/total", () => {
  it("returns the event count as a number (small enough that Number is fine)", async () => {
    const res = await request(app).get("/v1/hedge/events/8453/total");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ chainId: 8453, total: 4 });
  });
});

describe("GET /v1/hedge/positions/:chainId/:id", () => {
  it("returns the position record with platformFeePaid", async () => {
    const res = await request(app).get("/v1/hedge/positions/8453/7");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: 7,
      eventId: 1,
      hedger: POSITION_7.hedger,
      notional: "100000000",
      premiumPaid: "1000000",
      platformFeePaid: "500000",
      payoutAmount: "0",
      status: 1,
      claimed: false,
    });
  });
});

describe("GET /v1/hedge/positions/:chainId/wallet/:addr", () => {
  it("returns position IDs for a wallet", async () => {
    const res = await request(app).get("/v1/hedge/positions/8453/wallet/0xdead000000000000000000000000000000000001");
    expect(res.status).toBe(200);
    expect(res.body.data.positionIds).toEqual(["7", "8"]);
    expect(res.body.data.wallet).toBe("0xdead000000000000000000000000000000000001");
  });

  it("rejects malformed wallet address", async () => {
    const res = await request(app).get("/v1/hedge/positions/8453/wallet/not-an-address");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });
});

describe("GET /v1/hedge/deposits/:chainId/:id", () => {
  it("returns the LP deposit record", async () => {
    const res = await request(app).get("/v1/hedge/deposits/8453/3");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: 3,
      eventId: 1,
      lp: DEPOSIT_3.lp,
      amount: "10000000",
      shares: "10000000",
      premiumsEarned: "950000",
      premiumsClaimed: "0",
      withdrawn: false,
    });
  });
});

describe("GET /v1/hedge/deposits/:chainId/wallet/:addr", () => {
  it("returns deposit IDs for a wallet", async () => {
    const res = await request(app).get("/v1/hedge/deposits/8453/wallet/0xdead000000000000000000000000000000000002");
    expect(res.status).toBe(200);
    expect(res.body.data.depositIds).toEqual(["3"]);
  });
});

describe("GET /v1/hedge/creators/:chainId/wallet/:addr", () => {
  it("returns event IDs created by a wallet", async () => {
    const res = await request(app).get("/v1/hedge/creators/8453/wallet/0xcab3147911130fcd3b08fce2ef4bf1e28f76e894");
    expect(res.status).toBe(200);
    expect(res.body.data.eventIds).toEqual(["1"]);
  });
});

describe("GET /v1/hedge/quote-payout/:chainId/:id", () => {
  it("returns the hypothetical payout from the contract view", async () => {
    const res = await request(app).get("/v1/hedge/quote-payout/8453/1?hypoSettlement=12000000&notional=100000000");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      chainId: 8453,
      eventId: 1,
      hypoSettlement: "12000000",
      notional: "100000000",
    });
    expect(typeof res.body.data.payout).toBe("string");
    expect(BigInt(res.body.data.payout)).toBeGreaterThan(0n);
  });

  it("rejects when required query params are missing", async () => {
    const res = await request(app).get("/v1/hedge/quote-payout/8453/1");
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/hedge/deposits/:chainId/:id/pending", () => {
  it("returns unclaimed premiums for a deposit", async () => {
    const res = await request(app).get("/v1/hedge/deposits/8453/3/pending");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ chainId: 8453, depositId: 3, pendingPremiums: "12345" });
  });
});

describe("Protocol-level views", () => {
  it("GET /v1/hedge/paused/:chainId returns the pause flag", async () => {
    const res = await request(app).get("/v1/hedge/paused/8453");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ chainId: 8453, paused: false });
  });

  it("GET /v1/hedge/fees-initialized/:chainId returns the init flag", async () => {
    const res = await request(app).get("/v1/hedge/fees-initialized/8453");
    expect(res.body.data).toEqual({ chainId: 8453, initialized: true });
  });

  it("GET /v1/hedge/platform-fees/:chainId returns accumulated USDC fees", async () => {
    const res = await request(app).get("/v1/hedge/platform-fees/8453");
    expect(res.body.data).toEqual({ chainId: 8453, fees: "1234567" });
  });

  it("GET /v1/hedge/platform-fees/:chainId/by-token/:token returns per-token fees", async () => {
    const res = await request(app).get("/v1/hedge/platform-fees/8453/by-token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(res.body.data).toEqual({
      chainId: 8453,
      token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      fees: "999888",
    });
  });

  it("GET /v1/hedge/payment-tokens/:chainId/:token reports whether a token is accepted", async () => {
    const res = await request(app).get("/v1/hedge/payment-tokens/8453/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(res.body.data.allowed).toBe(true);
  });

  it("GET /v1/hedge/payment-tokens validates the token shape", async () => {
    const res = await request(app).get("/v1/hedge/payment-tokens/8453/not-an-address");
    expect(res.status).toBe(400);
  });

  it("GET /v1/hedge/events/:chainId/:id/payment-token returns the event's payment token", async () => {
    const res = await request(app).get("/v1/hedge/events/8453/1/payment-token");
    expect(res.body.data.token).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  });

  it("GET /v1/hedge/events/:chainId/:id/quote-signer returns the signer attestation", async () => {
    const res = await request(app).get("/v1/hedge/events/8453/1/quote-signer");
    expect(res.body.data.signer).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("GET /v1/hedge/pricing-engine-signer/:chainId returns the configured signer", async () => {
    const res = await request(app).get("/v1/hedge/pricing-engine-signer/8453");
    expect(res.body.data.signer).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("GET /v1/hedge/quote-nonce-used/:chainId/:nonce reports nonce consumption", async () => {
    const nonce = "0x" + "1".repeat(64);
    const res = await request(app).get(`/v1/hedge/quote-nonce-used/8453/${nonce}`);
    expect(res.body.data.used).toBe(false);
  });

  it("GET /v1/hedge/quote-nonce-used validates the nonce shape", async () => {
    const res = await request(app).get("/v1/hedge/quote-nonce-used/8453/not-a-bytes32");
    expect(res.status).toBe(400);
  });
});
