/**
 * Connector portal endpoints (see ./service.ts for storage, ./logic.ts for the rules).
 *
 * Members (signed-in BlockFinaX account):
 *   GET  /api/v2/connectors/me                       membership, agreement, training, what is missing
 *   POST /api/v2/connectors/apply                    apply, or update the profile
 *   POST /api/v2/connectors/sign                     accept the programme terms (tick box), once accepted
 *   POST /api/v2/connectors/lessons/:id              submit quiz answers for a module
 *   GET  /api/v2/connectors/registrations            my registrations
 *   POST /api/v2/connectors/registrations            register a prospect or opportunity
 *   GET  /api/v2/connectors/referrals                users who joined through my link, and their progress
 *   GET  /api/v2/connectors/rewards                  ledger, quarterly statement, estimates
 *   POST /api/v2/connectors/payout                   where rewards are paid
 *   GET  /api/v2/connectors/engagements              contractor work offers
 *   POST /api/v2/connectors/engagements/:id/accept   accept an engagement (tick box)
 *   POST /api/v2/connectors/engagements/:id/decline
 *   GET  /api/v2/connectors/offers                   open offers for my kind, and my responses
 *   POST /api/v2/connectors/offers/:id/respond       say I am interested, with a note
 *   POST /api/v2/connectors/offers/:id/withdraw
 *   POST /api/v2/connectors/finax                    ask Finax, with this member's own brief
 *   GET  /api/v2/connectors/finax/:threadId          the conversation so far
 * Any signed-in user:
 *   POST /api/v2/connectors/attribute                credit a new account to a referral code
 * Admin (x-admin-token):
 *   GET  /api/v2/admin/connectors                    members with counts
 *   GET  /api/v2/admin/connectors/:userId            everything about one member
 *   POST /api/v2/admin/connectors/:userId/status     approve, pause, end or decline
 *   POST /api/v2/admin/connectors/:userId/ledger     record a reward line or a payment
 *   POST /api/v2/admin/connectors/:userId/engagements offer a contractor engagement
 *   GET  /api/v2/admin/connector-registrations       the registration queue
 *   POST /api/v2/admin/connector-registrations/:id/decide
 *   POST /api/v2/admin/connector-engagements/:id/status
 *   GET  /api/v2/admin/connector-offers              offers with their responses
 *   POST /api/v2/admin/connector-offers              post an offer (optionally email matching members)
 *   POST /api/v2/admin/connector-offers/:id/status   open or closed
 *   POST /api/v2/admin/connector-offers/:id/responses/:userId  selected or not_selected
 */
import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db as appDb } from "../db";
import { agentMessages, chatSchema } from "@shared/agent-schema";
import { agentConfigured, fence, runAgent } from "../agent/runtime";
import { connectorBrief } from "./finax";
import { getOnboarding } from "../onboarding/service";
import { ApplicationError } from "@shared/domain/types";
import {
  AGREEMENTS, MODULES, areaByKey, moduleById,
  type DocumentKind, type LedgerKind, type MemberKind, type MemberStatus, type RegistrationStatus,
} from "@shared/connector-programme";
import { requireAdmin } from "../middleware/admin-auth";
import { chainRegistry } from "../chain/config";
import {
  findConflict, isReferralCode, missingSteps, newReferralCode, orgDomain, orgKey, quarterOf, referralRevenue,
  round2, scoreModule, statement, type FeePosition,
} from "./logic";
import {
  agreementHash, connectorDb, engagementText, getMember, hasCurrentSignature, newId, notifyAdmins, notifyMember,
  passedModules, screenMember, sha256, signedDocuments, signingPolicy, type ConnectorRow,
} from "./service";

type Handler = (req: Request, res: Response) => Promise<void>;
interface Deps {
  getServices: () => Promise<any>;
  userId: (req: Request) => Promise<number>;
  wrap: (h: Handler) => any;
}

const bad = (msg: string) => new ApplicationError("INVALID_REQUEST", msg);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
const environment = () => chainRegistry()?.config.environment;
const MEMBER_KINDS: MemberKind[] = ["connector", "contractor"];
const LEDGER_KINDS: LedgerKind[] = ["revenue_share", "bonus", "fundraising", "engagement_fee", "adjustment", "payment"];
const QUARTER = /^\d{4}-Q[1-4]$/;

const docFor = (m: ConnectorRow): DocumentKind => (m.kind === "contractor" ? "contractor" : "connector");

/** The referral link a member shares. */
export function referralLink(code: string) {
  const base = (process.env.PUBLIC_APP_URL || "https://www.blockfinax.com").replace(/\/$/, "");
  return `${base}/auth?ref=${code}`;
}

async function readiness(userId: number, m: ConnectorRow | null) {
  if (!m) return { signed: false, passed: [] as string[], missing: missingSteps({ status: "none", agreementSigned: false, modulesPassed: [], screening: "pending" }) };
  const [signed, passed] = await Promise.all([hasCurrentSignature(userId, docFor(m)), passedModules(userId)]);
  return { signed, passed, missing: missingSteps({ status: m.status, agreementSigned: signed, modulesPassed: passed, screening: m.screening_status }) };
}

function memberView(m: ConnectorRow) {
  return {
    kind: m.kind, fullName: m.full_name, organisation: m.organisation, country: m.country, email: m.email, phone: m.phone,
    markets: m.markets, areas: m.areas, about: m.about, status: m.status, payoutDetails: m.payout_details,
    joinedAt: m.created_at.toISOString(), decidedAt: m.decided_at?.toISOString() ?? null,
  };
}

function registrationView(r: any, forAdmin = false) {
  return {
    id: r.id, area: r.area, organisation: r.organisation, website: r.website, contactName: r.contact_name, contactRole: r.contact_role,
    contactEmail: r.contact_email, country: r.country, need: r.need, status: r.status as RegistrationStatus, rewardTerms: r.reward_terms,
    bonusUsd: r.bonus_usd === null ? null : Number(r.bonus_usd), countsForReview: r.counts_for_review,
    periodStart: r.period_start?.toISOString?.() ?? null, periodEnd: r.period_end?.toISOString?.() ?? null,
    decisionNote: r.decision_note, decidedAt: r.decided_at?.toISOString?.() ?? null, createdAt: r.created_at.toISOString(),
    ...(forAdmin ? { userId: r.user_id, conflictWith: r.conflict_with, memberName: r.member_name, decidedBy: r.decided_by } : {}),
  };
}

