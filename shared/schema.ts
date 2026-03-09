/**
 * Database Schema Definitions
 * 
 * Defines all database tables, types, and validation schemas
 * for the blockchain communication platform.
 */

import { pgTable, text, serial, integer, boolean, timestamp, decimal, varchar, unique, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Import profile and referral schemas
export * from "./profile-schema";
export * from "./referral-schema";

// Wallet management table - stores encrypted wallet data
export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  address: text("address").notNull().unique(),
  name: text("name").notNull(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  encryptedMnemonic: text("encrypted_mnemonic"),
  email: text("email"),
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

// Transaction history tracking
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id").references(() => wallets.id),
  hash: text("hash").notNull().unique(),
  from: text("from").notNull(),
  to: text("to").notNull(),
  value: decimal("value", { precision: 78, scale: 18 }).notNull(),
  gasPrice: decimal("gas_price", { precision: 78, scale: 0 }),
  gasUsed: decimal("gas_used", { precision: 78, scale: 0 }),
  status: text("status").notNull(), // pending, confirmed, failed
  blockNumber: integer("block_number"),
  networkId: integer("network_id").references(() => networks.id),
  timestamp: timestamp("timestamp").defaultNow(),
});

// Wallet balance tracking across networks
export const balances = pgTable("balances", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id").references(() => wallets.id),
  networkId: integer("network_id").references(() => networks.id),
  balance: decimal("balance", { precision: 78, scale: 18 }).notNull(),
  usdValue: decimal("usd_value", { precision: 10, scale: 2 }),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const userRoles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  role: text("role").notNull(), // individual, business, admin
  kycStatus: text("kyc_status").default("pending"), // pending, approved, failed
  kycDocuments: text("kyc_documents"), // JSON string of document links
  lastActivity: timestamp("last_activity").defaultNow(),
  referralSource: text("referral_source"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWalletSchema = createInsertSchema(wallets).omit({
  id: true,
  createdAt: true,
});

export const insertNetworkSchema = createInsertSchema(networks).omit({
  id: true,
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  timestamp: true,
});

export const insertBalanceSchema = createInsertSchema(balances).omit({
  id: true,
  lastUpdated: true,
});

export const insertUserRoleSchema = createInsertSchema(userRoles).omit({
  id: true,
  createdAt: true,
});

export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof wallets.$inferSelect;
export type InsertNetwork = z.infer<typeof insertNetworkSchema>;
export type Network = typeof networks.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertBalance = z.infer<typeof insertBalanceSchema>;
export type Balance = typeof balances.$inferSelect;

export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;
export type UserRole = typeof userRoles.$inferSelect;

export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(), // 'individual' or 'business'
  companyName: text("company_name"),
  country: text("country").notNull(),
  goodsTraded: text("goods_traded"),
  tradingVolume: text("trading_volume"),
  challenges: text("challenges"),
  preferredChannel: text("preferred_channel").notNull(), // 'email', 'whatsapp', 'other'
  preferredChannelOther: text("preferred_channel_other"),
  additionalComments: text("additional_comments"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWaitlistSchema = createInsertSchema(waitlist).omit({
  id: true,
  createdAt: true,
});

export type InsertWaitlist = z.infer<typeof insertWaitlistSchema>;
export type Waitlist = typeof waitlist.$inferSelect;

export const subscribers = pgTable("subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSubscriberSchema = createInsertSchema(subscribers).omit({
  id: true,
  createdAt: true,
});

export type InsertSubscriber = z.infer<typeof insertSubscriberSchema>;
export type Subscriber = typeof subscribers.$inferSelect;

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
});

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
});

export const userTaskCompletions = pgTable("user_task_completions", {
  id: serial("id").primaryKey(),
  walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
  taskId: integer("task_id").references(() => dailyTasks.id).notNull(),
  completedAt: timestamp("completed_at").defaultNow().notNull(),
  pointsEarned: integer("points_earned").notNull(),
});

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

export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  category: text("category").notNull(),
  readTime: text("read_time").notNull(),
  date: text("date").notNull(),
  content: jsonb("content").notNull(),
  isPublished: boolean("is_published").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertArticleSchema = createInsertSchema(articles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Article = typeof articles.$inferSelect;
export type InsertArticle = z.infer<typeof insertArticleSchema>;

export const rateSnapshots = pgTable("rate_snapshots", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),
  rate: decimal("rate", { precision: 30, scale: 10 }).notNull(),
  assetClass: text("asset_class").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

export type RateSnapshot = typeof rateSnapshots.$inferSelect;
export type InsertRateSnapshot = typeof rateSnapshots.$inferInsert;

