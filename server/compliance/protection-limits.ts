/**
 * Verification limits for the Stellar app (policy §3.1), measured from the user's own
 * contracts rather than the earlier app's tables.
 *
 * Two measures, over a rolling window, as the policy requires:
 *   money moved       premiums and fees paid for protection, plus underwriting deposits
 *   payout exposure   the most the user's active protection could pay out
 *
 * Enforced on mainnet. Testnet does not enforce unless REQUIRE_VERIFICATION=true (for
 * trying the flow); REQUIRE_VERIFICATION=false turns it off anywhere.
 */
import { KYC_TIERS, LIMIT_WINDOW_DAYS, tierFor } from "@shared/compliance-schema";
import type { ProtectionPosition } from "@shared/domain/types";

export function verificationRequired(env: NodeJS.ProcessEnv = process.env, environment?: string): boolean {
  if (env.REQUIRE_VERIFICATION === "true") return true;
  if (env.REQUIRE_VERIFICATION === "false") return false;
  return environment === "mainnet";
}

export interface LimitDecision {
  allowed: boolean;
  tier: number;
  /** The lowest tier that would allow it, when the current one does not. */
  requiredTier?: number;
  reason?: string;
  cashMovedUsd: number;
  payoutExposureUsd: number;
}

/**
 * Whether a new purchase or deposit stays inside the user's tier.
 * `addsCashUsd`: what this action moves (a purchase's total cost, or a deposit).
 * `addsExposureUsd`: a purchase's maximum payout (0 for deposits).
 */
export function checkProtectionLimits(a: {
  tier: number;
  positions: Pick<ProtectionPosition, "createdAt" | "premium" | "fee" | "maxPayout" | "status">[];
  addsCashUsd: number;
  addsExposureUsd: number;
  nowSec?: number;
}): LimitDecision {
  const now = a.nowSec ?? Math.floor(Date.now() / 1000);
  const since = now - LIMIT_WINDOW_DAYS * 86_400;
  const cashMoved = a.positions.filter((p) => p.createdAt >= since).reduce((s, p) => s + Number(p.premium) + Number(p.fee), 0);
  const exposure = a.positions.filter((p) => p.status === "active").reduce((s, p) => s + Number(p.maxPayout), 0);
  const cashAfter = cashMoved + a.addsCashUsd;
  const exposureAfter = exposure + a.addsExposureUsd;
  const base = { tier: a.tier, cashMovedUsd: cashMoved, payoutExposureUsd: exposure };
  const needed = KYC_TIERS.find((t) => t.tier > 0 && cashAfter <= t.cashMovedUsd && exposureAfter <= t.payoutExposureUsd)?.tier ?? 3;

  if (a.tier === 0) {
    return { ...base, allowed: false, requiredTier: needed, reason: "Verify your identity before your first purchase or deposit." };
  }
  const def = tierFor(a.tier);
  if (cashAfter > def.cashMovedUsd) {
    return {
      ...base, allowed: false, requiredTier: Math.max(needed, a.tier + 1),
      reason: `This would take you to $${cashAfter.toFixed(2)} moved in ${LIMIT_WINDOW_DAYS} days, above the $${def.cashMovedUsd.toLocaleString()} limit for ${def.name} verification.`,
    };
  }
  if (exposureAfter > def.payoutExposureUsd) {
    return {
      ...base, allowed: false, requiredTier: Math.max(needed, a.tier + 1),
      reason: `This would take your total possible payout to $${exposureAfter.toFixed(2)}, above the $${def.payoutExposureUsd.toLocaleString()} limit for ${def.name} verification.`,
    };
  }
  return { ...base, allowed: true };
}

/**
 * The verified tier recorded for this account (keyed by its EVM smart account, as submissions
 * are). Read as stored: an upgrade under review keeps the earlier tier, a rejection sets 0.
 */
export async function verifiedTier(evmAddress: string): Promise<number> {
  const { db } = await import("../db");
  const { userProfiles } = await import("@shared/profile-schema");
  const { sql } = await import("drizzle-orm");
  const [profile] = await db.select().from(userProfiles)
    .where(sql`lower(${userProfiles.walletAddress}) = ${evmAddress.toLowerCase()}`).limit(1);
  return profile?.kycTier ?? 0;
}