function offerView(o: any) {
  return {
    id: o.id, title: o.title, summary: o.summary, details: o.details, area: o.area, country: o.country, audience: o.audience,
    reward: o.reward, closesOn: o.closes_on ? new Date(o.closes_on).toISOString().slice(0, 10) : null, status: o.status,
    createdAt: o.created_at.toISOString(),
  };
}

/** Offers past their closing date close themselves. */
async function closeExpiredOffers() {
  const db = await connectorDb();
  await db.query(`UPDATE connector_offers SET status = 'closed' WHERE status = 'open' AND closes_on IS NOT NULL AND closes_on < current_date`);
}

function engagementView(e: any) {
  return {
    id: e.id, title: e.title, scope: e.scope, feeTerms: e.fee_terms, startsOn: e.starts_on, endsOn: e.ends_on, status: e.status,
    acceptedName: e.accepted_name, acceptedAt: e.accepted_at?.toISOString?.() ?? null, createdAt: e.created_at.toISOString(),
  };
}

/** Masks an email for display to someone else: "an***@gmail.com". */
function maskEmail(e: string | null) {
  if (!e || !e.includes("@")) return null;
  const [user, domain] = e.split("@");
  return `${user!.slice(0, 2)}***@${domain}`;
}

/** Protocol fees on a user's contracts across settlement networks. Empty on any failure. */
async function feePositions(getServices: Deps["getServices"], uid: number): Promise<FeePosition[]> {
  try {
    const s = await getServices();
    const registry = chainRegistry()!;
    const book = await s.accounts.addressBook(uid);
    const out: FeePosition[] = [];
    for (const chain of registry.settlementNetworks()) {
      if (!book[chain.key]) continue;
      for (const adapter of s.adapters.adaptersFor(chain.key)) {
        for (const p of await adapter.listPositions(book[chain.key])) out.push({ createdAt: p.createdAt, fee: p.fee });
      }
    }
    return out;
  } catch {
    return [];
  }
}

const referralCache = new Map<number, { at: number; data: unknown }>();

