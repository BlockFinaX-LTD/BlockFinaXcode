/**
 * Database Schema Definitions
 * 
 * Defines all database tables, types, and validation schemas
 * for the blockchain communication platform.
 */

import { pgTable, text, serial, integer, boolean, timestamp, decimal, varchar, unique, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Import profile and referral schemas
export * from "./profile-schema";
export * from "./referral-schema";

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
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("hedge_activity_chain_tx_action_idx").on(table.chainId, table.txHash, table.actionType),
]);

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

