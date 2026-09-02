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
import { balanceOf, entriesFor } from "../predict/ledger";
import { creditDeposit, treasuryAddress } from "../predict/deposits";
import { requestWithdrawal, executeWithdrawal, withdrawalsFor, MIN_WITHDRAWAL } from "../predict/withdrawals";
import { requireSignature, type AuthenticatedRequest } from "../middleware/signature-auth";

/**
 * The account a money-moving request is allowed to act on.
 *
 * Taken from the signature, never from the body. A route that trusted an
 * `account` field would let anyone spend anyone else's balance by typing their
 * address, which is the entire attack.
 */
function signer(req: AuthenticatedRequest): string | null {
  const a = req.walletAddress;
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null;
}

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
  app.post("/api/predict/stake", requireSignature, async (req: AuthenticatedRequest, res) => {
    try {
      const account = signer(req);
      if (!account) return res.status(401).json({ error: "Sign in with your wallet to take a position." });
      const { marketId, side, stake } = req.body ?? {};
      const result = await placeStake({ marketId, account, side, stake });
      if (!result.ok) return res.status(400).json({ error: result.reason });
      return res.json({ ok: true, id: result.id, balance: await balanceOf(account) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not place stake";
      return res.status(400).json({ error: msg });
    }
  });

  // ── GET /api/predict/account ────────────────────────────────────────────
  app.get("/api/predict/account", requireSignature, async (req: AuthenticatedRequest, res) => {
    try {
      const account = signer(req);
      if (!account) return res.status(401).json({ error: "Not signed in." });
      return res.json({
        account,
        balance: await balanceOf(account),
        depositAddress: treasuryAddress(),
        minWithdrawal: MIN_WITHDRAWAL,
        entries: await entriesFor(account),
        withdrawals: await withdrawalsFor(account),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not load account";
      return res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /api/predict/deposit
   *
   * Takes a transaction hash and nothing else. The amount, the token, the
   * sender and the recipient are all read from the chain, because a caller who
   * could name their own amount could mint balance from a one dollar transfer.
   */
  app.post("/api/predict/deposit", requireSignature, async (req: AuthenticatedRequest, res) => {
    try {
      const account = signer(req);
      if (!account) return res.status(401).json({ error: "Sign in with your wallet first." });
      const { txHash } = req.body ?? {};
      if (typeof txHash !== "string") return res.status(400).json({ error: "txHash is required" });

      const r = await creditDeposit({ account, txHash });
      if (!r.ok) return res.status(400).json({ error: r.reason });
      return res.json({ ...r, balance: await balanceOf(account) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not credit that deposit";
      return res.status(400).json({ error: msg });
    }
  });

  // ── POST /api/predict/withdraw ──────────────────────────────────────────
  app.post("/api/predict/withdraw", requireSignature, async (req: AuthenticatedRequest, res) => {
    try {
      const account = signer(req);
      if (!account) return res.status(401).json({ error: "Sign in with your wallet first." });
      const { amount } = req.body ?? {};
      if (typeof amount !== "number") return res.status(400).json({ error: "amount (number) is required" });

      const r = await requestWithdrawal({ account, amount });
      if (!r.ok) return res.status(400).json({ error: r.reason });

      // Send straight away when a key is configured. When it is not, the
      // request stays pending for an operator rather than failing, because the
      // balance has already been debited and the user is owed the money either
      // way.
      const sent = await executeWithdrawal(r.id);
      return res.json({
        ok: true,
        id: r.id,
        sent: sent.ok,
        txHash: sent.ok ? sent.txHash : null,
        note: sent.ok ? null : sent.reason,
        balance: await balanceOf(account),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not withdraw";
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
