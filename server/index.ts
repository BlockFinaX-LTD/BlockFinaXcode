/**
 * Server Entry Point
 *
 * Express.js server with WebSocket support for blockchain communication platform.
 * Handles API routing, database initialization, request logging, and error handling.
 */

import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./init-db";
import { startAllOracleNodes } from "./multi-oracle/start-all";
import { startupChainSync } from "./chain-sync";
import { startDailyRefresh } from "./pricing/dailyRefresh";

// Prevent non-fatal internal errors (e.g. Vite build warnings) from killing the server process
const _originalExit = process.exit.bind(process);
(process as any).exit = (code?: number) => {
  if (code === 1) {
    console.error('[Server] Suppressed exit(1) — keeping server alive');
    return undefined as never;
  }
  return _originalExit(code as never);
};

const app = express();

// Security headers — must be applied before any routes
const isProd = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: isProd ? {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      // style-src needs Google Fonts because index.html loads Inter + Geist
      // Mono from fonts.googleapis.com. Without it the page renders with
      // system fonts and the stylesheet is blocked.
      styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc:         [
        "'self'",
        "data:",
        "blob:",
        "https:",
      ],
      // font-src needs gstatic.com because Google Fonts CSS pulls font
      // files from there once the stylesheet is parsed.
      fontSrc:        ["'self'", "data:", "https://fonts.gstatic.com"],
      connectSrc: [
        "'self'",
        // Lisk
        "https://rpc.sepolia-api.lisk.com",
        "https://rpc.api.lisk.com",
        "https://blockscout.lisk.com",
        "https://sepolia-blockscout.lisk.com",
        "wss://rpc.sepolia-api.lisk.com",
        "wss://rpc.api.lisk.com",
        // Base (multi-chain support added with v8)
        "https://mainnet.base.org",
        "https://sepolia.base.org",
        "https://base.blockscout.com",
        "https://api.basescan.org",
        // BSC (multi-chain support added with v8)
        "https://bsc-dataseed.binance.org",
        "https://data-seed-prebsc-1-s1.binance.org:8545",
        "https://api.bscscan.com",
        // Google OAuth
        "https://accounts.google.com",
        "https://oauth2.googleapis.com",
        // Rift Finance — wallet SDK calls these directly from the browser
        "https://payment.riftfi.xyz",
        "https://*.riftfi.xyz",
        "https://*.rift.fi",
        "https://*.rift-finance.com",
        // Cloudinary — direct-to-cloud upload for task evidence
        "https://api.cloudinary.com",
        "https://res.cloudinary.com",
      ],
      // frame-src must include the Rift sign-in widget; otherwise the
      // iframe is blocked and users can't sign in.
      frameSrc: [
        "https://accounts.google.com",
        "https://widget.riftfi.xyz",
        "https://*.riftfi.xyz",
        "https://*.rift.fi",
      ],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'", "https://accounts.google.com"],
      upgradeInsecureRequests: [],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Request logging middleware for API endpoints
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // ── Production environment guard ─────────────────────────────────────────
  // Fail loudly at startup if critical secrets are missing — better to crash
  // immediately than to silently serve a broken app to real users.
  if (process.env.NODE_ENV === "production") {
    const required = [
      "DATABASE_URL",
      "ADMIN_PASSWORD",
      "DEPLOYER_PRIVATE_KEY",
      "TREASURY_POOL_PRIVATE_KEY",
      "RESEND_API_KEY",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) {
      console.error(`[Startup] FATAL — missing required environment variables: ${missing.join(", ")}`);
      process.exit(1);
    }
    // Warn if NETWORK_MODE is not explicitly set to mainnet in production
    if (process.env.NETWORK_MODE !== "mainnet") {
      console.warn("[Startup] WARNING — NETWORK_MODE is not 'mainnet'. Running in testnet mode in a production deployment.");
    }
  }

  // Initialize database with default networks
  try {
    await initializeDatabase();
  } catch (error) {
    console.error("Database initialization failed:", error);
  }

  // Register oracle node wallets on the Diamond (using deployer key, idempotent)
  try {
    const { registerOracleNodes } = await import("./oracle-registration");
    await registerOracleNodes();
  } catch (e: any) {
    console.error("[OracleReg] Unexpected error:", e.message);
  }

  // Start multi-oracle nodes (only if keys and DIAMOND_ADDRESS are configured)
  startAllOracleNodes();

  // Sync on-chain hedge events into the DB (non-blocking — runs in background)
  startupChainSync().catch((e) => console.error("[ChainSync] Startup sync error:", e?.message));

  // Pricing-engine daily close refresh (TwelveData → historical_fx_closes table).
  // No-op if TWELVEDATA_API_KEY is not configured.
  startDailyRefresh();

  // Auto-expire hedge events whose expiryDate has passed — runs at startup and every hour.
  // Keeps DB status consistent even when ChainSync hasn't run or the oracle hasn't settled yet.
  async function markExpiredHedgeEvents() {
    try {
      const { storage } = await import("./storage");
      const all = await storage.getAllHedgeEvents();
      const now = new Date();
      const expired = all.filter(e => e.status === "open" && new Date(e.expiryDate) <= now);
      for (const e of expired) {
        await storage.updateHedgeEvent(e.id, { status: "expired" });
        console.log(`[AutoExpire] Event #${e.id} (${e.name}) marked expired`);
      }
      if (expired.length === 0) console.log("[AutoExpire] No newly expired events");
    } catch (err: any) {
      console.warn("[AutoExpire] Failed to mark expired events:", err?.message);
    }
  }
  markExpiredHedgeEvents();
  setInterval(markExpiredHedgeEvents, 60 * 60 * 1000); // re-check every hour

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error(`[Error] ${status} - ${message}`, err.stack || '');
    res.status(status).json({ message });
  });

  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException] Server error (continuing):', err.message);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection] Unhandled promise rejection (continuing):', reason);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  const isDev = process.env.NODE_ENV === "development";
  console.log(`🔧 Server mode: ${isDev ? 'DEVELOPMENT (Vite middleware)' : 'PRODUCTION (static files)'}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`   app.get('env'): ${app.get("env")}`);
  
  if (isDev) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  server.listen(port, host, () => {
    log(`serving on port ${port}`);
  });
})();
