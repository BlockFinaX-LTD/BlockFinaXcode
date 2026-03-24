/**
 * Server Entry Point
 * 
 * Express.js server with WebSocket support for blockchain communication platform.
 * Handles API routing, database initialization, request logging, and error handling.
 */

import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./init-db";

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
app.use(helmet({
  contentSecurityPolicy: false, // CSP managed separately; disabling avoids breaking Vite HMR in dev
  crossOriginEmbedderPolicy: false, // Allow iframe embedding for wallet previews
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
