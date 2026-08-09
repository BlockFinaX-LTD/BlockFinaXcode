/**
 * What a customer has agreed to hear about.
 *
 * ## Not everything is a preference
 *
 * The obvious design is one row of switches and a send that checks them. It is
 * wrong, and in a way that matters here: telling someone their identity check
 * was refused, or that the security model protecting their money has changed,
 * is not marketing. Those are things we are obliged to say, and a switch that
 * silences them would be a switch for losing money quietly.
 *
 * So categories are split by whether they are genuinely optional. `account` is
 * always on and has no control in the UI — the screen says so rather than
 * showing a toggle that does nothing. Everything else is the customer's call.
 *
 * ## Absent means yes
 *
 * A customer with no row has consented to nothing and also refused nothing;
 * they simply predate this table. Defaulting them to silence would stop
 * payout notices for every existing user the moment this shipped. Defaulting
 * to on matches what they already receive, and the screen lets them turn it
 * down — which is the same trade the GDPR draws between a service message and
 * a marketing one.
 */

import { pgTable, serial, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const NOTIFICATION_CATEGORIES = [
  {
    key: "account",
    label: "Account and security",
    detail: "Verification results, signing-method changes, anything affecting access to your funds.",
    optional: false,
  },
  {
    key: "transactions",
    label: "Transactions",
    detail: "Cover purchased, payouts settled, deposits and withdrawals confirmed.",
    optional: true,
  },
  {
    key: "cover",
    label: "Cover and pools",
    detail: "New cover on pairs you hold, and reminders before your cover expires.",
    optional: true,
  },
  {
    key: "product",
    label: "Product updates",
    detail: "Occasional notes about new features. A few times a year at most.",
    optional: true,
  },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["key"];

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    id: serial("id").primaryKey(),
    /** Lower-cased wallet address — the identifier every other table keys on. */
    walletAddress: text("wallet_address").notNull().unique(),

    // account is deliberately absent: it cannot be turned off, so storing a
    // column for it would invite code that reads one.
    transactions: boolean("transactions").notNull().default(true),
    cover: boolean("cover").notNull().default(true),
    product: boolean("product").notNull().default(true),

    updatedAt: timestamp("updated_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({ walletIdx: index("notification_prefs_wallet_idx").on(t.walletAddress) }),
);

export const insertNotificationPrefsSchema = createInsertSchema(notificationPrefs).omit({
  id: true,
  updatedAt: true,
  createdAt: true,
});

export type NotificationPrefs = typeof notificationPrefs.$inferSelect;

/** Everything on — what a customer with no stored row already receives. */
export const DEFAULT_PREFS: Record<Exclude<NotificationCategory, "account">, boolean> = {
  transactions: true,
  cover: true,
  product: true,
};

/**
 * May we send this?
 *
 * `account` is always yes, whatever is stored. A missing row is yes, because
 * absent is not a refusal.
 */
export function mayNotify(
  prefs: NotificationPrefs | null | undefined,
  category: NotificationCategory,
): boolean {
  if (category === "account") return true;
  if (!prefs) return DEFAULT_PREFS[category];
  return prefs[category] !== false;
}
