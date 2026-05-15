/**
 * Meta / governance reads — chain catalog, /me, Diamond ownership + facets.
 */

import { Router } from "express";
import { z } from "zod";
import { listChains, getChain } from "../lib/chains";
import { hedgeFacet, ownershipFacet, loupeFacet, serialize } from "../lib/reader";
import { requireRiftUser } from "../lib/rift-auth";
import { ok } from "../lib/respond";
import { asyncHandler } from "../lib/errors";
import { validate } from "../lib/validate";
import { openapi, standardErrorResponses } from "../lib/openapi";

const router = Router();

// ── /v1/me ──────────────────────────────────────────────────────────────

const MeResponse = z.object({
  address: z.string(),
  email: z.string().email().nullable(),
  phoneNumber: z.string().nullable(),
  externalId: z.string().nullable(),
  user: z.string(),
}).openapi("MeResponse");

router.get("/me", requireRiftUser, asyncHandler(async (req, res) => {
  const u = req.riftUser!;
  ok(res, MeResponse.parse({
    address: u.address, email: u.email, phoneNumber: u.phoneNumber, externalId: u.externalId, user: u.user,
  }));
}));

openapi.registerPath({
  method: "get", path: "/me", tags: ["Auth"],
  summary: "Get the authenticated user",
  security: [{ riftBearer: [] }],
  responses: { 200: { description: "Authenticated user", content: { "application/json": { schema: z.object({ data: MeResponse }) } } }, ...standardErrorResponses },
});

// ── /v1/chains ──────────────────────────────────────────────────────────

const ChainResponse = z.object({
  chainId: z.number().int(),
  name: z.string(),
  symbol: z.string(),
  diamond: z.string(),
  usdc: z.string(),
  usdt: z.string().nullable(),
  rpcUrl: z.string(),
  paymentDecimals: z.object({ USDC: z.number(), USDT: z.number().optional() }),
}).openapi("Chain");

router.get("/chains", asyncHandler(async (_req, res) => {
  ok(res, listChains().map(c => ChainResponse.parse({
    chainId: c.chainId, name: c.name, symbol: c.symbol,
    diamond: c.diamond, usdc: c.usdc, usdt: c.usdt ?? null,
    rpcUrl: c.rpcUrl, paymentDecimals: c.paymentDecimals,
  })));
}));

openapi.registerPath({
  method: "get", path: "/chains", tags: ["Meta"],
  summary: "List supported chains",
  description: "Returns every chain BlockFinaX is deployed on, with its Diamond address, payment-token addresses, and RPC.",
  responses: { 200: { description: "Chain list", content: { "application/json": { schema: z.object({ data: z.array(ChainResponse) }) } } }, ...standardErrorResponses },
});

// ── /v1/governance/owner ────────────────────────────────────────────────

const ChainIdQuery = z.object({ chainId: z.coerce.number().int() });

router.get("/governance/owner",
  validate({ query: ChainIdQuery }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.query as unknown as z.infer<typeof ChainIdQuery>;
    const c = ownershipFacet(chainId);
    const [owner, pendingOwner] = await Promise.all([c.owner(), c.pendingOwner()]);
    ok(res, { chainId, owner: String(owner), pendingOwner: String(pendingOwner) });
  }),
);
openapi.registerPath({
  method: "get", path: "/governance/owner", tags: ["Governance"],
  summary: "Get Diamond owner + pending owner",
  request: { query: ChainIdQuery },
  responses: {
    200: { description: "Ownership state", content: { "application/json": { schema: z.object({ data: z.object({ chainId: z.number(), owner: z.string(), pendingOwner: z.string() }) }) } } },
    ...standardErrorResponses,
  },
});

// ── /v1/governance/facets ───────────────────────────────────────────────

router.get("/governance/facets",
  validate({ query: ChainIdQuery }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.query as unknown as z.infer<typeof ChainIdQuery>;
    const facets = await loupeFacet(chainId).facets();
    ok(res, {
      chainId,
      facets: (facets as any[]).map(f => ({
        facetAddress: String(f.facetAddress ?? f[0]),
        functionSelectors: ((f.functionSelectors ?? f[1]) as string[]).map(String),
      })),
    });
  }),
);
openapi.registerPath({
  method: "get", path: "/governance/facets", tags: ["Governance"],
  summary: "List Diamond facets and their function selectors",
  request: { query: ChainIdQuery },
  responses: { 200: { description: "Facets", content: { "application/json": { schema: z.object({ data: z.object({ chainId: z.number(), facets: z.array(z.any()) }) }) } } }, ...standardErrorResponses },
});

// ── /v1/hedge/fees ──────────────────────────────────────────────────────

router.get("/hedge/fees",
  validate({ query: ChainIdQuery }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.query as unknown as z.infer<typeof ChainIdQuery>;
    const c = hedgeFacet(chainId);
    const [creation, hedger, payout, lp, creator] = await c.getHedgeFeeConfig();
    ok(res, {
      chainId,
      creationFee: String(creation),
      hedgerFeeRate: String(hedger),
      payoutFeeRate: String(payout),
      lpProfitFeeRate: String(lp),
      creatorLoyaltyRate: String(creator),
    });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/fees", tags: ["Hedge"],
  summary: "Get the active fee config on a chain",
  request: { query: ChainIdQuery },
  responses: { 200: { description: "Fee config (raw bigints as strings)", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

export default router;
