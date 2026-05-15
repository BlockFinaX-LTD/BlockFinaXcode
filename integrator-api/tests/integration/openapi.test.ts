/**
 * Integration tests for the OpenAPI surface — /v1/openapi.json and the
 * Swagger UI at /v1/docs. The point is to make sure the docs we publish
 * actually describe the routes we serve, so integrators reading the spec
 * can trust what they see.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";

const app = createApp();

describe("GET /v1/openapi.json", () => {
  it("serves a valid OpenAPI 3.1 document", async () => {
    const res = await request(app).get("/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\.1/);
    expect(res.body.info.title).toBe("BlockFinaX Integrator API");
    expect(res.body.info.version).toBe("1.0.0");
  });

  it("declares the security schemes integrators rely on", async () => {
    const { body } = await request(app).get("/v1/openapi.json");
    const schemes = body.components?.securitySchemes ?? {};
    expect(schemes.riftBearer).toBeDefined();
    expect(schemes.riftBearer.type).toBe("http");
    expect(schemes.riftBearer.scheme).toBe("bearer");
    expect(schemes.adminToken).toBeDefined();
    expect(schemes.apiKey).toBeDefined();
  });

  it("registers the BuiltTx and ErrorEnvelope schemas", async () => {
    const { body } = await request(app).get("/v1/openapi.json");
    expect(body.components?.schemas?.BuiltTx).toBeDefined();
    expect(body.components?.schemas?.ErrorEnvelope).toBeDefined();
  });

  it("documents the core calldata-builder paths", async () => {
    const { body } = await request(app).get("/v1/openapi.json");
    const paths = Object.keys(body.paths);
    // Core hedge user actions
    expect(paths).toContain("/tx/hedge/create-event");
    expect(paths).toContain("/tx/hedge/buy-protection");
    expect(paths).toContain("/tx/hedge/deposit");
    expect(paths).toContain("/tx/hedge/claim-payout");
    expect(paths).toContain("/tx/hedge/claim-premiums");
    expect(paths).toContain("/tx/hedge/withdraw-capital");
    // ERC-20 prerequisite
    expect(paths).toContain("/tx/erc20/approve");
    // Oracle + admin + ownership coverage
    expect(paths).toContain("/tx/oracle/submit-rate");
    expect(paths).toContain("/tx/hedge/settle-event");
    expect(paths).toContain("/tx/ownership/transfer-ownership");
    // Reads
    expect(paths).toContain("/chains");
    expect(paths).toContain("/hedge/fees");
    expect(paths).toContain("/governance/owner");
    expect(paths).toContain("/governance/facets");
    expect(paths).toContain("/me");
  });

  it("every calldata-builder path is a POST with an application/json body", async () => {
    const { body } = await request(app).get("/v1/openapi.json");
    for (const [path, methods] of Object.entries<any>(body.paths)) {
      if (path.startsWith("/tx/")) {
        expect(methods.post, `expected POST on ${path}`).toBeDefined();
        expect(methods.post.requestBody?.content?.["application/json"]).toBeDefined();
      }
    }
  });

  it("every documented response references either ErrorEnvelope or a concrete data schema", async () => {
    const { body } = await request(app).get("/v1/openapi.json");
    for (const [path, methods] of Object.entries<any>(body.paths)) {
      for (const [verb, op] of Object.entries<any>(methods)) {
        for (const [code, resp] of Object.entries<any>(op.responses ?? {})) {
          // 204 may legitimately have no body
          if (code === "204") continue;
          const schema = resp?.content?.["application/json"]?.schema;
          expect(schema, `${verb.toUpperCase()} ${path} ${code} has no JSON schema`).toBeDefined();
        }
      }
    }
  });
});

describe("GET /v1/docs", () => {
  it("serves Swagger UI HTML", async () => {
    const res = await request(app).get("/v1/docs/");
    // swagger-ui-express usually issues a redirect or 200 with HTML;
    // accept either, and verify the final body when 200.
    expect([200, 301]).toContain(res.status);
    if (res.status === 200) {
      expect(res.text).toMatch(/swagger-ui/i);
    }
  });
});

describe("GET /v1/unknown-endpoint", () => {
  it("returns the standard 404 envelope for an unmatched v1 path", async () => {
    const res = await request(app).get("/v1/does-not-exist-anywhere");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});

describe("GET /health", () => {
  it("returns a non-versioned health check", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });
});
