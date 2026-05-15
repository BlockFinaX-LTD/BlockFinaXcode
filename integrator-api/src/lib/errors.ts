/**
 * Typed error class + Express handler for the integrator API.
 *
 * Routes throw `errors.notFound(...)` / `errors.forbidden(...)` etc., never
 * call `res.status(...).json(...)` directly. The middleware below maps to:
 *   { error: { code, message, details? } }
 * with the correct HTTP status, so the envelope is always consistent.
 */

import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export type ApiErrorCode =
  | "unauthorized"           // 401
  | "forbidden"              // 403
  | "not_found"              // 404
  | "validation_error"       // 400
  | "conflict"               // 409
  | "rate_limited"           // 429
  | "internal_error"         // 500
  | "upstream_error"         // 502 — Rift / RPC / Cloudinary down
  | "service_unavailable";   // 503

const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
  upstream_error: 502,
  service_unavailable: 503,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
    this.details = details;
  }
}

export const errors = {
  unauthorized: (m = "Authentication required") => new ApiError("unauthorized", m),
  forbidden:    (m = "Not authorized")          => new ApiError("forbidden", m),
  notFound:     (m = "Not found")               => new ApiError("not_found", m),
  validation:   (m: string, details?: unknown)  => new ApiError("validation_error", m, details),
  conflict:     (m: string)                     => new ApiError("conflict", m),
  rateLimited:  (m = "Too many requests")       => new ApiError("rate_limited", m),
  internal:     (m = "Internal server error")   => new ApiError("internal_error", m),
  upstream:     (m = "Upstream service error")  => new ApiError("upstream_error", m),
  unavailable:  (m = "Service unavailable")     => new ApiError("service_unavailable", m),
};

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "validation_error",
        message: "Request did not match expected schema",
        details: err.issues.map(i => ({ path: i.path.join("."), message: i.message })),
      },
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }
  console.error("[integrator-api] unhandled error", req.method, req.path, err);
  return res.status(500).json({
    error: { code: "internal_error", message: "Something went wrong" },
  });
}

/** Wrap async handlers so thrown errors land in the middleware. */
export function asyncHandler<T extends (req: any, res: any, next: any) => Promise<any>>(fn: T): T {
  return ((req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)) as T;
}
