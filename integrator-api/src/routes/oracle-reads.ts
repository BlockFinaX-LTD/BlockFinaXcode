/**
 * Oracle reads — submitted prices, config, who's a signer.
 */

import { Router } from "express";
import { z } from "zod";
import { oracleFacet } from "../lib/reader";
import { ok } from "../lib/respond";
import { asyncHandler } from "../lib/errors";
import { validate } from "../lib/validate";
import { openapi, standardErrorResponses } from "../lib/openapi";

const router = Router();

const ChainOnly = z.object({ chainId: z.coerce.number().int() });
const ChainAndAddr = z.object({
  chainId: z.coerce.number().int(),
  addr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});
const ChainAndEventId = z.object({
  chainId: z.coerce.number().int(),
  eventId: z.coerce.number().int().nonnegative(),
});

router.get("/oracles/:chainId",
  validate({ params: ChainOnly }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.params as unknown as z.infer<typeof ChainOnly>;
    const addrs: string[] = await oracleFacet(chainId).getOracles();
    ok(res, { chainId, oracles: addrs.map(a => a.toLowerCase()) });
  }),
);
openapi.registerPath({
  method: "get", path: "/oracle/oracles/{chainId}", tags: ["Oracle"],
  summary: "List authorised oracle signers",
  request: { params: ChainOnly },
  responses: { 200: { description: "Oracle addresses", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/config/:chainId",
  validate({ params: ChainOnly }),
  asyncHandler(async (req, res) => {
    const { chainId } = req.params as unknown as z.infer<typeof ChainOnly>;
    const r = await oracleFacet(chainId).getOracleConfig();
    ok(res, {
      chainId,
      requiredSigners: Number(r.requiredSigners),
      toleranceBps: Number(r.toleranceBps),
      oracleCount: Number(r.oracleCount),
      maxOracles: Number(r.maxOracles),
    });
  }),
);
openapi.registerPath({
  method: "get", path: "/oracle/config/{chainId}", tags: ["Oracle"],
  summary: "Oracle consensus config",
  request: { params: ChainOnly },
  responses: { 200: { description: "Consensus config", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/is-authorised/:chainId/:addr",
  validate({ params: ChainAndAddr }),
  asyncHandler(async (req, res) => {
    const { chainId, addr } = req.params as unknown as z.infer<typeof ChainAndAddr>;
    const authd: boolean = await oracleFacet(chainId).isAuthorisedOracle(addr);
    ok(res, { chainId, addr: addr.toLowerCase(), authorised: !!authd });
  }),
);
openapi.registerPath({
  method: "get", path: "/oracle/is-authorised/{chainId}/{addr}", tags: ["Oracle"],
  summary: "Check whether an address is an authorised oracle",
  request: { params: ChainAndAddr },
  responses: { 200: { description: "Authorisation flag", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/submissions/:chainId/:eventId",
  validate({ params: ChainAndEventId }),
  asyncHandler(async (req, res) => {
    const { chainId, eventId } = req.params as unknown as z.infer<typeof ChainAndEventId>;
    const r = await oracleFacet(chainId).getAllSubmissions(eventId);
    const oracles    = (r.oracles    ?? r[0]) as string[];
    const prices     = (r.prices     ?? r[1]) as bigint[];
    const timestamps = (r.timestamps ?? r[2]) as bigint[];
    const stale      = (r.stale      ?? r[3]) as boolean[];
    const submissions = oracles.map((o, i) => ({
      oracle: o.toLowerCase(),
      price: String(prices[i]),
      timestamp: Number(timestamps[i]),
      isStale: !!stale[i],
    }));
    ok(res, { chainId, eventId, count: submissions.length, submissions });
  }),
);
openapi.registerPath({
  method: "get", path: "/oracle/submissions/{chainId}/{eventId}", tags: ["Oracle"],
  summary: "List all rate submissions for an event",
  request: { params: ChainAndEventId },
  responses: { 200: { description: "Submissions", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

const ChainEventOracle = z.object({
  chainId: z.coerce.number().int(),
  eventId: z.coerce.number().int().nonnegative(),
  oracle:  z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

router.get("/submission/:chainId/:eventId/:oracle",
  validate({ params: ChainEventOracle }),
  asyncHandler(async (req, res) => {
    const { chainId, eventId, oracle } = req.params as unknown as z.infer<typeof ChainEventOracle>;
    const r = await oracleFacet(chainId).getSubmission(eventId, oracle);
    ok(res, {
      chainId, eventId,
      oracle: oracle.toLowerCase(),
      price:     String(r.price ?? r[0]),
      timestamp: Number(r.timestamp ?? r[1]),
      exists:    !!(r.exists ?? r[2]),
      isStale:   !!(r.isStale ?? r[3]),
    });
  }),
);
openapi.registerPath({
  method: "get", path: "/oracle/submission/{chainId}/{eventId}/{oracle}", tags: ["Oracle"],
  summary: "A single oracle's submission for an event",
  request: { params: ChainEventOracle },
  responses: { 200: { description: "Submission", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

router.get("/submitter-count/:chainId/:eventId",
  validate({ params: ChainAndEventId }),
  asyncHandler(async (req, res) => {
    const { chainId, eventId } = req.params as unknown as z.infer<typeof ChainAndEventId>;
    const n: bigint = await oracleFacet(chainId).getSubmitterCount(eventId);
    ok(res, { chainId, eventId, count: Number(n) });
  }),
);
openapi.registerPath({
  method: "get", path: "/oracle/submitter-count/{chainId}/{eventId}", tags: ["Oracle"],
  summary: "Number of oracles that have submitted for an event",
  request: { params: ChainAndEventId },
  responses: { 200: { description: "Submitter count", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

export default router;
