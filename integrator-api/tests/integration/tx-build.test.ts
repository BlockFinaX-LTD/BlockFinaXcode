/**
 * Integration tests for every calldata-builder endpoint at /v1/tx/*.
 *
 * Each test:
 *   1. POSTs a typical args body
 *   2. Confirms the BuiltTx envelope shape
 *   3. Decodes `data` with ethers.Interface and asserts every arg
 *      round-trips exactly — this is the integrator API's core contract.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import { ethers } from "ethers";
import { createApp } from "../../src/app";
import {
  HEDGE_FACET_ABI, ORACLE_FACET_ABI, OWNERSHIP_FACET_ABI, TIMELOCK_FACET_ABI, ERC20_ABI,
} from "../../src/lib/abi";
import { getChain } from "../../src/lib/chains";

const app = createApp();
const DIAMOND_BASE = getChain(8453).diamond.toLowerCase();

function decode(abi: readonly string[], fnName: string, data: string) {
  return new ethers.Interface(abi as string[]).decodeFunctionData(fnName, data);
}

describe("POST /v1/tx/erc20/approve", () => {
  it("builds approve calldata pointing at the token (not the spender)", async () => {
    const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const res = await request(app).post("/v1/tx/erc20/approve").send({
      chainId: 8453, token: usdc, spender: DIAMOND_BASE, amount: "120000000",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.to.toLowerCase()).toBe(usdc.toLowerCase());
    expect(res.body.data.function).toBe("approve");

    const decoded = decode(ERC20_ABI, "approve", res.body.data.data);
    expect(String(decoded[0]).toLowerCase()).toBe(DIAMOND_BASE);
    expect(decoded[1]).toBe(120_000_000n);
  });

  it("rejects with 400 when token is missing", async () => {
    const res = await request(app).post("/v1/tx/erc20/approve").send({ chainId: 8453, spender: DIAMOND_BASE, amount: "1" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("rejects with 400 when amount is negative-ish (must be a non-negative integer string)", async () => {
    const res = await request(app).post("/v1/tx/erc20/approve").send({
      chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      spender: DIAMOND_BASE, amount: "-1",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/tx/hedge/buy-protection", () => {
  it("builds buyProtection calldata against the Diamond", async () => {
    const res = await request(app).post("/v1/tx/hedge/buy-protection").send({
      chainId: 8453, eventId: 1, notional: "100000000", maxCost: "110000000", deadline: "9999999999",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.to.toLowerCase()).toBe(DIAMOND_BASE);
    expect(res.body.data.function).toBe("buyProtection");

    const decoded = decode(HEDGE_FACET_ABI, "buyProtection", res.body.data.data);
    expect(decoded[0]).toBe(1n);
    expect(decoded[1]).toBe(100_000_000n);
    expect(decoded[2]).toBe(110_000_000n);
    expect(decoded[3]).toBe(9_999_999_999n);
  });

  it("rejects with 400 when a required field is missing", async () => {
    const res = await request(app).post("/v1/tx/hedge/buy-protection").send({ chainId: 8453, eventId: 1 });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/tx/hedge/create-event", () => {
  it("builds createEvent calldata that decodes back to the typed tuple", async () => {
    const res = await request(app).post("/v1/tx/hedge/create-event").send({
      chainId: 8453,
      name: "USD/GHS-Q2", underlying: "USD/GHS",
      strike: "11500000", payoutCap: "0", premiumRate: "25000", expiry: "1800000000",
      allowExternalLp: true, initialLiquidity: "1000000000", initialRate: "11000000",
      strikeAbove: true, paymentToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      signature: "0x", quoteTimestamp: "0", quoteNonce: ethers.ZeroHash,
    });
    expect(res.status).toBe(200);
    const tuple = decode(HEDGE_FACET_ABI, "createEvent", res.body.data.data)[0];
    expect(tuple.name).toBe("USD/GHS-Q2");
    expect(tuple.underlying).toBe("USD/GHS");
    expect(tuple.strike).toBe(11_500_000n);
    expect(tuple.allowExternalLp).toBe(true);
    expect(tuple.strikeAbove).toBe(true);
    expect(tuple.paymentToken.toLowerCase()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  });

  it("applies safe defaults for the v8 pricing-attestation fields", async () => {
    const res = await request(app).post("/v1/tx/hedge/create-event").send({
      chainId: 8453,
      name: "USD/NGN", underlying: "USD/NGN",
      strike: "1000000000", payoutCap: "0", premiumRate: "30000", expiry: "1800000000",
      allowExternalLp: true, initialLiquidity: "1000000000", initialRate: "950000000",
      strikeAbove: true, paymentToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      // signature / quoteTimestamp / quoteNonce intentionally omitted
    });
    expect(res.status).toBe(200);
    const tuple = decode(HEDGE_FACET_ABI, "createEvent", res.body.data.data)[0];
    expect(tuple.signature).toBe("0x");
    expect(tuple.quoteTimestamp).toBe(0n);
    expect(tuple.quoteNonce).toBe(ethers.ZeroHash);
  });
});

describe("POST /v1/tx/hedge/deposit", () => {
  it("builds deposit(eventId, amount)", async () => {
    const res = await request(app).post("/v1/tx/hedge/deposit").send({
      chainId: 8453, eventId: 2, amount: "5000000",
    });
    expect(res.status).toBe(200);
    const decoded = decode(HEDGE_FACET_ABI, "deposit", res.body.data.data);
    expect(decoded[0]).toBe(2n);
    expect(decoded[1]).toBe(5_000_000n);
  });
});

describe("POST /v1/tx/hedge/claim-payout, /claim-premiums, /withdraw-capital", () => {
  it.each([
    ["claim-payout",      "claimPayout"],
    ["claim-premiums",    "claimPremiums"],
    ["withdraw-capital",  "withdrawCapital"],
  ] as const)("%s encodes a single uint256 id", async (path, fn) => {
    const idField = fn === "claimPayout" ? "positionId" : "depositId";
    const res = await request(app).post(`/v1/tx/hedge/${path}`).send({ chainId: 8453, [idField]: 4 });
    expect(res.status).toBe(200);
    expect(decode(HEDGE_FACET_ABI, fn, res.body.data.data)[0]).toBe(4n);
  });
});

describe("POST /v1/tx/hedge/set-pool-settings (creator)", () => {
  it("encodes (eventId, poolOpen, allowExternalLp)", async () => {
    const res = await request(app).post("/v1/tx/hedge/set-pool-settings").send({
      chainId: 8453, eventId: 1, poolOpen: true, allowExternalLp: false,
    });
    expect(res.status).toBe(200);
    const decoded = decode(HEDGE_FACET_ABI, "setPoolSettings", res.body.data.data);
    expect(decoded[0]).toBe(1n);
    expect(decoded[1]).toBe(true);
    expect(decoded[2]).toBe(false);
  });
});

describe("POST /v1/tx/hedge/withdraw-creator-earnings + /recover-expired-payouts", () => {
  it.each([
    ["withdraw-creator-earnings", "withdrawCreatorEarnings"],
    ["recover-expired-payouts",   "recoverExpiredPayouts"],
  ] as const)("%s encodes a single eventId", async (path, fn) => {
    const res = await request(app).post(`/v1/tx/hedge/${path}`).send({ chainId: 8453, eventId: 9 });
    expect(res.status).toBe(200);
    expect(decode(HEDGE_FACET_ABI, fn, res.body.data.data)[0]).toBe(9n);
  });
});

describe("Admin (Hedge) builders", () => {
  it("initialize-fees encodes the 5-tuple of rates", async () => {
    const res = await request(app).post("/v1/tx/hedge/initialize-fees").send({
      chainId: 8453,
      creationFee: "2000000", hedgerFeeRate: "5000",
      payoutFeeRate: "10000", lpProfitFeeRate: "10000", creatorLoyaltyRate: "50000",
    });
    expect(res.status).toBe(200);
    const decoded = decode(HEDGE_FACET_ABI, "initializeHedgeFees", res.body.data.data);
    expect(decoded.map((v: any) => String(v))).toEqual(["2000000","5000","10000","10000","50000"]);
  });

  it("settle-event encodes (eventId, price)", async () => {
    const res = await request(app).post("/v1/tx/hedge/settle-event").send({
      chainId: 8453, eventId: 1, settlementPrice: "11200000",
    });
    const decoded = decode(HEDGE_FACET_ABI, "settleEvent", res.body.data.data);
    expect(decoded[0]).toBe(1n);
    expect(decoded[1]).toBe(11_200_000n);
  });

  it.each([
    ["pause",                "pause"],
    ["unpause",              "unpause"],
    ["activate-oracle-v2",   "activateOracleV2"],
  ] as const)("/hedge/%s is a no-arg call (selector only)", async (path, fn) => {
    const res = await request(app).post(`/v1/tx/hedge/${path}`).send({ chainId: 8453 });
    expect(res.status).toBe(200);
    // data should equal the 4-byte selector for this function
    const selector = new ethers.Interface(HEDGE_FACET_ABI).getFunction(fn)!.selector;
    expect(res.body.data.data).toBe(selector);
  });

  it.each([
    ["set-oracle-admin",          "setOracleAdmin"],
    ["set-pricing-engine-signer", "setPricingEngineSigner"],
  ] as const)("/hedge/%s encodes a single address", async (path, fn) => {
    const addr = "0x1111111111111111111111111111111111111111";
    const res = await request(app).post(`/v1/tx/hedge/${path}`).send({ chainId: 8453, address: addr });
    expect(res.status).toBe(200);
    const decoded = decode(HEDGE_FACET_ABI, fn, res.body.data.data);
    expect(String(decoded[0]).toLowerCase()).toBe(addr);
  });

  it("withdraw-platform-fees encodes a single uint256", async () => {
    const res = await request(app).post("/v1/tx/hedge/withdraw-platform-fees").send({ chainId: 8453, amount: "1500000" });
    expect(decode(HEDGE_FACET_ABI, "withdrawPlatformFees", res.body.data.data)[0]).toBe(1_500_000n);
  });

  it("set-allowed-payment-token encodes (token, allowed)", async () => {
    const res = await request(app).post("/v1/tx/hedge/set-allowed-payment-token").send({
      chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", allowed: true,
    });
    const decoded = decode(HEDGE_FACET_ABI, "setAllowedPaymentToken", res.body.data.data);
    expect(String(decoded[0]).toLowerCase()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(decoded[1]).toBe(true);
  });

  it("withdraw-platform-fees-by-token encodes (token, amount)", async () => {
    const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const res = await request(app).post("/v1/tx/hedge/withdraw-platform-fees-by-token").send({
      chainId: 8453, token, amount: "750000",
    });
    expect(res.status).toBe(200);
    const decoded = decode(HEDGE_FACET_ABI, "withdrawPlatformFeesByToken", res.body.data.data);
    expect(String(decoded[0]).toLowerCase()).toBe(token.toLowerCase());
    expect(decoded[1]).toBe(750_000n);
  });

  it("rescue-eth encodes (to)", async () => {
    const to = "0x4444444444444444444444444444444444444444";
    const res = await request(app).post("/v1/tx/hedge/rescue-eth").send({ chainId: 8453, to });
    expect(res.status).toBe(200);
    const decoded = decode(HEDGE_FACET_ABI, "rescueETH", res.body.data.data);
    expect(String(decoded[0]).toLowerCase()).toBe(to);
  });

  it("rescue-erc20 encodes (token, to)", async () => {
    const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const to = "0x5555555555555555555555555555555555555555";
    const res = await request(app).post("/v1/tx/hedge/rescue-erc20").send({ chainId: 8453, token, to });
    expect(res.status).toBe(200);
    const decoded = decode(HEDGE_FACET_ABI, "rescueERC20", res.body.data.data);
    expect(String(decoded[0]).toLowerCase()).toBe(token.toLowerCase());
    expect(String(decoded[1]).toLowerCase()).toBe(to);
  });
});

describe("Oracle admin extras", () => {
  it("clear-stale-submissions encodes (eventId)", async () => {
    const res = await request(app).post("/v1/tx/oracle/clear-stale-submissions").send({
      chainId: 8453, eventId: 7,
    });
    expect(res.status).toBe(200);
    const decoded = decode(ORACLE_FACET_ABI, "clearStaleSubmissions", res.body.data.data);
    expect(decoded[0]).toBe(7n);
  });
});

describe("Oracle builders", () => {
  it("submit-rate encodes (eventId, price)", async () => {
    const res = await request(app).post("/v1/tx/oracle/submit-rate").send({
      chainId: 8453, eventId: 5, price: "11250000",
    });
    const decoded = decode(ORACLE_FACET_ABI, "submitRate", res.body.data.data);
    expect(decoded[0]).toBe(5n);
    expect(decoded[1]).toBe(11_250_000n);
  });

  it.each([
    ["add-oracle",    "addOracle"],
    ["remove-oracle", "removeOracle"],
  ] as const)("/oracle/%s encodes an address", async (path, fn) => {
    const addr = "0x2222222222222222222222222222222222222222";
    const res = await request(app).post(`/v1/tx/oracle/${path}`).send({ chainId: 8453, address: addr });
    expect(res.status).toBe(200);
    const decoded = decode(ORACLE_FACET_ABI, fn, res.body.data.data);
    expect(String(decoded[0]).toLowerCase()).toBe(addr);
  });

  it.each([
    ["set-required-signers", "setRequiredSigners", "value", "3"],
    ["set-tolerance-bps",    "setToleranceBps",    "value", "700"],
  ] as const)("/oracle/%s encodes a single uint256", async (path, fn, _field, val) => {
    const res = await request(app).post(`/v1/tx/oracle/${path}`).send({ chainId: 8453, value: val });
    expect(decode(ORACLE_FACET_ABI, fn, res.body.data.data)[0]).toBe(BigInt(val));
  });
});

describe("Ownership builders", () => {
  it("transfer-ownership encodes the new owner", async () => {
    const addr = "0x3333333333333333333333333333333333333333";
    const res = await request(app).post("/v1/tx/ownership/transfer-ownership").send({ chainId: 8453, address: addr });
    expect(res.status).toBe(200);
    const decoded = decode(OWNERSHIP_FACET_ABI, "transferOwnership", res.body.data.data);
    expect(String(decoded[0]).toLowerCase()).toBe(addr);
  });

  it("accept-ownership is a no-arg call", async () => {
    const res = await request(app).post("/v1/tx/ownership/accept-ownership").send({ chainId: 8453 });
    expect(res.status).toBe(200);
    const selector = new ethers.Interface(OWNERSHIP_FACET_ABI).getFunction("acceptOwnership")!.selector;
    expect(res.body.data.data).toBe(selector);
  });
});

describe("Governance (Timelock) builders", () => {
  const PROPOSAL_ID = "0x" + "ab".repeat(32);

  it("diamond-cut encodes (cuts[], init, initData)", async () => {
    const facetA = "0x1111111111111111111111111111111111111111";
    const facetB = "0x2222222222222222222222222222222222222222";
    const res = await request(app).post("/v1/tx/governance/diamond-cut").send({
      chainId: 8453,
      cuts: [
        { facetAddress: facetA, action: 0, functionSelectors: ["0xdeadbeef", "0xcafebabe"] },
        { facetAddress: facetB, action: 1, functionSelectors: ["0x11112222"] },
      ],
      // init + initData omitted — should default to ZeroAddress + "0x"
    });
    expect(res.status).toBe(200);
    const decoded: any = decode(TIMELOCK_FACET_ABI, "diamondCut", res.body.data.data);
    expect(decoded[0]).toHaveLength(2);
    expect(decoded[0][0][0].toLowerCase()).toBe(facetA);
    expect(decoded[0][0][1]).toBe(0n);
    expect(decoded[0][0][2]).toEqual(["0xdeadbeef", "0xcafebabe"]);
    expect(decoded[0][1][1]).toBe(1n);
    expect(decoded[1]).toBe(ethers.ZeroAddress);
    expect(decoded[2]).toBe("0x");
  });

  it("diamond-cut respects an explicit init + initData", async () => {
    const init = "0x3333333333333333333333333333333333333333";
    const res = await request(app).post("/v1/tx/governance/diamond-cut").send({
      chainId: 8453,
      cuts: [{ facetAddress: "0x1111111111111111111111111111111111111111", action: 2, functionSelectors: [] }],
      init,
      initData: "0xdeadbeef",
    });
    expect(res.status).toBe(200);
    const decoded: any = decode(TIMELOCK_FACET_ABI, "diamondCut", res.body.data.data);
    expect(decoded[1].toLowerCase()).toBe(init);
    expect(decoded[2]).toBe("0xdeadbeef");
  });

  it("diamond-cut rejects an invalid action enum (must be 0/1/2)", async () => {
    const res = await request(app).post("/v1/tx/governance/diamond-cut").send({
      chainId: 8453,
      cuts: [{ facetAddress: "0x1111111111111111111111111111111111111111", action: 9, functionSelectors: [] }],
    });
    expect(res.status).toBe(400);
  });

  it("diamond-cut rejects malformed selectors", async () => {
    const res = await request(app).post("/v1/tx/governance/diamond-cut").send({
      chainId: 8453,
      cuts: [{ facetAddress: "0x1111111111111111111111111111111111111111", action: 0, functionSelectors: ["0xtoo-short"] }],
    });
    expect(res.status).toBe(400);
  });

  it.each([
    ["execute-cut", "executeCut"],
    ["cancel-cut",  "cancelCut"],
  ] as const)("/governance/%s encodes (proposalId)", async (path, fn) => {
    const res = await request(app).post(`/v1/tx/governance/${path}`).send({
      chainId: 8453, proposalId: PROPOSAL_ID,
    });
    expect(res.status).toBe(200);
    const decoded = decode(TIMELOCK_FACET_ABI, fn, res.body.data.data);
    expect(decoded[0]).toBe(PROPOSAL_ID);
  });

  it.each(["execute-cut", "cancel-cut"] as const)("/governance/%s rejects malformed proposalId", async (path) => {
    const res = await request(app).post(`/v1/tx/governance/${path}`).send({
      chainId: 8453, proposalId: "0xshort",
    });
    expect(res.status).toBe(400);
  });
});

describe("Cross-cutting envelope guarantees", () => {
  it("every BuiltTx echoes chainId / function / args / value / estimatedGas keys", async () => {
    const res = await request(app).post("/v1/tx/hedge/buy-protection").send({
      chainId: 8453, eventId: 1, notional: "100000000", maxCost: "110000000", deadline: "9999999999",
    });
    const tx = res.body.data;
    expect(tx).toHaveProperty("chainId", 8453);
    expect(tx).toHaveProperty("to");
    expect(tx).toHaveProperty("data");
    expect(tx).toHaveProperty("value");
    expect(tx).toHaveProperty("function", "buyProtection");
    expect(tx).toHaveProperty("args");
    expect(tx).toHaveProperty("estimatedGas");
    expect(typeof tx.value).toBe("string");
  });
});
