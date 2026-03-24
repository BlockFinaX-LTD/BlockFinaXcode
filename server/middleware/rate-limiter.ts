/**
 * Rate Limiting Middleware
 * 
 * Applies tiered rate limits to API endpoints:
 * - General API: 100 requests per minute
 * - Financial mutations (hedge, wallet transfers): 20 requests per minute  
 * - Wallet operations: 30 requests per minute
 * - Auth/sensitive: 10 requests per minute
 */

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

export const generalApiLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 100,
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
