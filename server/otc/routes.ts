/**
 * OTC endpoints (see ./service.ts for the flow).
 *
 * Personal accounts and business accounts. With the X-BFX-Organisation header the request
 * acts for the business account, and the member's role decides what they may do:
 *   admin     everything: buy and sell USDC, release, and run the business as a merchant
 *   operator  buy USDC: open orders on merchants' selling offers, pay, mark paid, cancel, dispute
 *   viewer    see orders and messages only
 * The relay and the account's on-chain rules enforce the same limits.
 *
 * Everyone signed in
 *   GET  /api/v2/otc/config
 *   GET  /api/v2/otc/market?currency=NGN&side=buy|sell     live offers
 *   GET  /api/v2/otc/orders                                my orders (as user or merchant)
 *   GET  /api/v2/otc/orders/:id
 *   POST /api/v2/otc/orders/prepare           { offerId, amount, payeeDetails? }
 *   POST /api/v2/otc/orders/:id/proof         { type, data(base64) }
 *   GET  /api/v2/otc/orders/:id/proof
 *   POST /api/v2/otc/orders/:id/paid/prepare
 *   POST /api/v2/otc/orders/:id/release/prepare
 *   POST /api/v2/otc/orders/:id/cancel/prepare
 *   POST /api/v2/otc/orders/:id/dispute/prepare { reason }
 *   GET  /api/v2/otc/orders/:id/messages      POST { body }
 *   POST /api/v2/otc/sync                     { offerId?, orderId? }   after a transaction lands
 * Requests for a quote
 *   GET  /api/v2/otc/requests                 my requests and the quotes on them
 *   POST /api/v2/otc/requests                 { side, currency, amount, methodType, payee?, note? }
 *   POST /api/v2/otc/requests/:id/cancel
 *   GET  /api/v2/otc/requests/open            (merchants) requests they can quote
 *   POST /api/v2/otc/requests/:id/quote/prepare { rate }   (merchants) -> { quoteId, transactions }
 *   POST /api/v2/otc/quotes/:id/sent          (merchants) after the quote's transaction lands
 * Merchants
 *   GET  /api/v2/otc/merchant                 my profile and offers
 *   POST /api/v2/otc/merchant/apply           { displayName, about, markets, paymentDetails }
 *   POST /api/v2/otc/merchant                 { displayName?, markets?, paymentDetails? }
 *   POST /api/v2/otc/offers/prepare           { side, currency, rate, amount, minOrder, maxOrder }
 *   POST /api/v2/otc/offers/:id/prepare       { kind: update|top_up|withdraw|close, ... }
 * BlockFinaX (admin token)
 *   GET  /api/v2/admin/otc/merchants?status=  POST /api/v2/admin/otc/merchants/:merchantId { decision, note }
 *   GET  /api/v2/admin/otc/orders?filter=     GET  /api/v2/admin/otc/orders/:id (+ /messages, /proof)
 *   POST /api/v2/admin/otc/orders/:id/resolve { releaseToReceiver, note }
 *   POST /api/v2/admin/otc/orders/:id/messages { body }
 */
import type { Express, Request, Response } from "express";
import { ApplicationError } from "@shared/domain/types";
import { OTC_CURRENCIES, OTC_CURRENCY_NAMES } from "@shared/otc";
import { chainRegistry } from "../chain/config";
import { requireAdmin } from "../middleware/admin-auth";
import { StellarOtcGateway } from "./chain";
import { OtcService } from "./service";

type Handler = (req: Request, res: Response) => Promise<void>;
interface Deps {
  getServices: () => Promise<any>;
  userId: (req: Request) => Promise<number>;
  ownerOn: (s: any, uid: number, chain: string) => Promise<string>;
  /** The business account a request acts for (X-BFX-Organisation), with the member's role; null for personal. */
  acting: (req: Request, uid: number, chain: string) => Promise<{ id: number; account: string; role: "admin" | "operator" | "viewer" } | null>;
  wrap: (h: Handler) => any;
}

