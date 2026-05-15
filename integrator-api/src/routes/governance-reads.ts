/**
 * Diamond governance reads — full Loupe surface + Timelock proposal state.
 *
 *   GET /v1/governance/facet-addresses/:chainId
 *   GET /v1/governance/facets/:chainId/by-address/:facetAddress
 *   GET /v1/governance/facet-address/:chainId/:selector
 *   GET /v1/governance/proposals/:chainId/:proposalId
 *   GET /v1/governance/cut-ids/:chainId
 *   GET /v1/governance/pending-cut-ids/:chainId
 *   GET /v1/governance/pending-cut-info/:chainId/:proposalId
 *
 * Owner / pendingOwner + facet list live in routes/meta.ts so they show
 * up alongside /v1/me and /v1/chains for casual integrators; the more
 * specialised Diamond views live here.
 */

import { Router } from "express";
import { z } from "zod";
import { loupeFacet, timelockFacet } from "../lib/reader";
import { ok } from "../lib/respond";
import { asyncHandler } from "../lib/errors";
import { validate } from "../lib/validate";
import { openapi, standardErrorResponses } from "../lib/openapi";

const router = Router();

const ChainOnly = z.object({ chainId: z.coerce.number().int() });
const Selector  = z.string().regex(/^0x[a-fA-F0-9]{8}$/, "must be a 0x-prefixed 4-byte selector");
const Address   = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 20-byte address");
const Bytes32   = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "must be a 0x-prefixed 32-byte hash");

// ── Loupe extras (the four-method spec from EIP-2535) ───────────────────

router.get("/governance/facet-addresses/:chainId",
  validate({ params: ChainOnly }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.params as unknown as z.infer<typeof ChainOnly>;
    const addrs: string[] = await loupeFacet(chainId).facetAddresses();
    ok(res, { chainId, facetAddresses: addrs.map(a => a.toLowerCase()) });
  }),
);
openapi.registerPath({
  method: "get", path: "/governance/facet-addresses/{chainId}", tags: ["Governance"],
  summary: "All facet addresses currently mounted on the Diamond",
  request: { params: ChainOnly },
  responses: { 200: { description: "Facet addresses", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/governance/facets/:chainId/by-address/:facetAddress",
  validate({ params: z.object({ chainId: z.coerce.number().int(), facetAddress: Address }) }),
  asyncHandler(async (req, res) => {
    const { chainId, facetAddress } = req.params as unknown as { chainId: number; facetAddress: string };
    const sels: string[] = await loupeFacet(chainId).facetFunctionSelectors(facetAddress);
    ok(res, { chainId, facetAddress: facetAddress.toLowerCase(), functionSelectors: sels.map(String) });
  }),
);
openapi.registerPath({
  method: "get", path: "/governance/facets/{chainId}/by-address/{facetAddress}", tags: ["Governance"],
  summary: "All function selectors served by a given facet",
  request: { params: z.object({ chainId: z.coerce.number().int(), facetAddress: z.string() }) },
  responses: { 200: { description: "Selectors", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/governance/facet-address/:chainId/:selector",
  validate({ params: z.object({ chainId: z.coerce.number().int(), selector: Selector }) }),
  asyncHandler(async (req, res) => {
    const { chainId, selector } = req.params as unknown as { chainId: number; selector: string };
    const addr: string = await loupeFacet(chainId).facetAddress(selector);
    ok(res, { chainId, selector: selector.toLowerCase(), facetAddress: String(addr).toLowerCase() });
  }),
);
openapi.registerPath({
  method: "get", path: "/governance/facet-address/{chainId}/{selector}", tags: ["Governance"],
  summary: "Which facet currently serves a given 4-byte selector",
  request: { params: z.object({ chainId: z.coerce.number().int(), selector: z.string() }) },
  responses: { 200: { description: "Facet address", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

// ── TimelockCutFacet views ──────────────────────────────────────────────

router.get("/governance/proposals/:chainId/:proposalId",
  validate({ params: z.object({ chainId: z.coerce.number().int(), proposalId: Bytes32 }) }),
  asyncHandler(async (req, res) => {
    const { chainId, proposalId } = req.params as unknown as { chainId: number; proposalId: string };
    const r = await timelockFacet(chainId).getProposal(proposalId);
    const status = Number(r.status ?? r[0]);
    ok(res, {
      chainId, proposalId,
      status,
      statusLabel: status === 2 ? "executed" : status === 1 ? "cancelled" : "pending",
      executeAfter: Number(r.eta ?? r[1]),
      init:         String(r.init ?? r[2]).toLowerCase(),
      callData:     String(r.calldata_ ?? r[3]),
    });
  }),
);
openapi.registerPath({
  method: "get", path: "/governance/proposals/{chainId}/{proposalId}", tags: ["Governance · Timelock"],
  summary: "Full state of a Diamond-cut proposal",
  request: { params: z.object({ chainId: z.coerce.number().int(), proposalId: z.string() }) },
  responses: { 200: { description: "Proposal", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/governance/cut-ids/:chainId",
  validate({ params: ChainOnly }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.params as unknown as z.infer<typeof ChainOnly>;
    const ids: string[] = await timelockFacet(chainId).getAllCutIds();
    ok(res, { chainId, cutIds: ids.map(String) });
  }),
);
openapi.registerPath({
  method: "get", path: "/governance/cut-ids/{chainId}", tags: ["Governance · Timelock"],
  summary: "Every cut-proposal ID ever created on the Diamond",
  request: { params: ChainOnly },
  responses: { 200: { description: "Proposal IDs", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/governance/pending-cut-ids/:chainId",
  validate({ params: ChainOnly }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.params as unknown as z.infer<typeof ChainOnly>;
    const ids: string[] = await timelockFacet(chainId).getPendingCutIds();
    ok(res, { chainId, cutIds: ids.map(String) });
  }),
);
openapi.registerPath({
  method: "get", path: "/governance/pending-cut-ids/{chainId}", tags: ["Governance · Timelock"],
  summary: "Alias of /cut-ids — kept for backwards compatibility",
  request: { params: ChainOnly },
  responses: { 200: { description: "Proposal IDs", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/governance/pending-cut-info/:chainId/:proposalId",
  validate({ params: z.object({ chainId: z.coerce.number().int(), proposalId: Bytes32 }) }),
  asyncHandler(async (req, res) => {
    const { chainId, proposalId } = req.params as unknown as { chainId: number; proposalId: string };
    const r = await timelockFacet(chainId).getPendingCutInfo(proposalId);
    ok(res, {
      chainId, proposalId,
      eta:        Number(r.eta ?? r[0]),
      executed:   !!(r.executed ?? r[1]),
      cancelled:  !!(r.cancelled ?? r[2]),
    });
  }),
);
openapi.registerPath({
  method: "get", path: "/governance/pending-cut-info/{chainId}/{proposalId}", tags: ["Governance · Timelock"],
  summary: "Lightweight proposal status (eta + executed + cancelled)",
  request: { params: z.object({ chainId: z.coerce.number().int(), proposalId: z.string() }) },
  responses: { 200: { description: "Proposal status", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

export default router;
