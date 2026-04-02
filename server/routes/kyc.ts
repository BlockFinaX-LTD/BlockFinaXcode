import type { Express } from "express";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { userProfiles } from "../../shared/profile-schema";
import { requireSignature, type AuthenticatedRequest } from "../middleware/signature-auth";

export function registerKycRoutes(app: Express) {
  app.post("/api/kyc/initiate", requireSignature, async (req: AuthenticatedRequest, res) => {
    try {
      const { getKycProvider } = await import("../kyc-provider");
      const provider = getKycProvider();

      const walletAddress = req.walletAddress!;
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.walletAddress, walletAddress));

      if (profile?.kycStatus === "approved") {
        return res.json({ status: "approved", message: "KYC already approved" });
      }

      const session = await provider.createSession({
        walletAddress,
        firstName: profile?.firstName,
        lastName: profile?.lastName,
        email: profile?.email,
        dateOfBirth: profile?.dateOfBirth,
        country: profile?.country,
        nationality: profile?.nationality,
      });

      const now = new Date();
      if (profile) {
        await db.update(userProfiles).set({
          kycStatus: "pending",
          kycProvider: provider.name,
          kycProviderRef: session.ref,
          submittedAt: profile.submittedAt || now,
          lastUpdated: now,
        }).where(eq(userProfiles.walletAddress, walletAddress));
      } else {
        await db.insert(userProfiles).values({
          walletAddress,
          kycStatus: "pending",
          kycProvider: provider.name,
          kycProviderRef: session.ref,
          submittedAt: now,
        });
      }

      res.json({
        provider: provider.name,
        ref: session.ref,
        redirectUrl: session.redirectUrl || null,
        sdkToken: session.sdkToken || null,
        expiresAt: session.expiresAt || null,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/kyc/status", requireSignature, async (req: AuthenticatedRequest, res) => {
    try {
      const walletAddress = req.walletAddress!;
      const [profile] = await db.select({
        kycStatus: userProfiles.kycStatus,
        kycTier: userProfiles.kycTier,
        kycProvider: userProfiles.kycProvider,
        kycProviderRef: userProfiles.kycProviderRef,
        submittedAt: userProfiles.submittedAt,
        reviewedAt: userProfiles.reviewedAt,
      }).from(userProfiles).where(eq(userProfiles.walletAddress, walletAddress));

      if (!profile) return res.json({ kycStatus: "not_started", kycTier: 0 });
      res.json(profile);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/kyc/webhook", async (req, res) => {
    try {
      const { getKycProvider } = await import("../kyc-provider");
      const provider = getKycProvider();

      if (provider.name === "manual") {
        return res.status(400).json({ message: "Manual provider does not accept webhooks" });
      }

      const rawBody = JSON.stringify(req.body);
      const sig = (req.headers["x-payload-digest"] ||
                   req.headers["x-sha2-signature"] ||
                   req.headers["x-didit-signature"] ||
                   req.headers["x-onfido-signature"] || "") as string;

      if (!provider.verifyWebhook(rawBody, sig.replace(/^sha256=/, ""))) {
        console.warn("[KYC Webhook] Signature verification failed");
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const result = provider.parseWebhook(req.body);
      const ref = result.providerRef;

      if (!ref) {
        console.warn("[KYC Webhook] No provider ref in payload");
        return res.status(400).json({ message: "No provider ref in payload" });
      }

      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.kycProviderRef, ref));

      if (!profile) {
        console.warn(`[KYC Webhook] No profile found for ref ${ref}`);
        return res.status(404).json({ message: "No profile found for ref" });
      }

      const now = new Date();
      await db.update(userProfiles).set({
        kycStatus: result.status,
        kycTier: result.tier,
        reviewerNotes: result.notes || profile.reviewerNotes,
        reviewedAt: (result.status === "approved" || result.status === "rejected") ? now : profile.reviewedAt,
        kycWebhookData: rawBody,
        lastUpdated: now,
      }).where(eq(userProfiles.kycProviderRef, ref));

      console.log(`[KYC Webhook] ${profile.walletAddress} → ${result.status} (tier ${result.tier})`);
      res.json({ received: true });
    } catch (e: any) {
      console.error("[KYC Webhook] Error:", e.message);
      res.status(500).json({ message: e.message });
    }
  });
}
