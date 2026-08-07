/**
 * Compliance — API
 *
 *   /api/compliance/*        customer: own standing, own submission
 *   /api/admin/compliance/*  admin: review queue, alerts, screening
 *
 * The customer half is identity-bound the same way Finax is: the wallet comes
 * from a Rift-verified session, never from the request body. A customer can
 * read their own standing and submit their own documents, and has no route to
 * anyone else's.
 */

import type { Express, Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { requireRiftUser } from "../middleware/rift-auth";
import { requireAdmin, requireApprover } from "../middleware/admin-auth";
import { strictLimiter } from "../middleware/rate-limiter";
import { userProfiles } from "@shared/schema";
import {
  kycSubmissions, complianceAlerts, sanctionsScreenings,
  kycSubmissionSchema, reviewSchema,
  KYC_TIERS, LIMIT_WINDOW_DAYS, tierFor,
} from "@shared/compliance-schema";
import { walletStanding, checkTransaction, raiseAlert, MONITORING } from "../compliance/limits";
import { screenName, screenWallet, rescreenApproved } from "../compliance/sanctions";
import { emailKycReceived, emailKycApproved, emailKycRejected, emailUrgentReview } from "../compliance/notify";
import { agentProposals } from "@shared/agent-schema";

export function registerComplianceRoutes(app: Express) {
  // ═══ CUSTOMER ══════════════════════════════════════════════════════════

  /** Your tier, what you've moved, and what's left. */
  app.get("/api/compliance/me", requireRiftUser, async (req: Request, res: Response) => {
    try {
      const wallet = req.riftUser!.address;
      const standing = await walletStanding(wallet);
      const [submission] = await db
        .select()
        .from(kycSubmissions)
        .where(sql`lower(${kycSubmissions.walletAddress}) = ${wallet.toLowerCase()}`)
        .orderBy(desc(kycSubmissions.id))
        .limit(1);

      // What we already know, so the sequence never asks twice. Asking a
      // customer for their date of birth a second time is how they conclude
      // nobody is reading what they send.
      const [profile] = await db
        .select()
        .from(userProfiles)
        .where(sql`lower(${userProfiles.walletAddress}) = ${wallet.toLowerCase()}`)
        .limit(1);
      const [priorSubmission] = await db
        .select()
        .from(kycSubmissions)
        .where(
          and(
            sql`lower(${kycSubmissions.walletAddress}) = ${wallet.toLowerCase()}`,
            eq(kycSubmissions.status, "approved"),
          ),
        )
        .orderBy(desc(kycSubmissions.id))
        .limit(1);

      const prefill = {
        fullName:
          priorSubmission?.fullName ||
          [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
          profile?.displayName ||
          undefined,
        dateOfBirth: priorSubmission?.dateOfBirth ?? profile?.dateOfBirth ?? undefined,
        nationality: priorSubmission?.nationality ?? profile?.nationality ?? undefined,
        country: priorSubmission?.country ?? profile?.country ?? undefined,
        address: priorSubmission?.address ?? profile?.address ?? undefined,
        phone: priorSubmission?.phone ?? profile?.phoneNumber ?? undefined,
        email: priorSubmission?.email ?? profile?.email ?? undefined,
        idType: priorSubmission?.idType ?? profile?.idType ?? undefined,
        idNumber: priorSubmission?.idNumber ?? profile?.idNumber ?? undefined,
        companyName: priorSubmission?.companyName ?? profile?.companyName ?? undefined,
      };

      res.json({
        ...standing,
        tiers: KYC_TIERS,
        prefill: Object.fromEntries(Object.entries(prefill).filter(([, v]) => v)),
        submission: submission
          ? {
              id: submission.id,
              status: submission.status,
              requestedTier: submission.requestedTier,
              submittedAt: submission.submittedAt,
              reviewedAt: submission.reviewedAt,
              // Reviewer notes are shown so a rejection is actionable rather
              // than a dead end. Nothing else from the review is exposed.
              notes: submission.status === "rejected" ? submission.reviewerNotes : null,
            }
          : null,
      });
    } catch (err: any) {
      console.error("[compliance] standing failed:", err?.message);
      res.status(500).json({ message: "Could not load your verification status" });
    }
  });

  /** Would this transaction be allowed? Called by the app before it lets you act. */
  app.post("/api/compliance/check", requireRiftUser, async (req: Request, res: Response) => {
    try {
      const wallet = req.riftUser!.address;
      const kind = ["buy_protection", "deposit", "withdraw"].includes(req.body?.kind)
        ? req.body.kind
        : "buy_protection";
      const check = await checkTransaction({
        walletAddress: wallet,
        kind,
        amountUsd: Number(req.body?.amountUsd) || undefined,
        notionalUsd: Number(req.body?.notionalUsd) || undefined,
        eventId: Number(req.body?.eventId) || undefined,
      });
      res.json({
        allowed: check.allowed,
        reason: check.reason,
        requiredTier: check.requiredTier,
        requiredTierName: check.requiredTier ? tierFor(check.requiredTier).name : undefined,
        addsCashUsd: check.addsCashUsd,
        addsExposureUsd: check.addsExposureUsd,
        standing: check.standing,
      });
    } catch (err: any) {
      console.error("[compliance] check failed:", err?.message);
      res.status(500).json({ message: "Could not run the verification check" });
    }
  });

  /**
   * Submit for verification.
   *
   * Screening runs immediately, and a hit holds the submission at in_review
   * rather than rejecting it — a name collision is not grounds to refuse
   * someone service, but it is grounds for a person to look.
   */
  app.post("/api/compliance/submit", requireRiftUser, strictLimiter, async (req: Request, res: Response) => {
    try {
      const wallet = req.riftUser!.address;
      const parsed = kycSubmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Some details are missing or invalid.",
          errors: parsed.error.flatten().fieldErrors,
        });
      }
      const d = parsed.data;

      const [pending] = await db
        .select()
        .from(kycSubmissions)
        .where(
          and(
            sql`lower(${kycSubmissions.walletAddress}) = ${wallet.toLowerCase()}`,
            sql`${kycSubmissions.status} IN ('submitted','in_review')`,
          ),
        )
        .limit(1);
      if (pending) {
        return res.status(409).json({ message: "You already have a verification in review." });
      }

      const [row] = await db
        .insert(kycSubmissions)
        .values({ ...d, walletAddress: wallet.toLowerCase(), status: "submitted" })
        .returning();

      // Mirror onto the profile so the rest of the platform sees a pending state.
      await db
        .insert(userProfiles)
        .values({ walletAddress: wallet.toLowerCase(), kycStatus: "pending", kycTier: 0 })
        .onConflictDoUpdate({
          target: userProfiles.walletAddress,
          set: { kycStatus: "pending", submittedAt: new Date() },
        });

      const screening = await screenName({
        name: d.entityType === "business" ? d.companyName || d.fullName : d.fullName,
        country: d.country,
        birthDate: d.dateOfBirth,
        entityType: d.entityType,
        walletAddress: wallet,
        submissionId: row.id,
      });
      await screenWallet(wallet);

      const held = screening.status === "hit" || screening.status === "inconclusive";
      if (held) {
        await db.update(kycSubmissions).set({ status: "in_review" }).where(eq(kycSubmissions.id, row.id));
      }
      if (d.isPep) {
        await raiseAlert({
          kind: "pep",
          severity: "high",
          walletAddress: wallet,
          title: `Self-declared PEP: ${d.fullName}`,
          detail: "Policy §3.3 requires enhanced due diligence for politically exposed persons.",
          meta: { submissionId: row.id },
        });
      }

      // Confirm to the customer. Silence after uploading a passport is what
      // makes people email support or give up.
      emailKycReceived(row).catch((e) =>
        console.error("[compliance] confirmation email failed:", e?.message),
      );

      // Put it in the queue Finax watches, so it appears in the digest and in
      // any "is there anything waiting?" answer.
      db.insert(agentProposals)
        .values({
          kind: "compliance_backlog",
          title: `${d.fullName || d.companyName} applied for Tier ${d.requestedTier} verification`,
          rationale: held
            ? `Held for review — screening returned ${screening.status}. They cannot transact until it is cleared.`
            : `Waiting for review. They cannot transact until it is approved.`,
          payload: {
            body:
              `${d.fullName || d.companyName} has applied for Tier ${d.requestedTier} verification` +
              `${d.country ? ` from ${d.country}` : ""}.` +
              (held ? " It is held pending a screening decision." : ""),
            submissionId: row.id,
          },
          priority: held || d.isPep ? "high" : "normal",
          sourceType: "kyc_submission",
          sourceId: row.id,
        })
        .catch((e) => console.error("[compliance] could not queue the submission:", e?.message));

      // Only genuinely urgent things interrupt. Everything else waits for the
      // digest — an inbox full of routine notices is one where the urgent
      // message gets missed.
      if (held || d.isPep) {
        emailUrgentReview({
          submission: row,
          reason: screening.status === "hit" ? "sanctions" : d.isPep ? "pep" : "inconclusive",
          screening,
        }).catch((e) => console.error("[compliance] urgent email failed:", e?.message));
      }

      // The customer is told it is under review either way — a screening hit
      // is not something to disclose to its subject.
      res.status(201).json({ id: row.id, status: "submitted" });
    } catch (err: any) {
      console.error("[compliance] submit failed:", err?.message);
      res.status(500).json({ message: "Could not submit your verification" });
    }
  });

  // ═══ ADMIN ═════════════════════════════════════════════════════════════

  app.get("/api/admin/compliance/queue", requireAdmin, async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "submitted";
      let rows = await db.select().from(kycSubmissions).orderBy(desc(kycSubmissions.id)).limit(200);
      if (status && status !== "all") rows = rows.filter((r) => r.status === status);

      // Documents are large and only needed when one is opened.
      res.json(rows.map(({ documents, ...rest }) => ({ ...rest, documentCount: (documents ?? []).length })));
    } catch (err: any) {
      res.status(500).json({ message: "Could not load the queue" });
    }
  });

  app.get("/api/admin/compliance/submission/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [row] = await db.select().from(kycSubmissions).where(eq(kycSubmissions.id, id)).limit(1);
      if (!row) return res.status(404).json({ message: "Not found" });

      const screenings = await db
        .select()
        .from(sanctionsScreenings)
        .where(eq(sanctionsScreenings.submissionId, id))
        .orderBy(desc(sanctionsScreenings.id));

      res.json({ ...row, screenings, standing: await walletStanding(row.walletAddress) });
    } catch (err: any) {
      res.status(500).json({ message: "Could not load that submission" });
    }
  });

  /** Approve or reject. Only the approver may decide — same gate as the agent. */
  app.post("/api/admin/compliance/submission/:id/review", requireApprover, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid decision" });
      const { decision, grantedTier, notes } = parsed.data;

      const [row] = await db.select().from(kycSubmissions).where(eq(kycSubmissions.id, id)).limit(1);
      if (!row) return res.status(404).json({ message: "Not found" });
      if (row.status === "approved" || row.status === "rejected") {
        return res.status(409).json({ message: `Already ${row.status}.` });
      }

      const reviewer = (req as any).adminEmail ?? "admin";
      const tier = decision === "approved" ? (grantedTier ?? row.requestedTier) : 0;

      await db
        .update(kycSubmissions)
        .set({ status: decision, reviewerNotes: notes, reviewedBy: reviewer, reviewedAt: new Date() })
        .where(eq(kycSubmissions.id, id));

      await db
        .insert(userProfiles)
        .values({
          walletAddress: row.walletAddress,
          kycStatus: decision,
          kycTier: tier,
          isPep: row.isPep,
          sourceOfFunds: row.sourceOfFunds,
          reviewedAt: new Date(),
          reviewerNotes: notes,
        })
        .onConflictDoUpdate({
          target: userProfiles.walletAddress,
          set: {
            kycStatus: decision,
            kycTier: tier,
            isPep: row.isPep,
            sourceOfFunds: row.sourceOfFunds,
            reviewedAt: new Date(),
            reviewerNotes: notes,
          },
        });

      // Tell them the outcome. A rejection carries the reviewer's note so it
      // is actionable; it never mentions screening, which is an internal
      // finding and often a coincidence of spelling.
      (decision === "approved"
        ? emailKycApproved(row, tier)
        : emailKycRejected(row, notes)
      ).catch((e) => console.error("[compliance] decision email failed:", e?.message));

      res.json({ ok: true, status: decision, tier });
    } catch (err: any) {
      console.error("[compliance] review failed:", err?.message);
      res.status(500).json({ message: "Could not record that decision" });
    }
  });

  app.get("/api/admin/compliance/alerts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "open";
      let rows = await db.select().from(complianceAlerts).orderBy(desc(complianceAlerts.id)).limit(200);
      if (status && status !== "all") rows = rows.filter((r) => r.status === status);

      // Policy §4 gives 24 hours to review. Anything older is overdue, and
      // that number is what a supervisor would ask for.
      const overdue = rows.filter(
        (r) => r.status === "open" && r.openedAt && Date.now() - new Date(r.openedAt).getTime() > 86_400_000,
      ).length;

      res.json({ alerts: rows, overdue, reviewWindowHours: 24 });
    } catch (err: any) {
      res.status(500).json({ message: "Could not load alerts" });
    }
  });

  app.post("/api/admin/compliance/alerts/:id/resolve", requireApprover, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const status = req.body?.status === "escalated" ? "escalated" : "cleared";
      await db
        .update(complianceAlerts)
        .set({
          status,
          resolution: String(req.body?.resolution || "").slice(0, 4000),
          resolvedBy: (req as any).adminEmail ?? "admin",
          resolvedAt: new Date(),
        })
        .where(eq(complianceAlerts.id, id));
      res.json({ ok: true, status });
    } catch (err: any) {
      res.status(500).json({ message: "Could not resolve that alert" });
    }
  });

  /** Run screening by hand, for a name or an address. */
  app.post("/api/admin/compliance/screen", requireAdmin, strictLimiter, async (req: Request, res: Response) => {
    try {
      const subject = String(req.body?.subject || "").trim();
      if (!subject) return res.status(400).json({ message: "Give a name or wallet address." });
      const isWallet = /^0x[a-fA-F0-9]{40}$/.test(subject);
      res.json(
        isWallet
          ? await screenWallet(subject)
          : await screenName({ name: subject, country: req.body?.country, entityType: req.body?.entityType }),
      );
    } catch (err: any) {
      res.status(500).json({ message: "Screening failed" });
    }
  });

  /** Re-screen approved customers — the "ongoing basis" in policy §5. */
  app.post("/api/admin/compliance/rescreen", requireApprover, strictLimiter, async (_req: Request, res: Response) => {
    try {
      res.json(await rescreenApproved(50));
    } catch (err: any) {
      res.status(500).json({ message: "Re-screening failed" });
    }
  });

  /** Headline numbers for the compliance dashboard. */
  app.get("/api/admin/compliance/summary", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const subs = await db.select({ status: kycSubmissions.status }).from(kycSubmissions);
      const alerts = await db.select({ status: complianceAlerts.status }).from(complianceAlerts);
      const screens = await db
        .select({ matched: sanctionsScreenings.matched })
        .from(sanctionsScreenings);
      const profiles = await db.select({ tier: userProfiles.kycTier }).from(userProfiles);

      const byTier: Record<string, number> = {};
      for (const p of profiles) byTier[String(p.tier ?? 0)] = (byTier[String(p.tier ?? 0)] ?? 0) + 1;

      res.json({
        submissions: {
          total: subs.length,
          awaitingReview: subs.filter((s) => s.status === "submitted" || s.status === "in_review").length,
          approved: subs.filter((s) => s.status === "approved").length,
          rejected: subs.filter((s) => s.status === "rejected").length,
        },
        alerts: {
          open: alerts.filter((a) => a.status === "open").length,
          total: alerts.length,
        },
        screenings: { total: screens.length, hits: screens.filter((s) => s.matched).length },
        verifiedByTier: byTier,
        thresholds: {
          windowDays: LIMIT_WINDOW_DAYS,
          singleTransactionUsd: MONITORING.singleTransactionUsd,
          cumulativeUsd: MONITORING.cumulativeUsd,
          tiers: KYC_TIERS,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: "Could not load the summary" });
    }
  });
}
