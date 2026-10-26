/**
 * Vite Dev Server Integration
 *
 * Integrates Vite's frontend dev server with the Express backend in development mode.
 * In production, serves the pre-built static frontend files from dist/public.
 * Also exports the log() utility used across the server for timestamped console output.
 */
import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        process.cwd(),
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(process.cwd(), "dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Public static assets (logos, fonts, images, JS, CSS) must be embeddable
  // from third-party origins (embeds that render our logo). The
  // global helmet config sets Cross-Origin-Resource-Policy: same-site for
  // every response, which causes browsers to silently block <img src="…">
  // from cross-site contexts (emails work because Gmail proxies the fetch
  // server-side; the widget doesn't, so it falls back to a "B" initial).
  //
  // Override CORP to `cross-origin` for everything under the static-asset
  // tree — this is the standard posture for public images and JS bundles.
  app.use(express.static(distPath, {
    // index.html is served explicitly below, never from here, so a stale copy
    // cannot be handed out by the static middleware's own revalidation.
    index: false,
    setHeaders: (res, filePath) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

      // Vite fingerprints everything under /assets — index-CbAavqsA.js and so
      // on — so the contents behind a given name can never change. Serving
      // those with max-age=0 means a revalidation round-trip for every file on
      // every load, which buys nothing. Cache them for a year.
      if (/[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|jpg|svg|webp|avif)$/.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));

  /**
   * index.html, always revalidated.
   *
   * It is the only file whose name never changes, so it is the only one whose
   * cached copy can pin a browser to an old build — it names the fingerprinted
   * bundle, and a stale copy names a stale bundle forever. That is not
   * hypothetical: a browser here spent a day running code from a deploy two
   * ahead of it, and every "hard refresh, it still fails" reported against
   * that build was describing software that had already been replaced.
   *
   * no-store rather than no-cache because the weak ETag express generates is
   * derived from size and mtime, and a rebuild that happens to produce the
   * same length gives the same validator.
   */
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.removeHeader("ETag");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
