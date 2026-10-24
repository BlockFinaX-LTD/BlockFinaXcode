/**
 * Request a quote endpoints (see ./service.ts for the flow).
 *
 * Businesses:   POST /api/v2/rfq                       file a request
 *               GET  /api/v2/rfq/mine                  my requests and the offers on them
 *               POST /api/v2/rfq/:id/cancel
 *               POST /api/v2/rfq/offers/:id/accept     creates the underwriter's pool; returns a signed quote
 *               POST /api/v2/rfq/offers/:id/bought     the purchase went through
 * Underwriters: GET  /api/v2/rfq/open                  open requests, anonymous
 *               POST /api/v2/rfq/:id/offers/prepare    a transaction to approve for the offer
 *               POST /api/v2/rfq/offers/:id/submit     the approved transaction
 *               GET  /api/v2/rfq/offers/mine
 *               POST /api/v2/rfq/offers/:id/withdraw
 */
import type { Express, Request, Response } from "express";
import { ApplicationError, type EconomicQuote } from "@shared/domain/types";
import { costBreakdown, fromRate, fromUnits, maxPayout, toRate, toUnits } from "@shared/domain/pool-economics";
import { chainRegistry } from "../chain/config";
import {
  expireOld, isApprovedUnderwriter, MIN_REQUEST_USD, newId, offerValiditySeconds, REQUEST_OPEN_HOURS, rfqDb,
  type OfferRow, type QuoteRequestRow,
} from "./service";

type Handler = (req: Request, res: Response) => Promise<void>;
interface Deps {
  getServices: () => Promise<any>;
  userId: (req: Request) => Promise<number>;
  ownerOn: (s: any, uid: number, chain: string) => Promise<string>;
  wrap: (h: Handler) => any;
}

const num = (v: unknown) => (typeof v === "string" || typeof v === "number") && Number.isFinite(Number(v)) ? Number(v) : NaN;
const PAIRS = () => (process.env.POOL_PAIRS || "USD/NGN,USD/GHS,USD/KES,USD/ZAR,USD/EGP").split(",").map((p) => p.trim()).filter(Boolean);

/** What a business sees of an offer: the terms, never who made it. */
function offerView(o: OfferRow, index: number) {
  return {
    id: o.id, label: `Underwriter ${index + 1}`, strike: o.strike, cap: o.cap, spot: o.spot, premium: o.premium,
    maxPayout: o.max_payout, validUntil: o.valid_until.toISOString(), status: o.status, error: o.error,
  };
}

function requestView(r: QuoteRequestRow) {
  return {
    id: r.id, pair: r.pair, direction: r.direction, notional: r.notional, tenorDays: r.tenor_days, strike: r.strike, cap: r.cap,
    maxPremium: r.max_premium, reason: r.reason, status: r.status, createdAt: r.created_at.toISOString(), expiresAt: r.expires_at.toISOString(),
  };
}