type Role = "personal" | "admin" | "operator" | "viewer";
type Action = "read" | "buy" | "pay" | "release" | "sell" | "merchant";
/** Which roles may do what. Personal accounts and business admins may do everything. */
const ALLOWED: Record<Action, Role[]> = {
  read: ["personal", "admin", "operator", "viewer"],
  buy: ["personal", "admin", "operator"],
  pay: ["personal", "admin", "operator"],
  release: ["personal", "admin"],
  sell: ["personal", "admin"],
  merchant: ["personal", "admin"],
};
const REFUSED: Record<Action, string> = {
  read: "",
  buy: "Viewers can see orders but cannot trade",
  pay: "Viewers can see orders but cannot act on them",
  release: "Only an admin can release the business's USDC",
  sell: "Only an admin can sell the business's USDC",
  merchant: "Only an admin can run the business as a merchant",
};

let cached: OtcService | null | undefined;

/** The service, or null when this deployment has no OTC escrow configured. */
async function otcService(getServices: () => Promise<any>): Promise<OtcService | null> {
  if (cached !== undefined) return cached;
  const chain = chainRegistry()?.all().find((c) => c.family === "stellar" && c.contracts.otcEscrow);
  const { pool } = await import("../db");
  if (!chain || !pool) return (cached = null);
  const gateway = new StellarOtcGateway(chain);
  const balanceOf = async (wallet: string) => {
    const s = await getServices();
    return s.adapters.adapterFor(chain.key).getBalance(wallet, "USDC");
  };
  return (cached = new OtcService(pool as never, gateway, balanceOf));
}

const id = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApplicationError("INVALID_REQUEST", "Not a valid id");
  return n;
};

