/**
 * pricing.ts — REST endpoints for the pricing engine.
 *
 *   POST /api/pricing/quote     — get a fair-premium quote for a hedge event
 *   POST /api/pricing/validate  — is this a premium anyone should be allowed to sell?
 *   POST /api/pricing/pool-quote         currency pools: price and sign a hedger's terms
 *   GET  /api/pricing/pool-options       currency pools: what is on sale for a pair
 *   POST /api/pricing/pool-tenor-prices  currency pools: fair vs offer per tenor
 *   GET  /api/pricing/health    — diagnostic: USD rate cache, last close per pair
 *
 * The quote endpoint is read-only and unsigned (no wallet signature required) —
 * it just runs math on public market data. Rate-limited via the global API
 * limiter in routes.ts.
 */

import type { Express } from "express";
import { quote } from "../pricing/quote";
import { quotePurchase } from "../pricing/quote-purchase";
import { quotePoolBuy, tenorFairPrices, poolTenorFairPrices, poolOptions, readNormalizedPool, readNormalizedPositions } from "../pricing/pool-quote";
import { signPurchaseQuote } from "../pricing/signer";
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

/**
 * The Diamond a quote is bound to. Read from env with the deployed address as
 * the fallback, matching quote-purchase.ts, because a signature bound to the
 * wrong diamond is rejected on chain rather than misapplied.
 */
