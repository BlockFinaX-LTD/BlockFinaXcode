/**
 * Pricing engine endpoints — proxy through to the stateful pricing service
 * (server/pricing/*.ts in the main app).
 *
 * Why proxy instead of inlining: the engine pulls live data from external
 * sources (Twelvedata for FX history, TreasuryDirect for USD rates) and
 * persists pair classifications + historical closes in Postgres via
 * Drizzle. Copying that into a stateless calldata-builder defeats the
 * point. So we forward; integrators see one consistent surface.
 *
 * The upstream URL is configured via PRICING_ENGINE_URL (e.g.
 * https://api.blockfinax.com). Defaults to http://localhost:5000 for
 * local development against the main app's dev server.
 */

import { Router } from "express";
import { z } from "zod";
import { ok } from "../lib/respond";
import { asyncHandler, errors } from "../lib/errors";
import { validate } from "../lib/validate";
import { openapi, standardErrorResponses } from "../lib/openapi";

const router = Router();

const PRICING_ENGINE_URL = process.env.PRICING_ENGINE_URL || "http://localhost:5000";

// ── Shared schemas ──────────────────────────────────────────────────────

const QuoteBody = z.object({
  pair: z.string().min(3).describe("e.g. USD/GHS, USD/NGN"),
  strike: z.number().positive().describe("Entry-edge of the payout zone"),
  payoutCap: z.number().positive().describe("Far-edge of the payout zone"),
  expiryUnixSeconds: z.number().int().describe("Expiry as Unix seconds"),
  notional: z.number().positive().describe("Hedge size in payment-token units (USDC)"),
  strikeAbove: z.boolean().describe("true = upward hedge (call spread)"),

  // Optional v8 attestation context — if any are provided, ALL must be
  chainId: z.number().int().optional(),
  diamondAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  creator: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
}).openapi("PricingQuoteBody");

const QuoteResponseSchema = z.object({
  premiumRate: z.number(),
  premiumUsd: z.number(),
  maxPayoutUsd: z.number(),
  premiumRateFixed6: z.string(),
  attestation: z.object({
    signature: z.string(),
    quoteTimestamp: z.string(),
    quoteNonce: z.string(),
    signerAddress: z.string(),
    expiresAt: z.string(),
  }).nullable(),
  breakdown: z.any(),
}).openapi("PricingQuoteResponse");

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Forwards a request to the upstream pricing service. Surfaces the
 * upstream JSON error as a 400/502 ApiError so the envelope is consistent
 * with the rest of the API.
 */
async function forward<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${PRICING_ENGINE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (e: any) {
    throw errors.unavailable(`Pricing engine unreachable at ${PRICING_ENGINE_URL}: ${e?.message ?? "unknown"}`);
  }
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Upstream returns { error: "..." } on validation failures
    const msg = body?.error ?? body?.message ?? `Pricing engine responded ${r.status}`;
    if (r.status === 400) throw errors.validation(msg);
    throw errors.upstream(msg);
  }
  return body as T;
}

// ── POST /v1/pricing/quote ──────────────────────────────────────────────

router.post("/quote", validate({ body: QuoteBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof QuoteBody>;
    // Same constraint the upstream enforces: attestation requires all 3 fields.
    const anyAttest = b.chainId !== undefined || b.diamondAddress !== undefined || b.creator !== undefined;
    if (anyAttest && !(b.chainId !== undefined && b.diamondAddress && b.creator)) {
      throw errors.validation("chainId, diamondAddress, and creator must all be provided together for an attested quote");
    }
    const upstream = await forward<z.infer<typeof QuoteResponseSchema>>("/api/pricing/quote", {
      method: "POST",
      body: JSON.stringify(b),
    });
    ok(res, upstream);
  }),
);
openapi.registerPath({
  method: "post", path: "/pricing/quote", tags: ["Pricing"],
  summary: "Get a fair-premium quote (optionally signed for on-chain attestation)",
  description:
    "Computes a fair premium using Garman–Kohlhagen with empirical drift + EWMA volatility. " +
    "If `chainId` + `diamondAddress` + `creator` are all provided AND the engine has a signing key configured, " +
    "the response includes an `attestation` block whose fields plug directly into `createEvent`'s " +
    "`signature` / `quoteTimestamp` / `quoteNonce` slots.",
  request: { body: { content: { "application/json": { schema: QuoteBody } } } },
  responses: {
    200: { description: "Quote with breakdown", content: { "application/json": { schema: z.object({ data: QuoteResponseSchema }) } } },
    ...standardErrorResponses,
  },
});

// ── GET /v1/pricing/health ──────────────────────────────────────────────

router.get("/health",
  asyncHandler(async (_req, res) => {
    const upstream = await forward<unknown>("/api/pricing/health");
    ok(res, upstream);
  }),
);
openapi.registerPath({
  method: "get", path: "/pricing/health", tags: ["Pricing"],
  summary: "Pricing engine status (signer, USD rate cache, per-pair history)",
  description: "Useful for verifying that `pricingEngineSigner` matches what's set on-chain via `setPricingEngineSigner`.",
  responses: { 200: { description: "Engine status", content: { "application/json": { schema: z.object({ data: z.any() }) } } }, ...standardErrorResponses },
});

// ── GET /v1/pricing/signer ──────────────────────────────────────────────
// Convenience slice of /health — just the signer. Useful when integrators
// want to verify the on-chain signer matches without paying for the full
// classification list.

router.get("/signer",
  asyncHandler(async (_req, res) => {
    const upstream = await forward<{ pricingEngineSigner: string | null }>("/api/pricing/health");
    ok(res, { signerAddress: upstream.pricingEngineSigner });
  }),
);
openapi.registerPath({
  method: "get", path: "/pricing/signer", tags: ["Pricing"],
  summary: "Address of the active pricing-engine signer (or null when unset)",
  responses: { 200: { description: "Signer address", content: { "application/json": { schema: z.object({ data: z.object({ signerAddress: z.string().nullable() }) }) } } }, ...standardErrorResponses },
});

export default router;