export function registerOtcRoutes(app: Express, d: Deps) {
  const svc = async () => {
    const s = await otcService(d.getServices);
    if (!s) throw new ApplicationError("CHAIN_NOT_ENABLED", "OTC is not available on this network yet");
    return s;
  };
  /**
   * The signed-in user and the account they act for: their own wallet, or their business's
   * account with their role there. `action` is checked against the role.
   */
  const me = async (req: Request, action: Action = "read") => {
    const otc = await svc();
    const uid = await d.userId(req);
    const chain = otc.gateway.chainKey;
    const org = req.header("x-bfx-organisation") ? await d.acting(req, uid, chain) : null;
    const role: Role = org ? org.role : "personal";
    if (!ALLOWED[action].includes(role)) throw new ApplicationError("UNAUTHORIZED", REFUSED[action]);
    const wallet = org ? org.account : await d.ownerOn(await d.getServices(), uid, chain);
    return { otc, uid, wallet, role, organisationId: org?.id ?? null };
  };
  const notify = (fn: () => Promise<void>) => void fn().catch((err) => console.warn(`[otc] notify failed: ${(err as Error).message}`));

  app.get("/api/v2/otc/config", d.wrap(async (_req, res) => {
    const s = await otcService(d.getServices);
    res.json({
      available: Boolean(s),
      chain: s?.gateway.chainKey ?? null,
      escrow: s?.gateway.contractId ?? null,
      currencies: OTC_CURRENCIES.map((c) => ({ code: c, name: OTC_CURRENCY_NAMES[c] })),
    });
  }));

  app.get("/api/v2/otc/market", d.wrap(async (req, res) => {
    const { otc } = await me(req);
    const side = req.query.side === "sell" ? "sell" : "buy";
    res.json({ offers: await otc.market(String(req.query.currency ?? ""), side) });
  }));

  // ── Orders ──

  app.get("/api/v2/otc/orders", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req);
    res.json({ wallet, orders: await otc.myOrders(wallet) });
  }));

  app.get("/api/v2/otc/orders/:id", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req);
    res.json({ order: await otc.order(wallet, id(req.params.id)) });
  }));

  app.post("/api/v2/otc/orders/prepare", d.wrap(async (req, res) => {
    const { otc, uid, wallet, role } = await me(req, "buy");
    const body = { ...(req.body ?? {}) };
    // Accepting a quote on a sell request: pay out to the account given with the request.
    if (!body.payee && body.offerId) body.payee = await otc.requestPayee(wallet, Number(body.offerId)) ?? undefined;
    res.json({ transactions: await otc.prepareOpenOrder(uid, wallet, body, ALLOWED.sell.includes(role)) });
  }));

  app.post("/api/v2/otc/orders/:id/proof", d.wrap(async (req, res) => {
    const { otc, uid, wallet } = await me(req, "pay");
    res.json(await otc.uploadProof(uid, wallet, id(req.params.id), req.body ?? {}));
  }));

  app.get("/api/v2/otc/orders/:id/proof", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req);
    const p = await otc.proof(wallet, id(req.params.id));
    res.setHeader("Content-Type", p.mime);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(p.bytes);
  }));

  app.post("/api/v2/otc/orders/:id/paid/prepare", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "pay");
    res.json({ transactions: await otc.prepareMarkPaid(wallet, id(req.params.id)) });
  }));

  app.post("/api/v2/otc/orders/:id/release/prepare", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "release");
    res.json({ transactions: await otc.prepareRelease(wallet, id(req.params.id)) });
  }));

  app.post("/api/v2/otc/orders/:id/cancel/prepare", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "pay");
    res.json({ transactions: await otc.prepareCancel(wallet, id(req.params.id)) });
  }));

  app.post("/api/v2/otc/orders/:id/dispute/prepare", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "pay");
    res.json({ transactions: await otc.prepareDispute(wallet, id(req.params.id), req.body?.reason) });
  }));

  app.get("/api/v2/otc/orders/:id/messages", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req);
    res.json({ messages: await otc.messages(wallet, id(req.params.id)) });
  }));

  app.post("/api/v2/otc/orders/:id/messages", d.wrap(async (req, res) => {
    const { otc, uid, wallet } = await me(req, "pay");
    await otc.postMessage(uid, wallet, id(req.params.id), req.body?.body);
    res.json({ ok: true });
  }));

  /** Called by the app after a transaction lands, so lists show it at once. Emails the other side. */
  app.post("/api/v2/otc/sync", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "pay");
    const offerId = req.body?.offerId ? id(req.body.offerId) : undefined;
    const orderId = req.body?.orderId ? id(req.body.orderId) : undefined;
    const before = orderId ? (await otc.order(wallet, orderId).catch(() => null))?.status : undefined;
    await otc.afterTransaction({ offerId, orderId });
    // The newest order this wallet opened, so the app can go straight to it.
    const mine = await otc.myOrders(wallet);
    const after = orderId ? mine.find((o) => o.id === orderId) : undefined;
    if (after && after.status !== before) notify(() => emailOnChange(otc, after.id, after.status));
    const opened = !orderId && req.body?.opened ? mine.find((o) => o.me?.isMerchant === false) : undefined;
    if (opened) notify(() => emailOnChange(otc, opened.id, "open"));
    res.json({ ok: true, openedOrderId: opened?.id ?? null });
  }));

  // ── Requests for a quote ──

  app.get("/api/v2/otc/requests", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req);
    res.json({ requests: await otc.myRequests(wallet) });
  }));

  app.post("/api/v2/otc/requests", d.wrap(async (req, res) => {
    const { otc, uid, wallet, role, organisationId } = await me(req, "buy");
    const out = await otc.createRequest(uid, wallet, organisationId, req.body ?? {}, ALLOWED.sell.includes(role));
    notify(async () => {
      const { sendEmail, shell, escapeHtml, APP_URL } = await import("../email");
      const merchants = (await otc.merchants("approved")).filter((m) => m.markets.includes(req.body.currency) && m.wallet !== wallet);
      const { pool } = await import("../db");
      for (const m of merchants) {
        const to = (await pool?.query(`SELECT email FROM user_accounts WHERE id = $1`, [m.userId]))?.rows?.[0]?.email;
        if (!to) continue;
        await sendEmail({ to, subject: `New OTC request: ${req.body.side === "buy" ? "buy" : "sell"} ${req.body.amount} USDC for ${req.body.currency}`,
          html: shell("A customer wants a quote", `<p style="font-size:14px;">Someone wants to ${req.body.side === "buy" ? "buy" : "sell"} ${escapeHtml(String(req.body.amount))} USDC for ${escapeHtml(String(req.body.currency))}. Send your price from OTC, Merchant, Requests.</p><p><a href="${APP_URL}/hedge" style="color:#1f5fe0;">Open BlockFinaX</a></p>`) });
      }
    });
    res.json(out);
  }));

  app.post("/api/v2/otc/requests/:id/cancel", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "buy");
    await otc.cancelRequest(wallet, id(req.params.id));
    res.json({ ok: true });
  }));

  app.get("/api/v2/otc/requests/open", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "merchant");
    res.json({ requests: await otc.openRequests(wallet) });
  }));

  app.post("/api/v2/otc/requests/:id/quote/prepare", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "merchant");
    res.json(await otc.prepareQuote(wallet, id(req.params.id), req.body?.rate));
  }));

  app.post("/api/v2/otc/quotes/:id/sent", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "merchant");
    const out = await otc.linkQuote(wallet, id(req.params.id));
    if (out.linked) notify(async () => {
      const r = await otc.requestContact(out.requestId);
      if (!r?.email) return;
      const { sendEmail, shell, APP_URL } = await import("../email");
      await sendEmail({ to: r.email, subject: `A quote for your ${r.amount} USDC request`,
        html: shell("You have a new quote", `<p style="font-size:14px;">A merchant answered your request to ${r.side} ${Number(r.amount)} USDC for ${r.currency}. Open OTC to compare quotes and accept one.</p><p><a href="${APP_URL}/hedge" style="color:#1f5fe0;">Open BlockFinaX</a></p>`) });
    });
    res.json(out);
  }));

  // ── Merchants ──

  app.get("/api/v2/otc/merchant", d.wrap(async (req, res) => {
    const { otc, wallet, role } = await me(req);
    const profile = await otc.merchant(wallet);
    res.json({ wallet, role, merchant: profile, offers: profile ? await otc.myOffers(profile.wallet) : [] });
  }));

  app.post("/api/v2/otc/merchant/apply", d.wrap(async (req, res) => {
    const { otc, uid, wallet, organisationId } = await me(req, "merchant");
    const m = await otc.apply(uid, wallet, organisationId, req.body ?? {});
    notify(async () => {
      const { sendEmail, shell, escapeHtml } = await import("../email");
      const { getOwnerEmails } = await import("../middleware/admin-auth");
      for (const to of getOwnerEmails()) {
        await sendEmail({ to, subject: "New OTC merchant application", html: shell("New OTC merchant application", `<p style="font-size:14px;">${escapeHtml(m?.displayName ?? "")} applied to trade ${escapeHtml((m?.markets ?? []).join(", "))}. Review it in the admin dashboard under OTC.</p>`) });
      }
    });
    res.json({ merchant: m });
  }));

  app.post("/api/v2/otc/merchant", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "merchant");
    res.json({ merchant: await otc.updateDetails(wallet, req.body ?? {}) });
  }));

  app.post("/api/v2/otc/offers/prepare", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "merchant");
    res.json({ transactions: await otc.prepareCreateOffer(wallet, req.body ?? {}) });
  }));

  app.post("/api/v2/otc/offers/:id/prepare", d.wrap(async (req, res) => {
    const { otc, wallet } = await me(req, "merchant");
    res.json({ transactions: await otc.prepareOfferChange(wallet, id(req.params.id), req.body ?? {}) });
  }));

  // ── BlockFinaX ──

  const admin = (h: Handler) => [requireAdmin, d.wrap(h)];
  const by = (req: Request) => String((req as any).adminEmail ?? "admin");

  app.get("/api/v2/admin/otc/merchants", ...admin(async (req, res) => {
    const otc = await svc();
    res.json({ merchants: await otc.merchants(typeof req.query.status === "string" ? req.query.status : undefined), arbiter: otc.gateway.arbiterAddress() });
  }));

  app.post("/api/v2/admin/otc/merchants/:merchantId", ...admin(async (req, res) => {
    const otc = await svc();
    const decision = req.body?.decision;
    if (!["approve", "decline", "remove"].includes(decision)) throw new ApplicationError("INVALID_REQUEST", "Choose approve, decline or remove");
    const m = await otc.decideMerchant(id(req.params.merchantId), decision, by(req), req.body?.note);
    notify(async () => {
      const { sendEmail, shell, APP_URL } = await import("../email");
      const contacts = await (await import("../db")).pool?.query(`SELECT email FROM user_accounts WHERE id = $1`, [m?.userId]);
      const to = contacts?.rows?.[0]?.email;
      if (!to || decision === "remove") return;
      await sendEmail({
        to,
        subject: decision === "approve" ? "You are approved as a BlockFinaX OTC merchant" : "Your BlockFinaX OTC application",
        html: shell("OTC merchant application", decision === "approve"
          ? `<p style="font-size:14px;">You can now post offers to buy and sell USDC. Open OTC in the app to post your first offer.</p><p><a href="${APP_URL}/hedge" style="color:#1f5fe0;">Open BlockFinaX</a></p>`
          : `<p style="font-size:14px;">We could not approve your application this time. Reply to this email if you would like to know more.</p>`),
      });
    });
    res.json({ merchant: m });
  }));

  app.get("/api/v2/admin/otc/orders", ...admin(async (req, res) => {
    const otc = await svc();
    const f = req.query.filter === "disputed" || req.query.filter === "all" ? req.query.filter : "active";
    res.json({ orders: await otc.adminOrders(f) });
  }));

  app.get("/api/v2/admin/otc/orders/:id", ...admin(async (req, res) => {
    const otc = await svc();
    const orderId = id(req.params.id);
    res.json({ order: await otc.adminOrder(orderId), messages: await otc.messages(null, orderId) });
  }));

  app.get("/api/v2/admin/otc/orders/:id/proof", ...admin(async (req, res) => {
    const otc = await svc();
    const p = await otc.proof(null, id(req.params.id));
    res.setHeader("Content-Type", p.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Proof-Sha256", p.sha256);
    res.send(p.bytes);
  }));

  app.post("/api/v2/admin/otc/orders/:id/messages", ...admin(async (req, res) => {
    const otc = await svc();
    await otc.postMessage(null, "blockfinax", id(req.params.id), req.body?.body, true);
    res.json({ ok: true });
  }));

  app.post("/api/v2/admin/otc/orders/:id/resolve", ...admin(async (req, res) => {
    const otc = await svc();
    const orderId = id(req.params.id);
    if (typeof req.body?.releaseToReceiver !== "boolean") throw new ApplicationError("INVALID_REQUEST", "Choose release or refund");
    const out = await otc.resolve(orderId, req.body.releaseToReceiver, by(req), req.body?.note);
    notify(() => emailOnChange(otc, orderId, req.body.releaseToReceiver ? "resolved_released" : "resolved_refunded"));
    res.json(out);
  }));
}

