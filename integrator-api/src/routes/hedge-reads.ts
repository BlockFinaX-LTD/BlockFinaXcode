/**
 * Hedge protocol read endpoints. Backed by live ethers reads — no DB
 * dependency, so this server runs against the contracts directly.
 *
 *   GET /v1/hedge/events/:chainId/:id              event core
 *   GET /v1/hedge/events/:chainId/:id/stats        pool stats
 *   GET /v1/hedge/events/:chainId/:id/range        range parameters
 *   GET /v1/hedge/events/:chainId/:id/utilization  capacity used
 *   GET /v1/hedge/events/:chainId/:id/positions    ids of positions in this event
 *   GET /v1/hedge/events/:chainId/:id/deposits     ids of deposits
 *   GET /v1/hedge/events/:chainId/total            count
 *   GET /v1/hedge/positions/:chainId/:id           position by id
 *   GET /v1/hedge/positions/:chainId/wallet/:addr  position ids by wallet
 *   GET /v1/hedge/deposits/:chainId/:id            deposit by id
 *   GET /v1/hedge/deposits/:chainId/:id/pending    pending premiums
 *   GET /v1/hedge/deposits/:chainId/wallet/:addr   deposit ids by wallet
 *   GET /v1/hedge/creators/:chainId/wallet/:addr   event ids created by wallet
 *   GET /v1/hedge/quote-payout/:chainId/:id        quote a hypothetical payout
 */

import { Router } from "express";
import { z } from "zod";
import { hedgeFacet, serialize } from "../lib/reader";
import { ok } from "../lib/respond";
import { asyncHandler, errors } from "../lib/errors";
import { validate } from "../lib/validate";
import { openapi, standardErrorResponses } from "../lib/openapi";

const router = Router();

const ChainAndId = z.object({
  chainId: z.coerce.number().int(),
  id: z.coerce.number().int().nonnegative(),
});
const ChainAndAddr = z.object({
  chainId: z.coerce.number().int(),
  addr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});
const ChainOnly = z.object({ chainId: z.coerce.number().int() });

// ── Event core + ancillaries ────────────────────────────────────────────
//
// IMPORTANT: literal-segment routes (`/events/:chainId/total`) must be
// declared BEFORE the wildcard `/events/:chainId/:id` route, or Express
// matches the wildcard first and rejects the literal as a malformed id.

