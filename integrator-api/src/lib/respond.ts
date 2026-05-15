/**
 * Response envelope helpers.
 *   Success: { data: T, meta?: { ... } }
 *   Error:   { error: { code, message, details? } }   (via errorHandler)
 */

import type { Response } from "express";

export interface PaginationMeta {
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  cursor?: string;
  nextCursor?: string | null;
}

export interface ResponseMeta {
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

export function ok<T>(res: Response, data: T, meta?: ResponseMeta) {
  return res.status(200).json(meta ? { data, meta } : { data });
}
export function created<T>(res: Response, data: T, meta?: ResponseMeta) {
  return res.status(201).json(meta ? { data, meta } : { data });
}
export function noContent(res: Response) {
  return res.status(204).send();
}