/** Tell the side that needs to act next (or both, when it ends). Best effort. */
async function emailOnChange(otc: OtcService, orderId: number, status: string) {
  const c = await otc.contacts(orderId);
  if (!c) return;
  const { sendEmail, shell, escapeHtml, APP_URL } = await import("../email");
  const o = c.order;
  const what = `${escapeHtml(String(Number(o.amount)))} USDC for ${escapeHtml(o.currency)} (order ${o.id})`;
  // The person who must release the USDC is the merchant on a sell offer, the user on a buy offer.
  const releaser = o.side === "sell" ? c.merchantEmail : c.takerEmail;
  const payer = o.side === "sell" ? c.takerEmail : c.merchantEmail;
  const link = `<p><a href="${APP_URL}/hedge" style="color:#1f5fe0;">Open the order</a></p>`;
  const send = (to: string | null, subject: string, text: string) => (to ? sendEmail({ to, subject, html: shell(subject, `<p style="font-size:14px;">${text}</p>${link}`) }) : Promise.resolve());
  if (status === "open") {
    await send(c.merchantEmail, "New OTC order", `A new order was opened on your offer: ${what}. ${o.side === "sell" ? "Wait for the buyer to pay and mark it paid." : "Pay the seller the local currency, upload proof and mark it paid."}`);
  } else if (status === "paid") {
    await send(releaser, "An OTC order is marked paid", `The other side says they have paid for ${what}. Check your bank or mobile money account. Release the USDC only once the money has arrived. Never rely on a screenshot alone.`);
  } else if (status === "released" || status === "resolved_released") {
    await send(payer, "Your OTC order is complete", `The USDC for ${what} has been released.`);
  } else if (status === "disputed") {
    await send(releaser, "An OTC order is in dispute", `A dispute was opened on ${what}. BlockFinaX will review the evidence and messages.`);
    await send(payer, "An OTC order is in dispute", `A dispute was opened on ${what}. BlockFinaX will review the evidence and messages.`);
  } else if (status === "resolved_refunded") {
    await send(releaser, "BlockFinaX ruled on your OTC dispute", `The USDC for ${what} was returned.`);
    await send(payer, "BlockFinaX ruled on your OTC dispute", `The USDC for ${what} was returned to the other side.`);
  }
}
