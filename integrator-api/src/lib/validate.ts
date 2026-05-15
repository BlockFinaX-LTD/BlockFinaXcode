/**
 * zod request validator — replaces req.params/query/body with the typed,
 * parsed values. Failures throw ZodError which the error handler turns
 * into a 400 validation_error with field-level `details`.
 */

import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

interface ValidateSchemas {
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
}

export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query)  req.query  = schemas.query.parse(req.query);
      if (schemas.body)   req.body   = schemas.body.parse(req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}
