/**
 * Tier limits — what a wallet has moved, and what it is exposed to.
 *
 * Two independent measures, both of which must pass:
 *
 *   cashMoved       premiums paid, payouts received, deposits and withdrawals
 *                   over a rolling 30 days. Value that actually changed hands.
 *   payoutExposure  the maximum a wallet's open positions could pay out. Money
 *                   that has not moved yet but has been committed to.
 *
 * Notional is deliberately absent. It is the size of the thing being protected,
 * not a sum anyone transfers, and on these pools a $100,000 position moves
 * between $70 and $2,000 of premium while carrying a flat $10,000 payout.
 * Gating on notional would block a customer for a number that never touches a
 * bank account; gating on premium would wave through a $10,000 claim bought
 * for $70.
 *
 * Checks run BEFORE the transaction. A limit enforced afterwards is a report,
 * not a control.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { hedgeActivity, hedgePositions, hedgeEvents, userProfiles } from "@shared/schema";
import {
  KYC_TIERS, LIMIT_WINDOW_DAYS, tierFor, complianceAlerts,
  type TierDef, type AlertKind,
} from "@shared/compliance-schema";

const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const windowStart = () => new Date(Date.now() - LIMIT_WINDOW_DAYS * 86_400_000);

export interface WalletStanding {
  walletAddress: string;
  tier: number;
  tierDef: TierDef;
  kycStatus: string;
  cashMovedUsd: number;
  payoutExposureUsd: number;
  cashRemainingUsd: number;
  exposureRemainingUsd: number;
  windowDays: number;
}

/**
 * What this wallet has moved and is exposed to, against its tier.
 *
 * Payout exposure is read from positions rather than the activity log because
 * a position's maximum payout is a property of the position, and the activity
 * log records the purchase amount rather than what it could pay.
 */
export async function walletStanding(walletAddress: string): Promise<WalletStanding> {
  const wallet = walletAddress.toLowerCase();

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(sql`lower(${userProfiles.walletAddress}) = ${wallet}`)
    .limit(1);

  const tier = profile?.kycTier ?? 0;

  // Value actually transferred, in either direction, inside the window.
  const activity = await db
    .select()
    .from(hedgeActivity)
    .where(
      and(
        sql`lower(${hedgeActivity.walletAddress}) = ${wallet}`,
        gte(hedgeActivity.createdAt, windowStart()),
      ),
    );
  const pools = await db.select().from(hedgeEvents);

  let cashMoved = 0;
  for (const a of activity) {
    const amt = num(a.amount);
    switch (a.actionType) {
      case "buy_protection": {
        // The purchase records notional; what moved is the premium on it.
        const pool = pools.find((e) => e.onChainEventId === a.onChainEventId && e.chainId === a.chainId);
        cashMoved += pool ? amt * num(pool.premiumRate) : 0;
        break;
      }
      case "deposit":
      case "withdraw":
      case "claim":
      case "claim_premiums":
        // These move their face value.
        cashMoved += amt;
        break;
      default:
        break; // create_event, settle — no customer value transfer
    }
  }

  // Committed future outflow: what open positions could still pay.
  const positions = await db
    .select()
    .from(hedgePositions)
    .where(
      and(
        sql`lower(${hedgePositions.hedgerWallet}) = ${wallet}`,
        eq(hedgePositions.status, "active"),
      ),
    );
  const payoutExposure = positions.reduce((s, p) => s + num(p.maxPayout), 0);

  const def = tierFor(tier);
  return {
    walletAddress: wallet,
    tier,
    tierDef: def,
    kycStatus: profile?.kycStatus ?? "not_started",
    cashMovedUsd: cashMoved,
    payoutExposureUsd: payoutExposure,
    cashRemainingUsd: Math.max(0, def.cashMovedUsd - cashMoved),
    exposureRemainingUsd: Math.max(0, def.payoutExposureUsd - payoutExposure),
    windowDays: LIMIT_WINDOW_DAYS,
  };
}

export interface LimitCheck {
  allowed: boolean;
  reason?: string;
  /** The tier that would permit this, when the current one does not. */
  requiredTier?: number;
  standing: WalletStanding;
  addsCashUsd: number;
  addsExposureUsd: number;
}

/**
 * Would this transaction stay inside the wallet's tier?
 *
 * `notionalUsd` is accepted for protection purchases only so that premium and
 * maximum payout can be derived from the pool — it is never itself compared
 * against a limit.
 */
