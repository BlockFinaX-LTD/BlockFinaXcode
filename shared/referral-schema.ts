/**
 * Referral System Schema Definitions
 * 
 * Manages referral codes, tracking, points system, and reward distribution
 * for user growth and engagement in the blockchain communication platform.
 */

import {
  pgTable,
  text,
  varchar,
  integer,
  timestamp,
  boolean,
  serial,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Referral codes generation and management
export const referralCodes = pgTable("referral_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).unique().notNull(),
  referrerWalletAddress: varchar("referrer_wallet_address", { length: 42 }).notNull(),
  description: varchar("description", { length: 255 }).default("Invite your partners"),
  isActive: boolean("is_active").default(true).notNull(),
  maxUses: integer("max_uses"), // null = unlimited
  currentUses: integer("current_uses").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

// Referrals table - tracks successful referrals
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referralCode: varchar("referral_code", { length: 20 }).notNull(),
  referrerWalletAddress: varchar("referrer_wallet_address", { length: 42 }).notNull(),
  referredWalletAddress: varchar("referred_wallet_address", { length: 42 }).notNull(),
  pointsEarned: integer("points_earned").default(50).notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending, completed, expired
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// User points table
export const userPoints = pgTable("user_points", {
  id: serial("id").primaryKey(),
  walletAddress: varchar("wallet_address", { length: 42 }).unique().notNull(),
  totalPoints: integer("total_points").default(0).notNull(),
  referralPoints: integer("referral_points").default(0).notNull(),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
});

// Point transactions table - tracks all point movements
export const pointTransactions = pgTable("point_transactions", {
  id: serial("id").primaryKey(),
  walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // referral_earned, referral_bonus, trade_bonus, etc.
  points: integer("points").notNull(),
  description: text("description").notNull(),
  referenceId: varchar("reference_id", { length: 50 }), // can reference referral ID or transaction ID
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Validation schemas
export const insertReferralCodeSchema = createInsertSchema(referralCodes).omit({
  id: true,
  createdAt: true,
  currentUses: true,
});

export const insertReferralSchema = createInsertSchema(referrals).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertUserPointsSchema = createInsertSchema(userPoints).omit({
  id: true,
  lastUpdated: true,
});

export const insertPointTransactionSchema = createInsertSchema(pointTransactions).omit({
  id: true,
  createdAt: true,
});

// Types
export type ReferralCode = typeof referralCodes.$inferSelect;
export type InsertReferralCode = z.infer<typeof insertReferralCodeSchema>;

export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = z.infer<typeof insertReferralSchema>;

export type UserPoints = typeof userPoints.$inferSelect;
export type InsertUserPoints = z.infer<typeof insertUserPointsSchema>;

export type PointTransaction = typeof pointTransactions.$inferSelect;
export type InsertPointTransaction = z.infer<typeof insertPointTransactionSchema>;