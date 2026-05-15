/**
 * Tiny isolated test file just to cover the status=1 ("cancelled") branch
 * of getProposal. The main governance test exercises status=0 (pending) and
 * branch-coverage.test.ts exercises status=2 (executed); putting this one
 * in its own file keeps the vi.mock scoping clean.
 */

import { describe, it, expect, vi } from "vitest";
import { makeReaderMock } from "../helpers/reader-mock";

vi.mock("../../src/lib/reader", () => makeReaderMock({
  timelock: {
    getProposal: () => ({ status: 1n, eta: 1n, init: "0x0000000000000000000000000000000000000000", calldata_: "0x" }),
  },
}));

import request from "supertest";
import { createApp } from "../../src/app";
const app = createApp();

describe("governance proposal status mapping", () => {
  it("status=1 maps to 'cancelled'", async () => {
    const proposalId = "0x" + "11".repeat(32);
    const res = await request(app).get(`/v1/governance/proposals/8453/${proposalId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(1);
    expect(res.body.data.statusLabel).toBe("cancelled");
  });
});
