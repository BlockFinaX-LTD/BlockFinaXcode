/**
 * Organisation (business) accounts.
 *
 *   GET  /api/organisations/config                          what this deployment offers
 *   GET  /api/organisations                                 my organisations
 *   POST /api/organisations                     { name }    create one (deploys its account)
 *   GET  /api/organisations/:id                             members and settings
 *   GET  /api/organisations/:id/history                     who changed what, with transactions
 *   POST /api/organisations/:id/deploy                      retry a failed deployment
 *   POST /api/organisations/:id/invites         { email, role }
 *   POST /api/organisations/invites/accept      { token }
 *   POST /api/organisations/:id/members/:mid/revoke         withdraw an invitation
 *   POST /api/organisations/:id/members/:mid/changes        { kind: activate|remove|role, role? }
 *   POST /api/organisations/:id/members/:mid/next           prepare the current step again
 *   POST /api/organisations/:id/members/:mid/confirm        { hash }
 *
 * Every route needs a signed-in user. Membership and role are checked by the service on
 * every request, never cached in the client.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { getAppOrigin, getSession } from "../auth-routes";
import { escapeHtml, sendEmail, shell } from "../email";
import { databasePasskeys, organisationChainConfig, stellarGateway } from "./gateway";
import { PostgresOrganisationRepository } from "./repository";
import { INVITE_DAYS, OrganisationError, OrganisationService } from "./service";

let cached: OrganisationService | null | undefined;

/** The service, or null when this deployment does not offer organisations. */
export async function organisationService(): Promise<OrganisationService | null> {
  if (cached !== undefined) return cached;
  const gateway = stellarGateway();
  if (!gateway) return (cached = null);
  const { pool } = await import("../db");
  if (!pool) return (cached = null);
  return (cached = new OrganisationService(new PostgresOrganisationRepository(pool as never), gateway, databasePasskeys()));
}

async function requireUser(req: Request): Promise<number> {
  const session = await getSession(req);
  if (!session?.userId) throw new OrganisationError(401, "UNAUTHORIZED", "Sign in first");
  return session.userId;
}

async function service() {
  const s = await organisationService();
  if (!s) throw new OrganisationError(503, "NOT_OFFERED", "Business accounts are not available on this deployment yet");
  return s;
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const ROLE_WORDS: Record<string, string> = {
  admin: "an admin, who can manage the account, its members and its money",
  operator: "an operator, who can buy cover and manage liquidity for the business",
  viewer: "a viewer, who can see balances, cover and statements",
};

async function emailInvite(to: string, organisation: string, role: string, link: string) {
  const body = `
    <h2 style="font-size:18px;margin:0 0 12px;font-weight:600;">You have been invited to ${escapeHtml(organisation)}</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">${escapeHtml(organisation)} uses BlockFinaX to protect its payments against currency moves. You have been added as ${escapeHtml(ROLE_WORDS[role] ?? role)}.</p>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;">Sign in with this email address, then open the link below. If you have not used BlockFinaX before, you will create a passkey on your phone first. It takes about a minute.</p>
    <p style="margin:20px 0;"><a href="${link}" style="background:#1a4480;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px;">Accept the invitation</a></p>
    <p style="font-size:12px;color:#6b7280;">The link works once and expires in ${INVITE_DAYS} days. If you were not expecting it, you can ignore this email.</p>
  `;
  return sendEmail({ to, subject: `Join ${organisation} on BlockFinaX`, html: shell("Invitation", body) });
}

export function registerOrganisationRoutes(app: Express) {
  app.get("/api/organisations/config", wrap(async (_req, res) => {
    const chain = organisationChainConfig();
    const gateway = stellarGateway();
    res.json({
      available: Boolean(gateway),
      chain: chain?.key ?? null,
      smartAccounts: chain?.smartAccounts ?? null,
      contracts: gateway?.contracts() ?? null,
      // Operators need BlockFinaX's transfer allow-list policy deployed on this network.
      operatorsAvailable: Boolean(chain?.smartAccounts?.transferAllowlistPolicy),
    });
  }));

  app.get("/api/organisations", wrap(async (req, res) => {
    const uid = await requireUser(req);
    const s = await organisationService();
    res.json({ organisations: s ? await s.list(uid) : [] });
  }));

  app.post("/api/organisations", wrap(async (req, res) => {
    const uid = await requireUser(req);
    res.json(await (await service()).create(uid, req.body?.name));
  }));

  app.post("/api/organisations/invites/accept", wrap(async (req, res) => {
    const uid = await requireUser(req);
    res.json(await (await service()).accept(uid, req.body?.token));
  }));

  app.get("/api/organisations/:id", wrap(async (req, res) => {
    const uid = await requireUser(req);
    res.json(await (await service()).view(uid, Number(req.params.id)));
  }));

  app.get("/api/organisations/:id/history", wrap(async (req, res) => {
    const uid = await requireUser(req);
    res.json({ events: await (await service()).history(uid, Number(req.params.id), Number(req.query.limit ?? 50)) });
  }));

  app.post("/api/organisations/:id/deploy", wrap(async (req, res) => {
    const uid = await requireUser(req);
    const s = await service();
    await s.deploy(Number(req.params.id), uid);
    res.json(await s.view(uid, Number(req.params.id)));
  }));

  app.post("/api/organisations/:id/invites", wrap(async (req, res) => {
    const uid = await requireUser(req);
    const s = await service();
    const id = Number(req.params.id);
    const { member, token } = await s.invite(uid, id, req.body ?? {});
    const link = `${getAppOrigin(req)}/organisations/invite#token=${token}`;
    const org = await s.view(uid, id);
    const sent = await emailInvite(member.email, org.name, member.role, link).catch(() => ({ ok: false }));
    // The link is returned too, so an admin can share it another way if email fails.
    res.json({ member, link, emailed: Boolean(sent?.ok) });
  }));

  app.post("/api/organisations/:id/members/:mid/revoke", wrap(async (req, res) => {
    const uid = await requireUser(req);
    await (await service()).revokeInvite(uid, Number(req.params.id), Number(req.params.mid));
    res.json({ ok: true });
  }));

  app.post("/api/organisations/:id/members/:mid/changes", wrap(async (req, res) => {
    const uid = await requireUser(req);
    res.json(await (await service()).start(uid, Number(req.params.id), Number(req.params.mid), req.body ?? {}));
  }));

  app.post("/api/organisations/:id/members/:mid/next", wrap(async (req, res) => {
    const uid = await requireUser(req);
    res.json(await (await service()).next(uid, Number(req.params.id), Number(req.params.mid)));
  }));

  app.post("/api/organisations/:id/members/:mid/confirm", wrap(async (req, res) => {
    const uid = await requireUser(req);
    res.json(await (await service()).confirm(uid, Number(req.params.id), Number(req.params.mid), req.body?.hash));
  }));

  app.use("/api/organisations", (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof OrganisationError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    console.error("[organisations]", err);
    res.status(500).json({ error: { code: "UNKNOWN", message: "Something went wrong. Please try again." } });
  });
}
