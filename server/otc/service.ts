/**
 * OTC trading: approved merchants post offers to sell or buy USDC for local currency, and
 * BlockFinaX users take them. The USDC side is held by the OTC escrow on Stellar.
 *
 *   Merchant sells USDC   merchant locks USDC in the offer -> user opens an order (reserves
 *                         part of it) -> user pays the merchant by bank or mobile money and
 *                         uploads proof -> marks paid -> merchant checks their account and
 *                         releases -> the user receives the USDC.
 *   Merchant buys USDC    user opens an order, locking their own USDC, and gives the account
 *                         to be paid into -> merchant pays and uploads proof -> marks paid ->
 *                         user checks their account and releases -> the merchant receives it.
 *
 * Request a quote          when no offer suits, a user posts what they want (buy or sell, currency,
 *                         amount, bank or mobile money). Approved merchants answer with a price,
 *                         each as an escrow offer reserved for that user alone; the user accepts
 *                         one by opening an order on it, and the trade runs as above.
 *
 * Payment methods are structured (bank: bank, account number, name; mobile money: provider,
 * number, name). Each order records the one the local currency goes to.
 *
 * The chain is the source of truth for offers and orders; these tables copy them for fast
 * lists, and hold what the chain does not: merchant profiles and payment details, payment
 * proofs, messages between the two sides, and dispute notes. Proofs live in the database
 * (Railway's disk is replaced on every deploy). Tables are created on first use, as the
 * RFQ and connector modules do.
 */
import { createHash } from "node:crypto";
import { ApplicationError } from "@shared/domain/types";
import {
  isFinal, localAmount, MAX_PROOF_BYTES, MIN_REQUEST_USDC, OTC_CURRENCIES, parsePaymentMethod, PROOF_TYPES, REQUEST_OPEN_HOURS, roleIn, SIDE_CODE,
  toUnits, USDC_DECIMALS, type OtcCurrency, type OtcSide, type OtcStatus, type PaymentMethod,
} from "@shared/otc";
import type { ChainOffer, ChainOrder, OtcGateway } from "./chain";

type MerchantStatus = "pending" | "approved" | "declined" | "removed";

