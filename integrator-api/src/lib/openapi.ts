/**
 * OpenAPI 3.1 registry. Each route file calls `openapi.registerPath(...)`
 * with its zod schemas; the spec is generated once at boot and served at
 * /v1/openapi.json + Swagger UI at /v1/docs.
 *
 * Schemas in code === schemas in docs (no manual sync, no drift).
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const openapi = new OpenAPIRegistry();

// Security schemes — registered as components so generateDocument() picks
// them up. Passing `components.securitySchemes` to generateDocument() does
// NOT work in v7; it expects them as registered components.
openapi.registerComponent("securitySchemes", "riftBearer", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Rift Finance access token. End-user auth.",
});
openapi.registerComponent("securitySchemes", "adminToken", {
  type: "apiKey",
  in: "header",
  name: "x-admin-token",
  description: "Admin session token returned by POST /v1/auth/admin/login.",
});
openapi.registerComponent("securitySchemes", "apiKey", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
  description: "Server-side integrator API key. Reserved for non-Rift callers.",
});

// Common schemas referenced by most endpoints
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.enum([
      "unauthorized", "forbidden", "not_found",
      "validation_error", "conflict", "rate_limited",
      "internal_error", "upstream_error", "service_unavailable",
    ]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
}).openapi("ErrorEnvelope");
openapi.register("ErrorEnvelope", ErrorEnvelope);

export const BuiltTxSchema = z.object({
  chainId: z.number().int(),
  to: z.string().describe("Contract recipient. Diamond proxy for hedge calls; ERC-20 address for approve."),
  data: z.string().describe("ABI-encoded calldata (0x-prefixed)."),
  value: z.string().describe("Native value in wei (decimal string). \"0\" for hedge calls."),
  function: z.string(),
  args: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  estimatedGas: z.string().nullable(),
}).openapi("BuiltTx");
openapi.register("BuiltTx", BuiltTxSchema);

export const standardErrorResponses = {
  400: { description: "Validation error", content: { "application/json": { schema: ErrorEnvelope } } },
  401: { description: "Authentication required", content: { "application/json": { schema: ErrorEnvelope } } },
  403: { description: "Not authorized", content: { "application/json": { schema: ErrorEnvelope } } },
  404: { description: "Not found", content: { "application/json": { schema: ErrorEnvelope } } },
  500: { description: "Internal server error", content: { "application/json": { schema: ErrorEnvelope } } },
};

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(openapi.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "BlockFinaX Integrator API",
      version: "1.0.0",
      description: [
        "Public REST API for the BlockFinaX parametric FX-protection protocol.",
        "",
        "## Integration model",
        "",
        "Every state-changing contract function has a corresponding `POST /v1/tx/.../build` endpoint that returns ready-to-sign calldata (`{ chainId, to, data, value }`). You sign with **your own wallet** (Privy, MetaMask, raw key, Rift, anything) and broadcast through **your own RPC**.",
        "",
        "View functions are exposed as ordinary REST reads.",
        "",
        "Authentication: most endpoints are public reads. User-scoped endpoints accept `Authorization: Bearer <rift access token>`. Admin endpoints additionally require `x-admin-token` issued by `POST /v1/auth/admin/login`.",
      ].join("\n"),
    },
    servers: [
      { url: "/v1", description: "This server" },
    ],
  } as any);
}
