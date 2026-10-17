import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Stable platform identity. Wallet addresses are linked separately per chain/network. */
export const userAccounts = pgTable("user_accounts", {
  id: serial("id").primaryKey(),
  email: text("email").unique(),
  googleId: text("google_id").unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow(),
});