export function registerRfqRoutes(app: Express, d: Deps) {
  const hub = () => chainRegistry()!.hub;

  // ── Businesses ────────────────────────────────────────────────────────────

  app.post("/api/v2/rfq", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const b = req.body ?? {};
    const notional = num(b.notional);
    const tenorDays = num(b.tenorDays);
    if (!PAIRS().includes(b.pair)) throw new ApplicationError("INVALID_REQUEST", "Choose a currency BlockFinaX covers");
    if (b.direction !== "up" && b.direction !== "down") throw new ApplicationError("INVALID_REQUEST", "Choose which move worries you");
    if (!(notional >= MIN_REQUEST_USD)) throw new ApplicationError("INVALID_REQUEST", `Requests start at $${MIN_REQUEST_USD.toLocaleString("en-US")} protected`);
    if (!Number.isInteger(tenorDays) || tenorDays < 1 || tenorDays > 90) throw new ApplicationError("INVALID_REQUEST", "Choose an end date within 90 days");
    const opt = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number.isFinite(num(v)) && num(v) > 0 ? String(num(v)) : (() => { throw new ApplicationError("INVALID_REQUEST", "Rates and amounts must be positive numbers"); })());
    const db = await rfqDb();
    const id = newId("rfq");
    await db.query(
      `INSERT INTO quote_requests (id, user_id, pair, direction, notional, tenor_days, strike, cap, max_premium, reason, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + interval '${REQUEST_OPEN_HOURS} hours')`,
      [id, uid, b.pair, b.direction, String(notional), tenorDays, opt(b.strike), opt(b.cap), opt(b.maxPremium), typeof b.reason === "string" ? b.reason.slice(0, 200) : null],
    );
    res.json({ id });
  }));

  app.get("/api/v2/rfq/mine", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    await expireOld();
    const db = await rfqDb();
    const { rows } = await db.query(`SELECT * FROM quote_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [uid]);
    const ids = rows.map((r: QuoteRequestRow) => r.id);
    const offers = ids.length
      ? (await db.query(`SELECT * FROM quote_offers WHERE request_id = ANY($1) AND status <> 'draft' ORDER BY created_at`, [ids])).rows as OfferRow[]
      : [];
    res.json({
      requests: rows.map((r: QuoteRequestRow) => ({
        ...requestView(r),
        offers: offers.filter((o) => o.request_id === r.id).map(offerView)
          .map((o) => ({ ...o, live: o.status === "open" && Date.parse(o.validUntil) > Date.now() }))
          .sort((a, b) => Number(a.premium) - Number(b.premium)),
      })),
    });
  }));

  app.post("/api/v2/rfq/:id/cancel", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const db = await rfqDb();
    await db.query(`UPDATE quote_requests SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'open'`, [req.params.id, uid]);
    res.json({ ok: true });
  }));

  /**
   * Accept an offer: submit the underwriter's stored pool, then return a quote for it at the
   * offered premium. Calling it again after the pool exists just signs a fresh quote.
   */
  app.post("/api/v2/rfq/offers/:id/accept", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const s = await d.getServices();
    const db = await rfqDb();
    const { rows: [o] } = await db.query(`SELECT * FROM quote_offers WHERE id = $1`, [req.params.id]) as { rows: OfferRow[] };
    if (!o) throw new ApplicationError("INVALID_REQUEST", "Offer not found");
    const { rows: [r] } = await db.query(`SELECT * FROM quote_requests WHERE id = $1`, [o.request_id]) as { rows: QuoteRequestRow[] };
    if (!r || r.user_id !== uid) throw new ApplicationError("UNAUTHORIZED", "This offer is for another request");
    if (r.status !== "open" && !(r.status === "filled" && o.status === "accepted")) throw new ApplicationError("INVALID_REQUEST", "This request is closed");
    const chain = hub();
    const adapter = s.adapters.adapterFor(chain.key);
    const buyer = await d.ownerOn(s, uid, chain.key);

    let poolId = o.pool_id;
    if (!poolId) {
      if (o.status !== "open" || o.valid_until.getTime() < Date.now() || !o.signed_xdr) throw new ApplicationError("QUOTE_EXPIRED", "This offer is no longer available");
      try {
        const sent = await adapter.relayUserTransaction(o.signed_xdr, o.underwriter_wallet);
        for (let i = 0; i < 20 && sent.state !== "CONFIRMED"; i++) {
          await new Promise((ok) => setTimeout(ok, 1_500));
          const st = await adapter.getTransactionStatus(sent.hash);
          if (st.state === "FAILED") throw new Error("The underwriter's pool could not be created");
          if (st.state === "CONFIRMED") break;
        }
        const pool = (await adapter.recentPools(10)).find((p: any) => p.creator === o.underwriter_wallet && p.pair === r.pair && !p.allowExternalLp);
        if (!pool) throw new Error("The underwriter's pool was not found");
        poolId = pool.poolId;
        await db.query(`UPDATE quote_offers SET status = 'accepted', pool_id = $2 WHERE id = $1`, [o.id, poolId]);
        await db.query(`UPDATE quote_requests SET status = 'filled' WHERE id = $1`, [r.id]);
      } catch (err) {
        const message = (err as Error).message;
        await db.query(`UPDATE quote_offers SET status = 'failed', error = $2 WHERE id = $1`, [o.id, message.slice(0, 300)]);
        throw new ApplicationError("INSUFFICIENT_LIQUIDITY", "This offer is no longer available: the underwriter's funds could not be committed. Other offers stay open.", message);
      }
    }
    const pool = await adapter.getPool(poolId);
    const d6 = pool.asset.decimals;
    const notional = toUnits(r.notional, d6);
    const cost = costBreakdown({ notional, fairRate: BigInt(o.fair_rate_e6), markupBps: BigInt(10_000), hedgerFeeRate: BigInt(pool.fees.hedgerFeeRateE6) });
    const economic: EconomicQuote = {
      pair: r.pair, notional: r.notional, tenorDays: r.tenor_days, structure: "capped", direction: r.direction,
      spot: o.spot, strike: o.strike, cap: o.cap, fairRateE6: o.fair_rate_e6, markupBps: 10_000, offerRateE6: o.fair_rate_e6,
      premium: fromUnits(cost.premium, d6), hedgerFee: fromUnits(cost.platformFee, d6), totalCost: fromUnits(cost.totalCost, d6),
      maxPayout: fromUnits(maxPayout(notional, toRate(o.strike), toRate(o.cap), toRate(o.spot)), d6), pool: pool.ref, executionChain: chain.key,
    };
    res.json({ quote: await adapter.signQuote(economic, buyer, poolId) });
  }));

  app.post("/api/v2/rfq/offers/:id/bought", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const db = await rfqDb();
    await db.query(
      `UPDATE quote_offers o SET status = 'bought' FROM quote_requests r WHERE o.id = $1 AND r.id = o.request_id AND r.user_id = $2 AND o.status = 'accepted'`,
      [req.params.id, uid],
    );
    res.json({ ok: true });
  }));

  // ── Underwriters ──────────────────────────────────────────────────────────

  app.get("/api/v2/rfq/open", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    await expireOld();
    const db = await rfqDb();
    const { rows } = await db.query(`SELECT * FROM quote_requests WHERE status = 'open' AND user_id <> $1 ORDER BY created_at DESC LIMIT 100`, [uid]);
    const ids = rows.map((r: QuoteRequestRow) => r.id);
    const mine = ids.length
      ? (await db.query(`SELECT request_id, status, valid_until FROM quote_offers WHERE request_id = ANY($1) AND underwriter_user_id = $2 AND status <> 'draft'`, [ids, uid])).rows
      : [];
    res.json({
      approved: isApprovedUnderwriter(uid),
      requests: rows.map((r: QuoteRequestRow) => ({
        ...requestView(r),
        myOffer: mine.find((m: any) => m.request_id === r.id) ?? null,
        offerValidSeconds: offerValiditySeconds(r.tenor_days),
      })),
    });
  }));

  app.post("/api/v2/rfq/:id/offers/prepare", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    if (!isApprovedUnderwriter(uid)) throw new ApplicationError("UNAUTHORIZED", "Your account is not approved to answer requests");
    const s = await d.getServices();
    const db = await rfqDb();
    const { rows: [r] } = await db.query(`SELECT * FROM quote_requests WHERE id = $1`, [req.params.id]) as { rows: QuoteRequestRow[] };
    if (!r || r.status !== "open" || r.expires_at.getTime() < Date.now()) throw new ApplicationError("INVALID_REQUEST", "This request is closed");
    if (r.user_id === uid) throw new ApplicationError("INVALID_REQUEST", "You cannot answer your own request");
    const strike = num(req.body?.strike), cap = num(req.body?.cap), premium = num(req.body?.premium);
    if (!(strike > 0 && cap > 0 && premium > 0)) throw new ApplicationError("INVALID_REQUEST", "Enter the strike, the cap and your premium");
    if (r.direction === "up" ? !(cap > strike) : !(cap < strike)) {
      throw new ApplicationError("INVALID_CAP", r.direction === "up" ? "The cap must be above the strike" : "The cap must be below the strike");
    }
    const chain = hub();
    const adapter = s.adapters.adapterFor(chain.key);
    const wallet = await d.ownerOn(s, uid, chain.key);
    const spot = await s.quotes.spot(r.pair);
    const d7 = 7;
    const notional = toUnits(r.notional, d7);
    const reserve = maxPayout(notional, toRate(strike), toRate(cap), toRate(spot));
    if (toUnits(premium, d7) >= reserve) throw new ApplicationError("INVALID_REQUEST", "The premium must be less than the most the cover can pay");
    const fairRateE6 = Math.round((premium / Number(r.notional)) * 1e6);
    if (fairRateE6 < 1) throw new ApplicationError("INVALID_REQUEST", "The premium is too small for this amount");
    const fee = toUnits(await adapter.getPoolCreationFee(), d7);
    const balance = toUnits(await adapter.getBalance(wallet, "USDC"), d7);
    if (balance < reserve + fee) {
      throw new ApplicationError("INSUFFICIENT_LIQUIDITY", `You need ${fromUnits(reserve + fee, d7)} USDC to back this offer (the most it can pay plus the pool fee); you have ${fromUnits(balance, d7)}.`);
    }
    const valid = offerValiditySeconds(r.tenor_days);
    // A private pool with exactly these terms: one duration at fair x 1.0, capped cover only.
    const prepared = await adapter.prepareCreatePoolForLater(wallet, {
      pair: r.pair, direction: r.direction, allowExternalLp: false, initialLiquidity: fromUnits(reserve, d7),
      structures: { open: false, capped: true, minCapDistanceBps: 0, maxCapDistanceBps: 10_000, openMaxPayoutBps: 0, minStrikeDistanceBps: 0 },
      tenors: [{ tenorDays: r.tenor_days, active: true, markupBps: 10_000 }],
    }, valid);
    const id = newId("offer");
    await db.query(
      `INSERT INTO quote_offers (id, request_id, underwriter_user_id, underwriter_wallet, strike, cap, spot, premium, fair_rate_e6, max_payout, liquidity, valid_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + ($12 || ' seconds')::interval)`,
      [id, r.id, uid, wallet, fromRate(toRate(strike)), fromRate(toRate(cap)), spot, String(premium), fairRateE6, fromUnits(reserve, d7), fromUnits(reserve, d7), String(valid)],
    );
    res.json({ id, transaction: prepared, maxPayout: fromUnits(reserve, d7), creationFee: fromUnits(fee, d7), validSeconds: valid });
  }));

  app.post("/api/v2/rfq/offers/:id/submit", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const signed = req.body?.signedXdr;
    if (typeof signed !== "string" || signed.length < 100) throw new ApplicationError("INVALID_REQUEST", "Approve the offer with your passkey first");
    const db = await rfqDb();
    const { rowCount } = await db.query(
      `UPDATE quote_offers SET signed_xdr = $3, status = 'open' WHERE id = $1 AND underwriter_user_id = $2 AND status = 'draft' AND valid_until > now()`,
      [req.params.id, uid, signed],
    );
    if (!rowCount) throw new ApplicationError("INVALID_REQUEST", "This offer can no longer be sent");
    // Tell the business a new offer arrived (best effort).
    void notifyBusiness(req.params.id).catch((err) => console.warn(`[rfq] notify failed: ${(err as Error).message}`));
    res.json({ ok: true });
  }));

  app.get("/api/v2/rfq/offers/mine", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const db = await rfqDb();
    const { rows } = await db.query(
      `SELECT o.*, r.pair, r.direction, r.notional, r.tenor_days FROM quote_offers o JOIN quote_requests r ON r.id = o.request_id
       WHERE o.underwriter_user_id = $1 AND o.status <> 'draft' ORDER BY o.created_at DESC LIMIT 50`,
      [uid],
    );
    res.json({
      offers: rows.map((o: any) => ({
        id: o.id, pair: o.pair, direction: o.direction, notional: o.notional, tenorDays: o.tenor_days, strike: o.strike, cap: o.cap,
        premium: o.premium, maxPayout: o.max_payout, status: o.status, validUntil: o.valid_until.toISOString(), poolId: o.pool_id, error: o.error,
      })),
    });
  }));

  app.post("/api/v2/rfq/offers/:id/withdraw", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const db = await rfqDb();
    await db.query(`UPDATE quote_offers SET status = 'withdrawn', signed_xdr = NULL WHERE id = $1 AND underwriter_user_id = $2 AND status = 'open'`, [req.params.id, uid]);
    res.json({ ok: true });
  }));
}

/** Email the business that asked: a new offer is waiting. */
async function notifyBusiness(offerId: string) {
  const db = await rfqDb();
  const { rows: [row] } = await db.query(
    `SELECT r.pair, r.notional, r.tenor_days, o.premium, o.valid_until, u.email
       FROM quote_offers o JOIN quote_requests r ON r.id = o.request_id JOIN user_accounts u ON u.id = r.user_id WHERE o.id = $1`,
    [offerId],
  );
  if (!row?.email) return;
  const { sendEmail, shell, escapeHtml, APP_URL } = await import("../email");
  const until = new Date(row.valid_until).toUTCString().replace(":00 GMT", " UTC");
  await sendEmail({
    to: row.email,
    subject: `A quote for your ${row.pair} protection`,
    html: shell("You have a new quote", `
      <p style="font-size:14px;">An underwriter offered to protect ${escapeHtml(Number(row.notional).toLocaleString("en-US"))} USD of ${escapeHtml(row.pair)} exposure for ${row.tenor_days} days, for a premium of ${escapeHtml(row.premium)} USDC.</p>
      <p style="font-size:14px;">It is valid until ${escapeHtml(until)}.</p>
      <p><a href="${APP_URL}/hedge" style="color:#1f5fe0;">Review the quote</a></p>`),
  });
}
