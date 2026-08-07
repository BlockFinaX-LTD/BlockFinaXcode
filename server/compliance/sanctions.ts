/**
 * Sanctions screening.
 *
 * Policy §5 commits BlockFinaX to screening every user and counterparty
 * against the UN Consolidated list, OFAC, the EU Consolidated list and the
 * Ghana FIC designations, at onboarding and on an ongoing basis.
 *
 * OpenSanctions aggregates all four lists and was the first choice, but its
 * API now requires a paid key. So the default is lists.ts, which fetches OFAC
 * SDN and the UN Consolidated List straight from the issuing authorities —
 * public domain, no key, no licence. Set OPENSANCTIONS_API_KEY and that is
 * preferred instead, which also brings in the EU and Ghana FIC lists.
 *
 * The EU and Ghana FIC lists are NOT covered by the free path. That gap is
 * reported in every result rather than left implied: a control you believe you
 * have and do not is worse than a gap you have written down.
 *
 * Three deliberate choices:
 *
 *   A match never auto-rejects. Name screening produces false positives at a
 *   rate that would otherwise lock out real customers over a coincidence of
 *   spelling — and the decision to refuse someone service on sanctions grounds
 *   should be a person's, recorded, with a reason. Screening raises an alert
 *   and blocks the tier upgrade; a human resolves it.
 *
 *   Every screen is recorded, including the clean ones. "Ongoing screening"
 *   is only demonstrable to a supervisor as a history of screens that found
 *   nothing.
 *
 *   A screening failure is not a pass. If the service is unreachable the
 *   result is `inconclusive`, which holds the application rather than
 *   approving it — the opposite would mean an outage silently disables the
 *   control.
 */

import { db } from "../db";
import { sanctionsScreenings, type SanctionMatch } from "@shared/compliance-schema";
import { raiseAlert } from "./limits";

import { matchName, matchWallet, listStatus } from "./lists";

const API = "https://api.opensanctions.org/match/default";
const API_KEY = (process.env.OPENSANCTIONS_API_KEY || "").trim();

/** Above this, a name is treated as a probable hit and held for review. */
const MATCH_THRESHOLD = 0.7;

export interface ScreeningResult {
  status: "clear" | "hit" | "inconclusive";
  topScore: number;
  matches: SanctionMatch[];
  error?: string;
  /** Which lists this result actually covers. Never assume it is all four. */
  coverage?: string[];
}

/** Lists the free path does not reach, so callers can say so plainly. */
export const UNCOVERED_FREE = ["EU Consolidated", "Ghana FIC"];

export async function screeningCoverage() {
  const status = await listStatus();
  return {
    provider: (process.env.OPENSANCTIONS_API_KEY || "").trim() ? "opensanctions" : "direct",
    sources: status.sources,
    loadedAt: status.loadedAt,
    notCovered: (process.env.OPENSANCTIONS_API_KEY || "").trim() ? [] : UNCOVERED_FREE,
  };
}

/**
 * Screens a person or company name.
 *
 * `country` and `birthDate` are passed when known — they are what separate a
 * genuine match from someone who happens to share a name with a sanctioned
 * individual, and omitting them makes the result far noisier.
 */
