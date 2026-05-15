/**
 * App factory — assembles the Express app *without* binding a port.
 *
 * Used by:
 *   - src/index.ts → wraps createApp() and calls .listen()
 *   - tests/      → mounts the app via supertest, no port binding
 */

import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";

import { errorHandler } from "./lib/errors";
import { buildOpenApiDocument } from "./lib/openapi";

import metaRouter from "./routes/meta";
import hedgeReadsRouter from "./routes/hedge-reads";
import oracleReadsRouter from "./routes/oracle-reads";
import governanceReadsRouter from "./routes/governance-reads";
import txBuildRouter from "./routes/tx-build";
import txBroadcastRouter from "./routes/tx-broadcast";

export function createApp(): Express {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({
    origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : true,
    credentials: false,
  }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

  app.use("/v1", metaRouter);
  app.use("/v1", governanceReadsRouter);
  app.use("/v1/hedge", hedgeReadsRouter);
  app.use("/v1/oracle", oracleReadsRouter);
  app.use("/v1/tx", txBuildRouter);
  app.use("/v1/tx", txBroadcastRouter);

  const openApiDoc = buildOpenApiDocument();
  app.get("/v1/openapi.json", (_req, res) => res.json(openApiDoc));
  app.use("/v1/docs", swaggerUi.serve, swaggerUi.setup(openApiDoc, {
    customSiteTitle: "BlockFinaX Integrator API · v1",
    swaggerOptions: { persistAuthorization: true },
  }));

  app.use("/v1", (_req, res) => res.status(404).json({
    error: { code: "not_found", message: "Endpoint not found. See /v1/docs for the full surface." },
  }));
  app.use(errorHandler);

  return app;
}
