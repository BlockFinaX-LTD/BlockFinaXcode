/**
 * User Profile Schema - Database tables for user profiles and social identity
 *
 * Stores display names, social links (Twitter, Telegram, LinkedIn), bio,
 * avatar, country, and wallet address for each user in the platform.
 * Exports: userProfiles table, insertUserProfileSchema, InsertUserProfile, UserProfile types.
 */
import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  displayName: text("display_name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  phoneNumber: text("phone_number"),
  companyName: text("company_name"),
  jobTitle: text("job_title"),
  country: text("country"),
  city: text("city"),
  address: text("address"),
  postalCode: text("postal_code"),
  dateOfBirth: text("date_of_birth"),
  nationality: text("nationality"),
  idType: text("id_type"),
  idNumber: text("id_number"),
  taxId: text("tax_id"),
  website: text("website"),
  linkedin: text("linkedin"),
  twitter: text("twitter"),
  bio: text("bio"),
  avatar: text("avatar"),
  kycStatus: text("kyc_status").default("not_started"),
  kycDocuments: jsonb("kyc_documents"),
  isPublic: boolean("is_public").default(false),
  lastUpdated: timestamp("last_updated").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserProfileSchema = createInsertSchema(userProfiles).omit({
  id: true,
  createdAt: true,
  lastUpdated: true,
});

export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type UserProfile = typeof userProfiles.$inferSelect;
