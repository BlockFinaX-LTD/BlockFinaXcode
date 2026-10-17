/**
 * Chain-neutral wallet and external identity metadata.
 *
 * These tables deliberately contain no private keys, seed phrases, passkey
 * secrets, or provider access tokens. They let one platform user link
 * independent accounts across chains and wallet providers.
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { userAccounts } from "./auth-core-schema";

export const authIdentityLinks = pgTable(
  "auth_identity_links",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerSubject: text("provider_subject").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    lastAuthenticatedAt: timestamp("last_authenticated_at", { withTimezone: true }),
  },
  (table) => ({
    providerSubjectUnique: uniqueIndex("auth_identity_links_provider_subject_uq").on(
      table.provider,
      table.providerSubject,
    ),
    userIndex: index("auth_identity_links_user_idx").on(table.userId),
  }),
);

export const chainWalletAccounts = pgTable(
  "chain_wallet_accounts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "cascade" }),
    chainNamespace: varchar("chain_namespace", { length: 24 }).notNull(),
    networkKey: varchar("network_key", { length: 80 }).notNull(),
    address: text("address").notNull(),
    /** Chain-specific normalized address used for uniqueness; preserve `address` for display. */
    addressCanonical: text("address_canonical").notNull(),
    walletProvider: varchar("wallet_provider", { length: 32 }).notNull(),
    accountType: varchar("account_type", { length: 32 }).notNull(),
    displayName: text("display_name"),
    isPrimary: boolean("is_primary").notNull().default(false),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => ({
    chainAddressUnique: uniqueIndex("chain_wallet_accounts_network_address_uq").on(
      table.chainNamespace,
      table.networkKey,
      table.addressCanonical,
    ),
    userChainIndex: index("chain_wallet_accounts_user_chain_idx").on(
      table.userId,
      table.chainNamespace,
      table.networkKey,
    ),
  }),
);

export const chainTransactions = pgTable(
  "chain_transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "cascade" }),
    walletAccountId: integer("wallet_account_id")
      .notNull()
      .references(() => chainWalletAccounts.id, { onDelete: "restrict" }),
    chainNamespace: varchar("chain_namespace", { length: 24 }).notNull(),
    networkKey: varchar("network_key", { length: 80 }).notNull(),
    transactionHash: text("transaction_hash"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    operation: varchar("operation", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    failureCode: varchar("failure_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => ({
    networkHashUnique: uniqueIndex("chain_transactions_network_hash_uq").on(
      table.chainNamespace,
      table.networkKey,
      table.transactionHash,
    ),
    networkIdempotencyUnique: uniqueIndex("chain_transactions_network_idempotency_uq").on(
      table.chainNamespace,
      table.networkKey,
      table.idempotencyKey,
    ),
    userCreatedIndex: index("chain_transactions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    walletIndex: index("chain_transactions_wallet_idx").on(table.walletAccountId),
  }),
);

export const insertAuthIdentityLinkSchema = createInsertSchema(authIdentityLinks).omit({ id: true });
export const insertChainWalletAccountSchema = createInsertSchema(chainWalletAccounts).omit({
  id: true,
  createdAt: true,
});
export const insertChainTransactionSchema = createInsertSchema(chainTransactions).omit({
  id: true,
  createdAt: true,
});

export type AuthIdentityLink = typeof authIdentityLinks.$inferSelect;
export type NewAuthIdentityLink = z.infer<typeof insertAuthIdentityLinkSchema>;
export type ChainWalletAccount = typeof chainWalletAccounts.$inferSelect;
export type NewChainWalletAccount = z.infer<typeof insertChainWalletAccountSchema>;
export type ChainTransaction = typeof chainTransactions.$inferSelect;
export type NewChainTransaction = z.infer<typeof insertChainTransactionSchema>;

/**
 * Passkeys that control a user's BlockFinaX smart accounts (testnet wallet).
 * Holds the public key only; the private key never leaves the user's device.
 * One P-256 passkey owns a Stellar smart account and a Base smart account.
 */
export const walletPasskeys = pgTable(
  "wallet_passkeys",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    /** COSE public key, base64. */
    publicKey: text("public_key").notNull(),
    /** Uncompressed P-256 point coordinates, 0x-prefixed hex (32 bytes each). */
    x: text("x").notNull(),
    y: text("y").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: text("transports").notNull().default("[]"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    credentialUnique: uniqueIndex("wallet_passkeys_credential_uq").on(table.credentialId),
    userIndex: index("wallet_passkeys_user_idx").on(table.userId),
  }),
);

export type WalletPasskey = typeof walletPasskeys.$inferSelect;
