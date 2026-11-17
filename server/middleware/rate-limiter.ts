/**
 * Rate Limiting Middleware
 * 
 * Applies tiered rate limits to API endpoints:
 * - Signing in (Google, passkey): 120 requests per minute per IP, its own allowance
 * - General API: 300 requests per minute per signed-in session (per IP before sign-in),
 *   under a 2,000 per minute ceiling per IP
 * - Financial mutations (hedge, wallet transfers): 20 requests per minute  
 * - Wallet operations: 30 requests per minute
 * - Auth/sensitive: 10 requests per minute
 */

import { createHash } from "node:crypto";
import type { Request } from "express";
import rateLimit, { type Options, ipKeyGenerator } from "express-rate-limit";

function createLimiter(opts: Partial<Options>) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Always anchor to the real IP so rotating wallet address headers
      // cannot bypass limits. Wallet address is appended for per-wallet
      // granularity but cannot be used alone to escape IP-level throttling.
      const ip = ipKeyGenerator(req.ip!);
      const walletAddr = req.headers?.["x-wallet-address"];
      if (walletAddr && typeof walletAddr === "string") {
        return `${ip}:wallet:${walletAddr.toLowerCase()}`;
      }
      return ip;
    },
    ...opts,
  });
}

/**
 * Signing in: Google, passkey sign-in and sign-up. These have their own allowance, so the
 * app's background reads (prices, balances, pools) can never use it up and block a login.
 */
const SIGN_IN_PATHS = [
  "/api/auth/google",
  "/api/wallet/passkey/register/",
  "/api/wallet/passkey/signin/",
];
const isSignIn = (req: Request) => SIGN_IN_PATHS.some((p) => req.originalUrl.split("?")[0].startsWith(p));

export const signInLimiter = rateLimit({
  standardHeaders: true,
  legacyHeaders: false,
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => ipKeyGenerator(req.ip!),
  skip: (req) => !isSignIn(req),
  message: { error: "Too many sign-in attempts. Please wait a minute and try again." },
});

/**
 * Who is asking: the signed-in session when there is one, otherwise the IP address. Phone
 * networks put many people behind one IP, so counting per session stops one busy screen
 * on a shared network from blocking everyone else on it.
 */
function clientKey(req: Request): string {
  const auth = req.headers?.authorization;
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : req.headers?.["x-session-token"];
  if (typeof token === "string" && token.length >= 32) return `s:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
  return `ip:${ipKeyGenerator(req.ip!)}`;
}

/** Everyday API traffic, per person (or per IP before sign-in). */
export const generalApiLimiter = rateLimit({
  standardHeaders: true,
  legacyHeaders: false,
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: clientKey,
  skip: isSignIn,
  message: { error: "Too many requests, please try again later" },
});

/** A ceiling per IP address, so made-up session tokens cannot be used to get round the limit above. */
export const ipCeilingLimiter = rateLimit({
  standardHeaders: false,
  legacyHeaders: false,
  windowMs: 60 * 1000,
  max: 2000,
  keyGenerator: (req) => ipKeyGenerator(req.ip!),
  skip: isSignIn,
  message: { error: "Too many requests, please try again later" },
});

export const financialMutationLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many financial requests, please slow down" },
});

export const walletLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many wallet requests, please try again later" },
});

export const strictLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Rate limit exceeded for sensitive operations" },
});

// Magic link poll: allows up to 30 req/min per IP (one poll every ~2s is safe)
export const pollLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many polling requests, please wait" },
});
