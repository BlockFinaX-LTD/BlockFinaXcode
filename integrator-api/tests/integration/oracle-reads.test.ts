/**
 * Integration tests for /v1/oracle/*.
 */

import { describe, it, expect, vi } from "vitest";
import { makeReaderMock } from "../helpers/reader-mock";

const ORACLES = [
  "0x1F038152D5e6F120E26F8F11688CB9DC27703236",
  "0x488F6090eDE627CdDF3F4F12E46FB5665eBBccfA",
];

vi.mock("../../src/lib/reader", () => makeReaderMock({
  oracle: {
    getOracles:            () => ORACLES,
    getOracleConfig:       () => ({ requiredSigners: 2n, toleranceBps: 700n, oracleCount: 2n, maxOracles: 10n }),
    isAuthorisedOracle:    (addr: string) => addr.toLowerCase() === ORACLES[0].toLowerCase(),
    getAllSubmissions:     () => ({
      oracles:    ORACLES,
      prices:     [11_120_000n, 11_125_000n],
      timestamps: [1_775_676_000n, 1_775_676_100n],
      stale:      [false, false],
    }),
    getSubmission:         () => ({ price: 11_120_000n, timestamp: 1_775_676_000n, exists: true, isStale: false }),
    getSubmitterCount:     () => 2n,
  },
}));

import request from "supertest";
import { createApp } from "../../src/app";
const app = createApp();

describe("GET /v1/oracle/oracles/:chainId", () => {
  it("returns oracle addresses lower-cased", async () => {
    const res = await request(app).get("/v1/oracle/oracles/8453");
    expect(res.status).toBe(200);
    expect(res.body.data.oracles).toEqual(ORACLES.map(a => a.toLowerCase()));
  });
});

describe("GET /v1/oracle/config/:chainId", () => {
  it("returns the consensus parameters", async () => {
    const res = await request(app).get("/v1/oracle/config/8453");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      chainId: 8453,
      requiredSigners: 2,
      toleranceBps: 700,
      oracleCount: 2,
      maxOracles: 10,
    });
  });
});

describe("GET /v1/oracle/is-authorised/:chainId/:addr", () => {
  it("returns true for an oracle address", async () => {
    const res = await request(app).get(`/v1/oracle/is-authorised/8453/${ORACLES[0]}`);
    expect(res.status).toBe(200);
    expect(res.body.data.authorised).toBe(true);
  });

  it("returns false for a non-oracle address", async () => {
    const res = await request(app).get("/v1/oracle/is-authorised/8453/0x0000000000000000000000000000000000000000");
    expect(res.status).toBe(200);
    expect(res.body.data.authorised).toBe(false);
  });

  it("validates the address shape", async () => {
    const res = await request(app).get("/v1/oracle/is-authorised/8453/not-an-address");
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/oracle/submissions/:chainId/:eventId", () => {
  it("zips the parallel arrays into a per-oracle list", async () => {
    const res = await request(app).get("/v1/oracle/submissions/8453/1");
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);
    expect(res.body.data.submissions).toHaveLength(2);
    expect(res.body.data.submissions[0]).toMatchObject({
      oracle: ORACLES[0].toLowerCase(),
      price: "11120000",
      timestamp: 1775676000,
      isStale: false,
    });
  });
});

describe("GET /v1/oracle/submission/:chainId/:eventId/:oracle", () => {
  it("returns a single oracle's submission for an event", async () => {
    const res = await request(app).get(`/v1/oracle/submission/8453/1/${ORACLES[0]}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      chainId: 8453, eventId: 1,
      oracle: ORACLES[0].toLowerCase(),
      price: "11120000",
      timestamp: 1775676000,
      exists: true,
      isStale: false,
    });
  });

  it("validates the oracle address shape", async () => {
    const res = await request(app).get("/v1/oracle/submission/8453/1/not-an-address");
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/oracle/submitter-count/:chainId/:eventId", () => {
  it("returns the submitter count", async () => {
    const res = await request(app).get("/v1/oracle/submitter-count/8453/1");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ chainId: 8453, eventId: 1, count: 2 });
  });
});
