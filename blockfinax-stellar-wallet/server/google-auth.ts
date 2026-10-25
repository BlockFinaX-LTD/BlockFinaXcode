import type { Express, RequestHandler, Response } from "express";
import type { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { Challenges, randomToken } from "./security.js";

export type GoogleClient = Pick<OAuth2Client,
  "generateAuthUrl" | "getToken" | "verifyIdToken">;

export function registerGoogleAuth(app: Express, options: {
  origin: string;
  clientId: string | undefined;
  client: () => GoogleClient;
  limit: RequestHandler;
  findUser: (email: string) => string;
  login: (res: Response, id: string) => Promise<void>;
}) {
  const states = new Challenges();
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: options.origin.startsWith("https://"),
    path: "/api/auth/google",
  };
  app.get("/api/auth/google", options.limit, (_req, res) => {
    const client = options.client();
    const state = randomToken();
    states.put(state, state);
    res.cookie("bfx_oauth", state, { ...cookieOptions, maxAge: 300_000 });
    res.redirect(client.generateAuthUrl({
      scope: ["openid", "email", "profile"],
      state,
      access_type: "online",
    }));
  });
  app.get("/api/auth/google/callback", options.limit, async (req, res) => {
    const state = z.string().min(32).max(128).parse(req.query.state);
    const cookieState = req.headers.cookie?.split(/;\s*/)
      .find((value) => value.startsWith("bfx_oauth="))?.slice(10);
    if (state !== cookieState) throw Error("Google sign-in state mismatch");
    res.clearCookie("bfx_oauth", cookieOptions);
    // A matching cookie alone is insufficient: expire and consume the server's
    // challenge as well, including on cancelled or unsuccessful attempts.
    states.take(state);
    if (req.query.error) {
      res.redirect("/?auth_error=google_cancelled");
      return;
    }
    const code = z.string().min(1).max(4096).parse(req.query.code);
    try {
      const client = options.client();
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token) throw Error("Missing Google ID token");
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: options.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email_verified !== true)
        throw Error("Google email must be verified");
      const email = z.email().max(254).parse(payload.email).toLowerCase();
      await options.login(res, options.findUser(email));
    } catch {
      // Provider errors may contain token exchange details. Keep them out of
      // browser responses and let the user retry or use their email code.
      res.redirect("/?auth_error=google_failed");
      return;
    }
    res.redirect("/");
  });
}