async function referralsOf(getServices: Deps["getServices"], connectorId: number) {
  const hit = referralCache.get(connectorId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data as Awaited<ReturnType<typeof loadReferrals>>;
  const data = await loadReferrals(getServices, connectorId);
  referralCache.set(connectorId, { at: Date.now(), data });
  return data;
}

async function loadReferrals(getServices: Deps["getServices"], connectorId: number) {
  const db = await connectorDb();
  await import("../onboarding/service").then((m) => m.onboardingDb()).catch(() => undefined);
  const { rows } = await db.query(
    `SELECT r.referred_user_id, r.created_at, u.email, o.full_name, o.completed_at
       FROM connector_referrals r
       LEFT JOIN user_accounts u ON u.id = r.referred_user_id
       LEFT JOIN account_onboarding o ON o.user_id = r.referred_user_id
      WHERE r.connector_user_id = $1
      ORDER BY r.created_at DESC LIMIT 200`,
    [connectorId],
  );
  const list = [];
  for (const r of rows) {
    const revenue = referralRevenue(await feePositions(getServices, r.referred_user_id));
    const first = (r.full_name as string | null)?.split(/\s+/)[0] ?? null;
    list.push({
      id: r.referred_user_id as number,
      name: first, email: maskEmail(r.email),
      joinedAt: (r.created_at as Date).toISOString(),
      onboarded: !!r.completed_at,
      contracts: revenue.contracts,
      firstContract: revenue.contracts > 0,
      estimatedShare: revenue.share,
      periodEnd: revenue.periodEnd,
    });
  }
  return list;
}

/** Finax questions per member per hour. Each one carries the whole programme brief. */
const FINAX_PER_HOUR = 40;
const finaxHits = new Map<number, { count: number; resetAt: number }>();
function finaxLimited(uid: number) {
  const now = Date.now();
  const e = finaxHits.get(uid);
  if (!e || now > e.resetAt) { finaxHits.set(uid, { count: 1, resetAt: now + 3_600_000 }); return false; }
  e.count += 1;
  return e.count > FINAX_PER_HOUR;
}
const finaxThread = (uid: number, threadId: string) => `con_${uid}_${threadId}`.slice(0, 120);

export function registerConnectorRoutes(app: Express, d: Deps) {
  // ── Members ───────────────────────────────────────────────────────────────

  app.get("/api/v2/connectors/me", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const m = await getMember(uid);
    const r = await readiness(uid, m);
    const db = await connectorDb();
    const { rows: lessons } = await db.query(`SELECT module_id, score, passed, attempts, passed_at FROM connector_lessons WHERE user_id = $1`, [uid]);
    const signatures = m ? await signedDocuments(uid) : [];
    const kind = m ? docFor(m) : "connector";
    const current = signatures.find((s) => s.document === kind && s.version === AGREEMENTS[kind].version);
    const counts = m
      ? (await db.query(
          `SELECT
             (SELECT count(*) FROM connector_registrations WHERE user_id = $1)::int AS registrations,
             (SELECT count(*) FROM connector_registrations WHERE user_id = $1 AND status IN ('approved','live'))::int AS approved,
             (SELECT count(*) FROM connector_registrations WHERE user_id = $1 AND counts_for_review AND status IN ('approved','live'))::int AS qualifying,
             (SELECT count(*) FROM connector_referrals WHERE connector_user_id = $1)::int AS referrals,
             (SELECT count(*) FROM connector_engagements WHERE user_id = $1 AND status = 'offered')::int AS offers,
             (SELECT count(*) FROM connector_offers o WHERE o.status = 'open' AND (o.closes_on IS NULL OR o.closes_on >= current_date)
                AND o.audience IN ('all', $2)
                AND NOT EXISTS (SELECT 1 FROM connector_offer_responses r WHERE r.offer_id = o.id AND r.user_id = $1))::int AS new_offers`,
          [uid, m.kind],
        )).rows[0]
      : null;
    const ready = r.missing.length === 0;
    // Someone with a BlockFinaX account who has not applied yet: start the form from what
    // their account already holds, so they only add what the programme needs.
    let prefill: null | { fullName: string; country: string; phone: string; organisation: string } = null;
    if (!m) {
      const found = await getOnboarding(uid).catch(() => null);
      const { rows } = await db.query(`SELECT name FROM user_accounts WHERE id = $1`, [uid]);
      prefill = {
        fullName: found?.row.full_name ?? rows[0]?.name ?? "",
        country: found?.row.country ?? "",
        phone: found?.row.phone ?? "",
        organisation: found?.organisation?.legal_name ?? "",
      };
    }
    res.json({
      member: m ? memberView(m) : null,
      prefill,
      signing: signingPolicy(environment()),
      agreement: {
        kind, version: AGREEMENTS[kind].version, hash: agreementHash(kind),
        signed: current ? { typedName: current.typed_name, signedAt: current.signed_at.toISOString(), binding: current.binding,
          countersignedAt: current.countersigned_at?.toISOString() ?? null } : null,
      },
      lessons: MODULES.map((mod) => {
        const l = lessons.find((x: any) => x.module_id === mod.id);
        return { id: mod.id, passed: !!l?.passed, score: l ? Number(l.score) : null, attempts: l?.attempts ?? 0 };
      }),
      missing: r.missing,
      ready,
      referral: ready && m?.referral_code ? { code: m.referral_code, link: referralLink(m.referral_code) } : null,
      counts,
    });
  }));

  app.post("/api/v2/connectors/apply", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const b = req.body ?? {};
    const existing = await getMember(uid);
    const kind = (MEMBER_KINDS.includes(b.kind) ? b.kind : "connector") as MemberKind;
    const fullName = str(b.fullName, 120);
    const country = str(b.country, 2).toUpperCase();
    const areas = Array.isArray(b.areas) ? b.areas.filter((a: unknown) => typeof a === "string" && areaByKey(a)).slice(0, 11) : [];
    if (fullName.split(/\s+/).length < 2) throw bad("Enter your full legal name, first and last");
    if (!/^[A-Z]{2}$/.test(country)) throw bad("Choose your country");
    if (kind === "connector" && !areas.length) throw bad("Choose at least one group you can introduce");
    // Required to apply; members accepted before this rule can still edit their profile without it.
    if ((!existing || existing.status === "applied" || existing.status === "declined") && !str(b.about, 1000)) throw bad("Tell us about your background in a few sentences");
    const { db: authDb } = await import("../db");
    const { userAccounts } = await import("@shared/auth-core-schema");
    const { eq } = await import("drizzle-orm");
    const [user] = await authDb.select().from(userAccounts).where(eq(userAccounts.id, uid));
    const email = (user?.email || "").toLowerCase();
    if (!email) throw bad("Add an email address to your BlockFinaX account first");
    const organisation = str(b.organisation, 160) || null;
    if (existing && !sameName(existing.full_name, fullName) && (await signedDocuments(uid)).length) {
      throw bad("Your accepted terms carry your current name. Contact BlockFinaX to change your legal name.");
    }
    const db = await connectorDb();
    // The kind is fixed once BlockFinaX has decided on the application.
    // A declined applicant may apply again: the application goes back to review.
    const reapplying = existing?.status === "declined";
    const lockedKind = existing && existing.status !== "applied" && !reapplying ? existing.kind : kind;
    await db.query(
      `INSERT INTO connectors (user_id, kind, full_name, organisation, country, email, phone, markets, areas, about)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id) DO UPDATE SET kind = $2, full_name = $3, organisation = $4, country = $5, email = $6, phone = $7,
         markets = $8, areas = $9, about = $10, updated_at = now()`,
      [uid, lockedKind, fullName, organisation, country, email, str(b.phone, 40) || null, str(b.markets, 200) || null,
       JSON.stringify(areas), str(b.about, 1000) || null],
    );
    if (reapplying) await db.query(`UPDATE connectors SET status = 'applied', decided_at = NULL WHERE user_id = $1`, [uid]);
    const nameChanged = !existing || existing.full_name !== fullName || existing.organisation !== organisation;
    if (nameChanged) void screenMember(uid, { fullName, organisation, country });
    if (!existing || reapplying) {
      void notifyAdmins(`${reapplying ? "Renewed" : "New"} ${lockedKind} application: ${fullName}`, [
        `${fullName}${organisation ? ` (${organisation})` : ""}, ${country}, applied to join the programme as a ${lockedKind}.`,
        `Areas: ${areas.map((a: string) => areaByKey(a)!.label).join(", ")}.`,
        "Review it in the admin dashboard under Connectors.",
      ]);
    }
    res.json({ ok: true });
  }));

  app.post("/api/v2/connectors/sign", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const m = await getMember(uid);
    if (!m) throw bad("Apply to join the programme first");
    if (m.status === "declined" || m.status === "ended") throw bad("Your membership is not active");
    if (m.status === "applied") throw bad("You can accept the terms once BlockFinaX has accepted your application");
    const policy = signingPolicy(environment());
    if (!policy.open) throw bad("The terms open for acceptance once BlockFinaX has finalised them");
    if (req.body?.agree !== true) throw bad("Tick the box to confirm you have read and agree to the terms");
    // Accepted, not signed: the name recorded is the one on the member's profile.
    const typed = m.full_name;
    const kind = docFor(m);
    const doc = AGREEMENTS[kind];
    const db = await connectorDb();
    const { rowCount } = await db.query(
      `INSERT INTO connector_signatures (user_id, document, version, text_hash, typed_name, full_name, email, binding, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (user_id, document, version) DO NOTHING`,
      [uid, kind, doc.version, agreementHash(kind), typed, m.full_name, m.email, policy.binding,
       String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0]!.trim().slice(0, 64),
       str(req.headers["user-agent"], 300)],
    );
    if (rowCount) {
      void notifyAdmins(`${doc.title} accepted: ${m.full_name}`, [
        `${m.full_name} accepted the ${doc.title} (${doc.version})${policy.binding ? "" : " on testnet, as a test acceptance"}.`,
      ]);
      void notifyMember(m.email, `You accepted the BlockFinaX ${doc.title}`, [
        `Hello ${m.full_name.split(" ")[0]},`,
        `This confirms you accepted the ${doc.title}, version ${doc.version}, on ${new Date().toUTCString()}.${policy.binding ? "" : " This was a test acceptance on BlockFinaX testnet and is not binding."}`,
        `The text you accepted has the fingerprint ${agreementHash(kind)}. You can read it at any time in the portal.`,
      ]);
    }
    res.json({ ok: true });
  }));

  app.post("/api/v2/connectors/lessons/:id", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    if (!(await getMember(uid))) throw bad("Apply to join the programme first");
    const mod = moduleById(req.params.id!);
    if (!mod) throw bad("Unknown module");
    const result = scoreModule(mod.id, req.body?.answers ?? {});
    const db = await connectorDb();
    await db.query(
      `INSERT INTO connector_lessons (user_id, module_id, score, passed, attempts, passed_at)
       VALUES ($1,$2,$3,$4,1, CASE WHEN $4 THEN now() END)
       ON CONFLICT (user_id, module_id) DO UPDATE SET
         score = GREATEST(connector_lessons.score, EXCLUDED.score),
         passed = connector_lessons.passed OR EXCLUDED.passed,
         passed_at = COALESCE(connector_lessons.passed_at, EXCLUDED.passed_at),
         attempts = connector_lessons.attempts + 1, updated_at = now()`,
      [uid, mod.id, result.score, result.passed],
    );
    res.json(result);
  }));

  app.get("/api/v2/connectors/registrations", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const db = await connectorDb();
    const { rows } = await db.query(`SELECT * FROM connector_registrations WHERE user_id = $1 ORDER BY created_at DESC`, [uid]);
    res.json({ registrations: rows.map((r: any) => registrationView(r)) });
  }));

  app.post("/api/v2/connectors/registrations", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const m = await getMember(uid);
    const r = await readiness(uid, m);
    if (r.missing.length) throw bad(`Before registering: ${r.missing[0]}`);
    const b = req.body ?? {};
    const area = areaByKey(str(b.area, 40));
    if (!area) throw bad("Choose the area this introduction falls under");
    const organisation = str(b.organisation, 160);
    const contactName = str(b.contactName, 120);
    const country = str(b.country, 2).toUpperCase();
    const need = str(b.need, 1000);
    if (organisation.length < 2) throw bad("Enter the organisation's name");
    if (contactName.length < 2) throw bad("Enter the name of the person you know there");
    if (!/^[A-Z]{2}$/.test(country)) throw bad("Choose the organisation's country");
    if (need.length < 20) throw bad("Describe what they need in a sentence or two");
    if (b.permission !== true) throw bad("You need the contact's permission before registering an introduction");
    const contactEmail = str(b.contactEmail, 160) || null;
    if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) throw bad("Enter a valid email for the contact, or leave it empty");
    const website = str(b.website, 200) || null;
    const key = orgKey(organisation);
    const domain = orgDomain(website) ?? orgDomain(contactEmail);
    if (!key) throw bad("Enter the organisation's name");
    const db = await connectorDb();
    const { rows: existing } = await db.query(
      `SELECT id, user_id, org_key, domain, status, created_at FROM connector_registrations WHERE org_key = $1 OR ($2::text IS NOT NULL AND domain = $2)`,
      [key, domain],
    );
    const clash = findConflict({ orgKey: key, domain }, existing.map((e: any) => ({
      id: e.id, userId: e.user_id, orgKey: e.org_key, domain: e.domain, status: e.status, createdAt: e.created_at,
    })));
    if (clash) {
      throw bad(clash.userId === uid
        ? "You have already registered this organisation. One organisation counts once."
        : "This organisation is already registered in the programme. One organisation counts once.");
    }
    // Existing BlockFinaX customers do not qualify automatically (clause 3.3): flagged for review, not refused.
    let conflictWith: string | null = null;
    try {
      const { onboardingDb } = await import("../onboarding/service");
      const odb = await onboardingDb();
      const { rows: orgs } = await odb.query(`SELECT legal_name FROM organisations`);
      if (orgs.some((o: { legal_name: string }) => orgKey(o.legal_name) === key)) conflictWith = "existing_customer";
    } catch { /* onboarding tables absent: nothing to compare */ }
    const id = newId("reg");
    await db.query(
      `INSERT INTO connector_registrations (id, user_id, area, organisation, org_key, domain, website, contact_name, contact_role,
         contact_email, country, need, permission, conflict_with)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13)`,
      [id, uid, area.key, organisation, key, domain, website, contactName, str(b.contactRole, 120) || null, contactEmail, country, need, conflictWith],
    );
    void notifyAdmins(`New registration from ${m!.full_name}: ${organisation}`, [
      `${m!.full_name} registered ${organisation} (${country}) under ${area.label}.`,
      `Need: ${need}`,
      ...(conflictWith ? ["This name matches an existing BlockFinaX customer. Check before approving."] : []),
    ]);
    res.json({ id });
  }));

  app.get("/api/v2/connectors/referrals", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    if (!(await getMember(uid))) throw bad("Apply to join the programme first");
    res.json({ referrals: await referralsOf(d.getServices, uid) });
  }));

  app.post("/api/v2/connectors/attribute", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const code = str(req.body?.code, 20).toUpperCase();
    if (!isReferralCode(code)) return void res.json({ attributed: false });
    const db = await connectorDb();
    const { rows } = await db.query(`SELECT user_id, status FROM connectors WHERE referral_code = $1`, [code]);
    const owner = rows[0];
    if (!owner || owner.status !== "active" || owner.user_id === uid) return void res.json({ attributed: false });
    // Only new accounts: someone who already used BlockFinaX before following a link is not the connector's introduction.
    const { rows: acct } = await db.query(`SELECT created_at FROM user_accounts WHERE id = $1`, [uid]);
    const created = acct[0]?.created_at as Date | undefined;
    if (!created || Date.now() - created.getTime() > 14 * 86_400_000) return void res.json({ attributed: false });
    const { rowCount } = await db.query(
      `INSERT INTO connector_referrals (referred_user_id, connector_user_id, code) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [uid, owner.user_id, code],
    );
    if (rowCount) referralCache.delete(owner.user_id);
    res.json({ attributed: !!rowCount });
  }));

  app.get("/api/v2/connectors/rewards", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const m = await getMember(uid);
    if (!m) throw bad("Apply to join the programme first");
    const db = await connectorDb();
    const { rows } = await db.query(
      `SELECT l.*, r.organisation FROM connector_ledger l LEFT JOIN connector_registrations r ON r.id = l.registration_id
        WHERE l.user_id = $1 ORDER BY l.created_at DESC`,
      [uid],
    );
    const lines = rows.map((l: any) => ({
      id: l.id, kind: l.kind as LedgerKind, quarter: l.quarter, amountUsd: Number(l.amount_usd), note: l.note, reference: l.reference,
      organisation: l.organisation, createdAt: l.created_at.toISOString(),
    }));
    const referrals = await referralsOf(d.getServices, uid);
    res.json({
      lines,
      statement: statement(lines),
      currentQuarter: quarterOf(new Date()),
      estimatedFromReferrals: round2(referrals.reduce((s, r) => s + r.estimatedShare, 0)),
      payoutDetails: m.payout_details,
    });
  }));

  app.post("/api/v2/connectors/payout", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    if (!(await getMember(uid))) throw bad("Apply to join the programme first");
    const details = str(req.body?.details, 500);
    if (details.length < 6) throw bad("Enter the bank account or USDC wallet in your own name");
    const db = await connectorDb();
    await db.query(`UPDATE connectors SET payout_details = $2, updated_at = now() WHERE user_id = $1`, [uid, details]);
    res.json({ ok: true });
  }));

  app.get("/api/v2/connectors/engagements", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const db = await connectorDb();
    const { rows } = await db.query(`SELECT * FROM connector_engagements WHERE user_id = $1 ORDER BY created_at DESC`, [uid]);
    res.json({ engagements: rows.map(engagementView) });
  }));

  app.post("/api/v2/connectors/engagements/:id/accept", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const m = await getMember(uid);
    if (!m) throw bad("Apply to join the programme first");
    if (!(await hasCurrentSignature(uid, "contractor"))) throw bad("Accept the Contractor Terms first");
    if (req.body?.agree !== true) throw bad("Tick the box to confirm you accept this engagement");
    const typed = m.full_name;
    const db = await connectorDb();
    const { rows } = await db.query(`SELECT * FROM connector_engagements WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    const e = rows[0];
    if (!e) throw bad("Engagement not found");
    if (e.status !== "offered") throw bad("This engagement is no longer open to accept");
    await db.query(
      `UPDATE connector_engagements SET status = 'accepted', accepted_name = $2, accepted_at = now(), text_hash = $3 WHERE id = $1`,
      [e.id, typed, sha256(engagementText(e))],
    );
    void notifyAdmins(`Engagement accepted: ${e.title}`, [`${m.full_name} accepted the engagement "${e.title}".`]);
    res.json({ ok: true });
  }));

  app.post("/api/v2/connectors/engagements/:id/decline", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const db = await connectorDb();
    const { rowCount } = await db.query(
      `UPDATE connector_engagements SET status = 'declined' WHERE id = $1 AND user_id = $2 AND status = 'offered'`, [req.params.id, uid]);
    if (!rowCount) throw bad("This engagement is no longer open");
    res.json({ ok: true });
  }));

  app.get("/api/v2/connectors/offers", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const m = await getMember(uid);
    if (!m) throw bad("Apply to join the programme first");
    await closeExpiredOffers();
    const db = await connectorDb();
    // Open offers for this member's kind, plus closed ones they responded to (so they see the outcome).
    const { rows } = await db.query(
      `SELECT o.*, r.status AS my_status, r.note AS my_note, r.created_at AS my_at
         FROM connector_offers o
         LEFT JOIN connector_offer_responses r ON r.offer_id = o.id AND r.user_id = $1
        WHERE (o.status = 'open' AND o.audience IN ('all', $2)) OR r.user_id IS NOT NULL
        ORDER BY o.status = 'open' DESC, o.created_at DESC`,
      [uid, m.kind],
    );
    res.json({
      canRespond: m.status === "active",
      offers: rows.map((o: any) => ({ ...offerView(o), mine: o.my_status ? { status: o.my_status, note: o.my_note, at: o.my_at.toISOString() } : null })),
    });
  }));

  app.post("/api/v2/connectors/offers/:id/respond", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const m = await getMember(uid);
    if (!m) throw bad("Apply to join the programme first");
    if (m.status !== "active") throw bad("You can respond to offers once BlockFinaX has approved your application");
    await closeExpiredOffers();
    const db = await connectorDb();
    const { rows } = await db.query(`SELECT * FROM connector_offers WHERE id = $1`, [req.params.id]);
    const o = rows[0];
    if (!o || (o.audience !== "all" && o.audience !== m.kind)) throw bad("Offer not found");
    if (o.status !== "open") throw bad("This offer has closed");
    const note = str(req.body?.note, 1000);
    if (note.length < 10) throw bad("Tell BlockFinaX in a sentence or two how you can help with this");
    const { rowCount } = await db.query(
      `INSERT INTO connector_offer_responses (offer_id, user_id, note) VALUES ($1,$2,$3)
       ON CONFLICT (offer_id, user_id) DO UPDATE SET note = $3, status = 'interested', updated_at = now()
       WHERE connector_offer_responses.status IN ('interested', 'withdrawn')`,
      [o.id, uid, note],
    );
    if (!rowCount) throw bad("BlockFinaX has already decided on this offer");
    void notifyAdmins(`Interest in "${o.title}" from ${m.full_name}`, [`${m.full_name} is interested in the offer "${o.title}".`, `Their note: ${note}`]);
    res.json({ ok: true });
  }));

  app.post("/api/v2/connectors/offers/:id/withdraw", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const db = await connectorDb();
    const { rowCount } = await db.query(
      `UPDATE connector_offer_responses SET status = 'withdrawn', updated_at = now() WHERE offer_id = $1 AND user_id = $2 AND status = 'interested'`,
      [req.params.id, uid],
    );
    if (!rowCount) throw bad("Nothing to withdraw");
    res.json({ ok: true });
  }));

  // ── Admin ─────────────────────────────────────────────────────────────────

  const admin = (h: Handler) => [requireAdmin, d.wrap(h)];
  const by = (req: Request) => (req as any).adminEmail as string;

  app.get("/api/v2/admin/connectors", ...admin(async (_req, res) => {
    const db = await connectorDb();
    const { rows } = await db.query(`
      SELECT c.*,
        (SELECT count(*) FROM connector_registrations r WHERE r.user_id = c.user_id AND r.status = 'pending')::int AS pending,
        (SELECT count(*) FROM connector_registrations r WHERE r.user_id = c.user_id AND r.status IN ('approved','live'))::int AS approved,
        (SELECT count(*) FROM connector_referrals f WHERE f.connector_user_id = c.user_id)::int AS referrals,
        (SELECT count(*) FROM connector_lessons l WHERE l.user_id = c.user_id AND l.passed)::int AS lessons_passed,
        (SELECT count(*) FROM connector_signatures s WHERE s.user_id = c.user_id)::int AS signatures,
        COALESCE((SELECT sum(CASE WHEN kind = 'payment' THEN -amount_usd ELSE amount_usd END) FROM connector_ledger g WHERE g.user_id = c.user_id), 0)::float AS owed
      FROM connectors c ORDER BY c.created_at DESC`);
    res.json({
      members: rows.map((c: any) => ({
        userId: c.user_id, ...memberView(c), screening: c.screening_status, referralCode: c.referral_code,
        pending: c.pending, approved: c.approved, referrals: c.referrals, lessonsPassed: c.lessons_passed, lessonsTotal: MODULES.length,
        signatures: c.signatures, owed: round2(c.owed),
      })),
    });
  }));

  app.get("/api/v2/admin/connectors/:userId", ...admin(async (req, res) => {
    const uid = Number(req.params.userId);
    const m = await getMember(uid);
    if (!m) throw bad("Member not found");
    const db = await connectorDb();
    const [sigs, lessons, regs, ledger, engagements] = await Promise.all([
      signedDocuments(uid),
      db.query(`SELECT * FROM connector_lessons WHERE user_id = $1`, [uid]).then((r: any) => r.rows),
      db.query(`SELECT * FROM connector_registrations WHERE user_id = $1 ORDER BY created_at DESC`, [uid]).then((r: any) => r.rows),
      db.query(`SELECT * FROM connector_ledger WHERE user_id = $1 ORDER BY created_at DESC`, [uid]).then((r: any) => r.rows),
      db.query(`SELECT * FROM connector_engagements WHERE user_id = $1 ORDER BY created_at DESC`, [uid]).then((r: any) => r.rows),
    ]);
    const lines = ledger.map((l: any) => ({ id: l.id, kind: l.kind, quarter: l.quarter, amountUsd: Number(l.amount_usd), note: l.note,
      reference: l.reference, registrationId: l.registration_id, createdBy: l.created_by, createdAt: l.created_at.toISOString() }));
    res.json({
      member: { userId: uid, ...memberView(m), screening: m.screening_status, screeningDetail: m.screening_detail, referralCode: m.referral_code, adminNote: m.admin_note },
      missing: (await readiness(uid, m)).missing,
      signatures: sigs.map((s) => ({ id: s.id, document: s.document, version: s.version, typedName: s.typed_name, email: s.email, binding: s.binding,
        hash: s.text_hash, signedAt: s.signed_at.toISOString(), countersignedBy: s.countersigned_by, countersignedAt: s.countersigned_at?.toISOString() ?? null })),
      lessons: lessons.map((l: any) => ({ id: l.module_id, score: Number(l.score), passed: l.passed, attempts: l.attempts })),
      registrations: regs.map((r: any) => registrationView(r, true)),
      referrals: await referralsOf(d.getServices, uid),
      ledger: lines,
      statement: statement(lines),
      engagements: engagements.map(engagementView),
    });
  }));

  app.post("/api/v2/admin/connectors/:userId/status", ...admin(async (req, res) => {
    const uid = Number(req.params.userId);
    const m = await getMember(uid);
    if (!m) throw bad("Member not found");
    const status = req.body?.status as MemberStatus;
    if (!["active", "paused", "ended", "declined"].includes(status)) throw bad("Choose active, paused, ended or declined");
    if (status === "active" && m.screening_status === "hit") throw bad("Clear the sanctions screening hit in Compliance before approving");
    const db = await connectorDb();
    let code = m.referral_code;
    if (status === "active" && !code) {
      for (let i = 0; i < 5 && !code; i++) {
        const candidate = newReferralCode();
        const { rowCount } = await db.query(`SELECT 1 FROM connectors WHERE referral_code = $1`, [candidate]);
        if (!rowCount) code = candidate;
      }
    }
    await db.query(
      `UPDATE connectors SET status = $2, referral_code = $3, admin_note = COALESCE($4, admin_note), decided_by = $5, decided_at = now(), updated_at = now() WHERE user_id = $1`,
      [uid, status, code, str(req.body?.note, 500) || null, by(req)],
    );
    const first = m.full_name.split(" ")[0];
    const messages: Record<string, string[]> = {
      active: [`Hello ${first},`, "Welcome to the BlockFinaX Connector Programme. Your application is approved.",
        "Next, sign your agreement and complete the short training in the portal. Your referral link appears once both are done."],
      paused: [`Hello ${first},`, "Your access to the connector portal is paused. Rewards already earned are not affected. Reply to this email to discuss it."],
      ended: [`Hello ${first},`, "Your membership of the Connector Programme has ended. Rewards already earned on approved relationships continue under your agreement."],
      declined: [`Hello ${first},`, "Thank you for applying to the BlockFinaX Connector Programme. We are not able to accept your application at this time."],
    };
    void notifyMember(m.email, status === "active" ? "Welcome to the BlockFinaX Connector Programme" : "Your BlockFinaX connector membership", messages[status]!);
    res.json({ ok: true, referralCode: code });
  }));

  app.post("/api/v2/admin/connectors/:userId/ledger", ...admin(async (req, res) => {
    const uid = Number(req.params.userId);
    if (!(await getMember(uid))) throw bad("Member not found");
    const b = req.body ?? {};
    const kind = b.kind as LedgerKind;
    if (!LEDGER_KINDS.includes(kind)) throw bad("Choose what this line is");
    const quarter = str(b.quarter, 7);
    if (!QUARTER.test(quarter)) throw bad("Quarter must look like 2027-Q1");
    const amount = Number(b.amountUsd);
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 10_000_000) throw bad("Enter an amount in US dollars");
    if (kind !== "adjustment" && amount < 0) throw bad("Only adjustments can be negative");
    const db = await connectorDb();
    const regId = str(b.registrationId, 40) || null;
    if (regId) {
      const { rowCount } = await db.query(`SELECT 1 FROM connector_registrations WHERE id = $1 AND user_id = $2`, [regId, uid]);
      if (!rowCount) throw bad("That registration does not belong to this member");
    }
    await db.query(
      `INSERT INTO connector_ledger (user_id, registration_id, kind, quarter, amount_usd, note, reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uid, regId, kind, quarter, round2(amount), str(b.note, 300) || null, str(b.reference, 200) || null, by(req)],
    );
    res.json({ ok: true });
  }));

  app.post("/api/v2/admin/connectors/:userId/engagements", ...admin(async (req, res) => {
    const uid = Number(req.params.userId);
    const m = await getMember(uid);
    if (!m) throw bad("Member not found");
    if (m.kind !== "contractor") throw bad("Engagements are offered to independent contractors only");
    const b = req.body ?? {};
    const title = str(b.title, 160), scope = str(b.scope, 3000), fees = str(b.feeTerms, 500);
    if (title.length < 3 || scope.length < 20 || fees.length < 3) throw bad("Give the engagement a title, a scope of work and the fees");
    const date = (v: unknown) => { const s = str(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
    const db = await connectorDb();
    const id = newId("eng");
    await db.query(
      `INSERT INTO connector_engagements (id, user_id, title, scope, fee_terms, starts_on, ends_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, uid, title, scope, fees, date(b.startsOn), date(b.endsOn), by(req)],
    );
    void notifyMember(m.email, `New engagement offered: ${title}`, [
      `Hello ${m.full_name.split(" ")[0]},`, `BlockFinaX has offered you an engagement: ${title}. Review the scope and fees and accept or decline it in the portal.`,
    ]);
    res.json({ id });
  }));

  app.get("/api/v2/admin/connector-registrations", ...admin(async (req, res) => {
    const db = await connectorDb();
    const status = str(req.query.status, 20);
    const { rows } = await db.query(
      `SELECT r.*, c.full_name AS member_name FROM connector_registrations r JOIN connectors c ON c.user_id = r.user_id
        ${status ? "WHERE r.status = $1" : ""} ORDER BY r.created_at DESC LIMIT 300`,
      status ? [status] : [],
    );
    res.json({ registrations: rows.map((r: any) => registrationView(r, true)) });
  }));

  app.post("/api/v2/admin/connector-registrations/:id/decide", ...admin(async (req, res) => {
    const b = req.body ?? {};
    const status = b.status as RegistrationStatus;
    if (!["approved", "declined", "live", "closed"].includes(status)) throw bad("Choose approved, declined, live or closed");
    const db = await connectorDb();
    const { rows } = await db.query(`SELECT * FROM connector_registrations WHERE id = $1`, [req.params.id]);
    const r = rows[0];
    if (!r) throw bad("Registration not found");
    const area = areaByKey(r.area);
    const terms = str(b.rewardTerms, 500) || (status === "approved" ? area?.reward ?? null : null);
    const bonus = b.bonusUsd === undefined || b.bonusUsd === null || b.bonusUsd === "" ? null : Number(b.bonusUsd);
    if (bonus !== null && !(bonus >= 0)) throw bad("Bonus must be a positive amount in US dollars");
    // "live" marks the first revenue: the 12-month reward period starts then, once.
    const periodStart = status === "live" && !r.period_start ? new Date(str(b.periodStart, 10) || Date.now()) : null;
    if (periodStart && Number.isNaN(periodStart.getTime())) throw bad("First revenue date must look like 2027-03-01");
    const periodEnd = periodStart ? new Date(periodStart) : null;
    if (periodEnd) periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 12);
    // Counts towards the four needed for an advisory review: revenue areas by default; milestones only when BlockFinaX says so.
    const counts = status === "declined" ? false
      : typeof b.countsForReview === "boolean" ? b.countsForReview
      : r.decided_at ? r.counts_for_review : !!area?.revenueShare;
    await db.query(
      `UPDATE connector_registrations SET status = $2, reward_terms = COALESCE($3, reward_terms), bonus_usd = COALESCE($4, bonus_usd),
         counts_for_review = $5, decision_note = COALESCE($6, decision_note), decided_by = $7, decided_at = now(),
         period_start = COALESCE(period_start, $8), period_end = COALESCE(period_end, $9)
       WHERE id = $1`,
      [r.id, status, terms, bonus, counts, str(b.note, 500) || null, by(req), periodStart, periodEnd],
    );
    const m = await getMember(r.user_id);
    if (m) {
      const lines: Record<string, string[]> = {
        approved: [`BlockFinaX approved your introduction of ${r.organisation}.`, `Reward: ${terms ?? "as agreed"}${bonus ? `, bonus US$${bonus.toLocaleString("en-US")}` : ""}.`,
          "This message is your Approval Notice under the Connector Agreement. Go ahead with the warm introduction."],
        declined: [`BlockFinaX declined your registration of ${r.organisation}.`, ...(str(b.note, 500) ? [`Reason: ${str(b.note, 500)}`] : [])],
        live: [`${r.organisation} is now live and producing revenue. Your 12-month reward period has started.`],
        closed: [`The relationship with ${r.organisation} is now closed in the programme.`],
      };
      void notifyMember(m.email, `Update on ${r.organisation}`, [`Hello ${m.full_name.split(" ")[0]},`, ...lines[status]!]);
    }
    res.json({ ok: true });
  }));

  app.get("/api/v2/admin/connector-offers", ...admin(async (_req, res) => {
    await closeExpiredOffers();
    const db = await connectorDb();
    const { rows: offers } = await db.query(`SELECT * FROM connector_offers ORDER BY status = 'open' DESC, created_at DESC LIMIT 200`);
    const { rows: responses } = await db.query(
      `SELECT r.*, c.full_name, c.email, c.country, c.kind FROM connector_offer_responses r JOIN connectors c ON c.user_id = r.user_id ORDER BY r.created_at`);
    res.json({
      offers: offers.map((o: any) => ({
        ...offerView(o),
        responses: responses.filter((r: any) => r.offer_id === o.id).map((r: any) => ({
          userId: r.user_id, name: r.full_name, email: r.email, country: r.country, kind: r.kind, note: r.note, status: r.status, at: r.created_at.toISOString(),
        })),
      })),
    });
  }));

  app.post("/api/v2/admin/connector-offers", ...admin(async (req, res) => {
    const b = req.body ?? {};
    const title = str(b.title, 160), summary = str(b.summary, 300), reward = str(b.reward, 300);
    if (title.length < 3 || summary.length < 10 || reward.length < 2) throw bad("Give the offer a title, a one-line summary and the reward");
    const audience = ["all", "connector", "contractor"].includes(b.audience) ? b.audience : "all";
    const area = b.area && areaByKey(b.area) ? b.area : null;
    const country = /^[A-Z]{2}$/.test(str(b.country, 2).toUpperCase()) ? str(b.country, 2).toUpperCase() : null;
    const closesOn = /^\d{4}-\d{2}-\d{2}$/.test(str(b.closesOn, 10)) ? str(b.closesOn, 10) : null;
    const db = await connectorDb();
    const id = newId("ofr");
    await db.query(
      `INSERT INTO connector_offers (id, title, summary, details, area, country, audience, reward, closes_on, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, title, summary, str(b.details, 4000) || null, area, country, audience, reward, closesOn, by(req)],
    );
    let emailed = 0;
    if (b.notify === true) {
      const { rows } = await db.query(
        `SELECT email, full_name FROM connectors WHERE status = 'active' AND ($1 = 'all' OR kind = $1)`, [audience]);
      for (const m of rows) {
        void notifyMember(m.email, `New offer: ${title}`, [
          `Hello ${String(m.full_name).split(" ")[0]},`, `BlockFinaX has posted a new offer: ${title}.`, summary, `Reward: ${reward}.`,
          "See the details and say you are interested in the Offers tab of the portal.",
        ]);
        emailed++;
      }
    }
    res.json({ id, emailed });
  }));

  app.post("/api/v2/admin/connector-offers/:id/status", ...admin(async (req, res) => {
    const status = req.body?.status;
    if (!["open", "closed"].includes(status)) throw bad("Choose open or closed");
    const db = await connectorDb();
    const { rowCount } = await db.query(
      `UPDATE connector_offers SET status = $2, closes_on = CASE WHEN $2 = 'open' AND closes_on < current_date THEN NULL ELSE closes_on END WHERE id = $1`,
      [req.params.id, status]);
    if (!rowCount) throw bad("Offer not found");
    res.json({ ok: true });
  }));

  app.post("/api/v2/admin/connector-offers/:id/responses/:userId", ...admin(async (req, res) => {
    const status = req.body?.status;
    if (!["selected", "not_selected"].includes(status)) throw bad("Choose selected or not_selected");
    const db = await connectorDb();
    const { rows } = await db.query(
      `UPDATE connector_offer_responses SET status = $3, updated_at = now() WHERE offer_id = $1 AND user_id = $2 AND status <> 'withdrawn'
       RETURNING (SELECT title FROM connector_offers WHERE id = $1) AS title`,
      [req.params.id, Number(req.params.userId), status]);
    if (!rows.length) throw bad("Response not found");
    const m = await getMember(Number(req.params.userId));
    if (m) {
      void notifyMember(m.email, `Update on the offer: ${rows[0].title}`, [
        `Hello ${m.full_name.split(" ")[0]},`,
        status === "selected"
          ? `BlockFinaX has selected you for "${rows[0].title}". We will be in touch with next steps.`
          : `Thank you for your interest in "${rows[0].title}". BlockFinaX has gone with another member this time.`,
      ]);
    }
    res.json({ ok: true });
  }));

  app.post("/api/v2/admin/connector-engagements/:id/status", ...admin(async (req, res) => {
    const status = req.body?.status;
    if (!["completed", "cancelled"].includes(status)) throw bad("Choose completed or cancelled");
    const db = await connectorDb();
    const { rowCount } = await db.query(`UPDATE connector_engagements SET status = $2 WHERE id = $1 AND status IN ('offered','accepted')`, [req.params.id, status]);
    if (!rowCount) throw bad("Engagement not found or already closed");
    res.json({ ok: true });
  }));

  // ── Finax ──────────────────────────────────────────────────────────────
  app.post("/api/v2/connectors/finax", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    if (!agentConfigured()) throw bad("Finax isn't available right now.");
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) throw bad("Write a question for Finax");
    if (finaxLimited(uid)) throw bad("You've asked Finax a lot this hour. Please try again a little later.");
    const thread = finaxThread(uid, parsed.data.threadId);

    const m = await getMember(uid);
    const r = await readiness(uid, m);
    const db = await connectorDb();
    const counts = m
      ? (await db.query(
          `SELECT
             (SELECT count(*) FROM connector_registrations WHERE user_id = $1)::int AS registrations,
             (SELECT count(*) FROM connector_registrations WHERE user_id = $1 AND status IN ('approved','live'))::int AS approved,
             (SELECT count(*) FROM connector_referrals WHERE connector_user_id = $1)::int AS referrals,
             (SELECT count(*) FROM connector_engagements WHERE user_id = $1 AND status = 'offered')::int AS offers,
             (SELECT count(*) FROM connector_offers o WHERE o.status = 'open' AND (o.closes_on IS NULL OR o.closes_on >= current_date)
                AND o.audience IN ('all', $2)
                AND NOT EXISTS (SELECT 1 FROM connector_offer_responses x WHERE x.offer_id = o.id AND x.user_id = $1))::int AS new_offers`,
          [uid, m.kind],
        )).rows[0]
      : null;
    const regs = m
      ? (await db.query(`SELECT organisation, area, status, reward_terms, created_at FROM connector_registrations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [uid])).rows
      : [];
    const brief = connectorBrief({
      member: m ? { kind: m.kind, fullName: m.full_name, status: m.status, country: m.country, areas: m.areas ?? [] } : null,
      document: m ? docFor(m) : "connector",
      signed: r.signed, passed: r.passed, missing: r.missing, counts,
      registrations: regs.map((x: any) => ({ organisation: x.organisation, area: x.area, status: x.status, rewardTerms: x.reward_terms, createdAt: x.created_at.toISOString() })),
    });

    const history = await appDb.select().from(agentMessages)
      .where(and(eq(agentMessages.threadId, thread), eq(agentMessages.scope, "connector")))
      .orderBy(agentMessages.id).limit(30);
    await appDb.insert(agentMessages).values({ threadId: thread, scope: "connector", role: "user", content: parsed.data.message });
    const result = await runAgent({
      scope: "connector", trigger: "chat", maxTokens: 1024, systemExtra: brief, retrieveFor: parsed.data.message,
      messages: [
        ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
        { role: "user" as const, content: fence("connector", parsed.data.message) },
      ],
    });
    const [saved] = await appDb.insert(agentMessages).values({
      threadId: thread, scope: "connector", role: "assistant",
      content: result.text || "Sorry, I didn't catch that.", toolCalls: result.toolCalls, runId: result.runId,
    }).returning();
    res.json({ reply: saved.content, id: saved.id });
  }));

  app.get("/api/v2/connectors/finax/:threadId", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const rows = await appDb.select().from(agentMessages)
      .where(and(eq(agentMessages.threadId, finaxThread(uid, String(req.params.threadId))), eq(agentMessages.scope, "connector")))
      .orderBy(agentMessages.id).limit(60);
    res.json(rows.map((h) => ({ id: h.id, role: h.role, content: h.content })));
  }));
}
