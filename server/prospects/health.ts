/**
 * health.ts, watching the damage and stopping before it becomes permanent.
 *
 * ## Why this exists instead of a separate sending domain
 *
 * Cold outreach goes out on blockfinax.com, the domain customer magic links
 * arrive on. A separate subdomain would have contained the damage after it
 * happened. This prevents it, which is better, and it is the piece most
 * outbound setups do not have.
 *
 * The damage is never one bad email. It is continuing to send after the
 * complaints start, because nobody was watching a number that only moves once a
 * campaign is already in trouble. Mailbox providers do not send a warning; they
 * quietly change how they treat the domain, and the first symptom is a customer
 * saying login is broken.
 *
 * ## The thresholds, and where they come from
 *
 * Gmail's bulk sender rules require a spam complaint rate below 0.30% and say
 * to aim below 0.10%. Above 0.30% they act. A bounce rate above roughly 5%
 * marks a sender as working from a stale or scraped list, which is exactly what
 * this pipeline produces if discovery goes wrong.
 *
 * Both are set slightly under the level at which anyone else acts, because the
 * point is to stop before a provider decides to, not after.
 *
 * ## Why the halt is stored rather than computed
 *
 * A rate falls as more mail is sent, so a computed halt un-halts itself the
 * moment volume grows, which is precisely backwards. Once tripped it stays
 * tripped until a person clears it, and clearing it is a deliberate act that
 * records who did it.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { prospects } from "@shared/prospect-schema";
import { platformSettings } from "@shared/schema";

const HALT_KEY = "prospect_sending_halted";

/** Gmail acts above 0.30%. Stop before anyone else decides to. */
export const MAX_COMPLAINT_RATE = 0.0025;
/** Above this a sender looks like it is working from a scraped list. */
export const MAX_BOUNCE_RATE = 0.04;
/** Below this, one bad address is a large percentage and means nothing. */
export const MIN_SAMPLE = 40;

export interface Health {
  sent: number;
  bounced: number;
  complained: number;
  bounceRate: number;
  complaintRate: number;
  halted: boolean;
  reason: string | null;
  /** True once there is enough volume for the rates to mean anything. */
  meaningful: boolean;
}

export async function sendingHealth(): Promise<Health> {
  let sent = 0, bounced = 0, complained = 0;
  try {
    const [row] = await db.select({
      sent: sql<number>`count(*) filter (where ${prospects.sentAt} is not null)::int`,
      bounced: sql<number>`count(*) filter (where ${prospects.bouncedAt} is not null)::int`,
      complained: sql<number>`count(*) filter (where ${prospects.status} = 'complained')::int`,
    }).from(prospects);
    sent = Number(row?.sent) || 0;
    bounced = Number(row?.bounced) || 0;
    complained = Number(row?.complained) || 0;
  } catch {
    // An unreadable table is not evidence that sending is safe.
    return {
      sent: 0, bounced: 0, complained: 0, bounceRate: 0, complaintRate: 0,
      halted: true, reason: "Cannot read sending history, so sending is held.", meaningful: false,
    };
  }

  const bounceRate = sent ? bounced / sent : 0;
  const complaintRate = sent ? complained / sent : 0;
  const meaningful = sent >= MIN_SAMPLE;

  let halted = false;
  let reason: string | null = null;
  try {
    const [row] = await db.select().from(platformSettings)
      .where(eq(platformSettings.key, HALT_KEY)).limit(1);
    if (row?.value) { halted = true; reason = row.value; }
  } catch {
    /* absence of a halt record is not a halt */
  }

  return { sent, bounced, complained, bounceRate, complaintRate, halted, reason, meaningful };
}

async function setHalt(reason: string): Promise<void> {
  await db.insert(platformSettings)
    .values({ key: HALT_KEY, value: reason, updatedBy: "circuit-breaker" })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value: reason, updatedAt: new Date(), updatedBy: "circuit-breaker" },
    });
}

export async function clearHalt(by: string): Promise<void> {
  await db.delete(platformSettings).where(eq(platformSettings.key, HALT_KEY));
  console.log(`[Prospects] Sending halt cleared by ${by}.`);
}

/**
 * Check the rates and trip the breaker if either is past its limit.
 *
 * Called after every bounce or complaint rather than on a timer, so the halt
 * lands within one event of the threshold being crossed rather than up to an
 * interval later. At two hundred a day, an interval is a lot of mail.
 */
export async function evaluateBreaker(): Promise<Health> {
  const h = await sendingHealth();
  if (h.halted || !h.meaningful) return h;

  if (h.complaintRate > MAX_COMPLAINT_RATE) {
    const pct = (h.complaintRate * 100).toFixed(2);
    const reason =
      `Sending halted automatically. ${h.complained} of ${h.sent} recipients marked the mail as spam, ` +
      `which is ${pct}%. Gmail acts above 0.30% and this domain also carries your customer magic links. ` +
      `Review who is being written to and what it says before clearing this.`;
    await setHalt(reason);
    console.error(`[Prospects] ${reason}`);
    return { ...h, halted: true, reason };
  }

  if (h.bounceRate > MAX_BOUNCE_RATE) {
    const pct = (h.bounceRate * 100).toFixed(1);
    const reason =
      `Sending halted automatically. ${h.bounced} of ${h.sent} addresses bounced, which is ${pct}%. ` +
      `A rate this high marks the sender as working from a scraped list, and it damages the domain ` +
      `your magic links depend on. The discovery crawl is probably picking up dead addresses.`;
    await setHalt(reason);
    console.error(`[Prospects] ${reason}`);
    return { ...h, halted: true, reason };
  }

  return h;
}

/** Record a bounce reported by the provider. */
export async function recordBounce(email: string): Promise<void> {
  await db.update(prospects)
    .set({ bouncedAt: new Date(), sendable: false, sendableReason: "The address bounced." })
    .where(eq(prospects.email, email.trim().toLowerCase()));
  await evaluateBreaker();
}

/** Record a spam complaint. The most expensive signal there is. */
export async function recordComplaint(email: string): Promise<void> {
  await db.update(prospects)
    .set({ status: "complained", sendable: false, sendableReason: "They marked it as spam." })
    .where(eq(prospects.email, email.trim().toLowerCase()));
  await evaluateBreaker();
}
