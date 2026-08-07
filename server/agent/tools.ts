/**
 * Read tools.
 *
 * The agent answers only from what these return. It is told, and the system
 * prompt repeats, that any figure it states must have come back from a tool —
 * "I can't see that" is the correct answer when none applies.
 *
 * That rule is load-bearing for this business specifically. The investor pitch
 * rests on numbers being verifiable on-chain; an agent that occasionally
 * invents revenue is worse than no agent at all.
 *
 * Every tool here is read-only by construction. There is no write tool, no
 * signing tool, no transfer tool, and no tool that changes contract
 * parameters — see docs/agent-design.md §3. Capability is the tool list, not
 * the prompt, because the prompt is reachable by anyone who can get text in
 * front of the model.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  hedgeEvents, hedgeActivity, platformFees, userAccounts, wallets, articles,
  hedgePositions, hedgeLpDeposits,
} from "@shared/schema";
import { loiDocuments } from "@shared/loi-schema";
import { kycSubmissions, complianceAlerts, sanctionsScreenings } from "@shared/compliance-schema";
import type { AgentScope } from "@shared/agent-schema";

/**
 * Who the caller is, resolved by the auth layer.
 *
 * This never comes from the model. It is threaded from the verified session
 * into the executor, which is the whole reason a customer cannot ask about
 * somebody else's account: there is no parameter to put another wallet in.
 */
export interface Identity {
  walletAddress?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Which agent may call it. Enforced in runTool, not by prompt. */
  scopes: AgentScope[];
  /** `identity` is server-supplied. Customer tools must use it, never input. */
  run: (input: any, identity: Identity) => Promise<unknown>;
}

const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Converts a period keyword into a cutoff date, or null for all time. */
function since(period?: string): Date | null {
  const now = Date.now();
  switch (period) {
    case "today": return new Date(now - 86_400_000);
    case "week": return new Date(now - 7 * 86_400_000);
    case "month": return new Date(now - 30 * 86_400_000);
    case "quarter": return new Date(now - 90 * 86_400_000);
    case "year": return new Date(now - 365 * 86_400_000);
    default: return null;
  }
}

const PERIOD_PROP = {
  type: "string",
  enum: ["today", "week", "month", "quarter", "year", "all"],
  description: "Time window. Defaults to all time.",
};

