/**
 * pricing.ts — REST endpoints for the pricing engine.
 *
 *   POST /api/pricing/quote     — get a fair-premium quote for a hedge event
 *   GET  /api/pricing/health    — diagnostic: USD rate cache, last close per pair
 *
 * The quote endpoint is read-only and unsigned (no wallet signature required) —
 * it just runs math on public market data. Rate-limited via the global API
 * limiter in routes.ts.
 */

import type { Express } from "express";
import { quote } from "../pricing/quote";
import { getUsdRateCache } from "../pricing/data/usdRate";
import { getCloseCount } from "../pricing/data/historical";
import { listAllClassifications } from "../pricing/data/classification";
import { getSignerAddress } from "../pricing/signer";

export function registerPricingRoutes(app: Express): void {
  // ── POST /api/pricing/quote ─────────────────────────────────────────────
  app.post("/api/pricing/quote", async (req, res) => {
    try {
      const {
        pair, strike, payoutCap, expiryUnixSeconds, notional, strikeAbove,
        chainId, diamondAddress, creator,        // v8 attestation context
      } = req.body ?? {};

      // Defensive validation — the orchestrator validates too, but failing fast
      // here gives clearer error messages.
      if (typeof pair !== "string" || !pair) {
        return res.status(400).json({ error: "pair (string) is required" });
      }
      if (typeof strike !== "number" || !Number.isFinite(strike)) {
        return res.status(400).json({ error: "strike (number) is required" });
      }
      if (typeof payoutCap !== "number" || !Number.isFinite(payoutCap)) {
        return res.status(400).json({ error: "payoutCap (number) is required" });
      }
      if (typeof expiryUnixSeconds !== "number" || !Number.isFinite(expiryUnixSeconds)) {
        return res.status(400).json({ error: "expiryUnixSeconds (number) is required" });
      }
      if (typeof notional !== "number" || !Number.isFinite(notional) || notional <= 0) {
        return res.status(400).json({ error: "notional (positive number) is required" });
      }
      if (typeof strikeAbove !== "boolean") {
        return res.status(400).json({ error: "strikeAbove (boolean) is required" });
      }

      // v8 attestation context — optional, but if any are provided, all three are required
      // and the response will include a signature. If none are provided, response is unsigned
      // (advisory-only mode, matches Phase 1 behaviour).
      const wantsAttestation = chainId !== undefined || diamondAddress !== undefined || creator !== undefined;
      if (wantsAttestation) {
        if (typeof chainId !== "number" || !Number.isFinite(chainId)) {
          return res.status(400).json({ error: "chainId (number) is required when requesting attestation" });
        }
        if (typeof diamondAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(diamondAddress)) {
          return res.status(400).json({ error: "diamondAddress (0x-prefixed 20-byte hex) is required when requesting attestation" });
        }
        if (typeof creator !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(creator)) {
          return res.status(400).json({ error: "creator (0x-prefixed 20-byte hex) is required when requesting attestation" });
        }
      }

      const result = await quote({
        pair, strike, payoutCap, expiryUnixSeconds, notional, strikeAbove,
        chainId, diamondAddress, creator,
      });
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "internal pricing error";
      return res.status(400).json({ error: msg });
    }
  });

  // ── GET /api/pricing/health ─────────────────────────────────────────────
  app.get("/api/pricing/health", async (_req, res) => {
    try {
      const classifications = await listAllClassifications();
      const closeCounts = await Promise.all(
        classifications.map(async c => ({
          pair: c.pair,
          tier: c.tier,
          useEmpiricalDrift: c.useEmpiricalDrift,
          historicalCloses: await getCloseCount(c.pair),
        })),
      );

      return res.json({
        usdRate: getUsdRateCache(),       // null if never fetched
        // v8: surface the signer address so operators can verify it matches what's
        // set on-chain via setPricingEngineSigner. Null if PRICING_ENGINE_PRIVATE_KEY
        // is unset (advisory-only mode).
        pricingEngineSigner: getSignerAddress(),
        pairs: closeCounts,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "health check failed";
      return res.status(500).json({ error: msg });
    }
  });
}
