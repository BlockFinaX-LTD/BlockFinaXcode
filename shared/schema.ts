/**
 * Database Schema Definitions
 * 
 * Defines all database tables, types, and validation schemas
 * for the blockchain communication platform.
 */

import { pgTable, text, serial, integer, boolean, timestamp, decimal, varchar, unique, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Import profile and referral schemas
export * from "./profile-schema";
export * from "./referral-schema";
// Smart Letter of Intent — agreement drafting, signing and audit trail
export * from "./loi-schema";
// Mini-CEO agent — proposals, decisions, learned rules, runs
export * from "./agent-schema";
// AML/CFT — KYC tiers, limits, sanctions screening, compliance alerts
export * from "./compliance-schema";
export * from "./lead-schema";
export * from "./notification-schema";

// ── Auth: user accounts ───────────────────────────────────────────────────────
export const userAccounts = pgTable("user_accounts", {
  id: serial("id").primaryKey(),
  email: text("email").unique(),
  googleId: text("google_id").unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Auth: email magic links ───────────────────────────────────────────────────
export const magicLinks = pgTable("magic_links", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Auth: server sessions ─────────────────────────────────────────────────────
export const authSessions = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token").notNull().unique(),
  userId: integer("user_id").references(() => userAccounts.id),
  walletAddress: text("wallet_address"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Auth: WebAuthn / Face ID credentials ─────────────────────────────────────
export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => userAccounts.id),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").default(0),
  deviceUnlockKey: text("device_unlock_key"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Wallet management table - stores encrypted wallet data
export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  address: text("address").notNull().unique(),
  name: text("name").notNull(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  encryptedMnemonic: text("encrypted_mnemonic"),
  email: text("email"),
  userId: integer("user_id").references(() => userAccounts.id),
  pinSalt: text("pin_salt"),
  isImported: boolean("is_imported").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Blockchain network configurations
export const networks = pgTable("networks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  chainId: integer("chain_id").notNull().unique(),
  rpcUrl: text("rpc_url").notNull(),
  symbol: text("symbol").notNull(),
  blockExplorerUrl: text("block_explorer_url"),
  isTestnet: boolean("is_testnet").default(true),
  usdcContractAddress: text("usdc_contract_address"),
});


export const insertWalletSchema = createInsertSchema(wallets).omit({
  id: true,
  createdAt: true,
});

export const insertNetworkSchema = createInsertSchema(networks).omit({
  id: true,
});

export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof wallets.$inferSelect;
export type InsertNetwork = z.infer<typeof insertNetworkSchema>;
export type Network = typeof networks.$inferSelect;


export const hedgeEvents = pgTable("hedge_events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  underlying: text("underlying").notNull(), // e.g. "USD/GHS"
  strike: decimal("strike", { precision: 18, scale: 6 }).notNull(),
  premiumRate: decimal("premium_rate", { precision: 10, scale: 6 }).notNull(), // e.g. 0.025 for 2.5%
  payoutRate: decimal("payout_rate", { precision: 10, scale: 6 }).notNull(), // e.g. 0.10 for 10%
  safetyFactor: decimal("safety_factor", { precision: 5, scale: 2 }).notNull().default("0.80"),
  expiryDate: timestamp("expiry_date").notNull(),
  status: text("status").notNull().default("open"), // open, settled, expired
  settlementPrice: decimal("settlement_price", { precision: 18, scale: 6 }),
  triggered: boolean("triggered").default(false),
  settledAt: timestamp("settled_at"),
  poolOpen: boolean("pool_open").notNull().default(false),
  allowExternalLp: boolean("allow_external_lp").notNull().default(true),
  createdBy: text("created_by").notNull(),
  creatorEarnings: decimal("creator_earnings", { precision: 18, scale: 6 }).default("0"),
  createdAt: timestamp("created_at").defaultNow(),
  // Chain provenance — set when event is synced or created from a specific chain
  chainId: integer("chain_id"),         // e.g. 8453 for Base
  onChainEventId: integer("on_chain_event_id"), // the contract's event ID (uint256 counter)

  /**
   * The volatility the LP's premium implied at creation.
   *
   * premiumRate above is a price, and a price is only correct at the moment it
   * was set — a hedger arriving on day 5 of a 7-day pool is buying different
   * protection to the one bought on day 0. This is the same judgement expressed
   * as a rate of risk, which stays meaningful for the pool's whole life: quote
   * against it and the premium moves with time and spot while the LP's own view
   * of the risk stays fixed inside it.
   *
   * Recovered by inverting the pricing kernel at creation
   * (server/pricing/implied-vol.ts). Null for pools created before this existed
   * and for any pool whose premium admits no σ — those keep charging premiumRate
   * flat, which is the behaviour they already had.
   *
   * Not on-chain. The contract verifies a signed premium; it does not need to
   * know how the premium was reached, so createEvent is untouched.
   */
  impliedVol: decimal("implied_vol", { precision: 10, scale: 6 }),

  /**
   * Floor the LP may set beneath the quoted premium, as a fraction of notional.
   *
   * Re-quoting can take the price a long way down — 1.0% at seven days is
   * $36.61 per $10,000 with one day left — and an LP may reasonably decline to
   * write at any price. Null means no floor.
   */
  minPremiumRate: decimal("min_premium_rate", { precision: 10, scale: 6 }),
}, (table) => [
  uniqueIndex("hedge_events_chain_id_on_chain_event_id_idx").on(table.chainId, table.onChainEventId),
]);

export const insertHedgeEventSchema = createInsertSchema(hedgeEvents).omit({
  id: true,
  createdAt: true,
  settledAt: true,
  triggered: true,
  settlementPrice: true,
});

export type InsertHedgeEvent = z.infer<typeof insertHedgeEventSchema>;
export type HedgeEvent = typeof hedgeEvents.$inferSelect;

// P2P Hedge Positions - hedger (importer) protection positions
export const hedgePositions = pgTable("hedge_positions", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => hedgeEvents.id).notNull(),
  hedgerWallet: text("hedger_wallet").notNull(),
  notional: decimal("notional", { precision: 18, scale: 2 }).notNull(), // coverage amount in USD
  premiumPaid: decimal("premium_paid", { precision: 18, scale: 2 }).notNull(),
  maxPayout: decimal("max_payout", { precision: 18, scale: 2 }).notNull(),
  payoutAmount: decimal("payout_amount", { precision: 18, scale: 2 }),
  claimed: boolean("claimed").default(false),
  status: text("status").notNull().default("active"), // active, settled_win, settled_loss, claimed
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertHedgePositionSchema = createInsertSchema(hedgePositions).omit({
  id: true,
  createdAt: true,
  payoutAmount: true,
  claimed: true,
});

export type InsertHedgePosition = z.infer<typeof insertHedgePositionSchema>;
export type HedgePosition = typeof hedgePositions.$inferSelect;

// P2P Hedge LP Deposits - liquidity provider deposits
export const hedgeLpDeposits = pgTable("hedge_lp_deposits", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => hedgeEvents.id).notNull(),
  lpWallet: text("lp_wallet").notNull(),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  shares: decimal("shares", { precision: 18, scale: 6 }).notNull(),
  premiumsEarned: decimal("premiums_earned", { precision: 18, scale: 2 }).default("0"),
  premiumsWithdrawn: decimal("premiums_withdrawn", { precision: 18, scale: 2 }).default("0"),
  withdrawn: boolean("withdrawn").default(false),
  withdrawnAt: timestamp("withdrawn_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertHedgeLpDepositSchema = createInsertSchema(hedgeLpDeposits).omit({
  id: true,
  createdAt: true,
  premiumsEarned: true,
  premiumsWithdrawn: true,
  withdrawn: true,
  withdrawnAt: true,
});

export type InsertHedgeLpDeposit = z.infer<typeof insertHedgeLpDepositSchema>;
export type HedgeLpDeposit = typeof hedgeLpDeposits.$inferSelect;

/**
 * P2P Hedge Activity Log
 *
 * Append-only feed of every on-chain action a wallet takes against the
 * hedge Diamond — used by the in-app Activity tab + home page activity
 * snapshot. Records the tx hash so each row can deep-link to a block
 * explorer. ChainSync indexes events only; this table indexes actions.
 *
 * actionType values:
 *   "create_event"       — creator deployed a new pool
 *   "buy_protection"     — hedger bought cover
 *   "lp_deposit"         — LP funded a pool
 *   "claim_payout"       — hedger claimed a triggered position
 *   "claim_premiums"     — LP claimed earned premiums
 *   "withdraw_lp"        — LP withdrew capital
 *   "recover_expired"    — creator pulled funds from an expired empty pool
 *   "toggle_pool"        — creator toggled poolOpen/allowExternalLp
 *   "settle_event"       — admin / oracle settled
 */
export const hedgeActivity = pgTable("hedge_activity", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  chainId: integer("chain_id").notNull(),
  txHash: text("tx_hash").notNull(),
  actionType: text("action_type").notNull(),
  // Optional links — populated when applicable
  eventId: integer("event_id"),               // local hedgeEvents.id (may be null until ChainSync catches up)
  onChainEventId: integer("on_chain_event_id"), // contract's event counter — useful when local eventId not yet known
  positionId: integer("position_id"),
  depositId: integer("deposit_id"),
  // Optional context fields
  amount: decimal("amount", { precision: 18, scale: 6 }), // USD or token amount, whichever fits the action
  token: text("token"),                         // 'USDC' | 'USDT' | etc.
  metadata: text("metadata"),                   // JSON-serialized extras (premium %, strike, pair name, settings, …)
  status: text("status").notNull().default("confirmed"), // pending | confirmed | failed
  blockNumber: integer("block_number"),          // set by the historical log backfill; null for rows written live
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("hedge_activity_chain_tx_action_idx").on(table.chainId, table.txHash, table.actionType),
]);

/**
 * How far the historical log scanner has walked each chain. Without this every
 * restart would re-scan millions of blocks; with it, only new blocks are read.
 */
export const chainLogCursors = pgTable("chain_log_cursors", {
  chainId: integer("chain_id").primaryKey(),
  lastScannedBlock: integer("last_scanned_block").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ChainLogCursor = typeof chainLogCursors.$inferSelect;

export const insertHedgeActivitySchema = createInsertSchema(hedgeActivity).omit({
  id: true,
  createdAt: true,
});

export type InsertHedgeActivity = z.infer<typeof insertHedgeActivitySchema>;
export type HedgeActivity = typeof hedgeActivity.$inferSelect;

export const dailyTasks = pgTable("daily_tasks", {
  id: serial("id").primaryKey(),
  taskKey: varchar("task_key", { length: 50 }).unique().notNull(),
  title: varchar("title", { length: 100 }).notNull(),
  description: text("description").notNull(),
  points: integer("points").notNull().default(10),
  category: varchar("category", { length: 30 }).notNull(), // social, onchain, community
  icon: varchar("icon", { length: 30 }).notNull().default("star"),
  actionUrl: text("action_url"),
  actionType: varchar("action_type", { length: 20 }).notNull().default("external"), // external, internal, verify
  isDaily: boolean("is_daily").default(true),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  /**
   * How the server verifies a claim before awarding points.
   *
   *   null | 'auto'                 — trust the client (current default)
   *   'onchain:<action_type>'       — require a matching row in hedge_activity
   *                                   (e.g. 'onchain:buy_protection',
   *                                   'onchain:lp_deposit', 'onchain:create_event')
   *   'manual'                      — never auto-award; admin must approve
   *                                   (NOT used by current claim flow; reserved
   *                                   for a future admin-approval UI)
   */
  verifier: text("verifier"),
});

export const userTaskCompletions = pgTable("user_task_completions", {
  id: serial("id").primaryKey(),
  walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
  taskId: integer("task_id").references(() => dailyTasks.id).notNull(),
  completedAt: timestamp("completed_at").defaultNow().notNull(),
  pointsEarned: integer("points_earned").notNull(),
  // ── Manual-review submission (verifier='manual') ──────────────────────
  // For tasks where the user attaches evidence (e.g. a tweet URL or a
  // proof-of-action screenshot) and an admin reviews before points credit.
  //
  // review_status values:
  //   'auto'      — no review needed; points credit immediately on insert
  //   'pending'   — submitted, awaiting admin review; points NOT yet credited
  //   'approved'  — admin approved; points credited on transition
  //   'rejected'  — admin rejected; no points
  reviewStatus: text("review_status").notNull().default("auto"),
  evidenceUrl: text("evidence_url"),        // optional link the user attached (tweet, post, etc.)
  evidenceImage: text("evidence_image"),    // optional Cloudinary URL (screenshot upload)
  evidenceText: text("evidence_text"),      // optional free-form note
  reviewedBy: text("reviewed_by"),          // admin wallet who reviewed
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),        // admin's reason / note
  // ── Payout tracking ────────────────────────────────────────────────────
  // Set when an admin uses the Payouts queue to settle the points as a
  // Rift transfer. Until then the row is "unpaid" and shows up in the queue.
  paidTxHash: text("paid_tx_hash"),
  paidAmount: decimal("paid_amount", { precision: 18, scale: 6 }),
  paidToken: text("paid_token"),            // 'USDC' | 'USDT'
  paidChainId: integer("paid_chain_id"),
  paidAt: timestamp("paid_at"),
  paidBy: text("paid_by"),                  // admin wallet address
});

/**
 * Generic key/value config table — used today for `point_value_usd`
 * (how many USD a point is worth). Read by the Earn page hero (to show
 * "≈ $X.XX worth") and by the admin Payouts section (to compute payout
 * amounts in USD before triggering a Rift send).
 */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: text("updated_by"),
});

export type PlatformSetting = typeof platformSettings.$inferSelect;

export const insertDailyTaskSchema = createInsertSchema(dailyTasks).omit({
  id: true,
});

export const insertUserTaskCompletionSchema = createInsertSchema(userTaskCompletions).omit({
  id: true,
  completedAt: true,
});

export type DailyTask = typeof dailyTasks.$inferSelect;
export type InsertDailyTask = z.infer<typeof insertDailyTaskSchema>;
export type UserTaskCompletion = typeof userTaskCompletions.$inferSelect;
export type InsertUserTaskCompletion = z.infer<typeof insertUserTaskCompletionSchema>;

export const platformFees = pgTable("platform_fees", {
  id: serial("id").primaryKey(),
  txHash: text("tx_hash").notNull(),
  feeTxHash: text("fee_tx_hash"),
  fromWallet: text("from_wallet").notNull(),
  toWallet: text("to_wallet").notNull(),
  transferAmount: decimal("transfer_amount", { precision: 24, scale: 6 }).notNull(),
  feeAmount: decimal("fee_amount", { precision: 24, scale: 6 }).notNull(),
  feePercent: decimal("fee_percent", { precision: 5, scale: 2 }).notNull(),
  token: text("token").notNull().default("USDC"),
  chainId: integer("chain_id").notNull(),
  status: text("status").notNull().default("collected"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPlatformFeeSchema = createInsertSchema(platformFees).omit({
  id: true,
  createdAt: true,
});

export type PlatformFee = typeof platformFees.$inferSelect;
export type InsertPlatformFee = z.infer<typeof insertPlatformFeeSchema>;


export const rateSnapshots = pgTable("rate_snapshots", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),
  rate: decimal("rate", { precision: 30, scale: 10 }).notNull(),
  assetClass: text("asset_class").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

export type RateSnapshot = typeof rateSnapshots.$inferSelect;
export type InsertRateSnapshot = typeof rateSnapshots.$inferInsert;


// ── Pricing engine: historical FX time series ────────────────────────────────
// Daily closing prices per pair, used by the pricing engine to compute realized
// vol (EWMA over last 60 days) and empirical drift (5y annualized log-return).
//
// Backfilled once at setup from TwelveData (one timeseries call per pair).
// Refreshed daily by a cron at ~00:30 UTC (one call per pair per day).
//
// Lookups are always: "give me the last N days for pair X, ordered by date desc".
// Composite unique on (pair, date) prevents accidental double-inserts during
// retries.
export const historicalFxCloses = pgTable("historical_fx_closes", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),
  date: text("date").notNull(),                                    // ISO date YYYY-MM-DD; text avoids tz pitfalls
  close: decimal("close", { precision: 30, scale: 10 }).notNull(), // base/quote price
  source: text("source").notNull().default("twelvedata"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (t) => ({
  uqPairDate: uniqueIndex("historical_fx_closes_pair_date").on(t.pair, t.date),
}));

export type HistoricalFxClose = typeof historicalFxCloses.$inferSelect;
export type InsertHistoricalFxClose = typeof historicalFxCloses.$inferInsert;


// ── Pricing engine: per-pair governance configuration ────────────────────────
// One row per supported pair. Encodes:
//   - Whether the pair is IRP-holding (use rate differential q)
//     OR EM (use empirical drift μ via the §3.5 correction).
//   - The risk-premium markup tier applied on top of realized vol (§6.5).
//   - Last drift recompute timestamp (governance can flag for re-baseline after
//     regime breaks like devaluations).
//
// Bootstrap rows are inserted on first server start; ongoing updates are
// admin-only via a TBD admin route.
export const pairClassification = pgTable("pair_classification", {
  pair: text("pair").primaryKey(),                          // e.g. "USD/GHS"
  useEmpiricalDrift: boolean("use_empirical_drift").notNull(),
  tier: text("tier").notNull(),                             // 'g10' | 'majorEM' | 'lessLiquidEM' | 'frontierEM' | 'pegged'
  notes: text("notes"),
  lastDriftRecompute: timestamp("last_drift_recompute"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PairClassification = typeof pairClassification.$inferSelect;
export type InsertPairClassification = typeof pairClassification.$inferInsert;

export const termsAcceptances = pgTable("terms_acceptances", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  version: text("version").notNull(),
  acceptedAt: timestamp("accepted_at").defaultNow().notNull(),
}, (t) => ({ uniq: unique().on(t.walletAddress, t.version) }));

export type TermsAcceptance = typeof termsAcceptances.$inferSelect;
export const insertTermsAcceptanceSchema = createInsertSchema(termsAcceptances).omit({ id: true, acceptedAt: true });
export type InsertTermsAcceptance = z.infer<typeof insertTermsAcceptanceSchema>;

// ── Articles / Blog CMS ───────────────────────────────────────────────────────
export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle").default(""),
  category: text("category").notNull().default("Hedging"),
  content: jsonb("content").$type<Array<{ type: string; content?: string; items?: string[] }>>().notNull().default([]),
  readTime: text("read_time").default("5 min read"),
  published: boolean("published").default(true),
  publishedAt: timestamp("published_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertArticleSchema = createInsertSchema(articles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articles.$inferSelect;

export const dataRoomContent = pgTable("data_room_content", {
  id: serial("id").primaryKey(),
  docId: text("doc_id").notNull().unique(),
  data: jsonb("data").$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type DataRoomContentRow = typeof dataRoomContent.$inferSelect;

// ──────────────────────────────────────────────────────────────────────
// Private-beta gating
//   - access_requests: form submissions from /apply
//   - access_grants:   approved emails (allowlist gate on the app)
//   - docs_tokens:     per-request docs password tokens (7-day expiry)
// ──────────────────────────────────────────────────────────────────────

export const accessRequests = pgTable("access_requests", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  country: text("country"),
  role: text("role"),
  company: text("company"),
  useCase: text("use_case"),
  heardFrom: text("heard_from"),
  socialHandle: text("social_handle"),
  status: text("status").notNull().default('pending'), // pending | approved | rejected
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAccessRequestSchema = createInsertSchema(accessRequests).omit({
  id: true, status: true, reviewedAt: true, reviewedBy: true, reviewNote: true, createdAt: true,
});

export type AccessRequest = typeof accessRequests.$inferSelect;
export type InsertAccessRequest = z.infer<typeof insertAccessRequestSchema>;

export const accessGrants = pgTable("access_grants", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
  grantedBy: text("granted_by"),
  revokedAt: timestamp("revoked_at"),
});

export type AccessGrant = typeof accessGrants.$inferSelect;

export const docsTokens = pgTable("docs_tokens", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  name: text("name"),
  reason: text("reason"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type DocsToken = typeof docsTokens.$inferSelect;

// Issued when an admin approves an access_request. Lets an approved
// applicant land on /auth to actually sign in via Rift — without one of
// these tokens (in URL or localStorage), the Rift widget never renders.
// Separate from docs_tokens so that docs access doesn't accidentally grant
// app access and vice-versa.
export const signinTokens = pgTable("signin_tokens", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  firstUsedAt: timestamp("first_used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SigninToken = typeof signinTokens.$inferSelect;


/**
 * Outreach drafts — the waiting room.
 *
 * Finax does not touch LinkedIn. Its robots.txt prohibits automated access
 * outright and /feed/ redirects any server request to a login wall, so
 * scanning would mean driving Anthony's logged-in session, which their User
 * Agreement §8.2 forbids and which they enforce with bans. For a founder whose
 * outbound runs through that account, the feature is not worth the account.
 *
 * Reading a post was never the slow part anyway. Pasting one takes thirty
 * seconds; writing a reply that says something true about FX cover takes ten
 * minutes, and that is the half Finax can do — it already knows the live pools,
 * the traction and the pricing.
 *
 * A row is a draft waiting to be copied. It keeps the source link so the reply
 * can be posted where it belongs, and it is never sent from here: the sending
 * stays manual, in Anthony's own hands and his own session.
 */
export const outreachDrafts = pgTable("outreach_drafts", {
  id: serial("id").primaryKey(),

  /** Where the post or comment lives, so the reply can be taken back to it. */
  sourceUrl: text("source_url"),
  /** What was pasted in — the post or comment being replied to. */
  sourceText: text("source_text").notNull(),
  /** Who wrote it, as far as we know. Free text; nothing is looked up. */
  personName: text("person_name"),
  personHeadline: text("person_headline"),

  /** reply | connect | dm — shapes length and register, not just wording. */
  intent: text("intent").notNull().default("reply"),

  /** What Finax wrote. Edited in place before sending. */
  draft: text("draft").notNull(),
  /** The first version, kept so edits show what the model got wrong. */
  originalDraft: text("original_draft").notNull(),

  /** waiting | sent | discarded */
  status: text("status").notNull().default("waiting"),

  /**
   * When the original post was published, as opposed to when we drafted.
   *
   * Kept separate from createdAt because they answer different questions and
   * the gap between them decides whether to send at all. Commenting on a
   * three-week-old post reaches nobody: the thread is cold and the author has
   * moved on. Without this column a draft written today looks equally fresh
   * whether the post is an hour old or a month old.
   */
  postedAt: timestamp("posted_at"),

  /**
   * The comment LinkedIn created, once this was actually published.
   *
   * Stored because it is the only proof the send worked. Without it, "sent"
   * would mean "we pressed the button", which is not the same thing and is
   * exactly the difference that matters when a comment does not appear.
   */
  commentUrn: text("comment_urn"),

  /**
   * Set when this draft is waiting for the browser extension to place it.
   *
   * LinkedIn's comment endpoint is gated behind their partner programme, so a
   * server cannot publish a comment on a third party's post no matter which
   * scopes the token carries. What is left is to carry the text to the comment
   * box and let Anthony press LinkedIn's own Post button. The submission stays
   * a real click by a real person, which is both the honest arrangement and the
   * one LinkedIn has no objection to.
   */
  queuedAt: timestamp("queued_at"),

  createdAt: timestamp("created_at").defaultNow(),
  sentAt: timestamp("sent_at"),
}, (table) => [
  index("outreach_drafts_status_idx").on(table.status),
]);

export const insertOutreachDraftSchema = createInsertSchema(outreachDrafts).omit({
  id: true,
  createdAt: true,
  sentAt: true,
});

/**
 * The people worth talking to.
 *
 * Built as a side effect of drafting rather than as a separate scrape. Every
 * post that clears the relevance bar names someone; that person is upserted
 * here with what they were seen writing about. So the list is a record of
 * people who have actually said something about currency risk in public — which
 * is a far better qualification than a title filter, and it accumulates without
 * anyone maintaining it.
 *
 * Keyed on the profile URL because names collide and headlines change.
 */
export const outreachPeople = pgTable("outreach_people", {
  id: serial("id").primaryKey(),

  /** LinkedIn profile URL, normalised. The identity — everything else can change. */
  profileUrl: text("profile_url").notNull().unique(),

  name: text("name"),
  headline: text("headline"),
  company: text("company"),
  location: text("location"),

  /**
   * What they post about, comma-separated, accumulated across sightings.
   * Derived from which relevance signals their posts matched, so it says
   * "cedi, importers" rather than a guess at their job.
   */
  topics: text("topics"),

  /** How many qualifying posts we have seen from them. Interest, measured. */
  postsSeen: integer("posts_seen").notNull().default(1),
  /** Best relevance score any of their posts reached. */
  topScore: integer("top_score").notNull().default(0),
  /** The most recent thing they wrote, for context when drafting. */
  lastPostText: text("last_post_text"),
  lastPostUrl: text("last_post_url"),

  /** new | drafted | contacted | replied | ignored */
  status: text("status").notNull().default("new"),
  /** Anthony's own notes. Never written by the model. */
  notes: text("notes"),

  firstSeen: timestamp("first_seen").defaultNow(),
  lastSeen: timestamp("last_seen").defaultNow(),
}, (table) => [
  index("outreach_people_status_idx").on(table.status),
  index("outreach_people_score_idx").on(table.topScore),
]);

/**
 * What Finax knows about the world beyond the order book.
 *
 * The rate history answers "what has USD/GHS done"; it cannot answer "why", and
 * a comment that cites a move without a mechanism reads as a bot with a
 * calculator. This table holds the qualitative half — a policy decision, an IMF
 * tranche, a research finding — each with a source and a date it was true.
 *
 * Dated on purpose. A fact about the Bank of Ghana's policy rate is worth
 * quoting in March and wrong by September, and a drafting tool that cannot tell
 * the difference will confidently post the stale one. Retrieval prefers recent
 * facts and the prompt is told how old each one is.
 */
export const marketMemory = pgTable("market_memory", {
  id: serial("id").primaryKey(),

  /** news | policy | research | data | insight */
  kind: text("kind").notNull().default("news"),

  /** One line. What a reader would take away. */
  title: text("title").notNull(),
  /** The substance, in a few sentences. What makes it quotable. */
  body: text("body").notNull(),

  /** Where it came from. A fact with no source does not get quoted. */
  sourceName: text("source_name"),
  sourceUrl: text("source_url"),

  /** When this was true — not when it was entered. Drives staleness. */
  asOf: timestamp("as_of").notNull(),

  /** Comma-separated, matched against post text at retrieval time. */
  tags: text("tags"),
  /** Set when the fact is about one pair, e.g. USD/GHS. */
  pair: text("pair"),

  /** Cleared rather than deleted, so a superseded fact keeps its history. */
  active: boolean("active").notNull().default(true),

  createdAt: timestamp("created_at").defaultNow(),
  createdBy: text("created_by"),
}, (table) => [
  index("market_memory_active_idx").on(table.active),
  index("market_memory_asof_idx").on(table.asOf),
]);

export const insertOutreachPersonSchema = createInsertSchema(outreachPeople).omit({
  id: true, firstSeen: true, lastSeen: true,
});
export const insertMarketMemorySchema = createInsertSchema(marketMemory).omit({
  id: true, createdAt: true,
});
export type OutreachPerson = typeof outreachPeople.$inferSelect;
export type MarketMemory = typeof marketMemory.$inferSelect;
export type OutreachDraft = typeof outreachDrafts.$inferSelect;
export type InsertOutreachDraft = z.infer<typeof insertOutreachDraftSchema>;
