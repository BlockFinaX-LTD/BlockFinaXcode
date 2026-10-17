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
import { backfillChainLogs } from "./chain-logs";
import { startDailyRefresh } from "./pricing/dailyRefresh";
import { startDigestSweep } from "./agent/notify";
import { startDepositSweep } from "./compliance/wallet-watch";
import { startFollowUpSweep } from "./routes/leads";

const app = express();
// No ETags — API responses set `Cache-Control: no-store` below; this prevents
// any 304 Not Modified revalidation across the app.
app.set('etag', false);

/**
 * Trust exactly one proxy hop.
 *
 * Railway terminates TLS and forwards, so without this every request arrives
 * looking like it came from the proxy. Express then reports that one address as
 * req.ip for everybody, and the rate limiter keys on req.ip.
 *
 * Two things follow, and they pull in opposite directions. Every anonymous
 * visitor shares a single bucket, so a handful of real users can exhaust a
 * limit meant to be per-person. And the limiter's own defence is defeated: the
 * key generator appends x-wallet-address specifically so that "rotating wallet
 * address headers cannot bypass limits", but that only holds if the IP half is
 * genuinely per-client. With a constant IP, rotating the header hands out a
 * fresh bucket every request.
 *
 * Measured before this was set: three identical requests each reported 99 of
 * 100 remaining, so nothing was accumulating at all.
 *
 * The value is 1 rather than true. `true` trusts the whole X-Forwarded-For
 * chain, which a client can prepend to at will, so it would let anyone claim
 * any address and pick their own bucket. One hop means the last proxy, which is
 * Railway, and that is the only hop we actually control.
 */
app.set('trust proxy', 1);

// Security headers — must be applied before any routes
const isProd = process.env.NODE_ENV === 'production';

/**
 * Canonical host redirect.
 *
 * Both blockfinax.com and www.blockfinax.com are attached to this service in
 * Railway, so both serve the app directly. Browsers treat them as two separate
 * origins, and the Rift session lives in localStorage, which is per origin. A
 * user signed in on one therefore appears signed out on the other, with an
 * empty wallet balance and no error to explain it.
 *
 * www is canonical because PUBLIC_APP_URL and APP_URL already point there, so
 * every magic link and transactional email we have ever sent goes to www.
 *
 * The host is taken from PUBLIC_APP_URL (falling back to APP_URL), which is
 * already set to the canonical origin because every transactional email builds
 * its links from it. Nothing new to configure: if those move, the redirect
 * follows. CANONICAL_HOST overrides it if the two ever need to differ.
 *
 * Runs before everything else so no route can answer on the wrong host first,
 * and only ever rewrites the apex/www pair, leaving Railway's internal health
 * checks and *.up.railway.app untouched.
 */
