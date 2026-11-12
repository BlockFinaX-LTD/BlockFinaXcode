/**
 * Reading and honouring notification preferences.
 *
 * The gate is `sendIfAllowed`, and it exists so that checking a preference and
 * sending an email cannot drift apart. A helper that only answers "is this
 * allowed?" leaves every call site free to forget to ask — and the failure is
 * silent, because an email that should not have been sent looks exactly like
 * one that should.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { notificationPrefs, DEFAULT_PREFS, type NotificationPrefs } from "@shared/notification-schema";

const key = (address: string) => address.trim().toLowerCase();

export async function getPrefs(address: string): Promise<NotificationPrefs | null> {
  if (!address) return null;
  try {
    const [row] = await db
      .select()
      .from(notificationPrefs)
      .where(eq(notificationPrefs.walletAddress, key(address)))
      .limit(1);
    return row ?? null;
  } catch {
    // A preferences table that cannot be read must not stop an account notice
    // going out. Null means "no row", which means the defaults apply.
    return null;
  }
}

export async function setPrefs(
  address: string,
  next: Partial<typeof DEFAULT_PREFS>,
): Promise<NotificationPrefs | null> {
  const addr = key(address);
  const values = {
    transactions: next.transactions ?? DEFAULT_PREFS.transactions,
    cover: next.cover ?? DEFAULT_PREFS.cover,
    product: next.product ?? DEFAULT_PREFS.product,
  };
  const [row] = await db
    .insert(notificationPrefs)
    .values({ walletAddress: addr, ...values })
    .onConflictDoUpdate({
      target: notificationPrefs.walletAddress,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return row ?? null;
}
