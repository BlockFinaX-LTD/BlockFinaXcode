/**
 * Integration tests for /v1/pricing/* — the proxy to the upstream pricing
 * engine. We stub global fetch so the upstream URL doesn't get dialed.
 *
 *   POST /v1/pricing/quote       — quote a fair premium (optionally signed)
 *   GET  /v1/pricing/health      — full diagnostic
 *   GET  /v1/pricing/signer      — just the signer address
 */

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { installFetchMock, restoreFetch } from "../helpers/fetch-mock";

const app = createApp();
const PRICING_URL = process.env.PRICING_ENGINE_URL || "http://localhost:5000";

afterEach(() => restoreFetch());

describe("POST /v1/pricing/quote", () => {
  const validBody = {
    pair: "USD/GHS",
    strike: 11.4,
    payoutCap: 12.0,
    expiryUnixSeconds: Math.floor(Date.now() / 1000) + 86_400,
    notional: 100,
    strikeAbove: true,
  };

  it("forwards the body upstream and returns the engine's response inside the data envelope", async () => {
    const upstream = {
      premiumRate: 0.023,
      premiumUsd: 2.3,
      maxPayoutUsd: 5.26,
      premiumRateFixed6: "23000",
      attestation: null,
      breakdown: {
        pair: "USD/GHS", spot: 11.07, strike: 11.4, payoutCap: 12.0,
        rangeWidth: 0.6, T_years: 0.0027, T_days: 1,
        notional: 100, direction: "upward", coveragePercent: 1.99,
        inputs: { r: 0.045, q: null, mu: 0.12, qEffective: -0.075, sigma: 0.21, sigmaRealizedRaw: 0.18, volMarkup: 0.17 },
        method: "garman-kohlhagen-with-empirical-drift",
        pairClassification: { tier: "frontierEM", useEmpiricalDrift: true, notes: null },
      },
    };

    let capturedBody: any = null;
    installFetchMock({
      [`${PRICING_URL}/api/pricing/quote`]: async (_url, init: any) => {
        capturedBody = init?.body ? JSON.parse(init.body) : null;
        return { status: 200, json: upstream };
      },
    });

    const res = await request(app).post("/v1/pricing/quote").send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(upstream);
    expect(capturedBody.pair).toBe("USD/GHS");
    expect(capturedBody.strike).toBe(11.4);
  });

  it("returns the signed attestation when chainId + diamondAddress + creator are all set", async () => {
    const upstream = {
      premiumRate: 0.025, premiumUsd: 2.5, maxPayoutUsd: 5.26, premiumRateFixed6: "25000",
      attestation: {
        signature: "0x" + "ab".repeat(65),
        quoteTimestamp: "1775676000",
        quoteNonce: "0x" + "cd".repeat(32),
        signerAddress: "0xAaAaaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
        expiresAt: "1775676120",
      },
      breakdown: { /* doesn't matter for this test */ } as any,
    };
    installFetchMock({
      [`${PRICING_URL}/api/pricing/quote`]: { status: 200, json: upstream },
    });

    const res = await request(app).post("/v1/pricing/quote").send({
      ...validBody,
      chainId: 8453,
      diamondAddress: "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
      creator: "0xCAB3147911130FCD3B08FCE2EF4BF1E28F76E894",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.attestation).toMatchObject({ signerAddress: upstream.attestation.signerAddress });
  });

  it("rejects with 400 when attestation context is incomplete (some but not all set)", async () => {
    const res = await request(app).post("/v1/pricing/quote").send({
      ...validBody,
      chainId: 8453,
      // diamondAddress + creator missing
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(res.body.error.message).toMatch(/all be provided together/);
  });

  it("maps upstream 400 to our validation_error envelope", async () => {
    installFetchMock({
      [`${PRICING_URL}/api/pricing/quote`]: {
        status: 400,
        json: { error: "Quote rejected: max_payout/premium = 250x exceeds safety cap of 100x" },
      },
    });
    const res = await request(app).post("/v1/pricing/quote").send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(res.body.error.message).toMatch(/max_payout\/premium/);
  });

  it("maps upstream 5xx to upstream_error (502)", async () => {
    installFetchMock({
      [`${PRICING_URL}/api/pricing/quote`]: { status: 500, json: { error: "engine crashed" } },
    });
    const res = await request(app).post("/v1/pricing/quote").send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("upstream_error");
  });

  it("returns 503 service_unavailable when upstream is unreachable", async () => {
    installFetchMock({
      [`${PRICING_URL}/api/pricing/quote`]: () => { throw new Error("ECONNREFUSED"); },
    });
    const res = await request(app).post("/v1/pricing/quote").send(validBody);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("service_unavailable");
    expect(res.body.error.message).toMatch(/unreachable/);
  });

  it("falls back through error → message → generic when upstream body has none", async () => {
    installFetchMock({
      [`${PRICING_URL}/api/pricing/quote`]: { status: 502, json: { /* no error, no message */ } },
    });
    const res = await request(app).post("/v1/pricing/quote").send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error.message).toMatch(/responded 502/);
  });

  it("uses upstream `message` when `error` is absent", async () => {
    installFetchMock({
      [`${PRICING_URL}/api/pricing/quote`]: { status: 500, json: { message: "alt-field" } },
    });
    const res = await request(app).post("/v1/pricing/quote").send(validBody);
    expect(res.body.error.message).toBe("alt-field");
  });

  it("handles upstream throwing without an .message field on the error", async () => {
    installFetchMock({
      [`${PRICING_URL}/api/pricing/quote`]: () => { throw {}; },  // plain object, no .message
    });
    const res = await request(app).post("/v1/pricing/quote").send(validBody);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/unknown/);
  });

  it("handles upstream returning non-JSON (the .json().catch() arrow fires)", async () => {
    installFetchMock({
      // status 500 + a `text` body instead of `json` — fetch-mock returns text/* content
      // and r.json() will throw, exercising the `.catch(() => ({}))` arrow.
      [`${PRICING_URL}/api/pricing/quote`]: { status: 500, text: "<html>boom</html>" },
    });
    const res = await request(app).post("/v1/pricing/quote").send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error.message).toMatch(/responded 500/);
  });

  it("rejects malformed input at our boundary (zod, not upstream)", async () => {
    const res = await request(app).post("/v1/pricing/quote").send({
      pair: "USD/GHS",
      strike: -1,           // must be positive
      payoutCap: 12,
      expiryUnixSeconds: 9_999_999_999,
      notional: 100,
      strikeAbove: true,
    });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed diamondAddress at our boundary", async () => {
    const res = await request(app).post("/v1/pricing/quote").send({
      ...validBody,
      chainId: 8453,
      diamondAddress: "not-an-address",
      creator: "0xCAB3147911130FCD3B08FCE2EF4BF1E28F76E894",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/pricing/health", () => {
  it("forwards and returns the engine's health snapshot", async () => {
    const upstream = {
      usdRate: { rate: 0.0445, recordDate: "2026-05-13", fetchedAt: Date.now() },
      pricingEngineSigner: "0xAaAaaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
      pairs: [
        { pair: "USD/GHS", tier: "frontierEM", useEmpiricalDrift: true, historicalCloses: 1300 },
        { pair: "USD/NGN", tier: "frontierEM", useEmpiricalDrift: true, historicalCloses: 1300 },
      ],
    };
    installFetchMock({
      [`${PRICING_URL}/api/pricing/health`]: { status: 200, json: upstream },
    });
    const res = await request(app).get("/v1/pricing/health");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(upstream);
  });

  it("returns 502 when the engine errors", async () => {
    installFetchMock({
      [`${PRICING_URL}/api/pricing/health`]: { status: 500, json: { error: "db down" } },
    });
    const res = await request(app).get("/v1/pricing/health");
    expect(res.status).toBe(502);
  });
});

describe("GET /v1/pricing/signer", () => {
  it("returns just the signer slice from /health", async () => {
    installFetchMock({
      [`${PRICING_URL}/api/pricing/health`]: {
        status: 200,
        json: {
          usdRate: null,
          pricingEngineSigner: "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb",
          pairs: [],
        },
      },
    });
    const res = await request(app).get("/v1/pricing/signer");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ signerAddress: "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb" });
  });

  it("returns null signerAddress when the engine has no signing key configured", async () => {
    installFetchMock({
      [`${PRICING_URL}/api/pricing/health`]: {
        status: 200,
        json: { usdRate: null, pricingEngineSigner: null, pairs: [] },
      },
    });
    const res = await request(app).get("/v1/pricing/signer");
    expect(res.status).toBe(200);
    expect(res.body.data.signerAddress).toBeNull();
  });
});