export async function checkTransaction(args: {
  walletAddress: string;
  kind: "buy_protection" | "deposit" | "withdraw";
  /** Deposits and withdrawals: the amount. Purchases: leave undefined. */
  amountUsd?: number;
  /** Purchases only. */
  notionalUsd?: number;
  /** Purchases only — local hedge_events id, to read the rates from. */
  eventId?: number;
}): Promise<LimitCheck> {
  const standing = await walletStanding(args.walletAddress);

  let addsCash = 0;
  let addsExposure = 0;

  if (args.kind === "buy_protection") {
    const [pool] = args.eventId
      ? await db.select().from(hedgeEvents).where(eq(hedgeEvents.id, args.eventId)).limit(1)
      : [];
    const notional = args.notionalUsd ?? 0;
    // Fall back to the platform's standard 10% payout rate if the pool cannot
    // be read: erring toward a higher exposure keeps the control conservative.
    addsCash = notional * (pool ? num(pool.premiumRate) : 0.01);
    addsExposure = notional * (pool ? num(pool.payoutRate) : 0.1);
  } else {
    addsCash = args.amountUsd ?? 0;
  }

  const def = standing.tierDef;
  const cashAfter = standing.cashMovedUsd + addsCash;
  const exposureAfter = standing.payoutExposureUsd + addsExposure;

  const base = { standing, addsCashUsd: addsCash, addsExposureUsd: addsExposure };

  if (standing.tier === 0) {
    return {
      ...base,
      allowed: false,
      requiredTier: neededTier(cashAfter, exposureAfter),
      reason: "Identity verification is required before transacting.",
    };
  }

  if (cashAfter > def.cashMovedUsd) {
    return {
      ...base,
      allowed: false,
      requiredTier: neededTier(cashAfter, exposureAfter),
      reason:
        `This would take you to $${cashAfter.toFixed(2)} moved in ${LIMIT_WINDOW_DAYS} days, above the ` +
        `$${def.cashMovedUsd.toLocaleString()} limit for ${def.name} verification.`,
    };
  }

  if (exposureAfter > def.payoutExposureUsd) {
    return {
      ...base,
      allowed: false,
      requiredTier: neededTier(cashAfter, exposureAfter),
      reason:
        `This would take your total potential payout to $${exposureAfter.toFixed(2)}, above the ` +
        `$${def.payoutExposureUsd.toLocaleString()} limit for ${def.name} verification.`,
    };
  }

  return { ...base, allowed: true };
}

/** Lowest tier whose limits accommodate both figures. */
function neededTier(cash: number, exposure: number): number {
  const found = KYC_TIERS.find((t) => t.tier > 0 && cash <= t.cashMovedUsd && exposure <= t.payoutExposureUsd);
  return found?.tier ?? 3;
}

// ── Alerts ────────────────────────────────────────────────────────────────

/** Raises a compliance alert. Never throws — monitoring must not block a customer. */
export async function raiseAlert(args: {
  kind: AlertKind;
  severity?: "low" | "medium" | "high";
  walletAddress?: string;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(complianceAlerts).values({
      kind: args.kind,
      severity: args.severity ?? "medium",
      walletAddress: args.walletAddress?.toLowerCase(),
      title: args.title,
      detail: args.detail ?? "",
      meta: args.meta,
    });
  } catch (err: any) {
    console.error("[compliance] could not raise alert:", err?.message);
  }
}

/**
 * Thresholds from policy §4 that trigger review without blocking.
 *
 * Distinct from the tier limits above: those refuse a transaction, these
 * record one that went through and needs a human to look at it.
 */
export const MONITORING = {
  singleTransactionUsd: 5_000,
  cumulativeUsd: 10_000,
  /** Transactions in the window just under the single-transaction threshold. */
  structuringCount: 3,
  structuringBandLow: 0.7,
};

/**
 * Reviews a completed transaction and raises anything policy §4 requires.
 *
 * Runs after the fact by design — its job is to flag for a human, not to
 * decide. Blocking happens in checkTransaction, before the money moves.
 */
export async function monitorTransaction(args: {
  walletAddress: string;
  amountUsd: number;
  kind: string;
  txHash?: string;
}): Promise<void> {
  const { walletAddress, amountUsd, kind, txHash } = args;

  if (amountUsd >= MONITORING.singleTransactionUsd) {
    await raiseAlert({
      kind: "large_transaction",
      severity: "high",
      walletAddress,
      title: `Single transaction of $${amountUsd.toLocaleString()}`,
      detail: `A ${kind} of $${amountUsd.toFixed(2)} exceeds the $${MONITORING.singleTransactionUsd.toLocaleString()} review threshold in policy §4.`,
      meta: { txHash, kind, amountUsd },
    });
  }

  const standing = await walletStanding(walletAddress);
  if (standing.cashMovedUsd >= MONITORING.cumulativeUsd) {
    await raiseAlert({
      kind: "cumulative_threshold",
      severity: "high",
      walletAddress,
      title: `$${standing.cashMovedUsd.toFixed(0)} moved in ${LIMIT_WINDOW_DAYS} days`,
      detail: `Cumulative value transferred has passed the $${MONITORING.cumulativeUsd.toLocaleString()} threshold in policy §3.3. Enhanced due diligence applies.`,
      meta: { cashMovedUsd: standing.cashMovedUsd, tier: standing.tier },
    });
  }

  // Structuring: several transactions clustered just below the reporting line
  // is the signature policy §4 asks us to look for.
  const low = MONITORING.singleTransactionUsd * MONITORING.structuringBandLow;
  const recent = await db
    .select()
    .from(hedgeActivity)
    .where(
      and(
        sql`lower(${hedgeActivity.walletAddress}) = ${walletAddress.toLowerCase()}`,
        gte(hedgeActivity.createdAt, windowStart()),
      ),
    );
  const nearMisses = recent.filter((r) => {
    const a = num(r.amount);
    return a >= low && a < MONITORING.singleTransactionUsd;
  });
  if (nearMisses.length >= MONITORING.structuringCount) {
    await raiseAlert({
      kind: "structuring",
      severity: "high",
      walletAddress,
      title: `${nearMisses.length} transactions just below the reporting threshold`,
      detail:
        `${nearMisses.length} transactions between $${low.toFixed(0)} and ` +
        `$${MONITORING.singleTransactionUsd.toLocaleString()} in ${LIMIT_WINDOW_DAYS} days. ` +
        `Policy §4 treats repeated near-threshold activity as possible structuring.`,
      meta: { count: nearMisses.length, amounts: nearMisses.map((r) => num(r.amount)) },
    });
  }
}
