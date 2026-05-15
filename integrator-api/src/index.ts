/**
 * BlockFinaX Integrator API — production entrypoint.
 *
 * Just wires up dotenv, builds the app, and binds a port. All actual
 * routing lives in src/app.ts so the test suite can mount the same app
 * via supertest without binding a port.
 */

import "dotenv/config";
import { createApp } from "./app";

const PORT = Number(process.env.PORT) || 4000;

const app = createApp();
app.listen(PORT, () => {
  console.log(`[integrator-api] listening on http://localhost:${PORT}`);
  console.log(`[integrator-api]   docs:    http://localhost:${PORT}/v1/docs`);
  console.log(`[integrator-api]   schema:  http://localhost:${PORT}/v1/openapi.json`);
});
