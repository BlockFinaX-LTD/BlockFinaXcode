/**
 * Who is calling: a BlockFinaX sign-in session (email or Google, then passkey).
 *
 * The bearer token is the session token from /api/auth. The caller's address is their
 * passkey smart account on the EVM network, which is how older per-wallet records
 * (compliance, notifications, chat) are keyed. Routes read identity only from here,
 * never from the request body.
 */
import type { Request, Response, NextFunction } from "express";

export interface SessionUser {
  /** The user's EVM smart account, lowercased. */
  address: string;
  email: string | null;
  /** "bfx-<user id>". */
  user: string;
}

declare global {
  namespace Express {
    interface Request {
      sessionUser?: SessionUser;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = (req.headers.authorization || req.headers.Authorization) as string | undefined;
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

/** The user behind a session token, or null when it is unknown, expired or has no wallet yet. */
export async function verifySessionToken(sessionToken: string): Promise<SessionUser | null> {
  const { getSession } = await import("../auth-routes");
  const session = await getSession({ headers: { authorization: `Bearer ${sessionToken}` } });
  if (!session?.userId) return null;
  const { db } = await import("../db");
  const { chainWalletAccounts } = await import("@shared/chain-wallet-schema");
  const { userAccounts } = await import("@shared/auth-core-schema");
  const { and, eq } = await import("drizzle-orm");
  const [account] = await db.select().from(chainWalletAccounts)
    .where(and(eq(chainWalletAccounts.userId, session.userId), eq(chainWalletAccounts.chainNamespace, "eip155"), eq(chainWalletAccounts.status, "active")))
    .limit(1);
  if (!account) return null;
  const [user] = await db.select().from(userAccounts).where(eq(userAccounts.id, session.userId));
  return { address: account.address.toLowerCase(), email: user?.email ?? null, user: `bfx-${session.userId}` };
}

/** Rejects with 401 unless the bearer token is a live session; attaches req.sessionUser. */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: "Authentication required" });
  const user = await verifySessionToken(token);
  if (!user) return res.status(401).json({ error: "Your session is invalid or expired. Sign in again." });
  req.sessionUser = user;
  next();
}