export async function screenName(args: {
  name: string;
  country?: string | null;
  birthDate?: string | null;
  entityType?: "individual" | "business";
  walletAddress?: string;
  submissionId?: number;
}): Promise<ScreeningResult> {
  const name = args.name.trim();
  if (!name) return { status: "inconclusive", topScore: 0, matches: [], error: "No name given." };

  const properties: Record<string, string[]> = { name: [name] };
  if (args.country) properties.country = [args.country];
  if (args.birthDate) properties.birthDate = [args.birthDate];

  let result: ScreeningResult;
  try {
    if (!API_KEY) {
      // Free path: OFAC SDN + UN, matched locally.
      const { matches: local, sources } = await matchName(name, MATCH_THRESHOLD);
      const failed = sources.filter((s) => s.error);
      const matches: SanctionMatch[] = local.map((m) => ({
        name: m.matchedOn === m.name ? m.name : `${m.name} (alias: ${m.matchedOn})`,
        score: m.score,
        datasets: [m.list, m.program].filter(Boolean) as string[],
        topics: m.type ? [m.type] : [],
        country: m.country,
        id: m.id,
      }));
      const topScore = matches[0]?.score ?? 0;
      result = {
        // A list that failed to load means we cannot say "clear" honestly.
        status: matches.length ? "hit" : failed.length ? "inconclusive" : "clear",
        topScore,
        matches,
        error: failed.length ? `Could not load: ${failed.map((f) => f.list).join(", ")}` : undefined,
        coverage: sources.filter((s) => !s.error).map((s) => s.list),
      };
      await record({ ...args, subjectType: "name", subject: name, result });
      return result;
    }

    const res = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `ApiKey ${API_KEY}`,
      },
      body: JSON.stringify({
        queries: {
          subject: {
            schema: args.entityType === "business" ? "Company" : "Person",
            properties,
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) throw new Error(`OpenSanctions returned ${res.status}`);

    const body = await res.json();
    const results = body?.responses?.subject?.results ?? [];
    const matches: SanctionMatch[] = results
      .map((r: any) => ({
        name: r.caption ?? "(unnamed)",
        score: Number(r.score ?? 0),
        datasets: Array.isArray(r.datasets) ? r.datasets : [],
        topics: Array.isArray(r.properties?.topics) ? r.properties.topics : [],
        country: Array.isArray(r.properties?.country) ? r.properties.country[0] : undefined,
        id: r.id,
      }))
      .filter((m: SanctionMatch) => m.score > 0.5)
      .sort((a: SanctionMatch, b: SanctionMatch) => b.score - a.score)
      .slice(0, 10);

    const topScore = matches[0]?.score ?? 0;
    result = {
      status: topScore >= MATCH_THRESHOLD ? "hit" : "clear",
      topScore,
      matches,
      coverage: ["OFAC", "UN", "EU Consolidated", "Ghana FIC"],
    };
  } catch (err: any) {
    // Unreachable is not clean. Holding the application is the safe failure.
    result = {
      status: "inconclusive",
      topScore: 0,
      matches: [],
      error: err?.name === "TimeoutError" ? "Screening timed out." : String(err?.message || err),
    };
  }

  await record({ ...args, subjectType: "name", subject: name, result });
  return result;
}

/**
 * Screens a wallet address.
 *
 * OpenSanctions carries addresses designated by OFAC, which covers the
 * published cases. It is not a substitute for a blockchain analytics provider
 * — Chainalysis or TRM trace exposure through intermediary hops, which this
 * cannot see. Worth adding before volume justifies the cost.
 */
export async function screenWallet(walletAddress: string): Promise<ScreeningResult> {
  const address = walletAddress.trim();
  if (!address) return { status: "inconclusive", topScore: 0, matches: [], error: "No address given." };

  let result: ScreeningResult;
  try {
    if (!API_KEY) {
      const { matches: local, sources } = await matchWallet(address);
      const failed = sources.filter((s) => s.error);
      result = {
        status: local.length ? "hit" : failed.length ? "inconclusive" : "clear",
        topScore: local.length ? 1 : 0,
        matches: local.map((m) => ({
          name: m.name,
          score: 1,
          datasets: [m.list, m.program].filter(Boolean) as string[],
          topics: m.type ? [m.type] : [],
          country: m.country,
          id: m.id,
        })),
        error: failed.length ? `Could not load: ${failed.map((f) => f.list).join(", ")}` : undefined,
        coverage: sources.filter((s) => !s.error).map((s) => s.list),
      };
      await record({ subjectType: "wallet", subject: address, walletAddress: address, result });
      return result;
    }

    const res = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `ApiKey ${API_KEY}`,
      },
      body: JSON.stringify({
        queries: { subject: { schema: "CryptoWallet", properties: { publicKey: [address] } } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`OpenSanctions returned ${res.status}`);

    const body = await res.json();
    const results = body?.responses?.subject?.results ?? [];
    const matches: SanctionMatch[] = results
      .map((r: any) => ({
        name: r.caption ?? address,
        score: Number(r.score ?? 0),
        datasets: Array.isArray(r.datasets) ? r.datasets : [],
        topics: Array.isArray(r.properties?.topics) ? r.properties.topics : [],
        id: r.id,
      }))
      // An address either is designated or is not — a near miss on a hex
      // string means nothing, so the bar is high.
      .filter((m: SanctionMatch) => m.score >= 0.9);

    result = {
      status: matches.length ? "hit" : "clear",
      topScore: matches[0]?.score ?? 0,
      matches,
    };
  } catch (err: any) {
    result = { status: "inconclusive", topScore: 0, matches: [], error: String(err?.message || err) };
  }

  await record({ subjectType: "wallet", subject: address, walletAddress: address, result });
  return result;
}

async function record(args: {
  subjectType: string;
  subject: string;
  walletAddress?: string;
  submissionId?: number;
  result: ScreeningResult;
}): Promise<void> {
  try {
    await db.insert(sanctionsScreenings).values({
      subjectType: args.subjectType,
      subject: args.subject.slice(0, 500),
      walletAddress: args.walletAddress?.toLowerCase(),
      submissionId: args.submissionId,
      matched: args.result.status === "hit",
      topScore: args.result.topScore,
      matches: args.result.matches,
      error: args.result.error,
    });
  } catch (err: any) {
    console.error("[sanctions] could not record screening:", err?.message);
  }

  if (args.result.status === "hit") {
    const top = args.result.matches[0];
    await raiseAlert({
      kind: "sanctions_hit",
      severity: "high",
      walletAddress: args.walletAddress,
      title: `Possible sanctions match: ${args.subject}`,
      detail:
        `Matched "${top?.name}" at ${Math.round((top?.score ?? 0) * 100)}% on ` +
        `${top?.datasets?.join(", ") || "an unnamed list"}. ` +
        `Policy §5 requires review before this account transacts. Confirm or clear it — do not leave it open.`,
      meta: { matches: args.result.matches, subjectType: args.subjectType },
    });
  }
}

/**
 * Re-screens everyone approved, for the "ongoing basis" in policy §5.
 *
 * Designations change; a customer clear at onboarding may not stay clear.
 * Sequential and paced rather than parallel — this runs unattended against a
 * free service, and hammering it would get the platform rate-limited out of
 * its own control.
 */
export async function rescreenApproved(limit = 50): Promise<{ screened: number; hits: number }> {
  const { kycSubmissions } = await import("@shared/compliance-schema");
  const { eq } = await import("drizzle-orm");

  const rows = await db
    .select()
    .from(kycSubmissions)
    .where(eq(kycSubmissions.status, "approved"))
    .limit(limit);

  let hits = 0;
  for (const row of rows) {
    if (!row.fullName) continue;
    const r = await screenName({
      name: row.fullName,
      country: row.country,
      birthDate: row.dateOfBirth,
      entityType: row.entityType as "individual" | "business",
      walletAddress: row.walletAddress,
      submissionId: row.id,
    });
    if (r.status === "hit") hits += 1;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return { screened: rows.length, hits };
}