interface Db {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS otc_merchants (
    id serial PRIMARY KEY,
    wallet text NOT NULL UNIQUE,
    user_id integer NOT NULL,
    organisation_id integer,
    display_name text NOT NULL,
    about text,
    markets jsonb NOT NULL DEFAULT '[]',
    payment_details jsonb NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'pending',
    note text,
    applied_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz,
    decided_by text
  );
  CREATE TABLE IF NOT EXISTS otc_offers (
    id integer PRIMARY KEY,
    merchant_wallet text NOT NULL,
    side text NOT NULL,
    currency text NOT NULL,
    rate numeric NOT NULL,
    available numeric NOT NULL,
    min_order numeric NOT NULL,
    max_order numeric NOT NULL,
    active boolean NOT NULL,
    taker text,
    synced_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE otc_offers ADD COLUMN IF NOT EXISTS taker text;
  CREATE INDEX IF NOT EXISTS otc_offers_market_idx ON otc_offers (currency, side, active);
  CREATE TABLE IF NOT EXISTS otc_orders (
    id integer PRIMARY KEY,
    offer_id integer NOT NULL,
    merchant_wallet text NOT NULL,
    taker_wallet text NOT NULL,
    taker_user_id integer,
    side text NOT NULL,
    currency text NOT NULL,
    rate numeric NOT NULL,
    amount numeric NOT NULL,
    fee_bps integer NOT NULL,
    usdc_from text NOT NULL,
    usdc_to text NOT NULL,
    status text NOT NULL,
    opened_at timestamptz NOT NULL,
    pay_by timestamptz NOT NULL,
    paid_at timestamptz,
    proof_hash text,
    payee_details text,
    synced_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS otc_orders_taker_idx ON otc_orders (taker_wallet);
  CREATE INDEX IF NOT EXISTS otc_orders_merchant_idx ON otc_orders (merchant_wallet);
  CREATE TABLE IF NOT EXISTS otc_order_intents (
    id serial PRIMARY KEY,
    user_id integer NOT NULL,
    wallet text NOT NULL,
    offer_id integer NOT NULL,
    amount numeric NOT NULL,
    payee_details text,
    used boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS otc_proofs (
    order_id integer PRIMARY KEY,
    mime text NOT NULL,
    bytes bytea NOT NULL,
    sha256 text NOT NULL,
    uploaded_by integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS otc_messages (
    id serial PRIMARY KEY,
    order_id integer NOT NULL,
    author text NOT NULL,
    user_id integer,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS otc_messages_order_idx ON otc_messages (order_id);
  CREATE TABLE IF NOT EXISTS otc_disputes (
    order_id integer PRIMARY KEY,
    opened_by text NOT NULL,
    reason text NOT NULL,
    outcome text,
    note text,
    decided_by text,
    decided_at timestamptz,
    tx_hash text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS otc_requests (
    id serial PRIMARY KEY,
    user_id integer NOT NULL,
    wallet text NOT NULL,
    organisation_id integer,
    side text NOT NULL,
    currency text NOT NULL,
    amount numeric NOT NULL,
    method_type text NOT NULL,
    payee jsonb,
    note text,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX IF NOT EXISTS otc_requests_open_idx ON otc_requests (status, currency);
  CREATE TABLE IF NOT EXISTS otc_quotes (
    id serial PRIMARY KEY,
    request_id integer NOT NULL,
    merchant_wallet text NOT NULL,
    rate numeric NOT NULL,
    offer_id integer,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS otc_quotes_request_idx ON otc_quotes (request_id);
`;

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const positive = (v: unknown, what: string) => {
  const s = String(v ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0) throw new ApplicationError("INVALID_REQUEST", `Enter ${what} as a positive number`);
  return s;
};
const isCurrency = (c: unknown): c is OtcCurrency => OTC_CURRENCIES.includes(c as OtcCurrency);

interface OrderView {
  id: number;
  offerId: number;
  side: OtcSide;
  currency: string;
  rate: string;
  amount: string;
  localAmount: string;
  feeBps: number;
  status: OtcStatus;
  openedAt: string;
  payBy: string;
  paidAt: string | null;
  merchant: { wallet: string; name: string };
  usdcFrom: string;
  usdcTo: string;
  /** Where the local currency goes: the merchant's account (merchant sells) or the user's (merchant buys). */
  payTo: PaymentMethod | null;
  hasProof: boolean;
  dispute: { reason: string; openedBy: string; outcome: string | null; note: string | null } | null;
  me?: { releases: boolean; pays: boolean; isMerchant: boolean };
}

export class OtcService {
  private ready: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    readonly gateway: OtcGateway,
    /** USDC a wallet holds, as a decimal string. */
    private readonly balanceOf: (wallet: string) => Promise<string>,
  ) {}

  private async q(sql: string, params: unknown[] = []) {
    this.ready ??= this.db.query(SCHEMA).then(() => undefined);
    await this.ready;
    return this.db.query(sql, params);
  }

  // ── Copying the chain ─────────────────────────────────────────────────────

  private async saveOffer(o: ChainOffer) {
    await this.q(
      `INSERT INTO otc_offers (id, merchant_wallet, side, currency, rate, available, min_order, max_order, active, taker, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (id) DO UPDATE SET rate = $5, available = $6, min_order = $7, max_order = $8, active = $9, taker = $10, synced_at = now()`,
      [o.id, o.merchant, o.side, o.currency, o.rate, o.available, o.minOrder, o.maxOrder, o.active, o.taker],
    );
  }

  private async saveOrder(o: ChainOrder) {
    await this.q(
      `INSERT INTO otc_orders (id, offer_id, merchant_wallet, taker_wallet, side, currency, rate, amount, fee_bps, usdc_from, usdc_to, status, opened_at, pay_by, paid_at, proof_hash, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
       ON CONFLICT (id) DO UPDATE SET status = $12, paid_at = $15, proof_hash = $16, synced_at = now()`,
      [o.id, o.offerId, o.merchant, o.taker, o.side, o.currency, o.rate, o.amount, o.feeBps, o.usdcFrom, o.usdcTo, o.status, o.openedAt, o.payBy, o.paidAt, o.proofHash || null],
    );
    // An order a user just opened: attach who they are and the account they want paid into.
    const { rows: [intent] } = await this.q(
      `SELECT * FROM otc_order_intents WHERE wallet = $1 AND offer_id = $2 AND amount = $3 AND NOT used ORDER BY id DESC LIMIT 1`,
      [o.taker, o.offerId, o.amount],
    );
    if (intent) {
      await this.q(`UPDATE otc_order_intents SET used = true WHERE id = $1`, [intent.id]);
      await this.q(`UPDATE otc_orders SET taker_user_id = $2, payee_details = COALESCE(payee_details, $3) WHERE id = $1`, [o.id, intent.user_id, intent.payee_details]);
    }
    if (!isFinal(o.status) || o.status === "released") await this.acceptQuoteFor(o);
  }

  /** Pick up offers and orders created since the last look (up to 25 of each per call). */
  async syncNew() {
    for (const [table, read, save] of [
      ["otc_offers", (id: number) => this.gateway.getOffer(id), (x: any) => this.saveOffer(x)],
      ["otc_orders", (id: number) => this.gateway.getOrder(id), (x: any) => this.saveOrder(x)],
    ] as const) {
      const { rows: [{ max }] } = await this.q(`SELECT COALESCE(MAX(id), 0) AS max FROM ${table}`);
      for (let id = Number(max) + 1, n = 0; n < 25; id++, n++) {
        const found = await read(id);
        if (!found) break;
        await save(found as any);
      }
    }
  }

  async refreshOffer(id: number) {
    const o = await this.gateway.getOffer(id);
    if (o) await this.saveOffer(o);
    return o;
  }

  async refreshOrder(id: number) {
    const o = await this.gateway.getOrder(id);
    if (o) await this.saveOrder(o);
    return o;
  }

  /** After a user's transaction lands: new records, plus the ones it touched. */
  async afterTransaction(touched: { offerId?: number; orderId?: number }) {
    await this.syncNew();
    if (touched.offerId) await this.refreshOffer(touched.offerId);
    if (touched.orderId) {
      const o = await this.refreshOrder(touched.orderId);
      if (o) await this.refreshOffer(o.offerId);
    }
  }

  // ── Merchants ─────────────────────────────────────────────────────────────

  /** The merchant profile of an account: a personal wallet or a business account. */
  async merchant(wallet: string) {
    const m = await this.merchantByWallet(wallet);
    return m ? merchantView(m) : null;
  }

  private async merchantByWallet(wallet: string) {
    const { rows: [m] } = await this.q(`SELECT * FROM otc_merchants WHERE wallet = $1`, [wallet]);
    return m ?? null;
  }

  /** Apply for `wallet` to trade as a merchant. `organisationId` when it is a business account. */
  async apply(userId: number, wallet: string, organisationId: number | null, input: { displayName?: unknown; about?: unknown; markets?: unknown; paymentDetails?: unknown }) {
    const displayName = clean(input.displayName, 60);
    if (displayName.length < 2) throw new ApplicationError("INVALID_REQUEST", "Enter the name buyers and sellers will see");
    const markets = Array.isArray(input.markets) ? input.markets.filter(isCurrency) : [];
    if (!markets.length) throw new ApplicationError("INVALID_REQUEST", "Choose at least one currency you trade");
    const details = paymentDetails(input.paymentDetails, markets);
    const existing = await this.merchant(wallet);
    if (existing && existing.status !== "declined") throw new ApplicationError("INVALID_REQUEST", "This account has already applied");
    await this.q(
      `INSERT INTO otc_merchants (wallet, user_id, organisation_id, display_name, about, markets, payment_details, status, applied_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending', now())
       ON CONFLICT (wallet) DO UPDATE SET user_id = $2, organisation_id = $3, display_name = $4, about = $5, markets = $6, payment_details = $7, status = 'pending', applied_at = now(), decided_at = NULL, note = NULL`,
      [wallet, userId, organisationId, displayName, clean(input.about, 500) || null, JSON.stringify(markets), JSON.stringify(details)],
    );
    return this.merchant(wallet);
  }

  async updateDetails(wallet: string, input: { displayName?: unknown; markets?: unknown; paymentDetails?: unknown }) {
    const m = await this.merchant(wallet);
    if (!m) throw new ApplicationError("INVALID_REQUEST", "Apply to become a merchant first");
    const markets = Array.isArray(input.markets) ? input.markets.filter(isCurrency) : m.markets;
    const displayName = clean(input.displayName, 60) || m.displayName;
    await this.q(`UPDATE otc_merchants SET display_name = $2, markets = $3, payment_details = $4 WHERE wallet = $1`, [
      wallet, displayName, JSON.stringify(markets), JSON.stringify(paymentDetails(input.paymentDetails ?? m.paymentDetails, markets)),
    ]);
    return this.merchant(wallet);
  }

  private async requireMerchant(wallet: string) {
    const m = await this.merchant(wallet);
    if (m?.status !== "approved") throw new ApplicationError("UNAUTHORIZED", "Only approved merchants can do this");
    return m;
  }

  // ── Offers ────────────────────────────────────────────────────────────────

  /**
   * Live offers for a currency. `side` is the user's view: "buy" lists merchants selling USDC
   * (cheapest first), "sell" lists merchants buying USDC (best price first).
   */
  async market(currency: string, userSide: "buy" | "sell") {
    if (!isCurrency(currency)) throw new ApplicationError("INVALID_REQUEST", "Choose a currency");
    const merchantSide: OtcSide = userSide === "buy" ? "sell" : "buy";
    const { rows } = await this.q(
      `SELECT o.*, m.display_name, m.payment_details FROM otc_offers o JOIN otc_merchants m ON m.wallet = o.merchant_wallet
        WHERE o.currency = $1 AND o.side = $2 AND o.active AND o.taker IS NULL AND o.available >= o.min_order AND m.status = 'approved'
        ORDER BY o.rate ${merchantSide === "sell" ? "ASC" : "DESC"}, o.available DESC LIMIT 100`,
      [currency, merchantSide],
    );
    const stats = await this.completedCounts(rows.map((r: any) => r.merchant_wallet));
    return rows.map((r: any) => ({
      ...offerView(r), merchantName: r.display_name, completedTrades: stats.get(r.merchant_wallet) ?? 0,
      // How buyers can pay this merchant: the kinds of method, never the account numbers before an order.
      methods: merchantSide === "sell" ? methodsOf(r.payment_details, currency).map((m) => m.type === "bank" ? "Bank transfer" : m.provider) : [],
    }));
  }

  private async completedCounts(wallets: string[]) {
    if (!wallets.length) return new Map<string, number>();
    const { rows } = await this.q(
      `SELECT merchant_wallet, COUNT(*)::int AS n FROM otc_orders WHERE merchant_wallet = ANY($1) AND status IN ('released','resolved_released') GROUP BY merchant_wallet`,
      [wallets],
    );
    return new Map<string, number>(rows.map((r: any) => [r.merchant_wallet, r.n]));
  }

  async myOffers(wallet: string) {
    const { rows } = await this.q(`SELECT * FROM otc_offers WHERE merchant_wallet = $1 ORDER BY active DESC, id DESC LIMIT 100`, [wallet]);
    return rows.map(offerView);
  }

  async prepareCreateOffer(wallet: string, input: { side?: unknown; currency?: unknown; rate?: unknown; amount?: unknown; minOrder?: unknown; maxOrder?: unknown }) {
    const m = await this.requireMerchant(wallet);
    if (input.side !== "sell" && input.side !== "buy") throw new ApplicationError("INVALID_REQUEST", "Choose whether you are selling or buying USDC");
    if (!isCurrency(input.currency)) throw new ApplicationError("INVALID_REQUEST", "Choose a currency");
    if (!m.markets.includes(input.currency)) throw new ApplicationError("INVALID_REQUEST", "Add this currency to your merchant profile first");
    if (input.side === "sell" && !methodsOf(m.paymentDetails, input.currency).length) {
      throw new ApplicationError("INVALID_REQUEST", `Add a ${input.currency} bank or mobile money account for buyers to pay into first`);
    }
    const rate = positive(input.rate, "your rate");
    const amount = positive(input.amount, "the amount");
    const minOrder = positive(input.minOrder, "the smallest order");
    const maxOrder = positive(input.maxOrder, "the largest order");
    if (Number(minOrder) < 1) throw new ApplicationError("INVALID_REQUEST", "The smallest order is at least 1 USDC");
    if (Number(maxOrder) < Number(minOrder)) throw new ApplicationError("INVALID_REQUEST", "The largest order must be at least the smallest");
    if (Number(amount) < Number(minOrder)) throw new ApplicationError("INVALID_REQUEST", "The amount must be at least the smallest order");
    if (input.side === "sell") await this.requireBalance(wallet, amount);
    return this.gateway.prepare(input.side === "sell" ? "Lock USDC in your offer" : "Post your offer", "create_offer", {
      merchant: wallet, side: SIDE_CODE[input.side], currency: input.currency, rate: toUnits(rate, 6),
      amount: toUnits(amount, USDC_DECIMALS), min_order: toUnits(minOrder, USDC_DECIMALS), max_order: toUnits(maxOrder, USDC_DECIMALS), taker: undefined,
    });
  }

  private async ownOffer(wallet: string, offerId: number) {
    const o = await this.refreshOffer(offerId);
    if (!o) throw new ApplicationError("INVALID_REQUEST", "Offer not found");
    if (o.merchant !== wallet) throw new ApplicationError("UNAUTHORIZED", "This is not your offer");
    return o;
  }

  async prepareOfferChange(wallet: string, offerId: number, change: { kind?: unknown; rate?: unknown; minOrder?: unknown; maxOrder?: unknown; amount?: unknown }) {
    const o = await this.ownOffer(wallet, offerId);
    const id = BigInt(offerId);
    switch (change.kind) {
      case "update": {
        const rate = positive(change.rate ?? o.rate, "your rate");
        const minOrder = positive(change.minOrder ?? o.minOrder, "the smallest order");
        const maxOrder = positive(change.maxOrder ?? o.maxOrder, "the largest order");
        if (Number(maxOrder) < Number(minOrder) || Number(minOrder) < 1) throw new ApplicationError("INVALID_REQUEST", "Check the order limits");
        return this.gateway.prepare("Update your offer", "update_offer", {
          offer_id: id, rate: toUnits(rate, 6), min_order: toUnits(minOrder, USDC_DECIMALS), max_order: toUnits(maxOrder, USDC_DECIMALS),
        });
      }
      case "top_up": {
        const amount = positive(change.amount, "the amount");
        if (o.side === "sell") await this.requireBalance(wallet, amount);
        return this.gateway.prepare(o.side === "sell" ? "Add USDC to your offer" : "Raise your offer", "top_up_offer", { offer_id: id, amount: toUnits(amount, USDC_DECIMALS) });
      }
      case "withdraw": {
        const amount = positive(change.amount, "the amount");
        if (Number(amount) > Number(o.available)) throw new ApplicationError("INVALID_REQUEST", `Only ${o.available} USDC is free to take out`);
        return this.gateway.prepare(o.side === "sell" ? "Take USDC out of your offer" : "Lower your offer", "withdraw_from_offer", { offer_id: id, amount: toUnits(amount, USDC_DECIMALS) });
      }
      case "close":
        return this.gateway.prepare("Close your offer", "close_offer", { offer_id: id });
      default:
        throw new ApplicationError("INVALID_REQUEST", "Unknown change");
    }
  }

  private async requireBalance(wallet: string, amount: string) {
    const have = await this.balanceOf(wallet);
    if (toUnits(have, USDC_DECIMALS) < toUnits(amount, USDC_DECIMALS)) {
      throw new ApplicationError("INSUFFICIENT_LIQUIDITY", `You need ${amount} USDC for this and have ${have}`);
    }
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  /** `mayLockUsdc` is false for a business account's operators: they can buy USDC, not sell it. */
  /**
   * Open an order. Buying USDC: `methodIndex` picks which of the merchant's accounts the user
   * will pay into. Selling USDC: `payee` is the user's own bank or mobile money account.
   */
  async prepareOpenOrder(userId: number, wallet: string, input: { offerId?: unknown; amount?: unknown; payee?: unknown; methodIndex?: unknown }, mayLockUsdc = true) {
    const offerId = Number(input.offerId);
    const o = Number.isInteger(offerId) ? await this.refreshOffer(offerId) : null;
    if (!o || !o.active) throw new ApplicationError("INVALID_REQUEST", "This offer is no longer available");
    if (o.taker && o.taker !== wallet) throw new ApplicationError("UNAUTHORIZED", "This quote was made for someone else");
    if (o.merchant === wallet) throw new ApplicationError("INVALID_REQUEST", "You cannot trade with your own offer");
    const m = await this.merchantByWallet(o.merchant);
    if (m?.status !== "approved") throw new ApplicationError("INVALID_REQUEST", "This offer is no longer available");
    const amount = positive(input.amount, "the amount");
    if (Number(amount) < Number(o.minOrder) || Number(amount) > Number(o.maxOrder)) {
      throw new ApplicationError("INVALID_REQUEST", `Orders on this offer are ${o.minOrder} to ${o.maxOrder} USDC`);
    }
    if (Number(amount) > Number(o.available)) throw new ApplicationError("INVALID_REQUEST", `Only ${o.available} USDC is left on this offer`);
    let payTo: PaymentMethod;
    if (o.side === "buy" && !mayLockUsdc) throw new ApplicationError("UNAUTHORIZED", "Operators can buy USDC. Ask an admin to sell the business's USDC.");
    if (o.side === "buy") {
      payTo = method(input.payee);
      await this.requireBalance(wallet, amount);
    } else {
      const methods = methodsOf(m.payment_details, o.currency);
      const i = Number(input.methodIndex ?? 0);
      if (!methods.length) throw new ApplicationError("INVALID_REQUEST", "This merchant has no account to pay into yet");
      if (!Number.isInteger(i) || !methods[i]) throw new ApplicationError("INVALID_REQUEST", "Choose how you will pay");
      payTo = methods[i];
    }
    await this.q(`INSERT INTO otc_order_intents (user_id, wallet, offer_id, amount, payee_details) VALUES ($1,$2,$3,$4,$5)`, [userId, wallet, o.id, amount, JSON.stringify(payTo)]);
    return this.gateway.prepare(o.side === "sell" ? "Reserve the USDC" : "Lock your USDC in escrow", "open_order", {
      taker: wallet, offer_id: BigInt(o.id), amount: toUnits(amount, USDC_DECIMALS),
    });
  }

  /** Orders the wallet is in, as the user or as the merchant, newest first. */
  async myOrders(wallet: string) {
    const { rows } = await this.q(
      `SELECT * FROM otc_orders WHERE taker_wallet = $1 OR merchant_wallet = $1 ORDER BY id DESC LIMIT 100`,
      [wallet],
    );
    // Orders still moving are read again from the chain, so lapsed and released ones are current.
    await Promise.all(rows.filter((r: any) => !isFinal(r.status)).slice(0, 10).map((r: any) => this.refreshOrder(r.id).catch(() => null)));
    const fresh = rows.length ? (await this.q(`SELECT * FROM otc_orders WHERE id = ANY($1) ORDER BY id DESC`, [rows.map((r: any) => r.id)])).rows : [];
    return Promise.all(fresh.map((r: any) => this.orderView(r, wallet)));
  }

  private async partyOrder(wallet: string | null, orderId: number) {
    const o = await this.refreshOrder(orderId);
    if (!o) throw new ApplicationError("INVALID_REQUEST", "Order not found");
    if (wallet !== null && o.taker !== wallet && o.merchant !== wallet) throw new ApplicationError("UNAUTHORIZED", "This order is between other people");
    const { rows: [row] } = await this.q(`SELECT * FROM otc_orders WHERE id = $1`, [orderId]);
    return { chain: o, row };
  }

  async order(wallet: string, orderId: number) {
    const { row } = await this.partyOrder(wallet, orderId);
    return this.orderView(row, wallet);
  }

  private async orderView(r: any, wallet?: string): Promise<OrderView> {
    const m = await this.merchantByWallet(r.merchant_wallet);
    const { rows: [proof] } = await this.q(`SELECT sha256 FROM otc_proofs WHERE order_id = $1`, [r.id]);
    const { rows: [d] } = await this.q(`SELECT * FROM otc_disputes WHERE order_id = $1`, [r.id]);
    let payTo: PaymentMethod | null = null;
    try { payTo = r.payee_details ? JSON.parse(r.payee_details) : null; } catch { payTo = null; }
    const view: OrderView = {
      id: r.id, offerId: r.offer_id, side: r.side, currency: r.currency, rate: String(r.rate), amount: String(r.amount),
      localAmount: localAmount(String(r.amount), String(r.rate)), feeBps: r.fee_bps, status: r.status,
      openedAt: new Date(r.opened_at).toISOString(), payBy: new Date(r.pay_by).toISOString(), paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
      merchant: { wallet: r.merchant_wallet, name: m?.display_name ?? "Merchant" }, usdcFrom: r.usdc_from, usdcTo: r.usdc_to,
      payTo, hasProof: Boolean(proof),
      dispute: d ? { reason: d.reason, openedBy: d.opened_by, outcome: d.outcome, note: d.note } : null,
    };
    if (wallet) view.me = { ...roleIn({ usdcFrom: r.usdc_from, usdcTo: r.usdc_to }, wallet), isMerchant: r.merchant_wallet === wallet };
    return view;
  }

  /** The payer uploads proof of the local-currency payment before marking the order paid. */
  async uploadProof(userId: number, wallet: string, orderId: number, file: { type?: unknown; data?: unknown }) {
    const { chain } = await this.partyOrder(wallet, orderId);
    if (chain.usdcTo !== wallet) throw new ApplicationError("UNAUTHORIZED", "Only the person paying uploads the proof");
    if (chain.status !== "open") throw new ApplicationError("INVALID_REQUEST", "This order is already marked paid");
    const type = String(file.type ?? "");
    if (!PROOF_TYPES.includes(type)) throw new ApplicationError("INVALID_REQUEST", "Upload a photo, screenshot or PDF of the payment");
    const bytes = Buffer.from(String(file.data ?? ""), "base64");
    if (!bytes.length || bytes.length > MAX_PROOF_BYTES) throw new ApplicationError("INVALID_REQUEST", "The file must be under 5 MB");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await this.q(
      `INSERT INTO otc_proofs (order_id, mime, bytes, sha256, uploaded_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (order_id) DO UPDATE SET mime = $2, bytes = $3, sha256 = $4, uploaded_by = $5, created_at = now()`,
      [orderId, type, bytes, sha256, userId],
    );
    return { sha256 };
  }

  /** The proof file, for the two parties and BlockFinaX (wallet null). */
  async proof(wallet: string | null, orderId: number) {
    await this.partyOrder(wallet, orderId);
    const { rows: [p] } = await this.q(`SELECT mime, bytes, sha256 FROM otc_proofs WHERE order_id = $1`, [orderId]);
    if (!p) throw new ApplicationError("INVALID_REQUEST", "No proof uploaded yet");
    return { mime: p.mime as string, bytes: p.bytes as Buffer, sha256: p.sha256 as string };
  }

  async prepareMarkPaid(wallet: string, orderId: number) {
    const { chain } = await this.partyOrder(wallet, orderId);
    if (chain.usdcTo !== wallet) throw new ApplicationError("UNAUTHORIZED", "Only the person paying marks the order paid");
    if (chain.status !== "open") throw new ApplicationError("INVALID_REQUEST", "This order is not waiting for payment");
    if (chain.payBy.getTime() < Date.now()) throw new ApplicationError("INVALID_REQUEST", "The time to pay has run out");
    const { rows: [p] } = await this.q(`SELECT sha256 FROM otc_proofs WHERE order_id = $1`, [orderId]);
    if (!p) throw new ApplicationError("INVALID_REQUEST", "Upload proof of your payment first");
    return this.gateway.prepare("Mark as paid", "mark_paid", { order_id: BigInt(orderId), proof_hash: Buffer.from(p.sha256, "hex") });
  }

  async prepareRelease(wallet: string, orderId: number) {
    const { chain } = await this.partyOrder(wallet, orderId);
    if (chain.usdcFrom !== wallet) throw new ApplicationError("UNAUTHORIZED", "Only the person holding the USDC in escrow can release it");
    if (!["open", "paid", "disputed"].includes(chain.status)) throw new ApplicationError("INVALID_REQUEST", "This order is finished");
    return this.gateway.prepare("Release the USDC", "release", { order_id: BigInt(orderId) });
  }

  async prepareCancel(wallet: string, orderId: number) {
    const { chain } = await this.partyOrder(wallet, orderId);
    const payer = chain.usdcTo === wallet;
    const lapsed = chain.status === "open" && chain.payBy.getTime() < Date.now();
    if (!((payer && (chain.status === "open" || chain.status === "paid")) || lapsed)) {
      throw new ApplicationError("INVALID_REQUEST", chain.status === "open"
        ? "The other side still has time to pay. You can cancel once the time runs out."
        : "This order can no longer be cancelled");
    }
    return this.gateway.prepare("Cancel the order", "cancel", { caller: wallet, order_id: BigInt(orderId) });
  }

  async prepareDispute(wallet: string, orderId: number, reason: unknown) {
    const { chain } = await this.partyOrder(wallet, orderId);
    if (chain.status !== "paid") throw new ApplicationError("INVALID_REQUEST", "You can open a dispute once the order is marked paid");
    const why = clean(reason, 1000);
    if (why.length < 10) throw new ApplicationError("INVALID_REQUEST", "Tell us what went wrong, in a sentence or two");
    await this.q(
      `INSERT INTO otc_disputes (order_id, opened_by, reason) VALUES ($1,$2,$3)
       ON CONFLICT (order_id) DO UPDATE SET opened_by = $2, reason = $3 WHERE otc_disputes.outcome IS NULL`,
      [orderId, wallet, why],
    );
    return this.gateway.prepare("Open a dispute", "dispute", { caller: wallet, order_id: BigInt(orderId) });
  }

  // ── Requests for a quote ──────────────────────────────────────────────────

  private async expireRequests() {
    await this.q(`UPDATE otc_requests SET status = 'expired' WHERE status = 'open' AND expires_at < now()`);
  }

  /**
   * A user asks merchants for a price. `side` is the user's view: buy or sell USDC.
   * Selling needs the user's own account to be paid into, and the USDC in their wallet.
   */
  async createRequest(userId: number, wallet: string, organisationId: number | null, input: { side?: unknown; currency?: unknown; amount?: unknown; methodType?: unknown; payee?: unknown; note?: unknown }, maySell = true) {
    if (input.side !== "buy" && input.side !== "sell") throw new ApplicationError("INVALID_REQUEST", "Choose buy or sell");
    if (input.side === "sell" && !maySell) throw new ApplicationError("UNAUTHORIZED", "Only an admin can sell the business's USDC");
    if (!isCurrency(input.currency)) throw new ApplicationError("INVALID_REQUEST", "Choose a currency");
    const amount = positive(input.amount, "the amount");
    if (Number(amount) < MIN_REQUEST_USDC) throw new ApplicationError("INVALID_REQUEST", `Requests start at ${MIN_REQUEST_USDC} USDC`);
    const methodType = input.methodType === "bank" || input.methodType === "momo" ? input.methodType : "any";
    let payee: PaymentMethod | null = null;
    if (input.side === "sell") {
      payee = method(input.payee);
      await this.requireBalance(wallet, amount);
    }
    const { rows: [open] } = await this.q(`SELECT COUNT(*)::int AS n FROM otc_requests WHERE wallet = $1 AND status = 'open' AND expires_at > now()`, [wallet]);
    if (open.n >= 5) throw new ApplicationError("INVALID_REQUEST", "You have 5 open requests. Cancel one or wait for quotes first.");
    const { rows: [r] } = await this.q(
      `INSERT INTO otc_requests (user_id, wallet, organisation_id, side, currency, amount, method_type, payee, note, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + interval '${REQUEST_OPEN_HOURS} hours') RETURNING id`,
      [userId, wallet, organisationId, input.side, input.currency, amount, methodType, payee ? JSON.stringify(payee) : null, clean(input.note, 300) || null],
    );
    return { id: r.id as number };
  }

  /** The account's requests, newest first, each with its live quotes (best price first). */
  async myRequests(wallet: string) {
    await this.expireRequests();
    const { rows } = await this.q(`SELECT * FROM otc_requests WHERE wallet = $1 ORDER BY id DESC LIMIT 30`, [wallet]);
    if (!rows.length) return [];
    const { rows: quotes } = await this.q(
      `SELECT q.*, m.display_name, m.payment_details, o.active AS offer_active, o.available
         FROM otc_quotes q JOIN otc_merchants m ON m.wallet = q.merchant_wallet LEFT JOIN otc_offers o ON o.id = q.offer_id
        WHERE q.request_id = ANY($1) AND q.status IN ('live','accepted')`,
      [rows.map((r: any) => r.id)],
    );
    return rows.map((r: any) => {
      const mine = quotes.filter((q: any) => q.request_id === r.id && (q.status === "accepted" || q.offer_active))
        .sort((a: any, b: any) => (r.side === "buy" ? Number(a.rate) - Number(b.rate) : Number(b.rate) - Number(a.rate)));
      return {
        ...requestView(r),
        quotes: mine.map((q: any) => ({
          id: q.id, offerId: q.offer_id, merchantName: q.display_name, rate: String(q.rate), status: q.status,
          localAmount: localAmount(String(r.amount), String(q.rate)),
          methods: r.side === "buy" ? methodsOf(q.payment_details, r.currency).map((m) => m.type === "bank" ? "Bank transfer" : m.provider) : [],
        })),
      };
    });
  }

  async cancelRequest(wallet: string, id: number) {
    await this.q(`UPDATE otc_requests SET status = 'cancelled' WHERE id = $1 AND wallet = $2 AND status = 'open'`, [id, wallet]);
  }

  /** Open requests a merchant can quote: in their currencies, not their own. */
  async openRequests(merchantWallet: string) {
    const m = await this.requireMerchant(merchantWallet);
    await this.expireRequests();
    const { rows } = await this.q(
      `SELECT r.*, (SELECT row_to_json(q) FROM otc_quotes q WHERE q.request_id = r.id AND q.merchant_wallet = $1 AND q.status <> 'withdrawn' ORDER BY q.id DESC LIMIT 1) AS my_quote
         FROM otc_requests r WHERE r.status = 'open' AND r.expires_at > now() AND r.wallet <> $1 AND r.currency = ANY($2)
        ORDER BY r.id DESC LIMIT 100`,
      [merchantWallet, m.markets],
    );
    return rows.map((r: any) => ({ ...requestView(r), myQuote: r.my_quote ? { id: r.my_quote.id, rate: String(r.my_quote.rate), status: r.my_quote.status } : null }));
  }

  /**
   * A merchant answers a request with a price: an escrow offer for exactly the requested
   * amount that only the requester can take. Answering a buy request locks the USDC now.
   */
  async prepareQuote(merchantWallet: string, requestId: number, rateInput: unknown) {
    const m = await this.requireMerchant(merchantWallet);
    await this.expireRequests();
    const { rows: [r] } = await this.q(`SELECT * FROM otc_requests WHERE id = $1`, [requestId]);
    if (!r || r.status !== "open") throw new ApplicationError("INVALID_REQUEST", "This request is closed");
    if (r.wallet === merchantWallet) throw new ApplicationError("INVALID_REQUEST", "You cannot quote your own request");
    if (!m.markets.includes(r.currency)) throw new ApplicationError("INVALID_REQUEST", "Add this currency to your merchant profile first");
    const rate = positive(rateInput, "your price");
    const amount = String(r.amount);
    const merchantSells = r.side === "buy";
    if (merchantSells) {
      const methods = methodsOf(m.paymentDetails, r.currency);
      if (!methods.length) throw new ApplicationError("INVALID_REQUEST", `Add a ${r.currency} account for the buyer to pay into first`);
      if (r.method_type !== "any" && !methods.some((x) => x.type === r.method_type)) {
        throw new ApplicationError("INVALID_REQUEST", `They asked to pay by ${r.method_type === "bank" ? "bank transfer" : "mobile money"}. Add one to your ${r.currency} accounts first.`);
      }
      await this.requireBalance(merchantWallet, amount);
    }
    const { rows: [q] } = await this.q(`INSERT INTO otc_quotes (request_id, merchant_wallet, rate) VALUES ($1,$2,$3) RETURNING id`, [requestId, merchantWallet, rate]);
    const units = toUnits(amount, USDC_DECIMALS);
    const transactions = await this.gateway.prepare(merchantSells ? "Lock the USDC for this quote" : "Send your quote", "create_offer", {
      merchant: merchantWallet, side: SIDE_CODE[merchantSells ? "sell" : "buy"], currency: r.currency, rate: toUnits(rate, 6),
      amount: units, min_order: units, max_order: units, taker: r.wallet,
    });
    return { quoteId: q.id as number, transactions };
  }

  /** After the merchant's quote lands: link it to its escrow offer and tell the requester. */
  async linkQuote(merchantWallet: string, quoteId: number) {
    await this.syncNew();
    const { rows: [q] } = await this.q(`SELECT q.*, r.wallet AS requester, r.amount FROM otc_quotes q JOIN otc_requests r ON r.id = q.request_id WHERE q.id = $1 AND q.merchant_wallet = $2`, [quoteId, merchantWallet]);
    if (!q) throw new ApplicationError("INVALID_REQUEST", "Quote not found");
    if (q.offer_id) return { linked: true, requestId: q.request_id as number };
    const { rows: [o] } = await this.q(
      `SELECT o.id FROM otc_offers o WHERE o.merchant_wallet = $1 AND o.taker = $2 AND o.max_order = $3 AND o.active
          AND NOT EXISTS (SELECT 1 FROM otc_quotes x WHERE x.offer_id = o.id) ORDER BY o.id DESC LIMIT 1`,
      [merchantWallet, q.requester, q.amount],
    );
    if (!o) return { linked: false, requestId: q.request_id as number };
    await this.q(`UPDATE otc_quotes SET offer_id = $2, status = 'live' WHERE id = $1`, [quoteId, o.id]);
    return { linked: true, requestId: q.request_id as number };
  }

  /** An order opened on a quote's offer accepts that quote and closes the request. */
  private async acceptQuoteFor(order: ChainOrder) {
    const { rows: [q] } = await this.q(`SELECT * FROM otc_quotes WHERE offer_id = $1 AND status = 'live'`, [order.offerId]);
    if (!q) return;
    await this.q(`UPDATE otc_quotes SET status = 'accepted' WHERE id = $1`, [q.id]);
    await this.q(`UPDATE otc_quotes SET status = 'not_chosen' WHERE request_id = $1 AND id <> $2 AND status = 'live'`, [q.request_id, q.id]);
    await this.q(`UPDATE otc_requests SET status = 'accepted' WHERE id = $1`, [q.request_id]);
  }

  /** Who asked for a request, for notifications. */
  async requestContact(requestId: number) {
    const { rows: [r] } = await this.q(`SELECT r.*, u.email FROM otc_requests r LEFT JOIN user_accounts u ON u.id = r.user_id WHERE r.id = $1`, [requestId]);
    return r ?? null;
  }

  /** The requester's own payout account on a sell request, used when they accept a quote. */
  async requestPayee(wallet: string, offerId: number): Promise<PaymentMethod | null> {
    const { rows: [r] } = await this.q(
      `SELECT r.payee FROM otc_quotes q JOIN otc_requests r ON r.id = q.request_id WHERE q.offer_id = $1 AND r.wallet = $2`,
      [offerId, wallet],
    );
    return (r?.payee as PaymentMethod) ?? null;
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  async messages(wallet: string | null, orderId: number) {
    const { row } = await this.partyOrder(wallet, orderId);
    const { rows } = await this.q(`SELECT * FROM otc_messages WHERE order_id = $1 ORDER BY id LIMIT 500`, [orderId]);
    return rows.map((m: any) => ({
      id: m.id, body: m.body, createdAt: new Date(m.created_at).toISOString(),
      from: m.author === "blockfinax" ? "BlockFinaX" : m.author === row.merchant_wallet ? "Merchant" : "User",
      mine: wallet !== null && m.author === wallet,
    }));
  }

  async postMessage(userId: number | null, author: string, orderId: number, body: unknown, asAdmin = false) {
    await this.partyOrder(asAdmin ? null : author, orderId);
    const text = clean(body, 2000);
    if (!text) throw new ApplicationError("INVALID_REQUEST", "Write a message first");
    await this.q(`INSERT INTO otc_messages (order_id, author, user_id, body) VALUES ($1,$2,$3,$4)`, [orderId, asAdmin ? "blockfinax" : author, userId, text]);
  }

  // ── BlockFinaX (admin) ────────────────────────────────────────────────────

  async merchants(status?: string) {
    const { rows } = await this.q(
      `SELECT * FROM otc_merchants ${status ? "WHERE status = $1" : ""} ORDER BY applied_at DESC LIMIT 200`,
      status ? [status] : [],
    );
    return rows.map(merchantView);
  }

  async decideMerchant(merchantId: number, decision: "approve" | "decline" | "remove", by: string, note?: unknown) {
    const { rows: [row] } = await this.q(`SELECT * FROM otc_merchants WHERE id = $1`, [merchantId]);
    const m = row ? merchantView(row) : null;
    if (!m) throw new ApplicationError("INVALID_REQUEST", "Merchant not found");
    if (decision === "approve") {
      await this.gateway.arbiter("set_merchant", { merchant: m.wallet, approved: true });
    } else if (decision === "remove" && m.status === "approved") {
      await this.gateway.arbiter("set_merchant", { merchant: m.wallet, approved: false });
    }
    const status: MerchantStatus = decision === "approve" ? "approved" : decision === "decline" ? "declined" : "removed";
    await this.q(`UPDATE otc_merchants SET status = $2, decided_at = now(), decided_by = $3, note = $4 WHERE id = $1`, [merchantId, status, by, clean(note, 500) || null]);
    return this.merchant(m.wallet);
  }

  async adminOrders(filter: "disputed" | "active" | "all") {
    await this.syncNew();
    const where = filter === "disputed" ? `WHERE status = 'disputed'` : filter === "active" ? `WHERE status IN ('open','paid','disputed')` : "";
    const { rows } = await this.q(`SELECT * FROM otc_orders ${where} ORDER BY id DESC LIMIT 200`);
    return Promise.all(rows.map((r: any) => this.orderView(r)));
  }

  async adminOrder(orderId: number) {
    const { row } = await this.partyOrder(null, orderId);
    return this.orderView(row);
  }

  /** Rule on a disputed order: pay the receiver, or refund. The escrow allows nothing else. */
  async resolve(orderId: number, releaseToReceiver: boolean, by: string, note: unknown) {
    const { chain } = await this.partyOrder(null, orderId);
    if (chain.status !== "disputed") throw new ApplicationError("INVALID_REQUEST", "Only a disputed order can be ruled on");
    const why = clean(note, 1000);
    if (why.length < 5) throw new ApplicationError("INVALID_REQUEST", "Record why, for both sides to read");
    const hash = await this.gateway.arbiter("resolve", { order_id: BigInt(orderId), release_to_receiver: releaseToReceiver });
    await this.q(
      `INSERT INTO otc_disputes (order_id, opened_by, reason, outcome, note, decided_by, decided_at, tx_hash) VALUES ($1,'unknown','(not recorded)',$2,$3,$4, now(), $5)
       ON CONFLICT (order_id) DO UPDATE SET outcome = $2, note = $3, decided_by = $4, decided_at = now(), tx_hash = $5`,
      [orderId, releaseToReceiver ? "released" : "refunded", why, by, hash],
    );
    await this.postMessage(null, "blockfinax", orderId, `BlockFinaX ruled on this dispute: ${releaseToReceiver ? "the USDC was released to the person who paid" : "the USDC was returned"}. ${why}`, true);
    await this.refreshOrder(orderId);
    await this.refreshOffer(chain.offerId);
    return { hash };
  }

  /** Email addresses for an order's two sides, for notifications. */
  async contacts(orderId: number) {
    const { rows: [r] } = await this.q(
      `SELECT o.*, mu.user_id AS merchant_user_id FROM otc_orders o LEFT JOIN otc_merchants mu ON mu.wallet = o.merchant_wallet WHERE o.id = $1`,
      [orderId],
    );
    if (!r) return null;
    const ids = [r.merchant_user_id, r.taker_user_id].filter((x) => x != null);
    const { rows } = ids.length ? await this.q(`SELECT id, email FROM user_accounts WHERE id = ANY($1)`, [ids]) : { rows: [] };
    const email = (id: number | null) => rows.find((u: any) => u.id === id)?.email ?? null;
    return { order: r, merchantEmail: email(r.merchant_user_id), takerEmail: email(r.taker_user_id) };
  }
}

function requestView(r: any) {
  return {
    id: r.id as number, side: r.side as "buy" | "sell", currency: r.currency as string, amount: String(r.amount),
    methodType: r.method_type as "bank" | "momo" | "any", note: (r.note ?? null) as string | null, status: r.status as string,
    createdAt: new Date(r.created_at).toISOString(), expiresAt: new Date(r.expires_at).toISOString(),
  };
}

function offerView(r: any) {
  return {
    id: r.id, merchantWallet: r.merchant_wallet, side: r.side as OtcSide, currency: r.currency, rate: String(r.rate),
    available: String(r.available), minOrder: String(r.min_order), maxOrder: String(r.max_order), active: r.active, quoteFor: r.taker ?? null,
  };
}

function merchantView(m: any) {
  return {
    id: m.id as number, userId: m.user_id as number, organisationId: (m.organisation_id ?? null) as number | null, wallet: m.wallet as string, displayName: m.display_name as string, about: m.about as string | null,
    markets: (m.markets ?? []) as OtcCurrency[], paymentDetails: (m.payment_details ?? {}) as Record<string, PaymentMethod[]>,
    status: m.status as MerchantStatus, note: m.note as string | null,
    appliedAt: new Date(m.applied_at).toISOString(), decidedAt: m.decided_at ? new Date(m.decided_at).toISOString() : null,
  };
}

/** A merchant's accounts per currency, checked. Each currency may list up to 4 accounts. */
function paymentDetails(raw: unknown, markets: OtcCurrency[]): Record<string, PaymentMethod[]> {
  const out: Record<string, PaymentMethod[]> = {};
  if (raw && typeof raw === "object") {
    for (const c of markets) {
      const list = (raw as Record<string, unknown>)[c];
      if (Array.isArray(list) && list.length) out[c] = list.slice(0, 4).map(method);
    }
  }
  return out;
}

/** A merchant's accounts for one currency (older free-text entries are ignored). */
function methodsOf(details: unknown, currency: string): PaymentMethod[] {
  const list = (details as Record<string, unknown> | null)?.[currency];
  return Array.isArray(list) ? list.filter((m): m is PaymentMethod => Boolean(m && typeof m === "object" && ((m as any).type === "bank" || (m as any).type === "momo"))) : [];
}

function method(raw: unknown): PaymentMethod {
  try {
    return parsePaymentMethod(raw);
  } catch (e) {
    throw new ApplicationError("INVALID_REQUEST", (e as Error).message);
  }
}