// ── Tools ────────────────────────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  {
    name: "get_revenue",
    description:
      "All platform revenue, in two streams that are collected quite differently:\n" +
      "  · transfer fees — wallet-to-wallet sends, recorded in the platform_fees ledger\n" +
      "  · protocol fees — a share of the premium paid on every protection purchase, collected on-chain\n" +
      "Use this for any question about revenue, take rate, or what the platform has earned.",
    input_schema: { type: "object", properties: { period: PERIOD_PROP } },
    scopes: ["internal"],
    run: async ({ period }) => {
      const cutoff = since(period);

      const [transfers] = await db
        .select({
          totalFees: sql<string>`coalesce(sum(fee_amount::numeric), 0)::text`,
          totalVolume: sql<string>`coalesce(sum(transfer_amount::numeric), 0)::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(platformFees)
        .where(cutoff ? gte(platformFees.createdAt, cutoff) : sql`true`);

      // Protocol fees never touch platform_fees — they are taken on-chain at
      // purchase. Reconstructing them from the activity log and each pool's
      // premium rate is what stops the agent reading a $0 transfer-fee total
      // as "we earned nothing", which is a materially wrong conclusion.
      const purchases = await db
        .select()
        .from(hedgeActivity)
        .where(
          and(
            eq(hedgeActivity.actionType, "buy_protection"),
            cutoff ? gte(hedgeActivity.createdAt, cutoff) : sql`true`,
          ),
        );
      const pools = await db.select().from(hedgeEvents);

      let notional = 0;
      let premiums = 0;
      for (const p of purchases) {
        const amt = num(p.amount);
        notional += amt;
        const pool = pools.find(
          (e) => e.onChainEventId === p.onChainEventId && e.chainId === p.chainId,
        );
        if (pool) premiums += amt * num(pool.premiumRate);
      }
      // The protocol takes 5% of premium (changed from a notional basis in
      // August 2026 — see the HedgeFacet upgrade).
      const protocolFees = premiums * 0.05;

      return {
        period: period ?? "all",
        transferFeesUsd: num(transfers.totalFees).toFixed(2),
        transferVolumeUsd: num(transfers.totalVolume).toFixed(2),
        feeBearingTransfers: transfers.count,
        protectionPurchases: purchases.length,
        notionalProtectedUsd: notional.toFixed(2),
        premiumsPaidUsd: premiums.toFixed(2),
        protocolFeesUsd: protocolFees.toFixed(2),
        totalRevenueUsd: (num(transfers.totalFees) + protocolFees).toFixed(2),
        note:
          "Protocol fees are derived from purchase amounts and each pool's premium rate at 5% of premium. " +
          "Pool creation fees ($25 on Base, $2 on BSC per pool) are not included here.",
      };
    },
  },

  {
    name: "get_traction",
    description:
      "The headline traction figures shown to investors: pool counts, notional protected, liquidity " +
      "underwritten, premiums collected, and signed agreements. Use this for 'how are we doing' questions.",
    input_schema: { type: "object", properties: {} },
    scopes: ["internal"],
    run: async () => {
      const pools = await db.select({ status: hedgeEvents.status }).from(hedgeEvents);
      const agg = await db
        .select({
          notional: sql<string>`coalesce(sum(case when action_type = 'buy_protection' then amount::numeric else 0 end), 0)::text`,
          liquidity: sql<string>`coalesce(sum(case when action_type = 'deposit' then amount::numeric else 0 end), 0)::text`,
          rows: sql<number>`count(*)::int`,
        })
        .from(hedgeActivity);
      const signed = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(loiDocuments)
        .where(eq(loiDocuments.status, "signed"));

      return {
        pools: {
          total: pools.length,
          open: pools.filter((p) => p.status === "open").length,
          settled: pools.filter((p) => p.status === "settled").length,
          expired: pools.filter((p) => p.status === "expired").length,
        },
        notionalProtectedUsd: num(agg[0].notional).toFixed(2),
        liquidityUnderwrittenUsd: num(agg[0].liquidity).toFixed(2),
        onChainTransactions: agg[0].rows,
        signedAgreements: signed[0]?.n ?? 0,
      };
    },
  },

  {
    name: "get_pools",
    description:
      "Hedge pools (also called events): pair, strike, premium rate, expiry and status. " +
      "Use to answer questions about what cover is available or which pools are open.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "settled", "expired", "all"] },
        limit: { type: "number", description: "Default 20, max 100." },
      },
    },
    scopes: ["internal"],
    run: async ({ status, limit }) => {
      const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
      let rows = await db.select().from(hedgeEvents).orderBy(desc(hedgeEvents.id)).limit(200);
      if (status && status !== "all") rows = rows.filter((r) => r.status === status);
      return rows.slice(0, take).map((r) => ({
        id: r.id,
        chainId: r.chainId,
        onChainEventId: r.onChainEventId,
        name: r.name,
        pair: r.underlying,
        strike: r.strike,
        premiumRate: r.premiumRate,
        payoutRate: r.payoutRate,
        status: r.status,
        expiryDate: r.expiryDate,
        createdBy: r.createdBy,
      }));
    },
  },

  {
    name: "get_agreements",
    description:
      "Letters of intent and other agreements: counterparty, relationship, status, and dates sent, " +
      "viewed and signed. Use for questions about the deal pipeline or which letters have gone quiet.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "sent", "viewed", "changes_requested", "awaiting_signature", "signed", "declined", "expired", "all"],
        },
        limit: { type: "number", description: "Default 25, max 100." },
      },
    },
    scopes: ["internal"],
    run: async ({ status, limit }) => {
      const take = Math.min(Math.max(Number(limit) || 25, 1), 100);
      let rows = await db.select().from(loiDocuments).orderBy(desc(loiDocuments.lastActivityAt)).limit(200);
      if (status && status !== "all") rows = rows.filter((r) => r.status === status);
      return rows.slice(0, take).map((r) => ({
        id: r.id,
        reference: r.publicId,
        counterparty: r.recipientCompany,
        contact: r.recipientName,
        relationship: r.relationshipType,
        docType: r.docType,
        status: r.status,
        sentAt: r.sentAt,
        firstViewedAt: r.firstViewedAt,
        signedAt: r.signedAt,
        expiresAt: r.expiresAt,
        daysSinceSent: r.sentAt ? Math.floor((Date.now() - new Date(r.sentAt).getTime()) / 86_400_000) : null,
      }));
    },
  },

  {
    name: "get_compliance_queue",
    description:
      "Verification requests waiting for review, and open compliance alerts. Use for any question about " +
      "whether there is a queue, what needs attention, or the state of KYC and sanctions screening. " +
      "Alerts open more than 24 hours are overdue against the review window the AML policy commits to.",
    input_schema: { type: "object", properties: {} },
    scopes: ["internal"],
    run: async () => {
      const subs = await db.select().from(kycSubmissions);
      const alerts = await db.select().from(complianceAlerts);
      const screens = await db.select().from(sanctionsScreenings);

      const waiting = subs.filter((s) => s.status === "submitted" || s.status === "in_review");
      const open = alerts.filter((a) => a.status === "open");
      const overdue = open.filter(
        (a) => a.openedAt && Date.now() - new Date(a.openedAt).getTime() > 86_400_000,
      );

      const age = (d: Date | string | null) =>
        d ? Math.floor((Date.now() - new Date(d).getTime()) / 3_600_000) : 0;

      return {
        verificationsWaiting: waiting.length,
        oldestWaitingHours: waiting.length ? Math.max(...waiting.map((s) => age(s.submittedAt))) : 0,
        waiting: waiting.slice(0, 10).map((s) => ({
          name: s.fullName || s.companyName,
          requestedTier: s.requestedTier,
          entityType: s.entityType,
          status: s.status,
          isPep: s.isPep,
          hoursWaiting: age(s.submittedAt),
        })),
        alertsOpen: open.length,
        alertsOverdue: overdue.length,
        alerts: open.slice(0, 10).map((a) => ({
          kind: a.kind,
          severity: a.severity,
          title: a.title,
          hoursOpen: age(a.openedAt),
          overdue: age(a.openedAt) > 24,
        })),
        screeningsRun: screens.length,
        screeningHits: screens.filter((s) => s.matched).length,
        reviewWindowHours: 24,
      };
    },
  },

  {
    name: "get_activity",
    description:
      "Recent on-chain protocol activity: pool creations, LP deposits, protection purchases, claims and " +
      "settlements, with transaction hashes.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 20, max 100." },
        actionType: {
          type: "string",
          enum: ["create_event", "deposit", "withdraw", "buy_protection", "claim", "settle", "all"],
        },
      },
    },
    scopes: ["internal"],
    run: async ({ limit, actionType }) => {
      const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
      let rows = await db.select().from(hedgeActivity).orderBy(desc(hedgeActivity.id)).limit(200);
      if (actionType && actionType !== "all") rows = rows.filter((r) => r.actionType === actionType);
      return rows.slice(0, take).map((r) => ({
        txHash: r.txHash,
        chainId: r.chainId,
        action: r.actionType,
        amount: r.amount,
        token: r.token,
        wallet: r.walletAddress,
        blockNumber: r.blockNumber,
        createdAt: r.createdAt,
      }));
    },
  },

  {
    name: "get_users",
    description: "User and wallet counts, optionally within a period. Use for growth questions.",
    input_schema: { type: "object", properties: { period: PERIOD_PROP } },
    scopes: ["internal"],
    run: async ({ period }) => {
      const cutoff = since(period);
      const users = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(userAccounts)
        .where(cutoff ? gte(userAccounts.createdAt, cutoff) : sql`true`);
      const wal = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(wallets)
        .where(cutoff ? gte(wallets.createdAt, cutoff) : sql`true`);
      return { period: period ?? "all", userAccounts: users[0]?.n ?? 0, wallets: wal[0]?.n ?? 0 };
    },
  },

  {
    name: "search_articles",
    description:
      "Search published articles and academy lessons by keyword. Use to answer product and education " +
      "questions, and to cite what has already been written.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Keywords to match on title or subtitle." } },
      required: ["query"],
    },
    // The only tool both agents share — it reads published, already-public content.
    scopes: ["internal", "public"],
    run: async ({ query }) => {
      const q = String(query || "").toLowerCase().slice(0, 200);
      const rows = await db.select().from(articles).where(eq(articles.published, true)).limit(200);
      const hits = rows.filter(
        (r) =>
          r.title?.toLowerCase().includes(q) ||
          r.subtitle?.toLowerCase().includes(q) ||
          r.category?.toLowerCase().includes(q),
      );
      return hits.slice(0, 8).map((r) => ({
        slug: r.slug,
        title: r.title,
        subtitle: r.subtitle,
        category: r.category,
        url: `/blog/${r.slug}`,
      }));
    },
  },


  // ── Customer tools ──────────────────────────────────────────────────────
  //
  // Every one is scoped to the caller's own wallet, taken from the verified
  // session. Note what these input schemas do NOT contain: an address, a user
  // id, an email. There is deliberately no way to express "somebody else", so
  // no instruction — however phrased, by whoever wrote it — reaches another
  // customer's data.

  {
    name: "get_my_cover",
    description:
      "The signed-in customer's own protection positions: how much cover they bought, what they paid, " +
      "the pool it sits in, and whether it has settled or paid out.",
    input_schema: { type: "object", properties: {} },
    scopes: ["customer"],
    run: async (_input, identity) => {
      if (!identity.walletAddress) return { error: "Not signed in." };
      const rows = await db
        .select()
        .from(hedgePositions)
        .where(sql`lower(${hedgePositions.hedgerWallet}) = ${identity.walletAddress.toLowerCase()}`);
      const pools = await db.select().from(hedgeEvents);
      return rows.map((r) => {
        const pool = pools.find((e) => e.id === r.eventId);
        return {
          positionId: r.id,
          pair: pool?.underlying ?? null,
          poolName: pool?.name ?? null,
          notionalUsd: r.notional,
          premiumPaidUsd: r.premiumPaid,
          maxPayoutUsd: r.maxPayout,
          payoutReceivedUsd: r.payoutAmount,
          claimed: r.claimed,
          status: r.status,
          expiryDate: pool?.expiryDate ?? null,
          boughtAt: r.createdAt,
        };
      });
    },
  },

  {
    name: "get_my_deposits",
    description:
      "The signed-in customer's own liquidity deposits: how much they put in, premiums earned, " +
      "and whether it has been withdrawn.",
    input_schema: { type: "object", properties: {} },
    scopes: ["customer"],
    run: async (_input, identity) => {
      if (!identity.walletAddress) return { error: "Not signed in." };
      const rows = await db
        .select()
        .from(hedgeLpDeposits)
        .where(sql`lower(${hedgeLpDeposits.lpWallet}) = ${identity.walletAddress.toLowerCase()}`);
      const pools = await db.select().from(hedgeEvents);
      return rows.map((r) => {
        const pool = pools.find((e) => e.id === r.eventId);
        return {
          depositId: r.id,
          pair: pool?.underlying ?? null,
          poolName: pool?.name ?? null,
          amountUsd: r.amount,
          premiumsEarnedUsd: r.premiumsEarned,
          premiumsWithdrawnUsd: r.premiumsWithdrawn,
          withdrawn: r.withdrawn,
          poolStatus: pool?.status ?? null,
          expiryDate: pool?.expiryDate ?? null,
          depositedAt: r.createdAt,
        };
      });
    },
  },

  {
    name: "get_my_activity",
    description:
      "The signed-in customer's own recent transactions, with hashes they can check on the explorer.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 20, max 50." } },
    },
    scopes: ["customer"],
    run: async ({ limit }, identity) => {
      if (!identity.walletAddress) return { error: "Not signed in." };
      const take = Math.min(Math.max(Number(limit) || 20, 1), 50);
      const rows = await db
        .select()
        .from(hedgeActivity)
        .where(sql`lower(${hedgeActivity.walletAddress}) = ${identity.walletAddress.toLowerCase()}`)
        .orderBy(desc(hedgeActivity.id))
        .limit(take);
      return rows.map((r) => ({
        action: r.actionType,
        amount: r.amount,
        token: r.token,
        txHash: r.txHash,
        chainId: r.chainId,
        status: r.status,
        at: r.createdAt,
      }));
    },
  },

  {
    name: "get_available_cover",
    description:
      "Pools currently open for buying protection, with pair, strike, premium rate and expiry. " +
      "Answers 'what cover can I buy' — public product information, not anyone's account.",
    input_schema: { type: "object", properties: {} },
    scopes: ["customer", "public"],
    run: async () => {
      const rows = await db.select().from(hedgeEvents).where(eq(hedgeEvents.status, "open"));
      return rows.map((r) => ({
        pair: r.underlying,
        poolName: r.name,
        strike: r.strike,
        premiumRatePercent: (num(r.premiumRate) * 100).toFixed(2),
        payoutRatePercent: (num(r.payoutRate) * 100).toFixed(2),
        expiryDate: r.expiryDate,
        chainId: r.chainId,
      }));
    },
  },
];

/** Tools visible to a given agent. The public agent gets a strict subset. */
export function toolsFor(scope: AgentScope): ToolDef[] {
  return TOOLS.filter((t) => t.scopes.includes(scope));
}

/** Anthropic tool definitions — the `run` function is stripped. */
export function toolSchemasFor(scope: AgentScope) {
  return toolsFor(scope).map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

/**
 * Executes a tool by name, refusing anything outside the caller's scope.
 * The scope check is here rather than at the call site so a future caller
 * cannot forget it.
 */
export async function runTool(
  scope: AgentScope,
  name: string,
  input: unknown,
  identity: Identity = {},
): Promise<unknown> {
  const tool = toolsFor(scope).find((t) => t.name === name);
  if (!tool) return { error: `No tool named ${name} is available.` };
  // Belt and braces: a customer tool without a resolved wallet must fail
  // closed rather than fall through to an unfiltered query.
  if (scope === "customer" && !identity.walletAddress) {
    return { error: "Not signed in — no account is attached to this conversation." };
  }
  try {
    return await tool.run(input ?? {}, identity);
  } catch (err: any) {
    // Return the failure to the model rather than throwing: it can then tell
    // the user it couldn't read something, which beats a dead conversation.
    return { error: `Tool ${name} failed: ${err?.message ?? "unknown error"}` };
  }
}