const CANONICAL_HOST = (() => {
  const explicit = (process.env.CANONICAL_HOST || '').trim();
  if (explicit) return explicit;
  const appUrl = (process.env.PUBLIC_APP_URL || process.env.APP_URL || '').trim();
  try {
    return appUrl ? new URL(appUrl).hostname : '';
  } catch {
    return '';
  }
})();
if (isProd) {
  console.log(
    CANONICAL_HOST
      ? `[Canonical] redirecting the apex/www pair to ${CANONICAL_HOST}`
      : '[Canonical] no redirect: set PUBLIC_APP_URL, APP_URL or CANONICAL_HOST to enable it'
  );
}
if (isProd && CANONICAL_HOST) {
  app.use((req, res, next) => {
    // Cached technical-docs bundles call the apex cross-origin. Answer the
    // verification request directly so its route can add CORS headers; an
    // intervening redirect is rejected before the browser reaches that route.
    if (req.path === '/api/docs/verify') return next();
    const host = (req.headers.host || '').toLowerCase().split(':')[0];
    // Only redirect a host that is the canonical one minus its leading "www.",
    // or vice versa. Anything else (railway.app, health checks) passes through.
    const stripped = CANONICAL_HOST.replace(/^www\./, '');
    if (host && host !== CANONICAL_HOST && (host === stripped || host === `www.${stripped}`)) {
      return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
    }
    next();
  });
}
app.use(helmet({
  contentSecurityPolicy: isProd ? {
    directives: {
      defaultSrc:     ["'self'"],
      // Google Identity Services (`accounts.google.com/gsi/client`) is
      // dynamically injected as <script src=…> by the Rift v3 wallet
      // helpers when the user links or signs with a Google account. Without
      // this entry the script is CSP-blocked and enrolment / signing fails
      // with "Failed to load Google Identity script".
      scriptSrc:      ["'self'", "https://accounts.google.com", "https://apis.google.com"],
      // style-src needs Google Fonts because index.html loads Inter + Geist
      // Mono from fonts.googleapis.com. Without it the page renders with
      // system fonts and the stylesheet is blocked.
      // GSI also injects inline styles for its popup button, hence 'unsafe-inline'
      // is already permitted below.
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
        // Safe Transaction Service is called directly by the admin dashboard
        // to inspect the Safe nonce, pending queue, and proposal status.
        "https://api.safe.global",
        // WalletConnect v2 uses its relay over WebSocket and the Explorer API
        // to populate the QR wallet list. These origins must be present in
        // connect-src or pairing fails under the production CSP.
        "https://relay.walletconnect.com",
        "wss://relay.walletconnect.com",
        // WalletConnect Core 2.21.x defaults to the .org relay host.
        "wss://relay.walletconnect.org",
        "https://explorer-api.walletconnect.com",
        // The bundled Reown modal (used by @walletconnect/ethereum-provider)
        // loads the wallet catalog and chain RPC metadata from these origins.
        "https://api.web3modal.org",
        "https://rpc.walletconnect.org",
        "https://pulse.walletconnect.org",
        // Base
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
        // White-labeled Rift widget served from our own subdomain
        "https://widget.blockfinax.com",
        // Cloudinary — direct-to-cloud upload for task evidence
        "https://api.cloudinary.com",
        "https://res.cloudinary.com",
      ],
      // frame-src must include the Rift sign-in widget; otherwise the
      // iframe is blocked and users can't sign in. We point production at
      // our white-labeled widget.blockfinax.com but keep the partner hosts
      // allow-listed so flipping VITE_RIFT_WIDGET_URL back doesn't require
      // a server redeploy.
      frameSrc: [
        "https://accounts.google.com",
        // WalletConnect's verification prompt is embedded by the Reown modal.
        "https://verify.walletconnect.org",
        "https://widget.blockfinax.com",
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
  // Helmet's default Cross-Origin-Opener-Policy is `same-origin`, which
  // severs the link between the page and any popup it opens (window.opener
  // becomes null cross-origin). Google Sign-In opens a popup from the Rift
  // widget iframe and needs to postMessage back to it — without
  // `same-origin-allow-popups`, GSI logs:
  //   [GSI_LOGGER]: Failed to open popup window … Maybe blocked by the browser?
  // and Google sign-in silently fails. Other auth methods (email OTP, Apple)
  // are unaffected.
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  // CORP=same-origin (helmet default) is too strict for the Rift widget's
  // postMessage handshake. `same-site` allows cross-origin embeds while
  // still preventing arbitrary other origins from reading our responses.
  //
  // NOTE: this same-site value is the DEFAULT for API responses. Public
  // static assets (logos, fonts, images) are served with CORP=cross-origin
  // overridden in serveStatic() — see server/vite.ts. Without that
  // override, third-party embeds like the Rift widget's branded header
  // can't render our logo.
  crossOriginResourcePolicy: { policy: "same-site" },
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// API responses must never be cached or conditionally revalidated. Express's
// default ETag triggers 304 Not Modified round-trips that can serve stale data
// to the SPA; force fresh 200s for every /api request.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.removeHeader('ETag');
  next();
});

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
    // Fail closed rather than serving a production UI backed by testnet-mode
    // authorization and chain configuration.
    if (process.env.NETWORK_MODE !== "mainnet") {
      console.error("[Startup] FATAL — NETWORK_MODE must be explicitly set to 'mainnet' in production.");
      process.exit(1);
      return;
    }
  }

  // Initialize database with default networks
  try {
    await initializeDatabase();
  } catch (error) {
    console.error("Database initialization failed:", error);
    process.exit(1);
    return;
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

  // Backfill the full on-chain transaction log into hedge_activity, which powers
  // the data-room traction feed. First run walks the chain from the Diamond's
  // deployment block and can take a few minutes; later runs resume from a cursor
  // and finish in seconds. Deliberately started after chain sync so the two are
  // not competing for the same rate-limited public RPCs.
  //
  // It then repeats on an interval. Running it only at startup meant any
  // deposit or purchase made while the server was up stayed invisible to the
  // traction feed until the next restart — a $9,000 cover purchase went
  // unreported that way. Resumed runs are cheap (a handful of block chunks),
  // so a short interval costs little and keeps the numbers honest.
  const runBackfill = () =>
    backfillChainLogs().catch((e: unknown) =>
      console.error("[ChainLogs] Backfill error:", e instanceof Error ? e.message : e)
    );
  setTimeout(() => {
    runBackfill();
    setInterval(runBackfill, 5 * 60_000);

    // Batched digest of anything the agent is waiting on a decision for.
    startDigestSweep();

    // Screens deposits against designated addresses, tracing one hop back to
    // whoever funded the depositing wallet.
    startDepositSweep();

    // Sends the one follow-up to visitors who asked for it, once the delay
    // has elapsed and only while their consent still stands.
    startFollowUpSweep();
  }, 20_000);

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

  // Outreach scans LinkedIn on its own every five hours. Started after the
  // routes so draftBatch is loaded, and anchored to a timestamp in the database
  // rather than to uptime, so a deploy does not buy another scan.
  {
    const { startOutreachScanner } = await import("./outreach/scheduler");
    const { draftBatch } = await import("./routes/outreach");
    startOutreachScanner({ draft: draftBatch });
  }

  // Prospect discovery and drafting run on their own too. Approving and sending
  // stay manual, because a cold email goes out under Anthony's own name.
  {
    const { startProspectScheduler } = await import("./prospects/scheduler");
    startProspectScheduler();
  }

  // The morning reading. Fetch and brief once a day, not on an interval, so it
  // stays in the morning rather than drifting round the clock.
  {
    const { startResearchDigest } = await import("./research/scheduler");
    startResearchDigest();
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error(`[Error] ${status} - ${message}`, err.stack || '');
    res.status(status).json({ message });
  });

  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException] Fatal server error; exiting for supervisor restart:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection] Fatal unhandled rejection; exiting for supervisor restart:', reason);
    process.exit(1);
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
