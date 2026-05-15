/**
 * Integration tests for /v1/governance/* — the full Loupe surface plus the
 * Timelock proposal-lifecycle views. The base /v1/governance/owner and
 * /v1/governance/facets endpoints live in routes/meta.ts and are covered
 * by meta.test.ts; this file covers everything in governance-reads.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { makeReaderMock } from "../helpers/reader-mock";

const FACETS = [
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
];
const PROPOSAL_ID = "0x" + "ab".repeat(32);

vi.mock("../../src/lib/reader", () => makeReaderMock({
  loupe: {
    facetAddresses:         () => FACETS,
    facetFunctionSelectors: (addr: string) =>
      addr.toLowerCase() === FACETS[0] ? ["0xdeadbeef", "0xcafebabe"] : ["0x11111111"],
    facetAddress:           (sel: string) =>
      sel === "0xdeadbeef" ? FACETS[0] : FACETS[1],
  },
  timelock: {
    getProposal: () => ({
      status: 0n,
      eta:    1_775_676_000n,
      init:   "0xCCcCccCcCCCccCcCccCCCCCcCcCcCcCccCcCcCcC",
      calldata_: "0x1234",
    }),
    getAllCutIds:        () => [PROPOSAL_ID, "0x" + "cd".repeat(32)],
    getPendingCutIds:    () => [PROPOSAL_ID],
    getPendingCutInfo:   () => ({ eta: 1_775_676_000n, executed: false, cancelled: false }),
  },
}));

import request from "supertest";
import { createApp } from "../../src/app";
const app = createApp();

describe("GET /v1/governance/facet-addresses/:chainId", () => {
  it("returns the facet address list", async () => {
    const res = await request(app).get("/v1/governance/facet-addresses/8453");
    expect(res.status).toBe(200);
    expect(res.body.data.facetAddresses).toEqual(FACETS);
  });
});

describe("GET /v1/governance/facets/:chainId/by-address/:facetAddress", () => {
  it("returns the selectors served by a facet", async () => {
    const res = await request(app).get(`/v1/governance/facets/8453/by-address/${FACETS[0]}`);
    expect(res.status).toBe(200);
    expect(res.body.data.functionSelectors).toEqual(["0xdeadbeef", "0xcafebabe"]);
  });

  it("validates the facet address shape", async () => {
    const res = await request(app).get("/v1/governance/facets/8453/by-address/not-an-address");
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/governance/facet-address/:chainId/:selector", () => {
  it("returns the facet that serves a selector", async () => {
    const res = await request(app).get("/v1/governance/facet-address/8453/0xdeadbeef");
    expect(res.status).toBe(200);
    expect(res.body.data.facetAddress).toBe(FACETS[0]);
  });

  it("validates the selector is 4 bytes", async () => {
    const res = await request(app).get("/v1/governance/facet-address/8453/0xdead");
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/governance/proposals/:chainId/:proposalId", () => {
  it("returns the full proposal state with a human label", async () => {
    const res = await request(app).get(`/v1/governance/proposals/8453/${PROPOSAL_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      chainId: 8453,
      proposalId: PROPOSAL_ID,
      status: 0,
      statusLabel: "pending",
      executeAfter: 1775676000,
      init: "0xccccccccccccccccccccccccccccccccccccccc".padEnd(42, "c"),
      callData: "0x1234",
    });
  });

  it("validates the proposalId shape (must be bytes32)", async () => {
    const res = await request(app).get("/v1/governance/proposals/8453/0xshort");
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/governance/cut-ids/:chainId", () => {
  it("returns every proposal ID ever created", async () => {
    const res = await request(app).get("/v1/governance/cut-ids/8453");
    expect(res.status).toBe(200);
    expect(res.body.data.cutIds).toHaveLength(2);
    expect(res.body.data.cutIds[0]).toBe(PROPOSAL_ID);
  });
});

describe("GET /v1/governance/pending-cut-ids/:chainId", () => {
  it("returns proposals via the legacy alias", async () => {
    const res = await request(app).get("/v1/governance/pending-cut-ids/8453");
    expect(res.status).toBe(200);
    expect(res.body.data.cutIds).toEqual([PROPOSAL_ID]);
  });
});

describe("GET /v1/governance/pending-cut-info/:chainId/:proposalId", () => {
  it("returns the eta + executed + cancelled flags", async () => {
    const res = await request(app).get(`/v1/governance/pending-cut-info/8453/${PROPOSAL_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      eta: 1775676000,
      executed: false,
      cancelled: false,
    });
  });
});
