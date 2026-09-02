/**
 * predict.ts — routes for the prediction market.
 *
 * Reads are public: the whole point of a prediction market is that the price is
 * visible. Writes require an account, and every rule about when a stake is
 * allowed lives in markets.ts rather than here, so the same guard applies
 * however a stake arrives.
 */
import type { Express } from "express";
import { listMarkets, placeStake, poolsFor, positionsFor, settleDueMarkets, closeExpiredStaking } from "../predict/markets";
import { quoteStake, impliedProbability } from "../predict/parimutuel";

export function registerPredictRoutes(app: Express): void {
  // ── GET /api/predict/markets ────────────────────────────────────────────
  app.get("/api/predict/markets", async (_req, res) => {
    try {
      return res.json({ markets: await listMarkets() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not load markets";
      return res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /api/predict/quote
   *
   * What a stake would return if its side won, priced INTO the pool it would
   * join rather than against the odds as they stand. On a thin market those are
   * not close: quoting pre-stake can promise several times the real return.
   */
  app.post("/api/predict/quote", async (req, res) => {
    try {
      const { marketId, side, stake } = req.body ?? {};
      if (typeof marketId !== "number" || !Number.isInteger(marketId)) {
        return res.status(400).json({ error: "marketId (integer) is required" });
      }
      if (side !== "yes" && side !== "no") {
        return res.status(400).json({ error: "side must be yes or no" });
      }
      if (typeof stake !== "number" || !Number.isFinite(stake) || stake <= 0) {
        return res.status(400).json({ error: "stake (positive number) is required" });
      }
      const pools = await poolsFor(marketId);
      return res.json({
        pools,
        impliedYesBefore: impliedProbability(pools),
        ...quoteStake({ pools, side, stake }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not quote";
      return res.status(400).json({ error: msg });
    }
  });

  // ── POST /api/predict/stake ─────────────────────────────────────────────
  app.post("/api/predict/stake", async (req, res) => {
    try {
      const { marketId, account, side, stake } = req.body ?? {};
      if (typeof account !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(account)) {
        return res.status(400).json({ error: "account (0x address) is required" });
      }
      const result = await placeStake({ marketId, account, side, stake });
      if (!result.ok) return res.status(400).json({ error: result.reason });
      return res.json({ ok: true, id: result.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not place stake";
      return res.status(400).json({ error: msg });
    }
  });

  // ── GET /api/predict/positions/:account ─────────────────────────────────
  app.get("/api/predict/positions/:account", async (req, res) => {
    try {
      const a = req.params.account;
      if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return res.status(400).json({ error: "bad account" });
      return res.json({ positions: await positionsFor(a) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not load positions";
      return res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /api/predict/settle
   *
   * Idempotent: settles only markets past their settlement time that are not
   * already resolved, so running it twice changes nothing. Safe to drive from a
   * cron or by hand.
   */
  app.post("/api/predict/settle", async (_req, res) => {
    try {
      const closed = await closeExpiredStaking();
      const result = await settleDueMarkets();
      return res.json({ closed, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "settlement failed";
      return res.status(500).json({ error: msg });
    }
  });
}
