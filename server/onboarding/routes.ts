/**
 * Onboarding endpoints (see ./service.ts).
 *
 *   GET  /api/v2/onboarding    { completed, accountType, ... } for the signed-in user
 *   POST /api/v2/onboarding    save the form; screening runs afterwards in the background
 */
import type { Express, Request, Response } from "express";
import { ApplicationError } from "@shared/domain/types";
import { validateOnboarding } from "@shared/onboarding";
import { accountCreatedAt, getOnboarding, predatesOnboarding, saveOnboarding, screenOnboarding } from "./service";

type Handler = (req: Request, res: Response) => Promise<void>;
interface Deps {
  userId: (req: Request) => Promise<number>;
  wrap: (h: Handler) => any;
}

async function view(userId: number) {
  const found = await getOnboarding(userId);
  if (!found) return { completed: predatesOnboarding(await accountCreatedAt(userId)) };
  const { row, organisation } = found;
  return {
    completed: true,
    accountType: row.account_type,
    fullName: row.full_name,
    country: row.country,
    phone: row.phone,
    jobTitle: row.job_title,
    intents: row.intents,
    organisation: organisation && {
      id: organisation.id,
      legalName: organisation.legal_name,
      registrationCountry: organisation.registration_country,
      registrationNumber: organisation.registration_number,
      industry: organisation.industry,
      monthlyVolume: organisation.monthly_volume,
      verificationStatus: organisation.verification_status,
    },
  };
}

export function registerOnboardingRoutes(app: Express, d: Deps) {
  app.get("/api/v2/onboarding", d.wrap(async (req, res) => {
    res.json(await view(await d.userId(req)));
  }));

  app.post("/api/v2/onboarding", d.wrap(async (req, res) => {
    const uid = await d.userId(req);
    const { value, problems } = validateOnboarding(req.body);
    if (problems.length) throw new ApplicationError("INVALID_REQUEST", problems[0]!);
    await saveOnboarding(uid, value);
    void screenOnboarding(uid, value);
    res.json(await view(uid));
  }));
}
