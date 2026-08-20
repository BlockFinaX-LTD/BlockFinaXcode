/**
 * Server Routes Orchestrator
 *
 * Registers all API routes by delegating to focused sub-modules.
 *
 * Sub-modules:
 *   investor  — /api/investor/*  (data-room auth + file upload)
 *   admin     — /api/admin/*     (dashboard, KYC review, backup)
 *   kyc       — /api/kyc/*       (user-facing KYC + webhook)
 *   wallet    — /api/wallets/*, /api/networks, /api/stats
 *   protocol  — /api/gas, /api/fees, /api/prices, /api/fx, /api/hedge
 *   community — /api/tasks, /api/referrals, /api/terms, /api/articles
 */

import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { generalApiLimiter, financialMutationLimiter, walletLimiter } from "./middleware/rate-limiter";
import { requireSignature, type AuthenticatedRequest } from "./middleware/signature-auth";
import { registerAuthRoutes } from "./auth-routes";
import { registerInvestorRoutes } from "./routes/investor";
import { registerAdminRoutes } from "./routes/admin";
import { registerKycRoutes } from "./routes/kyc";
import { registerWalletRoutes } from "./routes/wallet";
import { registerProtocolRoutes } from "./routes/protocol";
import { registerOutreachRoutes } from "./routes/outreach";
import { registerProspectRoutes } from "./routes/prospects";
import { registerCommunityRoutes } from "./routes/community";
import { registerRiftProxy } from "./routes/rift-proxy";
import { registerMercuryoRoutes } from "./routes/mercuryo";
import { registerPricingRoutes } from "./routes/pricing";
import { registerGateRoutes } from "./routes/gate";
import { registerLoiRoutes } from "./routes/loi";
import { registerAgentRoutes } from "./routes/agent";
import { registerAgentChatRoutes } from "./routes/agent-chat";
import { registerComplianceRoutes } from "./routes/compliance";
import { registerLeadRoutes } from "./routes/leads";
import { registerSignatureRoutes } from "./routes/signature";
import { registerNotificationRoutes } from "./routes/notifications";

export async function registerRoutes(app: Express): Promise<Server> {
  // ── Rate limiters ──────────────────────────────────────────────────────────
  app.use("/api/", generalApiLimiter);
  app.use("/api/hedge/", financialMutationLimiter);
  app.use("/api/wallets/", walletLimiter);

  // ── Auth routes (magic link, Google, WebAuthn, sessions) ──────────────────
  registerAuthRoutes(app);

  // ── Signature requirement on sensitive write routes ────────────────────────
  const signedRoutePrefixes = ["/api/hedge/"];
  app.use((req, res, next) => {
    const isWriteMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    const isSensitiveRoute = signedRoutePrefixes.some(prefix => req.path.startsWith(prefix));
    if (isWriteMethod && isSensitiveRoute) return requireSignature(req as AuthenticatedRequest, res, next);
    next();
  });

  // ── Sub-module registration ────────────────────────────────────────────────
  // Dev-only: Rift's API sends no CORS headers for localhost, so in development
  // browser calls are routed through this same-origin proxy. No-op in production.
  registerRiftProxy(app);
  registerInvestorRoutes(app);
  registerKycRoutes(app);
  registerWalletRoutes(app);
  registerCommunityRoutes(app);
  registerMercuryoRoutes(app);
  registerPricingRoutes(app);
  registerGateRoutes(app);
  registerLoiRoutes(app);
  registerAgentRoutes(app);
  registerAgentChatRoutes(app);
  registerComplianceRoutes(app);
  registerLeadRoutes(app);
  registerSignatureRoutes(app);
  registerNotificationRoutes(app);
  await registerProtocolRoutes(app);
  registerOutreachRoutes(app);
  registerProspectRoutes(app);

  // NOTE: The public/integrator REST API used to live at /api/v1 here.
  // It now ships as a standalone repo deployed independently:
  //   https://github.com/BlockFinaX-LTD/blockfinax-integrator-api
  // /v1/pricing/* in that API proxies back to /api/pricing/* on this server.

  // ── WebSocket server (wallet-scoped pub/sub) ───────────────────────────────
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const connectedClients = new Map<string, WebSocket>();

  wss.on('connection', (ws: WebSocket) => {
    let clientWalletAddress: string | null = null;

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'authenticate') {
          clientWalletAddress = message.walletAddress?.toLowerCase();
          if (clientWalletAddress) connectedClients.set(clientWalletAddress, ws);
          ws.send(JSON.stringify({ type: 'authenticated', walletAddress: clientWalletAddress }));
        }
      } catch { /* ignore malformed messages */ }
    });

    ws.on('close', () => { if (clientWalletAddress) connectedClients.delete(clientWalletAddress); });
    ws.on('error', () => { if (clientWalletAddress) connectedClients.delete(clientWalletAddress); });
  });

  // Admin routes registered last — they need access to wss for health check
  registerAdminRoutes(app, wss);

  return httpServer;
}
