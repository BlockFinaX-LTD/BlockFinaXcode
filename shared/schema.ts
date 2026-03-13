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


export const rateSnapshots = pgTable("rate_snapshots", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),
  rate: decimal("rate", { precision: 30, scale: 10 }).notNull(),
  assetClass: text("asset_class").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

export type RateSnapshot = typeof rateSnapshots.$inferSelect;
export type InsertRateSnapshot = typeof rateSnapshots.$inferInsert;

export const dataRoomContent = pgTable("data_room_content", {
  id: serial("id").primaryKey(),
  docId: text("doc_id").notNull().unique(),
  data: jsonb("data").$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type DataRoomContentRow = typeof dataRoomContent.$inferSelect;