const DIAMONDS: Record<number, string> = {
  8453: process.env.BASE_DIAMOND_ADDRESS || "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
  56: process.env.BSC_DIAMOND_ADDRESS || "0xaC939C0897981Abc0711ec4e37527F13106180fc",
};


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
   * Both numbers come back, the live one and the pool's own, so a caller can
   * show them side by side.
   *
   * Unsigned by default. Pass `buyer` and the response carries an attestation
   * the contract will accept from that address, which is what a dynamic pool
   * needs to be bought at all. Without a buyer this stays advisory, which is
   * the right shape for showing a price before anyone has committed to it.
   */
  app.post("/api/pricing/quote-purchase", async (req, res) => {
    try {
      const { chainId, eventId, notional, buyer } = req.body ?? {};

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

          /**
           * The fallback tenor, and it is only that.
           *
           * `created_at` is `new Date()` at row insert, so it records when
           * chain-sync noticed the pool rather than when the pool was created.
           * On Base event 13 the gap was eleven minutes on a one day pool, and
           * because sigma is sensitive to tenor on short cover, the same pool
           * priced from two mirrors returned 43.41% and 29.21%.
           *
           * resolveSigmaStar takes the creation time from the chain and caches
           * the answer. This is passed only so a pool it cannot find still
           * gets a number rather than nothing.
           */
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

      /**
       * Attach a signature when the caller says who is buying.
       *
       * Without a buyer this stays advisory: a price to show beside the pool's
       * own, which is what the buy sheet uses before anyone commits. With one,
       * it becomes spendable, and the contract binds it to that address so it
       * cannot be lifted from the mempool and used by somebody else.
       *
       * Signing is deliberately last. A quote that was refused has no price to
       * sign, and signing before the leverage and floor checks would put the
       * engine's name on a number it had already rejected.
       */
      if (result.ok && typeof buyer === "string" && /^0x[0-9a-fA-F]{40}$/.test(buyer)) {
        const diamond = DIAMONDS[chainId];
        if (diamond) {
          const attestation = await signPurchaseQuote({
            chainId,
            diamondAddress: diamond,
            buyer,
            eventId,
            // 6-decimal fixed, as the contract holds them.
            notional: BigInt(Math.round(notional * 1e6)),
            premiumRate: BigInt(Math.round(result.premiumRate * 1e6)),
          });
          /**
           * quoteTimestamp is a bigint, and JSON.stringify throws on those, so
           * res.json() failed and the catch below turned it into a 400. The
           * signing path was never exercised end to end before shipping,
           * because the only pool available to test against had settled and
           * the request was refused long before it reached here.
           *
           * Serialised as a decimal string rather than a number: these are unix
           * seconds today, but a string cannot silently lose precision if that
           * ever changes, and the client casts it back with BigInt() either way.
           */
          return res.json({
            ...result,
            attestation: attestation
              ? { ...attestation, quoteTimestamp: attestation.quoteTimestamp.toString() }
              : null,
          });
        }
      }

      // A refusal is a real answer, not a server fault: too near expiry, or a
      // leverage bound the buyer would lose on. 200 with ok:false so the caller
      // can render the reason instead of a generic failure.
      return res.json(result);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "internal pricing error";
      return res.status(400).json({ ok: false, reason });
    }
  });

  // ── POST /api/pricing/pool-quote ────────────────────────────────────────
  //
  // A hedger's exact terms on a currency pool, priced and signed for
  // buyPoolProtection. A refusal (tenor off, cap out of bounds, not enough
  // capacity) is a 200 with ok:false so the app can show the reason.
  app.post("/api/pricing/pool-quote", async (req, res) => {
    try {
      const b = req.body ?? {};
      const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
      if (!isNum(b.chainId)) {
        return res.status(400).json({ ok: false, reason: "chainId is required" });
      }
      const hasPool = Number.isInteger(b.poolId) && b.poolId > 0;
      if (!hasPool && typeof b.pair !== "string") {
        return res.status(400).json({ ok: false, reason: "Pass a currency pair (or a specific poolId)" });
      }
      if (typeof b.buyer !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(b.buyer)) {
        return res.status(400).json({ ok: false, reason: "buyer (wallet address) is required" });
      }
      if (!isNum(b.notional) || b.notional <= 0) {
        return res.status(400).json({ ok: false, reason: "notional must be a positive number" });
      }
      if (!Number.isInteger(b.tenorDays) || b.tenorDays < 1 || b.tenorDays > 365) {
        return res.status(400).json({ ok: false, reason: "tenorDays must be 1 to 365" });
      }
      if (b.structure !== "open" && b.structure !== "capped") {
        return res.status(400).json({ ok: false, reason: "structure must be 'open' or 'capped'" });
      }
      if (typeof b.strikeAbove !== "boolean" || !isNum(b.strike) || b.strike <= 0) {
        return res.status(400).json({ ok: false, reason: "strikeAbove and strike are required" });
      }
      if (b.cap !== undefined && (!isNum(b.cap) || b.cap <= 0)) {
        return res.status(400).json({ ok: false, reason: "cap must be a positive number" });
      }
      return res.json(await quotePoolBuy(b));
    } catch (err) {
      return res.status(400).json({ ok: false, reason: err instanceof Error ? err.message : "internal pricing error" });
    }
  });

  // ── GET /api/pricing/pool-options?chainId=8453&pair=USD/GHS ─────────────
  //
  // The durations and structures any pool is selling on a pair, and the
  // largest hedge one pool can take, for the hedger's pickers.
  app.get("/api/pricing/pool-options", async (req, res) => {
    try {
      const chainId = Number(req.query.chainId);
      const pair = String(req.query.pair ?? "");
      if (!Number.isFinite(chainId) || !pair) {
        return res.status(400).json({ ok: false, reason: "chainId and pair are required" });
      }
      return res.json(await poolOptions(chainId, pair));
    } catch (err) {
      return res.status(400).json({ ok: false, reason: err instanceof Error ? err.message : "internal pricing error" });
    }
  });

  // ── Currency pools, read in the shape the Stellar wallet server also returns ──
  app.get("/api/pools/:chainId/pool/:poolId", async (req, res) => {
    try {
      return res.json(await readNormalizedPool(Number(req.params.chainId), Number(req.params.poolId)));
    } catch (err) {
      return res.status(400).json({ ok: false, reason: err instanceof Error ? err.message : "read failed" });
    }
  });
  app.get("/api/pools/:chainId/positions/:hedger", async (req, res) => {
    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(req.params.hedger)) return res.status(400).json({ ok: false, reason: "invalid address" });
      return res.json({ positions: await readNormalizedPositions(Number(req.params.chainId), req.params.hedger) });
    } catch (err) {
      return res.status(400).json({ ok: false, reason: err instanceof Error ? err.message : "read failed" });
    }
  });

  // ── POST /api/pricing/pool-tenor-prices ─────────────────────────────────
  //
  // Fair vs offer price per tenor at a reference strike, for the underwriter.
  // Pass { chainId, poolId } for an existing pool, or { pair, tenors } while
  // creating one.
  app.post("/api/pricing/pool-tenor-prices", async (req, res) => {
    try {
      const b = req.body ?? {};
      const structure = b.structure === "open" ? "open" : "capped";
      const strikeAbove = b.strikeAbove !== false;
      if (Number.isInteger(b.poolId) && typeof b.chainId === "number") {
        return res.json(await poolTenorFairPrices({
          chainId: b.chainId, poolId: b.poolId, structure, strikeAbove,
          refStrikeBps: b.refStrikeBps, refCapBps: b.refCapBps,
        }));
      }
      if (typeof b.pair !== "string" || !Array.isArray(b.tenors) || b.tenors.length === 0) {
        return res.status(400).json({ ok: false, reason: "Pass chainId + poolId, or pair + tenors" });
      }
      return res.json(await tenorFairPrices({
        pair: b.pair, tenors: b.tenors, structure, strikeAbove,
        refStrikeBps: b.refStrikeBps, refCapBps: b.refCapBps, openMaxPayoutBps: b.openMaxPayoutBps,
      }));
    } catch (err) {
      return res.status(400).json({ ok: false, reason: err instanceof Error ? err.message : "internal pricing error" });
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
