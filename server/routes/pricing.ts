/**
 * pricing.ts — REST endpoints for the pricing engine.
 *
 *   POST /api/pricing/quote     — get a fair-premium quote for a hedge event
 *   POST /api/pricing/validate  — is this a premium anyone should be allowed to sell?
 *   GET  /api/pricing/health    — diagnostic: USD rate cache, last close per pair
 *
 * The quote endpoint is read-only and unsigned (no wallet signature required) —
 * it just runs math on public market data. Rate-limited via the global API
 * limiter in routes.ts.
 */

import type { Express } from "express";
import { quote } from "../pricing/quote";
import { quotePurchase } from "../pricing/quote-purchase";
import { validateLpPremium } from "../pricing/implied-vol";
import { db } from "../db";
import { hedgeEvents } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { getPairJumpParams } from "../pricing/data/jump-params";
import { getPricingVol } from "../pricing/data/vol";
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

  /**
   * POST /api/pricing/quote-purchase
   *
   * What an existing pool costs a buyer arriving now, as opposed to
   * /api/pricing/quote which prices a pool that does not exist yet.
   *
   * The premium a pool charges is fixed at creation and every buyer pays it
   * whatever the time remaining, so a buyer with ten days left of a thirty day
   * pool pays for thirty. This returns what the same cover is actually worth
   * today, priced against the volatility the underwriter themselves implied
   * when they set their opening premium.
   *
   * Read-only and unsigned. It does not change what anyone is charged; the
   * contract still takes the pool's stored rate. Both numbers come back so the
   * caller can show them side by side.
   */
  app.post("/api/pricing/quote-purchase", async (req, res) => {
    try {
      const { chainId, eventId, notional } = req.body ?? {};

      if (typeof chainId !== "number" || !Number.isFinite(chainId)) {
        return res.status(400).json({ ok: false, reason: "chainId (number) is required" });
      }
      if (typeof eventId !== "number" || !Number.isInteger(eventId) || eventId < 0) {
        return res.status(400).json({ ok: false, reason: "eventId (non-negative integer) is required" });
      }
      if (typeof notional !== "number" || !Number.isFinite(notional) || notional <= 0) {
        return res.status(400).json({ ok: false, reason: "notional (positive number) is required" });
      }

      /**
       * The anchor recorded when the pool was created, if it is there.
       *
       * quotePurchase recovers σ* from the pool's own premium when this is
       * absent, so a miss costs an extra inversion rather than a wrong answer.
       * Reading it must never be able to fail the quote, hence the catch.
       */
      let storedImpliedVol: number | null = null;
      let minPremiumRate: number | null = null;
      let originalTenorDays: number | null = null;
      try {
        const [row] = await db
          .select({
            impliedVol: hedgeEvents.impliedVol,
            minPremiumRate: hedgeEvents.minPremiumRate,
            createdAt: hedgeEvents.createdAt,
            expiryDate: hedgeEvents.expiryDate,
          })
          .from(hedgeEvents)
          .where(and(eq(hedgeEvents.chainId, chainId), eq(hedgeEvents.onChainEventId, eventId)))
          .limit(1);
        if (row) {
          const iv = row.impliedVol === null ? NaN : Number(row.impliedVol);
          const mp = row.minPremiumRate === null ? NaN : Number(row.minPremiumRate);
          if (Number.isFinite(iv) && iv > 0) storedImpliedVol = iv;
          if (Number.isFinite(mp) && mp > 0) minPremiumRate = mp;
          if (row.createdAt && row.expiryDate) {
            const days = (new Date(row.expiryDate).getTime() - new Date(row.createdAt).getTime()) / 86_400_000;
            if (Number.isFinite(days) && days > 0) originalTenorDays = days;
          }
        }
      } catch {
        /* the chain has everything needed; the mirror is an optimisation */
      }

      const result = await quotePurchase({
        chainId, eventId, notional, storedImpliedVol, minPremiumRate, originalTenorDays,
      });

      // A refusal is a real answer, not a server fault: too near expiry, or a
      // leverage bound the buyer would lose on. 200 with ok:false so the caller
      // can render the reason instead of a generic failure.
      return res.json(result);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "internal pricing error";
      return res.status(400).json({ ok: false, reason });
    }
  });

  // ── POST /api/pricing/validate ──────────────────────────────────────────
  //
  // Checked before a pool is created, because a bad premium cannot be undone
  // afterwards: premiumRate is immutable on-chain and there is no setter.
  //
  // Event 10 on Base is what this exists for. It was created at a 3.0% premium
  // against a strike and cap worth 2.681%, so the premium exceeded the maximum
  // payout and every buyer lost money the moment they bought — two of them, for
  // $55.76 between them, whatever the rate did. Nothing checked it. The only
  // guard on the form catches premiums that are too *low*.
  app.post("/api/pricing/validate", async (req, res) => {
    try {
      const { pair, premiumRate, strike, payoutCap, expiryUnixSeconds, spot, strikeAbove } = req.body ?? {};
      for (const [k, v] of [["pair", pair], ["premiumRate", premiumRate], ["strike", strike],
                            ["payoutCap", payoutCap], ["expiryUnixSeconds", expiryUnixSeconds],
                            ["spot", spot]] as Array<[string, unknown]>) {
        const bad = k === "pair" ? typeof v !== "string" || !v : typeof v !== "number" || !Number.isFinite(v);
        if (bad) return res.status(400).json({ error: `${k} is required` });
      }
      const T = (expiryUnixSeconds - Math.floor(Date.now() / 1000)) / (365.25 * 24 * 3600);
      if (T <= 0) return res.status(400).json({ error: "expiryUnixSeconds must be in the future" });

      // Neither of these may take the endpoint down with them. The checks that
      // matter most — a premium above the maximum payout, or leaving too little
      // upside to be worth buying — are arithmetic on the strike, cap and spot,
      // and need no market view at all. Only the σ band does. An unclassified
      // pair or a cold vol cache should narrow what can be said, not refuse to
      // say anything: the alternative is a 400 that reads to the LP as "your
      // premium is fine".
      const jump = await getPairJumpParams(pair).catch(() => ({
        lambda: 2.0, jumpMean: 0.08, jumpStd: 0.12,   // frontierEM defaults
      }));
      let marketSigma: number | undefined;
      try {
        marketSigma = (await getPricingVol(pair)).sigma;
      } catch {
        marketSigma = undefined;
      }

      const result = validateLpPremium({
        premiumRate, S: spot, strike, payoutCap, T,
        strikeAbove: strikeAbove !== false,
        ...jump,
        marketSigma,
      });
      return res.json({ ...result, marketSigma: marketSigma ?? null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "validation failed";
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
