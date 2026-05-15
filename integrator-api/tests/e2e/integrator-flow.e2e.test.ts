/**
 * End-to-end "integrator journey" test.
 *
 * Walks through the canonical happy-path flow an external integrator
 * (Privy app, custom bot, white-label venue) would follow against the
 * integrator API:
 *
 *   1. GET  /v1/chains                       — discover the chains we deploy on
 *   2. GET  /v1/openapi.json                 — confirm the contract is published
 *   3. GET  /v1/governance/owner             — read on-chain governance state
 *   4. POST /v1/tx/erc20/approve             — build approval calldata
 *   5. POST /v1/tx/hedge/buy-protection      — build the protection calldata
 *   6. Decode both built calldatas end-to-end via ethers
 *   7. POST /v1/tx/broadcast                 — simulate the relay path
 *
 * The smart-contract layer is stubbed at the reader.ts and providerFor()
 * boundaries — we never dial an RPC, but every other layer (validation,
 * encoding, response envelope, error mapping) runs production code.
 */

import { describe, it, expect, vi } from "vitest";
import { ethers } from "ethers";
import { makeReaderMock } from "../helpers/reader-mock";

vi.mock("../../src/lib/reader", () => makeReaderMock({
  ownership: {
    owner:        () => "0x1111111111111111111111111111111111111111",
    pendingOwner: () => "0x0000000000000000000000000000000000000000",
  },
  hedge: {
    getHedgeFeeConfig: () => [2_000_000n, 5_000n, 10_000n, 10_000n, 50_000n],
  },
}));

const broadcastTransaction = vi.fn();
vi.mock("../../src/lib/chains", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/chains")>("../../src/lib/chains");
  return { ...actual, providerFor: vi.fn(() => ({ broadcastTransaction })) };
});

import request from "supertest";
import { createApp } from "../../src/app";
import { HEDGE_FACET_ABI, ERC20_ABI } from "../../src/lib/abi";

const app = createApp();

describe("E2E · canonical integrator journey", () => {
  it("discovers chains, builds calldata, and broadcasts a signed tx end-to-end", async () => {
    // 1. Discover supported chains
    const chains = await request(app).get("/v1/chains").expect(200);
    expect(Array.isArray(chains.body.data)).toBe(true);
    const base = chains.body.data.find((c: any) => c.chainId === 8453);
    expect(base).toBeDefined();
    expect(base.usdc).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(base.diamond).toMatch(/^0x[a-fA-F0-9]{40}$/);

    // 2. The OpenAPI doc is reachable and describes the routes the bot will call
    const spec = await request(app).get("/v1/openapi.json").expect(200);
    expect(Object.keys(spec.body.paths)).toEqual(
      expect.arrayContaining([
        "/chains", "/tx/erc20/approve", "/tx/hedge/buy-protection", "/tx/broadcast",
      ]),
    );

    // 3. A governance read works
    const owner = await request(app).get("/v1/governance/owner?chainId=8453").expect(200);
    expect(owner.body.data.owner).toBe("0x1111111111111111111111111111111111111111");

    // 4. Build ERC-20 approve calldata
    const approve = await request(app).post("/v1/tx/erc20/approve").send({
      chainId: 8453, token: base.usdc, spender: base.diamond, amount: "120000000",
    }).expect(200);
    expect(approve.body.data.to.toLowerCase()).toBe(base.usdc.toLowerCase());
    expect(approve.body.data.function).toBe("approve");

    // Decode and verify approve calldata round-trips
    const approveDecoded = new ethers.Interface(ERC20_ABI as string[])
      .decodeFunctionData("approve", approve.body.data.data);
    expect(String(approveDecoded[0]).toLowerCase()).toBe(base.diamond.toLowerCase());
    expect(approveDecoded[1]).toBe(120_000_000n);

    // 5. Build buyProtection calldata
    const buy = await request(app).post("/v1/tx/hedge/buy-protection").send({
      chainId: 8453,
      eventId: 1,
      notional: "100000000",
      maxCost:  "110000000",
      deadline: "9999999999",
    }).expect(200);
    expect(buy.body.data.to.toLowerCase()).toBe(base.diamond.toLowerCase());
    expect(buy.body.data.function).toBe("buyProtection");

    // Decode and verify args
    const buyDecoded = new ethers.Interface(HEDGE_FACET_ABI as string[])
      .decodeFunctionData("buyProtection", buy.body.data.data);
    expect(buyDecoded[0]).toBe(1n);
    expect(buyDecoded[1]).toBe(100_000_000n);
    expect(buyDecoded[2]).toBe(110_000_000n);
    expect(buyDecoded[3]).toBe(9_999_999_999n);

    // 6. Simulate broadcasting a signed tx — the integrator would sign the bytes
    // locally and post them here. We're not actually signing; we just confirm
    // the relay endpoint passes them through to the provider verbatim.
    broadcastTransaction.mockResolvedValueOnce({
      hash:     "0xeeee000000000000000000000000000000000000000000000000000000000001",
      from:     "0xCAB3147911130FCD3B08FCE2EF4BF1E28F76E894",
      to:       base.diamond,
      nonce:    42,
      gasLimit: 250_000n,
    });
    const relay = await request(app).post("/v1/tx/broadcast").send({
      chainId: 8453,
      signedTx: "0x02f8b1820a4b07847735940084773594008301d4c094bcc51e62c4948fd35ab505bd71804c849601e4ef80b844abc",
    }).expect(200);
    expect(relay.body.data.txHash).toMatch(/^0xeeee/);
    expect(relay.body.data.chainId).toBe(8453);
    expect(broadcastTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects junk input at the API boundary instead of leaking into the contract layer", async () => {
    // Unsupported chain
    const a = await request(app).post("/v1/tx/erc20/approve").send({
      chainId: 4242, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", spender: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "1",
    });
    expect(a.status).toBe(400);
    expect(a.body.error.message).toMatch(/Unsupported chainId/);

    // Bad address
    const b = await request(app).post("/v1/tx/hedge/set-pool-settings").send({
      chainId: 8453, eventId: 1, poolOpen: "yes-please", allowExternalLp: false,
    });
    expect(b.status).toBe(400);
    expect(b.body.error.code).toBe("validation_error");

    // Bad signed tx
    const c = await request(app).post("/v1/tx/broadcast").send({
      chainId: 8453, signedTx: "no-leading-0x",
    });
    expect(c.status).toBe(400);
  });

  it("preserves invariants across the full surface: BuiltTx always has 7 keys", async () => {
    // Hit a representative subset and assert envelope keys for each
    const samples = [
      { url: "/v1/tx/erc20/approve", body: {
        chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        spender: "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef", amount: "1",
      }},
      { url: "/v1/tx/hedge/claim-payout", body: { chainId: 8453, positionId: 1 } },
      { url: "/v1/tx/hedge/pause", body: { chainId: 8453 } },
      { url: "/v1/tx/oracle/submit-rate", body: { chainId: 8453, eventId: 1, price: "11000000" } },
      { url: "/v1/tx/ownership/accept-ownership", body: { chainId: 8453 } },
    ];
    for (const s of samples) {
      const res = await request(app).post(s.url).send(s.body);
      expect(res.status, `${s.url} should 200`).toBe(200);
      const tx = res.body.data;
      for (const k of ["chainId", "to", "data", "value", "function", "args", "estimatedGas"]) {
        expect(tx, `${s.url} missing ${k}`).toHaveProperty(k);
      }
      expect(typeof tx.value).toBe("string");
      expect(tx.data.startsWith("0x")).toBe(true);
    }
  });
});