router.get("/events/:chainId/total",
  validate({ params: ChainOnly }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.params as unknown as z.infer<typeof ChainOnly>;
    const total: bigint = await hedgeFacet(chainId).getTotalHedgeEvents();
    ok(res, { chainId, total: Number(total) });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/events/{chainId}/total", tags: ["Hedge · Events"],
  summary: "Total events ever created on a chain",
  request: { params: ChainOnly },
  responses: { 200: { description: "Total count", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/events/:chainId/:id",
  validate({ params: ChainAndId }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    try {
      const c = hedgeFacet(chainId);
      const r = await c.getHedgeEventCore(id);
      ok(res, {
        chainId, id,
        creator: String(r.creator),
        name: r.name, underlying: r.underlying,
        strike: String(r.strike), premiumRate: String(r.premiumRate),
        expiryDate: Number(r.expiryDate), status: Number(r.status),
        poolOpen: !!r.poolOpen, allowExternalLp: !!r.allowExternalLp,
        initialRate: String(r.initialRate),
        strikeAbove: !!r.strikeAbove,
      });
    } catch (e: any) {
      if (e?.code === "CALL_EXCEPTION") throw errors.notFound(`Event ${id} not found on chain ${chainId}`);
      throw e;
    }
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/events/{chainId}/{id}", tags: ["Hedge · Events"],
  summary: "Get an event's core state",
  request: { params: ChainAndId },
  responses: { 200: { description: "Event core fields", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/events/:chainId/:id/stats",
  validate({ params: ChainAndId }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    const r = await hedgeFacet(chainId).getHedgeEventStats(id);
    ok(res, {
      chainId, id,
      settlementPrice: String(r.settlementPrice),
      triggered: !!r.triggered,
      settledAt: Number(r.settledAt),
      creatorEarnings: String(r.creatorEarnings),
      totalLiquidity: String(r.totalLiquidity),
      totalExposure: String(r.totalExposure),
      totalPremiums: String(r.totalPremiums),
      lpCount: Number(r.lpCount),
      hedgerCount: Number(r.hedgerCount),
      totalMaxPayout: String(r.totalMaxPayout),
    });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/events/{chainId}/{id}/stats", tags: ["Hedge · Events"],
  summary: "Aggregate stats for an event",
  request: { params: ChainAndId },
  responses: { 200: { description: "Stats", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/events/:chainId/:id/range",
  validate({ params: ChainAndId }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    const r = await hedgeFacet(chainId).getHedgeEventRange(id);
    ok(res, {
      chainId, id,
      strike: String(r.strike),
      payoutCap: String(r.payoutCap),
      initialRate: String(r.initialRate),
      strikeAbove: !!r.strikeAbove,
    });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/events/{chainId}/{id}/range", tags: ["Hedge · Events"],
  summary: "Range parameters (strikeAbove, payoutCap, initialRate)",
  request: { params: ChainAndId },
  responses: { 200: { description: "Range params", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/events/:chainId/:id/utilization",
  validate({ params: ChainAndId }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    const r = await hedgeFacet(chainId).getPoolUtilization(id);
    ok(res, {
      chainId, id,
      totalLiquidity: String(r.totalLiquidity),
      totalExposure: String(r.totalExposure),
      availableCapacity: String(r.availableCapacity),
      utilizationRate: String(r.utilizationRate),
    });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/events/{chainId}/{id}/utilization", tags: ["Hedge · Events"],
  summary: "Pool utilization",
  request: { params: ChainAndId },
  responses: { 200: { description: "Utilization", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/events/:chainId/:id/positions",
  validate({ params: ChainAndId }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    const ids: bigint[] = await hedgeFacet(chainId).getEventPositionIds(id);
    ok(res, { chainId, eventId: id, positionIds: ids.map(String) });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/events/{chainId}/{id}/positions", tags: ["Hedge · Events"],
  summary: "Position IDs in an event",
  request: { params: ChainAndId },
  responses: { 200: { description: "Position IDs", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/events/:chainId/:id/deposits",
  validate({ params: ChainAndId }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    const ids: bigint[] = await hedgeFacet(chainId).getEventDepositIds(id);
    ok(res, { chainId, eventId: id, depositIds: ids.map(String) });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/events/{chainId}/{id}/deposits", tags: ["Hedge · Events"],
  summary: "LP deposit IDs in an event",
  request: { params: ChainAndId },
  responses: { 200: { description: "Deposit IDs", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

// ── Positions ────────────────────────────────────────────────────────────

router.get("/positions/:chainId/:id",
  validate({ params: ChainAndId }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    const r = await hedgeFacet(chainId).getHedgePosition(id);
    ok(res, {
      chainId, id: Number(r.id),
      eventId: Number(r.eventId),
      hedger: String(r.hedger),
      notional: String(r.notional),
      premiumPaid: String(r.premiumPaid),
      platformFeePaid: String(r.platformFeePaid),
      payoutAmount: String(r.payoutAmount),
      status: Number(r.status),
      claimed: !!r.claimed,
    });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/positions/{chainId}/{id}", tags: ["Hedge · Positions"],
  summary: "Get a position by id",
  request: { params: ChainAndId },
  responses: { 200: { description: "Position", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/positions/:chainId/wallet/:addr",
  validate({ params: ChainAndAddr }),
  asyncHandler(async (req, res) => {
    const { chainId, addr } = req.params as unknown as z.infer<typeof ChainAndAddr>;
    const ids: bigint[] = await hedgeFacet(chainId).getHedgerPositionIds(addr);
    ok(res, { chainId, wallet: addr.toLowerCase(), positionIds: ids.map(String) });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/positions/{chainId}/wallet/{addr}", tags: ["Hedge · Positions"],
  summary: "Position IDs owned by a wallet",
  request: { params: ChainAndAddr },
  responses: { 200: { description: "Position IDs", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

// ── Deposits ────────────────────────────────────────────────────────────

router.get("/deposits/:chainId/:id",
  validate({ params: ChainAndId }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    const r = await hedgeFacet(chainId).getHedgeLpDeposit(id);
    ok(res, {
      chainId, id: Number(r.id),
      eventId: Number(r.eventId),
      lp: String(r.lp),
      amount: String(r.amount),
      shares: String(r.shares),
      premiumsEarned: String(r.premiumsEarned),
      premiumsClaimed: String(r.premiumsClaimed),
      withdrawn: !!r.withdrawn,
    });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/deposits/{chainId}/{id}", tags: ["Hedge · Deposits"],
  summary: "Get an LP deposit by id",
  request: { params: ChainAndId },
  responses: { 200: { description: "Deposit", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/deposits/:chainId/:id/pending",
  validate({ params: ChainAndId }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    const pending: bigint = await hedgeFacet(chainId).pendingPremiums(id);
    ok(res, { chainId, depositId: id, pendingPremiums: String(pending) });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/deposits/{chainId}/{id}/pending", tags: ["Hedge · Deposits"],
  summary: "Unclaimed premiums on a deposit",
  request: { params: ChainAndId },
  responses: { 200: { description: "Pending amount (token-units)", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/deposits/:chainId/wallet/:addr",
  validate({ params: ChainAndAddr }),
  asyncHandler(async (req, res) => {
    const { chainId, addr } = req.params as unknown as z.infer<typeof ChainAndAddr>;
    const ids: bigint[] = await hedgeFacet(chainId).getLpDepositIds(addr);
    ok(res, { chainId, wallet: addr.toLowerCase(), depositIds: ids.map(String) });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/deposits/{chainId}/wallet/{addr}", tags: ["Hedge · Deposits"],
  summary: "LP deposit IDs owned by a wallet",
  request: { params: ChainAndAddr },
  responses: { 200: { description: "Deposit IDs", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/creators/:chainId/wallet/:addr",
  validate({ params: ChainAndAddr }),
  asyncHandler(async (req, res) => {
    const { chainId, addr } = req.params as unknown as z.infer<typeof ChainAndAddr>;
    const ids: bigint[] = await hedgeFacet(chainId).getCreatorEventIds(addr);
    ok(res, { chainId, wallet: addr.toLowerCase(), eventIds: ids.map(String) });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/creators/{chainId}/wallet/{addr}", tags: ["Hedge · Events"],
  summary: "Event IDs created by a wallet",
  request: { params: ChainAndAddr },
  responses: { 200: { description: "Event IDs", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

// ── Quote payout ────────────────────────────────────────────────────────

const QuotePayoutQuery = z.object({
  hypoSettlement: z.string(),
  notional: z.string(),
});

router.get("/quote-payout/:chainId/:id",
  validate({ params: ChainAndId, query: QuotePayoutQuery }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    const { hypoSettlement, notional } = req.query as unknown as z.infer<typeof QuotePayoutQuery>;
    const payout: bigint = await hedgeFacet(chainId).quoteRangePayout(id, hypoSettlement, notional);
    ok(res, { chainId, eventId: id, hypoSettlement, notional, payout: String(payout) });
  }),
);
openapi.registerPath({
  method: "get", path: "/hedge/quote-payout/{chainId}/{id}", tags: ["Hedge · Events"],
  summary: "Quote the payout for a hypothetical settlement price",
  request: { params: ChainAndId, query: QuotePayoutQuery },
  responses: { 200: { description: "Computed payout", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

// ── Protocol-level views ────────────────────────────────────────────────

router.get("/paused/:chainId",
  validate({ params: ChainOnly }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.params as unknown as z.infer<typeof ChainOnly>;
    const v: boolean = await hedgeFacet(chainId).isPaused();
    ok(res, { chainId, paused: !!v });
  }),
);
openapi.registerPath({ method: "get", path: "/hedge/paused/{chainId}", tags: ["Hedge · Protocol"], summary: "Is the hedge facet paused", request: { params: ChainOnly }, responses: { 200: { description: "Pause flag", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses } });

router.get("/fees-initialized/:chainId",
  validate({ params: ChainOnly }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.params as unknown as z.infer<typeof ChainOnly>;
    const v: boolean = await hedgeFacet(chainId).isFeesInitialized();
    ok(res, { chainId, initialized: !!v });
  }),
);
openapi.registerPath({ method: "get", path: "/hedge/fees-initialized/{chainId}", tags: ["Hedge · Protocol"], summary: "Have fees been initialized", request: { params: ChainOnly }, responses: { 200: { description: "Initialized flag", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses } });

router.get("/platform-fees/:chainId",
  validate({ params: ChainOnly }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.params as unknown as z.infer<typeof ChainOnly>;
    const v: bigint = await hedgeFacet(chainId).getHedgePlatformFees();
    ok(res, { chainId, fees: String(v) });
  }),
);
openapi.registerPath({ method: "get", path: "/hedge/platform-fees/{chainId}", tags: ["Hedge · Protocol"], summary: "Accumulated USDC platform fees", request: { params: ChainOnly }, responses: { 200: { description: "Fee balance", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses } });

router.get("/platform-fees/:chainId/by-token/:token",
  validate({ params: z.object({ chainId: z.coerce.number().int(), token: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }) }),
  asyncHandler(async (req, res) => {
    const { chainId, token } = req.params as unknown as { chainId: number; token: string };
    const v: bigint = await hedgeFacet(chainId).getPlatformFeesByToken(token);
    ok(res, { chainId, token: token.toLowerCase(), fees: String(v) });
  }),
);
openapi.registerPath({ method: "get", path: "/hedge/platform-fees/{chainId}/by-token/{token}", tags: ["Hedge · Protocol"], summary: "Accumulated platform fees in a specific token", request: { params: z.object({ chainId: z.coerce.number().int(), token: z.string() }) }, responses: { 200: { description: "Fee balance", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses } });

router.get("/payment-tokens/:chainId/:token",
  validate({ params: z.object({ chainId: z.coerce.number().int(), token: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }) }),
  asyncHandler(async (req, res) => {
    const { chainId, token } = req.params as unknown as { chainId: number; token: string };
    const v: boolean = await hedgeFacet(chainId).isAllowedPaymentToken(token);
    ok(res, { chainId, token: token.toLowerCase(), allowed: !!v });
  }),
);
openapi.registerPath({ method: "get", path: "/hedge/payment-tokens/{chainId}/{token}", tags: ["Hedge · Protocol"], summary: "Is a token an accepted payment asset", request: { params: z.object({ chainId: z.coerce.number().int(), token: z.string() }) }, responses: { 200: { description: "Allowed flag", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses } });

router.get("/events/:chainId/:id/payment-token",
  validate({ params: ChainAndId }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    const token: string = await hedgeFacet(chainId).getEventPaymentToken(id);
    ok(res, { chainId, eventId: id, token: String(token).toLowerCase() });
  }),
);
openapi.registerPath({ method: "get", path: "/hedge/events/{chainId}/{id}/payment-token", tags: ["Hedge · Events"], summary: "Payment token an event was created against", request: { params: ChainAndId }, responses: { 200: { description: "Payment token address", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses } });

router.get("/events/:chainId/:id/quote-signer",
  validate({ params: ChainAndId }),
  asyncHandler(async (req, res) => {
    const { chainId, id } = req.params as unknown as z.infer<typeof ChainAndId>;
    const signer: string = await hedgeFacet(chainId).getEventQuoteSigner(id);
    ok(res, { chainId, eventId: id, signer: String(signer).toLowerCase() });
  }),
);
openapi.registerPath({ method: "get", path: "/hedge/events/{chainId}/{id}/quote-signer", tags: ["Hedge · Events"], summary: "Pricing-engine signer the event was attested with", request: { params: ChainAndId }, responses: { 200: { description: "Signer address", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses } });

router.get("/pricing-engine-signer/:chainId",
  validate({ params: ChainOnly }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.params as unknown as z.infer<typeof ChainOnly>;
    const signer: string = await hedgeFacet(chainId).getPricingEngineSigner();
    ok(res, { chainId, signer: String(signer).toLowerCase() });
  }),
);
openapi.registerPath({ method: "get", path: "/hedge/pricing-engine-signer/{chainId}", tags: ["Hedge · Protocol"], summary: "Active pricing-engine signer", request: { params: ChainOnly }, responses: { 200: { description: "Signer address", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses } });

router.get("/quote-nonce-used/:chainId/:nonce",
  validate({ params: z.object({ chainId: z.coerce.number().int(), nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/) }) }),
  asyncHandler(async (req, res) => {
    const { chainId, nonce } = req.params as unknown as { chainId: number; nonce: string };
    const v: boolean = await hedgeFacet(chainId).isQuoteNonceUsed(nonce);
    ok(res, { chainId, nonce: nonce.toLowerCase(), used: !!v });
  }),
);
openapi.registerPath({ method: "get", path: "/hedge/quote-nonce-used/{chainId}/{nonce}", tags: ["Hedge · Protocol"], summary: "Has a pricing-engine quote nonce been consumed", request: { params: z.object({ chainId: z.coerce.number().int(), nonce: z.string() }) }, responses: { 200: { description: "Nonce-used flag", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses } });

export default router;
